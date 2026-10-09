import XCTest
@testable import DoomscrollerBlocker

final class OpenLogInterceptTests: XCTestCase {
    func testAFreshRequestIsConsumedExactlyOnce() {
        let log = OpenLog.shared
        _ = log.consumeIntercept() // start clean
        XCTAssertFalse(log.consumeIntercept(), "nothing requested")
        log.requestIntercept()
        XCTAssertTrue(log.consumeIntercept(), "the warning shows for a fresh request")
        XCTAssertFalse(log.consumeIntercept(), "and only once")
    }

    func testPassLengthComesFromSettings() {
        let old = UserDefaults.standard.object(forKey: "passMinutes")
        defer { UserDefaults.standard.set(old, forKey: "passMinutes") }
        UserDefaults.standard.removeObject(forKey: "passMinutes")
        XCTAssertEqual(OpenLog.passDuration, 30 * 60, "default stays 30 min until the product decision")
        UserDefaults.standard.set(15, forKey: "passMinutes")
        XCTAssertEqual(OpenLog.passDuration, 15 * 60)
    }
}
