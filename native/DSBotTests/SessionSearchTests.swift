import XCTest
@testable import dsbot

final class SessionSearchTests: XCTestCase {
    private func session(_ id: String, title: String, updatedAt: Double, blank: Bool = false) -> SessionSummary {
        SessionSummary(id: id, title: title, workspaceName: "项目", updatedAt: updatedAt, status: "idle", blank: blank)
    }

    func testContentHitsAndTitleMatchesAreMergedOnceInRecentOrder() {
        let titleMatch = session("title", title: "DSBot 导航", updatedAt: 20)
        let contentMatch = session("content", title: "手机交互", updatedAt: 30)
        let blank = session("blank", title: "dsbot 新任务", updatedAt: 40, blank: true)
        let result = SessionSearchResults.merge(
            query: " dsbot ", sessions: [titleMatch, contentMatch, blank],
            hits: [
                SessionSearchHit(session: titleMatch, snippet: "更新 dsbot"),
                SessionSearchHit(session: contentMatch, snippet: "dsbot 内容命中"),
                SessionSearchHit(session: blank, snippet: "dsbot")
            ]
        )
        XCTAssertEqual(result.map(\.id), ["content", "title"])
        XCTAssertEqual(result.last?.snippet, "更新 dsbot")
    }

    func testAChineseContentHitDoesNotRequireTheQueryInTheTitle() {
        let conversation = session("one", title: "界面调整", updatedAt: 10)
        let result = SessionSearchResults.merge(
            query: "长按说话", sessions: [conversation],
            hits: [SessionSearchHit(session: conversation, snippet: "支持长按说话，松开发送。")]
        )
        XCTAssertEqual(result.map(\.id), ["one"])
        XCTAssertTrue(SessionSearchResults.merge(query: " \n ", sessions: [conversation], hits: result).isEmpty)
    }
}
