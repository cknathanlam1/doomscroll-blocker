import XCTest
@testable import DoomscrollerBlocker

/// Port of web-prototype/tests/simulator.test.ts.
/// Sanity checks for the push-up simulator (Sim/PushupSimulator.swift).
/// Every counter test trusts it as ground truth, so it gets a few tests of
/// its own: the true elbow angle hits what was asked, sessions are
/// reproducible, and the special segments move only what they claim to.
final class SimulatorTests: XCTestCase {
    private func joint(_ f: PoseFrame?, _ name: JointName, file: StaticString = #filePath, line: UInt = #line) -> Joint2D {
        guard let j = f?.joints?[name] else {
            XCTFail("missing \(name)", file: file, line: line)
            return Joint2D(x: .nan, y: .nan, c: .nan)
        }
        return j
    }

    func testARepReachesTheRequestedElbowAngleAndReturnsToTheTop() {
        let sim = simulateSession(standardSet([RepSpec(minElbowDeg: 85), RepSpec(minElbowDeg: 120)]))
        let elbows = sim.truth.map { $0.elbowDeg ?? .nan }
        assertCloseTo(elbows.min(), 85, digits: 3)
        assertCloseTo(sim.truth.last?.elbowDeg, topElbowAngle(), digits: 6)
        assertCloseTo(topElbowAngle(), DEFAULT_GEOMETRY.topElbowDeg, digits: 3)
        XCTAssertEqual(sim.reps.map(\.full), [true, false])
        XCTAssertGreaterThan(sim.reps[0].tEnd, sim.reps[0].tStart)
    }

    func testTheShouldersGetLowerAsTheElbowsBendAndLowerInTheImage() {
        let top = poseAtElbow(170)
        let bottom = poseAtElbow(80)
        XCTAssertGreaterThan(joint(bottom, .leftShoulder).y, joint(top, .leftShoulder).y)
        // The hands stay planted.
        assertCloseTo(joint(bottom, .leftWrist).y, joint(top, .leftWrist).y, digits: 9)
    }

    func testPersonsLeftSideAppearsOnTheRightOfTheUnmirroredImage() {
        let f = poseAtElbow(170)
        XCTAssertGreaterThan(joint(f, .leftShoulder).x, joint(f, .rightShoulder).x)
    }

    func testSameSeedGivesIdenticalSessionDifferentSeedDifferentNoise() {
        let segs = standardSet([RepSpec(minElbowDeg: 80)])
        let a = simulateSession(segs, SimOptions(noisePx: 3, seed: 5))
        let b = simulateSession(segs, SimOptions(noisePx: 3, seed: 5))
        let c = simulateSession(segs, SimOptions(noisePx: 3, seed: 6))
        XCTAssertEqual(b.frames, a.frames)
        XCTAssertNotEqual(c.frames, a.frames)
    }

    func testTimingOptionsThatAreOffLeaveASeededSessionUntouched() {
        let segs = standardSet([RepSpec(minElbowDeg: 80)])
        let plain = simulateSession(segs, SimOptions(noisePx: 2, seed: 3))
        let off = simulateSession(segs, SimOptions(noisePx: 2, seed: 3, timeJitterMs: 0, frameDropRate: 0))
        XCTAssertEqual(off.frames, plain.frames)
    }

    func testTimestampJitterKeepsTimestampsStrictlyIncreasingFrameDropsRemoveFrames() {
        let segs = standardSet([RepSpec(minElbowDeg: 80)])
        let jittered = simulateSession(segs, SimOptions(fps: 15, seed: 2, timeJitterMs: 1000))
        for i in 1..<jittered.frames.count {
            XCTAssertGreaterThan(jittered.frames[i].t, jittered.frames[i - 1].t)
        }
        let full = simulateSession(segs, SimOptions(seed: 2))
        let dropped = simulateSession(segs, SimOptions(seed: 2, frameDropRate: 0.2))
        XCTAssertLessThan(Double(dropped.frames.count), Double(full.frames.count) * 0.9)
        XCTAssertGreaterThan(Double(dropped.frames.count), Double(full.frames.count) * 0.7)
        XCTAssertEqual(dropped.truth.count, dropped.frames.count)
    }

    func testAbsentAndLowConfidenceSegments() {
        let sim = simulateSession([.absent(ms: 100), .lowConfidence(ms: 100, c: 0.3)])
        let absent = sim.frames.first
        let low = sim.frames.last
        XCTAssertNil(absent?.joints)
        XCTAssertNil(sim.truth[0].elbowDeg)
        XCTAssertFalse((low?.joints?.values ?? [:]).isEmpty)
        XCTAssertTrue((low?.joints?.values ?? [:]).values.allSatisfy { $0.c == 0.3 })
    }

    func testHeadBobMovesOnlyTheNoseDownwardInTheImage() {
        // (The up phase ends one frame short of the rest pose, like a rep, hence the final hold.)
        let sim = simulateSession([
            .hold(ms: 100),
            .headBob(dropM: 0.15, downMs: 300, holdMs: 300, upMs: 300),
            .hold(ms: 100),
        ])
        let rest = sim.frames[0]
        let nodded = sim.frames.first { $0.t >= 100 + 300 + 100 } // during the hold of the nod
        for name in [JointName.leftShoulder, .rightShoulder, .leftElbow, .rightElbow, .leftWrist, .rightWrist, .leftHip, .rightHip] {
            assertCloseTo(joint(nodded, name).x, joint(rest, name).x, digits: 12)
            assertCloseTo(joint(nodded, name).y, joint(rest, name).y, digits: 12)
        }
        XCTAssertGreaterThan(joint(nodded, .nose).y, joint(rest, .nose).y + 0.03)
        // Back to the start afterwards, and the true elbow angle never changed.
        assertCloseTo(joint(sim.frames.last, .nose).y, joint(rest, .nose).y, digits: 12)
        for s in sim.truth { assertCloseTo(s.elbowDeg, sim.truth[0].elbowDeg, digits: 9) }
    }

    func testRockBackMovesTheUpperBodyAwayShouldersShrinkHandsStayPut() {
        let sim = simulateSession([
            .hold(ms: 100),
            .rockBack(backM: 0.3, dropM: 0.2, downMs: 300, holdMs: 300, upMs: 300),
        ])
        let rest = sim.frames[0]
        let rockedIndex = sim.frames.firstIndex { $0.t >= 100 + 300 + 100 }!
        let rocked = sim.frames[rockedIndex]
        func width(_ f: PoseFrame) -> Double { abs(joint(f, .leftShoulder).x - joint(f, .rightShoulder).x) }
        XCTAssertLessThan(width(rocked), width(rest) * 0.85)
        assertCloseTo(joint(rocked, .leftWrist).x, joint(rest, .leftWrist).x, digits: 12)
        assertCloseTo(joint(rocked, .leftWrist).y, joint(rest, .leftWrist).y, digits: 12)
        // The truth reflects the lower shoulders and the more bent elbows.
        let restTruth = sim.truth[0]
        let rockedTruth = sim.truth[rockedIndex]
        assertCloseTo(rockedTruth.shoulderHeight, (restTruth.shoulderHeight ?? .nan) - 0.2, digits: 6)
        XCTAssertLessThan(rockedTruth.elbowDeg ?? .infinity, restTruth.elbowDeg ?? -.infinity)
    }

    func testWorldJointsAreHipCentredMetresWhenRequested() {
        let sim = simulateSession([.hold(ms: 34)], SimOptions(includeWorld: true))
        let w = sim.frames[0].world
        XCTAssertNotNil(w)
        let lh = w?[.leftHip]
        let rh = w?[.rightHip]
        assertCloseTo(((lh?.x ?? .nan) + (rh?.x ?? .nan)) / 2, 0, digits: 9)
        // Shoulder width ≈ 0.38 m for bodyScale 1.
        let ls = w?[.leftShoulder]
        let rs = w?[.rightShoulder]
        let dx = (ls?.x ?? 0) - (rs?.x ?? 0)
        let dy = (ls?.y ?? 0) - (rs?.y ?? 0)
        let dz = (ls?.z ?? 0) - (rs?.z ?? 0)
        assertCloseTo((dx * dx + dy * dy + dz * dz).squareRoot(), 0.38, digits: 6)
        XCTAssertNil(simulateSession([.hold(ms: 34)]).frames[0].world)
    }

    // --- Swift-port-only checks -------------------------------------------

    /// The RNG must be bit-identical to JS mulberry32. Reference values were
    /// computed with the web's makeRng (Node): first 3 draws of three seeds.
    func testMulberry32MatchesTheWebImplementation() {
        let expected: [Int: [Double]] = [
            1: [0.62707394058816135, 0.0027357211802154779, 0.52744703995995224],
            7: [0.011704753153026104, 0.061958257574588060, 0.97690763277933002],
            20261005: [0.56750646280124784, 0.26622539968229830, 0.14650599937886000],
        ]
        for (seed, values) in expected {
            let r = makeRng(seed)
            for v in values { XCTAssertEqual(r(), v, accuracy: 0, "seed \(seed)") }
        }
    }

    /// Frames are 1000/fps apart and truth has one sample per frame.
    func testStandardSetFrameCounts() {
        let sim = simulateSession(standardSet([RepSpec(minElbowDeg: 80)]))
        XCTAssertEqual(sim.frames.count, sim.truth.count)
        XCTAssertEqual(sim.frames[0].t, 0)
        XCTAssertEqual(sim.frames[1].t, 1000.0 / 30, accuracy: 1e-12)
    }
}
