import Foundation

// Port of web-prototype/src/demo/demoScript.ts.
//
// "Watch a demo": the scripted person.
//
// A simulated push-up set (Sim/PushupSimulator.swift projects a 3D body
// through a camera on the floor) that shows every state of the Challenge
// screen in about 35 seconds (10 reps):
//   hold a plank → 3-2-1 → 3 good reps → 1 shallow rep ("Go lower", "Didn't
//   count") → walk out of view ("Can't see you", paused) → come back →
//   good reps up to the target → Success.
//
// The frames go through the REAL RepCounter, so if the counter changes, the
// demo changes with it (it is a live check, not a recording).

/// The simulated camera delivers this many frames per second.
let DEMO_FPS = 30.0

/// Simulated clock of the first frame (ms). Not 0: the UI keeps a few "until"
/// timestamps that start at 0 meaning "never", and the demo uses this clock as
/// its "now".
let DEMO_START_T = 1000.0

/// How many good reps happen before the shallow one.
private let REPS_BEFORE_PARTIAL = 3

/// A good, deep rep (elbows to ~75°). Tempo varies a little so it doesn't look robotic.
private func fullRep(_ i: Int) -> RepSpec {
    RepSpec(
        minElbowDeg: 75,
        downMs: Double(700 + (i % 3) * 60),
        bottomHoldMs: 120,
        upMs: Double(650 + (i % 2) * 80),
        topRestMs: 450
    )
}

/// The shallow rep: elbows only reach ~120°. The long rest afterwards keeps
/// the 1.5 s "Go lower" cue on screen before the next thing happens.
private let PARTIAL_REP = RepSpec(minElbowDeg: 120, downMs: 600, bottomHoldMs: 150, upMs: 600, topRestMs: 1300)

/// The demo's segments for a set of `targetReps` (any target ≥ 1 works).
func demoSegments(_ targetReps: Int) -> [Segment] {
    let target = max(1, targetReps)
    let before = min(REPS_BEFORE_PARTIAL, target)
    let after = target - before
    var segments: [Segment] = [
        // Not in view yet: the placement screen asks to get in frame.
        .absent(ms: 1200),
        // Long enough for the counter to see a steady plank (0.6 s) and run the 3-2-1 (3 s).
        .hold(ms: 4500),
    ]
    for i in 0..<before { segments.append(.rep(spec: fullRep(i))) }
    if after > 0 {
        segments.append(contentsOf: [
            .rep(spec: PARTIAL_REP),
            // Out of view: the set pauses ("Can't see you") but keeps the count.
            .absent(ms: 1500),
            // Back in a plank: the counter resumes after it sees the plank again.
            .hold(ms: 1300),
        ])
        for i in 0..<after { segments.append(.rep(spec: fullRep(before + i))) }
    }
    // Stay in the plank after the last rep so frames keep coming while the
    // Success screen's short delay runs out (see the App: success by frame time).
    segments.append(.hold(ms: 2500))
    return segments
}

/// The simulated set: frames plus the camera geometry (geometry.imageW/H is
/// the picture size, 480x640 portrait like a phone's front camera).
typealias DemoSession = SimResult

struct DemoOptions {
    /// The whole camera picture is on screen (laptop layout, object-fit:
    /// contain). Phones crop the sides of the picture (cover), so there the
    /// simulated person stands further back to keep their elbows on screen.
    var wholeFrameVisible: Bool = false
}

/// Builds the whole demo up front (~1,000 frames for 10 reps; a few ms).
/// A little landmark noise makes the figure wobble like real tracking does.
func buildDemoSession(_ targetReps: Int, _ options: DemoOptions = DemoOptions()) -> DemoSession {
    simulateSession(
        demoSegments(targetReps),
        SimOptions(
            // Head-to-camera distance (m). The simulator's default is 0.9 (3 ft).
            geometry: PartialSimGeometry(headDistance: options.wholeFrameVisible ? 1.0 : 1.3),
            fps: DEMO_FPS,
            noisePx: 1,
            seed: 7,
            startT: DEMO_START_T
        )
    )
}
