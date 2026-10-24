import CoreGraphics

enum KeyboardAvoidance {
    static func isVisible(endFrameMinY: CGFloat, screenHeight: CGFloat) -> Bool {
        screenHeight > 0 && endFrameMinY < screenHeight - 1
    }

    /// How far the conversation reaches below the layout's bottom edge, which is the bottom safe area's top:
    /// the home indicator's strip, so the history runs to the screen's edge. The keyboard takes that strip
    /// over (the safe area grows to its height), and the reach eases from the whole strip to nothing as the
    /// safe area grows by one strip, so the composer never hops while the keyboard comes or goes.
    static func bottomReach(homeInset: CGFloat, safeAreaBottom: CGFloat) -> CGFloat {
        max(0, min(homeInset, 2 * homeInset - safeAreaBottom))
    }
}
