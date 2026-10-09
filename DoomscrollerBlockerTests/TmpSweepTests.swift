import XCTest
@testable import DoomscrollerBlocker
final class TmpSweepTests: XCTestCase {
    func testSweep() throws {
        for file in ["ios-session-1", "ios-session-2"] {
            let url = Bundle(for: TmpSweepTests.self).resourceURL!.appendingPathComponent("RealRecordings/\(file).json")
            let rec = try JSONDecoder().decode(Recording.self, from: Data(contentsOf: url))
            for down in [0.25, 0.40, 0.45, 0.48, 0.50, 0.53] {
                var cfg = CounterConfig.visionDefault; cfg.targetReps = 30; cfg.downThreshold = down
                let counter = RepCounter(cfg); var hold = PoseHold(); var cnt = false, mid = false
                var out: [String] = []; let t0 = rec.frames[0].t
                for f in rec.frames {
                    let s = counter.update(hold.apply(recordingFrameToPoseFrame(f), counting: cnt, midAttempt: mid))
                    cnt = s.phase == .counting; mid = cnt && s.motion != .up
                    for e in s.events {
                        switch e {
                        case .rep(let t, let c, _, let p): out.append(String(format: "%.0fs REP%d(%.2f)", (t-t0)/1000, c, p))
                        case .partial(let t, let p, _): out.append(String(format: "%.0fs LOWER(%.2f)", (t-t0)/1000, p))
                        case .repCancelled(_, let r): out.append("cancel:\(r.rawValue)")
                        case .paused(_, let r): out.append("pause:\(r.rawValue)")
                        default: break }
                    }
                }
                print("SWEEP \(file) down=\(down): " + out.joined(separator: " | "))
            }
        }
    }
}
