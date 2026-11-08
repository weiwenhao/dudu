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
    var jumpStartedAt: TimeInterval?
    var isReviewPositioning = false
    private var layoutRecordsRemaining = 12
    private var commandRecordsRemaining = 32
    private var rows: [String: WeakHistoryRow] = [:]
    private var jump: ConversationJump?
    /// The estimated height at which the viewport was found with no built row in it (`BlankViewportRecovery`).
    private var heldEstimate: CGFloat?

    /// The built row to follow instead of the latest, or nil to follow the latest as usual: the lazy stack's estimate can be higher than its rows reach, and the
    /// end of such an estimate is white (`BlankViewportRecovery`).
    func recoveryTarget(latestID: String) -> String? {
        guard let scrollView else { return nil }
        var frames: [HistoryRowFrame] = []
        for (id, marker) in rows {
            guard let view = marker.view, view.window === scrollView.window else { continue }
            let frame = view.convert(view.bounds, to: scrollView)
            guard frame.height > 0 else { continue }
            frames.append(HistoryRowFrame(id: id, minY: frame.minY, maxY: frame.maxY))
        }
        let answer = BlankViewportRecovery.target(
            latestID: latestID, rows: frames, contentOffset: scrollView.contentOffset.y, viewportHeight: scrollView.bounds.height,
            contentHeight: scrollView.contentSize.height, heldEstimate: heldEstimate
        )
        heldEstimate = answer.held
        return answer.target
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
            guard view.window === scrollView.window else { continue }
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
                "latestRealizedCount": latestFrame == nil ? 0 : 1, "followingCount": following ? 1 : 0
            ],
            geometry: values, state: state ?? (following ? "following" : "reading")
        )
    }

    private func trajectory() -> ConversationJumpProgress? {
        guard let scrollView else { return nil }
        let end = max(
            -scrollView.adjustedContentInset.top,
            scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom
        )
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
        itemIDs: [String], scroll: @escaping (String, CGFloat) -> Void, completion: @escaping () -> Void
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

    private func advance(fraction: CGFloat, itemIDs: [String], scroll: (String, CGFloat) -> Void) {
        guard fraction < 1 else {
            if let last = latestID ?? itemIDs.last { scroll(last, 1) }
            return
        }
        guard let scrollView else { return }
        let current = scrollView.contentOffset.y
        let viewport = scrollView.bounds.height
        let end = max(-scrollView.adjustedContentInset.top,
                      scrollView.contentSize.height - viewport + scrollView.adjustedContentInset.bottom)
        let desired = current + max(0, end - current) * fraction
        var best: (id: String, offset: CGFloat, anchor: CGFloat)?
        var realizedIDs = Set<String>()
        for (id, marker) in rows {
            guard let view = marker.view, view.window === scrollView.window else { continue }
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
            scroll(best.id, best.anchor)
        } else if let last = itemIDs.lastIndex(where: { realizedIDs.contains($0) }), last + 1 < itemIDs.count {
            // Materialize the next occurrence when the visible rows cannot carry us farther.
            scroll(itemIDs[last + 1], 0)
        }
    }

    private var scrollView: UIScrollView? {
        guard let locator, let window = locator.window else { return nil }
        let target = locator.convert(locator.bounds, to: window)
        guard target.width > 0, target.height > 0 else { return nil }
        var best: (view: UIScrollView, overlap: CGFloat)?
        func scan(_ view: UIView) {
            for child in view.subviews {
                if let scroll = child as? UIScrollView, !(scroll is UITextView), scroll.bounds.height > 200 {
                    let frame = scroll.convert(scroll.bounds, to: window)
                    let shared = frame.intersection(target)
                    let overlap = shared.isNull ? 0 : shared.width * shared.height / (target.width * target.height)
                    if abs(frame.width - target.width) < 1, overlap > 0.9, overlap > (best?.overlap ?? 0) {
                        best = (scroll, overlap)
                    }
                }
                scan(child)
            }
        }
        scan(window)
        return best?.view
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
        let view = UIView()
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
