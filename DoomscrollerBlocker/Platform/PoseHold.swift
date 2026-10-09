import Foundation

/// Vision-specific bridge for the bottom of a push-up (adapter, NOT core).
///
/// From a phone on the floor, the face is a few centimetres from the lens at the bottom of a
/// rep and Apple Vision degrades. Recorded on a real iPhone, in three ways:
///   1. a shoulder drops to confidence 0.1–0.3 and some joints come back as 0;
///   2. no body at all for ~1 s;
///   3. a degenerate skeleton with HIGH confidence: both shoulders on the same point
///      (shoulder width 0.22 → 0.01 image heights) for ~1.5 s.
/// MediaPipe tracks through all of that; Vision is per-frame. Without help the counter sees the
/// user vanish or leave the plank, pauses, and cancels a perfectly good rep.
///
/// While a rep is in progress, a joint that is missing or weak (confidence < `weakBelow`) is
/// replaced by its last good value (confidence ≥ `goodAt`), and a frame whose shoulder width
/// collapsed (or exploded) against the last good one is dropped entirely for the last good
/// pose. Both last at most `holdMs`. Outside a rep nothing is held, so walking away still
/// pauses the set.
struct PoseHold {
    var holdMs = 2500.0
    var weakBelow = 0.2
    var goodAt = 0.3
    /// A frame whose shoulder width is outside [minWidthRatio, maxWidthRatio] × the last good one is garbage.
    var minWidthRatio = 0.5
    var maxWidthRatio = 2.0

    private var lastGood: [JointName: (joint: Joint2D, t: Double)] = [:]
    private var goodWidth: Double?

    private func shoulderWidth(_ joints: Joints2D?, minConfidence: Double) -> Double? {
        guard let l = joints?[.leftShoulder], let r = joints?[.rightShoulder],
              l.c >= minConfidence, r.c >= minConfidence else { return nil }
        return ((l.x - r.x) * (l.x - r.x) + (l.y - r.y) * (l.y - r.y)).squareRoot()
    }

    private func isPlausible(_ width: Double) -> Bool {
        guard let good = goodWidth else { return true }
        return width >= good * minWidthRatio && width <= good * maxWidthRatio
    }

    private func fillFromLastGood(_ joints: inout Joints2D, at t: Double, all: Bool) -> Bool {
        var changed = false
        for (name, held) in lastGood where t - held.t <= holdMs {
            if !all, let current = joints[name], current.c >= weakBelow { continue }
            joints[name] = held.joint
            changed = true
        }
        return changed
    }

    /// - counting: the counter is in the `counting` phase (a set in progress, not paused).
    /// - midAttempt: and the user is going down / at the bottom of a rep.
    ///
    /// A collapsed skeleton is held whenever `counting` (it starts right at the beginning of the
    /// descent, before the counter has called it an attempt); missing or weak joints only
    /// `midAttempt`, so someone who steps away at the top still pauses after 0.5 s.
    mutating func apply(_ frame: PoseFrame, counting: Bool, midAttempt: Bool) -> PoseFrame {
        // Remember only frames with BOTH shoulders confident and a believable width, so a
        // degenerate skeleton can never become the pose we fall back to.
        let rawWidth = shoulderWidth(frame.joints, minConfidence: goodAt)
        let rawPlausible = rawWidth.map(isPlausible) ?? false
        if rawPlausible, let w = rawWidth {
            goodWidth = goodWidth.map { $0 + 0.2 * (w - $0) } ?? w
            for (name, joint) in frame.joints?.values ?? [:] where joint.c >= goodAt {
                lastGood[name] = (joint, frame.t)
            }
        }
        guard counting else { return frame }

        // 1. Weak or missing joints → their last good value (only mid-rep).
        var joints = frame.joints ?? Joints2D()
        var changed = midAttempt && fillFromLastGood(&joints, at: frame.t, all: false)
        // 2. Shoulders that collapsed (or exploded) → the whole last good pose.
        if !rawPlausible, let w = shoulderWidth(joints, minConfidence: weakBelow), !isPlausible(w) {
            joints = Joints2D()
            changed = fillFromLastGood(&joints, at: frame.t, all: true)
        }
        guard changed else { return frame }
        return PoseFrame(t: frame.t, aspect: frame.aspect, joints: joints, world: nil)
    }

    mutating func reset() {
        lastGood = [:]
        goodWidth = nil
    }
}
