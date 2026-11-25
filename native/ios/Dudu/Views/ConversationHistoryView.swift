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
        trailing: [ConversationHistoryItem] = [], showsRunning: Bool = true
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
        // DSH's ChatFlow puts its single running indicator after messages and pending input. A turn open only for background work has none (`SessionSummary.backgroundOnly`).
        if showsRunning, let running { items.append(running) }
        return items
    }

    static func messageHistoryItems(
        messages: [ChatMessage], transcriptRows: [TranscriptRow],
        questions: [ConversationQuestions], showsRunning: Bool = true
    ) -> [ConversationHistoryItem] {
        messages.map(ConversationHistoryItem.message) + transcriptItems(
            transcriptRows, trailing: questions.map(ConversationHistoryItem.questions), showsRunning: showsRunning
        )
    }
}

/// The conversation's history: a `List` whose scroll position is kept by OpenClaw's reading position (`Views/OpenClaw/`), as OpenClaw's iPhone app does (owner, 2026-11-24:
/// 「能直接复用 openclaw 的代码，你就直接复用，别自己写」). A `LazyVStack` only guessed the height of the rows it had not built, so the end of a long conversation with pictures was a guess:
/// the jump to the latest stopped short and the list jumped while it was read (2026-11-23). In a `List` the rows size themselves, and `ChatReadingPosition` writes the offset in the
/// layout pass that changed the content: following pins the end, reading keeps the row at the top where it was, an older page keeps the rows on screen still.
/// What is Dudu's here: the rows, the jump button's rule (`ChatScrollPosition.isAwayFromEnd`), the end of a drag (`ChatScrollPosition.shouldFollowAfterDrag`: a drag that ends 43 pt above the
/// end stays reading), the 待办 card shown from its top, and the diagnostics.
struct ConversationHistoryView<Content: View>: View {
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
    /// Bumped by the jump-to-latest button, after a send and when a card the owner asked for is in the thread.
    let jumpToken: Int
    /// Set when the owner asked for a card (the 待办 button): a card that ends the thread is then held by its top. The owner's own drag puts it down (and the jump button, in the chat), after
    /// which the end of the thread is the end again.
    @Binding var cardFromTop: Bool
    let onReachedStart: () -> Void
    var onLatestVisibilityChange: (Bool) -> Void = { _ in }
    /// Hands the reading position to the chat, which tells it just before a page of older history is put in (`olderPageWillPrepend`).
    var scrollGate: ScrollIdleGate?
    @ViewBuilder let content: (ConversationHistoryItem) -> Content

    @State private var scroll = ChatScrollFollowState()
    @State private var olderHistory = ChatOlderHistoryReader()
    @State private var lastGeometry = HistoryGeometryRecord()
    @State private var dragBeganFollowingWithKeyboard = false
    @State private var dragViewportWithoutKeyboard: CGFloat?

    var body: some View {
        Group {
            if items.isEmpty {
                Color.clear
            } else {
                history
            }
        }
    }

    private func historyRow(_ item: ConversationHistoryItem) -> some View {
        ConversationHistoryRow(
            item: item, target: target, canLoadAttachments: canLoadAttachments,
            isCovered: isCovered, content: content
        )
        .equatable()
        .padding(.top, item.id == items.first?.id ? topInset : 0)
        .padding(.bottom, item.id == items.last?.id ? bottomInset : 0)
        // In a List a button with the automatic style takes the whole row; in the ScrollView the rows came from it was borderless.
        .buttonStyle(.borderless)
        .background {
            // The spinner row of older history never holds the position (OpenClaw's boundary row is unkeyed too).
            if !item.isControls {
                ChatReadingRowMarker(key: .cell(item.id), owner: scroll.readingPosition)
            }
        }
        .chatBehaviorProbe(.row(item.id))
    }

    private var history: some View {
        List {
            // OpenClaw `ChatView.messageListScrollContent` (iOS): the List's own look is taken off all its rows at once. Written on each row, inside the probe's
            // conditional wrapper, they did not reach the List: the rows got List's white background, separators and insets.
            ForEach(items) { item in historyRow(item) }
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.defaultMinListRowHeight, 0)
        .environment(\.openClawReadingPosition, scroll.readingPosition)
        .chatOlderHistoryTrigger(olderHistory, canLoad: { !isCovered }, scroll: scroll, load: onReachedStart)
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("chat.history")
        // OpenClaw `ChatView.handleTranscriptDistanceChange`.
        .onScrollGeometryChange(for: CGFloat.self) { geometry in
            geometry.contentSize.height - geometry.visibleRect.maxY
        } action: { _, distanceFromBottom in
            let isAtLiveEdge = distanceFromBottom <= 48
            guard scroll.isAtLiveEdge != isAtLiveEdge else { return }
            scroll.isAtLiveEdge = isAtLiveEdge
            scroll.hasNewerContentBelow = !isAtLiveEdge
        }
        .onScrollGeometryChange(for: Bool.self) { geometry in
            ChatScrollPosition.isAwayFromEnd(
                contentHeight: geometry.contentSize.height, containerHeight: geometry.containerSize.height,
                contentOffset: geometry.contentOffset.y, topInset: geometry.contentInsets.top
            )
        } action: { _, away in
            if awayFromLatest != away { awayFromLatest = away }
        }
        // Every change of the geometry, the first one of a conversation that opens at its end included: a `Bool` of its own is told only when it flips, and a history that
        // opens and stays at its end would never say so (the read receipt waits for it).
        .onScrollGeometryChange(for: HistoryGeometry.self) { HistoryGeometry($0) } action: { _, geometry in
            lastGeometry.value = geometry
            let atEnd = geometry.isAtEnd
            if lastGeometry.reportedAtEnd != atEnd {
                lastGeometry.reportedAtEnd = atEnd
                onLatestVisibilityChange(atEnd)
            }
        }
        .onScrollPhaseChange { _, phase, context in
            handleScrollPhase(phase, geometry: context.geometry)
        }
        .chatBehaviorProbeScroll()
        .onChange(of: jumpToken) { _, _ in jumpToLatest() }
        // OpenClaw `ChatView`: keyboard avoidance moves only the safe area; the reading position measures after it.
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { _ in
            scroll.isKeyboardTransitioning = true
            scroll.readingPosition.keyboardFrameChanged()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardDidChangeFrameNotification)) { _ in
            scroll.isKeyboardTransitioning = false
            scroll.readingPosition.keyboardFrameChanged()
        }
        .onAppear { scrollGate?.readingPosition = scroll.readingPosition }
        .onChange(of: scenePhase) { _, next in
            if next == .active, !isCovered { record("chat.foreground") }
        }
        .task { record("chat.startup") }
        .onDisappear {
            lastGeometry.reportedAtEnd = nil
            onLatestVisibilityChange(false)
        }
    }

    /// OpenClaw `ChatView.handleTranscriptScrollPhase` (iOS), with Dudu's rule for where a drag lands.
    private func handleScrollPhase(_ phase: ScrollPhase, geometry: ScrollGeometry) {
        if phase == .interacting {
            // The owner takes the chat in hand: the end of the thread is the end again.
            if cardFromTop { cardFromTop = false }
            dragBeganFollowingWithKeyboard = followsLatest && keyboardVisible
            dragViewportWithoutKeyboard = keyboardVisible ? nil : geometry.containerSize.height
            record("chat.scroll.begin")
        }
        if chatReaderScrollReleasesFollow(phase, keyboardTransition: scroll.isKeyboardTransitioning) {
            scroll.isUserScrolling = true
            scroll.followTarget = nil
            if followsLatest { followsLatest = false }
        } else if phase == .idle, scroll.isUserScrolling {
            scroll.isUserScrolling = false
            let follows = ChatScrollPosition.shouldFollowAfterDrag(
                contentHeight: geometry.contentSize.height, containerHeight: geometry.containerSize.height,
                contentOffset: geometry.contentOffset.y, topInset: geometry.contentInsets.top,
                beganFollowingWithKeyboard: dragBeganFollowingWithKeyboard, keyboardVisible: keyboardVisible,
                viewportHeightBeforeKeyboard: dragViewportWithoutKeyboard
            )
            dragBeganFollowingWithKeyboard = false
            dragViewportWithoutKeyboard = nil
            if follows {
                scroll.followTarget = .latest
                scroll.hasNewerContentBelow = false
                followsLatest = true
            } else {
                scroll.hasNewerContentBelow = true
                scroll.readingPosition.readerSettled()
            }
            record("chat.scroll.end")
        }
    }

    /// OpenClaw's jump (`ChatView.jumpToLatestButton`): one unanimated write to the end, after which following pins the end on every layout until the rows below have sized
    /// themselves. A card the owner asked for that ends the thread is held by its top instead, once the jump has brought its row in.
    private func jumpToLatest() {
        scroll.hasNewerContentBelow = false
        scroll.isUserScrolling = false
        if cardFromTop, let card = items.last, card.isCard {
            scroll.followTarget = .latest
            scroll.readingPosition.jumpToLatest()
            scroll.followTarget = .rowTop(card.id)
        } else {
            scroll.followTarget = .latest
            scroll.readingPosition.jumpToLatest()
        }
        if !followsLatest { followsLatest = true }
        record("chat.latest.jump")
    }

    private func record(_ event: String) {
        DuduLog.record(
            event, counts: ["messageCount": items.count], geometry: lastGeometry.value?.fields,
            state: followsLatest ? "following" : "reading"
        )
    }
}

/// The last scroll geometry, for the diagnostics. A reference, so that keeping it never redraws the history.
private final class HistoryGeometryRecord {
    var value: HistoryGeometry?
    /// What the chat was last told about the end being in view.
    var reportedAtEnd: Bool?
}

private struct HistoryGeometry: Equatable {
    let contentHeight: CGFloat
    let contentOffset: CGFloat
    let viewportHeight: CGFloat
    let topInset: CGFloat
    let bottomInset: CGFloat

    init(_ geometry: ScrollGeometry) {
        contentHeight = geometry.contentSize.height
        contentOffset = geometry.contentOffset.y
        viewportHeight = geometry.containerSize.height
        topInset = geometry.contentInsets.top
        bottomInset = geometry.contentInsets.bottom
    }

    /// The end of the history is in view (Dudu's rule for the read receipt: within 1 pt).
    var isAtEnd: Bool {
        ChatScrollPosition.isAtEnd(
            contentHeight: contentHeight, containerHeight: viewportHeight, contentOffset: contentOffset, topInset: topInset, tolerance: 1
        )
    }

    var fields: [String: Double] {
        [
            "contentHeight": Double(contentHeight), "contentOffset": Double(contentOffset),
            "viewportHeight": Double(viewportHeight), "topInset": Double(topInset), "bottomInset": Double(bottomInset)
        ]
    }
}

/// Hands the history's reading position to the chat, which calls `olderPageWillPrepend` synchronously just before it puts a page of older history in (OpenClaw
/// `ChatOlderHistoryReader.load` hands the same call to its view model): the rows on screen then stay still, also while the reader's fling goes on.
@MainActor
final class ScrollIdleGate {
    weak var readingPosition: ChatReadingPosition?

    func olderPageWillPrepend() {
        readingPosition?.olderPageWillPrepend()
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
            return DuduLayout.userMessageSideMargin
        case .transcript(.user, _):
            return DuduLayout.userMessageSideMargin
        default:
            return DuduLayout.conversationSideMargin
        }
    }
}

private struct ConversationHistoryDisclosureStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        ConversationHistoryDisclosure(configuration: configuration)
    }
}

/// The toggle is OpenClaw's (`ChatInlineDisclosure`): the state changes inside the animation, so the List row resizes with it and the rows below slide, and the reading position holds the
/// tapped header still (`disclosureWillToggle` / `disclosureDidSettle`). The look is Dudu's.
private struct ConversationHistoryDisclosure: View {
    @Environment(\.openClawReadingPosition) private var readingPosition
    let configuration: DisclosureGroupStyleConfiguration

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                let readingPosition = self.readingPosition
                readingPosition?.disclosureWillToggle()
                ChatScrollSignpost.disclosureToggle(.easeOut(duration: 0.18)) {
                    configuration.isExpanded.toggle()
                } completion: {
                    readingPosition?.disclosureDidSettle()
                }
            } label: {
                HStack(spacing: 8) {
                    configuration.label
                    Spacer(minLength: 0)
                    DuduIcon(.down, size: 14, scalesStroke: true)
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
