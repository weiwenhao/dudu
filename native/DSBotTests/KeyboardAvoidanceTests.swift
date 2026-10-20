import XCTest
@testable import dsbot

final class KeyboardAvoidanceTests: XCTestCase {
    func testAKeyboardThatLeavesIsReleasedAtOnce() {
        // Its end frame starts at the bottom edge of the screen.
        XCTAssertEqual(KeyboardAvoidance.action(endFrameMinY: 912, screenHeight: 912), .release)
        XCTAssertEqual(KeyboardAvoidance.action(endFrameMinY: 911.5, screenHeight: 912), .release)
        XCTAssertEqual(KeyboardAvoidance.action(endFrameMinY: 1_000, screenHeight: 912), .release)
    }

    func testAKeyboardThatArrivesOrChangesIsMeasuredOnceItHasSettled() {
        XCTAssertEqual(KeyboardAvoidance.action(endFrameMinY: 528, screenHeight: 912), .settle(top: 528))
        XCTAssertEqual(KeyboardAvoidance.action(endFrameMinY: 480, screenHeight: 912), .settle(top: 480))
    }

    func testWithoutAScreenHeightNoKeyboardCountsAsLeaving() {
        // The screen height is unknown (zero) only when no scene exists, where holding a lift up is no help.
        XCTAssertEqual(KeyboardAvoidance.action(endFrameMinY: 300, screenHeight: 0), .release)
    }

    func testTheConversationReachesTheHomeIndicatorStripUntilTheKeyboardHasIt() {
        // Resting: the safe area is the home indicator's, and the conversation runs through it.
        XCTAssertEqual(KeyboardAvoidance.bottomReach(homeInset: 34, safeAreaBottom: 34), 34)
        // A keyboard (the safe area is its height) leaves nothing to run into.
        XCTAssertEqual(KeyboardAvoidance.bottomReach(homeInset: 34, safeAreaBottom: 336), 0)
        // Halfway through its arrival the reach is part of the strip, never more than it.
        XCTAssertEqual(KeyboardAvoidance.bottomReach(homeInset: 34, safeAreaBottom: 50), 18)
        XCTAssertEqual(KeyboardAvoidance.bottomReach(homeInset: 34, safeAreaBottom: 20), 34)
    }

    func testAPhoneWithoutAHomeIndicatorReachesNothing() {
        XCTAssertEqual(KeyboardAvoidance.bottomReach(homeInset: 0, safeAreaBottom: 0), 0)
        XCTAssertEqual(KeyboardAvoidance.bottomReach(homeInset: 0, safeAreaBottom: 291), 0)
    }
}
