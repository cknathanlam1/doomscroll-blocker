import Foundation

// Port of web-prototype/src/demo/demoRunner.ts (+ the useful parts of devHook.ts).
//
// Plays the demo's simulated camera frames through the REAL RepCounter, in
// real time (driven by whoever owns a display link / Timer: call
// `advance(toMs:)` with a monotonic clock), or one by one on request
// (`step(frames:)`) for automated checks and debugging.
//
// It plays the role the camera + frame loop play in a real set. The web's
// DemoRunner only handed frames to the app, which ran the counter; here the
// runner also owns the counter and the tracking-issue detector, so every
// delivered `DemoFrame` carries the frame AND what the counter made of it.
//
// Pure Swift: no UIKit, no timers, no threads. Call it from one thread
// (normally the main actor).

/// One simulated camera frame and what the real counter made of it.
struct DemoFrame {
    /// 0-based position of this frame in the demo.
    var index: Int
    var frame: PoseFrame
    var snapshot: CounterSnapshot
    /// What the UI should say when tracking is off (spec S2/S3). The demo's fake
    /// picture has no brightness, so this is never `.tooDark`.
    var issue: TrackingIssue
}

/// A snapshot of where the demo is (the web's `window.__demo.state()`, minus
/// the app-screen fields, which belong to the UI layer).
struct DemoState: Equatable {
    var phase: CounterPhase?
    var count: Int
    var target: Int
    var hint: CounterHint?
    var issue: TrackingIssue
    /// Where the depth line is (image heights), nil before calibration.
    var depthLineY: Double?
    /// Frames played so far.
    var frame: Int
    var frames: Int
}

/// The counter configuration the app uses for its default settings
/// (`counterConfigFor(settings, tuningFor(settings.depth))` on the web):
/// DEFAULT_CONFIG with the set's target and the "normal" depth preset.
func demoCounterConfig(targetReps: Int) -> CounterConfig {
    var c = DEFAULT_CONFIG
    c.targetReps = targetReps
    c.downThreshold = DepthPreset.normal
    return c
}

/// The App waits this long after `complete` before showing Success
/// (App.SUCCESS_DELAY_MS): success shows on whichever comes first, a 600 ms
/// timer or a frame with `t ≥ successDueAtMs`.
let DEMO_SUCCESS_DELAY_MS = 600.0

/// After a hiccup (slow device, app switch) catch up at most this many frames
/// per display tick, then carry on from there instead of fast-forwarding.
private let MAX_FRAMES_PER_TICK = 4

final class DemoRunner {
    let frames: [PoseFrame]
    /// The real counter every frame goes through (the UI may read its config, e.g. for debug sliders).
    let counter: RepCounter
    let targetReps: Int

    /// Called once per frame, in order, from `advance(toMs:)` and `step(frames:)`.
    var onFrame: ((DemoFrame) -> Void)?
    /// Called once, after the last frame.
    var onEnd: (() -> Void)?

    private let tracking = TrackingIssueDetector()
    private var index = 0
    /// Simulated time already played up to (ms, same clock as frame.t).
    private var clock: Double
    /// The display clock reading (ms) of the previous tick.
    private var lastTick = 0.0
    private var stopped = false
    private var ended = false
    private var _isPlaying = false

    /// The most recent frame played, or nil before the first one.
    private(set) var latest: DemoFrame?
    /// `t + 600 ms` of the `complete` event once it has been played, else nil. See `isSuccessDue`.
    private(set) var successDueAtMs: Double?

    /// Any frames, with the given counter (default: a fresh one with `DEFAULT_CONFIG`).
    init(frames: [PoseFrame], counter: RepCounter = RepCounter()) {
        self.frames = frames
        self.counter = counter
        targetReps = counter.config.targetReps
        // Just before the first frame, so the first tick plays it.
        clock = (frames.first?.t ?? 0) - 1
    }

    /// The scripted demo for `targetReps` reps, through a counter with the app's default settings.
    convenience init(targetReps: Int, options: DemoOptions = DemoOptions()) {
        self.init(
            frames: buildDemoSession(targetReps, options).frames,
            counter: RepCounter(demoCounterConfig(targetReps: targetReps))
        )
    }

    /// Frames played so far.
    var position: Int { index }

    var total: Int { frames.count }

    var isPlaying: Bool { _isPlaying }

    /// Every frame has been played (or the demo was stopped).
    var isFinished: Bool { ended || stopped }

    /// The last played frame's time has passed `successDueAtMs`: show Success now.
    var isSuccessDue: Bool {
        guard let due = successDueAtMs, let t = latest?.frame.t else { return false }
        return t >= due
    }

    /// The dev-hook state (`__demo.state()`).
    var state: DemoState {
        let s = latest?.snapshot
        return DemoState(
            phase: s?.phase,
            count: s?.count ?? 0,
            target: targetReps,
            hint: s?.hint,
            issue: latest?.issue ?? .none,
            depthLineY: s?.depthLineY,
            frame: index,
            frames: frames.count
        )
    }

    /// Starts (or continues) real-time playback; `nowMs` is the display clock
    /// reading right now (any monotonic clock in ms, e.g. CACurrentMediaTime() * 1000).
    /// Simulated time doesn't advance while paused.
    func play(atMs nowMs: Double) {
        if stopped || _isPlaying || ended { return }
        lastTick = nowMs
        _isPlaying = true
    }

    func pause() {
        _isPlaying = false
    }

    /// Ends playback for good (the set was left). Safe to call from inside onFrame.
    func stop() {
        pause()
        stopped = true
    }

    /// One display tick (the web's requestAnimationFrame callback). `nowMs` is
    /// the same clock that was given to `play(atMs:)`. Plays every frame that
    /// is now due (at most 4, so a hiccup never fast-forwards) and returns
    /// them. Does nothing while paused. A `pause()` or `stop()` called from
    /// inside `onFrame` takes effect right away.
    @discardableResult
    func advance(toMs nowMs: Double) -> [DemoFrame] {
        guard _isPlaying, !stopped else { return [] }
        clock += max(0, nowMs - lastTick)
        lastTick = nowMs
        var out: [DemoFrame] = []
        var played = 0
        while _isPlaying, played < MAX_FRAMES_PER_TICK, (index < frames.count ? frames[index].t : Double.infinity) <= clock {
            guard let f = next() else { return out }
            out.append(f)
            played += 1
        }
        // Fell behind: don't try to catch up the rest later (that would fast-forward).
        if played == MAX_FRAMES_PER_TICK, index < frames.count, frames[index].t <= clock {
            clock = frames[index].t - 1
        }
        return out
    }

    /// Plays the next `n` frames right now, synchronously, whatever the clock
    /// says (the dev hook's `__demo.step(n)`). Returns the frames played
    /// (fewer than n at the end of the demo).
    @discardableResult
    func step(frames n: Int = 1) -> [DemoFrame] {
        var out: [DemoFrame] = []
        let count = max(0, n)
        while out.count < count, let f = next() { out.append(f) }
        return out
    }

    /// Plays one frame. Nil when there was nothing (more) to play.
    private func next() -> DemoFrame? {
        if stopped || ended { return nil }
        guard index < frames.count else {
            finish()
            return nil
        }
        let frame = frames[index]
        let i = index
        index += 1
        clock = max(clock, frame.t)

        let snap = counter.update(frame)
        let issue = tracking.update(
            TrackingIssueInput(
                t: frame.t,
                present: snap.features.present,
                inFrame: snap.inFrame,
                shoulderConfidence: snap.features.shoulderConfidence,
                luminance: nil // the demo's fake picture has no brightness
            )
        )
        for e in snap.events {
            if case .complete(let t, _, _) = e { successDueAtMs = t + DEMO_SUCCESS_DELAY_MS }
        }
        let out = DemoFrame(index: i, frame: frame, snapshot: snap, issue: issue)
        latest = out
        onFrame?(out)
        if index >= frames.count, !stopped { finish() }
        return out
    }

    private func finish() {
        ended = true
        pause()
        onEnd?()
    }
}
