import XCTest
@testable import dsbot

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

    // The device log of 2026-11-07 12:37: 20 rows, the estimate 14,982 against 13,955 really, a viewport of 912 at the estimated end (offset 14,070), and the only
    // row built (1,652 tall) ending at 13,818: above the viewport. The latest (136 tall) was not built, so there was nothing to draw.
    private let blank = (
        rows: [HistoryRowFrame(id: "row18", minY: 12_166, maxY: 13_818)], contentOffset: CGFloat(14_070), viewport: CGFloat(912), content: CGFloat(14_982)
    )

    func testAViewportWithNoBuiltRowGoesToTheLastRowThatIsBuiltInsteadOfTheEndOfTheEstimate() {
        let answer = BlankViewportRecovery.target(
            latestID: "row19", rows: blank.rows, contentOffset: blank.contentOffset, viewportHeight: blank.viewport, contentHeight: blank.content, heldEstimate: nil
        )
        XCTAssertEqual(answer.target, "row18")
        XCTAssertEqual(answer.held, 14_982, "the estimate that was found blank is handed back")
    }

    func testTheEstimateThatWasFoundBlankIsNotTrustedAgainWhereverTheViewportIsNow() {
        // After the step the viewport shows the built row; "follow" is asked again (a second layout, the end of a drag): the end of the same estimate is still white.
        let shown = BlankViewportRecovery.target(
            latestID: "row19", rows: blank.rows, contentOffset: 12_906, viewportHeight: blank.viewport, contentHeight: blank.content, heldEstimate: 14_982
        )
        XCTAssertEqual(shown.target, "row18")
        XCTAssertEqual(shown.held, 14_982)
        // Rows were built and the estimate came back to what the rows reach: it is trusted again, and nothing is held.
        let corrected = BlankViewportRecovery.target(
            latestID: "row19", rows: blank.rows + [HistoryRowFrame(id: "row19", minY: 13_818, maxY: 13_955)], contentOffset: 13_043, viewportHeight: blank.viewport,
            contentHeight: 13_955, heldEstimate: 14_982
        )
        XCTAssertNil(corrected.target)
        XCTAssertNil(corrected.held)
        // A new estimate without the latest built is judged afresh: here the viewport shows a built row, so the latest is followed as usual.
        let changed = BlankViewportRecovery.target(
            latestID: "row19", rows: blank.rows, contentOffset: 12_906, viewportHeight: blank.viewport, contentHeight: 14_100, heldEstimate: 14_982
        )
        XCTAssertNil(changed.target)
        XCTAssertNil(changed.held)
    }

    func testAMessageThatArrivesWhileTheLastRowIsInViewIsFollowedAsUsual() {
        // The viewport shows the last built row; the new row is not built yet and the estimate has grown by its estimated height.
        let answer = BlankViewportRecovery.target(
            latestID: "new", rows: [HistoryRowFrame(id: "last", minY: 12_400, maxY: 13_043)], contentOffset: 12_131, viewportHeight: 912, contentHeight: 14_043, heldEstimate: nil
        )
        XCTAssertNil(answer.target)
        XCTAssertNil(answer.held)
    }

    func testAnInitialHistoryWithoutBuiltRowsUsesItsNormalInitialAnchor() {
        XCTAssertNil(BlankViewportRecovery.target(latestID: "row19", rows: [], contentOffset: 14_070, viewportHeight: 912, contentHeight: 14_982, heldEstimate: nil).target)
    }

    func testABuiltLatestOutsideTheViewportStillNeedsRecovery() {
        let answer = BlankViewportRecovery.target(
            latestID: "latest", rows: [HistoryRowFrame(id: "latest", minY: 7_286.67, maxY: 7_415)],
            contentOffset: 12_827.67, viewportHeight: 912, contentHeight: 13_739.67, heldEstimate: nil
        )
        XCTAssertEqual(answer.target, "latest", "The recorded 02:39 blank viewport has a built latest row thousands of points above it.")
        XCTAssertEqual(answer.held, 13_739.67)
        XCTAssertEqual(BlankViewportRecovery.target(
            latestID: "row18", rows: blank.rows, contentOffset: blank.contentOffset, viewportHeight: blank.viewport, contentHeight: blank.content, heldEstimate: 14_982
        ).target, "row18")
        XCTAssertNil(BlankViewportRecovery.target(
            latestID: "latest", rows: [HistoryRowFrame(id: "latest", minY: 7_286.67, maxY: 7_415)],
            contentOffset: 6_503, viewportHeight: 912, contentHeight: 7_415, heldEstimate: 13_739.67
        ).target, "The latest is now actually visible.")
    }

    func testAPreviouslyPopulatedHistoryCanMaterializeItsFirstOccurrenceWhenNoRowsRemain() {
        let answer = BlankViewportRecovery.target(
            latestID: "latest", rows: [], contentOffset: 12_827.67, viewportHeight: 912,
            contentHeight: 13_739.67, heldEstimate: nil, fallbackID: "first"
        )
        XCTAssertEqual(answer.target, "first")
        XCTAssertEqual(answer.held, 13_739.67)
    }

    func testTheLastBuiltRowIsTheOneWithTheGreatestBottomWhateverTheOrderOfTheRows() {
        let rows = [
            HistoryRowFrame(id: "b", minY: 5_000, maxY: 5_700), HistoryRowFrame(id: "c", minY: 5_700, maxY: 6_100), HistoryRowFrame(id: "a", minY: 4_000, maxY: 5_000),
        ]
        let answer = BlankViewportRecovery.target(latestID: "z", rows: rows, contentOffset: 9_000, viewportHeight: 912, contentHeight: 9_912, heldEstimate: nil)
        XCTAssertEqual(answer.target, "c")
    }
}
