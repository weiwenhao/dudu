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
    @ViewBuilder let content: (ConversationHistoryItem) -> Content

    @State private var phase = ScrollPhase.idle
    @State private var dragBeganFollowingWithKeyboard = false
    @State private var metrics = ScrollMetrics()

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

    private func history(_ proxy: ScrollViewProxy) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(items) { item in
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
            }
            .background(ScrollViewLocator(metrics: metrics).allowsHitTesting(false))
        }
        .defaultScrollAnchor(.bottom, for: .initialOffset)
        .defaultScrollAnchor(.top, for: .alignment)
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("chat.history")

        .onScrollGeometryChange(for: Bool.self) { geometry in
            isAtStart(geometry)
        } action: { _, atStart in
            if atStart, !isCovered, phase == .interacting || phase == .decelerating {
                onReachedStart()
            }
        }
        .onScrollGeometryChange(for: ViewportChange.self) { ViewportChange(geometry: $0) } action: { _, change in
            record("chat.scroll.viewport", geometry: change.geometry)
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
            metrics.recordLayout(messageCount: items.count, following: followsLatest)
            if followsLatest, canPositionHistory, phase == .idle,
               metrics.jumpStartedAt == nil, !metrics.isReviewPositioning {
                scrollToLatest(proxy, reason: "layout")
            }
        }
        .onChange(of: LatestRow(id: items.last?.id, isCard: items.last?.isCard ?? false), initial: true) { _, latest in
            metrics.latestID = latest.id
            metrics.latestIsCard = latest.isCard
        }
        .onChange(of: cardFromTop, initial: true) { _, asked in
            metrics.showsCardFromTop = asked
        }
        .onChange(of: isPreparingForPresentation, initial: true) { _, preparing in
            if preparing, followsLatest { scrollToLatest(proxy, reason: "prepare") }
        }
        .onChange(of: jumpToken) { _, _ in jumpToLatest(proxy) }
        .onScrollPhaseChange { oldPhase, newPhase, context in
            phase = newPhase
            if newPhase == .tracking, metrics.jumpStartedAt != nil {
                metrics.cancelJump()
                metrics.jumpStartedAt = nil
                followsLatest = false
                if cardFromTop { cardFromTop = false }
            }
            if newPhase == .interacting {
                // The owner takes the chat in hand: the end of the thread is the end again.
                if cardFromTop { cardFromTop = false }
                metrics.cancelJump()
                metrics.jumpStartedAt = nil
                dragBeganFollowingWithKeyboard = followsLatest && keyboardVisible
                followsLatest = false
                record("chat.scroll.begin", geometry: context.geometry)
            }
            if newPhase == .idle, metrics.jumpStartedAt == nil, oldPhase == .interacting || oldPhase == .decelerating {
                let dismissedKeyboard = dragBeganFollowingWithKeyboard && !keyboardVisible
                followsLatest = ChatScrollPosition.shouldFollowAfterDrag(
                    contentHeight: context.geometry.contentSize.height,
                    containerHeight: context.geometry.containerSize.height,
                    contentOffset: context.geometry.contentOffset.y,
                    topInset: context.geometry.contentInsets.top,
                    beganFollowingWithKeyboard: dragBeganFollowingWithKeyboard,
                    keyboardVisible: keyboardVisible
                )
                dragBeganFollowingWithKeyboard = false
                // A normal drag has already landed. Only keyboard dismissal needs realignment.
                if dismissedKeyboard, !isCovered { scrollToLatest(proxy, reason: "keyboard.dismiss") }
                record("chat.scroll.end", geometry: context.geometry)
                if !isCovered, isAtStart(context.geometry) { onReachedStart() }
            }
        }
        .onChange(of: isCovered) { wasCovered, covered in
            if covered {
                metrics.cancelJump()
                metrics.jumpStartedAt = nil
            }
            if wasCovered && !covered {
                DSBotLog.record("chat.resume", counts: ["messageCount": items.count],
                                state: followsLatest ? "following" : "reading")
                metrics.recordLayout(event: "chat.resume.rows", messageCount: items.count, following: followsLatest)
                if followsLatest { scrollToLatest(proxy, reason: "resume") }
            }
        }
        .onChange(of: scenePhase) { _, next in
            if next == .active, !isCovered {
                DSBotLog.record(
                    "chat.foreground", counts: ["messageCount": items.count],
                    geometry: metrics.geometry, state: followsLatest ? "following" : "reading"
                )
                metrics.recordLayout(event: "chat.foreground.rows", messageCount: items.count, following: followsLatest)
                if followsLatest, phase == .idle, metrics.jumpStartedAt == nil {
                    scrollToLatest(proxy, reason: "foreground")
                }
            }
        }
        .task {
            DSBotLog.record(
                "chat.startup", historyId: metrics.diagnosticID,
                counts: ["messageCount": items.count], state: "following"
            )
        }
        .onDisappear {
            metrics.cancelJump()
            metrics.jumpStartedAt = nil
        }
        #if DEBUG && targetEnvironment(simulator)
        .task(id: items.isEmpty) { await reviewJumpCycle(proxy) }
        #endif
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
        guard !isCovered, !items.isEmpty else { return }
        metrics.cancelJump()
        metrics.isReviewPositioning = false
        metrics.jumpStartedAt = ProcessInfo.processInfo.systemUptime
        DSBotLog.record(
            "chat.latest.jump", historyId: metrics.diagnosticID,
            counts: ["messageCount": items.count], geometry: metrics.geometry, state: "scroll"
        )
        let animated = !reduceMotion && metrics.animateToLatest(itemIDs: items.map(\.id)) { id, anchor in
            proxy.scrollTo(id, anchor: UnitPoint(x: 0.5, y: anchor))
        } completion: {
            finishJump(proxy)
        }
        if !animated { finishJump(proxy) }
    }

    private func finishJump(_ proxy: ScrollViewProxy) {
        guard let startedAt = metrics.jumpStartedAt else { return }
        metrics.jumpStartedAt = nil
        scrollToLatest(proxy, reason: "jump.complete")
        followsLatest = true
        DSBotLog.record(
            metrics.latestIsVisible ? "chat.latest.complete" : "chat.latest.unsettled",
            historyId: metrics.diagnosticID,
            elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000, geometry: metrics.geometry
        )
    }

    private func scrollToLatest(_ proxy: ScrollViewProxy, reason: String) {
        guard canPositionHistory else { return }
        // An animation can outlive the snapshot that started it.
        guard let id = metrics.latestID ?? items.last?.id else { return }
        let target = metrics.followingTarget(latestID: id, firstID: items.first?.id)
        metrics.recordFollowing(
            reason: target.isRecovery ? "\(reason).recover" : reason, targetID: target.id, messageCount: items.count
        )
        // A built row's own background has a real rectangle; the lazy occurrence may still have an estimated one.
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            proxy.scrollTo(target.readerID, anchor: UnitPoint(x: 0.5, y: target.anchor))
        }
    }

    private var canPositionHistory: Bool { !isCovered || isPreparingForPresentation }

    private func isAtStart(_ geometry: ScrollGeometry) -> Bool {
        geometry.contentOffset.y + geometry.contentInsets.top <= 24
    }

    /// The last row of the thread and whether it is a card: what following and the jump to the latest aim at.
    private struct LatestRow: Equatable {
        let id: String?
        let isCard: Bool
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
