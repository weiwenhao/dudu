import XCTest
@testable import Dudu

final class BoardUnreadTests: XCTestCase {
    func testUnreadCountsTheScopeAndPinsOncePerSession() throws {
        let rows = try JSONDecoder().decode([BoardConversation].self, from: Data("""
        [
          {"id":"issue:1","title":"Active","sessionId":"active","preview":"","receivedAt":1,"sessionState":"unread","deepSleep":false,"unread":true,"readSeq":1,"pinned":true,
           "issue":{"id":1,"title":"Active","status":"todo","statusType":"todo","priority":"none","updatedAt":1}},
          {"id":"issue:2","title":"Complete","sessionId":"done","preview":"","receivedAt":1,"sessionState":"unread","deepSleep":false,"unread":true,"readSeq":1,"pinned":false,
           "issue":{"id":2,"title":"Complete","status":"done","statusType":"done","priority":"none","updatedAt":1}},
          {"id":"issue:3","title":"Plan","sessionId":"plan","preview":"","receivedAt":1,"sessionState":"unread","deepSleep":false,"unread":true,"readSeq":1,"pinned":true,
           "issue":{"id":3,"title":"Plan","status":"backlog","statusType":"backlog","priority":"none","updatedAt":1}},
          {"id":"assistant","title":"Dudu","preview":"","receivedAt":0,"sessionState":"idle","deepSleep":false,"unread":true,"readSeq":-1,"pinned":false}
        ]
        """.utf8))
        let active = rows.filter(BoardTab.active.includes)
        let pinned = rows.filter(\.pinned)
        XCTAssertEqual(BoardConversation.unreadSessionCount(in: active), 1)
        XCTAssertEqual(BoardConversation.unreadSessionCount(in: active + pinned), 2)
        XCTAssertEqual(BoardConversation.unreadSessionCount(in: rows), 3)
        var read = rows[0]
        read.unread = false
        XCTAssertEqual(BoardConversation.unreadSessionCount(in: [read]), 0)
        // 未读 holds every unread conversation whatever its workflow, and drops a row once it is read.
        XCTAssertEqual(BoardConversation.unreadSessionCount(in: rows.filter(BoardTab.unread.includes)), 3)
        XCTAssertTrue([read].filter(BoardTab.unread.includes).isEmpty)
    }
}
