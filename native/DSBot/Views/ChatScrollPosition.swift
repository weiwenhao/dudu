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

enum HistoryPositioningAccess: Equatable {
    case suspended, preparing, visible

    static func resolve(covered: Bool, preparing: Bool, active: Bool) -> Self {
        guard active else { return .suspended }
        return !covered ? .visible : (preparing ? .preparing : .suspended)
    }
}

struct HistoryViewport: Equatable {
    let offset: CGFloat
    let height: CGFloat
    let contentHeight: CGFloat
    var topInset: CGFloat = 0
    var bottomInset: CGFloat = 0

    func contains(_ row: HistoryRowFrame) -> Bool {
        row.maxY > offset + topInset && row.minY < offset + height - bottomInset
    }

    func isAligned(_ row: HistoryRowFrame, anchor: CGFloat) -> Bool {
        let available = height - topInset - bottomInset
        let destination = max(-topInset, row.minY - topInset - anchor * (available - (row.maxY - row.minY)))
        return contains(row) && abs(offset - destination) <= 1
    }
}

struct HistoryScrollTarget: Equatable {
    let id: String
    let anchor: CGFloat
    let isRealized: Bool
    let isRecovery: Bool

    var readerID: AnyHashable {
        isRealized ? AnyHashable(RealizedHistoryAnchor(id: id)) : AnyHashable(id)
    }
}

/// Position through real rows and their immediate neighbours. An estimated distant end is never a target.
struct HistoryPositioning {
    struct Bookmark: Equatable {
        let id: String
        let anchor: CGFloat
    }

    enum Request: Equatable {
        case latest
        case reading(Bookmark)
    }

    private struct Command: Equatable {
        let target: HistoryScrollTarget
        let contentHeight: CGFloat
        let viewportHeight: CGFloat
        let topInset: CGFloat
        let bottomInset: CGFloat
        let rowIDs: Set<String>
        let targetFrame: HistoryRowFrame?
    }

    private(set) var access = HistoryPositioningAccess.suspended
    private(set) var request: Request?
    private var hasRealizedRows = false
    private var bookmark: Bookmark?
    private var lastCommand: Command?

    mutating func setAccess(_ next: HistoryPositioningAccess) {
        if access != next { lastCommand = nil }
        access = next
    }

    mutating func observe(rows: [HistoryRowFrame]) {
        if !rows.isEmpty { hasRealizedRows = true }
    }

    /// Capture only at gesture/page boundaries, never to reposition ordinary reading or keyboard changes.
    mutating func rememberReading(rows: [HistoryRowFrame], viewport: HistoryViewport) {
        let centre = viewport.offset + (viewport.height + viewport.topInset - viewport.bottomInset) / 2
        guard let row = rows.filter({ viewport.contains($0) }).min(by: {
            abs(($0.minY + $0.maxY) / 2 - centre) < abs(($1.minY + $1.maxY) / 2 - centre)
        }) else { return }
        let space = viewport.height - viewport.topInset - viewport.bottomInset - (row.maxY - row.minY)
        let anchor = abs(space) > 0.5 ? (row.minY - viewport.offset - viewport.topInset) / space : 0
        bookmark = Bookmark(id: row.id, anchor: min(1, max(0, anchor)))
        observe(rows: rows)
    }

    mutating func requestLatest() {
        request = .latest
        lastCommand = nil
    }

    mutating func interrupt() {
        request = nil
        lastCommand = nil
    }

    mutating func completeIfReached(
        itemIDs: [String], rows: [HistoryRowFrame], viewport: HistoryViewport, latestFromTop: Bool
    ) -> Request? {
        guard access != .suspended, let pending = request,
              let goal = destination(for: pending, itemIDs: itemIDs, latestFromTop: latestFromTop),
              let row = rows.first(where: { $0.id == goal.id }),
              viewport.isAligned(row, anchor: goal.anchor) else { return nil }
        request = nil
        return pending
    }

    mutating func nextTarget(
        itemIDs: [String], rows: [HistoryRowFrame], viewport: HistoryViewport,
        followsLatest: Bool, latestFromTop: Bool
    ) -> HistoryScrollTarget? {
        // Row registration can advance before the snapshot metadata. That is not a blank cached history.
        guard rows.isEmpty || rows.contains(where: { itemIDs.contains($0.id) }) else { return nil }
        observe(rows: rows)
        guard access != .suspended, let first = itemIDs.first else { return nil }
        if case .reading(let saved) = request, !itemIDs.contains(saved.id) {
            request = nil
            bookmark = nil
            lastCommand = nil
        }
        if request == nil, !followsLatest {
            guard hasRealizedRows, !rows.contains(where: viewport.contains) else { return nil }
            let nearest = rows.filter { itemIDs.contains($0.id) }.min {
                abs($0.minY - viewport.offset) < abs($1.minY - viewport.offset)
            }
            let saved = bookmark.flatMap { itemIDs.contains($0.id) ? $0 : nil }
            request = .reading(saved ?? Bookmark(id: nearest?.id ?? first, anchor: 0))
        }
        guard let goal = destination(for: request ?? .latest, itemIDs: itemIDs, latestFromTop: latestFromTop),
              let index = itemIDs.firstIndex(of: goal.id) else { return nil }
        if let row = rows.first(where: { $0.id == goal.id }), viewport.isAligned(row, anchor: goal.anchor) {
            return nil
        }
        let target: HistoryScrollTarget
        if rows.contains(where: { $0.id == goal.id }) {
            target = HistoryScrollTarget(
                id: goal.id, anchor: goal.anchor, isRealized: true,
                isRecovery: !rows.contains(where: viewport.contains) || (request != .latest && !followsLatest)
            )
        } else {
            let built = Set(rows.map(\.id))
            let nearest = itemIDs.indices.filter { built.contains(itemIDs[$0]) }.min { abs($0 - index) < abs($1 - index) }
            if let nearest {
                let next = nearest + (nearest < index ? 1 : -1)
                target = HistoryScrollTarget(
                    id: itemIDs[next], anchor: next == index ? goal.anchor : (nearest < index ? 0 : 1),
                    isRealized: false, isRecovery: true
                )
            } else {
                guard hasRealizedRows else { return nil }
                target = HistoryScrollTarget(id: first, anchor: 0, isRealized: false, isRecovery: true)
            }
        }
        let command = Command(
            target: target, contentHeight: viewport.contentHeight, viewportHeight: viewport.height,
            topInset: viewport.topInset, bottomInset: viewport.bottomInset,
            rowIDs: Set(rows.map(\.id)), targetFrame: rows.first { $0.id == target.id }
        )
        guard command != lastCommand else { return nil }
        lastCommand = command
        return target
    }

    private func destination(for request: Request, itemIDs: [String], latestFromTop: Bool) -> Bookmark? {
        switch request {
        case .latest: return itemIDs.last.map { Bookmark(id: $0, anchor: latestFromTop ? 0 : 1) }
        case .reading(let saved): return saved
        }
    }
}
