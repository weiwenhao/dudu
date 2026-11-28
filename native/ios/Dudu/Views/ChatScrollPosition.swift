import CoreGraphics

enum ChatScrollPosition {
    /// What is left of the scroll view's frame once the top bar and, while it is up, the keyboard are taken off. SwiftUI reports a `List`'s `containerSize` as its whole frame
    /// (912pt on the owner's phone, keyboard up or not) and the bar and the keyboard as `contentInsets`; the rules below measure against the height that is left, so that
    /// `contentOffset + topInset` is how far the reader is from the top and `contentHeight - containerHeight` the longest way there is. Measured against the whole frame, the end was
    /// taken to be as much earlier as the insets add up to (467pt with the keyboard up): a drag of less than that ended "at the end" and the list sprang back to it (owner,
    /// 2026-11-27: 「往上拉它就自动弹到底部」; the device log has 33 such drag ends of 395, 16 of them with the keyboard up).
    static func visibleHeight(containerHeight: CGFloat, topInset: CGFloat, bottomInset: CGFloat) -> CGFloat {
        max(0, containerHeight - topInset - bottomInset)
    }

    static func isAtEnd(
        contentHeight: CGFloat, containerHeight: CGFloat, contentOffset: CGFloat, topInset: CGFloat = 0,
        tolerance: CGFloat = 48
    ) -> Bool {
        // The visible container excludes the top bar, but the offset still starts at -topInset.
        contentHeight <= containerHeight || contentHeight - containerHeight - (contentOffset + topInset) <= tolerance
    }

    /// The follow tolerance must not pull a reader back after a small drag away from the end.
    static func shouldFollowAfterDrag(
        contentHeight: CGFloat, containerHeight: CGFloat, contentOffset: CGFloat, topInset: CGFloat = 0,
        beganFollowingWithKeyboard: Bool, keyboardVisible: Bool,
        viewportHeightBeforeKeyboard: CGFloat? = nil
    ) -> Bool {
        // A keyboard that opens before deceleration ends must not turn its lost viewport into a reading gesture.
        let height = keyboardVisible ? max(containerHeight, viewportHeightBeforeKeyboard ?? containerHeight) : containerHeight
        return (beganFollowingWithKeyboard && !keyboardVisible) || isAtEnd(
            contentHeight: contentHeight, containerHeight: height,
            contentOffset: contentOffset, topInset: topInset, tolerance: 1
        )
    }

    /// Far enough above the end that the jump-to-latest button is worth showing: a tenth of the viewport,
    /// and never less than 120pt, so a small nudge up does not flash it.
    static func isAwayFromEnd(
        contentHeight: CGFloat, containerHeight: CGFloat, contentOffset: CGFloat, topInset: CGFloat = 0
    ) -> Bool {
        guard contentHeight > containerHeight else { return false }
        return contentHeight - containerHeight - (contentOffset + topInset) > max(120, containerHeight / 10)
    }
}
