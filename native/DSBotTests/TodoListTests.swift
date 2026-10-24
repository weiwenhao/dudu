import XCTest
@testable import dsbot

final class TodoListTests: XCTestCase {
    private func item(_ status: String) -> TodoItem { TodoItem(content: status, status: status) }

    func testTheHeaderCountsEachStateThatHasItemsInDSHsOrder() {
        let todos = [item("pending"), item("in_progress"), item("completed"), item("pending"), item("completed")]
        XCTAssertEqual(TodoSummary.progress(todos), "2 已完成 · 1 进行中 · 2 待处理")
    }

    func testAStateWithNoItemsIsLeftOut() {
        XCTAssertEqual(TodoSummary.progress([item("in_progress"), item("pending"), item("pending"), item("pending")]), "1 进行中 · 3 待处理")
        XCTAssertEqual(TodoSummary.progress([item("completed"), item("completed")]), "2 已完成")
        XCTAssertEqual(TodoSummary.progress([item("pending")]), "1 待处理")
        XCTAssertEqual(TodoSummary.progress([]), "")
    }

    func testAnUnknownStateCountsAsWaiting() {
        XCTAssertEqual(TodoSummary.progress([item("weird"), item("completed")]), "1 已完成 · 1 待处理")
    }

    func testTheListAllowsAbsenceButRejectsMalformedHostData() throws {
        func detail(_ todos: String?) throws -> SessionDetail {
            let list = todos.map { #","todos": \#($0)"# } ?? ""
            let json = #"{"session": {"id": "s", "title": "t", "updatedAt": 1, "status": "idle"}, "planMode": false\#(list)}"#
            return try JSONDecoder().decode(SessionDetail.self, from: Data(json.utf8))
        }
        let decoded = try detail(#"[{"content": "补一项", "status": "in_progress"}, {"content": "再一项", "status": "pending"}]"#)
        XCTAssertEqual(decoded.todos, [TodoItem(content: "补一项", status: "in_progress"), TodoItem(content: "再一项", status: "pending")])
        XCTAssertTrue(decoded.todos?.first?.isInProgress == true)
        XCTAssertNil(try detail(nil).todos)
        XCTAssertThrowsError(try detail(#""not a list""#))
        XCTAssertThrowsError(try detail(#"[{"content": 7, "status": "pending"}]"#))
    }
}
