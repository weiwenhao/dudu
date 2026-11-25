import CoreGraphics

enum ChatScrollPosition {
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
