import XCTest
@testable import dsbot

@MainActor
final class EmbeddedPagePoolTests: XCTestCase {
    func testDSHSchedulesUseTheWebRouteEvenInOlderSnapshots() {
        let web = NavigationOpen.Web(page: "panel", target: "schedules")
        let expected = NavigationTarget.web(page: .panel, target: "schedules")
        XCTAssertEqual(NavigationTarget(NavigationOpen(web: web)), expected)
        XCTAssertEqual(NavigationTarget(NavigationOpen(native: "schedule", web: web)), expected)
        XCTAssertEqual(NavigationTarget(NavigationOpen(native: "schedule")), .unsupported)
        XCTAssertEqual(
            NavigationTarget(NavigationOpen(native: "schedule", target: "dudu-tasks")), .tasks
        )
        XCTAssertEqual(
            NavigationItem(id: "dudu.tasks", title: "", open: NavigationOpen(native: "schedule")).target, .tasks
        )
    }

    func testOtherPageTargetsKeepIndependentState() {
        let pool = EmbeddedPagePool()
        let first = pool.session(page: .panel, target: "first", sessionID: nil)
        let second = pool.session(page: .panel, target: "second", sessionID: nil)
        XCTAssertFalse(first === second)
        XCTAssertTrue(first === pool.session(page: .panel, target: "first", sessionID: nil))
    }

    func testDiscardReleasedPagesPreservesTheScreenThatClaimedOne() {
        let pool = EmbeddedPagePool()
        let active = pool.session(page: .plugins, sessionID: nil)
        let released = pool.session(page: .panel, target: "insight", sessionID: nil)
        pool.release(page: .panel, target: "insight", sessionID: nil)

        pool.discardReleasedPages()

        XCTAssertTrue(active === pool.session(page: .plugins, sessionID: nil))
        XCTAssertFalse(released === pool.session(page: .panel, target: "insight", sessionID: nil))
        XCTAssertEqual(pool.keptPageCount, 0)
    }
}
