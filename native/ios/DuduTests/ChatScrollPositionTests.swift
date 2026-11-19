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

    private let positioningIDs = ["first", "middle", "previous", "latest"]
    private let blankViewport = HistoryViewport(offset: 43_500, height: 912, contentHeight: 44_412)

    private func positioner() -> HistoryPositioning {
        var positioning = HistoryPositioning()
        positioning.setAccess(.visible)
        return positioning
    }

    private func next(
        _ positioning: inout HistoryPositioning, rows: [HistoryRowFrame],
        viewport: HistoryViewport? = nil, followsLatest: Bool = true
    ) -> HistoryScrollTarget? {
        positioning.nextTarget(
            itemIDs: positioningIDs, rows: rows, viewport: viewport ?? blankViewport,
            followsLatest: followsLatest, latestFromTop: false
        )
    }

    func testPositioningRemembersCachedRowsBeforeItsFirstCommand() {
        var positioning = positioner()
        positioning.observe(rows: [HistoryRowFrame(id: "latest", minY: 41_680, maxY: 41_926)])
        let target = next(&positioning, rows: [])
        XCTAssertEqual(target?.id, "first")
        XCTAssertEqual(target?.anchor, 0)
        XCTAssertEqual(target?.isRecovery, true)
    }

    func testPositioningLeavesNeverPopulatedHistoryOnItsNativeInitialAnchor() {
        var positioning = positioner()
        XCTAssertNil(next(&positioning, rows: []))
    }

    func testPositioningWaitsWhenTheRealizedTailBelongsToANewerSnapshot() {
        // 13:05:31 device log: the new tail is visible before the old item IDs are replaced.
        let row = HistoryRowFrame(id: "new.latest", minY: 40_020, maxY: 41_316)
        let viewport = HistoryViewport(offset: 40_404, height: 912, contentHeight: 41_316, topInset: 112)
        for following in [true, false] {
            var positioning = positioner()
            positioning.observe(rows: [HistoryRowFrame(id: "latest", minY: 38_500, maxY: 39_813)])
            XCTAssertNil(positioning.nextTarget(
                itemIDs: positioningIDs, rows: [row], viewport: viewport,
                followsLatest: following, latestFromTop: false
            ))
            XCTAssertNil(positioning.request)
            XCTAssertNil(positioning.nextTarget(
                itemIDs: positioningIDs + ["new.latest"], rows: [row], viewport: viewport,
                followsLatest: following, latestFromTop: false
            ))
        }
    }

    func testPositioningUsesTheBuiltRowInsteadOfItsLazyEstimatedRectangle() {
        var positioning = positioner()
        let target = next(&positioning, rows: [HistoryRowFrame(id: "latest", minY: 7_286.67, maxY: 7_415)])
        XCTAssertEqual(target?.readerID, AnyHashable(RealizedHistoryAnchor(id: "latest")))
        XCTAssertEqual(target?.isRecovery, true)
    }

    func testPositioningTraversesNeighboursUntilTheActualLatestIsAligned() {
        var positioning = positioner()
        positioning.requestLatest()
        var rows = [HistoryRowFrame(id: "first", minY: 0, maxY: 500)]
        for (index, expected) in ["middle", "previous", "latest"].enumerated() {
            let target = next(&positioning, rows: rows)
            XCTAssertEqual(target?.id, expected)
            XCTAssertEqual(target?.isRealized, false)
            XCTAssertEqual(positioning.request, .latest)
            rows.append(HistoryRowFrame(id: expected, minY: CGFloat(index + 1) * 500, maxY: CGFloat(index + 2) * 500))
        }
        // The estimated content end is still wrong; the real last row has reached the viewport's end.
        XCTAssertEqual(positioning.completeIfReached(
            itemIDs: positioningIDs, rows: rows,
            viewport: HistoryViewport(offset: 1_088, height: 912, contentHeight: 44_412), latestFromTop: false
        ), .latest)
        XCTAssertNil(positioning.request)
    }

    func testPositioningCannotCompleteWithAnUnbuiltOrMisalignedLatest() {
        var positioning = positioner()
        positioning.requestLatest()
        for rows in [[], [HistoryRowFrame(id: "first", minY: 0, maxY: 500)],
                     [HistoryRowFrame(id: "latest", minY: 43_400, maxY: 44_800)]] {
            XCTAssertNil(positioning.completeIfReached(
                itemIDs: positioningIDs, rows: rows, viewport: blankViewport, latestFromTop: false
            ))
            XCTAssertEqual(positioning.request, .latest)
        }
        XCTAssertEqual(next(&positioning, rows: [HistoryRowFrame(id: "first", minY: 0, maxY: 500)])?.id, "middle")
    }

    func testPositioningRecoversTheReadingBookmarkWithoutRequestingLatest() {
        var positioning = positioner()
        let middle = HistoryRowFrame(id: "middle", minY: 500, maxY: 1_500)
        let reading = HistoryViewport(offset: 500, height: 912, contentHeight: 44_412)
        positioning.rememberReading(rows: [middle], viewport: reading)
        XCTAssertEqual(next(&positioning, rows: [], followsLatest: false)?.id, "first")
        XCTAssertEqual(next(&positioning, rows: [HistoryRowFrame(id: "first", minY: 0, maxY: 500)], followsLatest: false)?.id, "middle")
        XCTAssertEqual(positioning.completeIfReached(
            itemIDs: positioningIDs, rows: [middle], viewport: reading, latestFromTop: false
        ), .reading(.init(id: "middle", anchor: 0)))
        XCTAssertNil(positioning.request)
        XCTAssertNil(next(&positioning, rows: [middle], viewport: reading, followsLatest: false))
    }

    func testPositioningPreservesAnOffsetInsideATallReadingRow() throws {
        var positioning = positioner()
        let row = HistoryRowFrame(id: "middle", minY: 200, maxY: 2_000)
        positioning.rememberReading(
            rows: [row], viewport: HistoryViewport(offset: 700, height: 912, contentHeight: 44_412)
        )
        let target = try XCTUnwrap(next(&positioning, rows: [row], followsLatest: false))
        XCTAssertEqual(target.id, "middle")
        XCTAssertEqual(target.anchor, 500 / 888, accuracy: 0.0001)
        XCTAssertNotNil(positioning.completeIfReached(
            itemIDs: positioningIDs, rows: [row],
            viewport: HistoryViewport(offset: 700, height: 912, contentHeight: 44_412), latestFromTop: false
        ))
    }

    func testPositioningDoesNotRealignReadableHistoryWhenTheKeyboardChanges() {
        var positioning = positioner()
        let row = HistoryRowFrame(id: "middle", minY: 500, maxY: 1_500)
        positioning.rememberReading(rows: [row], viewport: HistoryViewport(offset: 500, height: 912, contentHeight: 44_412))
        for height: CGFloat in [912, 557, 912] {
            XCTAssertNil(next(
                &positioning, rows: [row], viewport: HistoryViewport(offset: 600, height: height, contentHeight: 44_412),
                followsLatest: false
            ))
        }
    }

    func testPositioningRestoresReadingBackwardsThroughBuiltNeighbours() {
        var positioning = positioner()
        positioning.rememberReading(
            rows: [HistoryRowFrame(id: "middle", minY: 500, maxY: 1_500)],
            viewport: HistoryViewport(offset: 500, height: 912, contentHeight: 44_412)
        )
        _ = next(&positioning, rows: [], followsLatest: false)
        let previous = next(
            &positioning, rows: [HistoryRowFrame(id: "latest", minY: 2_000, maxY: 2_500)], followsLatest: false
        )
        XCTAssertEqual(previous?.id, "previous")
        XCTAssertEqual(previous?.anchor, 1)
        XCTAssertEqual(next(
            &positioning, rows: [HistoryRowFrame(id: "previous", minY: 1_500, maxY: 2_000)], followsLatest: false
        )?.id, "middle")
    }

    func testPositioningDoesNotKeepADeletedReadingBookmarkAsItsGoal() {
        var positioning = positioner()
        positioning.rememberReading(
            rows: [HistoryRowFrame(id: "middle", minY: 500, maxY: 1_500)],
            viewport: HistoryViewport(offset: 500, height: 912, contentHeight: 44_412)
        )
        _ = next(&positioning, rows: [], followsLatest: false)
        let target = positioning.nextTarget(
            itemIDs: ["first", "previous", "latest"],
            rows: [HistoryRowFrame(id: "previous", minY: 1_000, maxY: 2_000)], viewport: blankViewport,
            followsLatest: false, latestFromTop: false
        )
        XCTAssertEqual(target?.id, "previous")
        XCTAssertEqual(target?.isRealized, true)
        XCTAssertEqual(positioning.request, .reading(.init(id: "previous", anchor: 0)))
    }

    func testPositioningSuspendsAfterPreparationAndKeepsItsUnfinishedGoal() {
        var positioning = positioner()
        positioning.setAccess(.preparing)
        positioning.requestLatest()
        let rows = [HistoryRowFrame(id: "first", minY: 0, maxY: 500)]
        XCTAssertEqual(next(&positioning, rows: rows)?.id, "middle")
        positioning.setAccess(.resolve(covered: true, preparing: false, active: true))
        XCTAssertNil(next(&positioning, rows: rows))
        XCTAssertEqual(positioning.request, .latest)
        positioning.setAccess(.resolve(covered: false, preparing: false, active: true))
        XCTAssertEqual(next(&positioning, rows: rows)?.id, "middle")
        positioning.setAccess(.resolve(covered: false, preparing: true, active: false))
        XCTAssertNil(next(&positioning, rows: rows))
    }

    func testPositioningWaitsForNewLayoutInsteadOfRepeatingAnUnchangedCommand() {
        var positioning = positioner()
        let first = HistoryRowFrame(id: "first", minY: 0, maxY: 500)
        XCTAssertEqual(next(&positioning, rows: [first])?.id, "middle")
        XCTAssertNil(next(&positioning, rows: [first]))
        XCTAssertEqual(next(&positioning, rows: [first, HistoryRowFrame(id: "middle", minY: 500, maxY: 1_000)])?.id, "previous")
    }

    func testPositioningReleasesTheLatestRequestWhenTheReaderTakesControl() {
        var positioning = positioner()
        positioning.requestLatest()
        positioning.interrupt()
        XCTAssertNil(positioning.request)
        XCTAssertNil(next(
            &positioning, rows: [HistoryRowFrame(id: "first", minY: 0, maxY: 500)],
            viewport: HistoryViewport(offset: 0, height: 912, contentHeight: 44_412), followsLatest: false
        ))
    }

    func testPositioningFollowsAnAdjacentNewMessageWithoutTrustingTheDistantEstimate() {
        var positioning = positioner()
        positioning.requestLatest()
        let rows = [HistoryRowFrame(id: "latest", minY: 1_500, maxY: 2_000)]
        let viewport = HistoryViewport(offset: 1_088, height: 912, contentHeight: 44_412)
        let ids = positioningIDs + ["new"]
        XCTAssertNil(positioning.completeIfReached(itemIDs: ids, rows: rows, viewport: viewport, latestFromTop: false))
        XCTAssertEqual(positioning.nextTarget(
            itemIDs: ids, rows: rows, viewport: viewport, followsLatest: true, latestFromTop: false
        )?.id, "new")
    }

    func testPositioningRecognizesShortHistoryAndATopAlignedTallCard() {
        let short = HistoryViewport(offset: -112, height: 912, contentHeight: 500, topInset: 112)
        XCTAssertTrue(short.isAligned(HistoryRowFrame(id: "latest", minY: 0, maxY: 500), anchor: 1))
        let card = HistoryRowFrame(id: "latest", minY: 1_000, maxY: 3_000)
        let viewport = HistoryViewport(offset: 888, height: 912, contentHeight: 3_000, topInset: 112)
        XCTAssertTrue(viewport.isAligned(card, anchor: 0))
        XCTAssertFalse(viewport.isAligned(card, anchor: 1))
    }
}
