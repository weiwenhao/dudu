import XCTest
@testable import dsbot

final class KeyboardAvoidanceTests: XCTestCase {
    func testAKeyboardThatLeavesDoesNotKeepTheComposerRaised() {
        XCTAssertFalse(KeyboardAvoidance.isVisible(endFrameMinY: 912, screenHeight: 912))
        XCTAssertFalse(KeyboardAvoidance.isVisible(endFrameMinY: 911.5, screenHeight: 912))
        XCTAssertFalse(KeyboardAvoidance.isVisible(endFrameMinY: 1_000, screenHeight: 912))
    }

    func testAKeyboardThatArrivesOrChangesIsRecognizedWithoutASecondLayoutDelay() {
        XCTAssertTrue(KeyboardAvoidance.isVisible(endFrameMinY: 528, screenHeight: 912))
        XCTAssertTrue(KeyboardAvoidance.isVisible(endFrameMinY: 480, screenHeight: 912))
    }

    func testWithoutAScreenHeightNoKeyboardCountsAsLeaving() {
        XCTAssertFalse(KeyboardAvoidance.isVisible(endFrameMinY: 300, screenHeight: 0))
    }
}
