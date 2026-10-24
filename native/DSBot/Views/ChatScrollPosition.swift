import CoreGraphics

enum ChatScrollPosition {
    static func isAtEnd(
        contentHeight: CGFloat, containerHeight: CGFloat, contentOffset: CGFloat,
        topInset: CGFloat = 0, bottomInset: CGFloat = 0
    ) -> Bool {
        contentHeight + topInset + bottomInset <= containerHeight ||
        bottomOffset(
            contentHeight: contentHeight, containerHeight: containerHeight,
            topInset: topInset, bottomInset: bottomInset
        ) - contentOffset <= 48
    }

    static func bottomOffset(
        contentHeight: CGFloat, containerHeight: CGFloat, topInset: CGFloat, bottomInset: CGFloat
    ) -> CGFloat {
        max(-topInset, contentHeight - containerHeight + bottomInset)
    }
}
