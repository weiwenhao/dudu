import XCTest
@testable import dsbot

final class ChatScrollPositionTests: XCTestCase {
    func testBottomOffsetUsesTheNativeViewportAndComposerInsetOnce() {
        XCTAssertEqual(ChatScrollPosition.bottomOffset(
            contentHeight: 1_900, containerHeight: 874, topInset: 0, bottomInset: 83
        ), 1_109)
        XCTAssertEqual(ChatScrollPosition.bottomOffset(
            contentHeight: 1_900, containerHeight: 554, topInset: 0, bottomInset: 59
        ), 1_405)
        XCTAssertEqual(ChatScrollPosition.bottomOffset(
            contentHeight: 400, containerHeight: 874, topInset: 0, bottomInset: 83
        ), 0)
        XCTAssertEqual(ChatScrollPosition.bottomOffset(
            contentHeight: 400, containerHeight: 874, topInset: 100, bottomInset: 83
        ), -100)
    }

    func testLatestPositionIncludesNativeInsetsWhenTheKeyboardChangesTheViewport() {
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 874, contentOffset: 1_109,
            topInset: 110, bottomInset: 83
        ))
        XCTAssertFalse(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 554, contentOffset: 1_109,
            topInset: 110, bottomInset: 59
        ))
        XCTAssertTrue(ChatScrollPosition.isAtEnd(
            contentHeight: 1_900, containerHeight: 554, contentOffset: 1_405,
            topInset: 110, bottomInset: 59
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
}
