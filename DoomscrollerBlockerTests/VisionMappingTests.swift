import XCTest
@testable import DoomscrollerBlocker

final class VisionMappingTests: XCTestCase {
    func testNoBodyGivesNilJointsAndSafeAspect() {
        let f = VisionMapping.toPoseFrame(points: nil, aspect: .nan, tMs: 12)
        XCTAssertNil(f.joints)
        XCTAssertEqual(f.aspect, 1)
        XCTAssertEqual(f.t, 12)
    }

    func testOriginMovesFromBottomLeftToTopLeftAndXScalesByAspect() throws {
        let f = VisionMapping.toPoseFrame(
            points: [.nose: VisionPoint(x: 0.5, y: 0.8, confidence: 0.9)],
            aspect: 0.75,
            tMs: 0
        )
        let nose = try XCTUnwrap(f.joints?[.nose])
        XCTAssertEqual(nose.x, 0.375, accuracy: 1e-12)
        XCTAssertEqual(nose.y, 0.2, accuracy: 1e-12)
        XCTAssertEqual(nose.c, 0.9, accuracy: 1e-12)
    }

    func testJointsOutsideTheImageGetConfidenceZero() throws {
        let f = VisionMapping.toPoseFrame(
            points: [
                .leftWrist: VisionPoint(x: 0.5, y: -0.1, confidence: 0.8),
                .rightWrist: VisionPoint(x: 1.2, y: 0.5, confidence: 0.8),
                .leftElbow: VisionPoint(x: .nan, y: 0.5, confidence: 0.8),
            ],
            aspect: 0.75,
            tMs: 0
        )
        XCTAssertEqual(try XCTUnwrap(f.joints?[.leftWrist]).c, 0)
        XCTAssertEqual(try XCTUnwrap(f.joints?[.rightWrist]).c, 0)
        XCTAssertNil(f.joints?[.leftElbow], "non-finite joints are left out")
    }
}
