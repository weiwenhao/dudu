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
        // End the motion after its last command lays out; the positioning goal is checked separately.
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
    var itemIDs: [String] = []
    var positioning = HistoryPositioning()
    var onLayout: (() -> Void)?
    private var layoutRecordsRemaining = 12
    private var commandRecordsRemaining = 32
    private var followingCommandCount = 0
    private var rows: [String: WeakHistoryRow] = [:]
    private var jump: ConversationJump?
    private let layoutFrame = PagePresentationFrame()

    func positioningTarget(followsLatest: Bool) -> HistoryScrollTarget? {
        guard let scrollView else { return nil }
        let frames = rowFrames(in: scrollView)
        return positioning.nextTarget(
            itemIDs: itemIDs, rows: frames, viewport: viewport(in: scrollView),
            followsLatest: followsLatest, latestFromTop: cardIsShownFromTop(frames: frames, in: scrollView)
        )
    }

    func completePositioningIfReached() -> HistoryPositioning.Request? {
        guard let scrollView else { return nil }
        let frames = rowFrames(in: scrollView)
        return positioning.completeIfReached(
            itemIDs: itemIDs, rows: frames, viewport: viewport(in: scrollView),
            latestFromTop: cardIsShownFromTop(frames: frames, in: scrollView)
        )
    }

    func observeLayout() {
        guard let scrollView else { return }
        positioning.observe(rows: rowFrames(in: scrollView))
    }

    func rememberReadingPosition() {
        guard let scrollView else { return }
        positioning.rememberReading(rows: rowFrames(in: scrollView), viewport: viewport(in: scrollView))
    }

    func requestLayout() {
        guard positioning.access != .suspended, onLayout != nil else { return }
        layoutFrame.afterLayout { [weak self] in self?.onLayout?() }
    }

    func pausePositioning() {
        cancelJump()
        layoutFrame.cancel()
    }

    private func viewport(in scrollView: UIScrollView) -> HistoryViewport {
        HistoryViewport(
            offset: scrollView.contentOffset.y, height: scrollView.bounds.height,
            contentHeight: scrollView.contentSize.height,
            topInset: scrollView.adjustedContentInset.top, bottomInset: scrollView.adjustedContentInset.bottom
        )
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

    var isAtLatestContent: Bool {
        guard let scrollView, latestIsVisible else { return false }
        return ChatScrollPosition.isAtEnd(
            contentHeight: scrollView.contentSize.height, containerHeight: scrollView.bounds.height,
            contentOffset: scrollView.contentOffset.y, topInset: scrollView.adjustedContentInset.top, tolerance: 1
        )
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

    func recordFollowing(reason: String, targetID: String, messageCount: Int, following: Bool = true) {
        followingCommandCount += 1
        guard commandRecordsRemaining > 0 else { return }
        commandRecordsRemaining -= 1
        recordLayout(
            event: "chat.scroll.command", messageCount: messageCount, following: following,
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

    func register(_ view: UIView, id: String) {
        guard rows[id]?.view !== view else { return }
        rows[id] = WeakHistoryRow(view)
        requestLayout()
    }

    func remove(_ view: UIView, id: String) {
        if rows[id]?.view === view {
            rows[id] = nil
            requestLayout()
        }
    }

    func animateToLatest(
        scroll: @escaping (AnyHashable, CGFloat) -> Void, completion: @escaping () -> Void
    ) -> Bool {
        guard positioning.access == .visible, let trajectory = trajectory() else { return false }
        jump = ConversationJump(
            trajectory: trajectory, geometry: { [weak self] in self?.geometry ?? [:] },
            frame: { [weak self] fraction in self?.advance(fraction: fraction, scroll: scroll) }
        ) { [weak self] in
            self?.jump = nil
            completion()
        }
        return true
    }

    func cancelJump() {
        jump?.cancel()
        jump = nil
        jumpStartedAt = nil
    }

    private func advance(fraction: CGFloat, scroll: (AnyHashable, CGFloat) -> Void) {
        guard positioning.access == .visible else { return }
        guard fraction < 1 else {
            if let target = positioningTarget(followsLatest: true) {
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
