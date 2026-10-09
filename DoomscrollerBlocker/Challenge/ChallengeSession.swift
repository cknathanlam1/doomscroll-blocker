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
    /// Frame clock (ms) until which the chest-not-head cue stays on.
    @Published private(set) var chestUntil: Double = -.infinity
    /// Non-nil while the "Starting camera…" / "Restarting camera…" overlay shows.
    @Published private(set) var loadingMessage: String?
    /// The automatic camera restart after returning to the app failed: show "Tap to resume".
    @Published private(set) var needsTapToResume = false
    /// A short message on the stage (4 s), e.g. "Demo finished. Tap Give up to leave."
    @Published private(set) var toast: String?
    /// The demo is not playing by itself (debug stepping, see `demoStep`).
    @Published private(set) var demoPaused = false

    // MARK: Settings (UI_SPEC §4.8)

    @AppStorage("reps") var reps = 10
    @AppStorage("depth") var depthPreset = "normal"
    @AppStorage("speak") var speak = true
    /// Developer panel and joint colours by confidence. Off by default: the shipped look is the one in docs/screenshots.
    @AppStorage("debug") var debug = false

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
    private var lastMotion: MotionPhase = .up
    /// From the `complete` event: what Success reports ("10 push-ups · 26 sec").
    private var completed: (count: Int, elapsedMs: Double)?
    private var toastTask: Task<Void, Never>?
    private var demoRunner: DemoRunner?
    private let demoLink = DisplayLinkProxy()
    /// Scales the demo clock (1 = real time). Debug launch argument `-demoSpeed`.
    private var demoSpeed = 1.0
    /// Debug: pause the demo once it has played this many frames (`-demoRunTo`).
    private var demoStopAt: Int?

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
        voiceWord = "Go"
        chestUntil = -.infinity
        loadingMessage = nil
        needsTapToResume = false
        toast = nil
        demoPaused = false
        lastMotion = .up
        repTick = 0
        countdownTick = 0
        lastLowerSpokenAt = -.infinity
        pendingSuccessAt = nil
        completed = nil
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
            loadingMessage = "Starting camera…"
            requestCameraAndStart()
        case .demo:
            screen = .stage
            startDemo()
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

    /// `onFailure` is called on the main queue when the camera can't be started.
    private func startCamera(onFailure: (() -> Void)? = nil) {
        camera.onSample = { [weak self] sample in
            DispatchQueue.main.async { self?.ingest(sample.frame, luminance: sample.luminance, detectMs: sample.detectMs) }
        }
        camera.start { [weak self] ok in
            guard let self else { return }
            if ok { return }
            self.loadingMessage = nil
            if let onFailure { onFailure() } else { self.screen = .cameraError(.notFound) }
        }
    }

    /// Stops the camera, speech and the idle-timer override. Keeps the counter state.
    func stop(keepScreen: Bool = false) {
        successTask?.cancel()
        stopDemo()
        camera.onSample = nil
        camera.stop()
        speech.deactivate()
        UIApplication.shared.isIdleTimerDisabled = false
        loadingMessage = nil
        needsTapToResume = false
        toastTask?.cancel()
        toast = nil
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
        demoRunner?.pause()
    }

    /// Back in the foreground: restart the camera by itself (the demo just carries on).
    func resume() {
        guard suspended else { return }
        suspended = false
        switch source {
        case .demo:
            if !demoPaused { demoRunner?.play(atMs: demoClockMs()) }
        case .camera:
            restartCamera()
        }
    }

    /// "Tap to resume" fallback: the automatic restart failed, so the user taps once.
    func tapToResume() {
        needsTapToResume = false
        restartCamera()
    }

    private func restartCamera() {
        loadingMessage = "Restarting camera…"
        startCamera { [weak self] in self?.needsTapToResume = true }
    }

    // MARK: Toast

    func showToast(_ text: String) {
        toastTask?.cancel()
        toast = text
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled else { return }
            self?.toast = nil
        }
    }

    // MARK: Frames

    /// One camera frame in, one snapshot out. Handles the events like `App.handleEvent`.
    func ingest(_ f: PoseFrame, luminance: Double? = nil, detectMs: Double = 0) {
        guard screen == .loading || screen == .stage, !suspended else { return }
        let snap = counter.update(f)
        process(f, snap, luminance: luminance, detectMs: detectMs, issueOverride: nil)
    }

    /// Everything that follows a frame, whether the counter ran here (camera) or in the demo runner.
    private func process(_ f: PoseFrame, _ snap: CounterSnapshot, luminance: Double?, detectMs: Double, issueOverride: TrackingIssue?) {
        guard screen == .loading || screen == .stage, !suspended else { return }
        if screen == .loading { screen = .stage }
        if loadingMessage != nil { loadingMessage = nil }
        if let luminance {
            lastLuminance = luminance
            lastLuminanceAt = f.t
        }
        // Without a recent reading we never claim it is dark.
        let lum = f.t - lastLuminanceAt < 1500 ? lastLuminance : nil

        frame = f
        snapshot = snap
        self.detectMs = detectMs
        updateFps(f.t)

        if let issueOverride {
            issue = issueOverride
        } else {
            issue = tracking.update(TrackingIssueInput(
                t: f.t,
                present: snap.features.present,
                inFrame: snap.inFrame,
                shoulderConfidence: snap.features.shoulderConfidence,
                luminance: source == .camera ? lum : nil
            ))
        }

        for e in snap.events { handle(e, snap) }
        if snap.phase != .paused { pauseReason = nil }
        // A new descent starts a new attempt: the gauge and depth line go back to white (UI_SPEC §2.4.5).
        if snap.motion != .up && lastMotion == .up { attempt = .none }
        lastMotion = snap.motion
        if snap.hint == .chestNotHead { chestUntil = f.t + Self.cueMs }

        // The demo is simulated: nothing to record.
        if source == .camera {
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
            // `attempt` stays `.reached` (volt gauge and line) until the next descent starts.
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
        case .complete(let t, let count, let elapsedMs):
            completed = (count, elapsedMs)
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
        let done: (count: Int, elapsedMs: Double)
        if let completed {
            done = completed
        } else {
            done = (snap.count, snap.startedAt.map { snap.features.t - $0 } ?? 0)
        }
        stopDemo()
        camera.onSample = nil
        camera.stop()
        loadingMessage = nil
        screen = .success(count: done.count, elapsedMs: done.elapsedMs)
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

    // MARK: Demo ("Watch a demo")

    /// Plays the scripted simulated person through the session's OWN counter, in real time
    /// (UI_SPEC §5.4). `DemoRunner` runs the frames; every frame then goes through `process`
    /// like a camera frame, so the same events reach the UI and the speech.
    private func startDemo() {
        let debug = DemoDebug.current
        let target = min(30, max(5, reps))
        let runner = DemoRunner(frames: buildDemoSession(target).frames, counter: counter)
        demoRunner = runner
        demoSpeed = debug.speed
        demoStopAt = debug.runTo
        runner.onFrame = { [weak self] df in
            guard let self else { return }
            self.process(df.frame, df.snapshot, luminance: nil, detectMs: 0, issueOverride: df.issue)
            if let stop = self.demoStopAt, df.index + 1 >= stop {
                self.demoStopAt = nil
                self.demoPause()
            }
        }
        runner.onEnd = { [weak self] in
            guard let self, self.screen == .stage else { return }
            self.showToast("Demo finished. Tap Give up to leave.")
        }
        demoLink.onTick = { [weak self] in
            guard let self, let runner = self.demoRunner else { return }
            runner.advance(toMs: self.demoClockMs())
        }
        demoLink.start()
        if debug.manual {
            demoPaused = true
        } else {
            runner.play(atMs: demoClockMs())
        }
        #if DEBUG
        startDebugCommandPolling()
        if let name = debug.previewScreen { applyPreview(name) }
        #endif
    }

    private func stopDemo() {
        demoLink.stop()
        demoRunner?.stop()
        demoRunner = nil
        demoStopAt = nil
        demoPaused = false
        #if DEBUG
        debugCommandTimer?.invalidate()
        debugCommandTimer = nil
        #endif
    }

    /// The demo's display clock (ms): real time, scaled by the debug `-demoSpeed`.
    private func demoClockMs() -> Double { CACurrentMediaTime() * 1000 * demoSpeed }

    /// Debug: play `n` demo frames right now (the web's `window.__demo.step(n)`). Pauses real-time playback.
    func demoStep(_ n: Int = 1) {
        guard source == .demo, let runner = demoRunner else { return }
        runner.pause()
        demoPaused = true
        runner.step(frames: n)
    }

    /// Debug: play until the demo has played `frame` frames, then hold there.
    func demoStep(to frame: Int) {
        guard source == .demo, let runner = demoRunner else { return }
        demoStep(max(0, frame - runner.position))
    }

    func demoPause() {
        demoRunner?.pause()
        demoPaused = true
    }

    func demoPlay() {
        guard source == .demo, let runner = demoRunner else { return }
        demoPaused = false
        runner.play(atMs: demoClockMs())
    }

    /// How many demo frames have played (debug readout), nil outside the demo.
    var demoPosition: Int? { source == .demo ? demoRunner?.position : nil }

    #if DEBUG
    private var debugCommandTimer: Timer?

    /// Debug: jump straight to a screen for screenshot checks (`-previewScreen gaveUp|denied|inUse|notFound|unknown|success|loading|resume|tooDark`).
    private func applyPreview(_ name: String) {
        switch name {
        case "gaveUp": stop(keepScreen: true); screen = .gaveUp
        case "denied": stop(keepScreen: true); screen = .cameraError(.denied)
        case "inUse": stop(keepScreen: true); screen = .cameraError(.inUse)
        case "notFound": stop(keepScreen: true); screen = .cameraError(.notFound)
        case "unknown": stop(keepScreen: true); screen = .cameraError(.unknown("AVFoundationErrorDomain -11852"))
        case "success": stop(keepScreen: true); screen = .success(count: 10, elapsedMs: 26_400)
        case "loading": demoPause(); loadingMessage = "Starting camera…"
        case "resume": demoPause(); needsTapToResume = true
        case "tooDark": demoStep(to: 200); issue = .tooDark
        default: break
        }
    }

    /// Debug-only remote control for screenshot checks: write a command into `/tmp/pushup-demo-cmd`
    /// (`step 30`, `to 211`, `play`, `pause`). The file is deleted once it was read.
    private func startDebugCommandPolling() {
        debugCommandTimer?.invalidate()
        debugCommandTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            let path = "/tmp/pushup-demo-cmd"
            guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return }
            try? FileManager.default.removeItem(atPath: path)
            MainActor.assumeIsolated {
                for line in text.split(separator: "\n") {
                    let parts = line.split(separator: " ")
                    guard let cmd = parts.first else { continue }
                    let n = parts.count > 1 ? Int(parts[1]) : nil
                    switch cmd {
                    case "step": self?.demoStep(n ?? 1)
                    case "to": self?.demoStep(to: n ?? 0)
                    case "play": self?.demoPlay()
                    case "pause": self?.demoPause()
                    default: break
                    }
                }
            }
        }
    }
    #endif
}

/// Calls `onTick` on every screen refresh (the display link behind the demo's real-time playback).
final class DisplayLinkProxy: NSObject {
    var onTick: (() -> Void)?
    private var link: CADisplayLink?

    func start() {
        guard link == nil else { return }
        let l = CADisplayLink(target: self, selector: #selector(fire))
        l.add(to: .main, forMode: .common)
        link = l
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    @objc private func fire() { onTick?() }
}

/// Debug launch arguments for checking the demo in the Simulator (ignored in release builds):
/// `-demoManual` start paused · `-demoSpeed 8` play faster · `-demoRunTo 211` hold after that many frames ·
/// `-animScale 8` slow the "+1" and bump animations down · `-noAutoUnlock` keep Success on screen.
struct DemoDebug {
    var manual = false
    var speed = 1.0
    var runTo: Int?
    var animationScale = 1.0
    var noAutoUnlock = false
    var previewScreen: String?

    static let current: DemoDebug = {
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        func value(_ name: String) -> String? {
            guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        return DemoDebug(
            manual: args.contains("-demoManual"),
            speed: value("-demoSpeed").flatMap(Double.init) ?? 1,
            runTo: value("-demoRunTo").flatMap(Int.init),
            animationScale: value("-animScale").flatMap(Double.init) ?? 1,
            noAutoUnlock: args.contains("-noAutoUnlock"),
            previewScreen: value("-previewScreen")
        )
        #else
        return DemoDebug()
        #endif
    }()
}
