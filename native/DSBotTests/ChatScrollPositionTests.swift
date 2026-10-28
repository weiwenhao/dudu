import XCTest
@testable import dsbot

final class ChatScrollPositionTests: XCTestCase {
    func testNativeGeometryUsesTheVisibleViewportWithoutAddingKeyboardInsetsAgain() {
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 912, contentOffset: 988
        ))
        XCTAssertFalse(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 566, contentOffset: 988
        ))
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 566, contentOffset: 1_334
        ))
    }

    func testContentFittingAboveTheComposerStaysAtEndDuringRubberBanding() {
        for contentOffset: CGFloat in [-120, 0, 120] {
            XCTAssertTrue(ChatScrollPosition.isAtEnd(
                contentHeight: 763, containerHeight: 777, contentOffset: contentOffset
            ))
            XCTAssertTrue(ChatScrollPosition.isAtEnd(
                contentHeight: 777, containerHeight: 777, contentOffset: contentOffset
            ))
        }
    }

    func testLongHistoryUsesTheVisibleContainerWithoutAddingTheFooterAgain() {
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 777, contentOffset: 1_123
        ))
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 777, contentOffset: 1_075
        ))
        XCTAssertFalse(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 777, contentOffset: 1_074
        ))
        XCTAssertFalse(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 777, contentOffset: 300
        ))
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 777, contentOffset: 1_240
        ))
    }

    func testViewportChangesReevaluateTheVisibleEnd() {
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_200, containerHeight: 777, contentOffset: 423
        ))
        XCTAssertFalse(ChatScrollPosition.isAtEnd(
            contentHeight: 1_200, containerHeight: 650, contentOffset: 423
        ))
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_200, containerHeight: 650, contentOffset: 550
        ))
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_200, containerHeight: 777, contentOffset: 550
        ))
    }

    func testNewReplyContentMovesTheEndUntilItIsScrolledIntoView() {
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_200, containerHeight: 777, contentOffset: 423
        ))
        XCTAssertFalse(ChatScrollPosition.isAtEnd(
            contentHeight: 1_400, containerHeight: 777, contentOffset: 423
        ))
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_400, containerHeight: 777, contentOffset: 623
        ))
    }

    func testTheJumpButtonWaitsUntilTheReaderIsATenthOfAViewportAboveTheEnd() {
        // 1,900 of content in a 912 viewport: the end is at offset 988 and a tenth of the viewport is 91, so 120 rules.
        XCTAssertFalse(ChatScrollPosition.isAwayFromEnd(contentHeight: 1_900, containerHeight: 912, contentOffset: 988))
        XCTAssertFalse(ChatScrollPosition.isAwayFromEnd(contentHeight: 1_900, containerHeight: 912, contentOffset: 868))
        XCTAssertTrue(ChatScrollPosition.isAwayFromEnd(contentHeight: 1_900, containerHeight: 912, contentOffset: 867))
        XCTAssertTrue(ChatScrollPosition.isAwayFromEnd(contentHeight: 1_900, containerHeight: 912, contentOffset: 0))
        // A tall viewport asks for a tenth of itself: 150 of 1,500.
        XCTAssertFalse(ChatScrollPosition.isAwayFromEnd(contentHeight: 3_000, containerHeight: 1_500, contentOffset: 1_350))
        XCTAssertTrue(ChatScrollPosition.isAwayFromEnd(contentHeight: 3_000, containerHeight: 1_500, contentOffset: 1_349))
    }

    func testTheJumpButtonNeverShowsForShortContentOrASmallNudge() {
        for contentOffset: CGFloat in [-120, 0, 120] {
            XCTAssertFalse(ChatScrollPosition.isAwayFromEnd(contentHeight: 700, containerHeight: 777, contentOffset: contentOffset))
        }
        // A drag of 100pt away from the end is still a nudge.
        XCTAssertFalse(ChatScrollPosition.isAwayFromEnd(contentHeight: 1_000, containerHeight: 300, contentOffset: 600))
    }
}
