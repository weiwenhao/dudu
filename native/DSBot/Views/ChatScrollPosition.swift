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
        beganFollowingWithKeyboard: Bool, keyboardVisible: Bool
    ) -> Bool {
        (beganFollowingWithKeyboard && !keyboardVisible) || isAtEnd(
            contentHeight: contentHeight, containerHeight: containerHeight,
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

/// A row of the history that the lazy stack has built: where it really is, in the scroll view's content.
struct HistoryRowFrame: Equatable {
    let id: String
    let minY: CGFloat
    let maxY: CGFloat
}

/// A distinct reader target attached to the actual, materialized row background.
struct RealizedHistoryAnchor: Hashable {
    let id: String
}

/// The white screen that only a swipe cured (owner, 2026-11-07; the device log of that moment is in `docs/native-mobile-fixes.md`). The lazy stack's height is an
/// estimate until the rows near its end are built, and it can be higher than the rows really reach. Following the latest message goes to the end of that estimate,
/// and an estimate that is too high puts the viewport past the last row: nothing is there to draw, nothing is built to correct the estimate, and going to the same
/// place again moves nothing, so it stayed white (every drag ended with "follow" putting the viewport back at the estimated end). The way out is through a row that
/// IS built: its place is real, what is built around it brings the estimate back, and the next layout goes to the latest as usual.
enum BlankViewportRecovery {
    /// The row to go to instead of the latest (`target`), or nil to go to the latest as usual; and the estimate that was found blank (`held`), to hand back next time.
    /// - The latest is built and visible: nothing to recover.
    /// - No row is built: a previously populated history can materialize its first occurrence again.
    /// - The viewport shows no built row, even if the latest exists elsewhere: go to the last built row.
    /// - The same estimate as when the viewport was found blank: still go to that row, however many times it is asked and wherever the viewport is now (going back
    ///   to the end of an estimate known to be too high is what made it white again after every drag). A new estimate (rows were built) is trusted again.
    static func target(
        latestID: String, rows: [HistoryRowFrame], contentOffset: CGFloat, viewportHeight: CGFloat,
        contentHeight: CGFloat, heldEstimate: CGFloat?, fallbackID: String? = nil
    ) -> (target: String?, held: CGFloat?) {
        guard let last = rows.max(by: { $0.maxY < $1.maxY }) else {
            return (fallbackID, fallbackID == nil ? nil : contentHeight)
        }
        let isVisible: (HistoryRowFrame) -> Bool = {
            $0.maxY > contentOffset && $0.minY < contentOffset + viewportHeight
        }
        if rows.contains(where: { $0.id == latestID && isVisible($0) }) { return (nil, nil) }
        if let heldEstimate, abs(heldEstimate - contentHeight) < 0.5 { return (last.id, heldEstimate) }
        let visible = rows.contains(where: isVisible)
        return visible ? (nil, nil) : (last.id, contentHeight)
    }
}
