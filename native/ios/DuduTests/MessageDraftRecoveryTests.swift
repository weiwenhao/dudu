import XCTest
@testable import Dudu

final class MessageDraftRecoveryTests: XCTestCase {
    func testFailurePreservesBothTheSubmittedTextAndTheNewDraft() {
        let submitted = MessageDraftRecovery(text: "first request")
        XCTAssertEqual(submitted.restoring(before: nil), "first request")
        XCTAssertEqual(submitted.restoring(before: "next request"), "first request\nnext request")
        XCTAssertEqual(submitted.restoring(before: "first request"), "first request\nfirst request")
        XCTAssertEqual(MessageDraftRecovery(text: "").restoring(before: "next"), "next")
        XCTAssertNil(MessageDraftRecovery(text: "").restoring(before: nil))
    }

    func testRecoveryPreservesExistingLineBreaksAndWhitespace() {
        XCTAssertEqual(
            MessageDraftRecovery(text: " first\n\n").restoring(before: "next  "),
            " first\n\nnext  "
        )
        XCTAssertEqual(MessageDraftRecovery(text: "first").restoring(before: "\nnext"), "first\nnext")
    }
}
