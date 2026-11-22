import SwiftUI

/// Connection feedback stays on Home; cached conversations remain readable without a notice.
struct BoardConnectionNotice: View {
    static let height: CGFloat = 40
    static let toolbarSpacing: CGFloat = 16

    var body: some View {
        HStack(spacing: 12) {
            DuduIcon(.stateFailed, size: 18, strokeWidth: 1.8)
                .foregroundStyle(DuduStyle.chatError)
                .accessibilityHidden(true)
            Text(L10n.text("电脑未连接"))
                .font(.system(size: 15))
                .foregroundStyle(DuduStyle.ink)
            Spacer(minLength: 12)
            DuduLoadingRing(size: 14)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 16)
        .frame(height: Self.height)
        .background(DuduStyle.connectionNotice)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("board.connection.pending")
        .allowsHitTesting(false)
    }
}

/// The approved chat homepage. Other pages and the todo sheet keep their existing rows.
struct BoardView: View {
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DuduStore
    let topInset: CGFloat
    var isActive = true
    let onOpen: (BoardIssue, BoardOpenTrace) async -> Void
    let onOpenAssistant: (BoardOpenTrace) async -> Void
    let onDetail: (BoardIssue) -> Void
    @State private var removing: BoardIssue?
    @State private var revealed: String?
    @State private var swiping: String?
    @State private var editing: IssueActionRequest?
    @State private var renaming: BoardIssue?
    @State private var renameTitle = ""
    @State private var pinsExpanded = false
    @State private var showingFilters = false
    @State private var opening: String?
    @State private var subIssues: BoardIssue?
    @State private var subIssueSelection: SubIssueSelection?
    @State private var rest = BoardScrollRest()

    /// How far the list stands from its top edge (negative: pulled down), kept for the diagnostics only: read when the list comes to rest, so it is not state that redraws the page.
    private final class BoardScrollRest { var overscroll: CGFloat = 0 }

    private struct SubIssueSelection {
        let issue: BoardIssue
        let computer: String?
        let connection: Int
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) { content }
                .padding(.top, topInset + 8)
                .padding(.bottom, 40)
        }
        .refreshable {
            // A pull that was left on the screen is what the owner's screenshot of 2026-11-21 may show (three grey spokes above the pinned row, "stuck loading", nothing tapped):
            // these lines say whether a pull began, whether it ended and how long it took.
            let began = ProcessInfo.processInfo.systemUptime
            DuduLog.record("board.pull.begin")
            await board.refresh(using: store)
            DuduLog.record("board.pull.end", elapsedMs: (ProcessInfo.processInfo.systemUptime - began) * 1_000, state: Task.isCancelled ? "cancelled" : "done")
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y } action: { previous, next in
            // Simultaneous horizontal recognition must not close its own newly revealed actions.
            if previous != next, swiping == nil, revealed != nil { revealed = nil }
        }
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, next in rest.overscroll = next }
        .onScrollPhaseChange { _, phase in
            // A list that stops while it is still pulled down is what a pull stuck on the screen looks like.
            if phase == .idle, rest.overscroll < -0.5 {
                DuduLog.record("board.scroll.rest.pulled", geometry: ["contentOffset": Double(rest.overscroll)])
            }
        }
        .background(.white)
        .accessibilityIdentifier("board.page")
        .sheet(isPresented: $showingFilters) { BoardFilterSheet(board: board) }
        .sheet(item: $editing) { request in
            if request.action == .subIssue {
                NewIssueSheet(board: board, store: store, parent: request.issue)
            } else {
                IssueActionsSheet(board: board, store: store, issue: request.issue, action: request.action)
            }
        }
        .sheet(item: $subIssues, onDismiss: openSelectedSubIssue) { issue in
            BoardSubIssuesSheet(issue: issue, board: board, store: store) { child in
                subIssueSelection = SubIssueSelection(issue: child, computer: store.activeComputer?.id, connection: store.connectionRevision)
                subIssues = nil
            }
        }
        .alert(
            removing.map { L10n.text("删除“{0} {1}”？", $0.reference, $0.title) } ?? L10n.text("删除"),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
        ) {
            Button(L10n.text("取消"), role: .cancel) { removing = nil }
            Button(L10n.text("删除"), role: .destructive) {
                guard let issue = removing else { return }
                removing = nil
                Task { await board.delete(issue, using: store) }
            }
        } message: {
            Text(L10n.text("将删除这条事项、活动和本地关联。来源消息和会话历史会保留。"))
        }
        .alert(L10n.text("重命名"), isPresented: Binding(
            get: { renaming != nil }, set: { if !$0 { renaming = nil } }
        )) {
            TextField("", text: $renameTitle)
            Button(L10n.text("取消"), role: .cancel) { renaming = nil }
            Button(L10n.text("保存")) { rename() }
                .disabled(renameTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || renameTitle.count > 300)
        }
        .onChange(of: store.activeComputer?.id) { _, _ in clearActions(); pinsExpanded = false }
        .onChange(of: board.tab) { _, _ in revealed = nil }
        .onChange(of: isActive) { _, active in if !active { clearActions() } }
    }

    @ViewBuilder private var content: some View {
        let pins = board.pinnedConversations
        if !pins.isEmpty {
            BoardPinnedShelf(entries: pins, expanded: $pinsExpanded) { entry in
                pinnedCell(entry)
            }
        }
        BoardScopeBar(selection: board.tab, hasFilters: !board.filters.isEmpty, onSelect: board.select) {
            revealed = nil
            showingFilters = true
        }
        switch board.state {
        case .loading:
            ProgressView().controlSize(.regular).tint(DuduStyle.muted)
                .frame(maxWidth: .infinity).padding(.top, 80).accessibilityIdentifier("board.loading")
        case .failed:
            VStack(spacing: 14) {
                Text(L10n.text("事项没能加载")).font(.system(size: 15)).foregroundStyle(DuduStyle.muted)
                Button { Task { await board.refresh(using: store) } } label: {
                    Text(L10n.text("重试"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DuduStyle.ink)
                        .padding(.horizontal, 20)
                        .frame(height: 44)
                        .contentShape(Capsule())
                }
                .buttonStyle(DuduGlassCapsuleButtonStyle())
                .accessibilityIdentifier("board.retry")
            }
            .frame(maxWidth: .infinity).padding(.top, 80)
        case .loaded:
            let computer = store.activeComputer?.id
            let rows = board.conversations
            if board.tab == .unread, rows.isEmpty {
                Text(L10n.text("没有找到事项"))
                    .font(.system(size: 15))
                    .foregroundStyle(DuduStyle.chatSecondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity, minHeight: 72)
                    .padding(.horizontal, BoardHomeLayout.horizontalInset)
            }
            ForEach(rows) { entry in
                BoardConversationSwipeRow(
                    entry: entry, enabled: isActive && available(entry),
                    isRevealed: revealed == entry.id, onReveal: { open in
                        if open { revealed = entry.id } else if revealed == entry.id { revealed = nil }
                    }, onSwipe: { active in
                        if active { swiping = entry.id } else if swiping == entry.id { swiping = nil }
                    }, onComplete: {
                        guard computer == store.activeComputer?.id else { return }
                        await complete(entry)
                    },
                    onRead: { Task { await board.toggleUnread(entry, using: store) } },
                    onPin: { Task { await board.setPinned(entry, using: store) } }
                ) {
                    BoardConversationRow(entry: entry, busy: busy(entry), onSubIssues: { issue in
                        revealed = nil
                        subIssues = issue
                    }) { open(entry, trace: $0) }
                        .disabled(busy(entry))
                        .contextMenu { menu(for: entry) } preview: { SidebarSessionCard(title: title(entry)) }
                }
            }
        }
    }

    private func title(_ entry: BoardConversation) -> String { entry.isAssistant ? L10n.text("嘟嘟") : entry.title }
    private func busy(_ entry: BoardConversation) -> Bool {
        opening == entry.id || board.changing.contains(entry.id) || entry.issue.map { board.deleting.contains($0.id) } == true
    }
    private func available(_ entry: BoardConversation) -> Bool { store.status == .connected && !busy(entry) }

    private func pinnedCell(_ entry: BoardConversation) -> some View {
        Button {
            let trace = BoardOpenTrace()
            trace.record("action", state: "pinned")
            open(entry, trace: trace)
        } label: {
            VStack(spacing: 8) {
                BoardConversationAvatar(entry: entry, size: 40)
                    .overlay {
                        if busy(entry) {
                            ProgressView().controlSize(.small).tint(DuduStyle.muted)
                                .frame(width: 40, height: 40)
                                .background(.white.opacity(0.9), in: RoundedRectangle(
                                    cornerRadius: entry.isAssistant ? 20 : 10, style: .circular
                                ))
                        }
                    }
                Text(title(entry)).font(.system(size: 11.5)).foregroundStyle(DuduStyle.muted)
                    .lineLimit(1).frame(width: 54)
            }
            .frame(width: 54, height: BoardHomeLayout.pinnedRowHeight, alignment: .top).contentShape(Rectangle())
        }
        .buttonStyle(.plain).disabled(busy(entry))
        .contextMenu { menu(for: entry) } preview: { SidebarSessionCard(title: title(entry)) }
    }

    @ViewBuilder private func menu(for entry: BoardConversation) -> some View {
        Button { revealed = nil; Task { await board.setPinned(entry, using: store) } } label: {
            DuduLabel(entry.pinned ? L10n.text("取消置顶") : L10n.text("置顶"), icon: entry.pinActionGlyph)
        }.disabled(!available(entry))
        Button { revealed = nil; Task { await board.toggleUnread(entry, using: store) } } label: {
            Label(entry.unread ? L10n.text("清除未读") : L10n.text("标为未读"), image: entry.readActionImage)
        }.disabled(!available(entry) || entry.sessionId == nil)
        if let issue = entry.issue {
            Divider()
            quickAction(.status, for: issue, entry: entry)
            Button { revealed = nil; renameTitle = issue.title; renaming = issue } label: {
                DuduLabel(L10n.text("重命名"), icon: .rename)
            }.disabled(!available(entry))
            Divider()
            ForEach(IssueQuickAction.shown(for: issue)) { action in
                if action == .status {
                    Button { revealed = nil; onDetail(issue) } label: {
                        DuduLabel(L10n.text("详情"), icon: .issueDetails)
                    }
                } else {
                    quickAction(action, for: issue, entry: entry)
                }
            }
            Divider()
            Button { Task { await complete(entry) } } label: { DuduLabel(L10n.text("完成"), icon: .check) }
                .disabled(!available(entry) || issue.statusType == "done")
            Button(role: .destructive) { revealed = nil; removing = issue } label: {
                DuduLabel(L10n.text("删除"), icon: .trash)
            }.disabled(!available(entry))
        }
    }

    private func quickAction(_ action: IssueQuickAction, for issue: BoardIssue, entry: BoardConversation) -> some View {
        Button { revealed = nil; editing = IssueActionRequest(issue: issue, action: action) } label: {
            DuduLabel(action.title, icon: action.glyph)
        }.disabled(!action.isAvailable(for: issue) || !available(entry))
    }

    private func open(_ entry: BoardConversation, trace: BoardOpenTrace) {
        if revealed != nil { trace.record("menu_closed") }
        revealed = nil
        // Unassigned rows use the existing long-press Agent action, not a different tap destination. A tap says so instead of doing nothing (owner, 2026-11-22: "请分配智能体", on the
        // phone and on the computer): the same toast the board gives for its other results.
        if let issue = entry.issue, issue.agent == nil {
            trace.record("blocked", state: "unassigned")
            board.report?(DuduToastMessage(text: L10n.text("请分配智能体"), kind: .information))
            return
        }
        guard opening == nil else { trace.record("blocked", state: "opening"); return }
        opening = entry.id
        trace.record("accepted", state: entry.isAssistant ? "assistant" : "issue")
        Task {
            defer { if opening == entry.id { opening = nil } }
            if let issue = entry.issue { await onOpen(issue, trace) } else { await onOpenAssistant(trace) }
            trace.record("dispatch_finished")
        }
    }
    private func complete(_ entry: BoardConversation) async {
        revealed = nil
        guard let issue = entry.issue, available(entry), issue.statusType != "done" else { return }
        await board.complete(issue, using: store)
    }
    private func rename() {
        guard let issue = renaming else { return }
        let title = renameTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        renaming = nil
        let computer = store.activeComputer?.id
        Task {
            if await board.update(issue, patch: ["title": .string(title)], using: store) == nil, computer == store.activeComputer?.id {
                board.report?(DuduToastMessage(text: L10n.text("更改没能保存"), kind: .error))
            }
        }
    }
    private func openSelectedSubIssue() {
        guard let selection = subIssueSelection else { return }
        subIssueSelection = nil
        guard isActive, selection.computer == store.activeComputer?.id, selection.connection == store.connectionRevision else { return }
        // Keep the existing issue-conversation route, after the sheet has actually dismissed.
        Task { await onOpen(selection.issue, BoardOpenTrace()) }
    }
    private func clearActions() {
        removing = nil; revealed = nil; swiping = nil; editing = nil; renaming = nil; opening = nil
        subIssueSelection = nil; subIssues = nil; showingFilters = false
    }
}
