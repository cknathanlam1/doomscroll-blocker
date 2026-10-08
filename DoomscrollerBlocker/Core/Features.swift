import Foundation

// Port of web-prototype/src/core/features.ts.

/// Shoulders must sit at least this far (image-height units) inside every
/// edge of the frame to count as visible. Detectors keep "guessing" joints
/// that are just outside the image, often with high confidence, so a joint
/// hugging the border is not trusted.
private let FRAME_MARGIN = 0.02

/// A visible wrist may sit at most this many shoulder widths outside the outer shoulder edges.
private let WRIST_SPAN_SHOULDER_WIDTHS = 0.75

/// A point for angle maths. `z` is 0 for 2D points (a missing z is treated as 0).
struct AnglePoint {
    var x: Double
    var y: Double
    var z: Double = 0
}

/// Angle ABC in degrees (0..180) at vertex B. Works in 2D, or in 3D when
/// every point has a `z` (a missing z is treated as 0). Returns NaN when A or
/// C sits exactly on B, because the angle is undefined there.
func angleDeg(_ a: AnglePoint, _ b: AnglePoint, _ c: AnglePoint) -> Double {
    let bax = a.x - b.x
    let bay = a.y - b.y
    let baz = a.z - b.z
    let bcx = c.x - b.x
    let bcy = c.y - b.y
    let bcz = c.z - b.z
    let lenBA = (bax * bax + bay * bay + baz * baz).squareRoot()
    let lenBC = (bcx * bcx + bcy * bcy + bcz * bcz).squareRoot()
    if lenBA == 0 || lenBC == 0 { return Double.nan }
    let cosine = (bax * bcx + bay * bcy + baz * bcz) / (lenBA * lenBC)
    // Rounding can push cos a hair outside [-1, 1], which would make acos NaN.
    return acos(min(1, max(-1, cosine))) * 180 / Double.pi
}

/// Returns the joint only if all of its numbers are usable (adapters can emit NaN).
private func usable(_ joints: Joints2D?, _ name: JointName) -> Joint2D? {
    guard let j = joints?[name], j.x.isFinite, j.y.isFinite, j.c.isFinite else { return nil }
    return j
}

/// Confidence of a joint, 0 when it is missing.
private func conf(_ j: Joint2D?) -> Double {
    j?.c ?? 0
}

private func insideMargin(_ j: Joint2D, _ aspect: Double) -> Bool {
    j.x >= FRAME_MARGIN && j.x <= aspect - FRAME_MARGIN && j.y >= FRAME_MARGIN && j.y <= 1 - FRAME_MARGIN
}

/// Mean elbow angle over the sides where shoulder, elbow and wrist are all confident.
private func meanElbowAngle(_ sides: [(ok: Bool, s: AnglePoint?, e: AnglePoint?, w: AnglePoint?)]) -> Double? {
    var sum = 0.0
    var n = 0
    for side in sides {
        guard side.ok, let s = side.s, let e = side.e, let w = side.w else { continue }
        let angle = angleDeg(s, e, w)
        if !angle.isFinite { continue }
        sum += angle
        n += 1
    }
    return n > 0 ? sum / Double(n) : nil
}

private func point(_ j: Joint2D?) -> AnglePoint? {
    j.map { AnglePoint(x: $0.x, y: $0.y) }
}

private func point(_ j: Joint3D?) -> AnglePoint? {
    j.map { AnglePoint(x: $0.x, y: $0.y, z: $0.z) }
}

/// Derives geometric features from one frame. Pure.
///
/// - visibilityThreshold: confidence needed for shoulders, elbows and the nose.
/// - wristVisibilityThreshold: confidence needed for wrists (defaults to
///   `visibilityThreshold`). Wrists get their own threshold because they sit
///   low in a floor-level frame and the detector is less sure about them.
func computeFeatures(
    _ frame: PoseFrame,
    _ visibilityThreshold: Double,
    _ wristVisibilityThreshold: Double? = nil
) -> Features {
    let wristVisibilityThreshold = wristVisibilityThreshold ?? visibilityThreshold
    let joints = frame.joints
    let aspect = frame.aspect

    let nose = usable(joints, .nose)
    let ls = usable(joints, .leftShoulder)
    let rs = usable(joints, .rightShoulder)
    let le = usable(joints, .leftElbow)
    let re = usable(joints, .rightElbow)
    let lw = usable(joints, .leftWrist)
    let rw = usable(joints, .rightWrist)

    let shoulderConfidence = min(conf(ls), conf(rs))
    let upperBodyConfidence = min(shoulderConfidence, conf(le), conf(re), conf(lw), conf(rw))

    // Both shoulders confident → we trust their positions for geometry.
    let shouldersConfident = ls != nil && rs != nil && shoulderConfidence >= visibilityThreshold
    var shouldersVisible = false
    if shouldersConfident, let ls, let rs {
        shouldersVisible = insideMargin(ls, aspect) && insideMargin(rs, aspect)
    }

    var shoulderMid: Point2?
    var shoulderWidth: Double?
    var shoulderWidthFrac: Double?
    var shoulderTiltDeg: Double?
    if shouldersConfident, let ls, let rs {
        // Confidence-weighted so a shakier shoulder pulls the midpoint less. (With
        // a visibility threshold of 0 both weights can be 0: use the plain mean
        // then instead of dividing by zero.)
        let wSum = ls.c + rs.c
        let wl = wSum > 0 ? ls.c / wSum : 0.5
        let wr = wSum > 0 ? rs.c / wSum : 0.5
        shoulderMid = Point2(x: ls.x * wl + rs.x * wr, y: ls.y * wl + rs.y * wr)
        let dx = rs.x - ls.x
        let dy = rs.y - ls.y
        let width = (dx * dx + dy * dy).squareRoot()
        shoulderWidth = width
        // x is in image-height units, so the frame is `aspect` wide.
        shoulderWidthFrac = aspect > 0 ? width / aspect : nil
        // Unsigned: tilting either way counts the same (and mirroring can't flip it).
        shoulderTiltDeg = atan2(abs(dy), abs(dx)) * 180 / Double.pi
    }

    let visibleWristList = [lw, rw].compactMap { $0 }.filter { $0.c >= wristVisibilityThreshold }
    let visibleWrists = visibleWristList.count
    var wristMid: Point2?
    if visibleWrists > 0 {
        var sx = 0.0
        var sy = 0.0
        for w in visibleWristList {
            sx += w.x
            sy += w.y
        }
        wristMid = Point2(x: sx / Double(visibleWrists), y: sy / Double(visibleWrists))
    }

    let noseVisible = nose != nil && nose!.c >= visibilityThreshold

    var heightRatio: Double?
    if shouldersVisible, let shoulderMid, let wristMid, let shoulderWidth, shoulderWidth > 1e-6 {
        heightRatio = (wristMid.y - shoulderMid.y) / shoulderWidth
    }

    // Hands must be roughly under the shoulders (not way off to one side, which
    // usually means a mis-detected wrist or a person not in push-up position).
    var wristsInSpan = false
    if let shoulderWidth, let ls, let rs {
        let lo = min(ls.x, rs.x) - WRIST_SPAN_SHOULDER_WIDTHS * shoulderWidth
        let hi = max(ls.x, rs.x) + WRIST_SPAN_SHOULDER_WIDTHS * shoulderWidth
        wristsInSpan = visibleWristList.allSatisfy { $0.x >= lo && $0.x <= hi }
    }

    let leftArmOk = conf(ls) >= visibilityThreshold && conf(le) >= visibilityThreshold && conf(lw) >= wristVisibilityThreshold
    let rightArmOk = conf(rs) >= visibilityThreshold && conf(re) >= visibilityThreshold && conf(rw) >= wristVisibilityThreshold

    let elbowAngle2D = meanElbowAngle([
        (leftArmOk, point(ls), point(le), point(lw)),
        (rightArmOk, point(rs), point(re), point(rw)),
    ])

    // World joints carry no confidence of their own, so reuse the 2D confidences.
    var elbowAngle3D: Double?
    if let world = frame.world {
        elbowAngle3D = meanElbowAngle([
            (leftArmOk, point(world[.leftShoulder]), point(world[.leftElbow]), point(world[.leftWrist])),
            (rightArmOk, point(world[.rightShoulder]), point(world[.rightElbow]), point(world[.rightWrist])),
        ])
    }

    return Features(
        t: frame.t,
        present: joints != nil,
        shouldersVisible: shouldersVisible,
        noseVisible: noseVisible,
        visibleWrists: visibleWrists,
        shoulderConfidence: shoulderConfidence,
        upperBodyConfidence: upperBodyConfidence,
        shoulderMid: shoulderMid,
        wristMid: wristMid,
        nose: noseVisible && nose != nil ? Point2(x: nose!.x, y: nose!.y) : nil,
        shoulderWidth: shoulderWidth,
        shoulderWidthFrac: shoulderWidthFrac,
        shoulderTiltDeg: shoulderTiltDeg,
        heightRatio: heightRatio,
        wristsInSpan: wristsInSpan,
        elbowAngle2D: elbowAngle2D,
        elbowAngle3D: elbowAngle3D
    )
}
