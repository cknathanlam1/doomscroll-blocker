import Foundation
import XCTest
@testable import DoomscrollerBlocker

// Port of web-prototype/tests/helpers.ts (and a few helpers that the web
// test files define locally): run a simulated session through a RepCounter
// and summarise what came out. `mirrorFrame` lives in GoldenParityTests.swift.

struct RunResult {
    var snapshots: [CounterSnapshot]
    var events: [CounterEvent]
    var finalCount: Int
    var counter: RepCounter
}

/// Feeds every frame to a fresh counter (or the given one) and collects all snapshots and events.
/// `config` changes DEFAULT_CONFIG fields in place (the web passes a Partial<CounterConfig>).
func runCounter(
    _ frames: [PoseFrame],
    _ config: ((inout CounterConfig) -> Void)? = nil,
    counter: RepCounter? = nil
) -> RunResult {
    let c: RepCounter
    if let counter {
        c = counter
    } else {
        var cfg = DEFAULT_CONFIG
        config?(&cfg)
        c = RepCounter(cfg)
    }
    var snapshots: [CounterSnapshot] = []
    var events: [CounterEvent] = []
    for f in frames {
        let snap = c.update(f)
        snapshots.append(snap)
        events.append(contentsOf: snap.events)
    }
    return RunResult(snapshots: snapshots, events: events, finalCount: snapshots.last?.count ?? 0, counter: c)
}

// Typed views of the events (the web filters by `type` and reads fields).

typealias RepEvent = (t: Double, count: Int, durationMs: Double, peakDepth: Double)
typealias PartialEvent = (t: Double, peakDepth: Double, live: Bool)
typealias CompleteEvent = (t: Double, count: Int, elapsedMs: Double)

func repEvents(_ events: [CounterEvent]) -> [RepEvent] {
    events.compactMap { if case .rep(let t, let c, let d, let p) = $0 { return (t, c, d, p) } else { return nil } }
}

func partialEvents(_ events: [CounterEvent]) -> [PartialEvent] {
    events.compactMap { if case .partial(let t, let p, let l) = $0 { return (t, p, l) } else { return nil } }
}

func completeEvents(_ events: [CounterEvent]) -> [CompleteEvent] {
    events.compactMap { if case .complete(let t, let c, let e) = $0 { return (t, c, e) } else { return nil } }
}

/// secondsLeft of every countdownTick, in order.
func countdownTicks(_ events: [CounterEvent]) -> [Int] {
    events.compactMap { if case .countdownTick(_, let s) = $0 { return s } else { return nil } }
}

func startEvents(_ events: [CounterEvent]) -> [(t: Double, baselineRatio: Double)] {
    events.compactMap { if case .start(let t, let b) = $0 { return (t, b) } else { return nil } }
}

/// `type` of every event, in order.
func eventTypes(_ events: [CounterEvent]) -> [String] {
    events.map(\.type)
}

/// The number of events of this type.
func countOf(_ events: [CounterEvent], _ type: String) -> Int {
    events.filter { $0.type == type }.count
}

/// Counts each event type, e.g. ["rep": 10, "partial": 2].
func eventHistogram(_ events: [CounterEvent]) -> [String: Int] {
    var out: [String: Int] = [:]
    for e in events { out[e.type, default: 0] += 1 }
    return out
}

/// repCancelled / paused reasons, in order.
func reasons(_ events: [CounterEvent], _ type: String) -> [String] {
    events.compactMap { e in
        switch e {
        case .repCancelled(_, let r) where type == "repCancelled": return r.rawValue
        case .paused(_, let r) where type == "paused": return r.rawValue
        default: return nil
        }
    }
}

/// Event types that matter for counting (leaves out the calibration ones and depthReached):
/// "rep", "partial", "repCancelled:lost", "paused:lost", "resumed", "complete" ...
func countingEvents(_ events: [CounterEvent]) -> [String] {
    events.compactMap { e in
        switch e {
        case .rep: return "rep"
        case .partial: return "partial"
        case .repCancelled(_, let r): return "repCancelled:\(r.rawValue)"
        case .paused(_, let r): return "paused:\(r.rawValue)"
        case .resumed: return "resumed"
        case .complete: return "complete"
        default: return nil
        }
    }
}

/// The last snapshot at or before time t.
func snapshotAt(_ snaps: [CounterSnapshot], _ t: Double) -> CounterSnapshot {
    var best: CounterSnapshot?
    for s in snaps where s.features.t <= t { best = s }
    guard let best else { fatalError("no snapshot at \(t)") }
    return best
}

/// The deepest smoothed depth reported in [t0, t1).
func maxDepthBetween(_ snaps: [CounterSnapshot], _ t0: Double, _ t1: Double) -> Double {
    var m = -Double.infinity
    for s in snaps {
        let t = s.features.t
        if t >= t0, t < t1, let d = s.depth { m = max(m, d) }
    }
    return m
}

// ---------------------------------------------------------------------------
// Frame editing helpers (defined locally in several web test files)

/// One frame at 30 fps.
let FRAME = 1000.0 / 30

/// Returns a copy of `frames` where frames with t in [t0, t1) are replaced by `fn(frame)`.
func alterWindow(_ frames: [PoseFrame], _ t0: Double, _ t1: Double, _ fn: (PoseFrame) -> PoseFrame) -> [PoseFrame] {
    frames.map { $0.t >= t0 && $0.t < t1 ? fn($0) : $0 }
}

/// Nobody detected.
func blank(_ f: PoseFrame) -> PoseFrame {
    var o = f
    o.joints = nil
    o.world = nil
    return o
}

/// Every joint's confidence set to `c` (e.g. a dark room).
func lowConfidence(_ c: Double) -> (PoseFrame) -> PoseFrame {
    return { f in
        guard let joints = f.joints else { return f }
        var out = joints
        for (name, j) in joints.values {
            var k = j
            k.c = c
            out[name] = k
        }
        var o = f
        o.joints = out
        return o
    }
}

/// Wrists not detected (confidence 0), everything else unchanged.
func hideWrists(_ f: PoseFrame) -> PoseFrame {
    guard var joints = f.joints else { return f }
    for name in [JointName.leftWrist, .rightWrist] {
        if var w = joints[name] {
            w.c = 0
            joints[name] = w
        }
    }
    var o = f
    o.joints = joints
    return o
}

/// n copies of a rep spec.
func reps(_ n: Int, _ spec: RepSpec) -> [RepSpec] {
    Array(repeating: spec, count: n)
}

/// The same specs as rep segments.
func repSegments(_ n: Int, _ spec: RepSpec) -> [Segment] {
    reps(n, spec).map { Segment.rep(spec: $0) }
}

/// Plays session B right after session A (B's timestamps shifted to continue A's, one 30 fps frame later).
func concat(_ a: [PoseFrame], _ b: [PoseFrame]) -> [PoseFrame] {
    let lastT = a.last?.t ?? 0
    let firstB = b.first?.t ?? 0
    return a + b.map { f in
        var o = f
        o.t = f.t - firstB + lastT + FRAME
        return o
    }
}

/// `toBeCloseTo(x, digits)` of vitest: |a - b| < 10^-digits / 2.
func assertCloseTo(
    _ a: Double?, _ b: Double?, digits: Int, _ message: @autoclosure () -> String = "",
    file: StaticString = #filePath, line: UInt = #line
) {
    guard let a, let b else {
        XCTFail("\(message()) value is nil (\(String(describing: a)) vs \(String(describing: b)))", file: file, line: line)
        return
    }
    XCTAssertEqual(a, b, accuracy: pow(10, -Double(digits)) / 2, message(), file: file, line: line)
}
