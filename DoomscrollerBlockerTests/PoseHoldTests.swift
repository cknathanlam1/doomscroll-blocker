import XCTest
@testable import DoomscrollerBlocker

/// A REAL iPhone recording (Apple Vision, phone on the floor, head toward it) of 3 good
/// push-ups, a shallow one and another good one. At the bottom of each rep the face is next to
/// the lens and Vision degrades: shoulder confidence 0.1–0.3, no body for ~0.9 s, and a
/// degenerate skeleton (shoulder width 0.22 → 0.01) with HIGH confidence for ~1.5 s.
/// Without PoseHold the counter sees the user vanish / leave the plank and counts nothing.
final class PoseHoldTests: XCTestCase {
    private func loadRecording() throws -> Recording {
        let url = Bundle(for: PoseHoldTests.self).resourceURL!.appendingPathComponent("RealRecordings/ios-session-1.json")
        return try JSONDecoder().decode(Recording.self, from: Data(contentsOf: url))
    }

    private func replay(_ rec: Recording, useHold: Bool) -> [CounterEvent] {
        var cfg = CounterConfig.visionDefault
        cfg.targetReps = 30
        let counter = RepCounter(cfg)
        var hold = PoseHold()
        var counting = false
        var mid = false
        var events: [CounterEvent] = []
        for f in rec.frames {
            var frame = recordingFrameToPoseFrame(f)
            if useHold { frame = hold.apply(frame, counting: counting, midAttempt: mid) }
            let s = counter.update(frame)
            counting = s.phase == .counting
            mid = counting && s.motion != .up
            events += s.events
        }
        return events
    }

    private func count(_ events: [CounterEvent], _ keep: (CounterEvent) -> Bool) -> Int { events.filter(keep).count }

    func testWithoutTheHoldNoRepSurvivesTheBottom() throws {
        let events = replay(try loadRecording(), useHold: false)
        XCTAssertEqual(count(events) { if case .rep = $0 { return true } else { return false } }, 0)
        XCTAssertGreaterThan(count(events) { if case .repCancelled = $0 { return true } else { return false } }, 0)
    }

    func testWithTheHoldTheGoodRepsCountAndTheShallowOneGetsGoLower() throws {
        let events = replay(try loadRecording(), useHold: true)
        XCTAssertEqual(count(events) { if case .rep = $0 { return true } else { return false } }, 4)
        XCTAssertEqual(count(events) { if case .partial = $0 { return true } else { return false } }, 1)
        XCTAssertEqual(count(events) { if case .paused = $0 { return true } else { return false } }, 0)
        XCTAssertEqual(count(events) { if case .repCancelled = $0 { return true } else { return false } }, 0)
    }

    func testNothingIsHeldOutsideASet() {
        var hold = PoseHold()
        let good = VisionMapping.toPoseFrame(points: [
            .leftShoulder: VisionPoint(x: 0.6, y: 0.6, confidence: 0.9),
            .rightShoulder: VisionPoint(x: 0.4, y: 0.6, confidence: 0.9),
        ], aspect: 0.75, tMs: 0)
        _ = hold.apply(good, counting: true, midAttempt: true)
        let empty = PoseFrame(t: 100, aspect: 0.75, joints: nil, world: nil)
        XCTAssertNil(hold.apply(empty, counting: false, midAttempt: false).joints, "not counting: walking away must pause")
        XCTAssertNil(hold.apply(empty, counting: true, midAttempt: false).joints, "at the top: no body means no body")
        XCTAssertNotNil(hold.apply(empty, counting: true, midAttempt: true).joints, "mid-rep: held")
        let late = PoseFrame(t: 5000, aspect: 0.75, joints: nil, world: nil)
        XCTAssertNil(hold.apply(late, counting: true, midAttempt: true).joints, "a hold never lasts beyond holdMs")
    }
}
