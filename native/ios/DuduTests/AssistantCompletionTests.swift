import XCTest
@testable import Dudu

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

    func testDeletingACompletedAddressNeverReopensSuggestions() {
        // A selection callback can precede the changed text when its trailing space is deleted.
        XCTAssertNil(AssistantCompletion.query(.init(
            text: "@DUD-7 ", selection: NSRange(location: 6, length: 0), isDeleting: true
        )))
        var text = "@DUD-7"
        repeat {
            let edit = ComposerEditingState(
                text: text, selection: NSRange(location: text.utf16.count, length: 0), isDeleting: true
            )
            XCTAssertNil(AssistantCompletion.query(edit))
            // A duplicate selection/text callback must not undo deletion suppression.
            XCTAssertNil(AssistantCompletion.query(edit))
            text.removeLast()
        } while !text.isEmpty
        // Typing a fresh @, or deliberately tapping into an address, can open suggestions again.
        XCTAssertNotNil(AssistantCompletion.query(.init(text: "@", selection: NSRange(location: 1, length: 0))))
        XCTAssertNotNil(AssistantCompletion.query(.init(text: "@DUD", selection: NSRange(location: 4, length: 0))))
    }

    func testDeletingAnOpenQueryContinuesOnlyItsOwnToken() throws {
        let query = try XCTUnwrap(AssistantCompletion.query(.init(
            text: "@DUD-7", selection: NSRange(location: 6, length: 0)
        )))
        let edit = ComposerEditingState(
            text: "@DUD-", selection: NSRange(location: 5, length: 0), isDeleting: true
        )
        let shortened = try XCTUnwrap(AssistantCompletion.query(edit, continuing: query))
        XCTAssertEqual(shortened.text, "DUD-")
        XCTAssertTrue(shortened.continues(query))
        XCTAssertEqual(AssistantCompletion.query(edit, continuing: shortened), shortened)

        let skill = try XCTUnwrap(AssistantCompletion.query(.init(
            text: "@DUD-7 /lark", selection: NSRange(location: 12, length: 0)
        )))
        XCTAssertNil(AssistantCompletion.query(.init(
            text: "@DUD-7", selection: NSRange(location: 6, length: 0), isDeleting: true
        ), continuing: skill))
        XCTAssertNil(AssistantCompletion.query(.init(
            text: "/lark", selection: NSRange(location: 5, length: 0), isDeleting: true
        ), continuing: skill))
    }
}
