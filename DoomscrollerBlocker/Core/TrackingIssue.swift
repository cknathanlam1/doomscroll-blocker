import Foundation

// Port of web-prototype/src/core/trackingIssue.ts.

struct TrackingIssueInput {
    var t: Double
    /// A person was detected in this frame.
    var present: Bool
    /// Debounced in-frame state from the counter.
    var inFrame: Bool
    /// Minimum shoulder confidence this frame (0 if absent).
    var shoulderConfidence: Double
    /// Mean frame luminance 0..255, or nil if not measured recently.
    var luminance: Double?
}

struct TrackingIssueOptions {
    /// Luminance below which the scene is always "too dark" (enter threshold).
    var darkEnter: Double = 35
    /// Luminance above which hard "too dark" clears (exit threshold, > darkEnter).
    var darkExit: Double = 50
    /// Dim-but-not-black: luminance below this AND a low-confidence pattern over
    /// the window (pose found in < minPoseRate of frames, or median shoulder
    /// confidence < minMedianConfidence) also means "too dark". iOS auto-exposure
    /// can make a dim room look fine by luminance while confidence collapses.
    var dimLuminance: Double = 70
    var windowMs: Double = 2000
    var minPoseRate: Double = 0.6
    var minMedianConfidence: Double = 0.6
    /// An issue must persist this long before it is reported (and clear for this long before it goes away).
    var debounceMs: Double = 700
}

let DEFAULT_TRACKING_ISSUE_OPTIONS = TrackingIssueOptions()

private struct WindowSample {
    var t: Double
    var present: Bool
    var shoulderConfidence: Double
}

private func median(_ values: [Double]) -> Double {
    let s = values.sorted()
    let mid = s.count / 2
    if s.isEmpty { return 0 }
    return s.count % 2 == 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/// Decides which "something's off" state to show (spec S2 vs S3), with
/// hysteresis and debouncing so the UI doesn't flicker. Pure.
/// - tooDark: luminance rules above (wins over notDetected when both apply).
/// - notDetected: the user is not in frame (inFrame false) and it is not dark.
/// - none: otherwise.
final class TrackingIssueDetector {
    private let opts: TrackingIssueOptions
    private var samples: [WindowSample] = []
    /// Hard "too dark" state; uses two thresholds so it doesn't flicker around one value.
    private var hardDark = false
    private var reported: TrackingIssue = .none
    /// A different issue that is waiting out the debounce, and since when.
    private var candidate: TrackingIssue?
    private var candidateSince = 0.0

    init(_ options: TrackingIssueOptions = DEFAULT_TRACKING_ISSUE_OPTIONS) {
        opts = options
    }

    func update(_ input: TrackingIssueInput) -> TrackingIssue {
        let o = opts
        let t = input.t

        // Keep only the last windowMs of frames for the low-confidence pattern.
        samples.append(WindowSample(t: t, present: input.present, shoulderConfidence: input.present ? input.shoulderConfidence : 0))
        while let first = samples.first, first.t < t - o.windowMs { samples.removeFirst() }

        if let lum = input.luminance {
            if hardDark {
                if lum > o.darkExit { hardDark = false }
            } else if lum < o.darkEnter {
                hardDark = true
            }
        } else {
            // Without a recent luminance reading we never claim it is dark.
            hardDark = false
        }

        var dim = false
        // Only judge the pattern once we have at least half a window of history,
        // otherwise one missed frame right after start-up would look like a 0% pose rate.
        if let lum = input.luminance, lum < o.dimLuminance, let first = samples.first, t - first.t >= o.windowMs / 2 {
            let poseRate = Double(samples.filter { $0.present }.count) / Double(samples.count)
            let medianConfidence = median(samples.map { $0.shoulderConfidence })
            dim = poseRate < o.minPoseRate || medianConfidence < o.minMedianConfidence
        }

        let raw: TrackingIssue = hardDark || dim ? .tooDark : (input.inFrame ? .none : .notDetected)

        // Debounce: a change is only reported once it has held for debounceMs.
        if raw == reported {
            candidate = nil
        } else if raw != candidate {
            candidate = raw
            candidateSince = t
        }
        if let c = candidate, t - candidateSince >= o.debounceMs {
            reported = c
            candidate = nil
        }
        return reported
    }

    func reset() {
        samples = []
        hardDark = false
        reported = .none
        candidate = nil
        candidateSince = 0
    }
}
