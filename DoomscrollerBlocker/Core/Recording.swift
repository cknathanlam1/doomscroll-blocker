import Foundation

// Port of web-prototype/src/core/recording.ts.
// The JSON is the same format the web writes, so recordings made on the
// phone can be replayed on the laptop (and the other way round).

/// One frame of a recorded session (landmarks only — never video).
struct RecordingFrame: Codable {
    var t: Double
    var aspect: Double
    var joints: Joints2D?
    var world: Joints3D?
    /// Counter output at record time, for comparison when replaying.
    var depth: Double?
    var phase: CounterPhase
    var count: Int
}

/// A downloadable session recording used to tune the algorithm offline.
struct Recording: Codable {
    var version: Int = 1
    var createdAt: String
    var userAgent: String
    var source: String // 'camera' | 'file'
    var model: String
    var delegate: String
    var config: CounterConfig
    var frames: [RecordingFrame]
    var events: [CounterEvent]
}

func recordingFrameToPoseFrame(_ f: RecordingFrame) -> PoseFrame {
    PoseFrame(t: f.t, aspect: f.aspect, joints: f.joints, world: f.world)
}

/// Re-runs a recording through a fresh RepCounter with the given config and
/// returns every snapshot. Used by tests and for offline tuning.
func replayRecording(_ rec: Recording, config change: ((inout CounterConfig) -> Void)? = nil) -> [CounterSnapshot] {
    // Start from the config the session was recorded with, then apply overrides
    // (this is how thresholds are tuned offline against real recordings).
    let counter = RepCounter(rec.config)
    if let change { counter.setConfig(change) }
    return rec.frames.map { counter.update(recordingFrameToPoseFrame($0)) }
}
