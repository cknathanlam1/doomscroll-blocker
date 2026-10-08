import Foundation
import Vision

// Port of web-prototype/src/platform/mediapipeMapping.ts, for Apple Vision.
//
// Vision points are normalized with the origin at the BOTTOM-left, in an
// upright image:  y_core = 1 − y_vision,  x_core = x_vision × aspect.
// The capture connection must deliver upright, UNMIRRORED buffers (see
// PoseCamera), so the core sees the same image the web prototype saw.

/// One Vision joint before conversion: normalized, origin bottom-left, confidence 0…1.
struct VisionPoint {
    var x: Double
    var y: Double
    var confidence: Double
}

enum VisionMapping {
    /// The joints the core uses, and the Vision joint that feeds each one.
    static let visionJointNames: [(JointName, VNHumanBodyPoseObservation.JointName)] = [
        (.nose, .nose),
        (.leftShoulder, .leftShoulder),
        (.rightShoulder, .rightShoulder),
        (.leftElbow, .leftElbow),
        (.rightElbow, .rightElbow),
        (.leftWrist, .leftWrist),
        (.rightWrist, .rightWrist),
        (.leftHip, .leftHip),
        (.rightHip, .rightHip),
    ]

    /// Pure conversion (no Vision types), so it can be unit-tested.
    /// - points: nil = nobody detected in this frame.
    static func toPoseFrame(points: [JointName: VisionPoint]?, aspect: Double, tMs: Double) -> PoseFrame {
        let safeAspect = aspect.isFinite && aspect > 0 ? aspect : 1
        guard let points, !points.isEmpty else {
            return PoseFrame(t: tMs, aspect: safeAspect, joints: nil, world: nil)
        }
        var joints = Joints2D()
        for name in JointName.allCases {
            guard let p = points[name], p.x.isFinite, p.y.isFinite else { continue }
            // Apple Vision reports joints outside the image as confidence 0, and the
            // core must behave the same as with MediaPipe (which still guesses them).
            let inside = p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
            let confidence = p.confidence.isFinite ? min(1, max(0, p.confidence)) : 0
            joints[name] = Joint2D(x: p.x * safeAspect, y: 1 - p.y, c: inside ? confidence : 0)
        }
        return PoseFrame(t: tMs, aspect: safeAspect, joints: joints, world: nil)
    }

    static func toPoseFrame(observation: VNHumanBodyPoseObservation?, aspect: Double, tMs: Double) -> PoseFrame {
        guard let observation else { return toPoseFrame(points: nil, aspect: aspect, tMs: tMs) }
        var points: [JointName: VisionPoint] = [:]
        for (name, visionName) in visionJointNames {
            // recognizedPoint throws when the joint was not recognized at all.
            guard let p = try? observation.recognizedPoint(visionName) else { continue }
            points[name] = VisionPoint(x: Double(p.location.x), y: Double(p.location.y), confidence: Double(p.confidence))
        }
        return toPoseFrame(points: points, aspect: aspect, tMs: tMs)
    }
}

extension CounterConfig {
    /// The web tuned visibilityThreshold 0.5 / wristVisibilityThreshold 0.4 on MediaPipe
    /// `visibility`. Vision confidences are lower for the same joint, so start around
    /// 0.3 / 0.25 and tune from recordings (CLAUDE.md §5, milestone M5).
    static var visionDefault: CounterConfig {
        var c = DEFAULT_CONFIG
        c.visibilityThreshold = 0.3
        c.wristVisibilityThreshold = 0.25
        return c
    }
}
