import XCTest
@testable import dsbot

final class ConversationJumpTests: XCTestCase {
    func testFarJumpStartsOnTheFirstFrameAndTraversesMoreThanOneScreen() {
        var jump = ConversationJumpProgress(distance: 28_000, viewportHeight: 912)
        var offset = 28_000 * jump.advance(elapsed: 1.0 / 60)
        XCTAssertGreaterThan(offset, 0)
        XCTAssertLessThan(jump.duration, 1)
        offset += (28_000 - offset) * jump.advance(elapsed: jump.duration / 2)
        XCTAssertGreaterThan(offset, 14_000)
        XCTAssertLessThan(offset, 28_000)
        offset += (28_000 - offset) * jump.advance(elapsed: jump.duration)
        XCTAssertEqual(offset, 28_000, accuracy: 0.01)
    }

    func testLazyHeightChangesRetargetTheRemainingJourneyWithoutOvershooting() {
        for revisedEnd: CGFloat in [12_000, 40_000] {
            var jump = ConversationJumpProgress(distance: 28_000, viewportHeight: 912)
            var offset = 28_000 * jump.advance(elapsed: jump.duration / 10)
            let beforeRevision = offset
            offset += (revisedEnd - offset) * jump.advance(elapsed: jump.duration / 10)
            XCTAssertEqual(offset, beforeRevision)
            offset += (revisedEnd - offset) * jump.advance(elapsed: jump.duration / 2)
            XCTAssertGreaterThan(offset, beforeRevision)
            XCTAssertLessThan(offset, revisedEnd)
            offset += (revisedEnd - offset) * jump.advance(elapsed: jump.duration)
            XCTAssertEqual(offset, revisedEnd, accuracy: 0.01)
        }
    }
}
