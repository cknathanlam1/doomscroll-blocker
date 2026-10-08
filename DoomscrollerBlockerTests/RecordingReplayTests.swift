import XCTest
@testable import DoomscrollerBlocker

/// A REAL recorded set (laptop webcam, 11.5 fps, 13 push-ups, landmarks only).
/// The later reps came back up only to d ≈ 0.08–0.12; with the old fixed
/// lockout they merged and only 10 counted.
final class RecordingReplayTests: XCTestCase {
    private func events(targetReps: Int) throws -> [CounterEvent] {
        let rec = try Fixtures.load(Recording.self, "laptop-session-1.json")
        return replayRecording(rec) { $0.targetReps = targetReps }.flatMap(\.events)
    }

    private func reps(_ events: [CounterEvent]) -> Int {
        events.filter { if case .rep = $0 { return true } else { return false } }.count
    }

    private func partials(_ events: [CounterEvent]) -> Int {
        events.filter { if case .partial = $0 { return true } else { return false } }.count
    }

    private func completes(_ events: [CounterEvent]) -> Int {
        events.filter { if case .complete = $0 { return true } else { return false } }.count
    }

    func testAll13PushUpsCountWithNoFalseGoLower() throws {
        let e = try events(targetReps: 30)
        XCTAssertEqual(reps(e), 13)
        XCTAssertEqual(partials(e), 0)
    }

    func testWithTheDefaultTargetOf10TheSetCompletes() throws {
        let e = try events(targetReps: 10)
        XCTAssertEqual(completes(e), 1)
        XCTAssertEqual(reps(e), 10)
    }

    func testRecordingRoundTripsThroughJSON() throws {
        let rec = try Fixtures.load(Recording.self, "laptop-session-1.json")
        let data = try JSONEncoder().encode(rec)
        let back = try JSONDecoder().decode(Recording.self, from: data)
        XCTAssertEqual(back.frames.count, rec.frames.count)
        XCTAssertEqual(back.events, rec.events)
        XCTAssertEqual(back.config, rec.config)
    }
}
