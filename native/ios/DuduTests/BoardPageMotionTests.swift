import SwiftUI
import XCTest
@testable import Dudu

/// On 2026-11-24 a conversation opened at 03:56 and the board ignored every touch for 171 s: the animation's end notice, which
/// lets go of the input, never came (owner: cannot scroll, cannot go back). The watchdog is what ends such a transition.
@MainActor
final class BoardPageMotionTests: XCTestCase {
    private final class Notice { var done: (() -> Void)? }

    private func motion(_ notice: Notice, moving: Bool) -> BoardPageMotion {
        // No timer is waited for: a zero delay lets the watchdog run as soon as the test yields.
        BoardPageMotion(watchdogDelay: .zero) { _, body, done in
            if moving { body() }
            notice.done = done
        }
    }

    private func yieldWhileLocked(_ motion: BoardPageMotion) async {
        for _ in 0..<50 where motion.isAnimating { await Task.yield() }
    }

    func testATransitionWhoseEndNoticeNeverComesLetsGoOfTheInputAndPutsThePageWhereItWasGoing() async {
        let notice = Notice()
        let motion = motion(notice, moving: false)
        var finished = 0
        motion.animate(showingConversation: true, animation: .linear(duration: 1), completion: { finished += 1 })
        XCTAssertTrue(motion.isAnimating, "the input is held while the page moves")
        await yieldWhileLocked(motion)
        XCTAssertFalse(motion.isAnimating)
        XCTAssertEqual(motion.progress, 1)
        XCTAssertEqual(finished, 1)
        notice.done?()
        XCTAssertEqual(finished, 1, "a notice that turns up late is not taken a second time")
    }

    func testTheAnimationsNoticeEndsATransitionOnceAndTheWatchdogLeavesItAlone() async {
        let notice = Notice()
        let motion = motion(notice, moving: true)
        var finished = 0
        motion.animate(showingConversation: false, animation: .linear(duration: 1), completion: { finished += 1 })
        notice.done?()
        XCTAssertFalse(motion.isAnimating)
        XCTAssertEqual(finished, 1)
        for _ in 0..<10 { await Task.yield() }
        XCTAssertEqual(finished, 1)
    }
}
