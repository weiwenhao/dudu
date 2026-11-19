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
    @Environment(\.scenePhase) private var scenePhase
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
        .refreshable { await board.refresh(using: store) }
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y } action: { previous, next in
            // Simultaneous horizontal recognition must not close its own newly revealed actions.
            if previous != next, swiping == nil, revealed != nil { revealed = nil }
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
        // Keep the App badge current while another native page covers this retained homepage.
        // Reading this list never acknowledges a session; only its actually rendered chat does.
        .task(id: BoardLoad(connected: store.status == .connected, active: scenePhase == .active)) {
            guard scenePhase == .active, store.status == .connected else { return }
            while !Task.isCancelled {
                await board.refresh(using: store)
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
    }

    private struct BoardLoad: Hashable {
        var connected: Bool
        var active: Bool
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
            if board.tab == .backlog, rows.isEmpty {
                Text(board.scopedConversations.isEmpty
                     ? L10n.text("暂无待规划事项")
                     : L10n.text("没有找到事项"))
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
            Label(entry.pinned ? L10n.text("取消置顶") : L10n.text("置顶"), systemImage: entry.pinActionSystemImage)
        }.disabled(!available(entry))
        Button { revealed = nil; Task { await board.toggleUnread(entry, using: store) } } label: {
            Label(entry.unread ? L10n.text("清除未读") : L10n.text("标为未读"), image: entry.readActionImage)
        }.disabled(!available(entry) || entry.sessionId == nil)
        if let issue = entry.issue {
            Divider()
            Button { revealed = nil; onDetail(issue) } label: { Label(L10n.text("详情"), systemImage: "doc.text") }
            Button { revealed = nil; renameTitle = issue.title; renaming = issue } label: {
                Label(L10n.text("重命名"), systemImage: "pencil")
            }.disabled(!available(entry))
            Divider()
            ForEach(IssueQuickAction.allCases) { action in
                Button { revealed = nil; editing = IssueActionRequest(issue: issue, action: action) } label: {
                    Label(action.title, systemImage: action.homeMenuSystemImage)
                }.disabled(!action.isAvailable(for: issue) || !available(entry))
            }
            Divider()
            Button { Task { await complete(entry) } } label: { Label(L10n.text("完成"), systemImage: "checkmark") }
                .disabled(!available(entry) || issue.statusType == "done")
            Button(role: .destructive) { revealed = nil; removing = issue } label: {
                Label(L10n.text("删除"), systemImage: "trash")
            }.disabled(!available(entry))
        }
    }

    private func open(_ entry: BoardConversation, trace: BoardOpenTrace) {
        if revealed != nil { trace.record("menu_closed") }
        revealed = nil
        // Unassigned rows use the existing long-press Agent action, not a different tap destination.
        if let issue = entry.issue, issue.agent == nil {
            trace.record("blocked", state: "unassigned")
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
