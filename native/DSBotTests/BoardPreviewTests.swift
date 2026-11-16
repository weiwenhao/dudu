import XCTest
@testable import dsbot

final class BoardPreviewTests: XCTestCase {
    func testHomepagePreviewHidesImagePathsAndKeepsReadableText() {
        let image = "［\(L10n.text("图片"))］"
        for source in [
            "![当前看板完整截图](/Users/example/.local/current-board-full.png)",
            "![当前看板完整截图](/Users/example/unfinished",
            "![截图][board]\n\n[board]: https://example.invalid/private.png",
            "<img src=\"https://example.invalid/private.png\" alt=\"截图\">",
        ] {
            XCTAssertEqual(BoardMessagePreview.text(source), image)
        }
        XCTAssertEqual(BoardMessagePreview.text("**需要确认**：`路径`，查看[更新](https://example.invalid/review)。"),
                       "需要确认：路径，查看更新。")
        XCTAssertEqual(BoardMessagePreview.text("文字 ![截图](/tmp/a_(1).png) 继续。"), "文字 \(image) 继续。")
        XCTAssertEqual(BoardMessagePreview.text("普通消息和 issue_id 保持完整。"), "普通消息和 issue_id 保持完整。")
    }
}
