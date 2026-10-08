import XCTest
@testable import DoomscrollerBlocker

/// Port of web-prototype/tests/repCounter.test.ts.
///
/// Behaviour tests for the push-up state machine, driven by the geometric
/// simulator so the inputs come from real camera geometry, not from the
/// counter's own assumptions. Everything is seeded.
///
/// Default timeline from t = 0 with a plank in view: the plank gate passes at
/// once → after calibrationHoldMs (600) 'inFrame' + countdown "3" → "2" at
/// 1600 → "1" at 2600 → 'start' at 3600. standardSet() holds 4.5 s first.
///
/// Not ported (the Swift types make them moot): "setConfig accepts partially
/// filled nested groups" and "the config getter returns a copy" (CounterConfig
/// is a value type, setConfig takes an in-place closure).
final class RepCounterSimTests: XCTestCase {
    private let CFG = DEFAULT_CONFIG

    // =========================================================================
    // calibration (Placement screen → 3-2-1 → start)

    private func calibrationRun() -> (sim: SimResult, r: RunResult) {
        let sim = simulateSession([.hold(ms: 5000)])
        return (sim, runCounter(sim.frames))
    }

    func testCalibrationEventsInFrameThenCountdownTicksThenStart() {
        let r = calibrationRun().r
        XCTAssertEqual(eventTypes(r.events), ["inFrame", "countdownTick", "countdownTick", "countdownTick", "start"])
        XCTAssertEqual(countdownTicks(r.events), [3, 2, 1])
    }

    func testCalibrationTimingFollowsCalibrationHoldMsAndTheCountdownInMs() {
        let r = calibrationRun().r
        XCTAssertEqual(r.events.count, 5)
        let t = r.events.map(\.t)
        func near(_ actual: Double, _ expected: Double, _ what: String) {
            XCTAssertGreaterThanOrEqual(actual, expected - 1e-6, what)
            XCTAssertLessThan(actual, expected + FRAME + 1e-6, what)
        }
        near(t[0], CFG.calibrationHoldMs, "inFrame")
        XCTAssertEqual(t[1], t[0])
        near(t[2], CFG.calibrationHoldMs + 1000, "tick 2")
        near(t[3], CFG.calibrationHoldMs + 2000, "tick 1")
        near(t[4], CFG.calibrationHoldMs + CFG.countdownMs, "start")
    }

    func testCalibrationBaselineIsTheHeightRatioAtTheTop() throws {
        let (sim, r) = calibrationRun()
        let start = try XCTUnwrap(startEvents(r.events).first)
        let hTrue = computeFeatures(sim.frames[0], CFG.visibilityThreshold, CFG.wristVisibilityThreshold).heightRatio
        assertCloseTo(start.baselineRatio, hTrue, digits: 3)
    }

    func testCalibrationSnapshotsPhasesCountdownTimerHintsStartedAtAndDepthLine() throws {
        let r = calibrationRun().r
        let startT = try XCTUnwrap(startEvents(r.events).first).t
        let inFrameT = try XCTUnwrap(r.events.first { $0.type == "inFrame" }).t
        var lastRemaining = Double.infinity
        for s in r.snapshots {
            let t = s.features.t
            if t < inFrameT {
                XCTAssertEqual(s.phase, .waiting)
                XCTAssertEqual(s.hint, .holdStill) // in a plank, but not for long enough yet
                XCTAssertTrue(s.plankOk)
            } else if t < startT {
                XCTAssertEqual(s.phase, .countdown)
                XCTAssertNil(s.hint)
                let remaining = try XCTUnwrap(s.countdownRemainingMs)
                XCTAssertLessThanOrEqual(remaining, lastRemaining)
                XCTAssertLessThanOrEqual(remaining, CFG.countdownMs)
                lastRemaining = remaining
            } else {
                XCTAssertEqual(s.phase, .counting)
                XCTAssertNil(s.countdownRemainingMs)
                XCTAssertNil(s.hint)
            }
            if s.phase != .countdown { XCTAssertNil(s.countdownRemainingMs) }
            XCTAssertEqual(s.startedAt, t < startT ? nil : startT)
            XCTAssertEqual(s.baselineRatio == nil, t < startT)
            XCTAssertEqual(s.depthLineY == nil, t < startT)
            XCTAssertEqual(s.depth == nil, t < startT)
            XCTAssertEqual(s.count, 0)
            XCTAssertEqual(s.target, CFG.targetReps)
            // inFrame turns on after resumeAfterMs of visible shoulders.
            XCTAssertEqual(s.inFrame, t >= CFG.resumeAfterMs - 1e-6)
        }
    }

    func testMovingDuringTheCountdownRestartsItWithHoldStillAndItStartsOnceTheUserIsStill() throws {
        // Bobbing down to 115° and back, once a second, from t = 1 s to t = 5 s.
        let bob: [Segment] =
            [.hold(ms: 1000)]
            + repSegments(4, RepSpec(minElbowDeg: 115, downMs: 500, bottomHoldMs: 0, upMs: 500, topRestMs: 0))
            + [.hold(ms: 5000)]
        let res = runCounter(simulateSession(bob).frames)
        let ticks = countdownTicks(res.events)
        XCTAssertEqual(Array(ticks.prefix(4)), [3, 2, 1, 3]) // restarted instead of starting
        let tickEvents = res.events.filter { $0.type == "countdownTick" }
        let restartT = tickEvents[3].t
        let start = try XCTUnwrap(startEvents(res.events).first)
        XCTAssertGreaterThan(start.t, 5000) // never calibrates while moving
        let hints = res.snapshots.filter { $0.phase == .countdown && $0.features.t > restartT }.map(\.hint)
        XCTAssertTrue(hints.contains(.holdStill))
        // The baseline was measured while still, so it is the real top.
        let hTrue = computeFeatures(simulateSession([.hold(ms: 34)]).frames[0], 0.5, 0.4).heightRatio
        assertCloseTo(start.baselineRatio, hTrue, digits: 2)
    }

    func testLeavingThePlankDuringTheCountdownCancelsItAfterAShortGracePeriod() {
        let segs: [Segment] = [.hold(ms: 1500), .rep(spec: RepSpec(minElbowDeg: 80)), .hold(ms: 6000)]
        let res = runCounter(simulateSession(segs).frames)
        let types = eventTypes(res.events)
        XCTAssertEqual(Array(types.prefix(3)), ["inFrame", "countdownTick", "countdownTick"])
        XCTAssertTrue(types.contains("countdownCancelled"))
        // ...then starts over from "in frame" and calibrates normally.
        let afterCancel = Array(types[(types.firstIndex(of: "countdownCancelled")! + 1)...])
        XCTAssertEqual(afterCancel, ["inFrame", "countdownTick", "countdownTick", "countdownTick", "start"])
        XCTAssertEqual(res.finalCount, 0)
    }

    func testAStillPlankCalibratesAtALowFrameRate() {
        // Regression: calibration needed 8 frames in its 1 s window, so below
        // ~7 fps the 3-2-1 restarted forever with "Hold still".
        for fps in [6.5, 6, 5] {
            let res = runCounter(simulateSession([.hold(ms: 8000)], SimOptions(fps: fps, noisePx: 1, seed: 1)).frames)
            XCTAssertEqual(countdownTicks(res.events).count, 3, "\(fps) fps")
            XCTAssertEqual(startEvents(res.events).count, 1, "\(fps) fps")
        }
    }

    // =========================================================================
    // counting

    func test10FullRepsGiveExactly10RepEventsThenCompleteNothingCountsAfterComplete() throws {
        let sim = simulateSession(standardSet(reps(12, RepSpec(minElbowDeg: 80))))
        let r = runCounter(sim.frames)
        let repEv = repEvents(r.events)
        XCTAssertEqual(repEv.map(\.count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

        let complete = completeEvents(r.events)
        XCTAssertEqual(complete.count, 1)
        XCTAssertEqual(complete[0].count, 10)
        XCTAssertEqual(complete[0].t, repEv[9].t)
        let startT = try XCTUnwrap(startEvents(r.events).first).t
        XCTAssertEqual(complete[0].elapsedMs, complete[0].t - startT, accuracy: 1e-9)
        // 'complete' is the very last event: reps 11 and 12 produce nothing.
        XCTAssertEqual(r.events.last?.type, "complete")
        for s in r.snapshots where s.features.t >= complete[0].t {
            XCTAssertEqual(s.phase, .complete)
            XCTAssertEqual(s.count, 10)
        }
        // Pattern: each rep is "depth reached" then "rep" — no partials, cancels or pauses.
        XCTAssertEqual(countingEvents(r.events), Array(repeating: "rep", count: 10) + ["complete"])
        XCTAssertEqual(countOf(r.events, "depthReached"), 10)
    }

    func testEachRepIsCountedAtTheTopOfItsOwnPushUpNeverAtTheBottom() {
        let sim = simulateSession(standardSet(reps(5, RepSpec(minElbowDeg: 80))))
        let r = runCounter(sim.frames)
        let repEv = repEvents(r.events)
        XCTAssertEqual(repEv.count, 5)
        for (i, simRep) in sim.reps.enumerated() {
            let e = repEv[i]
            let bottomEnd = simRep.tStart + 700 + 100 // downMs + bottomHoldMs (defaults)
            XCTAssertGreaterThan(e.t, bottomEnd)
            XCTAssertLessThanOrEqual(e.t, simRep.tEnd + 400) // within the rest at the top
            XCTAssertGreaterThanOrEqual(e.peakDepth, CFG.downThreshold)
            // Duration ≈ the push-up itself (1.5 s), measured from leaving the top.
            XCTAssertGreaterThan(e.durationMs, 1000)
            XCTAssertLessThan(e.durationMs, 2000)
        }
    }

    func testPartialRepsElbow120NeverCountAndGetExactlyOneGoLowerEach() {
        for opts in [SimOptions(), SimOptions(fps: 15, noisePx: 2, seed: 5)] {
            let sim = simulateSession(standardSet(reps(5, RepSpec(minElbowDeg: 120))), opts)
            let r = runCounter(sim.frames)
            XCTAssertEqual(r.finalCount, 0)
            XCTAssertEqual(countOf(r.events, "depthReached"), 0)
            let partials = partialEvents(r.events)
            XCTAssertEqual(partials.count, 5)
            for simRep in sim.reps {
                let inWindow = partials.filter { $0.t >= simRep.tStart && $0.t <= simRep.tEnd + 400 }
                XCTAssertEqual(inWindow.count, 1)
            }
            for p in partials {
                XCTAssertGreaterThanOrEqual(p.peakDepth, CFG.partialMinDepth)
                XCTAssertLessThan(p.peakDepth, CFG.downThreshold)
                // Turning back early is noticed on the way up, before reaching the top.
                XCTAssertTrue(p.live)
            }
        }
    }

    func testWhenTurningBackIsNotDetectedLiveThePartialComesAtTheTopInstead() {
        let sim = simulateSession(standardSet(reps(3, RepSpec(minElbowDeg: 120))))
        let r = runCounter(sim.frames) { $0.turnBackMargin = 0.5 }
        XCTAssertEqual(partialEvents(r.events).map(\.live), [false, false, false])
        XCTAssertEqual(r.finalCount, 0)
    }

    func testAMixedSetCountsExactlyTheFullReps() {
        let angles: [Double] = [80, 120, 70, 85, 120, 60, 88]
        let sim = simulateSession(standardSet(angles.map { RepSpec(minElbowDeg: $0) }))
        let r = runCounter(sim.frames)
        XCTAssertEqual(r.finalCount, 5)
        XCTAssertEqual(countingEvents(r.events), ["rep", "partial", "rep", "rep", "partial", "rep", "rep"])
        // Each event belongs to the right push-up.
        let ordered = r.events.filter { $0.type == "rep" || $0.type == "partial" }
        for (i, simRep) in sim.reps.enumerated() {
            let e = ordered[i]
            XCTAssertEqual(e.type, simRep.full ? "rep" : "partial")
            XCTAssertGreaterThanOrEqual(e.t, simRep.tStart)
            XCTAssertLessThanOrEqual(e.t, simRep.tEnd + 400)
        }
    }

    func testALongPlankHold60sProducesNothingAfterTheStartAt30And15Fps() {
        let optionSets = [SimOptions(fps: 30, noisePx: 2, seed: 1), SimOptions(fps: 15, noisePx: 2, seed: 2, timeJitterMs: 10)]
        for opts in optionSets {
            let r = runCounter(simulateSession([.hold(ms: 60000)], opts).frames)
            let types = eventTypes(r.events)
            XCTAssertEqual(Array(types[(types.firstIndex(of: "start")! + 1)...]), [])
            let counting = r.snapshots.filter { $0.phase == .counting }
            XCTAssertGreaterThan(Double(counting.count), 50000 / (1000 / (opts.fps ?? 30)))
            for s in counting {
                XCTAssertEqual(s.motion, .up)
                XCTAssertEqual(s.count, 0)
                XCTAssertNil(s.hint)
            }
        }
    }

    func testFastReps03sDown03sUpAllCountAt30And15Fps() {
        let fast = reps(6, RepSpec(minElbowDeg: 80, downMs: 300, bottomHoldMs: 0, upMs: 300, topRestMs: 300))
        for fps in [30.0, 15.0] {
            let r = runCounter(simulateSession(standardSet(fast) + [.hold(ms: 800)], SimOptions(fps: fps)).frames)
            XCTAssertEqual(r.finalCount, 6, "\(fps) fps")
            XCTAssertNil(eventHistogram(r.events)["partial"])
        }
    }

    func testSlowReps2sDown2sUpAllCount() {
        let slow = reps(4, RepSpec(minElbowDeg: 80, downMs: 2000, bottomHoldMs: 300, upMs: 2000, topRestMs: 600))
        let r = runCounter(simulateSession(standardSet(slow)).frames)
        XCTAssertEqual(r.finalCount, 4)
        XCTAssertEqual(countingEvents(r.events), ["rep", "rep", "rep", "rep"])
    }

    func testHoldingTheBottomThenPushingUpCountsOnce() {
        let r = runCounter(simulateSession(standardSet(reps(2, RepSpec(minElbowDeg: 80, bottomHoldMs: 2500)))).frames)
        XCTAssertEqual(r.finalCount, 2)
        XCTAssertEqual(countOf(r.events, "depthReached"), 2)
        XCTAssertEqual(countingEvents(r.events), ["rep", "rep"])
    }

    func testAnAttemptLongerThanMaxRepMsIsCancelledAsTooSlowTheNextRepCounts() {
        let sim = simulateSession(standardSet([RepSpec(minElbowDeg: 80, bottomHoldMs: 11000), RepSpec(minElbowDeg: 80)]))
        let r = runCounter(sim.frames)
        XCTAssertEqual(countingEvents(r.events), ["repCancelled:tooSlow", "rep"])
        XCTAssertEqual(r.finalCount, 1)
    }

    func testABounceFasterThanMinRepMsIsNotAPushUp() {
        let sim = simulateSession(standardSet([RepSpec(minElbowDeg: 80, downMs: 150, bottomHoldMs: 30, upMs: 150)]) + [.hold(ms: 1000)])
        XCTAssertEqual(runCounter(sim.frames).finalCount, 0)
    }

    func testAMirroredVideoGivesIdenticalCountsAndEvents() {
        let angles: [Double] = [80, 120, 70, 95, 130, 85]
        let sim = simulateSession(
            standardSet(angles.map { RepSpec(minElbowDeg: $0) }),
            SimOptions(fps: 24, noisePx: 2, dropoutRate: 0.02, seed: 9, timeJitterMs: 8)
        )
        let a = runCounter(sim.frames)
        let b = runCounter(sim.frames.map(mirrorFrame))
        XCTAssertGreaterThanOrEqual(a.finalCount, 3)
        // Same events at the same times. (Numbers inside them may differ in the
        // last binary digit: aspect - x is not exactly reversible in floating point.)
        XCTAssertEqual(b.events.map { "\($0.type)@\($0.t)" }, a.events.map { "\($0.type)@\($0.t)" })
        let pa = repEvents(a.events).map(\.peakDepth)
        let pb = repEvents(b.events).map(\.peakDepth)
        XCTAssertEqual(pa.count, pb.count)
        for (x, y) in zip(pa, pb) { XCTAssertEqual(x, y, accuracy: 5e-10) }
        XCTAssertEqual(b.snapshots.map(\.count), a.snapshots.map(\.count))
        for (i, s) in a.snapshots.enumerated() {
            let m = b.snapshots[i]
            if let d = s.depth {
                assertCloseTo(m.depth, d, digits: 9)
            } else {
                XCTAssertNil(m.depth)
            }
        }
    }

    // =========================================================================
    // losing the user mid-set

    /// Three good reps, then a slow 4th rep during which the user disappears.
    private func losingSetup() -> (sim: SimResult, gapStart: Double, gapEnd: Double) {
        let slowRep = RepSpec(minElbowDeg: 80, downMs: 1500, bottomHoldMs: 1500, upMs: 700)
        let segments: [Segment] =
            standardSet(reps(3, RepSpec(minElbowDeg: 80)) + [slowRep])
            + [.hold(ms: 1000)]
            + repSegments(2, RepSpec(minElbowDeg: 80))
            + [.hold(ms: 500)]
        let sim = simulateSession(segments)
        let gapStart = sim.reps[3].tStart + 1000 // deep into the descent
        let gapEnd = gapStart + 1500 // reappears at the bottom
        return (sim, gapStart, gapEnd)
    }

    private func checkPauseAndResume(_ frames: [PoseFrame], _ setup: (sim: SimResult, gapStart: Double, gapEnd: Double)) throws {
        let r = runCounter(frames)
        // The rep in progress is cancelled (never count what we couldn't see), the
        // count is kept, and counting resumes by itself.
        XCTAssertEqual(countingEvents(r.events), ["rep", "rep", "rep", "repCancelled:lost", "paused:lost", "resumed", "rep", "rep"])
        XCTAssertEqual(r.finalCount, 5)

        let pausedT = try XCTUnwrap(r.events.first { $0.type == "paused" }).t
        XCTAssertGreaterThanOrEqual(pausedT - setup.gapStart, CFG.lostAfterMs - 1e-6)
        XCTAssertLessThan(pausedT - setup.gapStart, CFG.lostAfterMs + 2 * FRAME)
        let during = r.snapshots.filter { $0.features.t > pausedT && $0.features.t < setup.gapEnd }
        XCTAssertGreaterThan(during.count, 10)
        for s in during {
            XCTAssertEqual(s.phase, .paused)
            XCTAssertEqual(s.count, 3)
            XCTAssertEqual(s.hint, .getInFrame)
        }
        // Back at the bottom of a push-up is not a plank yet: resumes only once the
        // user is up again, and the half rep they finish doesn't count.
        let resumedT = try XCTUnwrap(r.events.first { $0.type == "resumed" }).t
        XCTAssertGreaterThan(resumedT, setup.gapEnd + CFG.resumeAfterMs)
        XCTAssertEqual(snapshotAt(r.snapshots, setup.sim.reps[4].tStart - 1).count, 3)
    }

    func testNobodyDetectedPausedLostThenResumedCountKeptRepInProgressCancelled() throws {
        let setup = losingSetup()
        try checkPauseAndResume(alterWindow(setup.sim.frames, setup.gapStart, setup.gapEnd, blank), setup)
    }

    func testALowConfidenceStretchBehavesExactlyLikeBeingLost() throws {
        let setup = losingSetup()
        try checkPauseAndResume(alterWindow(setup.sim.frames, setup.gapStart, setup.gapEnd, lowConfidence(0.2)), setup)
    }

    func testALowConfidenceSegmentBetweenRepsPausesAndResumesToo() {
        let segs: [Segment] =
            standardSet(reps(2, RepSpec(minElbowDeg: 80)))
            + [.lowConfidence(ms: 1500), .hold(ms: 1000), .rep(spec: RepSpec(minElbowDeg: 80))]
        let r = runCounter(simulateSession(segs).frames)
        XCTAssertEqual(countingEvents(r.events), ["rep", "rep", "paused:lost", "resumed", "rep"])
    }

    func testAShortDropoutBelowLostAfterMsMidRepIsIgnoredAndTheRepStillCounts() {
        let s = simulateSession(standardSet(reps(3, RepSpec(minElbowDeg: 80))))
        let t0 = s.reps[1].tStart + 400
        let r = runCounter(alterWindow(s.frames, t0, t0 + 300, blank))
        XCTAssertEqual(r.finalCount, 3)
        XCTAssertEqual(countingEvents(r.events), ["rep", "rep", "rep"])
        // Depth is unknown while nobody is visible, and the hint asks to get back in frame.
        let mid = snapshotAt(r.snapshots, t0 + 150)
        XCTAssertNil(mid.depth)
        XCTAssertEqual(mid.hint, .getInFrame)
        XCTAssertEqual(mid.phase, .counting)
    }

    func testComingBackFurtherFromThePhoneShoulders25PercentSmallerResumesAndKeepsCounting() {
        // Regression: the resume check used to demand the old shoulder width, so
        // this user was stuck on "back to plank" forever.
        let a = simulateSession(standardSet(reps(2, RepSpec(minElbowDeg: 80)))).frames
        let b = simulateSession(
            [.absent(ms: 2000), .hold(ms: 1500)] + repSegments(3, RepSpec(minElbowDeg: 80)) + [.hold(ms: 500)],
            SimOptions(geometry: PartialSimGeometry(headDistance: 1.3))
        ).frames
        let r = runCounter(concat(a, b))
        XCTAssertEqual(countingEvents(r.events), ["rep", "rep", "paused:lost", "resumed", "rep", "rep", "rep"])
        XCTAssertEqual(r.finalCount, 5)
    }

    func testComingBackCloserToThePhoneAlsoWorks() {
        let a = simulateSession(standardSet(reps(2, RepSpec(minElbowDeg: 80)))).frames
        let b = simulateSession(
            [.absent(ms: 2000), .hold(ms: 1000)] + repSegments(3, RepSpec(minElbowDeg: 80)),
            SimOptions(geometry: PartialSimGeometry(headDistance: 0.6))
        ).frames
        XCTAssertEqual(runCounter(concat(a, b)).finalCount, 5)
    }

    func testShufflingBackAbruptlyNoAbsencePausesAsOutOfPlankThenResumesInTheNewSpot() {
        // Regression: the shoulder-width jump pauses the set; the user is in a good
        // plank in the new spot, so it must resume (it used to stay paused forever).
        let a = simulateSession(standardSet(reps(2, RepSpec(minElbowDeg: 80)))).frames
        let b = simulateSession(
            [.hold(ms: 1500)] + repSegments(2, RepSpec(minElbowDeg: 80)),
            SimOptions(geometry: PartialSimGeometry(headDistance: 1.35))
        ).frames
        let r = runCounter(concat(a, b))
        // The instant jump briefly fools the depth signal (the hand line follows
        // the wrists with a 0.5 s lag), so an attempt may start and be cancelled
        // as rockedBack first. Either way nothing is counted for it.
        let events = countingEvents(r.events).filter { $0 != "repCancelled:rockedBack" }
        XCTAssertEqual(events, ["rep", "rep", "paused:outOfPlank", "resumed", "rep", "rep"])
        XCTAssertEqual(r.finalCount, 4)
    }

    func testThePhoneWasMovedDuringThePauseCountingCarriesOn() {
        // Regression: after resuming, the hand line stopped following the wrists
        // until the user was "back at the top", but with the stale hand line the
        // real top read as d ≈ 0.15–0.17, so that never happened and no rep could
        // count again for the rest of the set (with no hint).
        let geometries = [
            PartialSimGeometry(tiltDeg: 18),
            PartialSimGeometry(tiltDeg: 20),
            PartialSimGeometry(camHeight: 0.2, tiltDeg: 14),
        ]
        for geometry in geometries {
            let a = simulateSession(standardSet(reps(2, RepSpec(minElbowDeg: 80)))).frames
            let b = simulateSession(
                [.absent(ms: 2000), .hold(ms: 1500)] + repSegments(6, RepSpec(minElbowDeg: 80)) + [.hold(ms: 500)],
                SimOptions(geometry: geometry, noisePx: 1, seed: 4)
            ).frames
            let r = runCounter(concat(a, b)) { $0.targetReps = 30 }
            XCTAssertEqual(r.finalCount, 8, "\(geometry)")
        }
    }

    func testABumpThatTiltsThePhoneWhileRestingAtTheTopCostsAtMostOneSlowAttemptThenCountingRecovers() {
        // The jump in depth starts an attempt that can't end (the hand line is
        // frozen during attempts); after maxRepMs it is cancelled, the hand line
        // catches up and later reps count again (they used to never count again).
        let a = simulateSession(standardSet(reps(2, RepSpec(minElbowDeg: 80)))).frames
        let b = simulateSession(
            [.hold(ms: 3000)] + repSegments(10, RepSpec(minElbowDeg: 80)) + [.hold(ms: 500)],
            SimOptions(geometry: PartialSimGeometry(tiltDeg: 16), noisePx: 1, seed: 4)
        ).frames
        let r = runCounter(concat(a, b)) { $0.targetReps = 30 }
        let after = Array(countingEvents(r.events).dropFirst(2))
        XCTAssertEqual(after.filter { $0 != "rep" }, ["repCancelled:tooSlow"])
        XCTAssertGreaterThanOrEqual(r.finalCount, 2 + 5)
    }

    // =========================================================================
    // cheating and form hints

    func testRockingBackTowardChildsPoseRepCancelledRockedBackNeverARep() {
        let segs: [Segment] = [.hold(ms: 4500), .rockBack(backM: 0.2, dropM: 0.2), .hold(ms: 1500)]
        let r = runCounter(simulateSession(segs).frames)
        XCTAssertEqual(countingEvents(r.events), ["repCancelled:rockedBack"])
        XCTAssertEqual(r.finalCount, 0)
        // The shoulders really did shrink below minShoulderWidthRatio.
        let minRatio = r.snapshots.map { $0.shoulderWidthRatio ?? .infinity }.min()!
        XCTAssertLessThan(minRatio, CFG.minShoulderWidthRatio)
    }

    func testABigRockBackPausesAsOutOfPlankWithBackToPlankThenResumesAtTheTop() {
        let segs: [Segment] = [.hold(ms: 4500), .rockBack(backM: 0.4, dropM: 0.3), .hold(ms: 1500)]
        let r = runCounter(simulateSession(segs).frames)
        XCTAssertEqual(countingEvents(r.events), ["repCancelled:outOfPlank", "paused:outOfPlank", "resumed"])
        XCTAssertTrue(r.snapshots.filter { $0.phase == .paused }.contains { $0.hint == .backToPlank })
        XCTAssertEqual(r.finalCount, 0)
    }

    func testHeadNodWithoutTheChestGoingDownChestNotHeadHintNoRepNoGoLower() {
        let segs: [Segment] = [.hold(ms: 4500), .headBob(dropM: 0.15), .hold(ms: 3000)]
        let r = runCounter(simulateSession(segs).frames)
        XCTAssertEqual(countingEvents(r.events), [])
        XCTAssertEqual(countOf(r.events, "depthReached"), 0)
        let shown = r.snapshots.filter { $0.hint == .chestNotHead }.map { $0.features.t }
        XCTAssertGreaterThan(shown.count, 0)
        // Not before the nod has lasted a moment; long enough to read from the floor; gone at the end.
        XCTAssertGreaterThan(shown[0], 4500 + 300)
        XCTAssertGreaterThan(shown.last! - shown[0], 1000)
        XCTAssertNil(r.snapshots.last?.hint)
    }

    func testASmallNod8cmIsNotFlagged() {
        let segs: [Segment] = [.hold(ms: 4500), .headBob(dropM: 0.08), .hold(ms: 1000)]
        let r = runCounter(simulateSession(segs).frames)
        XCTAssertFalse(r.snapshots.contains { $0.hint == .chestNotHead })
    }

    // =========================================================================
    // hints before the set starts

    func testNobodyThereGetInFrame() {
        let r = runCounter(simulateSession([.absent(ms: 2000)]).frames)
        for s in r.snapshots {
            XCTAssertEqual(s.hint, .getInFrame)
            XCTAssertEqual(s.phase, .waiting)
            XCTAssertFalse(s.plankOk)
            XCTAssertFalse(s.inFrame)
        }
        XCTAssertEqual(r.events, [])
    }

    func testShouldersVisibleButNoWristsHandsInViewAndTheCountdownNeverStarts() {
        let frames = simulateSession([.hold(ms: 3000)]).frames.map(hideWrists)
        let r = runCounter(frames)
        for s in r.snapshots { XCTAssertEqual(s.hint, .handsInView) }
        XCTAssertEqual(r.events, [])
    }

    func testTooFarMoveCloserTooCloseMoveBack() {
        let far = runCounter(simulateSession([.hold(ms: 2000)], SimOptions(geometry: PartialSimGeometry(headDistance: 2.5))).frames)
        XCTAssertTrue(far.snapshots.allSatisfy { $0.hint == .moveCloser })
        XCTAssertEqual(far.events, [])
        // The simulated phone can't get close enough before the shoulders leave
        // the frame, so lower the limit instead (default placement ≈ 0.33 of the width).
        let close = runCounter(simulateSession([.hold(ms: 2000)]).frames) { $0.plankGate.maxShoulderWidthFrac = 0.3 }
        XCTAssertTrue(close.snapshots.allSatisfy { $0.hint == .moveBack })
    }

    // =========================================================================
    // wrists out of view while counting

    // A close, steeply tilted phone: shoulders grow most here as they come toward
    // the camera, which is where the old shoulder-only fallback went wrong.
    private func wristsOutSetup() -> (sim: SimResult, hidden: [PoseFrame]) {
        let geometry = PartialSimGeometry(camHeight: 0.05, tiltDeg: 20, headDistance: 0.7)
        let sim = simulateSession(standardSet(reps(3, RepSpec(minElbowDeg: 90))), SimOptions(geometry: geometry))
        return (sim, alterWindow(sim.frames, 4000, .infinity, hideWrists))
    }

    func test90RepsStillCountDepthIsLabelledShouldersAndTheHintAsksForTheHands() {
        // Regression: the fallback read ~25 % shallower than the wrist signal and
        // these reps were all reported as "Go lower".
        let r = runCounter(wristsOutSetup().hidden)
        XCTAssertEqual(r.finalCount, 3)
        for s in r.snapshots where s.features.t >= 4000 {
            XCTAssertEqual(s.depthSource, .shoulders)
            XCTAssertEqual(s.hint, .handsInView)
        }
    }

    func testHidingTheWristsKeepsDepthOnTheSameScale() {
        let setup = wristsOutSetup()
        let withWrists = runCounter(setup.sim.frames)
        let without = runCounter(setup.hidden)
        XCTAssertEqual(without.finalCount, withWrists.finalCount)
        var maxDiff = 0.0
        for (i, s) in withWrists.snapshots.enumerated() {
            let o = without.snapshots[i]
            if let sd = s.depth, let od = o.depth {
                maxDiff = max(maxDiff, abs(od - sd))
            } else {
                XCTAssertEqual(o.depth, s.depth)
            }
        }
        // The old fallback was ~0.08 shallower at the bottom. What is left (≈ 0.01)
        // comes only from the slow top-baseline adaptation, which runs only while
        // the wrists are visible.
        XCTAssertLessThan(maxDiff, 0.02)
    }

    // =========================================================================
    // depthLineY (the line the chest must cross)

    private func checkSteadyIdentity(_ frames: [PoseFrame], _ holdEnds: [Double]) {
        // depth is linear in the shoulder y: d - down = (y - lineY) / (hTop · shoulderWidth).
        // Checked on steady frames (end of a long bottom hold), where the smoothed
        // values have settled.
        let down = CFG.downThreshold
        let r = runCounter(frames)
        for t in holdEnds {
            let s = snapshotAt(r.snapshots, t)
            XCTAssertNotNil(s.depth)
            XCTAssertNotNil(s.depthLineY)
            XCTAssertNotNil(s.baselineRatio)
            guard let y = s.features.shoulderMid?.y, let sw = s.features.shoulderWidth,
                  let depth = s.depth, let lineY = s.depthLineY, let base = s.baselineRatio else { continue }
            assertCloseTo(depth - down, (y - lineY) / (base * sw), digits: 3)
            // Below the line (larger y, image is y-down) ⇔ deeper than downThreshold.
            if abs(depth - down) > 0.01 { XCTAssertEqual(y > lineY, depth > down) }
        }
    }

    private func depthLineSetup() -> (sim: SimResult, holdEnds: [Double]) {
        let angles: [Double] = [140, 120, 105, 95, 85, 70]
        let specs = angles.map { RepSpec(minElbowDeg: $0, downMs: 800, bottomHoldMs: 1500, upMs: 800, topRestMs: 600) }
        let sim = simulateSession(standardSet(specs))
        return (sim, sim.reps.map { $0.tStart + 800 + 1500 - 2 * FRAME })
    }

    func testDepthLineSteadyFramesDepthMinusDownThresholdMatchesTheDistanceToTheLine() {
        let s = depthLineSetup()
        checkSteadyIdentity(s.sim.frames, s.holdEnds)
    }

    func testDepthLineTheSameHoldsWithTheWristsHidden() {
        let s = depthLineSetup()
        checkSteadyIdentity(alterWindow(s.sim.frames, 4000, .infinity, hideWrists), s.holdEnds)
    }

    func testDepthLineDuringASlowPushUpDepthEqualsDownThresholdWhereTheShouldersCrossTheLine() {
        let down = CFG.downThreshold
        let slow = simulateSession(standardSet([RepSpec(minElbowDeg: 70, downMs: 4000, bottomHoldMs: 200, upMs: 4000)]))
        let r = runCounter(slow.frames)
        var crossings: [Double] = []
        for i in 1..<r.snapshots.count {
            let a = r.snapshots[i - 1]
            let b = r.snapshots[i]
            guard let ya = a.features.shoulderMid?.y, let yb = b.features.shoulderMid?.y,
                  let la = a.depthLineY, let lb = b.depthLineY,
                  let da = a.depth, let db = b.depth else { continue }
            let ga = ya - la
            let gb = yb - lb
            // JS Math.sign(0) is 0 (distinct from ±1); Swift's FloatingPointSign has no zero, so compare signs by value.
            func sign(_ x: Double) -> Int { x > 0 ? 1 : (x < 0 ? -1 : 0) }
            if ga == 0 || sign(ga) != sign(gb) {
                // Interpolate depth to the exact crossing.
                let k = ga / (ga - gb)
                crossings.append(da + k * (db - da))
            }
        }
        XCTAssertEqual(crossings.count, 2) // once on the way down, once on the way up
        // Within the smoothing lag of a 4-second push-up.
        for d in crossings { XCTAssertLessThan(abs(d - down), 0.02) }
    }

    func testAStricterDepthSettingMovesTheLineLowerOnTheScreen() {
        let counter = RepCounter()
        let frames = simulateSession([.hold(ms: 5000)]).frames
        var before: CounterSnapshot?
        for f in frames.dropLast() { before = counter.update(f) }
        counter.setConfig { $0.downThreshold = 0.35 }
        let after = counter.update(frames.last!)
        XCTAssertNotNil(before?.depthLineY)
        XCTAssertGreaterThan(after.depthLineY!, before!.depthLineY!)
    }

    // =========================================================================
    // setConfig and reset

    func testSetConfigMidSetKeepsTheCountAndCalibrationNewValuesApplyFromThenOn() throws {
        let sim = simulateSession(standardSet(reps(8, RepSpec(minElbowDeg: 80))))
        let cut = sim.reps[2].tEnd + 300 // just after the 3rd rep
        let counter = RepCounter()
        let first = runCounter(sim.frames.filter { $0.t < cut }, nil, counter: counter)
        XCTAssertEqual(first.finalCount, 3)
        let baseline = try XCTUnwrap(first.snapshots.last?.baselineRatio)

        counter.setConfig {
            $0.targetReps = 5
            $0.downThreshold = 0.3
            $0.smoothing.beta = 1.0
        }
        let cfg = counter.config
        XCTAssertEqual(cfg.targetReps, 5)
        XCTAssertEqual(cfg.downThreshold, 0.3)
        XCTAssertEqual(cfg.smoothing.beta, 1.0)
        XCTAssertEqual(cfg.smoothing.minCutoff, CFG.smoothing.minCutoff)
        XCTAssertEqual(cfg.upThreshold, CFG.upThreshold)

        let rest = runCounter(sim.frames.filter { $0.t >= cut }, nil, counter: counter)
        assertCloseTo(rest.snapshots[0].baselineRatio, baseline, digits: 3)
        XCTAssertEqual(rest.snapshots[0].phase, .counting)
        // No recalibration, and counting continues from 3 to the NEW target of 5.
        XCTAssertEqual(eventTypes(rest.events).filter { $0 == "start" || $0 == "countdownTick" || $0 == "inFrame" }, [])
        XCTAssertEqual(repEvents(rest.events).map(\.count), [4, 5])
        XCTAssertEqual(completeEvents(rest.events).first?.count, 5)
        XCTAssertEqual(rest.snapshots.last?.phase, .complete)
    }

    func testResetGoesBackToWaitingWithCount0KeepsTheConfigAndRecalibrates() {
        var cfg4 = DEFAULT_CONFIG
        cfg4.targetReps = 4
        let counter = RepCounter(cfg4)
        let a = simulateSession(standardSet(reps(3, RepSpec(minElbowDeg: 80)))).frames
        XCTAssertEqual(runCounter(a, nil, counter: counter).finalCount, 3)

        counter.reset()
        let b = simulateSession(standardSet(reps(2, RepSpec(minElbowDeg: 80))), SimOptions(startT: (a.last?.t ?? 0) + 5000)).frames
        let r = runCounter(b, nil, counter: counter)
        let firstSnap = r.snapshots[0]
        XCTAssertEqual(firstSnap.phase, .waiting)
        XCTAssertEqual(firstSnap.count, 0)
        XCTAssertNil(firstSnap.baselineRatio)
        XCTAssertNil(firstSnap.depthLineY)
        XCTAssertNil(firstSnap.startedAt)
        XCTAssertEqual(Array(eventTypes(r.events).prefix(5)), ["inFrame", "countdownTick", "countdownTick", "countdownTick", "start"])
        XCTAssertEqual(repEvents(r.events).map(\.count), [1, 2])
        XCTAssertEqual(counter.config.targetReps, 4)
    }
}
