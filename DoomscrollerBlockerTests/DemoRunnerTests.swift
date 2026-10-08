import XCTest
@testable import DoomscrollerBlocker

/// Port of web-prototype/tests/demoRunner.test.ts and demoScript.test.ts,
/// plus the exact timeline of docs/UI_SPEC.md section 5.3.
///
/// The web test drives the player with a fake requestAnimationFrame; here the
/// display clock is just the argument of `advance(toMs:)`.

private func blankFrames(_ n: Int) -> [PoseFrame] {
    (0..<n).map { PoseFrame(t: Double($0) * 100, aspect: 0.75, joints: nil, world: nil) }
}

final class DemoRunnerPlaybackTests: XCTestCase {
    func testPlaysFramesInRealTimeFromTheDisplayClock() {
        var played: [Double] = []
        let runner = DemoRunner(frames: blankFrames(10))
        runner.onFrame = { played.append($0.frame.t) }
        runner.play(atMs: 5000)
        runner.advance(toMs: 5000 + 150)
        XCTAssertEqual(played, [0, 100])
        XCTAssertEqual(runner.position, 2)
    }

    func testAdvanceReturnsTheFramesPlayedWithTheirSnapshots() {
        let runner = DemoRunner(frames: blankFrames(10))
        runner.play(atMs: 0)
        let out = runner.advance(toMs: 250)
        XCTAssertEqual(out.map(\.index), [0, 1, 2])
        XCTAssertEqual(out.map(\.frame.t), [0, 100, 200])
        XCTAssertEqual(runner.latest?.index, 2)
        XCTAssertEqual(out[0].snapshot.phase, .waiting)
    }

    func testNothingPlaysBeforePlayAndSimulatedTimeStandsStillWhilePaused() {
        var played: [Double] = []
        let runner = DemoRunner(frames: blankFrames(10))
        runner.onFrame = { played.append($0.frame.t) }
        XCTAssertTrue(runner.advance(toMs: 1000).isEmpty) // not playing yet
        runner.play(atMs: 0)
        runner.advance(toMs: 150)
        XCTAssertEqual(played, [0, 100])
        runner.pause()
        XCTAssertFalse(runner.isPlaying)
        XCTAssertTrue(runner.advance(toMs: 10_000).isEmpty)
        // Resume much later: only the time since play(atMs:) counts, not the pause.
        runner.play(atMs: 10_000)
        runner.advance(toMs: 10_050) // sim clock 149 + 50 = 199: frame 200 isn't due yet
        XCTAssertEqual(played, [0, 100])
        runner.advance(toMs: 10_060)
        XCTAssertEqual(played, [0, 100, 200])
    }

    func testAfterAHiccupItCatchesUpAtMost4FramesPerTickAndNeverFastForwards() {
        var played: [Double] = []
        let runner = DemoRunner(frames: blankFrames(40)) // 0 ... 3900 ms
        runner.onFrame = { played.append($0.frame.t) }
        runner.play(atMs: 0)
        runner.advance(toMs: 20) // frame 0
        XCTAssertEqual(played, [0])
        runner.advance(toMs: 20 + 10_000) // a 10 s hiccup
        XCTAssertEqual(played, [0, 100, 200, 300, 400]) // only 4 more, not the other 35
        // The clock was reset to just before the next frame: the next tick plays ONE frame.
        runner.advance(toMs: 20 + 10_000 + 100)
        XCTAssertEqual(played, [0, 100, 200, 300, 400, 500])
    }

    func testPauseFromInsideAFrameIsRespectedImmediately() {
        var played: [Double] = []
        let runner = DemoRunner(frames: blankFrames(10))
        runner.onFrame = { f in
            played.append(f.frame.t)
            if f.frame.t == 100 { runner.pause() }
        }
        runner.play(atMs: 0)
        runner.advance(toMs: 500) // four frames are due, but pause() came at the second
        XCTAssertEqual(played, [0, 100])
        XCTAssertFalse(runner.isPlaying)
    }

    func testStopFromInsideAFrameEndsPlaybackForGood() {
        var played: [Double] = []
        var ended = false
        let runner = DemoRunner(frames: blankFrames(10))
        runner.onEnd = { ended = true }
        runner.onFrame = { f in
            played.append(f.frame.t)
            if f.frame.t == 100 { runner.stop() }
        }
        runner.play(atMs: 0)
        runner.advance(toMs: 500)
        XCTAssertEqual(played, [0, 100])
        runner.play(atMs: 600)
        XCTAssertFalse(runner.isPlaying)
        XCTAssertTrue(runner.step(frames: 5).isEmpty)
        XCTAssertTrue(runner.isFinished)
        XCTAssertFalse(ended) // stopped, not finished: no onEnd
    }

    func testStepPlaysFramesSynchronouslyReturnsThemAndStopsAtTheEndWithOneOnEnd() {
        var played: [Double] = []
        var endCount = 0
        let runner = DemoRunner(frames: blankFrames(10))
        runner.onFrame = { played.append($0.frame.t) }
        runner.onEnd = { endCount += 1 }
        XCTAssertEqual(runner.step(frames: 3).map(\.index), [0, 1, 2])
        XCTAssertEqual(runner.position, 3)
        XCTAssertEqual(runner.step(frames: 0).count, 0)
        XCTAssertEqual(runner.step(frames: -4).count, 0)
        XCTAssertEqual(runner.step(frames: 100).count, 7) // fewer at the end of the demo
        XCTAssertEqual(played.count, 10)
        XCTAssertEqual(endCount, 1)
        XCTAssertTrue(runner.isFinished)
        XCTAssertEqual(runner.step(frames: 1).count, 0)
        XCTAssertEqual(endCount, 1)
        // Playing after the end does nothing.
        runner.play(atMs: 0)
        XCTAssertFalse(runner.isPlaying)
    }

    func testReachingTheLastFrameInRealTimeEndsPlaybackOnce() {
        var endCount = 0
        let runner = DemoRunner(frames: blankFrames(3))
        runner.onEnd = { endCount += 1 }
        runner.play(atMs: 0)
        runner.advance(toMs: 1000)
        XCTAssertEqual(runner.position, 3)
        XCTAssertEqual(endCount, 1)
        XCTAssertFalse(runner.isPlaying)
        XCTAssertTrue(runner.advance(toMs: 2000).isEmpty)
        XCTAssertEqual(endCount, 1)
    }

    func testStateReportsTheDevHookFields() {
        let runner = DemoRunner(targetReps: 10)
        XCTAssertEqual(runner.state.frame, 0)
        XCTAssertEqual(runner.state.frames, runner.total)
        XCTAssertEqual(runner.state.target, 10)
        XCTAssertNil(runner.state.phase)
        runner.step(frames: 300) // 10 s of simulated time
        let s = runner.state
        XCTAssertEqual(s.frame, 300)
        XCTAssertEqual(s.phase, .counting)
        XCTAssertNotNil(s.depthLineY)
        XCTAssertEqual(s.issue, .none)
    }
}

final class DemoScriptTests: XCTestCase {
    /// The App waits this long after 'complete' before showing Success (App.SUCCESS_DELAY_MS).
    private let SUCCESS_DELAY_MS = 600.0

    struct DemoRun {
        var events: [CounterEvent]
        var issues: [TrackingIssue]
        var frames: [PoseFrame]
        var finalCount: Int
        var played: [DemoFrame]
    }

    /// Plays the demo the way App does: counter with the default settings, then the tracking-issue detector.
    private func playDemo(_ target: Int, _ wholeFrameVisible: Bool) -> DemoRun {
        let runner = DemoRunner(targetReps: target, options: DemoOptions(wholeFrameVisible: wholeFrameVisible))
        let played = runner.step(frames: runner.total)
        return DemoRun(
            events: played.flatMap(\.snapshot.events),
            issues: played.map(\.issue),
            frames: runner.frames,
            finalCount: played.last?.snapshot.count ?? 0,
            played: played
        )
    }

    /// Index of the first event of this type at or after `from` (-1 if none).
    private func indexOf(_ events: [CounterEvent], _ type: String, from: Int = 0) -> Int {
        for i in from..<events.count where events[i].type == type { return i }
        return -1
    }

    private func checkStory(_ target: Int, _ wholeFrameVisible: Bool) throws {
        let run = playDemo(target, wholeFrameVisible)
        let events = run.events
        let reps = repEvents(events)

        // Exactly the target: the shallow rep must never count.
        XCTAssertEqual(run.finalCount, target)
        XCTAssertEqual(reps.count, target)

        // start → 3 good reps → shallow rep → out of view (paused) → back → more reps → complete.
        let start = indexOf(events, "start")
        XCTAssertGreaterThanOrEqual(start, 0)
        let partial = indexOf(events, "partial", from: start)
        XCTAssertGreaterThan(partial, start)
        XCTAssertEqual(events[start..<partial].filter { $0.type == "rep" }.count, 3)
        let paused = indexOf(events, "paused", from: partial)
        XCTAssertGreaterThan(paused, partial)
        if case .paused(_, let reason) = events[paused] { XCTAssertEqual(reason, .lost) } else { XCTFail("not a paused event") }
        let resumed = indexOf(events, "resumed", from: paused)
        XCTAssertGreaterThan(resumed, paused)
        XCTAssertEqual(events[partial..<resumed].filter { $0.type == "rep" }.count, 0)
        let complete = indexOf(events, "complete", from: resumed)
        XCTAssertGreaterThan(complete, resumed)

        // The App shows Success by frame time SUCCESS_DELAY_MS after 'complete' (that's what
        // the dev hook's step() relies on), so frames must keep coming that long.
        let lastT = run.frames.last?.t ?? 0
        XCTAssertEqual(events[complete].type, "complete")
        XCTAssertGreaterThanOrEqual(lastT - events[complete].t, SUCCESS_DELAY_MS)

        // The fake picture is never "too dark", and tracking is fine at the end.
        XCTAssertFalse(run.issues.contains(.tooDark))
        XCTAssertEqual(run.issues.last, TrackingIssue.none)
    }

    func testTellsTheWholeStoryFor5RepsLaptop() throws { try checkStory(5, true) }
    func testTellsTheWholeStoryFor5RepsPhone() throws { try checkStory(5, false) }
    func testTellsTheWholeStoryFor10RepsLaptop() throws { try checkStory(10, true) }
    func testTellsTheWholeStoryFor10RepsPhone() throws { try checkStory(10, false) }
    func testTellsTheWholeStoryFor30RepsLaptop() throws { try checkStory(30, true) }
    func testTellsTheWholeStoryFor30RepsPhone() throws { try checkStory(30, false) }

    func testAlsoCompletesForTargetsBelowThePartialRepPart1to3Reps() {
        for target in [1, 2, 3] {
            let run = playDemo(target, true)
            XCTAssertEqual(run.finalCount, target)
            XCTAssertTrue(run.events.contains { $0.type == "complete" })
            // Too few reps for the shallow-rep and walk-away part of the story.
            let hasShallow = demoSegments(target).contains { if case .rep(let s) = $0 { return s.minElbowDeg > 100 } else { return false } }
            XCTAssertFalse(hasShallow)
        }
    }

    func testStartsItsClockAtDemoStartTAndIsTheSameEveryTime() {
        let a = buildDemoSession(10, DemoOptions(wholeFrameVisible: true))
        let b = buildDemoSession(10, DemoOptions(wholeFrameVisible: true))
        XCTAssertEqual(a.frames[0].t, DEMO_START_T)
        XCTAssertEqual(b.frames, a.frames)
    }

    /// Laptop: the whole picture shows (object-fit: contain).
    /// Phone: object-fit: cover on a tall screen crops the sides. 390×844 (iPhone 12–15)
    /// is about the narrowest screen shape there is, so it crops the most.
    func testKeepsThePersonInsideTheVisiblePicture() {
        // fitRect of web-prototype/src/ui/overlay.ts
        func fitRect(_ vw: Double, _ vh: Double, _ bw: Double, _ bh: Double, cover: Bool) -> (x: Double, y: Double, w: Double, h: Double) {
            let scale = cover ? max(bw / vw, bh / vh) : min(bw / vw, bh / vh)
            let w = vw * scale
            let h = vh * scale
            return ((bw - w) / 2, (bh - h) / 2, w, h)
        }
        let screens: [(whole: Bool, w: Double, h: Double, cover: Bool)] = [
            (true, 1280, 800, false),
            (false, 390, 844, true),
        ]
        for screen in screens {
            let session = buildDemoSession(10, DemoOptions(wholeFrameVisible: screen.whole))
            let r = fitRect(session.geometry.imageW, session.geometry.imageH, screen.w, screen.h, cover: screen.cover)
            // Visible part of the picture, as fractions of its width/height.
            let x0 = max(0, -r.x / r.w)
            let x1 = min(1, (screen.w - r.x) / r.w)
            for frame in session.frames {
                guard let joints = frame.joints else { continue }
                for (_, j) in joints.values where j.c >= 0.5 {
                    let fx = j.x / frame.aspect
                    XCTAssertGreaterThanOrEqual(fx, x0)
                    XCTAssertLessThanOrEqual(fx, x1)
                    XCTAssertGreaterThanOrEqual(j.y, 0)
                    XCTAssertLessThanOrEqual(j.y, 1)
                }
            }
        }
    }

    // --- docs/UI_SPEC.md 5.2 / 5.3: the exact numbers of the 10-rep phone demo ----

    func testTenRepPhoneDemoHas1031FramesFrom1000msTo35333ms() {
        let s = buildDemoSession(10)
        XCTAssertEqual(s.frames.count, 1031)
        XCTAssertEqual(s.frames.first?.t, 1000)
        XCTAssertEqual(s.frames.last?.t ?? .nan, 35333, accuracy: 1)
        XCTAssertEqual(s.geometry.imageW, 480)
        XCTAssertEqual(s.geometry.imageH, 640)
        XCTAssertEqual(s.geometry.headDistance, 1.3)
        XCTAssertEqual(buildDemoSession(10, DemoOptions(wholeFrameVisible: true)).geometry.headDistance, 1.0)
        // An absent frame is { t, aspect: 0.75, joints: nil }.
        XCTAssertNil(s.frames[0].joints)
        XCTAssertEqual(s.frames[0].aspect, 0.75)
    }

    func testTimelineMatchesTheSpecTable() {
        let run = playDemo(10, false)
        func frameIndex(where match: (CounterEvent) -> Bool) -> Int? {
            run.played.first { $0.snapshot.events.contains(where: match) }?.index
        }
        func nth(_ n: Int, where match: (CounterEvent) -> Bool) -> Int? {
            run.played.filter { $0.snapshot.events.contains(where: match) }.dropFirst(n - 1).first?.index
        }
        // (frame index → event), UI_SPEC 5.3
        XCTAssertEqual(run.played[0].snapshot.hint, .getInFrame) // #0
        XCTAssertEqual(run.played[36].snapshot.hint, .holdStill) // #36
        XCTAssertEqual(frameIndex { $0.type == "inFrame" }, 54)
        XCTAssertEqual(frameIndex { if case .countdownTick(_, 2) = $0 { return true } else { return false } }, 84)
        XCTAssertEqual(frameIndex { if case .countdownTick(_, 1) = $0 { return true } else { return false } }, 115)
        XCTAssertEqual(frameIndex { $0.type == "start" }, 145)
        XCTAssertEqual(frameIndex { $0.type == "depthReached" }, 186)
        let repFrames = (1...10).compactMap { n in nth(n) { $0.type == "rep" } }
        XCTAssertEqual(repFrames, [211, 274, 337, 565, 627, 691, 750, 813, 876, 937])
        XCTAssertEqual(frameIndex { $0.type == "partial" }, 389)
        XCTAssertEqual(frameIndex { $0.type == "paused" }, 452)
        XCTAssertEqual(frameIndex { $0.type == "resumed" }, 493)
        XCTAssertEqual(frameIndex { $0.type == "complete" }, 937)
        let start = run.played[145].snapshot
        XCTAssertEqual(start.baselineRatio ?? .nan, 1.485, accuracy: 0.001)
        XCTAssertEqual(start.depthLineY ?? .nan, 0.423, accuracy: 0.001)
        if case .complete(_, let count, let elapsed) = run.played[937].snapshot.events.last(where: { $0.type == "complete" })! {
            XCTAssertEqual(count, 10)
            XCTAssertEqual(elapsed, 26400, accuracy: 1)
        }
        if case .partial(_, let peak, let live) = run.played[389].snapshot.events.first(where: { $0.type == "partial" })! {
            XCTAssertEqual(peak, 0.136, accuracy: 0.001)
            XCTAssertTrue(live)
        }
        // "Success" is due about 600 ms after the last rep, while frames still come.
        XCTAssertLessThan(run.played.count - 937, 100)
    }

    func testSuccessIsDue600msAfterCompleteByFrameTime() {
        let runner = DemoRunner(targetReps: 10)
        runner.step(frames: 937) // up to, not including, the frame with rep 10 + complete
        XCTAssertNil(runner.successDueAtMs)
        XCTAssertFalse(runner.isSuccessDue)
        runner.step(frames: 1)
        XCTAssertEqual(runner.state.phase, .complete)
        let due = runner.successDueAtMs
        XCTAssertNotNil(due)
        XCTAssertEqual((due ?? 0) - (runner.latest?.frame.t ?? 0), 600, accuracy: 1e-9)
        XCTAssertFalse(runner.isSuccessDue)
        var steps = 0
        while !runner.isSuccessDue, steps < 100 {
            runner.step(frames: 1)
            steps += 1
        }
        XCTAssertTrue(runner.isSuccessDue)
        XCTAssertLessThanOrEqual(steps, 20) // 600 ms = 18 frames at 30 fps
    }

    func testDemoEndsWithCountEqualToTargetAndACompleteEvent() {
        let runner = DemoRunner(targetReps: 10)
        var events: [CounterEvent] = []
        var ended = false
        runner.onEnd = { ended = true }
        runner.onFrame = { events.append(contentsOf: $0.snapshot.events) }
        runner.play(atMs: 0)
        var now = 0.0
        while !runner.isFinished {
            now += 1000.0 / 60 // a 60 Hz display link
            runner.advance(toMs: now)
        }
        XCTAssertTrue(ended)
        XCTAssertEqual(runner.state.count, 10)
        XCTAssertEqual(runner.latest?.snapshot.phase, .complete)
        XCTAssertEqual(completeEvents(events).count, 1)
        // Real time: the demo takes about as long as its simulated length (1031 frames ≈ 34.3 s).
        XCTAssertEqual(now, 34_333, accuracy: 200)
    }
}
