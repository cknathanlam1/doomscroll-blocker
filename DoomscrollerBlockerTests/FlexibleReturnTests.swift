import XCTest
@testable import DoomscrollerBlocker

/// Port of web-prototype/tests/flexibleReturn.test.ts.
/// "Back up" is judged relative to each rep's depth (CounterConfig.returnFraction),
/// so tired reps that stop a little short of the calibrated plank still count.
/// (The real-laptop-recording half of that file is RecordingReplayTests.)
final class FlexibleReturnTests: XCTestCase {
    private func tired(_ n: Int, _ returnElbowDeg: Double) -> [RepSpec] {
        reps(n, RepSpec(minElbowDeg: 75, topRestMs: 300, returnElbowDeg: returnElbowDeg))
    }

    private func run(_ segments: [Segment], _ options: SimOptions = SimOptions()) -> RunResult {
        runCounter(simulateSession(segments, options).frames) { $0.targetReps = 30 }
    }

    func testRepsThatOnlyComeBackUpTo150AllCount() { checkTired(150) }
    func testRepsThatOnlyComeBackUpTo140AllCount() { checkTired(140) }
    func testRepsThatOnlyComeBackUpTo135AllCount() { checkTired(135) }

    private func checkTired(_ returnElbowDeg: Double) {
        let res = run(standardSet(tired(6, returnElbowDeg)), SimOptions(noisePx: 2, seed: 7))
        XCTAssertEqual(res.finalCount, 6)
        XCTAssertEqual(partialEvents(res.events).count, 0)
    }

    // The relaxed return must not count bounces that stay in the bottom half.
    // A 120–125° elbow is d ≈ 0.12–0.14, above partialMinDepth: a rep has to come
    // back out of that zone. (The bar used to be capped at 0.9 × downThreshold,
    // so a bounce back up to 125° counted as a second rep.)
    func testABounceOnlyPartOfTheWayUpTo110AtTheBottomIsOneRepNotTwo() { checkBounce(110) }
    func testABounceOnlyPartOfTheWayUpTo120AtTheBottomIsOneRepNotTwo() { checkBounce(120) }
    func testABounceOnlyPartOfTheWayUpTo125AtTheBottomIsOneRepNotTwo() { checkBounce(125) }

    private func checkBounce(_ returnElbowDeg: Double) {
        let specs = [
            RepSpec(minElbowDeg: 70, topRestMs: 100, returnElbowDeg: returnElbowDeg), // part of the way up…
            RepSpec(minElbowDeg: 70), // …back down, then all the way up
        ]
        let res = run(standardSet(specs), SimOptions(noisePx: 2, seed: 3))
        XCTAssertEqual(res.finalCount, 1)
    }

    func testPulsingInTheBottomHalfCountsAtMostOnePushUp() {
        let cases: [(Double, Double)] = [(65, 120), (60, 120), (75, 125)]
        for (minElbowDeg, returnElbowDeg) in cases {
            for fps in [30.0, 15.0] {
                let pulses =
                    reps(6, RepSpec(minElbowDeg: minElbowDeg, topRestMs: 150, returnElbowDeg: returnElbowDeg))
                    + [RepSpec(minElbowDeg: minElbowDeg)] // only the last one goes all the way up
                let res = run(standardSet(pulses) + [.hold(ms: 1000)], SimOptions(fps: fps, noisePx: 2, seed: 3))
                XCTAssertLessThanOrEqual(res.finalCount, 1, "\(minElbowDeg)↔\(returnElbowDeg)° @\(fps) fps")
            }
        }
    }

    func testShallowRepsFromATiredTop135EachGetGoLowerTheFullRepsAroundThemAllCount() {
        // Regression: a shallow attempt only ended at d ≤ upThreshold (0.07), which
        // a tired top (d ≈ 0.08) never reaches: the next shallow reps folded into
        // it with no "Go lower", and a later full rep could be cancelled as too slow.
        for nShallow in [3, 5] {
            let specs =
                [RepSpec(minElbowDeg: 75, returnElbowDeg: 135)]
                + reps(nShallow, RepSpec(minElbowDeg: 115, returnElbowDeg: 135))
                + [RepSpec(minElbowDeg: 75, returnElbowDeg: 135), RepSpec(minElbowDeg: 75)]
            let res = run(standardSet(specs) + [.hold(ms: 1000)], SimOptions(noisePx: 1, seed: 2))
            XCTAssertEqual(res.finalCount, 3, "\(nShallow) shallow")
            XCTAssertEqual(partialEvents(res.events).count, nShallow, "\(nShallow) shallow")
            XCTAssertEqual(countOf(res.events, "repCancelled"), 0, "\(nShallow) shallow")
        }
    }

    func testRestingAtATiredTopAfterAShallowRepDoesNotCancelTheNextFullRep() {
        let res = run(
            [
                .hold(ms: 4500),
                .rep(spec: RepSpec(minElbowDeg: 75, returnElbowDeg: 130)),
                .rep(spec: RepSpec(minElbowDeg: 115, topRestMs: 9000, returnElbowDeg: 130)),
                .rep(spec: RepSpec(minElbowDeg: 75)),
                .hold(ms: 1000),
            ],
            SimOptions(noisePx: 1, seed: 2)
        )
        XCTAssertEqual(res.finalCount, 2)
        XCTAssertEqual(countOf(res.events, "repCancelled"), 0)
    }
}
