import XCTest
@testable import DoomscrollerBlocker

/// Proves the Swift simulator is FAITHFUL to the web one.
///
/// The golden files (web-prototype/tests/fixtures/golden/*.json) were written
/// by web-prototype/scripts/golden/exportGolden.test.ts from the WEB simulator
/// (src/sim/pushupSimulator.ts). This test rebuilds every simulated session
/// (03 ... 16; 01 and 02 are a real recording) with the SWIFT simulator, using
/// the exact same parameters as the generator, rounds the inputs the way the
/// generator does (t to 3 decimals, aspect and x/y to 6, c to 4), and compares
/// with each file's `frames`.
///
/// The seeded RNG is bit-identical (UInt32 wrapping arithmetic), so the noise
/// is the same; the only possible differences are last-digit differences in
/// sin/cos/log/acos/asin between V8 and Apple's libm, which the rounding to 6
/// decimals mostly hides. The test records the largest difference it sees per
/// field (printed, and asserted to stay under 1e-5).
final class GoldenSimulatorTests: XCTestCase {
    // --- Rounding, exactly like the generator (JS Math.round: halves go UP) --------

    private func round(_ x: Double, _ digits: Int) -> Double {
        let f = pow(10.0, Double(digits))
        let r = (x * f + 0.5).rounded(.down) / f
        return r == 0 ? 0 : r // no -0
    }

    private func inputFrame(_ f: PoseFrame) -> PoseFrame {
        var joints: Joints2D?
        if let j = f.joints {
            var out = Joints2D()
            for (name, v) in j.values { out[name] = Joint2D(x: round(v.x, 6), y: round(v.y, 6), c: round(v.c, 4)) }
            joints = out
        }
        return PoseFrame(t: round(f.t, 3), aspect: round(f.aspect, 6), joints: joints, world: nil)
    }

    // --- The sessions (same parameters as exportGolden.test.ts) -------------------

    private func specs(_ n: Int, _ spec: RepSpec) -> [RepSpec] { reps(n, spec) }

    private func sessionFrames(_ name: String) -> [PoseFrame]? {
        switch name {
        case "03-clean-10-reps-30fps":
            return simulateSession(standardSet(specs(10, RepSpec(minElbowDeg: 80))) + [.hold(ms: 1000)], SimOptions(seed: 1)).frames

        case "04-mixed-full-and-partial-noise2":
            let angles: [Double] = [80, 115, 75, 120, 85, 112, 70, 118]
            return simulateSession(
                standardSet(angles.map { RepSpec(minElbowDeg: $0) }) + [.hold(ms: 1000)],
                SimOptions(noisePx: 2, seed: 4)
            ).frames

        case "05-absence-mid-set-pause-resume":
            let a = simulateSession(
                standardSet(specs(3, RepSpec(minElbowDeg: 80))) + [.rep(spec: RepSpec(minElbowDeg: 80, bottomHoldMs: 2000))],
                SimOptions(noisePx: 1, seed: 5)
            )
            let fourth = a.reps[3]
            // Cut 1 s into the 2 s bottom hold (0.7 s descent + 1 s).
            let cut = fourth.tStart + 700 + 1000
            let b = simulateSession(
                [.absent(ms: 2000), .hold(ms: 1500)] + repSegments(3, RepSpec(minElbowDeg: 80)) + [.hold(ms: 500)],
                SimOptions(noisePx: 1, seed: 55)
            )
            return concat(a.frames.filter { $0.t < cut }, b.frames)

        case "06-tired-reps-return-135":
            let r135 = { (m: Double) in RepSpec(minElbowDeg: m, returnElbowDeg: 135) }
            let list: [RepSpec] = [
                r135(75), r135(75), r135(115), r135(120), r135(75), r135(75),
                RepSpec(minElbowDeg: 75),
                RepSpec(minElbowDeg: 70, topRestMs: 100, returnElbowDeg: 120),
                RepSpec(minElbowDeg: 70),
            ]
            return simulateSession(standardSet(list) + [.hold(ms: 1000)], SimOptions(noisePx: 1, seed: 6)).frames

        case "07-15fps-noise4-time-jitter":
            return simulateSession(
                standardSet(specs(8, RepSpec(minElbowDeg: 75))) + [.hold(ms: 1000)],
                SimOptions(fps: 15, noisePx: 4, seed: 7, timeJitterMs: 15)
            ).frames

        case "08-shallow-reps-never-count":
            let angles: [Double] = [115, 140, 120, 145, 112, 135]
            return simulateSession(
                standardSet(angles.map { RepSpec(minElbowDeg: $0) }) + [.hold(ms: 1000)],
                SimOptions(noisePx: 1.5, seed: 8)
            ).frames

        case "09-calibration-restart-and-cancel":
            return simulateSession(
                [.hold(ms: 1000)]
                    + repSegments(3, RepSpec(minElbowDeg: 115, downMs: 500, bottomHoldMs: 0, upMs: 500, topRestMs: 0))
                    + [.hold(ms: 1500), .rep(spec: RepSpec(minElbowDeg: 80)), .hold(ms: 5000)]
                    + repSegments(2, RepSpec(minElbowDeg: 80))
                    + [.hold(ms: 500)]
            ).frames

        case "10-rock-back-head-bob-too-slow":
            return simulateSession(
                standardSet([RepSpec(minElbowDeg: 80)])
                    + [
                        .rockBack(backM: 0.2, dropM: 0.2),
                        .hold(ms: 1500),
                        .rockBack(backM: 0.4, dropM: 0.15, holdMs: 1200),
                        .hold(ms: 2000),
                        .headBob(dropM: 0.15),
                        .hold(ms: 1000),
                        .rep(spec: RepSpec(minElbowDeg: 80, bottomHoldMs: 11000)),
                        .rep(spec: RepSpec(minElbowDeg: 80)),
                        .hold(ms: 500),
                    ],
                SimOptions(fps: 15, noisePx: 1, seed: 10)
            ).frames

        case "11-low-fps-6":
            return simulateSession(
                standardSet(specs(4, RepSpec(minElbowDeg: 75, downMs: 900, upMs: 900)), holdMs: 6000) + [.hold(ms: 1000)],
                SimOptions(fps: 6, noisePx: 1, seed: 11)
            ).frames

        case "12-phone-moved-after-pause":
            return concat(
                simulateSession(standardSet(specs(2, RepSpec(minElbowDeg: 80))), SimOptions(noisePx: 1, seed: 12)).frames,
                simulateSession(
                    [.absent(ms: 2000), .hold(ms: 1500)] + repSegments(6, RepSpec(minElbowDeg: 80)) + [.hold(ms: 500)],
                    SimOptions(geometry: PartialSimGeometry(tiltDeg: 18), noisePx: 1, seed: 120)
                ).frames
            )

        case "13-dropouts-24fps-jitter":
            let angles: [Double] = [80, 120, 70, 112, 100, 75, 85]
            let sim = simulateSession(
                standardSet(angles.map { RepSpec(minElbowDeg: $0) }),
                SimOptions(fps: 24, noisePx: 2, dropoutRate: 0.02, seed: 13, timeJitterMs: 8)
            )
            let hidden = sim.reps[5]
            let from = hidden.tStart - 300
            let to = hidden.tEnd + 200
            return sim.frames.map { f in
                guard var j = f.joints, f.t >= from, f.t < to else { return f }
                if var lw = j[.leftWrist] { lw.c = 0.1; j[.leftWrist] = lw }
                if var rw = j[.rightWrist] { rw.c = 0.1; j[.rightWrist] = rw }
                var o = f
                o.joints = j
                return o
            }

        case "14-placement-hints-and-shuffle-away":
            let far = PartialSimGeometry(headDistance: 2.6)
            let tooClose = PartialSimGeometry(camHeight: 0.2, tiltDeg: 8, vFovDeg: 46, headDistance: 0.55, handWidthRatio: 1)
            let parts: [[PoseFrame]] = [
                simulateSession([.hold(ms: 1500)], SimOptions(geometry: far, noisePx: 1, seed: 141)).frames,
                simulateSession([.hold(ms: 1500)], SimOptions(geometry: tooClose, noisePx: 1, seed: 142)).frames,
                simulateSession(standardSet(specs(2, RepSpec(minElbowDeg: 80))), SimOptions(noisePx: 1, seed: 143)).frames,
                simulateSession([.hold(ms: 1500)], SimOptions(geometry: far, noisePx: 1, seed: 144)).frames,
                simulateSession(
                    [.hold(ms: 1500)] + repSegments(2, RepSpec(minElbowDeg: 80)) + [.hold(ms: 500)],
                    SimOptions(noisePx: 1, seed: 145)
                ).frames,
            ]
            return parts.dropFirst().reduce(parts[0]) { concat($0, $1) }

        case "15-fast-reps-and-too-fast-bounce":
            let fast = RepSpec(minElbowDeg: 75, downMs: 300, bottomHoldMs: 0, upMs: 300, topRestMs: 200)
            let bounce = RepSpec(minElbowDeg: 60, downMs: 150, bottomHoldMs: 0, upMs: 150, topRestMs: 600)
            return simulateSession(standardSet([fast, fast, bounce, fast, fast]) + [.hold(ms: 800)], SimOptions(noisePx: 1, seed: 15)).frames

        case "16-bent-arm-calibration-baseline-clamp":
            return simulateSession(
                [.holdAt(elbowDeg: 135, ms: 4500), .hold(ms: 4000)] + repSegments(3, RepSpec(minElbowDeg: 80)) + [.hold(ms: 500)],
                SimOptions(noisePx: 1, seed: 16)
            ).frames

        default:
            return nil // 01 / 02: the real laptop recording, not simulated
        }
    }

    // --- The comparison --------------------------------------------------------

    private struct MaxDiff {
        var t = 0.0, aspect = 0.0, x = 0.0, y = 0.0, c = 0.0
        var roundingFlips = 0
        var description: String {
            "t \(t), aspect \(aspect), x \(x), y \(y), c \(c), rounding flips \(roundingFlips)"
        }
    }

    func testSwiftSimulatorRegeneratesTheWebGoldenInputFrames() throws {
        var checked = 0
        var worst = MaxDiff()
        for name in try Fixtures.goldenNames() {
            let base = String(name.dropLast(".json".count))
            guard let generated = sessionFrames(base) else { continue }
            let file = try Fixtures.load(GoldenFile.self, "golden/\(name)")
            XCTAssertEqual(generated.count, file.frames.count, "\(base): frame count")
            guard generated.count == file.frames.count else { continue }
            var diff = MaxDiff()
            for (i, g) in generated.enumerated() {
                let a = inputFrame(g)
                let b = file.frames[i]
                let where_ = "\(base) frame \(i)"
                diff.t = max(diff.t, abs(a.t - b.t))
                diff.aspect = max(diff.aspect, abs(a.aspect - b.aspect))
                XCTAssertLessThanOrEqual(abs(a.t - b.t), 1.1e-3, "\(where_) t")
                XCTAssertEqual(a.aspect, b.aspect, accuracy: 1e-5, "\(where_) aspect")
                XCTAssertEqual(a.joints == nil, b.joints == nil, "\(where_) joints presence")
                guard let aj = a.joints, let bj = b.joints else { continue }
                XCTAssertEqual(Set(aj.values.keys), Set(bj.values.keys), "\(where_) joint names")
                for (jn, bv) in bj.values {
                    guard let av = aj[jn] else { continue }
                    let dx = abs(av.x - bv.x), dy = abs(av.y - bv.y), dc = abs(av.c - bv.c)
                    diff.x = max(diff.x, dx)
                    diff.y = max(diff.y, dy)
                    diff.c = max(diff.c, dc)
                    if dx > 0 || dy > 0 || dc > 0 { diff.roundingFlips += 1 }
                    XCTAssertLessThanOrEqual(dx, 1e-5, "\(where_) \(jn) x")
                    XCTAssertLessThanOrEqual(dy, 1e-5, "\(where_) \(jn) y")
                    XCTAssertLessThanOrEqual(dc, 1.1e-4, "\(where_) \(jn) c")
                }
            }
            print("golden-sim \(base): frames \(generated.count), max diff after rounding: \(diff.description)")
            worst.t = max(worst.t, diff.t); worst.x = max(worst.x, diff.x); worst.y = max(worst.y, diff.y)
            worst.c = max(worst.c, diff.c); worst.roundingFlips += diff.roundingFlips
            checked += 1
        }
        XCTAssertEqual(checked, 14, "sessions 03 ... 16 are simulated")
        print("golden-sim overall: \(worst.description)")
    }

    /// The strongest form: feeding the Swift-generated frames (not the file's) to
    /// the Swift counter must reproduce the golden counts. (Both steps
    /// together are what the web's golden test does with its own simulator.)
    func testSwiftSimulatedSessionsGiveTheGoldenFinalCounts() throws {
        for name in try Fixtures.goldenNames() {
            let base = String(name.dropLast(".json".count))
            guard let generated = sessionFrames(base) else { continue }
            let file = try Fixtures.load(GoldenFile.self, "golden/\(name)")
            let counter = RepCounter(file.config)
            var count = 0
            for f in generated.map(inputFrame) { count = counter.update(f).count }
            XCTAssertEqual(count, file.expected.last?.count, base)
        }
    }
}
