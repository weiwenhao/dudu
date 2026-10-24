import XCTest
@testable import dsbot

@MainActor
final class EmbeddedPagePoolTests: XCTestCase {
    func testOtherPageTargetsKeepIndependentState() {
        let pool = EmbeddedPagePool()
        let first = pool.session(page: .panel, target: "first", sessionID: nil)
        let second = pool.session(page: .panel, target: "second", sessionID: nil)
        XCTAssertFalse(first === second)
        XCTAssertTrue(first === pool.session(page: .panel, target: "first", sessionID: nil))
    }
}
