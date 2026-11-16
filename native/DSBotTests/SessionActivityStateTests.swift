import XCTest
@testable import dsbot

final class SessionActivityStateTests: XCTestCase {
    func testOnlyTheThreeAutomaticStatesDecode() throws {
        for state in [SessionActivityState.idle, .processing, .unread] {
            let data = try JSONEncoder().encode(state)
            XCTAssertEqual(try JSONDecoder().decode(SessionActivityState.self, from: data), state)
        }
        for old in ["working", "blocked", "done", "asleep"] {
            XCTAssertThrowsError(try JSONDecoder().decode(SessionActivityState.self, from: Data("\"\(old)\"".utf8)))
        }
    }

    func testOldConversationCachesDecodeWithoutTurningOldAgentMarksIntoReadReceipts() throws {
        let json = #"{"id":"s1","title":"t","workspaceId":"w","workspaceName":"w","updatedAt":1,"status":"idle","agent":"claude","agentState":"done","agentFinished":true}"#
        let session = try JSONDecoder().decode(SessionSummary.self, from: Data(json.utf8))
        XCTAssertNil(session.sessionState)
    }

    func testReadPositionRoundTripsWithAndWithoutAVisibleStreamPrefix() throws {
        for position in [
            SessionReadPosition(seq: 12),
            SessionReadPosition(seq: 12, stream: .init(turn: 2, step: 1, digest: "4:123:456"))
        ] {
            let data = try JSONEncoder().encode(position)
            XCTAssertEqual(try JSONDecoder().decode(SessionReadPosition.self, from: data), position)
        }
    }

    func testSleepAndUnreadRemainIndependentFacts() throws {
        let json = #"{"id":"s1","title":"t","workspaceId":"w","workspaceName":"w","updatedAt":1,"status":"idle","agent":"claude","sessionState":"unread","deepSleep":true}"#
        let session = try JSONDecoder().decode(SessionSummary.self, from: Data(json.utf8))
        XCTAssertEqual(session.sessionState, .unread)
        XCTAssertEqual(session.deepSleep, true)
    }
}
