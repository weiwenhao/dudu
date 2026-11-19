import XCTest
@testable import Dudu

final class LocalizationTests: XCTestCase {
    func testSupportedLanguageResolutionAndFallback() {
        XCTAssertEqual(L10n.resolve(["en-AU"]), "en")
        XCTAssertEqual(L10n.resolve(["zh_Hans_CN"]), "zh-Hans")
        XCTAssertEqual(L10n.resolve(["fr", "en"]), "en")
        XCTAssertEqual(L10n.resolve([]), "zh-Hans")
    }

    func testSubstitutionKeepsUserBracesAndRepeatedArgumentsLiteral() {
        let content = "{1} $& 原文 👋"
        XCTAssertEqual(L10n.render("{0} · {1} · {0}", values: [content, "tail"]),
                       "\(content) · tail · \(content)")
        XCTAssertEqual(L10n.render("{2} {x}", values: ["unchanged"]), "{2} {x}")
    }
}
