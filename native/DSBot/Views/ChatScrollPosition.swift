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

/// A row of the history that the lazy stack has built: where it really is, in the scroll view's content.
struct HistoryRowFrame: Equatable {
    let id: String
    let minY: CGFloat
    let maxY: CGFloat
}

/// The white screen that only a swipe cured (owner, 2026-11-07; the device log of that moment is in `docs/native-mobile-fixes.md`). The lazy stack's height is an
/// estimate until the rows near its end are built, and it can be higher than the rows really reach. Following the latest message goes to the end of that estimate,
/// and an estimate that is too high puts the viewport past the last row: nothing is there to draw, nothing is built to correct the estimate, and going to the same
/// place again moves nothing, so it stayed white (every drag ended with "follow" putting the viewport back at the estimated end). The way out is through a row that
/// IS built: its place is real, what is built around it brings the estimate back, and the next layout goes to the latest as usual.
enum BlankViewportRecovery {
    /// The row to go to instead of the latest (`target`), or nil to go to the latest as usual; and the estimate that was found blank (`held`), to hand back next time.
    /// - The latest is built: its place is real, nothing to do.
    /// - No row is built yet: nothing real to go to, as usual.
    /// - The viewport shows no built row (the latest not being built): go to the last row that is built.
    /// - The same estimate as when the viewport was found blank: still go to that row, however many times it is asked and wherever the viewport is now (going back
    ///   to the end of an estimate known to be too high is what made it white again after every drag). A new estimate (rows were built) is trusted again.
    static func target(
        latestID: String, rows: [HistoryRowFrame], contentOffset: CGFloat, viewportHeight: CGFloat,
        contentHeight: CGFloat, heldEstimate: CGFloat?
    ) -> (target: String?, held: CGFloat?) {
        guard !rows.contains(where: { $0.id == latestID }), let last = rows.max(by: { $0.maxY < $1.maxY }) else { return (nil, nil) }
        if let heldEstimate, abs(heldEstimate - contentHeight) < 0.5 { return (last.id, heldEstimate) }
        let visible = rows.contains { $0.maxY > contentOffset && $0.minY < contentOffset + viewportHeight }
        return visible ? (nil, nil) : (last.id, contentHeight)
    }
}
