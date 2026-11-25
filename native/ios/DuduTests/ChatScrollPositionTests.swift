import XCTest
@testable import Dudu

final class ChatScrollPositionTests: XCTestCase {
    func testTopInsetDoesNotBreakFollowingWhenTheKeyboardChangesTheViewport() {
        // Device log: the 912pt scroll view has a 112pt top bar and a 355pt keyboard.
        let snapshots: [(content: CGFloat, viewport: CGFloat, offset: CGFloat)] = [
            (6_239, 800, 5_327),
            (6_223, 445, 5_666),
            (6_239, 800, 5_327),
        ]
        for snapshot in snapshots {
            XCTAssertTrue(ChatScrollPosition.shouldFollowAfterDrag(
                contentHeight: snapshot.content, containerHeight: snapshot.viewport,
                contentOffset: snapshot.offset, topInset: 112,
                beganFollowingWithKeyboard: false, keyboardVisible: snapshot.viewport == 445
            ))
            XCTAssertFalse(ChatScrollPosition.isAwayFromEnd(
                contentHeight: snapshot.content, containerHeight: snapshot.viewport,
                contentOffset: snapshot.offset, topInset: 112
            ))
            XCTAssertFalse(ChatScrollPosition.shouldFollowAfterDrag(
                contentHeight: snapshot.content, containerHeight: snapshot.viewport,
                contentOffset: snapshot.offset - 43, topInset: 112,
                beganFollowingWithKeyboard: false, keyboardVisible: snapshot.viewport == 445
            ))
            XCTAssertFalse(ChatScrollPosition.isAwayFromEnd(
                contentHeight: snapshot.content, containerHeight: snapshot.viewport,
                contentOffset: snapshot.offset - 43, topInset: 112
            ))
        }
        // Reading old messages stays separate from following, with or without the keyboard.
        for viewport: CGFloat in [445, 800] {
            XCTAssertFalse(ChatScrollPosition.shouldFollowAfterDrag(
                contentHeight: 6_239, containerHeight: viewport, contentOffset: 5_000, topInset: 112,
                beganFollowingWithKeyboard: false, keyboardVisible: viewport == 445
            ))
            XCTAssertTrue(ChatScrollPosition.isAwayFromEnd(
                contentHeight: 6_239, containerHeight: viewport, contentOffset: 5_000, topInset: 112
            ))
        }
    }

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

    func testADragAwayFromTheEndStaysReadingEvenWithinTheOldFollowTolerance() {
        // The 23:41 device log: a drag ends 43pt above the bottom, then "drag.end" pulls it back.
        XCTAssertFalse(ChatScrollPosition.shouldFollowAfterDrag(
            contentHeight: 2_137, containerHeight: 912, contentOffset: 1_182,
            beganFollowingWithKeyboard: false, keyboardVisible: false
        ))
        XCTAssertTrue(ChatScrollPosition.shouldFollowAfterDrag(
            contentHeight: 2_137, containerHeight: 912, contentOffset: 1_224.5,
            beganFollowingWithKeyboard: false, keyboardVisible: false
        ))
        XCTAssertTrue(ChatScrollPosition.shouldFollowAfterDrag(
            contentHeight: 2_137, containerHeight: 912, contentOffset: 1_240,
            beganFollowingWithKeyboard: false, keyboardVisible: false
        ))
    }

    func testKeyboardFollowingSurvivesOnlyAnActualDismissalFromTheLatest() {
        XCTAssertTrue(ChatScrollPosition.shouldFollowAfterDrag(
            contentHeight: 2_137, containerHeight: 912, contentOffset: 900,
            beganFollowingWithKeyboard: true, keyboardVisible: false
        ))
        XCTAssertFalse(ChatScrollPosition.shouldFollowAfterDrag(
            contentHeight: 2_137, containerHeight: 557, contentOffset: 900,
            beganFollowingWithKeyboard: true, keyboardVisible: true
        ))
        XCTAssertFalse(ChatScrollPosition.shouldFollowAfterDrag(
            contentHeight: 2_137, containerHeight: 912, contentOffset: 900,
            beganFollowingWithKeyboard: false, keyboardVisible: false
        ))
    }

    func testKeyboardOpeningBeforeADragEndsKeepsItsOriginalViewportForFollowing() {
        // 13:10:18 device log: at the end, then the keyboard reduces the viewport before drag.end.
        XCTAssertTrue(ChatScrollPosition.shouldFollowAfterDrag(
            contentHeight: 22_282, containerHeight: 445, contentOffset: 21_387.67, topInset: 112,
            beganFollowingWithKeyboard: false, keyboardVisible: true,
            viewportHeightBeforeKeyboard: 800
        ))
        // Opening the keyboard while reading must still leave the reader in place.
        XCTAssertFalse(ChatScrollPosition.shouldFollowAfterDrag(
            contentHeight: 22_282, containerHeight: 445, contentOffset: 21_200, topInset: 112,
            beganFollowingWithKeyboard: false, keyboardVisible: true,
            viewportHeightBeforeKeyboard: 800
        ))
        XCTAssertFalse(ChatScrollPosition.shouldFollowAfterDrag(
            contentHeight: 22_282, containerHeight: 445, contentOffset: 21_387.67, topInset: 112,
            beganFollowingWithKeyboard: false, keyboardVisible: true
        ))
    }
}
