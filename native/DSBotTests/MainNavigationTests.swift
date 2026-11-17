import XCTest
@testable import dsbot

final class MainNavigationTests: XCTestCase {
    private let inbox = MainDestination(id: "dudu.collector", area: .sidebar, target: .collector, title: "")
    private let tasks = MainDestination(id: "dudu.tasks", area: .sidebar, target: .tasks, title: "")

    func testSidebarPagesReturnToBoardDespiteARetainedConversation() {
        var navigation = MainNavigation()
        // A conversation was previously opened, then Home was chosen. Retaining its session must
        // not make it the predecessor of a page opened from the board.
        navigation.reset(to: .conversation)
        navigation.reset(to: .board)
        for page in [inbox, tasks] {
            XCTAssertTrue(navigation.open(page))
            XCTAssertEqual(navigation.previous, .board)
            XCTAssertEqual(navigation.root, .board)
            XCTAssertTrue(navigation.pop(expected: navigation.pages.last!.id))
            XCTAssertEqual(navigation.destination, .board)
            XCTAssertNil(navigation.previous)
        }
    }

    func testPagesOpenedFromConversationReturnToThatConversation() {
        var navigation = MainNavigation()
        navigation.reset(to: .conversation)
        for page in [inbox, tasks] {
            navigation.open(page)
            XCTAssertEqual(navigation.previous, .conversation)
            XCTAssertTrue(navigation.pop(expected: navigation.pages.last!.id))
            XCTAssertEqual(navigation.destination, .conversation)
        }
    }

    func testNestedReturnKeepsThePreviousPageIdentityUntilCommit() {
        var navigation = MainNavigation()
        navigation.open(inbox)
        let inboxID = navigation.pages.last!.id
        navigation.open(tasks)
        let tasksID = navigation.pages.last!.id
        XCTAssertFalse(navigation.open(tasks), "Choosing the current page must not add another return.")
        XCTAssertEqual(navigation.previous, inbox)
        XCTAssertEqual(navigation.pages.first?.id, inboxID)
        XCTAssertFalse(navigation.pop(expected: inboxID), "A stale completion cannot pop another page.")
        XCTAssertEqual(navigation.destination, tasks)
        XCTAssertTrue(navigation.pop(expected: tasksID))
        XCTAssertEqual(navigation.destination, inbox)
        XCTAssertEqual(navigation.pages.last?.id, inboxID)
        XCTAssertTrue(navigation.pop(expected: inboxID))
        XCTAssertEqual(navigation.destination, .board)
    }

    func testExplicitRootNavigationDiscardsOldReturnCompletions() {
        var navigation = MainNavigation()
        navigation.open(inbox)
        let oldPageID = navigation.pages.last!.id
        navigation.open(.conversation)
        XCTAssertTrue(navigation.pages.isEmpty)
        XCTAssertFalse(navigation.pop(expected: oldPageID))
        XCTAssertEqual(navigation.destination, .conversation)

        navigation.open(tasks)
        let anotherOldPageID = navigation.pages.last!.id
        navigation.reset(to: .board) // Switching computer starts again at Home.
        navigation.open(inbox)
        XCTAssertFalse(navigation.pop(expected: anotherOldPageID))
        XCTAssertEqual(navigation.destination, inbox)
        XCTAssertEqual(navigation.previous, .board)
    }
}
