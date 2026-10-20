import CoreGraphics

/// What the composer does about the keyboard's new frame.
///
/// SwiftUI moves the composer with the keyboard by itself; `ChatView` only adds a correction for an overlap
/// SwiftUI left, measured once the keyboard has settled. That wait is for a keyboard that arrives or changes.
/// One that leaves needs no correction, and waiting would hold the composer up where the keyboard was.
enum KeyboardAvoidance {
    enum Action: Equatable {
        /// The keyboard is gone: drop any correction at once, so the composer goes down with it.
        case release
        /// The keyboard is up with its top at this screen y: measure the overlap after it has settled.
        case settle(top: CGFloat)
    }

    /// How long a keyboard that arrives gets to settle before the overlap is measured.
    static let settleNanoseconds: UInt64 = 450_000_000

    static func action(endFrameMinY: CGFloat, screenHeight: CGFloat) -> Action {
        endFrameMinY >= screenHeight - 1 ? .release : .settle(top: endFrameMinY)
    }

    /// How far the conversation reaches below the layout's bottom edge, which is the bottom safe area's top:
    /// the home indicator's strip, so the history runs to the screen's edge. The keyboard takes that strip
    /// over (the safe area grows to its height), and the reach eases from the whole strip to nothing as the
    /// safe area grows by one strip, so the composer never hops while the keyboard comes or goes.
    static func bottomReach(homeInset: CGFloat, safeAreaBottom: CGFloat) -> CGFloat {
        max(0, min(homeInset, 2 * homeInset - safeAreaBottom))
    }
}
