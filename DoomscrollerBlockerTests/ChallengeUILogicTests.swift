import XCTest
@testable import DoomscrollerBlocker

final class ChallengeUILogicTests: XCTestCase {
    // MARK: Formatting

    func testFormatElapsed() {
        XCTAssertEqual(ChallengeUI.formatElapsed(ms: 26_400), "26 sec")
        XCTAssertEqual(ChallengeUI.formatElapsed(ms: 38_000), "38 sec")
        XCTAssertEqual(ChallengeUI.formatElapsed(ms: 59_400), "59 sec")
        XCTAssertEqual(ChallengeUI.formatElapsed(ms: 65_000), "1 min 05 sec")
        XCTAssertEqual(ChallengeUI.formatElapsed(ms: 125_000), "2 min 05 sec")
        XCTAssertEqual(ChallengeUI.formatElapsed(ms: -5), "0 sec")
    }

    func testPassTimeAndSubline() {
        XCTAssertEqual(ChallengeUI.formatPassTime(seconds: 30 * 60), "30:00")
        XCTAssertEqual(ChallengeUI.formatPassTime(seconds: 15 * 60), "15:00")
        XCTAssertEqual(ChallengeUI.formatPassTime(seconds: 5 * 60), "5:00")
        XCTAssertEqual(ChallengeUI.formatPassTime(seconds: 90 * 60), "1:30:00")
        XCTAssertEqual(ChallengeUI.passSubline(seconds: 30 * 60), "for 30 minutes")
        XCTAssertEqual(ChallengeUI.passSubline(seconds: 15 * 60), "for 15 minutes")
        XCTAssertEqual(ChallengeUI.passSubline(seconds: 60), "for 1 minute")
        XCTAssertEqual(ChallengeUI.passSubline(seconds: 60 * 60), "for 1 hour")
    }

    func testSuccessUsesTheRealPassDuration() {
        // The Success screen reads OpenLog.passDuration; whatever it is, the two strings agree with it.
        let seconds = OpenLog.passDuration
        let minutes = Int(seconds / 60)
        XCTAssertEqual(ChallengeUI.formatPassTime(seconds: seconds), String(format: "%d:00", minutes))
        XCTAssertEqual(ChallengeUI.passSubline(seconds: seconds), "for \(minutes) minutes")
    }

    // MARK: Countdown digit

    func testCountdownDigitShowsThreeTwoOne() {
        XCTAssertEqual(ChallengeUI.countdownDigit(remainingMs: 3000), 3)
        XCTAssertEqual(ChallengeUI.countdownDigit(remainingMs: 2999), 3)
        XCTAssertEqual(ChallengeUI.countdownDigit(remainingMs: 2000), 2)
        XCTAssertEqual(ChallengeUI.countdownDigit(remainingMs: 1500), 2)
        XCTAssertEqual(ChallengeUI.countdownDigit(remainingMs: 1000), 1)
        XCTAssertEqual(ChallengeUI.countdownDigit(remainingMs: 1), 1)
        XCTAssertEqual(ChallengeUI.countdownDigit(remainingMs: 0), 1)
        XCTAssertEqual(ChallengeUI.countdownDigit(remainingMs: nil), 3)
    }

    // MARK: Gauge

    func testGaugeFillLandsOnTheMarkAtTheDownThreshold() {
        // depth == downThreshold fills exactly to the mark: 80 %.
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: 0.25, downThreshold: 0.25, cueOn: false, attempt: .none, partialPeak: 0), 80)
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: 0, downThreshold: 0.25, cueOn: false, attempt: .none, partialPeak: 0), 0)
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: nil, downThreshold: 0.25, cueOn: false, attempt: .none, partialPeak: 0), 0)
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: 0.9, downThreshold: 0.25, cueOn: false, attempt: .none, partialPeak: 0), 100)
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: -0.1, downThreshold: 0.25, cueOn: false, attempt: .none, partialPeak: 0), 0)
        // lenient / strict presets keep the mark at 80 %.
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: 0.21, downThreshold: 0.21, cueOn: false, attempt: .none, partialPeak: 0), 80)
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: 0.29, downThreshold: 0.29, cueOn: false, attempt: .none, partialPeak: 0), 80)
    }

    func testGaugeHoldsAtThePartialPeakWhileTheCueShows() {
        // The user already came back up (depth 0.02), but the bar stays at the shallow rep's peak.
        let held = ChallengeUI.gaugePercent(depth: 0.02, downThreshold: 0.25, cueOn: true, attempt: .partial, partialPeak: 0.136)
        XCTAssertEqual(held, Int((0.136 / (0.25 / 0.8) * 100).rounded()))
        // Cue over, or not a partial: follows the live depth again.
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: 0.02, downThreshold: 0.25, cueOn: false, attempt: .partial, partialPeak: 0.136), 6)
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: 0.02, downThreshold: 0.25, cueOn: true, attempt: .reached, partialPeak: 0.136), 6)
        // A deeper live depth wins over the held peak.
        XCTAssertEqual(ChallengeUI.gaugePercent(depth: 0.2, downThreshold: 0.25, cueOn: true, attempt: .partial, partialPeak: 0.136), 64)
    }

    func testGaugeHeight() {
        XCTAssertEqual(ChallengeUI.gaugeHeight(midHeight: 567), 240) // 390 x 844
        XCTAssertEqual(ChallengeUI.gaugeHeight(midHeight: 300), 194)
        XCTAssertEqual(ChallengeUI.gaugeHeight(midHeight: 50), 0)
    }

    func testDepthLineStateFollowsTheAttempt() {
        XCTAssertEqual(ChallengeUI.depthLineState(attempt: .none, cueOn: false), .idle)
        XCTAssertEqual(ChallengeUI.depthLineState(attempt: .reached, cueOn: false), .reached)
        XCTAssertEqual(ChallengeUI.depthLineState(attempt: .partial, cueOn: true), .partial)
        XCTAssertEqual(ChallengeUI.depthLineState(attempt: .partial, cueOn: false), .idle)
    }

    // MARK: Cues

    func testCues() {
        XCTAssertTrue(ChallengeUI.cueOn(now: 100, cueUntil: 150, paused: false))
        XCTAssertFalse(ChallengeUI.cueOn(now: 150, cueUntil: 150, paused: false))
        XCTAssertFalse(ChallengeUI.cueOn(now: 100, cueUntil: 150, paused: true))
        XCTAssertTrue(ChallengeUI.chestCueOn(now: 100, chestUntil: 150, cueOn: false, paused: false))
        XCTAssertFalse(ChallengeUI.chestCueOn(now: 100, chestUntil: 150, cueOn: true, paused: false))
        XCTAssertFalse(ChallengeUI.chestCueOn(now: 100, chestUntil: 150, cueOn: false, paused: true))
        XCTAssertFalse(ChallengeUI.chestCueOn(now: 150, chestUntil: 150, cueOn: false, paused: false))
    }

    // MARK: Copy

    func testPausedCopyTable() {
        XCTAssertEqual(ChallengeUI.pausedCopy(hint: .getInFrame, reason: .lost),
                       .init(title: "Can't\nsee you", tip1: "Head and shoulders in frame", tip2: "Phone about 3 ft away"))
        XCTAssertEqual(ChallengeUI.pausedCopy(hint: .handsInView, reason: .lost),
                       .init(title: "Hands\nin view", tip1: "Hands on the floor, in the picture", tip2: "Phone about 3 ft away"))
        XCTAssertEqual(ChallengeUI.pausedCopy(hint: .moveCloser, reason: .lost),
                       .init(title: "Move\ncloser", tip1: "Phone about 3 ft away", tip2: "Head toward the phone"))
        XCTAssertEqual(ChallengeUI.pausedCopy(hint: .moveBack, reason: .outOfPlank),
                       .init(title: "Move\nback", tip1: "Phone about 3 ft away", tip2: "Head and shoulders in frame"))
        let back = ChallengeUI.PausedCopy(title: "Back to\nplank", tip1: "Hands on the floor, arms straight", tip2: "Head toward the phone")
        XCTAssertEqual(ChallengeUI.pausedCopy(hint: nil, reason: .outOfPlank), back)
        XCTAssertEqual(ChallengeUI.pausedCopy(hint: .backToPlank, reason: .lost), back)
        // Anything else, including the 0.3 s wait for a resume (hint nil, reason lost).
        XCTAssertEqual(ChallengeUI.pausedCopy(hint: nil, reason: .lost).title, "Can't\nsee you")
        XCTAssertEqual(ChallengeUI.pausedCopy(hint: .holdStill, reason: nil).title, "Can't\nsee you")
    }

    func testPlacementHints() {
        XCTAssertEqual(ChallengeUI.placementHint(nil).text, "Get in a plank, head toward the phone")
        XCTAssertEqual(ChallengeUI.placementHint(.getInFrame).text, "Get your head, shoulders and hands in view")
        XCTAssertEqual(ChallengeUI.placementHint(.handsInView).icon, .hand)
        XCTAssertEqual(ChallengeUI.placementHint(.moveCloser).text, "Move closer")
        XCTAssertEqual(ChallengeUI.placementHint(.moveBack).icon, .move)
        XCTAssertEqual(ChallengeUI.placementHint(.holdStill).text, "Hold still")
        XCTAssertEqual(ChallengeUI.placementHint(.holdStill).icon, .pause)
    }

    // MARK: Sizes

    func testScreenDependentSizesAt390x844() {
        XCTAssertEqual(ChallengeUI.countFontSize(screenHeight: 844), 200)
        XCTAssertEqual(ChallengeUI.countFontSize(screenHeight: 667), 0.27 * 667, accuracy: 0.001)
        XCTAssertEqual(ChallengeUI.countdownFontSize(screenHeight: 844), 150)
        XCTAssertEqual(ChallengeUI.plusOneFontSize(screenHeight: 844), 92.84, accuracy: 0.001)
        XCTAssertEqual(ChallengeUI.plusOneFontSize(screenHeight: 400), 56)
        XCTAssertEqual(ChallengeUI.plusOneFontSize(screenHeight: 2000), 128)
        XCTAssertFalse(ChallengeUI.demoTagShowsLabel(screenWidth: 390))
        XCTAssertTrue(ChallengeUI.demoTagShowsLabel(screenWidth: 430))
    }

    // MARK: The "+1"

    func testPlusOneKeyframes() {
        let start = ChallengeUI.plusOnePose(atMs: 0)
        XCTAssertEqual(start.opacity, 0, accuracy: 1e-9)
        XCTAssertEqual(start.offsetY, 0.2, accuracy: 1e-9)
        XCTAssertEqual(start.scale, 0.6, accuracy: 1e-9)

        let pop = ChallengeUI.plusOnePose(atMs: 0.14 * 950)
        XCTAssertEqual(pop.opacity, 1, accuracy: 1e-6)
        XCTAssertEqual(pop.offsetY, 0, accuracy: 1e-6)
        XCTAssertEqual(pop.scale, 1.15, accuracy: 1e-6)

        let settled = ChallengeUI.plusOnePose(atMs: 0.30 * 950)
        XCTAssertEqual(settled.offsetY, -0.1, accuracy: 1e-6)
        XCTAssertEqual(settled.scale, 1, accuracy: 1e-6)

        // Opacity holds at 1 until 70 %, then fades to 0; it ends 1.2 font sizes up.
        XCTAssertEqual(ChallengeUI.plusOnePose(atMs: 0.5 * 950).opacity, 1)
        XCTAssertEqual(ChallengeUI.plusOnePose(atMs: 0.7 * 950).opacity, 1, accuracy: 1e-6)
        let end = ChallengeUI.plusOnePose(atMs: 950)
        XCTAssertEqual(end.opacity, 0, accuracy: 1e-9)
        XCTAssertEqual(end.offsetY, -1.2, accuracy: 1e-9)
        XCTAssertEqual(ChallengeUI.plusOnePose(atMs: 5000), end)
    }

    func testPlusOnePlacement() {
        let layer = CGSize(width: 390, height: 844)
        let fontSize = ChallengeUI.plusOneFontSize(screenHeight: 844)
        // Spec example: chips bottom 61, font 92.8 -> minTop 223.5, max 764.
        let low = ChallengeUI.plusOnePlacement(anchor: CGPoint(x: 195, y: 100), layer: layer, chipsBottom: 61, fontSize: fontSize)
        XCTAssertEqual(low.y, 223.5, accuracy: 0.1)
        let high = ChallengeUI.plusOnePlacement(anchor: CGPoint(x: 195, y: 900), layer: layer, chipsBottom: 61, fontSize: fontSize)
        XCTAssertEqual(high.y, 764)
        let side = ChallengeUI.plusOnePlacement(anchor: CGPoint(x: 5, y: 400), layer: layer, chipsBottom: 61, fontSize: fontSize)
        XCTAssertEqual(side.x, 60)
        let none = ChallengeUI.plusOnePlacement(anchor: nil, layer: layer, chipsBottom: 61, fontSize: fontSize)
        XCTAssertEqual(none.x, 195)
        XCTAssertEqual(none.y, 844 * 0.45, accuracy: 0.001)
    }

    func testCubicBezierEndpointsAndShape() {
        let ease = CubicBezier(x1: 0.2, y1: 0.8, x2: 0.2, y2: 1)
        XCTAssertEqual(ease.value(at: 0), 0)
        XCTAssertEqual(ease.value(at: 1), 1)
        XCTAssertGreaterThan(ease.value(at: 0.5), 0.8) // ease-out: most of the move happens early
        // The bump curve overshoots (y2 > 1).
        let bump = CubicBezier(x1: 0.2, y1: 1.6, x2: 0.4, y2: 1)
        XCTAssertGreaterThan(bump.value(at: 0.3), 1)
    }

    // MARK: Demo through the session

    @MainActor
    func testDemoSessionRunsTheRealCounterToSuccess() {
        let session = ChallengeSession()
        session.reps = 10
        session.start(.demo)
        XCTAssertEqual(session.screen, .stage)
        session.demoPause()
        // The spec's timeline (UI_SPEC §5.3): rep 1 at frame #211, partial at #389, rep 10 + complete at #937.
        session.demoStep(to: 212)
        XCTAssertEqual(session.snapshot?.count, 1)
        XCTAssertEqual(session.repTick, 1)
        session.demoStep(to: 390)
        XCTAssertEqual(session.snapshot?.count, 3)
        XCTAssertGreaterThan(session.cueUntil, session.snapshot?.features.t ?? .infinity)
        XCTAssertEqual(session.attempt, .partial)
        session.demoStep(to: 460)
        XCTAssertEqual(session.snapshot?.phase, .paused)
        session.demoStep(to: 940)
        XCTAssertEqual(session.snapshot?.count, 10)
        session.demoStep(to: 1000)
        if case .success(let count, let elapsed) = session.screen {
            XCTAssertEqual(count, 10)
            XCTAssertEqual(ChallengeUI.formatElapsed(ms: elapsed), "26 sec")
        } else {
            XCTFail("expected Success, got \(session.screen)")
        }
        session.stop()
    }
}
