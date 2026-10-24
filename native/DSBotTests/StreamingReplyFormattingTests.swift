import XCTest
@testable import dsbot

final class StreamingReplyFormattingTests: XCTestCase {
    func testParagraphsPreserveAllTextAndLineBreaks() async {
        let examples = [
            "", "中文 👩🏽‍💻", "\n\n开头\n\n", "第一段\n\n\n\n第二段",
            "列表：\n- 一\n- 二\n\n```swift\nlet text = \"继续\"\n\nprint(text)\n```\n\n完成"
        ]
        for text in examples {
            let paragraphs = await StreamingReplyFormatting.shared.paragraphs(for: text)
            XCTAssertEqual(paragraphs.joined(separator: "\n"), text)
        }
    }

    func testExtendingALiveParagraphKeepsCompletedParagraphsIdentical() async {
        let formatter = StreamingReplyFormatting()
        let earlier = await formatter.paragraphs(for: "第一段\n\n第二段\n\n开始")
        let updated = await formatter.paragraphs(for: "第一段\n\n第二段\n\n开始继续输出")
        XCTAssertEqual(Array(earlier.dropLast()), Array(updated.dropLast()))
        XCTAssertEqual(updated.last, "开始继续输出")
    }

    func testStartingANewParagraphOnlyAddsItsSeparatorToThePreviousTail() async {
        let paragraphs = await StreamingReplyFormatting.shared.paragraphs(for: "完成的段落\n\n新的段落")
        XCTAssertEqual(paragraphs, ["完成的段落\n", "新的段落"])
    }
}
