import AVFoundation
import SwiftUI

/// Where the frames come from. The camera is the real thing; the demo (a
/// simulated person played through the real counter) is for the Simulator,
/// which has no camera.
enum FrameSourceKind {
    case camera
    case demo
}

/// What the stage should show right now.
enum SessionScreen: Equatable {
    case idle
    case loading
    case stage
    case success(count: Int, elapsedMs: Double)
    case gaveUp
    case cameraError(CameraErrorKind)
}

enum CameraErrorKind: Equatable {
    case denied
    case notFound
    case inUse
    case unknown(String)
}

/// How the current rep attempt looks (UI_SPEC §4.1): drives the gauge and depth-line colours.
enum AttemptLook {
    case none
    case reached
    case partial
}

/// One set of push-ups, from Placement to Success. Port of the logic in
/// web-prototype/src/app.ts (`handleEvent`, success timing, speech) on top of
/// the pure `RepCounter`. SwiftUI reads the published state; it never computes
/// counting logic itself.
@MainActor
final class ChallengeSession: ObservableObject {
    // MARK: Published state the screens render

    @Published private(set) var screen: SessionScreen = .idle
    @Published private(set) var snapshot: CounterSnapshot?
    /// Latest frame, for the overlay (figure, debug joints).
    @Published private(set) var frame: PoseFrame?
    @Published private(set) var issue: TrackingIssue = .none
    @Published private(set) var attempt: AttemptLook = .none
    /// Peak depth to show on the gauge while the "Go lower" cue is on.
    @Published private(set) var partialPeak: Double = 0
    /// Frame clock (ms) until which the "Go lower" cue stays on.
    @Published private(set) var cueUntil: Double = -.infinity
    /// Why the set is paused, for the paused copy.
    @Published private(set) var pauseReason: PauseReason?
    /// The word in the voice chip ("Go", "One", "Lower"…) and a counter that changes each time it pulses.
    @Published private(set) var voiceWord: String?
    @Published private(set) var voicePulse = 0
    /// Increments for every counted rep, to trigger the bump and the floating "+1".
    @Published private(set) var repTick = 0
    /// Increments on every countdown digit change, to trigger its bump.
    @Published private(set) var countdownTick = 0
    @Published private(set) var fps: Double = 0
    @Published private(set) var detectMs: Double = 0
    @Published private(set) var recordedFrames = 0

    // MARK: Settings (UI_SPEC §4.8)

    @AppStorage("reps") var reps = 10
    @AppStorage("depth") var depthPreset = "normal"
    @AppStorage("speak") var speak = true
    @AppStorage("debug") var debug = true

    // MARK: Plumbing

    private(set) var source: FrameSourceKind = .camera
    let camera = PoseCamera()
    private let speech = SpeechService()
    private var counter = RepCounter(.visionDefault)
    private let tracking = TrackingIssueDetector()
    private var lastLowerSpokenAt = -Double.infinity
    private var pendingSuccessAt: Double?
    private var successTask: Task<Void, Never>?
    private var recording: [RecordingFrame] = []
    private var recordedEvents: [CounterEvent] = []
    private var fpsWindowStart = 0.0
    private var fpsWindowFrames = 0
    private var lastLuminance: Double?
    private var lastLuminanceAt = -Double.infinity
    private var suspended = false

    /// "Go lower" / chest cues stay up this long (UI_SPEC §4.5).
    static let cueMs = 1500.0
    static let lowerRepeatMs = 2000.0
    static let successDelayMs = 600.0

    // MARK: Starting and stopping a set

    private func makeConfig() -> CounterConfig {
        var c = CounterConfig.visionDefault
        c.targetReps = min(30, max(5, reps))
        switch depthPreset {
        case "lenient": c.downThreshold = DepthPreset.lenient
        case "strict": c.downThreshold = DepthPreset.strict
        default: c.downThreshold = DepthPreset.normal
        }
        return c
    }

    /// New set: stop any previous one, reset the counter and every view-state, start from Placement.
    func start(_ kind: FrameSourceKind = .camera) {
        stop(keepScreen: true)
        source = kind
        counter = RepCounter(makeConfig())
        tracking.reset()
        snapshot = nil
        frame = nil
        issue = .none
        attempt = .none
        partialPeak = 0
        cueUntil = -.infinity
        pauseReason = nil
        voiceWord = nil
        repTick = 0
        countdownTick = 0
        lastLowerSpokenAt = -.infinity
        pendingSuccessAt = nil
        recording = []
        recordedEvents = []
        recordedFrames = 0
        fpsWindowFrames = 0
        lastLuminance = nil
        suspended = false
        speech.enabled = speak
        speech.activate()
        UIApplication.shared.isIdleTimerDisabled = true

        switch kind {
        case .camera:
            screen = .loading
            requestCameraAndStart()
        case .demo:
            // The demo driver feeds `ingest(_:luminance:)`; see DemoStage.
            screen = .stage
        }
    }

    private func requestCameraAndStart() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            startCamera()
        case .notDetermined:
            Task {
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                if granted { startCamera() } else { screen = .cameraError(.denied) }
            }
        default:
            screen = .cameraError(.denied)
        }
    }

    private func startCamera() {
        camera.onSample = { [weak self] sample in
            DispatchQueue.main.async { self?.ingest(sample.frame, luminance: sample.luminance, detectMs: sample.detectMs) }
        }
        camera.start { [weak self] ok in
            guard let self else { return }
            if !ok { self.screen = .cameraError(.notFound) }
        }
    }

    /// Stops the camera, speech and the idle-timer override. Keeps the counter state.
    func stop(keepScreen: Bool = false) {
        successTask?.cancel()
        camera.onSample = nil
        camera.stop()
        speech.deactivate()
        UIApplication.shared.isIdleTimerDisabled = false
        if !keepScreen { screen = .idle }
    }

    func giveUp() {
        stop(keepScreen: true)
        screen = .gaveUp
    }

    func finishAndGoHome() {
        stop()
    }

    /// Screen locked or app switched: stop the frame loop, the camera and speech. The count and calibration are kept.
    func suspend() {
        guard screen == .stage || screen == .loading, !suspended else { return }
        suspended = true
        camera.onSample = nil
        camera.stop()
        speech.cancel()
    }

    /// Back in the foreground: restart the camera by itself.
    func resume() {
        guard suspended, source == .camera else { return }
        suspended = false
        startCamera()
    }

    // MARK: Frames

    /// One frame in (from the camera or the demo), one snapshot out. Handles the events like `App.handleEvent`.
    func ingest(_ f: PoseFrame, luminance: Double? = nil, detectMs: Double = 0) {
        guard screen == .loading || screen == .stage, !suspended else { return }
        if screen == .loading { screen = .stage }
        if let luminance {
            lastLuminance = luminance
            lastLuminanceAt = f.t
        }
        // Without a recent reading we never claim it is dark.
        let lum = f.t - lastLuminanceAt < 1500 ? lastLuminance : nil

        let snap = counter.update(f)
        frame = f
        snapshot = snap
        self.detectMs = detectMs
        updateFps(f.t)

        issue = tracking.update(TrackingIssueInput(
            t: f.t,
            present: snap.features.present,
            inFrame: snap.inFrame,
            shoulderConfidence: snap.features.shoulderConfidence,
            luminance: source == .camera ? lum : nil
        ))

        for e in snap.events { handle(e, snap) }
        if snap.phase != .paused { pauseReason = nil }

        do {
            recording.append(RecordingFrame(
                t: f.t, aspect: f.aspect, joints: f.joints, world: f.world,
                depth: snap.depth, phase: snap.phase, count: snap.count
            ))
            recordedFrames = recording.count
        }

        if let at = pendingSuccessAt, f.t >= at { showSuccess() }
    }

    private func updateFps(_ t: Double) {
        if fpsWindowFrames == 0 { fpsWindowStart = t }
        fpsWindowFrames += 1
        if t - fpsWindowStart >= 1000 {
            fps = Double(fpsWindowFrames) / ((t - fpsWindowStart) / 1000)
            fpsWindowFrames = 0
        }
    }

    private func handle(_ e: CounterEvent, _ snap: CounterSnapshot) {
        recordedEvents.append(e)
        switch e {
        case .countdownTick(_, let secondsLeft):
            countdownTick += 1
            if secondsLeft > 0 { speech.speak(String(secondsLeft)) }
        case .start:
            attempt = .none
            say("Go")
        case .depthReached:
            attempt = .reached
        case .rep(_, let count, _, _):
            attempt = .none
            repTick += 1
            say(SpeechService.countWord(count))
        case .partial(let t, let peak, _):
            attempt = .partial
            partialPeak = max(peak, t < cueUntil ? partialPeak : 0)
            cueUntil = t + Self.cueMs
            if t - lastLowerSpokenAt > Self.lowerRepeatMs {
                lastLowerSpokenAt = t
                say("Lower")
            }
        case .paused(_, let reason):
            pauseReason = reason
        case .complete(let t, _, _):
            pendingSuccessAt = t + Self.successDelayMs
            successTask?.cancel()
            successTask = Task { [weak self] in
                try? await Task.sleep(for: .milliseconds(Int(Self.successDelayMs)))
                guard !Task.isCancelled else { return }
                self?.showSuccess()
            }
        case .inFrame, .countdownCancelled, .resumed, .repCancelled:
            break
        }
        // The cue and attempt look expire with the frame clock.
        if attempt == .partial, snap.features.t >= cueUntil { attempt = .none }
    }

    private func say(_ word: String) {
        voiceWord = word
        voicePulse += 1
        speech.speak(word)
    }

    private func showSuccess() {
        guard case .stage = screen, let snap = snapshot else { return }
        pendingSuccessAt = nil
        successTask?.cancel()
        let elapsed: Double
        if let started = snap.startedAt { elapsed = snap.features.t - started } else { elapsed = 0 }
        camera.onSample = nil
        camera.stop()
        screen = .success(count: snap.count, elapsedMs: elapsed)
        speech.speak("Scroll earned")
        UIApplication.shared.isIdleTimerDisabled = false
    }

    // MARK: Recording export (same JSON the web writes)

    func makeRecording() -> Recording? {
        guard !recording.isEmpty else { return nil }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return Recording(
            createdAt: iso.string(from: Date()),
            userAgent: "DoomscrollerBlocker iOS \(UIDevice.current.systemVersion) (\(UIDevice.current.model))",
            source: "camera",
            model: "vision",
            delegate: "auto",
            config: counter.config,
            frames: recording,
            events: recordedEvents
        )
    }

    /// Writes the recording to a temporary JSON file for the share sheet; nil if there is nothing to save.
    func recordingFileURL() -> URL? {
        guard let rec = makeRecording(), let data = try? JSONEncoder().encode(rec) else { return nil }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("pushup-recording-\(Int(Date().timeIntervalSince1970)).json")
        do { try data.write(to: url) } catch { return nil }
        return url
    }

    /// Live threshold changes from the debug panel (no loss of count or calibration).
    func updateConfig(_ change: (inout CounterConfig) -> Void) {
        counter.setConfig(change)
    }

    var config: CounterConfig { counter.config }
}
