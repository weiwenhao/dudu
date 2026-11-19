import XCTest
@testable import Dudu

final class AgentChoicesTests: XCTestCase {
    private func provider(_ id: String) -> SessionProvider { SessionProvider(id: id, name: id, modelIds: [], defaultModelId: "", isDefault: nil) }

    func testAnAgentTheAppDoesNotKnowDecodesAndIsNamedByItsId() throws {
        struct Holder: Codable { var agent: SessionAgent? }
        let pi = try JSONDecoder().decode(Holder.self, from: Data(#"{"agent":"pi"}"#.utf8))
        XCTAssertEqual(pi.agent, .pi)
        XCTAssertEqual(pi.agent?.name, "Pi")
        let next = try JSONDecoder().decode(Holder.self, from: Data(#"{"agent":"zed"}"#.utf8))
        XCTAssertEqual(next.agent?.name, "Zed", "the next harness is shown, not left out and not a decoding failure")
        XCTAssertEqual(try JSONDecoder().decode(Holder.self, from: Data("{}".utf8)).agent, nil)
        XCTAssertEqual(String(data: try JSONEncoder().encode(Holder(agent: .pi)), encoding: .utf8), #"{"agent":"pi"}"#)
    }

    func testTheListFollowsTheProvidersTheComputerHasSwitchedOn() {
        XCTAssertEqual(AgentChoices.of([provider("deepseek"), provider("claude"), provider("pi")]), [.claude, .pi, .deepseek])
        XCTAssertEqual(AgentChoices.of([provider("claude"), provider("codex")]), [.claude, .codex, .deepseek], "DeepSeek is DSH's own and always there")
        XCTAssertEqual(AgentChoices.of([provider("deepseek")], keeping: .pi), [.pi, .deepseek], "the agent an issue has stays in its list")
        XCTAssertEqual(AgentChoices.of([provider("deepseek"), provider("zed")]), [.deepseek, SessionAgent(rawValue: "zed")!], "a harness the app has no special case for is offered")
        XCTAssertEqual(AgentChoices.of([]), [.claude, .codex, .pi, .deepseek], "until the providers have come, the usual agents and none of the rarer harnesses")
        XCTAssertEqual(AgentChoices.of([], keeping: SessionAgent(rawValue: "grok")), [.claude, .codex, .pi, SessionAgent(rawValue: "grok")!, .deepseek], "the agent an issue has stays in its list")
        XCTAssertEqual(AgentChoices.known.count, SessionAgent.listed.count, "the Desktop's whole list (AgentNames.swift)")
        XCTAssertEqual(SessionAgent(rawValue: "opencode")?.name, "OpenCode", "named as the Desktop names it, not by its id")
    }
}
