import Foundation

// Port of web-prototype/src/core/repCounter.ts. Same names, constants and
// branch order; keep the comments, they explain WHY each rule exists.

/// Starting values. Geometry-derived (see Types.swift); re-tune on real
/// recordings. downThreshold 0.25 ≈ a 95–100° elbow, so true 90° reps
/// (d ≈ 0.32–0.39) pass with margin after smoothing.
let DEFAULT_CONFIG = CounterConfig(
    targetReps: 10,

    downThreshold: 0.25,
    upThreshold: 0.07,
    partialMinDepth: 0.12,
    turnBackMargin: 0.04,
    // Real laptop session (tests/fixtures/laptop-session-1.json): tired reps came
    // back up to d ≈ 0.08–0.12, never reaching upThreshold 0.07, so 13 push-ups
    // counted as 10. Counting at 70 % of the way back up fixes that.
    returnFraction: 0.3,

    minBottomMs: 60,
    minRepMs: 450,
    maxRepMs: 10000,

    visibilityThreshold: 0.5,
    wristVisibilityThreshold: 0.4,
    lostAfterMs: 500,
    resumeAfterMs: 300,

    calibrationHoldMs: 600,
    countdownMs: 3000,
    calibrationWindowMs: 1000,
    calibrationMaxStd: 0.04,
    plankGate: PlankGateConfig(
        minShoulderWidthFrac: 0.15,
        maxShoulderWidthFrac: 0.7,
        maxShoulderTiltDeg: 20,
        minHeightRatio: 1.1,
        maxHeightRatio: 2.6
    ),

    smoothing: SmoothingConfig(minCutoff: 1.2, beta: 1.5, dCutoff: 1.0),
    // Was 400. Shoulder width really grows 5–30 % during a rep (the shoulders
    // come closer to the camera), so a slow average lags behind: right after a
    // deep rep it is still inflated, which keeps d above upThreshold and merged
    // fast back-to-back reps into one (18–49 % of fast-cadence sessions missed
    // a rep in the simulator sweep). 150 ms fixes that and is still smooth enough.
    shoulderWidthTauMs: 150,
    wristTauMs: 500,
    maxJump: 0.25,
    baselineAdaptRate: 0.05,
    baselineMaxDrift: 0.08,
    minShoulderWidthRatio: 0.9,
    // Was 1.2. In the simulator sweep a deep (60°) rep from a close, tilted-up
    // phone legitimately widens the shoulders by up to 30 % (smoothed), so 1.2
    // threw away real reps. Rocking back is caught by the LOWER bound; the
    // upper bound is only a sanity check.
    maxShoulderWidthRatio: 1.4,
    outOfPlankRatio: 1.35,
    headOnlyDropRatio: 0.3
)

/// Depth strictness presets for the settings UI (values for downThreshold).
enum DepthPreset {
    static let lenient = 0.21
    static let normal = 0.25
    static let strict = 0.29
}

extension CounterConfig {
    static let `default` = DEFAULT_CONFIG
}

// ---------------------------------------------------------------------------
// Fixed tuning constants. These are deliberately NOT in CounterConfig: they
// are safety nets rather than knobs, and changing them rarely helps.

/// During the countdown, the plank gate may fail this long before the countdown is cancelled (one bad frame shouldn't cancel it).
private let COUNTDOWN_GATE_GRACE_MS = 400.0
/// Calibration needs at least this many samples in its window ...
/// (Was 8, a frame-count rule: below ~7 fps a perfectly still plank could
/// never calibrate and the 3-2-1 restarted forever with "Hold still". The CPU
/// fallback with the Full model can run at 5–7 fps.)
private let MIN_CALIBRATION_SAMPLES = 4
/// ... and they must span at least this fraction of calibrationWindowMs (time, not frames).
private let MIN_CALIBRATION_SPAN = 0.7
/// "Still" = smoothed depth stays within ±this band ...
private let STILL_BAND = 0.03
/// ... for at least this long.
private let STILL_MS = 500.0
/// The top baseline only adapts while depth is below this (resting at the top, or above the calibrated top).
private let ADAPT_MAX_DEPTH = 0.05
/// Per-frame settings (baselineAdaptRate, maxJump) are defined for one 30 fps
/// frame and scaled by the real frame time, so they behave the same at 15 fps.
private let REFERENCE_FRAME_MS = 1000.0 / 30.0
/// Shoulder-width ratio outside this range while counting means the user left the plank (pause).
private let OUT_OF_PLANK_MIN_SW_RATIO = 0.8
/// Must stay above maxShoulderWidthRatio (deep reps from a close phone reach ~1.3).
private let OUT_OF_PLANK_MAX_SW_RATIO = 1.5
/// Out-of-plank must persist this long before pausing, so one glitchy frame can't pause the set.
private let OUT_OF_PLANK_DEBOUNCE_MS = 200.0
/// To resume after an out-of-plank pause, depth must be back within ±this of the top.
private let RESUME_MAX_DEPTH = 0.1
/// The "chest, not head" check only runs while the shoulders have barely moved.
private let HEAD_DROP_MAX_DEPTH = 0.1
/// The head must stay dropped this long before the hint shows.
private let HEAD_DROP_MS = 300.0
/// Hints that flash (chest, not head) stay up this long so they can be read from the floor.
private let HINT_LINGER_MS = 1500.0
/// A suspicious jump in raw depth is replaced by the previous value for at most this many frames, then accepted.
private let MAX_JUMP_HOLD_FRAMES = 3
/// A new rep attempt starts only once depth has risen this far above the
/// lowest point since the last rep (the "local top"). Because a rep can now be
/// counted before the user is fully back up, this stops the rest of the way
/// up from looking like the start of a new (shallow) rep.
private let ATTEMPT_MIN_RISE = 0.06
/// An attempt also ends once depth is back within this of where it started
/// (its local top). A tired user's top can sit above upThreshold (d ≈ 0.08 at
/// a 135° elbow), and without this a shallow rep from there never ended: the
/// next reps folded into it with no "Go lower", and a real rep could later be
/// cancelled as too slow.
private let ATTEMPT_END_MARGIN = 0.04

// ---------------------------------------------------------------------------
// Small helpers

/// JavaScript truthiness for a number that may be missing: nil, 0 and NaN are all "falsy".
private func truthy(_ x: Double?) -> Double? {
    guard let x, x != 0, !x.isNaN else { return nil }
    return x
}

/// Exponential moving average step with time constant tauMs, using the real frame time dtMs.
private func ema(_ prev: Double?, _ value: Double, _ dtMs: Double, _ tauMs: Double) -> Double {
    guard let prev else { return value }
    let a = tauMs > 0 ? 1 - exp(-dtMs / tauMs) : 1
    return prev + a * (value - prev)
}

private func median(_ values: [Double]) -> Double {
    let s = values.sorted()
    if s.isEmpty { return Double.nan }
    let mid = s.count / 2
    return s.count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

private func stdDev(_ values: [Double]) -> Double {
    if values.isEmpty { return Double.infinity }
    let mean = values.reduce(0, +) / Double(values.count)
    let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count)
    return variance.squareRoot()
}

private func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double {
    min(hi, max(lo, x))
}

/// Smoothing for the calibration stillness check: a plain low-pass (beta = 0)
/// at half the depth filter's cutoff. Landmark jitter is fast and gets
/// filtered out; a user still settling into position drifts slowly and still
/// shows up as variance.
private func calibrationSmoothing(_ smoothing: SmoothingConfig) -> SmoothingConfig {
    var out = smoothing
    out.minCutoff = smoothing.minCutoff / 2
    out.beta = 0
    return out
}

// ---------------------------------------------------------------------------
// State

private struct CalibrationSample {
    var t: Double
    /// heightRatio from the smoothed references. hTop is the median of these.
    var h: Double
    /// The same, passed through a One Euro filter. Only used for the stillness (std) check.
    var hSmooth: Double
    /// nose.y - shoulderMid.y, or nil if the nose wasn't visible.
    var noseGap: Double?
}

private struct DepthMeasurement {
    /// Unsmoothed depth.
    var raw: Double
    /// heightRatio that corresponds to `raw`.
    var h: Double
    var source: DepthSource
}

/// Everything that changes while counting. Kept in one value so reset() is a single assignment.
private struct CounterState {
    var phase: CounterPhase = .waiting
    var motion: MotionPhase = .up
    var count = 0
    var startedAt: Double?
    var lastT: Double?

    // Debounced visibility ("in frame").
    var inFrame = false
    var visibleSince: Double?
    var hiddenSince: Double?

    // Smoothed references (image-height units).
    var swEma: Double?
    var wristRefY: Double?

    // Calibration results. hTop and swTop also follow the user slowly while resting at the top.
    var hTop: Double?
    var hTopCalibrated: Double?
    var swTop: Double?
    var noseGapTop: Double?

    // Waiting / countdown.
    var gateSince: Double?
    var countdownStart: Double?
    var lastTick = 0
    var gateFailSince: Double?
    var calSamples: [CalibrationSample] = []
    var calibrationRestarted = false

    // Depth signal.
    var lastRawAccepted: Double?
    var lastRawT: Double?
    var jumpHeldFrames = 0
    var peakDepth = 0.0

    // Current rep attempt (attemptStart == nil → no attempt).
    /// Lowest depth since the last attempt ended: where "the top" is right now.
    var localTop: Double?
    /// When the user was at localTop (the rep's timer starts there).
    var leftTopAt: Double?
    var repStart = 0.0
    var attemptStart: Double?
    /// localTop when the current attempt started: the attempt also ends once the user is back near it.
    var attemptTop = 0.0
    var bottomSince: Double?
    var livePartialSent = false
    var swRatioMin = 1.0
    var swRatioMax = 1.0
    /// After a cancelled attempt, the user must return to the top before a new attempt can start.
    var awaitingTop = false

    // Baseline adaptation.
    var stillAnchor: Double?
    var stillSince = 0.0

    // Pause.
    var pauseReason: PauseReason?
    var outOfPlankSince: Double?
    var resumeSince: Double?

    // Hints.
    var headDropSince: Double?
    var chestHintUntil = -Double.infinity
}

// ---------------------------------------------------------------------------

/// Push-up rep counter state machine. Pure: feed it PoseFrames, read snapshots.
///
/// Depth signal (front camera on the floor, user's head toward the phone):
///   h = (wristRefY - shoulderMid.y) / shoulderWidth  — the gap between the
///       hands and the shoulders, measured in shoulder widths so it doesn't
///       change with distance to the camera.
///   d = 1 - h / hTop  — 0 at the top (calibrated during the 3-2-1), growing
///       as the shoulders sink toward the hands.
/// A rep counts when d goes past downThreshold and comes back to upThreshold.
final class RepCounter {
    private var cfg: CounterConfig
    private let depthFilter: OneEuroFilter
    /// Smooths h during the countdown so ordinary landmark jitter doesn't fail
    /// the stillness check (see calibrationSmoothing). With the normal beta the
    /// filter mistakes jitter for motion and barely smooths at all.
    private let calFilter: OneEuroFilter
    private var s = CounterState()

    init(_ config: CounterConfig = DEFAULT_CONFIG) {
        cfg = config
        depthFilter = OneEuroFilter(config.smoothing)
        calFilter = OneEuroFilter(calibrationSmoothing(config.smoothing))
    }

    /// A copy of the active configuration.
    var config: CounterConfig { cfg }

    /// Updates thresholds live (e.g. from debug sliders) without losing the count or calibration.
    /// (The web takes a Partial<CounterConfig>; here you change the fields you want in place.)
    func setConfig(_ change: (inout CounterConfig) -> Void) {
        change(&cfg)
        depthFilter.setConfig(cfg.smoothing)
        calFilter.setConfig(calibrationSmoothing(cfg.smoothing))
    }

    func update(_ frame: PoseFrame) -> CounterSnapshot {
        let cfg = self.cfg
        let t = frame.t
        // Timing always comes from timestamps, never from frame counts: Safari's
        // frame rate wanders between ~12 and 30 fps.
        let dtMs = s.lastT == nil ? 0 : max(0, t - s.lastT!)
        s.lastT = t

        let f = computeFeatures(frame, cfg.visibilityThreshold, cfg.wristVisibilityThreshold)
        var events: [CounterEvent] = []

        updateInFrame(f, t)
        let gateHint = plankGateHint(f)
        let plankOk = gateHint == nil
        updateReferences(f, dtMs, plankOk)

        var hint: CounterHint?
        var measurement: DepthMeasurement?
        var depth: Double?

        switch s.phase {
        case .waiting:
            hint = stepWaiting(t, gateHint, &events)
        case .countdown:
            hint = stepCountdown(f, t, gateHint, &events)
            // stepCountdown can change the phase.
            if s.phase == .counting {
                // Calibration just finished: start the depth filter on this frame.
                measurement = measureDepth(f)
                if let m = measurement { depth = smoothDepth(m.raw, t) }
            }
        case .counting:
            measurement = measureDepth(f)
            if let m = measurement { depth = smoothDepth(m.raw, t) }
            hint = stepCounting(f, t, dtMs, measurement, depth, &events)
        case .paused:
            measurement = measureDepth(f)
            if let m = measurement { depth = smoothDepth(m.raw, t) }
            hint = stepPaused(t, gateHint, depth, &events)
        case .complete:
            measurement = measureDepth(f)
            if let m = measurement { depth = smoothDepth(m.raw, t) }
        }

        let calibrated = s.hTop != nil
        var shoulderWidthRatio: Double?
        if calibrated, let swEma = s.swEma, let swTop = truthy(s.swTop) {
            shoulderWidthRatio = swEma / swTop
        }
        var countdownRemainingMs: Double?
        if s.phase == .countdown, let start = s.countdownStart {
            countdownRemainingMs = max(0, cfg.countdownMs - (t - start))
        }
        return CounterSnapshot(
            phase: s.phase,
            motion: s.phase == .counting ? s.motion : .up,
            count: s.count,
            target: cfg.targetReps,
            depth: depth,
            rawDepth: measurement?.raw,
            peakDepth: s.peakDepth,
            depthSource: measurement?.source,
            heightRatio: measurement != nil ? measurement!.h : referenceHeightRatio(f),
            baselineRatio: s.hTop,
            shoulderWidthRatio: shoulderWidthRatio,
            depthLineY: depthLineY(),
            countdownRemainingMs: countdownRemainingMs,
            inFrame: s.inFrame,
            plankOk: plankOk,
            hint: hint,
            startedAt: s.startedAt,
            features: f,
            events: events
        )
    }

    /// Back to .waiting with count 0 (keeps config).
    func reset() {
        s = CounterState()
        depthFilter.reset()
        calFilter.reset()
    }

    // -------------------------------------------------------------------------
    // Per-frame bookkeeping

    /// Debounced "the user is visible": on after resumeAfterMs of visible shoulders, off after lostAfterMs without.
    private func updateInFrame(_ f: Features, _ t: Double) {
        if f.shouldersVisible {
            s.hiddenSince = nil
            if s.visibleSince == nil { s.visibleSince = t }
            if !s.inFrame && t - s.visibleSince! >= cfg.resumeAfterMs { s.inFrame = true }
        } else {
            s.visibleSince = nil
            if s.hiddenSince == nil { s.hiddenSince = t }
            if s.inFrame && t - s.hiddenSince! >= cfg.lostAfterMs { s.inFrame = false }
        }
    }

    /// Updates the smoothed shoulder width and the wrist reference.
    /// The wrist reference only follows the wrists between rep attempts (or
    /// while setting up). During a rep it is frozen: the hands don't move on the
    /// floor, but the detector's wrist estimate can wobble as the body moves.
    ///
    /// It keeps following while awaitingTop (after a pause or a cancelled
    /// attempt). It used to freeze there too, and if the phone had been moved
    /// (knocked over and propped up again at another tilt) the stale hand line
    /// kept d above partialMinDepth at the real top: awaitingTop never cleared
    /// and no rep could ever count again.
    private func updateReferences(_ f: Features, _ dtMs: Double, _ plankOk: Bool) {
        if f.shouldersVisible, let width = f.shoulderWidth {
            s.swEma = ema(s.swEma, width, dtMs, cfg.shoulderWidthTauMs)
        }
        guard let wristMid = f.wristMid else { return }
        let atTop =
            s.phase == .waiting ||
            s.phase == .countdown ||
            (s.phase == .counting && s.attemptStart == nil) ||
            // Hands may have been re-planted during a pause; follow them once the plank is back.
            (s.phase == .paused && plankOk)
        if atTop { s.wristRefY = ema(s.wristRefY, wristMid.y, dtMs, cfg.wristTauMs) }
    }

    /// heightRatio from the smoothed references (no calibration needed), or nil.
    private func referenceHeightRatio(_ f: Features) -> Double? {
        guard f.shouldersVisible, let mid = f.shoulderMid, let wristRefY = s.wristRefY, let swEma = truthy(s.swEma) else {
            return nil
        }
        return (wristRefY - mid.y) / swEma
    }

    /// The plank gate: nil when this frame looks like a plank seen from a
    /// phone on the floor, otherwise the hint for the first check that failed.
    private func plankGateHint(_ f: Features) -> CounterHint? {
        let g = cfg.plankGate
        guard f.present, f.shouldersVisible, let shoulderMid = f.shoulderMid else { return .getInFrame }
        guard f.visibleWrists != 0, let wristMid = f.wristMid else { return .handsInView }
        guard let widthFrac = f.shoulderWidthFrac, widthFrac >= g.minShoulderWidthFrac else { return .moveCloser }
        if widthFrac > g.maxShoulderWidthFrac { return .moveBack }
        // The rest mean "not a plank shape yet" — the instruction is to hold a plank.
        guard let tilt = f.shoulderTiltDeg, !(tilt > g.maxShoulderTiltDeg) else { return .holdStill }
        if wristMid.y <= shoulderMid.y { return .holdStill }
        guard let h = f.heightRatio, !(h < g.minHeightRatio), !(h > g.maxHeightRatio) else {
            return .holdStill
        }
        if !f.wristsInSpan { return .holdStill }
        if let nose = f.nose, nose.y >= wristMid.y { return .holdStill }
        return nil
    }

    /// Where the shoulder midpoint must reach for d = downThreshold (the "depth
    /// line" the UI draws). Solving d = 1 - h/hTop with h = (wristRefY - y)/sw
    /// for y gives  y = wristRefY - hTop·(1 - down)·sw.  It uses exactly the
    /// references measureDepth uses, so a shoulder midpoint on this line means
    /// raw depth = downThreshold. Nil until calibrated.
    private func depthLineY() -> Double? {
        guard let hTop = s.hTop, let wristRefY = s.wristRefY, let swEma = truthy(s.swEma) else { return nil }
        return wristRefY - hTop * (1 - cfg.downThreshold) * swEma
    }

    /// Depth of this frame. Needs calibration and visible shoulders.
    ///
    /// The hand line (wristRefY) is frozen during a rep and the hands don't move
    /// on the floor, so the same formula also works when no wrist is visible in
    /// this frame (hidden in low light, or a wobbly detection): depth then comes
    /// from the shoulders alone, against the last known hand line, and is
    /// labelled .shoulders. One formula for both cases means no jump in depth
    /// when the wrists drop in and out mid-rep.
    ///
    /// (An earlier fallback divided the raw shoulder drop by the shoulder width
    /// at the TOP. The shoulders grow as they come closer to the camera, so it
    /// read up to ~25 % shallower than the wrist signal at the bottom and a real
    /// 90° rep from a close phone failed to count whenever the wrists vanished.)
    private func measureDepth(_ f: Features) -> DepthMeasurement? {
        guard f.shouldersVisible, let mid = f.shoulderMid, let hTop = s.hTop, let wristRefY = s.wristRefY,
              let swEma = truthy(s.swEma) else { return nil }
        let h = (wristRefY - mid.y) / swEma
        return DepthMeasurement(raw: 1 - h / hTop, h: h, source: f.visibleWrists > 0 ? .wrists : .shoulders)
    }

    /// Jump rejection + One Euro smoothing of the raw depth.
    private func smoothDepth(_ raw: Double, _ t: Double) -> Double {
        var accepted = raw
        // A single-frame leap (e.g. the detector briefly snapping a wrist to the
        // wrong place) is ignored for a few frames; if it persists it is real.
        // maxJump is per 30 fps frame: after a longer gap (15 fps, or a dropped
        // frame) a fast but real push-up legitimately moves further, so the limit
        // grows with the gap.
        let gapMs = s.lastRawT == nil ? REFERENCE_FRAME_MS : t - s.lastRawT!
        let maxJump = cfg.maxJump * max(1, gapMs / REFERENCE_FRAME_MS)
        if let last = s.lastRawAccepted, abs(raw - last) > maxJump, s.jumpHeldFrames < MAX_JUMP_HOLD_FRAMES {
            accepted = last
            s.jumpHeldFrames += 1
        } else {
            s.jumpHeldFrames = 0
        }
        s.lastRawAccepted = accepted
        s.lastRawT = t
        return depthFilter.filter(accepted, t)
    }

    // -------------------------------------------------------------------------
    // Phases

    private func stepWaiting(_ t: Double, _ gateHint: CounterHint?, _ events: inout [CounterEvent]) -> CounterHint? {
        if gateHint != nil {
            s.gateSince = nil
            return gateHint
        }
        if s.gateSince == nil { s.gateSince = t }
        if t - s.gateSince! >= cfg.calibrationHoldMs {
            events.append(.inFrame(t: t))
            startCountdown(t, &events)
            return nil
        }
        // In a plank but not for long enough yet.
        return .holdStill
    }

    private func startCountdown(_ t: Double, _ events: inout [CounterEvent]) {
        s.phase = .countdown
        s.countdownStart = t
        s.gateFailSince = nil
        s.calSamples = []
        calFilter.reset()
        s.lastTick = Int(ceil(cfg.countdownMs / 1000))
        events.append(.countdownTick(t: t, secondsLeft: s.lastTick))
    }

    private func stepCountdown(
        _ f: Features,
        _ t: Double,
        _ gateHint: CounterHint?,
        _ events: inout [CounterEvent]
    ) -> CounterHint? {
        if gateHint != nil {
            if s.gateFailSince == nil { s.gateFailSince = t }
            if t - s.gateFailSince! >= COUNTDOWN_GATE_GRACE_MS {
                events.append(.countdownCancelled(t: t))
                s.phase = .waiting
                s.gateSince = nil
                s.countdownStart = nil
                s.calibrationRestarted = false
                return gateHint
            }
        } else {
            s.gateFailSince = nil
            if let h = referenceHeightRatio(f), let mid = f.shoulderMid {
                s.calSamples.append(CalibrationSample(
                    t: t,
                    h: h,
                    hSmooth: calFilter.filter(h, t),
                    noseGap: f.nose.map { $0.y - mid.y }
                ))
                // Only the last calibrationWindowMs is ever used.
                while let first = s.calSamples.first, first.t < t - cfg.calibrationWindowMs {
                    s.calSamples.removeFirst()
                }
            }
        }

        let elapsed = t - (s.countdownStart ?? t)
        let remaining = cfg.countdownMs - elapsed
        if remaining <= 0 {
            finishCountdown(t, &events)
        } else {
            let secondsLeft = Int(ceil(remaining / 1000))
            if secondsLeft < s.lastTick {
                s.lastTick = secondsLeft
                events.append(.countdownTick(t: t, secondsLeft: secondsLeft))
            }
        }
        if s.phase != .countdown { return nil }
        if gateHint != nil { return gateHint }
        return s.calibrationRestarted ? .holdStill : nil
    }

    /// End of the 3-2-1: measure the top baseline, or restart if the user wasn't still.
    private func finishCountdown(_ t: Double, _ events: inout [CounterEvent]) {
        let window = s.calSamples.filter { $0.t >= t - cfg.calibrationWindowMs }
        let span = (window.last?.t ?? 0) - (window.first?.t ?? 0)
        let stable =
            window.count >= MIN_CALIBRATION_SAMPLES &&
            span >= MIN_CALIBRATION_SPAN * cfg.calibrationWindowMs &&
            stdDev(window.map { $0.hSmooth }) <= cfg.calibrationMaxStd
        guard stable, s.swEma != nil else {
            // Still moving: run the 3-2-1 again (the hint tells the user to hold still).
            s.calibrationRestarted = true
            startCountdown(t, &events)
            return
        }
        let hTop = median(window.map { $0.h })
        let noseGaps = window.compactMap { $0.noseGap }
        s.hTop = hTop
        s.hTopCalibrated = hTop
        s.swTop = s.swEma
        // The head check needs a reliable nose; skip it if the nose was mostly out of view.
        s.noseGapTop = Double(noseGaps.count) >= Double(window.count) / 2 ? median(noseGaps) : nil

        s.phase = .counting
        s.motion = .up
        s.startedAt = t
        s.countdownStart = nil
        s.calibrationRestarted = false
        s.leftTopAt = t
        s.localTop = nil
        s.attemptStart = nil
        s.awaitingTop = false
        s.peakDepth = 0
        s.stillAnchor = nil
        s.lastRawAccepted = nil
        s.lastRawT = nil
        s.jumpHeldFrames = 0
        depthFilter.reset()
        events.append(.start(t: t, baselineRatio: hTop))
    }

    private func stepCounting(
        _ f: Features,
        _ t: Double,
        _ dtMs: Double,
        _ m: DepthMeasurement?,
        _ d: Double?,
        _ events: inout [CounterEvent]
    ) -> CounterHint? {
        guard let m, let d else {
            // Shoulders not visible. Short dropouts are tolerated (the rep in
            // progress continues); after lostAfterMs the set pauses.
            if let hiddenSince = s.hiddenSince, t - hiddenSince >= cfg.lostAfterMs {
                enterPause(.lost, t, &events)
            }
            return .getInFrame
        }

        let swRatio: Double
        if let swEma = s.swEma, let swTop = truthy(s.swTop) { swRatio = swEma / swTop } else { swRatio = 1 }
        // h > outOfPlankRatio × hTop  ⇔  d < 1 - outOfPlankRatio (the user rose up, e.g. onto the knees).
        let outOfPlank =
            d < 1 - cfg.outOfPlankRatio || swRatio < OUT_OF_PLANK_MIN_SW_RATIO || swRatio > OUT_OF_PLANK_MAX_SW_RATIO
        if outOfPlank {
            if s.outOfPlankSince == nil { s.outOfPlankSince = t }
            if t - s.outOfPlankSince! >= OUT_OF_PLANK_DEBOUNCE_MS {
                enterPause(.outOfPlank, t, &events)
                return .backToPlank
            }
        } else {
            s.outOfPlankSince = nil
        }

        stepMotion(t, dtMs, d, m, swRatio, &events)
        checkHeadOnly(f, t, d)

        if s.count >= cfg.targetReps {
            s.phase = .complete
            s.motion = .up
            events.append(.complete(t: t, count: s.count, elapsedMs: t - (s.startedAt ?? t)))
            return nil
        }

        if f.visibleWrists == 0 { return .handsInView }
        if t < s.chestHintUntil { return .chestNotHead }
        return nil
    }

    /// up → descending → down → (back to up: rep / partial / cancelled).
    private func stepMotion(
        _ t: Double,
        _ dtMs: Double,
        _ d: Double,
        _ m: DepthMeasurement,
        _ swRatio: Double,
        _ events: inout [CounterEvent]
    ) {
        guard let attemptStart = s.attemptStart else {
            // Follow the lowest point since the last rep: tired users often stop a
            // little short of their calibrated plank, so the next rep starts from
            // wherever they turned around, not only from d ≈ 0.
            if s.localTop == nil || d <= s.localTop! {
                s.localTop = d
                s.leftTopAt = t
            }
            if d <= cfg.partialMinDepth { s.awaitingTop = false }
            if !s.awaitingTop && d > cfg.partialMinDepth && d - s.localTop! >= ATTEMPT_MIN_RISE {
                // A real descent has begun: this is now a rep attempt.
                s.attemptStart = t
                s.attemptTop = s.localTop!
                s.repStart = s.leftTopAt ?? t
                s.motion = .descending
                s.peakDepth = d
                s.bottomSince = nil
                s.livePartialSent = false
                s.swRatioMin = swRatio
                s.swRatioMax = swRatio
                s.stillAnchor = nil
                return
            }
            if !s.awaitingTop && m.source == .wrists { adaptBaseline(t, dtMs, d) }
            return
        }

        // --- An attempt is in progress.
        s.peakDepth = max(s.peakDepth, d)
        s.swRatioMin = min(s.swRatioMin, swRatio)
        s.swRatioMax = max(s.swRatioMax, swRatio)
        // A real push-up only widens the shoulders a little (they come closer to
        // the camera). A big change means the user rocked back or shifted instead.
        let ratioOk = s.swRatioMin >= cfg.minShoulderWidthRatio && s.swRatioMax <= cfg.maxShoulderWidthRatio

        if s.motion == .descending {
            if d >= cfg.downThreshold && ratioOk {
                if s.bottomSince == nil { s.bottomSince = t }
                if t - s.bottomSince! >= cfg.minBottomMs {
                    s.motion = .down
                    events.append(.depthReached(t: t))
                }
            } else {
                s.bottomSince = nil
            }
            // Turned back before reaching depth → say "Go lower" right away, not only at the top.
            if s.motion == .descending && !s.livePartialSent && ratioOk && s.peakDepth >= cfg.partialMinDepth
                && d < s.peakDepth - cfg.turnBackMargin {
                s.livePartialSent = true
                events.append(.partial(t: t, peakDepth: s.peakDepth, live: true))
            }
        }

        if t - attemptStart > cfg.maxRepMs {
            events.append(.repCancelled(t: t, reason: .tooSlow))
            endAttempt()
            s.awaitingTop = true
            return
        }

        // Back up: counted once the user is most of the way back up (never at the
        // bottom). The bar scales with how deep this rep went and is never
        // stricter than upThreshold. It is capped at partialMinDepth, the line
        // where an attempt starts, so a rep must come back out of the bottom
        // zone. (The cap used to be 0.9 × downThreshold ≈ a 115–125° elbow, and
        // pulsing in the bottom half between ~65° and ~120° counted every pulse.)
        let returnAt = min(max(cfg.upThreshold, cfg.returnFraction * s.peakDepth), cfg.partialMinDepth)
        // A tired user's top can sit above returnAt (a shallow attempt has a low
        // returnAt): the attempt also ends once they are back near where it started.
        let endAt = max(returnAt, min(cfg.partialMinDepth, s.attemptTop + ATTEMPT_END_MARGIN))
        if d <= endAt {
            let durationMs = t - s.repStart
            if !ratioOk {
                events.append(.repCancelled(t: t, reason: .rockedBack))
            } else if s.motion == .down {
                // Faster than minRepMs is a bounce or a tracking glitch, not a push-up: silently ignored.
                if durationMs >= cfg.minRepMs {
                    s.count += 1
                    events.append(.rep(t: t, count: s.count, durationMs: durationMs, peakDepth: s.peakDepth))
                }
            } else if !s.livePartialSent {
                events.append(.partial(t: t, peakDepth: s.peakDepth, live: false))
            }
            endAttempt()
            s.leftTopAt = t
        }
    }

    private func endAttempt() {
        s.attemptStart = nil
        s.localTop = nil // re-measured from the next frame
        s.motion = .up
        s.bottomSince = nil
        s.stillAnchor = nil
    }

    /// While resting still at the top, let the top references slowly follow the
    /// user: they may settle into a slightly different plank than at calibration,
    /// have calibrated with slightly bent arms, or shuffle closer/further between
    /// reps. hTop is clamped near its calibrated value so it can never drift far;
    /// the shoulder width at the top just tracks where the user now is
    /// (otherwise a user who shuffled back 12 cm would have every later rep
    /// rejected as "rocked back").
    private func adaptBaseline(_ t: Double, _ dtMs: Double, _ d: Double) {
        guard let anchor = s.stillAnchor, !(abs(d - anchor) > STILL_BAND) else {
            s.stillAnchor = d
            s.stillSince = t
            return
        }
        if cfg.baselineAdaptRate <= 0 || d >= ADAPT_MAX_DEPTH || t - s.stillSince < STILL_MS { return }
        guard let hTop = s.hTop, let hTopCalibrated = s.hTopCalibrated else { return }
        let rate = clamp(cfg.baselineAdaptRate, 0, 1)
        let alpha = 1 - pow(1 - rate, dtMs / REFERENCE_FRAME_MS)
        let hNow = hTop * (1 - d) // smoothed h
        let lo = hTopCalibrated * (1 - cfg.baselineMaxDrift)
        let hi = hTopCalibrated * (1 + cfg.baselineMaxDrift)
        s.hTop = clamp(hTop + alpha * (hNow - hTop), lo, hi)
        if let swTop = s.swTop, let swEma = s.swEma { s.swTop = swTop + alpha * (swEma - swTop) }
    }

    /// "Lower your chest, not just your head": nose dips while the shoulders stay up. Never counts.
    private func checkHeadOnly(_ f: Features, _ t: Double, _ d: Double) {
        guard let noseGapTop = s.noseGapTop, let swTop = truthy(s.swTop), let nose = f.nose, let mid = f.shoulderMid else {
            s.headDropSince = nil
            return
        }
        // Measured relative to the shoulders so slow drift of the whole body doesn't trigger it.
        let drop = (nose.y - mid.y - noseGapTop) / swTop
        if drop > cfg.headOnlyDropRatio && d < HEAD_DROP_MAX_DEPTH {
            if s.headDropSince == nil { s.headDropSince = t }
            if t - s.headDropSince! >= HEAD_DROP_MS { s.chestHintUntil = t + HINT_LINGER_MS }
        } else {
            s.headDropSince = nil
        }
    }

    private func enterPause(_ reason: PauseReason, _ t: Double, _ events: inout [CounterEvent]) {
        if s.attemptStart != nil {
            // Never count a rep we couldn't fully see.
            events.append(.repCancelled(t: t, reason: reason == .lost ? .lost : .outOfPlank))
            endAttempt()
        }
        s.phase = .paused
        s.pauseReason = reason
        s.resumeSince = nil
        s.outOfPlankSince = nil
        s.headDropSince = nil
        if reason == .lost {
            // The old smoothing state is stale by the time the user is back.
            depthFilter.reset()
            s.lastRawAccepted = nil
            s.lastRawT = nil
            s.jumpHeldFrames = 0
        }
        events.append(.paused(t: t, reason: reason))
    }

    private func stepPaused(
        _ t: Double,
        _ gateHint: CounterHint?,
        _ d: Double?,
        _ events: inout [CounterEvent]
    ) -> CounterHint? {
        // The plank gate (shape and size in frame) plus the depth prove the user
        // is back in a plank. The shoulder-width ratio is deliberately NOT
        // required: someone who walked off and came back 40 cm further from the
        // phone has shoulders ~25 % smaller than at calibration, and demanding the
        // old ratio left them stuck on "back to plank" forever. The width
        // reference is re-anchored on resume instead (below). heightRatio is a
        // ratio of two image lengths, so it barely changes with distance.
        let inPlankRange = d != nil && d! >= 1 - cfg.outOfPlankRatio
        // After leaving the plank, also require being back near the top before resuming.
        let nearTop = s.pauseReason == .lost || (d != nil && abs(d!) < RESUME_MAX_DEPTH)
        let resumable = gateHint == nil && inPlankRange && nearTop

        if resumable {
            if s.resumeSince == nil { s.resumeSince = t }
            if t - s.resumeSince! >= cfg.resumeAfterMs {
                s.phase = .counting
                s.pauseReason = nil
                s.motion = .up
                // Require a return to the top before the next rep can start, so a
                // user who comes back mid-push-up doesn't get a half rep counted.
                s.awaitingTop = true
                s.leftTopAt = nil
                s.localTop = nil
                s.resumeSince = nil
                s.stillAnchor = nil
                // Measure "rocked back" against where the user is NOW, not where they
                // were before the pause (they may have come back closer or further).
                if let swEma = s.swEma { s.swTop = swEma }
                events.append(.resumed(t: t))
                return nil
            }
        } else {
            s.resumeSince = nil
        }

        if gateHint == .getInFrame || gateHint == .handsInView || gateHint == .moveCloser || gateHint == .moveBack {
            return gateHint
        }
        return resumable ? nil : .backToPlank
    }
}
