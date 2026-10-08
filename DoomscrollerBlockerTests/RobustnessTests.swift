import XCTest
@testable import DoomscrollerBlocker

/// Port of web-prototype/tests/robustness.test.ts.
///
/// Robustness sweep: many simulated phone placements, body sizes, hand
/// positions, frame rates, landmark noise and frame timing jitter.
///
/// The rules being checked are the ones that matter to the user:
///   - every real push-up (elbow ≤ 85°) counts,
///   - a clearly shallow one (elbow ≥ 130°) never counts,
///   - just holding a plank never produces any event.
/// Everything is seeded, so a failure is reproducible from the printed case.
/// The last block stresses the counter BEYOND the expected range (heavy noise,
/// 12 fps, no rest between reps) with safety rules plus accuracy floors.
///
/// The random draws (and their ORDER) are the same as in the web test, so the
/// same cases are generated; makeRng is bit-identical to the web's.
final class RobustnessTests: XCTestCase {
    struct SweepCase {
        var id: Int
        var geometry: PartialSimGeometry
        var fps: Double
        var noisePx: Double
        var timeJitterMs: Double
        var frameDropRate: Double
        var seed: Int
    }

    private static func lerp(_ rng: Rng, _ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * rng() }
    private static func pick<T>(_ rng: Rng, _ items: [T]) -> T { items[Int((rng() * Double(items.count)).rounded(.down))] }

    /// Random cases across the ranges in the task, plus the nastiest corners.
    static func buildCases(_ n: Int) -> [SweepCase] {
        let rng = makeRng(20261005)
        var cases: [SweepCase] = []
        for i in 0..<n {
            let fps = pick(rng, [15.0, 24.0, 30.0])
            // (Swift evaluates these in the written order, like the JS object literal.)
            let camHeight = lerp(rng, 0.05, 0.25)
            let tiltDeg = lerp(rng, 0, 20)
            let headDistance = lerp(rng, 0.7, 1.3)
            let bodyScale = lerp(rng, 0.85, 1.15)
            let handWidthRatio = lerp(rng, 1.1, 1.8)
            let handOffsetZ = lerp(rng, 0, 0.15)
            let flareDeg = lerp(rng, 20, 75)
            let noisePx = lerp(rng, 0, 4)
            // Up to ±30 % of a frame of timestamp jitter, and up to 8 % dropped frames.
            let timeJitterMs = rng() < 0.5 ? lerp(rng, 0, 0.3 * (1000 / fps)) : 0
            let frameDropRate = rng() < 0.5 ? lerp(rng, 0, 0.08) : 0
            cases.append(SweepCase(
                id: i,
                geometry: PartialSimGeometry(
                    camHeight: camHeight, tiltDeg: tiltDeg, headDistance: headDistance, bodyScale: bodyScale,
                    handWidthRatio: handWidthRatio, handOffsetZ: handOffsetZ, flareDeg: flareDeg
                ),
                fps: fps,
                noisePx: noisePx,
                timeJitterMs: timeJitterMs,
                frameDropRate: frameDropRate,
                seed: 1000 + i
            ))
        }
        // Corners: worst frame rate and noise with extreme placements.
        var id = n
        for camHeight in [0.05, 0.25] {
            for tiltDeg in [0.0, 20.0] {
                for headDistance in [0.7, 1.3] {
                    for bodyScale in [0.85, 1.15] {
                        let thisId = id
                        id += 1 // JS: `id: id++` then `seed: 5000 + id` sees the incremented id
                        cases.append(SweepCase(
                            id: thisId,
                            geometry: PartialSimGeometry(
                                camHeight: camHeight, tiltDeg: tiltDeg, headDistance: headDistance, bodyScale: bodyScale,
                                handWidthRatio: 1.35, handOffsetZ: 0.08, flareDeg: 45
                            ),
                            fps: 15,
                            noisePx: 4,
                            timeJitterMs: 15,
                            frameDropRate: 0.05,
                            seed: 5000 + id
                        ))
                    }
                }
            }
        }
        return cases
    }

    /// A placement the app would accept: at the top AND at the bottom of a deep
    /// rep the shoulders and at least one wrist are visible, and the top passes
    /// the plank gate. Placements that fail this are ones where the app tells the
    /// user to fix the phone (and the sweep can't expect counting to work).
    static func placementUsable(_ geometry: PartialSimGeometry) -> Bool {
        let cfg = DEFAULT_CONFIG
        let g = cfg.plankGate
        for elbow in [180.0, 60.0] {
            let f = computeFeatures(poseAtElbow(elbow, geometry), cfg.visibilityThreshold, cfg.wristVisibilityThreshold)
            if !f.shouldersVisible || f.visibleWrists == 0 { return false }
            if elbow == 180 {
                let frac = f.shoulderWidthFrac ?? 0
                let h = f.heightRatio ?? 0
                if frac < g.minShoulderWidthFrac || frac > g.maxShoulderWidthFrac { return false }
                if h < g.minHeightRatio || h > g.maxHeightRatio || !f.wristsInSpan { return false }
            }
        }
        return true
    }

    private func describeCase(_ c: SweepCase) -> String {
        "#\(c.id) fps=\(c.fps) noise=\(String(format: "%.1f", c.noisePx)) jitter=\(String(format: "%.1f", c.timeJitterMs)) drop=\(String(format: "%.2f", c.frameDropRate)) seed=\(c.seed) \(c.geometry)"
    }

    private func simOptions(_ c: SweepCase) -> SimOptions {
        SimOptions(geometry: c.geometry, fps: c.fps, noisePx: c.noisePx, seed: c.seed, timeJitterMs: c.timeJitterMs, frameDropRate: c.frameDropRate)
    }

    /// Random rep timing so speed and pauses vary too.
    private func randomReps(_ rng: Rng, _ n: Int, _ minDeg: Double, _ maxDeg: Double) -> [RepSpec] {
        (0..<n).map { _ in
            let minElbowDeg = Self.lerp(rng, minDeg, maxDeg)
            let downMs = Self.lerp(rng, 400, 1500)
            let bottomHoldMs = Self.lerp(rng, 0, 400)
            let upMs = Self.lerp(rng, 400, 1200)
            let topRestMs = Self.lerp(rng, 300, 900)
            return RepSpec(minElbowDeg: minElbowDeg, downMs: downMs, bottomHoldMs: bottomHoldMs, upMs: upMs, topRestMs: topRestMs)
        }
    }

    private static let CASES = buildCases(250)
    private static let USABLE = CASES.filter { placementUsable($0.geometry) }
    private let REPS_PER_SESSION = 6

    private var USABLE: [SweepCase] { Self.USABLE }

    func testMostSampledPlacementsAreUsable() {
        XCTAssertGreaterThanOrEqual(Double(Self.USABLE.count), Double(Self.CASES.count) * 0.8)
    }

    func testEveryFullRepElbow60to85CountsWithNoFalsePartials() {
        var failures: [String] = []
        for c in USABLE {
            let rng = makeRng(c.seed * 7 + 1)
            let sim = simulateSession(standardSet(randomReps(rng, REPS_PER_SESSION, 60, 85)), simOptions(c))
            let r = runCounter(sim.frames)
            let hist = eventHistogram(r.events)
            if r.finalCount != REPS_PER_SESSION || hist["partial"] != nil || hist["repCancelled"] != nil || hist["paused"] != nil {
                failures.append("\(describeCase(c)) → count \(r.finalCount) \(hist)")
            }
        }
        XCTAssertEqual(failures, [])
    }

    func testShallowRepsElbow130to150NeverCount() {
        var failures: [String] = []
        for c in USABLE {
            let rng = makeRng(c.seed * 7 + 2)
            let sim = simulateSession(standardSet(randomReps(rng, REPS_PER_SESSION, 130, 150)), simOptions(c))
            let r = runCounter(sim.frames)
            let hist = eventHistogram(r.events)
            if r.finalCount != 0 || hist["depthReached"] != nil {
                failures.append("\(describeCase(c)) → count \(r.finalCount) \(hist)")
            }
        }
        XCTAssertEqual(failures, [])
    }

    func testHoldingAPlankProducesNoEventsAfterTheStart() {
        var failures: [String] = []
        for c in USABLE {
            let sim = simulateSession([.hold(ms: 20000)], simOptions(c))
            let r = runCounter(sim.frames)
            let types = eventTypes(r.events)
            let after: [String] = types.firstIndex(of: "start").map { Array(types[($0 + 1)...]) } ?? ["<never started>"]
            if !after.isEmpty { failures.append("\(describeCase(c)) → \(after.joined(separator: ","))") }
        }
        XCTAssertEqual(failures, [])
    }

    func testFastBackToBackReps03to05sEachWayShortRestAtTheTopAllCount() {
        var failures: [String] = []
        for c in USABLE {
            let rng = makeRng(c.seed * 7 + 3)
            let specs: [RepSpec] = (0..<REPS_PER_SESSION).map { _ in
                let minElbowDeg = Self.lerp(rng, 60, 85)
                let downMs = Self.lerp(rng, 300, 500)
                let bottomHoldMs = Self.lerp(rng, 0, 80)
                let upMs = Self.lerp(rng, 300, 500)
                let topRestMs = Self.lerp(rng, 150, 300)
                return RepSpec(minElbowDeg: minElbowDeg, downMs: downMs, bottomHoldMs: bottomHoldMs, upMs: upMs, topRestMs: topRestMs)
            }
            // A short hold at the end so the last rep has time to reach the top.
            let sim = simulateSession(standardSet(specs) + [.hold(ms: 1000)], simOptions(c))
            let r = runCounter(sim.frames)
            let hist = eventHistogram(r.events)
            if r.finalCount != REPS_PER_SESSION || hist["partial"] != nil || hist["repCancelled"] != nil {
                failures.append("\(describeCase(c)) → count \(r.finalCount) \(hist)")
            }
        }
        XCTAssertEqual(failures, [])
    }

    func testRockingBackTowardChildsPoseNeverCounts() {
        // A real rock toward child's pose moves the shoulders back ~40 cm. (A
        // 30 cm rock from 1.3 m away only shrinks the shoulders to ~0.89×, right at
        // minShoulderWidthRatio — the check is weaker when the user is far away.)
        var failures: [String] = []
        for c in USABLE {
            let sim = simulateSession(
                [.hold(ms: 4500)] + Array(repeating: Segment.rockBack(backM: 0.4, dropM: 0.3), count: 3) + [.hold(ms: 1000)],
                simOptions(c)
            )
            let r = runCounter(sim.frames)
            if r.finalCount != 0 { failures.append("\(describeCase(c)) → count \(r.finalCount) \(eventHistogram(r.events))") }
        }
        XCTAssertEqual(failures, [])
    }

    func testHeadBobsOnlyTheHeadMovesNeverCountOrTriggerGoLower() {
        var failures: [String] = []
        for c in USABLE {
            let sim = simulateSession(
                [.hold(ms: 4500)] + Array(repeating: Segment.headBob(dropM: 0.15), count: 3) + [.hold(ms: 500)],
                simOptions(c)
            )
            let r = runCounter(sim.frames)
            let hist = eventHistogram(r.events)
            if r.finalCount != 0 || hist["partial"] != nil || hist["depthReached"] != nil {
                failures.append("\(describeCase(c)) → count \(r.finalCount) \(hist)")
            }
        }
        XCTAssertEqual(failures, [])
    }

    func testPartialRepsElbow112NeverCountAndEachOneGetsExactlyOneGoLower() {
        var failures: [String] = []
        // A subset keeps the runtime down; partial detection is less noise-sensitive than counting.
        for (i, c) in USABLE.enumerated() where i % 3 == 0 {
            let sim = simulateSession(standardSet(reps(4, RepSpec(minElbowDeg: 112))), simOptions(c))
            let r = runCounter(sim.frames)
            let hist = eventHistogram(r.events)
            if r.finalCount != 0 || hist["partial"] != 4 {
                failures.append("\(describeCase(c)) → count \(r.finalCount) \(hist)")
            }
        }
        XCTAssertEqual(failures, [])
    }
}

/// Stress BEYOND the expected operating range: heavy landmark noise (6–8 px),
/// 12 fps, dropped frames and almost no rest at the top between fast reps.
/// (Formerly an exploratory script that only printed numbers.)
///
/// The SAFETY rules must hold in every case — a clearly shallow rep never
/// counts, a session never counts more reps than were done, and holding a
/// plank never counts a rep. Accuracy may degrade, but not below the floors
/// set per case (measured rates in the comments; floors leave some margin).
/// A missed rep is the forgiving failure: the user just does one more.
final class StressRobustnessTests: XCTestCase {
    struct StressCase {
        var name: String
        var noisePx: Double
        var fps: Double
        /// Rest at the top between fast reps: [lo, lo + 120] ms.
        var fastRestMs: Double
        var frameDropRate: Double
        /// Minimum share of placements where all 8 fast reps counted exactly.
        var minFastExact: Double
        /// Minimum share where all 6 normal-speed reps counted exactly.
        var minNormalExact: Double
        /// Maximum share of sessions where the 3-2-1 had to restart.
        var maxRestarts: Double
        /// Maximum share of 15 s plank holds with ANY event after the start (never a rep).
        var maxHoldEvents: Double
    }

    static let STRESS: [StressCase] = [
        // Almost no rest at the top at 15 fps: the smoothed depth sometimes doesn't
        // get back above upThreshold, so two reps merge into one.
        // measured: fast 91 %, normal 100 %, restarts 0 %, hold events 0 %
        StressCase(name: "4 px, 15 fps, 30 ms rests, 5 % drops", noisePx: 4, fps: 15, fastRestMs: 30, frameDropRate: 0.05, minFastExact: 0.85, minNormalExact: 0.97, maxRestarts: 0.03, maxHoldEvents: 0),
        // measured: fast 100 %, normal 100 %, restarts 0 %, hold events 0 %
        StressCase(name: "4 px, 15 fps, 150 ms rests, 5 % drops", noisePx: 4, fps: 15, fastRestMs: 150, frameDropRate: 0.05, minFastExact: 0.93, minNormalExact: 0.97, maxRestarts: 0.03, maxHoldEvents: 0),
        // measured: fast 98 %, normal 99 %, restarts 1 %, hold events 0 %
        StressCase(name: "4 px, 12 fps, 150 ms rests, 5 % drops", noisePx: 4, fps: 12, fastRestMs: 150, frameDropRate: 0.05, minFastExact: 0.92, minNormalExact: 0.95, maxRestarts: 0.04, maxHoldEvents: 0),
        // measured: fast 100 %, normal 100 %, restarts 0 %, hold events 0 %
        StressCase(name: "4 px, 30 fps, 30 ms rests, 5 % drops", noisePx: 4, fps: 30, fastRestMs: 30, frameDropRate: 0.05, minFastExact: 0.95, minNormalExact: 0.97, maxRestarts: 0.03, maxHoldEvents: 0),
        // measured: fast 96 %, normal 99 %, restarts 0 %, hold events 0 %
        StressCase(name: "6 px, 15 fps, 150 ms rests", noisePx: 6, fps: 15, fastRestMs: 150, frameDropRate: 0, minFastExact: 0.9, minNormalExact: 0.93, maxRestarts: 0.05, maxHoldEvents: 0.02),
        // Heavy noise (≈ 1.3 % of the image height per joint, per frame): far
        // placements start to miss reps, restart the 3-2-1 and see false
        // "Go lower" while holding — but never a false rep.
        // measured: fast 81 %, normal 89 %, restarts 5 %, hold events 2 % (partials only)
        StressCase(name: "8 px, 15 fps, 150 ms rests (degraded)", noisePx: 8, fps: 15, fastRestMs: 150, frameDropRate: 0, minFastExact: 0.7, minNormalExact: 0.8, maxRestarts: 0.12, maxHoldEvents: 0.08),
    ]

    private static func lerp(_ rng: Rng, _ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * rng() }

    /// The same 100 random placements for every case (seeded), keeping only usable ones.
    static func stressPlacements() -> [PartialSimGeometry] {
        let rng = makeRng(11)
        var out: [PartialSimGeometry] = []
        for _ in 0..<100 {
            let camHeight = lerp(rng, 0.05, 0.25)
            let tiltDeg = lerp(rng, 0, 20)
            let headDistance = lerp(rng, 0.7, 1.3)
            let bodyScale = lerp(rng, 0.85, 1.15)
            let handWidthRatio = lerp(rng, 1.1, 1.8)
            let handOffsetZ = lerp(rng, 0, 0.15)
            let flareDeg = lerp(rng, 20, 75)
            let g = PartialSimGeometry(
                camHeight: camHeight, tiltDeg: tiltDeg, headDistance: headDistance, bodyScale: bodyScale,
                handWidthRatio: handWidthRatio, handOffsetZ: handOffsetZ, flareDeg: flareDeg
            )
            if RobustnessTests.placementUsable(g) { out.append(g) }
        }
        return out
    }

    private static let PLACEMENTS = stressPlacements()

    func testEnoughStressPlacementsAreUsable() {
        XCTAssertGreaterThanOrEqual(Self.PLACEMENTS.count, 80)
    }

    private func runStress(_ index: Int) {
        let sc = Self.STRESS[index]
        let rng = makeRng(Int(sc.noisePx * 1000 + sc.fps * 10 + sc.fastRestMs))
        var safety: [String] = []
        var fastExact = 0
        var normalExact = 0
        var restarts = 0
        var holdEvents = 0
        for (i, geometry) in Self.PLACEMENTS.enumerated() {
            let opts = SimOptions(geometry: geometry, fps: sc.fps, noisePx: sc.noisePx, seed: i + 1, timeJitterMs: 10, frameDropRate: sc.frameDropRate)

            let fast: [RepSpec] = (0..<8).map { _ in
                let minElbowDeg = Self.lerp(rng, 60, 85)
                let downMs = Self.lerp(rng, 300, 500)
                let upMs = Self.lerp(rng, 300, 500)
                let bottomHoldMs = Self.lerp(rng, 0, 80)
                let topRestMs = Self.lerp(rng, sc.fastRestMs, sc.fastRestMs + 120)
                return RepSpec(minElbowDeg: minElbowDeg, downMs: downMs, bottomHoldMs: bottomHoldMs, upMs: upMs, topRestMs: topRestMs)
            }
            let rf = runCounter(simulateSession(standardSet(fast, holdMs: 6000) + [.hold(ms: 1000)], opts).frames)
            if rf.finalCount == 8 { fastExact += 1 }
            if rf.finalCount > 8 { safety.append("#\(i) fast: counted \(rf.finalCount) of 8") }

            let normal: [RepSpec] = (0..<6).map { RepSpec(minElbowDeg: Double(60 + $0 * 5)) }
            let rn = runCounter(simulateSession(standardSet(normal, holdMs: 6000) + [.hold(ms: 1000)], opts).frames)
            if rn.finalCount == 6 { normalExact += 1 }
            if rn.finalCount > 6 { safety.append("#\(i) normal: counted \(rn.finalCount) of 6") }
            if (eventHistogram(rn.events)["countdownTick"] ?? 0) > 3 { restarts += 1 }

            let rs = runCounter(simulateSession(standardSet(reps(6, RepSpec(minElbowDeg: 130))), opts).frames)
            if rs.finalCount != 0 { safety.append("#\(i) shallow 130°: counted \(rs.finalCount)") }

            let rh = runCounter(simulateSession([.hold(ms: 15000)], opts).frames)
            let types = eventTypes(rh.events)
            let startIdx = types.firstIndex(of: "start")
            let after: [String] = startIdx.map { Array(types[($0 + 1)...]) } ?? []
            if startIdx == nil { safety.append("#\(i) hold: never started") }
            if !after.isEmpty { holdEvents += 1 }
            if after.contains("rep") { safety.append("#\(i) hold: counted a rep") }
        }

        let n = Double(Self.PLACEMENTS.count)
        let stats = "fast \(String(format: "%.0f", 100 * Double(fastExact) / n)) %, normal \(String(format: "%.0f", 100 * Double(normalExact) / n)) %, restarts \(String(format: "%.0f", 100 * Double(restarts) / n)) %, hold events \(String(format: "%.0f", 100 * Double(holdEvents) / n)) %"
        print("stress [\(sc.name)]: \(stats)")
        XCTAssertEqual(safety, [], stats)
        XCTAssertGreaterThanOrEqual(Double(fastExact) / n, sc.minFastExact, stats)
        XCTAssertGreaterThanOrEqual(Double(normalExact) / n, sc.minNormalExact, stats)
        XCTAssertLessThanOrEqual(Double(restarts) / n, sc.maxRestarts, stats)
        XCTAssertLessThanOrEqual(Double(holdEvents) / n, sc.maxHoldEvents, stats)
    }

    // One test per case, like the web's `for (const sc of STRESS) test(sc.name, ...)`.
    func testStress0_4px_15fps_30msRests_5pctDrops() { runStress(0) }
    func testStress1_4px_15fps_150msRests_5pctDrops() { runStress(1) }
    func testStress2_4px_12fps_150msRests_5pctDrops() { runStress(2) }
    func testStress3_4px_30fps_30msRests_5pctDrops() { runStress(3) }
    func testStress4_6px_15fps_150msRests() { runStress(4) }
    func testStress5_8px_15fps_150msRests_degraded() { runStress(5) }
}
