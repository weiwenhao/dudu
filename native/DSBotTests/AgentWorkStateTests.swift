import XCTest
@testable import dsbot

final class AgentWorkStateTests: XCTestCase {
    private func decode(_ raw: String) throws -> AgentWorkState {
        try JSONDecoder().decode(AgentWorkState.self, from: Data("\"\(raw)\"".utf8))
    }

    func testAFinishedRunNeedsYouLikeAQuestionOrAFailure() throws {
        XCTAssertEqual(try decode("idle"), .idle)
        XCTAssertEqual(try decode("working"), .working)
        XCTAssertEqual(try decode("blocked"), .blocked)
        // A Desktop plugin that has not been updated yet still says "done".
        XCTAssertEqual(try decode("done"), .blocked)
    }

    func testAStateNobodyKnowsIsStillRefused() {
        XCTAssertThrowsError(try decode("asleep"))
    }

    func testTheSidebarRowOfAnOldPluginStillDecodes() throws {
        let json = #"{"id":"s1","title":"t","workspaceId":"w","workspaceName":"w","updatedAt":1,"status":"idle","agent":"claude","agentState":"done"}"#
        let session = try JSONDecoder().decode(SessionSummary.self, from: Data(json.utf8))
        XCTAssertEqual(session.agentState, .blocked)
        XCTAssertEqual(AgentWorkState.blocked.name, L10n.text("需要你"))
    }

    func testAFinishedRunIsToldFromAQuestionByTheAvatarsMark() throws {
        let finished = #"{"id":"s1","title":"t","workspaceId":"w","workspaceName":"w","updatedAt":1,"status":"idle","agent":"claude","agentState":"blocked","agentFinished":true}"#
        let asked = #"{"id":"s2","title":"t","workspaceId":"w","workspaceName":"w","updatedAt":1,"status":"waiting","agent":"claude","agentState":"blocked"}"#
        let done = try JSONDecoder().decode(SessionSummary.self, from: Data(finished.utf8))
        let question = try JSONDecoder().decode(SessionSummary.self, from: Data(asked.utf8))
        XCTAssertEqual([done.agentState, question.agentState], [.blocked, .blocked], "the same state: it needs you")
        XCTAssertEqual(done.agentFinished, true)
        XCTAssertNil(question.agentFinished, "a plugin that says nothing, or a question: red")
    }

    func testDeepSleepIsAFlagOfAnIdleAgentNotAState() throws {
        let asleep = #"{"id":"s1","title":"t","workspaceId":"w","workspaceName":"w","updatedAt":1,"status":"idle","agent":"claude","agentState":"idle","deepSleep":true}"#
        let awake = #"{"id":"s2","title":"t","workspaceId":"w","workspaceName":"w","updatedAt":1,"status":"idle","agent":"claude","agentState":"idle"}"#
        let sleeping = try JSONDecoder().decode(SessionSummary.self, from: Data(asleep.utf8))
        let resting = try JSONDecoder().decode(SessionSummary.self, from: Data(awake.utf8))
        XCTAssertEqual([sleeping.agentState, resting.agentState], [.idle, .idle], "the same state: the agent is idle")
        XCTAssertEqual(sleeping.deepSleep, true)
        XCTAssertNil(resting.deepSleep, "a plugin that says nothing, or an agent that is awake: the ring")
    }
}
