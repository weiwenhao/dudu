import CoreGraphics

enum ChatScrollPosition {
    static func isAtEnd(
        contentHeight: CGFloat, containerHeight: CGFloat, contentOffset: CGFloat
    ) -> Bool {
        contentHeight <= containerHeight || contentHeight - containerHeight - contentOffset <= 48
    }

    /// Far enough above the end that the jump-to-latest button is worth showing: a tenth of the viewport,
    /// and never less than 120pt, so a small nudge up does not flash it.
    static func isAwayFromEnd(
        contentHeight: CGFloat, containerHeight: CGFloat, contentOffset: CGFloat
    ) -> Bool {
        guard contentHeight > containerHeight else { return false }
        return contentHeight - containerHeight - contentOffset > max(120, containerHeight / 10)
    }
}
