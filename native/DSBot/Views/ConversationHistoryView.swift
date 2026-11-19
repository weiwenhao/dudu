import SwiftUI

enum ConversationHistoryItem: Identifiable, Equatable {
    case transcript(TranscriptRow, Double?)
    case running(turnID: String, startedAt: Double?)
    case message(ChatMessage)
    case controls(isLoading: Bool, failure: String?)
    case approval(Approval, isResponding: Bool)
    case questions(ConversationQuestions)

    var id: String {
        switch self {
        case let .transcript(row, _): return "transcript:\(row.id)"
        case let .running(turnID, _): return "running:\(turnID)"
        case let .message(message): return "message:\(message.id)"
        case .controls: return "history.controls"
        case let .approval(approval, _): return "approval:\(approval.id)"
        case let .questions(questions): return "questions:\(questions.id)"
        }
    }

    var isControls: Bool {
        if case .controls = self { return true }
        return false
    }

    /// A card (the 待办 list) that ends the thread is shown from its top when it is taller than what can be seen: what the owner asked for starts with its title and its first rows, not its last.
    var isCard: Bool {
        if case let .transcript(row, _) = self, case let .command(command) = row { return command.card != nil }
        return false
    }

    static func transcriptItems(
        _ rows: [TranscriptRow], timeSeparators: [String: Double] = [:],
        trailing: [ConversationHistoryItem] = []
    ) -> [ConversationHistoryItem] {
        var items: [ConversationHistoryItem] = []
        var running: ConversationHistoryItem?
        for row in rows {
            if case let .status(startedAt) = row {
                running = .running(turnID: "status", startedAt: startedAt)
                continue
            }
            items.append(.transcript(row, timeSeparators[row.id]))
            if case let .turn(turn) = row, turn.outcome == .running {
                running = .running(turnID: turn.id, startedAt: turn.startedAt)
            }
        }
        items += trailing
        // DSH's ChatFlow puts its single running indicator after messages and pending input.
        if let running { items.append(running) }
        return items
    }
}

struct ConversationHistoryView<Content: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    let items: [ConversationHistoryItem]
    let target: DraftTarget?
    let topInset: CGFloat
    let bottomInset: CGFloat
    let canLoadAttachments: Bool
    let keyboardVisible: Bool
    let isCovered: Bool
    var isPreparingForPresentation = false
    @Binding var followsLatest: Bool
    /// Whether the reader is far enough above the end for the jump-to-latest button to show.
    @Binding var awayFromLatest: Bool
    /// Bumped by the jump-to-latest button and when a card the owner asked for is in the thread; each change traverses to the last occurrence.
    let jumpToken: Int
    /// Set when the owner asked for a card (the 待办 button): a card that ends the thread is then followed and jumped to by its top while it is taller than what can be seen. The owner's own drag
    /// puts it down (and the jump button, in the chat), after which the end of the thread is the end again.
    @Binding var cardFromTop: Bool
    let onReachedStart: () -> Void
    var onLatestVisibilityChange: (Bool) -> Void = { _ in }
    /// Told whether the history is being scrolled, and asked to keep the reader's row while a page of older history comes in (see `ScrollIdleGate`).
    var scrollGate: ScrollIdleGate?
    @ViewBuilder let content: (ConversationHistoryItem) -> Content

    @State private var phase = ScrollPhase.idle
    /// The top visible row, kept by SwiftUI's own `scrollPosition(id:)`: when older rows come in above it, the system keeps that row where it is. A reference, so that SwiftUI writing it as the reader
    /// scrolls never redraws this view.
    @State private var topRow = TopRowHolder()
    @State private var dragBeganFollowingWithKeyboard = false
    @State private var dragViewportWithoutKeyboard: CGFloat?
    @State private var metrics = ScrollMetrics()
    @State private var latestFrame = PagePresentationFrame()

    var body: some View {
        Group {
            if items.isEmpty {
                Color.clear
            } else {
                // Apply the initial anchor to real history, rather than an empty stack's footer.
                ScrollViewReader { proxy in
                    history(proxy)
                }
            }
        }
    }

    private func historyRow(_ item: ConversationHistoryItem) -> some View {
        ConversationHistoryRow(
            item: item, target: target, canLoadAttachments: canLoadAttachments,
            isCovered: isCovered, content: content
        )
        .equatable()
        // Materialize the message and its reserved space together when scrolling to the end.
        .padding(.top, item.id == items.first?.id ? topInset : 0)
        .padding(.bottom, item.id == items.last?.id ? bottomInset : 0)
        .background {
            HistoryRowLocator(id: item.id, metrics: metrics)
                .allowsHitTesting(false)
                .id(RealizedHistoryAnchor(id: item.id))
        }
        .id(item.id)
    }

    private func history(_ proxy: ScrollViewProxy) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                // The spinner row at the start stands outside the rows SwiftUI may keep in place: it goes when the page is in, and a reader waiting at the start was reading it (the phone's log).
                ForEach(items.prefix(while: \.isControls)) { item in historyRow(item) }
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(items.drop(while: \.isControls)) { item in historyRow(item) }
                }
                .scrollTargetLayout()
            }
            .background(ScrollViewLocator(metrics: metrics).allowsHitTesting(false))
        }
        .scrollPosition(id: Binding(get: { scrollGate?.keepsReader == true ? topRow.id : nil }, set: { topRow.id = $0 }), anchor: .top)
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.top, for: .alignment)
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("chat.history")
        .onScrollGeometryChange(for: Bool.self) { geometry in
            ChatScrollPosition.isAtEnd(
                contentHeight: geometry.contentSize.height, containerHeight: geometry.containerSize.height,
                contentOffset: geometry.contentOffset.y, topInset: geometry.contentInsets.top, tolerance: 1
            )
        } action: { _, atEnd in
            if !atEnd { onLatestVisibilityChange(false) }
            else { reportLatestVisibility() }
        }

        .onScrollGeometryChange(for: Bool.self) { geometry in
            isAtStart(geometry)
        } action: { _, atStart in
            if atStart, !isCovered, phase == .interacting || phase == .decelerating {
                onReachedStart()
            }
        }
        .onScrollGeometryChange(for: ViewportChange.self) { ViewportChange(geometry: $0) } action: { _, change in
            metrics.observeLayout()
            record("chat.scroll.viewport", geometry: change.geometry)
            positionHistory(proxy, reason: "viewport")
        }
        .onScrollGeometryChange(for: Bool.self) { geometry in
            ChatScrollPosition.isAwayFromEnd(
                contentHeight: geometry.contentSize.height, containerHeight: geometry.containerSize.height,
                contentOffset: geometry.contentOffset.y, topInset: geometry.contentInsets.top
            )
        } action: { _, away in
            if awayFromLatest != away { awayFromLatest = away }
        }
        .onScrollGeometryChange(for: ScrollLayout.self) { geometry in
            ScrollLayout(
                contentHeight: geometry.contentSize.height,
                viewportHeight: geometry.containerSize.height,
                contentInsets: geometry.contentInsets
            )
        } action: { _, _ in
            metrics.observeLayout()
            reportLatestVisibility()
            metrics.recordLayout(messageCount: items.count, following: followsLatest)
            positionHistory(proxy, reason: "layout")
        }
        .onChange(of: historyRows, initial: true) { _, rows in
            metrics.itemIDs = rows.ids
            metrics.latestID = rows.ids.last
            metrics.latestIsCard = rows.latestIsCard
            // Keep the after-layout callback on the same snapshot as its metadata.
            metrics.onLayout = {
                scrollGate?.keepsReader = false
                metrics.observeLayout()
                positionHistory(proxy, reason: "materialized")
                reportLatestVisibility()
            }
            metrics.requestLayout()
            reportLatestVisibility()
        }
        .onChange(of: cardFromTop, initial: true) { _, asked in
            metrics.showsCardFromTop = asked
            metrics.requestLayout()
        }
        .onChange(of: positioningAccess, initial: true) { _, access in
            if access == .suspended, !followsLatest { metrics.rememberReadingPosition() }
            metrics.pausePositioning()
            metrics.positioning.setAccess(access)
            metrics.requestLayout()
        }
        .onChange(of: jumpToken) { _, _ in jumpToLatest(proxy) }
        .onScrollPhaseChange { oldPhase, newPhase, context in
            phase = newPhase
            scrollGate?.set(scrolling: newPhase != .idle)
            if newPhase == .tracking, metrics.jumpStartedAt != nil || metrics.positioning.request != nil {
                metrics.pausePositioning()
                metrics.positioning.interrupt()
                followsLatest = false
                if cardFromTop { cardFromTop = false }
            }
            if newPhase == .interacting {
                // The owner takes the chat in hand: the end of the thread is the end again.
                if cardFromTop { cardFromTop = false }
                metrics.pausePositioning()
                metrics.positioning.interrupt()
                dragBeganFollowingWithKeyboard = followsLatest && keyboardVisible
                dragViewportWithoutKeyboard = keyboardVisible ? nil : context.geometry.containerSize.height
                followsLatest = false
                record("chat.scroll.begin", geometry: context.geometry)
            }
            if newPhase == .idle, metrics.jumpStartedAt == nil, oldPhase == .interacting || oldPhase == .decelerating {
                let dismissedKeyboard = dragBeganFollowingWithKeyboard && !keyboardVisible
                let openedKeyboard = dragViewportWithoutKeyboard != nil && keyboardVisible
                followsLatest = ChatScrollPosition.shouldFollowAfterDrag(
                    contentHeight: context.geometry.contentSize.height,
                    containerHeight: context.geometry.containerSize.height,
                    contentOffset: context.geometry.contentOffset.y,
                    topInset: context.geometry.contentInsets.top,
                    beganFollowingWithKeyboard: dragBeganFollowingWithKeyboard,
                    keyboardVisible: keyboardVisible,
                    viewportHeightBeforeKeyboard: dragViewportWithoutKeyboard
                )
                dragBeganFollowingWithKeyboard = false
                dragViewportWithoutKeyboard = nil
                // A normal drag has landed; a keyboard change may still need the end realigned.
                if !followsLatest { metrics.rememberReadingPosition() }
                if followsLatest, dismissedKeyboard || openedKeyboard, !isCovered {
                    positionHistory(proxy, reason: dismissedKeyboard ? "keyboard.dismiss" : "keyboard.show")
                }
                record("chat.scroll.end", geometry: context.geometry)
                if !isCovered, isAtStart(context.geometry) { onReachedStart() }
            }
        }
        .onChange(of: isCovered) { wasCovered, covered in
            reportLatestVisibility()
            if wasCovered && !covered {
                DSBotLog.record("chat.resume", counts: ["messageCount": items.count],
                                state: followsLatest ? "following" : "reading")
                metrics.recordLayout(event: "chat.resume.rows", messageCount: items.count, following: followsLatest)
                metrics.requestLayout()
            }
        }
        .onChange(of: scenePhase) { _, next in
            if next == .active, !isCovered {
                DSBotLog.record(
                    "chat.foreground", counts: ["messageCount": items.count],
                    geometry: metrics.geometry, state: followsLatest ? "following" : "reading"
                )
                metrics.recordLayout(event: "chat.foreground.rows", messageCount: items.count, following: followsLatest)
                metrics.requestLayout()
            }
        }
        .task {
            DSBotLog.record(
                "chat.startup", historyId: metrics.diagnosticID,
                counts: ["messageCount": items.count], state: "following"
            )
        }
        .onDisappear {
            latestFrame.cancel()
            scrollGate?.set(scrolling: false)
            onLatestVisibilityChange(false)
            metrics.pausePositioning()
            metrics.onLayout = nil
        }
        #if DEBUG && targetEnvironment(simulator)
        .task(id: items.isEmpty) { await reviewJumpCycle(proxy) }
        #endif
    }

    private func reportLatestVisibility() {
        latestFrame.afterLayout { onLatestVisibilityChange(metrics.isAtLatestContent) }
    }

    #if DEBUG && targetEnvironment(simulator)
    /// `-dsbot-review-jump-cycle`: scroll to the start, wait, then press the jump button's code path, a few
    /// times over, so a screen recording can show the animation and the button without touch scripting.
    private func reviewJumpCycle(_ proxy: ScrollViewProxy) async {
        let arguments = ProcessInfo.processInfo.arguments
        guard !items.isEmpty else { return }
        if arguments.contains("-dsbot-review-history-start") {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled else { return }
            metrics.isReviewPositioning = true
            followsLatest = false
            if let first = items.first { proxy.scrollTo(first.id, anchor: .top) }
            return
        }
        guard arguments.contains("-dsbot-review-jump-cycle") else { return }
        try? await Task.sleep(nanoseconds: 3_000_000_000)
        for round in 0..<4 {
            // Far (the first row) and near (a few rows from the end), alternately.
            let far = round.isMultiple(of: 2)
            let rows = items.filter { $0.id != "history.controls" }
            guard rows.count > 8 else { return }
            let target = far ? rows[0] : rows[rows.count - 6]
            followsLatest = false
            proxy.scrollTo(target.id, anchor: .top)
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            jumpToLatest(proxy)
            try? await Task.sleep(nanoseconds: 2_500_000_000)
        }
    }
    #endif

    /// Keep the in-flight jump in an unobserved reference: rebuilding the lazy stack on its first
    /// frame disrupts its estimates. Following resumes after the last message command lands.
    private func jumpToLatest(_ proxy: ScrollViewProxy) {
        guard metrics.positioning.access != .suspended, !metrics.itemIDs.isEmpty else { return }
        scrollGate?.keepsReader = false
        metrics.cancelJump()
        metrics.positioning.requestLatest()
        metrics.isReviewPositioning = false
        metrics.jumpStartedAt = ProcessInfo.processInfo.systemUptime
        DSBotLog.record(
            "chat.latest.jump", historyId: metrics.diagnosticID,
            counts: ["messageCount": items.count], geometry: metrics.geometry, state: "scroll"
        )
        let animated = !reduceMotion && metrics.animateToLatest { id, anchor in
            proxy.scrollTo(id, anchor: UnitPoint(x: 0.5, y: anchor))
        } completion: {
            finishJump(proxy)
        }
        if !animated { finishJump(proxy) }
    }

    private func finishJump(_ proxy: ScrollViewProxy) {
        guard let startedAt = metrics.jumpStartedAt else { return }
        metrics.jumpStartedAt = nil
        positionHistory(proxy, reason: "jump.complete")
        metrics.requestLayout()
        DSBotLog.record(
            metrics.positioning.request == nil ? "chat.latest.complete" : "chat.latest.unsettled",
            historyId: metrics.diagnosticID,
            elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000, geometry: metrics.geometry
        )
    }

    private func positionHistory(_ proxy: ScrollViewProxy, reason: String) {
        guard metrics.positioning.access != .suspended, phase == .idle,
              metrics.jumpStartedAt == nil, !metrics.isReviewPositioning else { return }
        // Geometry callbacks may see the next render before onChange has delivered its row identities.
        let rows = historyRows
        guard metrics.itemIDs == rows.ids, metrics.latestID == rows.ids.last,
              metrics.latestIsCard == rows.latestIsCard else { return }
        if let completed = metrics.completePositioningIfReached() {
            if completed == .latest { followsLatest = true }
            return
        }
        guard let target = metrics.positioningTarget(followsLatest: followsLatest) else { return }
        metrics.recordFollowing(
            reason: target.isRecovery ? "\(reason).recover" : reason,
            targetID: target.id, messageCount: metrics.itemIDs.count, following: followsLatest
        )
        // A built row's own background has a real rectangle; the lazy occurrence may still have an estimated one.
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            proxy.scrollTo(target.readerID, anchor: UnitPoint(x: 0.5, y: target.anchor))
        }
        metrics.requestLayout()
    }

    private var positioningAccess: HistoryPositioningAccess {
        .resolve(covered: isCovered, preparing: isPreparingForPresentation, active: scenePhase == .active)
    }

    /// Older history is asked for while the reader is still a screen and a half below the start, so that the page is in before the start is reached: a page that lands while the scroll view bounces off its
    /// start is overwritten by the bounce (the log of the owner's phone, 2026-11-16), one that lands in the middle of the history is kept in place by SwiftUI's own scroll-position tracking.
    private func isAtStart(_ geometry: ScrollGeometry) -> Bool {
        geometry.contentOffset.y + geometry.contentInsets.top <= geometry.containerSize.height * 1.5
    }

    private var historyRows: HistoryRows {
        HistoryRows(ids: items.map(\.id), latestIsCard: items.last?.isCard ?? false)
    }

    /// Synchronize the occurrence list and its latest-row kind together.
    private struct HistoryRows: Equatable {
        let ids: [String]
        let latestIsCard: Bool
    }

    private struct ViewportChange: Equatable {
        let geometry: ScrollGeometry

        static func == (left: Self, right: Self) -> Bool {
            left.geometry.containerSize == right.geometry.containerSize &&
                left.geometry.contentInsets == right.geometry.contentInsets
        }
    }

    private struct ScrollLayout: Equatable {
        let contentHeight: CGFloat
        let viewportHeight: CGFloat
        let contentInsets: EdgeInsets
    }

    private func record(_ event: String, geometry: ScrollGeometry) {
        metrics.recordLayout(event: event + ".rows", messageCount: items.count, following: followsLatest)
        DSBotLog.record(
            event, historyId: metrics.diagnosticID, counts: ["messageCount": items.count],
            geometry: [
                "contentHeight": Double(geometry.contentSize.height),
                "contentOffset": Double(geometry.contentOffset.y),
                "viewportHeight": Double(geometry.containerSize.height),
                "topInset": Double(geometry.contentInsets.top),
                "bottomInset": Double(geometry.contentInsets.bottom)
            ], state: followsLatest ? "following" : "reading"
        )
    }
}

private final class TopRowHolder { var id: String? }

/// Older history is put in above the reader only while the history is at rest, and SwiftUI's own scroll-position tracking keeps the row the reader is looking at in place across it. The store waits
/// here before it applies a page; `set(scrolling:)` is told by the history view, and nothing is polled. `keepsReader` is raised in the same turn as the page is applied and lowered by the next
/// layout: SwiftUI is handed the reader's row only then, because a row held all the time stops the jump to the latest message from landing.
@MainActor
final class ScrollIdleGate {
    var keepsReader = false
    private var scrolling = false
    private var waiters: [CheckedContinuation<Void, Never>] = []

    func set(scrolling next: Bool) {
        scrolling = next
        guard !next else { return }
        let ready = waiters
        waiters = []
        for waiter in ready { waiter.resume() }
    }

    func waitUntilIdle() async {
        guard scrolling else { return }
        await withCheckedContinuation { waiters.append($0) }
    }
}

private struct ConversationHistoryRow<Content: View>: View, Equatable {
    let item: ConversationHistoryItem
    let target: DraftTarget?
    let canLoadAttachments: Bool
    let isCovered: Bool
    @ViewBuilder let content: (ConversationHistoryItem) -> Content

    static func == (left: Self, right: Self) -> Bool {
        left.item == right.item && left.target == right.target &&
            left.canLoadAttachments == right.canLoadAttachments && left.isCovered == right.isCovered
    }

    var body: some View {
        content(item)
            .disclosureGroupStyle(ConversationHistoryDisclosureStyle())
            .frame(maxWidth: 728, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, sideMargin)
            .padding(.vertical, 7)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier(item.id)
    }

    private var sideMargin: CGFloat {
        switch item {
        case let .message(message) where message.role == "user":
            return DSBotLayout.userMessageSideMargin
        case .transcript(.user, _):
            return DSBotLayout.userMessageSideMargin
        default:
            return DSBotLayout.conversationSideMargin
        }
    }
}

private struct ConversationHistoryDisclosureStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) {
                    configuration.isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    configuration.label
                    Spacer(minLength: 0)
                    DSBotIcon(.down, size: 14, scalesStroke: true)
                        .rotationEffect(.degrees(configuration.isExpanded ? 180 : 0))
                }
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if configuration.isExpanded { configuration.content }
        }
    }
}
