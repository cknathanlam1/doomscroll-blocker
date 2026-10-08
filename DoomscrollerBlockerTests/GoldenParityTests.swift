import XCTest
@testable import DoomscrollerBlocker

/// Golden parity: the Swift counter must count exactly like the web counter.
/// web-prototype/tests/fixtures/golden/*.json hold exact input frames and the
/// web counter's per-frame output (format: that folder's README.md). Never
/// edit them by hand; regenerate with `npm run golden` in web-prototype/.
///
/// Comparison rules (same as web-prototype/tests/golden.test.ts): exact for
/// phase / motion / count / depthSource / inFrame / plankOk / hint and the
/// events' types and string/boolean/integer fields; numbers within 1e-6;
/// nil only equals nil.

struct GoldenExpected: Decodable {
    var t: Double
    var phase: CounterPhase
    var motion: MotionPhase
    var count: Int
    var depth: Double?
    var rawDepth: Double?
    var peakDepth: Double
    var depthSource: DepthSource?
    var heightRatio: Double?
    var baselineRatio: Double?
    var shoulderWidthRatio: Double?
    var depthLineY: Double?
    var countdownRemainingMs: Double?
    var inFrame: Bool
    var plankOk: Bool
    var hint: CounterHint?
    var events: [CounterEvent]
}

struct GoldenFile: Decodable {
    var format: String
    var name: String
    var config: CounterConfig
    var frames: [PoseFrame]
    var expected: [GoldenExpected]
}

enum Fixtures {
    /// web-prototype/tests/fixtures is bundled as a folder reference named "fixtures".
    static var root: URL {
        Bundle(for: GoldenParityTests.self).resourceURL!.appendingPathComponent("fixtures")
    }

    static func load<T: Decodable>(_ type: T.Type, _ relativePath: String) throws -> T {
        let data = try Data(contentsOf: root.appendingPathComponent(relativePath))
        return try JSONDecoder().decode(type, from: data)
    }

    static func goldenNames() throws -> [String] {
        try FileManager.default
            .contentsOfDirectory(atPath: root.appendingPathComponent("golden").path)
            .filter { $0.hasSuffix(".json") }
            .sorted()
    }
}

/// A horizontally mirrored copy of a frame (x → aspect - x, left/right labels swapped), like a mirrored video file.
func mirrorFrame(_ f: PoseFrame) -> PoseFrame {
    let swap: [JointName: JointName] = [
        .nose: .nose,
        .leftShoulder: .rightShoulder, .rightShoulder: .leftShoulder,
        .leftElbow: .rightElbow, .rightElbow: .leftElbow,
        .leftWrist: .rightWrist, .rightWrist: .leftWrist,
        .leftHip: .rightHip, .rightHip: .leftHip,
    ]
    var out = PoseFrame(t: f.t, aspect: f.aspect, joints: nil, world: nil)
    if let joints = f.joints {
        var m = Joints2D()
        for (name, j) in joints.values { m[swap[name]!] = Joint2D(x: f.aspect - j.x, y: j.y, c: j.c) }
        out.joints = m
    }
    if let world = f.world {
        var m = Joints3D()
        for (name, j) in world.values { m[swap[name]!] = Joint3D(x: -j.x, y: j.y, z: j.z) }
        out.world = m
    }
    return out
}

final class GoldenParityTests: XCTestCase {
    private let tolerance = 1e-6

    private func same(_ a: Double?, _ b: Double?) -> Bool {
        guard let a, let b else { return a == nil && b == nil }
        return abs(a - b) <= tolerance
    }

    private func eventMismatch(_ e: CounterEvent, _ a: CounterEvent) -> Bool {
        switch (e, a) {
        case let (.inFrame(t1), .inFrame(t2)): return !same(t1, t2)
        case let (.countdownTick(t1, s1), .countdownTick(t2, s2)): return !same(t1, t2) || s1 != s2
        case let (.countdownCancelled(t1), .countdownCancelled(t2)): return !same(t1, t2)
        case let (.start(t1, b1), .start(t2, b2)): return !same(t1, t2) || !same(b1, b2)
        case let (.depthReached(t1), .depthReached(t2)): return !same(t1, t2)
        case let (.rep(t1, c1, d1, p1), .rep(t2, c2, d2, p2)):
            return !same(t1, t2) || c1 != c2 || !same(d1, d2) || !same(p1, p2)
        case let (.partial(t1, p1, l1), .partial(t2, p2, l2)): return !same(t1, t2) || !same(p1, p2) || l1 != l2
        case let (.repCancelled(t1, r1), .repCancelled(t2, r2)): return !same(t1, t2) || r1 != r2
        case let (.paused(t1, r1), .paused(t2, r2)): return !same(t1, t2) || r1 != r2
        case let (.resumed(t1), .resumed(t2)): return !same(t1, t2)
        case let (.complete(t1, c1, e1), .complete(t2, c2, e2)): return !same(t1, t2) || c1 != c2 || !same(e1, e2)
        default: return true
        }
    }

    /// The first difference between an expected and an actual entry, or nil when they match.
    private func firstMismatch(_ e: GoldenExpected, _ s: CounterSnapshot) -> String? {
        if e.phase != s.phase { return "phase: expected \(e.phase), got \(s.phase)" }
        if e.motion != s.motion { return "motion: expected \(e.motion), got \(s.motion)" }
        if e.count != s.count { return "count: expected \(e.count), got \(s.count)" }
        if e.depthSource != s.depthSource { return "depthSource: expected \(String(describing: e.depthSource)), got \(String(describing: s.depthSource))" }
        if e.inFrame != s.inFrame { return "inFrame: expected \(e.inFrame), got \(s.inFrame)" }
        if e.plankOk != s.plankOk { return "plankOk: expected \(e.plankOk), got \(s.plankOk)" }
        if e.hint != s.hint { return "hint: expected \(String(describing: e.hint)), got \(String(describing: s.hint))" }
        let numbers: [(String, Double?, Double?)] = [
            ("t", e.t, s.features.t),
            ("depth", e.depth, s.depth),
            ("rawDepth", e.rawDepth, s.rawDepth),
            ("peakDepth", e.peakDepth, s.peakDepth),
            ("heightRatio", e.heightRatio, s.heightRatio),
            ("baselineRatio", e.baselineRatio, s.baselineRatio),
            ("shoulderWidthRatio", e.shoulderWidthRatio, s.shoulderWidthRatio),
            ("depthLineY", e.depthLineY, s.depthLineY),
            ("countdownRemainingMs", e.countdownRemainingMs, s.countdownRemainingMs),
        ]
        for (name, ev, av) in numbers where !same(ev, av) {
            return "\(name): expected \(String(describing: ev)), got \(String(describing: av))"
        }
        if e.events.count != s.events.count { return "events: expected \(e.events), got \(s.events)" }
        for (ev, av) in zip(e.events, s.events) where eventMismatch(ev, av) {
            return "event: expected \(ev), got \(av)"
        }
        return nil
    }

    /// Feeds the frames to a fresh counter and returns the first mismatch (with context), or nil.
    private func replay(_ file: GoldenFile, _ frames: [PoseFrame]) -> String? {
        let counter = RepCounter(file.config)
        for (i, frame) in frames.enumerated() {
            let snap = counter.update(frame)
            if let diff = firstMismatch(file.expected[i], snap) {
                return "\(file.name): first mismatch at frame \(i) (t = \(frame.t)): \(diff)"
            }
        }
        return nil
    }

    func testAllGoldenFilesMatchExactly() throws {
        let names = try Fixtures.goldenNames()
        XCTAssertEqual(names.count, 16, "expected the 16 golden files")
        for name in names {
            let file = try Fixtures.load(GoldenFile.self, "golden/\(name)")
            XCTAssertEqual(file.format, "doomscroller-golden/2")
            XCTAssertEqual(file.expected.count, file.frames.count, name)
            XCTAssertNil(replay(file, file.frames), name)
        }
    }

    func testMirroredInputGivesTheSameOutput() throws {
        for name in try Fixtures.goldenNames() {
            let file = try Fixtures.load(GoldenFile.self, "golden/\(name)")
            XCTAssertNil(replay(file, file.frames.map(mirrorFrame)), "\(name) (mirrored)")
        }
    }
}
