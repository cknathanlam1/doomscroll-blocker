import CoreGraphics
import Foundation

// The small pure rules behind the challenge screens (docs/UI_SPEC.md §2 and §4):
// copy tables, gauge maths, formatting, the "+1" animation curve. No SwiftUI
// here, so they are unit-tested (DoomscrollerBlockerTests/ChallengeUILogicTests).

/// `min(max(v, lo), hi)` (the Core has its own file-private `clamp`).
func clampValue<T: Comparable>(_ v: T, _ lo: T, _ hi: T) -> T { min(hi, max(lo, v)) }

enum ChallengeUI {
    // MARK: Sizes that depend on the screen (UI_SPEC §1.3)

    /// `#count`: `min(200, 27% of screen height)`.
    static func countFontSize(screenHeight h: CGFloat) -> CGFloat { min(200, 0.27 * h) }
    /// `#cd-n`: `min(150, 20% of screen height)`.
    static func countdownFontSize(screenHeight h: CGFloat) -> CGFloat { min(150, 0.20 * h) }
    /// `.plus-one`: `clampValue(56, 11% of screen height, 128)`.
    static func plusOneFontSize(screenHeight h: CGFloat) -> CGFloat { clampValue(0.11 * h, 56, 128) }
    /// The demo tag's "Demo" label is hidden on screens ≤ 400 pt wide (UI_SPEC §2.4.11).
    static func demoTagShowsLabel(screenWidth w: CGFloat) -> Bool { w > 400 }

    // MARK: Countdown

    /// `max(1, ceil(countdownRemainingMs / 1000))`, so it shows 3, 2, 1.
    static func countdownDigit(remainingMs: Double?) -> Int {
        max(1, Int(((remainingMs ?? 3000) / 1000).rounded(.up)))
    }

    // MARK: Gauge (UI_SPEC §2.4.5)

    /// Where the gauge mark sits, as a fraction of the track from the bottom.
    static let gaugeMarkAt = 0.8

    /// Fill height in whole percent.
    static func gaugePercent(depth: Double?, downThreshold: Double, cueOn: Bool, attempt: AttemptLook, partialPeak: Double) -> Int {
        let full = downThreshold / gaugeMarkAt
        var frac = clampValue((depth ?? 0) / full, 0, 1)
        if cueOn && attempt == .partial { frac = max(frac, clampValue(partialPeak / full, 0, 1)) }
        return Int((frac * 100).rounded())
    }

    /// Track height: `min(240, ch-mid height − 106)`.
    static func gaugeHeight(midHeight: CGFloat) -> CGFloat { max(0, min(240, midHeight - 106)) }

    enum DepthLineState: Equatable { case idle, reached, partial }

    /// How the depth line should look (same colours as the gauge, so they always agree).
    static func depthLineState(attempt: AttemptLook, cueOn: Bool) -> DepthLineState {
        if attempt == .reached { return .reached }
        if attempt == .partial && cueOn { return .partial }
        return .idle
    }

    // MARK: Cues

    /// "Go lower" is on while `now < cueUntil`, never while paused.
    static func cueOn(now: Double, cueUntil: Double, paused: Bool) -> Bool { now < cueUntil && !paused }

    /// The chest-not-head cue: 1.5 s after the last `chestNotHead` frame, hidden while "Go lower" shows or paused.
    static func chestCueOn(now: Double, chestUntil: Double, cueOn: Bool, paused: Bool) -> Bool {
        now < chestUntil && !cueOn && !paused
    }

    // MARK: Placement hint (UI_SPEC §2.3)

    struct PlacementHint: Equatable {
        var text: String
        var icon: Icon
    }

    static func placementHint(_ hint: CounterHint?) -> PlacementHint {
        switch hint {
        case nil: return .init(text: "Get in a plank, head toward the phone", icon: .person)
        case .getInFrame?: return .init(text: "Get your head, shoulders and hands in view", icon: .person)
        case .handsInView?: return .init(text: "Hands in view", icon: .hand)
        case .moveCloser?: return .init(text: "Move closer", icon: .move)
        case .moveBack?: return .init(text: "Move back", icon: .move)
        case .holdStill?: return .init(text: "Hold still", icon: .pause)
        case .backToPlank?: return .init(text: "Back to plank", icon: .person)
        case .chestNotHead?: return .init(text: "Chest down, not just your head", icon: .down)
        }
    }

    // MARK: Paused copy (UI_SPEC §2.4.9)

    struct PausedCopy: Equatable {
        /// Two lines, `\n` separated.
        var title: String
        var tip1: String
        var tip2: String
    }

    static func pausedCopy(hint: CounterHint?, reason: PauseReason?) -> PausedCopy {
        let distance = "Phone about 3 ft away"
        switch hint {
        case .getInFrame?:
            return .init(title: "Can't\nsee you", tip1: "Head and shoulders in frame", tip2: distance)
        case .handsInView?:
            return .init(title: "Hands\nin view", tip1: "Hands on the floor, in the picture", tip2: distance)
        case .moveCloser?:
            return .init(title: "Move\ncloser", tip1: distance, tip2: "Head toward the phone")
        case .moveBack?:
            return .init(title: "Move\nback", tip1: distance, tip2: "Head and shoulders in frame")
        default:
            break
        }
        if reason == .outOfPlank || hint == .backToPlank {
            return .init(title: "Back to\nplank", tip1: "Hands on the floor, arms straight", tip2: "Head toward the phone")
        }
        return .init(title: "Can't\nsee you", tip1: "Head and shoulders in frame", tip2: distance)
    }

    // MARK: Formatting

    /// `38 sec`, or `1 min 05 sec` from 60 s up (UI_SPEC §2.6).
    static func formatElapsed(ms: Double) -> String {
        let total = max(0, Int((ms / 1000).rounded()))
        if total < 60 { return "\(total) sec" }
        return "\(total / 60) min \(String(format: "%02d", total % 60)) sec"
    }

    /// The big time on Success: `30:00` for a 30 minute pass, `1:00:00` from an hour up.
    static func formatPassTime(seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        if h > 0 { return String(format: "%d:%02d:%02d", h, m, s) }
        return String(format: "%d:%02d", m, s)
    }

    /// `for 30 minutes` (singular for exactly one minute; seconds below a minute).
    static func passSubline(seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds.rounded()))
        if total >= 60 && total % 60 == 0 {
            let m = total / 60
            if m % 60 == 0 && m >= 60 {
                let h = m / 60
                return "for \(h) hour\(h == 1 ? "" : "s")"
            }
            return "for \(m) minute\(m == 1 ? "" : "s")"
        }
        if total >= 60 { return "for \(formatPassTime(seconds: seconds))" }
        return "for \(total) second\(total == 1 ? "" : "s")"
    }

    // MARK: The floating "+1" (UI_SPEC §2.4.10)

    static let plusOneDurationMs = 950.0
    static let plusOneSafetyMs = 1500.0

    struct PlusOnePose: Equatable {
        var opacity: Double
        /// Offset of the text's centre from its anchor, in font sizes (negative = up).
        var offsetY: Double
        var scale: Double
    }

    /// The keyframes of `@keyframes plus-one` at `ms` after it started. The CSS timing
    /// function `cubic-bezier(0.2, 0.8, 0.2, 1)` applies to each keyframe segment of
    /// each property separately.
    static func plusOnePose(atMs ms: Double) -> PlusOnePose {
        let p = clampValue(ms / plusOneDurationMs, 0, 1)
        let ease = CubicBezier(x1: 0.2, y1: 0.8, x2: 0.2, y2: 1)
        func seg(_ a: Double, _ b: Double, _ from: Double, _ to: Double) -> Double {
            from + (to - from) * ease.value(at: (p - a) / (b - a))
        }
        // transform keyframes at 0 / 14 / 30 / 100 %
        let offsetY: Double, scale: Double
        if p < 0.14 {
            offsetY = seg(0, 0.14, 0.2, 0); scale = seg(0, 0.14, 0.6, 1.15)
        } else if p < 0.30 {
            offsetY = seg(0.14, 0.30, 0, -0.1); scale = seg(0.14, 0.30, 1.15, 1)
        } else {
            offsetY = seg(0.30, 1, -0.1, -1.2); scale = 1
        }
        // opacity keyframes at 0 / 14 / 70 / 100 %
        let opacity: Double
        if p < 0.14 { opacity = seg(0, 0.14, 0, 1) }
        else if p < 0.70 { opacity = 1 }
        else { opacity = seg(0.70, 1, 1, 0) }
        return PlusOnePose(opacity: opacity, offsetY: offsetY, scale: scale)
    }

    /// Where the "+1" starts, in core units (UI_SPEC §2.4.10 step 1): about one shoulder width above the head.
    static func plusOneAnchorCore(features f: Features) -> Point2? {
        let base: Point2? = f.noseVisible ? (f.nose ?? f.shoulderMid) : f.shoulderMid
        guard let base else { return nil }
        return Point2(x: base.x, y: base.y - 0.9 * (f.shoulderWidth ?? 0.2))
    }

    /// Clamps the anchor into the layer (UI_SPEC §2.4.10 step 2). `anchor` is in layer coordinates, or nil.
    /// `chipsBottom` is the bottom of the chips row relative to the layer's top.
    static func plusOnePlacement(anchor: CGPoint?, layer: CGSize, chipsBottom: CGFloat, fontSize: CGFloat) -> CGPoint {
        let x0 = anchor?.x ?? layer.width / 2
        let y0 = anchor?.y ?? layer.height * 0.45
        let x = clampValue(x0, 60, max(60, layer.width - 60))
        let minTop = max(0, chipsBottom) + 1.75 * fontSize
        let y = clampValue(y0, minTop, max(minTop, layer.height - 80))
        return CGPoint(x: x, y: y)
    }
}
