import XCTest
@testable import dsbot

final class AssistantCompletionTests: XCTestCase {
    func testLeadingAddressAndCaretInsertionKeepTheRestOfTheMessage() throws {
        let text = "  @DUD 看看👋\n下一行"
        let edit = ComposerEditingState(text: text, selection: NSRange(location: 6, length: 0))
        let query = try XCTUnwrap(AssistantCompletion.query(edit))
        XCTAssertEqual(query.kind, .issue)
        let (result, caret) = try XCTUnwrap(AssistantCompletion.insert("@DUD-7", query: query, in: text))
        XCTAssertEqual(result, "  @DUD-7 看看👋\n下一行")
        XCTAssertEqual(caret.location, 8)
        XCTAssertEqual(AssistantCompletion.address(result), .init(id: "DUD-7", body: "看看👋\n下一行"))
        XCTAssertNil(AssistantCompletion.query(.init(text: "正文 @DUD", selection: NSRange(location: 7, length: 0))))
        XCTAssertNil(AssistantCompletion.query(.init(text: "@DUD", selection: NSRange(location: 4, length: 0), isComposing: true)))
        XCTAssertNil(AssistantCompletion.address("@DUD-7后面不是地址"))
    }

    func testSkillRankingAndHighlightsRespectWholeTokensAndUTF16() throws {
        let skills = [AssistantSkill(name: "lark-im", description: ""), AssistantSkill(name: "skill-maker", description: "")]
        XCTAssertEqual(AssistantCompletion.rank(skills, query: "lim").map(\.name), ["lark-im"])
        let text = "👋 /lark-im /unknown"
        let query = try XCTUnwrap(AssistantCompletion.query(.init(
            text: text, selection: NSRange(location: 11, length: 0)
        )))
        XCTAssertEqual(query.kind, .skill)
        XCTAssertEqual(query.text, "lark-im")
        XCTAssertEqual(AssistantCompletion.highlights(text, skills: skills), [NSRange(location: 3, length: 8)])
        XCTAssertNil(AssistantCompletion.query(.init(text: "/tmp/file", selection: NSRange(location: 9, length: 0))))
        XCTAssertEqual(AssistantCompletion.address("@#7 hello"), .init(id: "#7", body: "hello"))
    }
}
