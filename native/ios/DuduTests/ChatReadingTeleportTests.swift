import XCTest
@testable import Dudu

/// 2026-11-24: when a turn ended, SwiftUI's List threw the history to the top inside its own batch update (the owner's phone: from 3984 to -126 in one step, the content 395 pt
/// shorter) and, with the reader's finger down, nothing put it back: the list went to the top while he read. `ChatReadingPolicy.offsetJumped` and `restore` put it back.
final class ChatReadingTeleportTests: XCTestCase {
    /// The list after the update: shorter than before, at the top.
    private let geometry = ChatReadingGeometry(offsetY: -126, contentHeight: 4501, viewportHeight: 912, insetTop: 112, insetBottom: 0)

    private func reading() -> ChatReadingPolicy {
        var policy = ChatReadingPolicy()
        policy.setMode(nil)
        return policy
    }

    func testAThrowToTheTopFromFarAwayIsPutBackAlsoWhileTheFingerIsDown() {
        var policy = reading()
        policy.offsetJumped(from: 3984, to: -126, geometry)
        // The reader's finger is down, so the reader owns the offset: except for this.
        let write = policy.layout(geometry, interacting: true, row: { _ in nil }, topRow: { nil })
        XCTAssertEqual(write, ChatReadingWrite(y: 3589, reason: .restore), "back to where it was, inside the bounds of the shorter content")
        XCTAssertNil(policy.layout(geometry, interacting: true, row: { _ in nil }, topRow: { nil }), "once")
    }

    func testNothingElseIsTakenForAThrow() {
        for (old, new) in [(3984.0, 3800.0), (300.0, -126.0), (-126.0, 3000.0), (3984.0, 2000.0)] {
            var policy = reading()
            policy.offsetJumped(from: CGFloat(old), to: CGFloat(new), geometry)
            XCTAssertNil(policy.layout(geometry, interacting: true, row: { _ in nil }, topRow: { nil }), "\(old) to \(new)")
        }
    }
}
