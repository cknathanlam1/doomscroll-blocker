import Foundation

// Port of web-prototype/src/core/types.ts.
//
// Core, platform-neutral types for push-up detection.
//
// Everything in Core/ is pure Swift (no UIKit, AVFoundation or Vision) so the
// algorithm runs in unit tests and stays identical to the web version.
// Adapters (Platform/) convert detector output into these types.

/// The joints the algorithm is allowed to use. All of them exist in both
/// MediaPipe Pose (33 landmarks) and Apple Vision VNDetectHumanBodyPoseRequest
/// (19 joints), so the port needs no new signals.
///
/// "left"/"right" are from the PERSON's point of view (anatomical), not the
/// image's, matching both MediaPipe and Vision. The algorithm must not depend
/// on which side is which (a mirrored video file swaps them).
enum JointName: String, CaseIterable, Codable, Hashable {
    case nose
    case leftShoulder
    case rightShoulder
    case leftElbow
    case rightElbow
    case leftWrist
    case rightWrist
    case leftHip
    case rightHip
}

let JOINT_NAMES: [JointName] = JointName.allCases

/// A 2D joint in an isotropic, y-DOWN image frame where BOTH axes are measured
/// in units of the image HEIGHT: x ∈ [0, aspect], y ∈ [0, 1] (origin top-left
/// of the UNMIRRORED camera image). Using height units for both axes means
/// Euclidean distances are meaningful regardless of the aspect ratio.
///
/// `c` is the detector's confidence that the joint is visible, 0..1
/// (MediaPipe `visibility`, Vision `confidence`). Adapters set c = 0 for
/// joints that fall outside the image.
struct Joint2D: Codable, Equatable {
    var x: Double
    var y: Double
    var c: Double
}

/// Optional metric 3D joint (metres, y-down, hip-centred; MediaPipe worldLandmarks).
struct Joint3D: Codable, Equatable {
    var x: Double
    var y: Double
    var z: Double
}

/// Any joint may be missing. Decoding ignores joint names it doesn't know.
struct Joints<J: Codable & Equatable>: Codable, Equatable {
    var values: [JointName: J] = [:]

    init(_ values: [JointName: J] = [:]) { self.values = values }

    subscript(name: JointName) -> J? {
        get { values[name] }
        set { values[name] = newValue }
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        for name in JointName.allCases {
            if let key = Key(stringValue: name.rawValue), let j = try c.decodeIfPresent(J.self, forKey: key) {
                values[name] = j
            }
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        for name in JointName.allCases {
            if let j = values[name], let key = Key(stringValue: name.rawValue) {
                try c.encode(j, forKey: key)
            }
        }
    }
}

typealias Joints2D = Joints<Joint2D>
typealias Joints3D = Joints<Joint3D>

/// One processed camera frame, as delivered to the core algorithm.
struct PoseFrame: Equatable {
    /// Timestamp in milliseconds. Strictly increasing within a session.
    var t: Double
    /// Source image width / height.
    var aspect: Double
    /// Detected joints, or nil when no person was detected in this frame.
    var joints: Joints2D?
    /// Optional 3D joints (only used for diagnostics / secondary signals).
    var world: Joints3D?
}

extension PoseFrame: Codable {
    private enum CodingKeys: String, CodingKey { case t, aspect, joints, world }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        t = try c.decode(Double.self, forKey: .t)
        aspect = try c.decode(Double.self, forKey: .aspect)
        joints = try c.decodeIfPresent(Joints2D.self, forKey: .joints)
        world = try c.decodeIfPresent(Joints3D.self, forKey: .world)
    }
}

struct Point2: Equatable {
    var x: Double
    var y: Double
}

/// Per-frame geometric features derived from a PoseFrame (see Features.swift).
/// Instantaneous (unsmoothed). All lengths are in image-height units.
struct Features {
    var t: Double
    /// A person was detected at all.
    var present: Bool
    /// Both shoulders have confidence ≥ the visibility threshold and lie inside the frame margin.
    var shouldersVisible: Bool
    /// Nose confidence ≥ the visibility threshold.
    var noseVisible: Bool
    /// Number of wrists with confidence ≥ the wrist visibility threshold (0, 1 or 2).
    var visibleWrists: Int
    /// Minimum confidence over the two shoulders (0 if absent).
    var shoulderConfidence: Double
    /// Minimum confidence over shoulders + elbows + wrists (0 if absent). For lighting heuristics.
    var upperBodyConfidence: Double
    /// Confidence-weighted midpoint of the shoulders.
    var shoulderMid: Point2?
    /// Mean of the visible wrists.
    var wristMid: Point2?
    var nose: Point2?
    /// Distance between the shoulders.
    var shoulderWidth: Double?
    /// shoulderWidth as a fraction of the frame WIDTH (used for "move closer / back").
    var shoulderWidthFrac: Double?
    /// Angle of the shoulder line from horizontal, degrees (0 = level).
    var shoulderTiltDeg: Double?
    /// (wristMid.y - shoulderMid.y) / shoulderWidth, using THIS frame's values.
    /// Large at the TOP of a push-up (≈1.4–1.6 for a floor-level front camera),
    /// shrinking toward 0 as the shoulders drop to hand level.
    /// Nil unless shoulders and at least one wrist are visible.
    var heightRatio: Double?
    /// Every visible wrist lies within 0.75 × shoulderWidth of the outer shoulder edges.
    var wristsInSpan: Bool
    /// Mean 2D elbow angle in degrees over confident sides (180 = straight). Diagnostic only.
    var elbowAngle2D: Double?
    /// Mean 3D elbow angle in degrees from world joints, if available. Diagnostic only.
    var elbowAngle3D: Double?
}

struct SmoothingConfig: Codable, Equatable {
    /// One Euro filter minimum cutoff frequency (Hz). Lower = smoother, more lag.
    var minCutoff: Double
    /// One Euro filter speed coefficient. Higher = less lag on fast motion.
    var beta: Double
    /// Cutoff (Hz) for the derivative low-pass.
    var dCutoff: Double
}

/// "Is this a plausible plank seen from a phone on the floor?" Must pass to
/// calibrate (and to resume after an out-of-plank pause). Standing, sitting or
/// kneeling upright 1 m from a floor phone puts the shoulders out of frame, so
/// the gate fails naturally.
struct PlankGateConfig: Codable, Equatable {
    /// shoulderWidth / frame width must be in [min, max]; outside → "move closer"/"move back".
    var minShoulderWidthFrac: Double
    var maxShoulderWidthFrac: Double
    /// Max shoulder-line tilt from horizontal (deg).
    var maxShoulderTiltDeg: Double
    /// heightRatio must be in [min, max].
    var minHeightRatio: Double
    var maxHeightRatio: Double
}

struct CounterConfig: Equatable {
    /// Reps needed to complete the set.
    var targetReps: Int

    // --- Depth thresholds. depth d = 1 - h / hTop, where h = heightRatio
    // (smoothed) and hTop = the calibrated value at the top of the push-up.
    // Geometry (simulated, floor-level front camera): d ≈ 0.14–0.17 at a 120°
    // elbow, 0.25–0.29 at 100°, 0.32–0.39 at 90°.

    /// d at or beyond which a rep is deep enough ("about 90°" with some leniency).
    var downThreshold: Double
    /// d at or below which the user is back at the top (lockout).
    var upThreshold: Double
    /// d beyond which a descent becomes a rep ATTEMPT. An attempt that never
    /// reaches downThreshold is a partial rep ("Go lower").
    /// Must satisfy upThreshold < partialMinDepth < downThreshold.
    var partialMinDepth: Double
    /// If d falls this far below the attempt's peak before reaching depth, the user turned back early → live "Go lower".
    var turnBackMargin: Double
    /// How far back up counts as "back up". A rep is counted once d falls to
    /// max(upThreshold, returnFraction × the rep's peak depth), capped at
    /// partialMinDepth: 0.3 means "70 % of the way back up from your deepest
    /// point", but always back above the line where an attempt starts. Tired
    /// users stop a little short of their calibrated plank; a fixed upThreshold
    /// alone merged their reps together. (An attempt also ends once d is back
    /// within 0.04 of where it started, see RepCounter.swift.)
    var returnFraction: Double

    // --- Timing (all in ms, never frame counts — frame rate varies on iPhone).

    /// d must stay ≥ downThreshold this long to register the bottom.
    var minBottomMs: Double
    /// Minimum time from leaving the top to returning, for a valid rep.
    var minRepMs: Double
    /// An attempt longer than this is cancelled (no rep, no partial).
    var maxRepMs: Double

    // --- Visibility.

    /// Confidence needed for shoulders / nose / elbows to count as visible.
    var visibilityThreshold: Double
    /// Confidence needed for a wrist to count as visible.
    var wristVisibilityThreshold: Double
    /// Body missing for this long while counting → pause (and cancel any rep in progress).
    var lostAfterMs: Double
    /// Body back for this long while paused → resume.
    var resumeAfterMs: Double

    // --- Calibration (during the 3-2-1 countdown).

    /// Stable plank needed before the countdown starts.
    var calibrationHoldMs: Double
    /// Length of the 3-2-1 countdown.
    var countdownMs: Double
    /// hTop = median heightRatio over the last this-many ms of the countdown.
    var calibrationWindowMs: Double
    /// Max standard deviation of heightRatio in that window; above it the countdown restarts.
    var calibrationMaxStd: Double
    var plankGate: PlankGateConfig

    // --- Robustness.

    /// Smoothing applied to the depth signal d.
    var smoothing: SmoothingConfig
    /// Time constant (ms) of the EMA on shoulder width.
    var shoulderWidthTauMs: Double
    /// Time constant (ms) of the EMA on the wrist reference (updated only at the top, frozen during a rep).
    var wristTauMs: Double
    /// Single-frame jumps in raw d larger than this are held for up to 3 frames.
    var maxJump: Double
    /// Rate at which hTop follows the user while resting still at the top (0 disables).
    var baselineAdaptRate: Double
    /// hTop may drift at most this fraction from its calibrated value.
    var baselineMaxDrift: Double
    /// A valid rep keeps shoulderWidth / shoulderWidthAtTop within [min, max] (rejects rocking back).
    var minShoulderWidthRatio: Double
    var maxShoulderWidthRatio: Double
    /// h above this multiple of hTop (user rose up / left the plank) → pause until back in plank.
    var outOfPlankRatio: Double
    /// Nose dropping more than this × shoulderWidth while d stays tiny → "chest, not head" hint.
    var headOnlyDropRatio: Double
}

// Recordings made by older web builds may lack newer keys: like the web's
// `new RepCounter(rec.config)`, missing keys fall back to DEFAULT_CONFIG.
extension CounterConfig: Codable {
    private enum CodingKeys: String, CodingKey {
        case targetReps, downThreshold, upThreshold, partialMinDepth, turnBackMargin, returnFraction
        case minBottomMs, minRepMs, maxRepMs
        case visibilityThreshold, wristVisibilityThreshold, lostAfterMs, resumeAfterMs
        case calibrationHoldMs, countdownMs, calibrationWindowMs, calibrationMaxStd, plankGate
        case smoothing, shoulderWidthTauMs, wristTauMs, maxJump, baselineAdaptRate, baselineMaxDrift
        case minShoulderWidthRatio, maxShoulderWidthRatio, outOfPlankRatio, headOnlyDropRatio
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = DEFAULT_CONFIG
        targetReps = try c.decodeIfPresent(Int.self, forKey: .targetReps) ?? d.targetReps
        downThreshold = try c.decodeIfPresent(Double.self, forKey: .downThreshold) ?? d.downThreshold
        upThreshold = try c.decodeIfPresent(Double.self, forKey: .upThreshold) ?? d.upThreshold
        partialMinDepth = try c.decodeIfPresent(Double.self, forKey: .partialMinDepth) ?? d.partialMinDepth
        turnBackMargin = try c.decodeIfPresent(Double.self, forKey: .turnBackMargin) ?? d.turnBackMargin
        returnFraction = try c.decodeIfPresent(Double.self, forKey: .returnFraction) ?? d.returnFraction
        minBottomMs = try c.decodeIfPresent(Double.self, forKey: .minBottomMs) ?? d.minBottomMs
        minRepMs = try c.decodeIfPresent(Double.self, forKey: .minRepMs) ?? d.minRepMs
        maxRepMs = try c.decodeIfPresent(Double.self, forKey: .maxRepMs) ?? d.maxRepMs
        visibilityThreshold = try c.decodeIfPresent(Double.self, forKey: .visibilityThreshold) ?? d.visibilityThreshold
        wristVisibilityThreshold = try c.decodeIfPresent(Double.self, forKey: .wristVisibilityThreshold) ?? d.wristVisibilityThreshold
        lostAfterMs = try c.decodeIfPresent(Double.self, forKey: .lostAfterMs) ?? d.lostAfterMs
        resumeAfterMs = try c.decodeIfPresent(Double.self, forKey: .resumeAfterMs) ?? d.resumeAfterMs
        calibrationHoldMs = try c.decodeIfPresent(Double.self, forKey: .calibrationHoldMs) ?? d.calibrationHoldMs
        countdownMs = try c.decodeIfPresent(Double.self, forKey: .countdownMs) ?? d.countdownMs
        calibrationWindowMs = try c.decodeIfPresent(Double.self, forKey: .calibrationWindowMs) ?? d.calibrationWindowMs
        calibrationMaxStd = try c.decodeIfPresent(Double.self, forKey: .calibrationMaxStd) ?? d.calibrationMaxStd
        plankGate = try c.decodeIfPresent(PlankGateConfig.self, forKey: .plankGate) ?? d.plankGate
        smoothing = try c.decodeIfPresent(SmoothingConfig.self, forKey: .smoothing) ?? d.smoothing
        shoulderWidthTauMs = try c.decodeIfPresent(Double.self, forKey: .shoulderWidthTauMs) ?? d.shoulderWidthTauMs
        wristTauMs = try c.decodeIfPresent(Double.self, forKey: .wristTauMs) ?? d.wristTauMs
        maxJump = try c.decodeIfPresent(Double.self, forKey: .maxJump) ?? d.maxJump
        baselineAdaptRate = try c.decodeIfPresent(Double.self, forKey: .baselineAdaptRate) ?? d.baselineAdaptRate
        baselineMaxDrift = try c.decodeIfPresent(Double.self, forKey: .baselineMaxDrift) ?? d.baselineMaxDrift
        minShoulderWidthRatio = try c.decodeIfPresent(Double.self, forKey: .minShoulderWidthRatio) ?? d.minShoulderWidthRatio
        maxShoulderWidthRatio = try c.decodeIfPresent(Double.self, forKey: .maxShoulderWidthRatio) ?? d.maxShoulderWidthRatio
        outOfPlankRatio = try c.decodeIfPresent(Double.self, forKey: .outOfPlankRatio) ?? d.outOfPlankRatio
        headOnlyDropRatio = try c.decodeIfPresent(Double.self, forKey: .headOnlyDropRatio) ?? d.headOnlyDropRatio
    }
}

/// Lifecycle of one set.
/// - waiting:   looking for the user in a plank (Placement screen)
/// - countdown: user is in frame and holding a plank; 3-2-1 running, the top
///              baseline is being measured
/// - counting:  set in progress
/// - paused:    set in progress but the body was lost or left the plank (count is kept)
/// - complete:  target reached
enum CounterPhase: String, Codable {
    case waiting, countdown, counting, paused, complete
}

/// Where the user is within a rep (only meaningful while counting).
enum MotionPhase: String, Codable {
    case up, descending, down
}

/// A short instruction the UI should show (one at a time; highest priority wins).
enum CounterHint: String, Codable {
    case getInFrame // no body / shoulders not visible
    case handsInView // shoulders fine but no wrist visible
    case moveCloser // shoulder width too small in frame
    case moveBack // shoulder width too large in frame
    case holdStill // in plank but still moving; countdown can't start / restarted
    case backToPlank // paused because the user left the plank mid-set
    case chestNotHead // head dipping without the chest going down
}

enum PauseReason: String, Codable {
    case lost, outOfPlank
}

enum CancelReason: String, Codable {
    case lost, outOfPlank, tooSlow, rockedBack
}

enum DepthSource: String, Codable {
    case wrists, shoulders
}

enum CounterEvent: Equatable {
    case inFrame(t: Double)
    case countdownTick(t: Double, secondsLeft: Int)
    case countdownCancelled(t: Double)
    case start(t: Double, baselineRatio: Double)
    case depthReached(t: Double)
    case rep(t: Double, count: Int, durationMs: Double, peakDepth: Double)
    /// live = emitted when the user turned back early (before returning to the top). At most one per attempt.
    case partial(t: Double, peakDepth: Double, live: Bool)
    case repCancelled(t: Double, reason: CancelReason)
    case paused(t: Double, reason: PauseReason)
    case resumed(t: Double)
    case complete(t: Double, count: Int, elapsedMs: Double)

    var t: Double {
        switch self {
        case .inFrame(let t), .countdownTick(let t, _), .countdownCancelled(let t), .start(let t, _),
             .depthReached(let t), .rep(let t, _, _, _), .partial(let t, _, _), .repCancelled(let t, _),
             .paused(let t, _), .resumed(let t), .complete(let t, _, _):
            return t
        }
    }

    /// The `type` string used in the JSON files (same as the web).
    var type: String {
        switch self {
        case .inFrame: return "inFrame"
        case .countdownTick: return "countdownTick"
        case .countdownCancelled: return "countdownCancelled"
        case .start: return "start"
        case .depthReached: return "depthReached"
        case .rep: return "rep"
        case .partial: return "partial"
        case .repCancelled: return "repCancelled"
        case .paused: return "paused"
        case .resumed: return "resumed"
        case .complete: return "complete"
        }
    }
}

extension CounterEvent: Codable {
    private enum CodingKeys: String, CodingKey {
        case type, t, secondsLeft, baselineRatio, count, durationMs, peakDepth, live, reason, elapsedMs
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        let t = try c.decode(Double.self, forKey: .t)
        switch type {
        case "inFrame": self = .inFrame(t: t)
        case "countdownTick": self = .countdownTick(t: t, secondsLeft: try c.decode(Int.self, forKey: .secondsLeft))
        case "countdownCancelled": self = .countdownCancelled(t: t)
        case "start": self = .start(t: t, baselineRatio: try c.decode(Double.self, forKey: .baselineRatio))
        case "depthReached": self = .depthReached(t: t)
        case "rep":
            self = .rep(
                t: t,
                count: try c.decode(Int.self, forKey: .count),
                durationMs: try c.decode(Double.self, forKey: .durationMs),
                peakDepth: try c.decode(Double.self, forKey: .peakDepth)
            )
        case "partial":
            self = .partial(
                t: t,
                peakDepth: try c.decode(Double.self, forKey: .peakDepth),
                live: try c.decode(Bool.self, forKey: .live)
            )
        case "repCancelled": self = .repCancelled(t: t, reason: try c.decode(CancelReason.self, forKey: .reason))
        case "paused": self = .paused(t: t, reason: try c.decode(PauseReason.self, forKey: .reason))
        case "resumed": self = .resumed(t: t)
        case "complete":
            self = .complete(
                t: t,
                count: try c.decode(Int.self, forKey: .count),
                elapsedMs: try c.decode(Double.self, forKey: .elapsedMs)
            )
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown event type \(type)")
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(type, forKey: .type)
        try c.encode(t, forKey: .t)
        switch self {
        case .countdownTick(_, let secondsLeft): try c.encode(secondsLeft, forKey: .secondsLeft)
        case .start(_, let baselineRatio): try c.encode(baselineRatio, forKey: .baselineRatio)
        case .rep(_, let count, let durationMs, let peakDepth):
            try c.encode(count, forKey: .count)
            try c.encode(durationMs, forKey: .durationMs)
            try c.encode(peakDepth, forKey: .peakDepth)
        case .partial(_, let peakDepth, let live):
            try c.encode(peakDepth, forKey: .peakDepth)
            try c.encode(live, forKey: .live)
        case .repCancelled(_, let reason): try c.encode(reason, forKey: .reason)
        case .paused(_, let reason): try c.encode(reason, forKey: .reason)
        case .complete(_, let count, let elapsedMs):
            try c.encode(count, forKey: .count)
            try c.encode(elapsedMs, forKey: .elapsedMs)
        case .inFrame, .countdownCancelled, .depthReached, .resumed:
            break
        }
    }
}

/// Result of feeding one frame to the counter.
struct CounterSnapshot {
    var phase: CounterPhase
    var motion: MotionPhase
    var count: Int
    var target: Int
    /// Smoothed depth, 0 = top, 1 = shoulders at hand level. Nil if unknown.
    var depth: Double?
    /// Unsmoothed depth for diagnostics.
    var rawDepth: Double?
    /// Deepest smoothed depth reached in the current (or most recent) attempt.
    var peakDepth: Double
    /// `.wrists` when a wrist is visible this frame; `.shoulders` when none is, so
    /// depth came from the shoulders alone against the last known hand line
    /// (same formula and scale, just less certain). Nil when depth is nil.
    var depthSource: DepthSource?
    /// Smoothed heightRatio h.
    var heightRatio: Double?
    /// Calibrated (and slowly adapted) heightRatio at the top of the push-up, hTop.
    var baselineRatio: Double?
    /// Smoothed shoulderWidth / shoulderWidth at calibration.
    var shoulderWidthRatio: Double?
    /// Image y (height units, unmirrored, y-down) the shoulder midpoint must
    /// reach for depth = downThreshold, i.e. the "depth line" to draw across the
    /// video. Nil until calibrated.
    var depthLineY: Double?
    /// Remaining countdown time while phase == .countdown.
    var countdownRemainingMs: Double?
    /// The user is currently visible enough to count (debounced).
    var inFrame: Bool
    /// The plank gate passes this frame.
    var plankOk: Bool
    /// Current instruction for the user, or nil.
    var hint: CounterHint?
    /// Timestamp of the 'start' event, or nil before the set starts.
    var startedAt: Double?
    var features: Features
    /// Events emitted by THIS update (empty most frames).
    var events: [CounterEvent]
}

/// What the UI should tell the user when tracking is not working (spec S2 / S3).
enum TrackingIssue: String, Codable {
    case none, notDetected, tooDark
}
