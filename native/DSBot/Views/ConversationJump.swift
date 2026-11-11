import SwiftUI
import UIKit

/// Advance through the remaining distance, adapting when the lazy stack revises its estimate.
struct ConversationJumpProgress {
    let duration: TimeInterval
    private(set) var progress: CGFloat = 0

    init(distance: CGFloat, viewportHeight: CGFloat) {
        let screens = max(0, distance) / max(1, viewportHeight)
        duration = min(1.6, 0.28 + 0.02 * Double(screens))
    }

    mutating func advance(elapsed: TimeInterval) -> CGFloat {
        let time = min(1, max(0, elapsed / duration))
        let next = max(progress, CGFloat(1 - pow(1 - time, 3)))
        let fraction = progress < 1 ? (next - progress) / (1 - progress) : 0
        progress = next
        return fraction
    }
}

/// Used only for an explicit jump. Normal dragging, keyboard movement and following remain in SwiftUI.
@MainActor
final class ConversationJump: NSObject {
    private var displayLink: CADisplayLink?
    private var trajectory: ConversationJumpProgress
    private let geometry: () -> [String: Double]
    private let startedAt = CACurrentMediaTime()
    private var hasMoved = false
    private var hasRecordedProgress = false
    private var isLanding = false
    private var frame: ((CGFloat) -> Void)?
    private var completion: (() -> Void)?

    init(
        trajectory: ConversationJumpProgress, geometry: @escaping () -> [String: Double],
        frame: @escaping (CGFloat) -> Void, completion: @escaping () -> Void
    ) {
        self.trajectory = trajectory
        self.geometry = geometry
        self.frame = frame
        self.completion = completion
        super.init()
        let link = CADisplayLink(target: self, selector: #selector(advance(_:)))
        displayLink = link
        link.add(to: .main, forMode: .common)
    }

    func cancel() {
        displayLink?.invalidate()
        displayLink = nil
        frame = nil
        completion = nil
    }

    @objc private func advance(_ link: CADisplayLink) {
        if isLanding {
            finish()
            return
        }
        let elapsed = max(0, link.timestamp - startedAt)
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            frame?(trajectory.advance(elapsed: elapsed))
        }
        if !hasMoved {
            hasMoved = true
            DSBotLog.record("chat.latest.animation", elapsedMs: elapsed * 1_000, geometry: geometry())
        }
        if !hasRecordedProgress, elapsed >= trajectory.duration / 2 {
            hasRecordedProgress = true
            DSBotLog.record("chat.latest.progress", elapsedMs: elapsed * 1_000, geometry: geometry())
        }
        // Let the last message command lay out before enabling ordinary following again.
        if elapsed >= trajectory.duration { isLanding = true }
    }

    private func finish() {
        let callback = completion
        cancel()
        callback?()
    }
}

/// Locate the current native history at tap time; SwiftUI can replace its UIScrollView during updates.
@MainActor
final class ScrollMetrics {
    weak var locator: UIView?
    let diagnosticID = UUID().uuidString
    var latestID: String?
    /// The latest row is a card (`ConversationHistoryItem.isCard`) and the owner asked for it (`ConversationHistoryView.cardFromTop`): while it is taller than what can be seen, following and the jump to the
    /// latest end at its top, so that its title and first rows are in view, and not at its bottom (owner, 2026-11-11: after 待办 the chat goes to the card by itself).
    var latestIsCard = false
    var showsCardFromTop = false
    var jumpStartedAt: TimeInterval?
    var isReviewPositioning = false
    private var layoutRecordsRemaining = 12
    private var commandRecordsRemaining = 32
    private var followingCommandCount = 0
    private var rows: [String: WeakHistoryRow] = [:]
    private var jump: ConversationJump?
    private var hasRealizedRows = false
    /// The estimated height at which the viewport was found with no built row in it (`BlankViewportRecovery`).
    private var heldEstimate: CGFloat?

    struct FollowingTarget {
        let id: String
        let isRealized: Bool
        let isRecovery: Bool
        let anchor: CGFloat

        var readerID: AnyHashable {
            isRealized ? AnyHashable(RealizedHistoryAnchor(id: id)) : AnyHashable(id)
        }
    }

    func followingTarget(latestID: String, firstID: String?) -> FollowingTarget {
        guard let scrollView else {
            return FollowingTarget(id: latestID, isRealized: false, isRecovery: false, anchor: 1)
        }
        let frames = rowFrames(in: scrollView)
        if !frames.isEmpty { hasRealizedRows = true }
        let answer = BlankViewportRecovery.target(
            latestID: latestID, rows: frames, contentOffset: scrollView.contentOffset.y, viewportHeight: scrollView.bounds.height,
            contentHeight: scrollView.contentSize.height, heldEstimate: heldEstimate,
            fallbackID: hasRealizedRows ? firstID : nil
        )
        heldEstimate = answer.held
        let id = answer.target ?? latestID
        let isRealized = frames.contains { $0.id == id }
        var anchor: CGFloat = answer.target != nil && !isRealized ? 0 : 1
        if answer.target == nil, id == self.latestID, cardIsShownFromTop(frames: frames, in: scrollView) { anchor = 0 }
        return FollowingTarget(id: id, isRealized: isRealized, isRecovery: answer.target != nil, anchor: anchor)
    }

    /// Whether the latest row is a card to be shown from its top: asked for, and as tall as what can be seen or taller. A card that is not built yet is taken for one (its top is where it is shown from;
    /// a short one is held at the end by the end of the content once it is built).
    private func cardIsShownFromTop(frames: [HistoryRowFrame], in scrollView: UIScrollView) -> Bool {
        guard showsCardFromTop, latestIsCard, let latestID else { return false }
        guard let card = frames.first(where: { $0.id == latestID }) else { return true }
        let inset = scrollView.adjustedContentInset
        return card.maxY - card.minY > scrollView.bounds.height - inset.top - inset.bottom
    }

    /// Where the journey to the latest ends: the end of the content, or, for a card shown from its top, the offset that puts its top at the top of what can be seen.
    private func endOffset(in scrollView: UIScrollView) -> CGFloat {
        let inset = scrollView.adjustedContentInset
        let contentEnd = max(-inset.top, scrollView.contentSize.height - scrollView.bounds.height + inset.bottom)
        guard showsCardFromTop, latestIsCard, let latestID else { return contentEnd }
        let frames = rowFrames(in: scrollView)
        guard let card = frames.first(where: { $0.id == latestID }), cardIsShownFromTop(frames: frames, in: scrollView) else { return contentEnd }
        return min(contentEnd, card.minY - inset.top)
    }

    var latestIsVisible: Bool {
        guard let scrollView, let latestID else { return false }
        return rowFrames(in: scrollView).contains {
            $0.id == latestID && $0.maxY > scrollView.bounds.minY && $0.minY < scrollView.bounds.maxY
        }
    }

    /// Whether the latest row is out of the reach of a single command: it is not built, and the row before it is not built either. Only a built row has a place of its own, and
    /// the one right after it; a row further off is where the lazy stack's estimate puts it, and that estimate follows whichever rows happen to be built (device log of
    /// 2026-11-12 00:40:41: 18 571 → 42 351 pt within 55 ms of a send, nothing built where the viewport was, and the way out was the first row: the top of the thread).
    /// Such a row is reached by walking, as the jump does, row after row from what is built. False while a jump is on its way, and when nothing at all is built.
    func needsWalk(to latestID: String, itemIDs: [String]) -> Bool {
        guard let scrollView, jumpStartedAt == nil else { return false }
        let built = Set(rowFrames(in: scrollView).map(\.id))
        guard !built.isEmpty, !built.contains(latestID), let index = itemIDs.lastIndex(of: latestID), index > 0 else { return false }
        return !built.contains(itemIDs[index - 1])
    }

    private func rowFrames(in scrollView: UIScrollView) -> [HistoryRowFrame] {
        rows.compactMap { id, marker in
            guard let view = marker.view, view.isDescendant(of: scrollView) else { return nil }
            let frame = view.convert(view.bounds, to: scrollView)
            guard frame.height > 0 else { return nil }
            return HistoryRowFrame(id: id, minY: frame.minY, maxY: frame.maxY)
        }
    }

    var geometry: [String: Double] {
        guard let scrollView else { return [:] }
        return [
            "contentOffset": Double(scrollView.contentOffset.y),
            "contentHeight": Double(scrollView.contentSize.height),
            "viewportHeight": Double(scrollView.bounds.height),
            "topInset": Double(scrollView.adjustedContentInset.top),
            "bottomInset": Double(scrollView.adjustedContentInset.bottom)
        ]
    }

    func recordFollowing(reason: String, targetID: String, messageCount: Int) {
        followingCommandCount += 1
        guard commandRecordsRemaining > 0 else { return }
        commandRecordsRemaining -= 1
        recordLayout(
            event: "chat.scroll.command", messageCount: messageCount, following: true,
            state: reason, targetID: targetID
        )
    }

    func recordLayout(
        event: String = "chat.scroll.layout", messageCount: Int, following: Bool,
        state: String? = nil, targetID: String? = nil
    ) {
        if event == "chat.scroll.layout" {
            guard layoutRecordsRemaining > 0 else { return }
            layoutRecordsRemaining -= 1
        }
        guard let scrollView else { return }
        var realized = 0
        var visible = 0
        var registered = 0
        var lastFrame = CGRect.zero
        var latestFrame: CGRect?
        for (id, marker) in rows {
            guard let view = marker.view else { continue }
            registered += 1
            guard view.isDescendant(of: scrollView) else { continue }
            let frame = view.convert(view.bounds, to: scrollView)
            guard frame.height > 0 else { continue }
            realized += 1
            if frame.intersects(scrollView.bounds) { visible += 1 }
            if frame.maxY > lastFrame.maxY { lastFrame = frame }
            if id == (targetID ?? latestID) { latestFrame = frame }
        }
        var values = geometry
        values["bottomY"] = Double(lastFrame.maxY - scrollView.contentOffset.y)
        values["lastRowHeight"] = Double(lastFrame.height)
        if let latestFrame {
            values["latestTopY"] = Double(latestFrame.minY - scrollView.contentOffset.y)
            values["latestBottomY"] = Double(latestFrame.maxY - scrollView.contentOffset.y)
            values["latestRowHeight"] = Double(latestFrame.height)
        }
        DSBotLog.record(
            event, historyId: diagnosticID,
            counts: [
                "messageCount": messageCount, "registeredCount": registered,
                "realizedCount": realized, "visibleCount": visible,
                "latestRealizedCount": latestFrame == nil ? 0 : 1, "followingCount": following ? 1 : 0,
                "scrollCommandCount": followingCommandCount
            ],
            geometry: values, state: state ?? (following ? "following" : "reading")
        )
    }

    private func trajectory() -> ConversationJumpProgress? {
        guard let scrollView else { return nil }
        let end = endOffset(in: scrollView)
        return ConversationJumpProgress(
            distance: end - scrollView.contentOffset.y,
            viewportHeight: scrollView.bounds.height
        )
    }

    func register(_ view: UIView, id: String) { rows[id] = WeakHistoryRow(view) }

    func remove(_ view: UIView, id: String) {
        if rows[id]?.view === view { rows[id] = nil }
    }

    func animateToLatest(
        itemIDs: [String], scroll: @escaping (AnyHashable, CGFloat) -> Void, completion: @escaping () -> Void
    ) -> Bool {
        cancelJump()
        guard let trajectory = trajectory() else { return false }
        jump = ConversationJump(
            trajectory: trajectory, geometry: { [weak self] in self?.geometry ?? [:] },
            frame: { [weak self] fraction in self?.advance(fraction: fraction, itemIDs: itemIDs, scroll: scroll) }
        ) { [weak self] in
            self?.jump = nil
            completion()
        }
        return true
    }

    func cancelJump() {
        jump?.cancel()
        jump = nil
    }

    private func advance(fraction: CGFloat, itemIDs: [String], scroll: (AnyHashable, CGFloat) -> Void) {
        guard fraction < 1 else {
            if let last = latestID ?? itemIDs.last {
                let target = followingTarget(latestID: last, firstID: itemIDs.first)
                scroll(target.readerID, target.anchor)
            }
            return
        }
        guard let scrollView else { return }
        let current = scrollView.contentOffset.y
        let viewport = scrollView.bounds.height
        let end = endOffset(in: scrollView)
        let desired = current + max(0, end - current) * fraction
        var best: (id: String, offset: CGFloat, anchor: CGFloat)?
        var realizedIDs = Set<String>()
        for (id, marker) in rows {
            guard let view = marker.view, view.isDescendant(of: scrollView) else { continue }
            let frame = view.convert(view.bounds, to: scrollView)
            guard frame.height > 0, abs(viewport - frame.height) > 0.5 else { continue }
            realizedIDs.insert(id)
            let first = frame.minY
            let last = frame.maxY - viewport
            // The same normalized anchor must describe a short row and a row several screens tall.
            // Restrict it to the row; out-of-range footer anchors can trap lazy layout in adjustment.
            let offset = min(max(desired, min(first, last)), max(first, last))
            guard offset > current + 0.5 else { continue }
            if best == nil || abs(offset - desired) < abs(best!.offset - desired) {
                best = (id, offset, min(1, max(0, (first - offset) / (viewport - frame.height))))
            }
        }
        if let best {
            scroll(AnyHashable(RealizedHistoryAnchor(id: best.id)), best.anchor)
        } else if let last = itemIDs.lastIndex(where: { realizedIDs.contains($0) }), last + 1 < itemIDs.count {
            // Materialize the next occurrence when the visible rows cannot carry us farther.
            scroll(itemIDs[last + 1], 0)
        }
    }

    private var scrollView: UIScrollView? {
        // The locator is inside the lazy stack. Its ancestor owns this history; a matching
        // rectangle elsewhere in the window may instead be the retained board or another page.
        var ancestor = locator?.superview
        while let view = ancestor {
            if let scroll = view as? UIScrollView { return scroll }
            ancestor = view.superview
        }
        return nil
    }
}

private final class WeakHistoryRow {
    weak var view: UIView?
    init(_ view: UIView) { self.view = view }
}

struct HistoryRowLocator: UIViewRepresentable {
    let id: String
    let metrics: ScrollMetrics

    func makeCoordinator() -> Coordinator { Coordinator(id: id, metrics: metrics) }

    func makeUIView(context: Context) -> UIView {
        #if DEBUG && targetEnvironment(simulator)
        let view = HistoryLayoutProbe()
        view.historyID = metrics.diagnosticID
        view.rowKind = id.hasPrefix("transcript:user:") ? "user" : "reply"
        #else
        let view = UIView()
        #endif
        view.isUserInteractionEnabled = false
        metrics.register(view, id: id)
        return view
    }

    func updateUIView(_ view: UIView, context: Context) { metrics.register(view, id: id) }

    static func dismantleUIView(_ view: UIView, coordinator: Coordinator) {
        coordinator.metrics?.remove(view, id: coordinator.id)
    }

    final class Coordinator {
        let id: String
        weak var metrics: ScrollMetrics?
        init(id: String, metrics: ScrollMetrics) {
            self.id = id
            self.metrics = metrics
        }
    }
}

#if DEBUG && targetEnvironment(simulator)
private final class HistoryLayoutProbe: UIView {
    var historyID = ""
    var rowKind = ""
    private var previousHeight: CGFloat?
    private var remaining = 6

    override func layoutSubviews() {
        super.layoutSubviews()
        guard ProcessInfo.processInfo.arguments.contains("-dsbot-review-row-layout") else { return }
        defer { previousHeight = bounds.height }
        guard let previousHeight, abs(previousHeight - bounds.height) > 0.5, remaining > 0 else { return }
        remaining -= 1
        DSBotLog.record(
            "chat.scroll.row_resize", historyId: historyID,
            geometry: ["lastRowHeight": Double(previousHeight), "latestRowHeight": Double(bounds.height)],
            state: rowKind
        )
    }
}
#endif

struct ScrollViewLocator: UIViewRepresentable {
    let metrics: ScrollMetrics

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        metrics.locator = view
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        metrics.locator = view
    }
}
