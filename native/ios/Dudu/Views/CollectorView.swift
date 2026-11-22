import SwiftUI

/// The Collector, a page of its own (owner, 2026-11-07): what the collectors brought back, in two tabs (待处理, 已处理). Its header (back, the
/// title, or the count and "全选" while choosing) is the root's toolbar; this is the rest of the page.
/// A tap opens a record in full; a swipe to the left (the app's own, `SwipeActionRow`) marks it handled (or restores it) or deletes it; pressing and holding opens the menu of what
/// can be done with that record, as it does on a conversation (owner, 2026-11-07: a long press that looked like choosing several, and did not choose several,
/// was "非常奇怪"). The menu's 选择 enters multiple selection with that row chosen (owner, 2026-11-13); taps then choose further rows.
struct CollectorView: View {
    /// What the page's reading is for: the tab, and whether the computer is there to ask.
    struct CollectorLoad: Hashable {
        var tab: CollectorTab
        var connected: Bool
    }

    @ObservedObject var model: CollectorModel
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DuduStore
    /// The toolbar above the page (the page itself starts below the status bar).
    let topInset: CGFloat
    /// Open the session of an issue (a record that went to an issue has it).
    let onOpenIssue: (Int) -> Void
    var quickSheet: AssistantQuickSheetState? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(\.conversationIsCovered) private var isCovered
    @State private var opened: CollectorRecord?
    @State private var picking: PickRequest?
    @State private var making: NewIssueDraft?
    /// The record whose swipe actions are showing (one at a time).
    @State private var revealed: Int?
    /// The records a delete waits for the person's word on (owner, 2026-11-21: asked first, as deleting a task is).
    @State private var deleting: [CollectorRecord]?

    /// The records to forward to the conversation of an issue.
    private struct PickRequest: Identifiable {
        let id = UUID()
        let records: [CollectorRecord]
    }

    var body: some View {
        Group {
            if let quickSheet {
                quickPage(quickSheet)
            } else {
                VStack(spacing: 0) {
                    GlassTabs(tabs: CollectorTab.allCases, title: \.title, selection: model.tab, identifier: "collector.tab", onSelect: model.select)
                    content
                }
                .padding(.top, topInset + 10)
            }
        }
        .background(DuduStyle.canvas)
        .modifier(DuduScrollEdgeBar(edge: .bottom, showsEffect: model.isSelecting && quickSheet == nil) {
            if model.isSelecting && quickSheet == nil {
                bulkBar
                    .padding(.bottom, GlassActionBar.bottomGap)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        })
        .animation(.easeOut(duration: 0.2), value: model.isSelecting)
        .accessibilityIdentifier("collector.page")
        // Read when the tab is shown and when the computer connects (a read before that is skipped, and the page would stay empty until it was pulled).
        .task(id: CollectorLoad(tab: model.tab, connected: store.status == .connected && !isCovered)) {
            guard store.status == .connected, !isCovered else { return }
            await model.refresh(using: store)
        }
        .sheet(item: $opened) { record in
            CollectorRecordSheet(record: record, tab: model.tab, model: model, board: board, store: store, onOpenIssue: onOpenIssue)
        }
        .sheet(item: $picking) { request in
            ForwardPickerSheet(records: request.records, board: board, store: store) { issue in
                await model.share(request.records, to: issue, using: store)
            }
        }
        .sheet(item: $making) { draft in
            NewIssueSheet(board: board, store: store, title: draft.title, brief: draft.brief, record: draft.record) {
                Task {
                    await model.refresh(using: store)
                    await model.refreshCount(using: store)
                }
            }
        }
        .onChange(of: model.isSelecting) { _, _ in revealed = nil }
        .alert(
            L10n.text("删除"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting
        ) { records in
            Button(L10n.text("取消"), role: .cancel) {}
            Button(L10n.text("删除"), role: .destructive) { Task { await model.mark(.delete, records, using: store) } }
        } message: { records in
            Text(records.count == 1 ? records[0].title : L10n.text("已选 {0} 条", "\(records.count)"))
        }
        .onChange(of: model.tab) { _, _ in revealed = nil }
        // A completion that failed while its record was not open is said here, as the page says its other failures: the plugin's own words, or the word for a change that did not go
        // through (the desktop's toast says the same). A record in full that is open says it itself, inside the sheet, because the sheet covers this toast.
        .onChange(of: model.completionProblems) { old, new in
            for (id, problem) in new where old[id] != problem && opened?.id != id && quickSheet?.record?.id != id {
                model.report?(DuduToastMessage(text: problem.isEmpty ? L10n.text("更改没能保存") : problem, kind: .error))
                model.clearProblem(id)
            }
        }
    }

    private func quickPage(_ sheet: AssistantQuickSheetState) -> some View {
        QuickSheetNavigation(state: sheet) { quickContent($0) }
    }

    private func quickContent(_ sheet: AssistantQuickSheetState) -> some View {
        ZStack {
            // Choosing has its own bar (owner, 2026-11-18): 取消 on the left leaves it, 全选 on the right, the title says how many, and the ✕ is not there; otherwise 选择 stands before the ✕.
            QuickSheetPage(
                title: model.isSelecting ? L10n.text("已选 {0} 条", "\(model.selection.count)") : L10n.text("收件箱"),
                count: model.isSelecting || model.state != .loaded ? nil : model.totals[model.tab],
                onClose: { dismiss() },
                centersTitle: true,
                leading: model.isSelecting ? QuickSheetLeading(title: L10n.text("取消")) { model.stopSelecting() } : nil,
                showsClose: !model.isSelecting,
                active: sheet.record == nil,
                scrollID: Binding(get: { sheet.scrollID }, set: { sheet.scrollID = $0 })
            ) {
                if model.isSelecting {
                    Button(L10n.text("全选")) { model.selectAll() }
                        .disabled(model.allSelected)
                        .accessibilityIdentifier("collector.selectAll")
                } else if canSelect {
                    Button(L10n.text("选择")) { model.startSelecting() }
                        .accessibilityIdentifier("collector.select")
                }
            } filters: {
                GlassTabs(tabs: CollectorTab.allCases, title: \.title, selection: model.tab, identifier: "collector.tab", onSelect: model.select)
                    .padding(.bottom, 14)
            } content: {
                if model.state == .loaded, !model.items.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(model.items) { record in
                            RevealSwipeRow(completion: swipeCompletion(for: record), trailing: swipeTrailing(for: record), enabled: canSwipe(record), isRevealed: revealed == record.id, onReveal: { revealed = $0 ? record.id : nil }, event: "inbox.row.swipe") {
                                Button { tap(record) } label: {
                                    CollectorRow(
                                        record: record, tab: model.tab, selecting: model.isSelecting,
                                        selected: model.selection.contains(record.id),
                                        completing: model.completing.contains(record.id) || model.changing.contains(record.id)
                                    ).padding(.horizontal, 4)
                                }
                                .buttonStyle(DuduRowButtonStyle())
                                .contextMenu { rowMenu(for: record) } preview: {
                                    CollectorRowCard(record: record, tab: model.tab, completing: model.completing.contains(record.id))
                                }
                                .accessibilityIdentifier("collector.record.\(record.id)")
                            }
                            .id(String(record.id))
                            if record.id != model.items.last?.id { QuickTodoSeparator(leading: model.isSelecting ? 104 : 70) }
                        }
                    }
                    .scrollTargetLayout()
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                    if model.hasMore {
                        ProgressView()
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .id(model.items.last?.id)
                            .onScrollVisibilityChange(threshold: 0.1) { visible in
                                if visible { Task { await model.loadMore(using: store) } }
                            }
                    }
                } else {
                    content.frame(minHeight: 82)
                }
            } footer: {
                if model.isSelecting { bulkBar.padding(.bottom, GlassActionBar.bottomGap) }
            }
            .opacity(sheet.record == nil ? 1 : 0)
            .allowsHitTesting(sheet.record == nil)
            .accessibilityHidden(sheet.record != nil)

            if let record = sheet.record {
                CollectorRecordSheet(
                    record: record, tab: model.tab, model: model, board: board, store: store, onOpenIssue: onOpenIssue,
                    quickNavigation: QuickDetailNavigation(back: { sheet.record = nil }, close: { dismiss() })
                )
                .id(record.id)
            }
        }
    }

    /// 选择 in the bar needs a row that can be chosen (a handled record that went to an issue is the issue's).
    private var canSelect: Bool { model.state == .loaded && model.items.contains { model.tab != .done || $0.issue == nil } }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView()
                .tint(DuduStyle.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("collector.loading")
        case .failed:
            VStack(spacing: 14) {
                Text(L10n.text("信息没能加载"))
                    .font(.system(size: 15))
                    .foregroundStyle(DuduStyle.muted)
                Button { Task { await model.refresh(using: store) } } label: {
                    Text(L10n.text("重试"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DuduStyle.ink)
                        .padding(.horizontal, 20)
                        .frame(height: 44)
                        .contentShape(Capsule())
                }
                .buttonStyle(DuduGlassCapsuleButtonStyle())
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            if model.items.isEmpty {
                Text(L10n.text("没有信息"))
                    .font(.system(size: 15))
                    .foregroundStyle(DuduStyle.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("collector.empty")
            } else {
                list
            }
        }
    }

    private var list: some View {
        List {
            ForEach(model.items) { record in
                RevealSwipeRow(completion: swipeCompletion(for: record), trailing: swipeTrailing(for: record), enabled: canSwipe(record), isRevealed: revealed == record.id, onReveal: { revealed = $0 ? record.id : nil }, event: "inbox.row.swipe") {
                    Button { tap(record) } label: {
                        CollectorRow(record: record, tab: model.tab, selecting: model.isSelecting, selected: model.selection.contains(record.id), completing: model.completing.contains(record.id))
                    }
                    .buttonStyle(DuduRowButtonStyle())
                    // Press and hold: the row lifts as a card and the menu opens under it, as on a conversation.
                    .contextMenu {
                        rowMenu(for: record)
                    } preview: {
                        CollectorRowCard(record: record, tab: model.tab, completing: model.completing.contains(record.id))
                    }
                    .accessibilityIdentifier("collector.record.\(record.id)")
                    // The row is as wide as the page, so that its swipe blocks reach the edges as the board list's do; the record keeps the side padding it had.
                    .padding(.horizontal, DuduLayout.sidebarPadding)
                }
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 2, trailing: 0))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
                .onAppear {
                    if record.id == model.items.last?.id, model.hasMore { Task { await model.loadMore(using: store) } }
                }
            }
            // Only the legacy overlay needs its bar's height reserved inside the list.
            Color.clear.frame(height: listBottomPadding)
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await model.refresh(using: store) }
    }

    private var listBottomPadding: CGFloat {
        guard model.isSelecting else { return 24 }
        return DuduScrollEdges.usesSystemEffect ? 96 - GlassActionBar.reservedHeight : 96
    }

    /// A tap: puts away the swipe actions that are showing; chooses or leaves out the row while rows are being chosen; otherwise opens the record.
    private func tap(_ record: CollectorRecord) {
        if revealed != nil {
            revealed = nil
        } else if model.isSelecting {
            guard model.tab != .done || record.issue == nil else { return }
            model.toggle(record.id)
        } else {
            if let quickSheet { quickSheet.record = record } else { opened = record }
        }
    }

    private func mark(_ action: CollectorMark, _ record: CollectorRecord) {
        if action == .delete { revealed = nil; deleting = [record]; return }
        Task { await model.mark(action, [record], using: store) }
    }

    /// The board list's swipe on a record (owner, 2026-11-19: "右滑已处理，左滑点击转发，参考看板列表"; the marks went into the swipe on 2026-11-07, and 删除 stays in it). On the to-do
    /// list a swipe to the right is Handled (a tap on its block, or a swipe past two thirds of the row: the row slides away and closes) and a swipe to the left offers Forward and
    /// Delete; on Handled the left offers Restore and Delete, and the right nothing. A record that went to an issue is the issue's. Not while rows are being chosen, nor while the
    /// record is being changed (the blocks themselves stay what they are then, so that a row that is closing keeps its colour).
    private func canSwipe(_ record: CollectorRecord) -> Bool {
        !model.isSelecting && !model.changing.contains(record.id)
    }

    private func swipeCompletion(for record: CollectorRecord) -> RevealSwipeCompletion? {
        guard model.tab == .todo else { return nil }
        return RevealSwipeCompletion(title: L10n.text("已处理"), asset: "Home-SwipeComplete", color: RevealSwipeAction.teal) {
            _ = await model.mark(.done, [record], using: store)
        }
    }

    private func swipeTrailing(for record: CollectorRecord) -> [RevealSwipeAction] {
        guard model.tab == .todo || record.issue == nil else { return [] }
        let delete = RevealSwipeAction(id: "delete", title: L10n.text("删除"), glyph: .icon(.trash), color: SwipeAction.red) { mark(.delete, record) }
        switch model.tab {
        case .todo:
            guard record.issue == nil else { return [delete] }
            return [RevealSwipeAction(id: "forward", title: L10n.text("转发"), glyph: .icon(.forward), color: RevealSwipeAction.blue) { picking = PickRequest(records: [record]) }, delete]
        case .done:
            return [RevealSwipeAction(id: "restore", title: L10n.text("恢复"), glyph: .icon(.restore), color: RevealSwipeAction.blue) { mark(.restore, record) }, delete]
        }
    }

    /// What pressing and holding a record offers: the desktop's right-click menu (and the bar of a record in full), for that one record. Nothing while rows are
    /// being chosen. A record that went to an issue is the issue's: it can be opened, and that is all but filling in its context, which every record has, in every tab (it comes after
    /// what passes the record on and before the marks, as the desktop's menu has it).
    @ViewBuilder
    private func rowMenu(for record: CollectorRecord) -> some View {
        if !model.isSelecting {
            if model.tab != .done || record.issue == nil {
                Button { model.startSelecting(with: record.id) } label: { DuduLabel(inbox: L10n.text("选择"), icon: .selectRows) }
            }
            if let issue = record.issue {
                Button { onOpenIssue(issue.id) } label: { DuduLabel(inbox: L10n.text("打开事项"), icon: .open) }
                completeButton(for: record)
            } else {
                if model.tab != .done {
                    Button { picking = PickRequest(records: [record]) } label: { DuduLabel(inbox: L10n.text("转发"), icon: .forward) }
                    Button { makeIssue(from: record) } label: { DuduLabel(inbox: L10n.text("新建事项"), icon: .plus) }
                }
                completeButton(for: record)
                if model.tab == .todo {
                    Button { mark(.done, record) } label: { DuduLabel(inbox: L10n.text("已处理"), icon: .check) }
                } else {
                    Button { mark(.restore, record) } label: { DuduLabel(inbox: L10n.text("恢复"), icon: .restore) }
                }
                Button(role: .destructive) { mark(.delete, record) } label: { DuduLabel(inbox: L10n.text("删除"), icon: .trash) }
            }
        }
    }

    /// Fill in the context of a record: its collector's session goes back to the source and reads what is around it. The row shows a spinner at once and the item cannot be chosen again
    /// until it is over; what comes of it is in the record when it is opened, and a failure is said by a toast (`model.completionProblems`).
    private func completeButton(for record: CollectorRecord) -> some View {
        Button { model.complete(record, using: store) } label: { DuduLabel(inbox: L10n.text("补全上下文"), icon: .completeContext) }
            .disabled(model.completing.contains(record.id))
    }

    /// A new issue that starts with the record's title and text (the record in full has them).
    private func makeIssue(from record: CollectorRecord) {
        Task {
            let loaded = await model.detail(of: record, using: store)
            making = NewIssueDraft(title: loaded?.draft.title ?? record.title, brief: loaded?.draft.brief ?? "", record: record.id)
        }
    }

    /// What can be done to all the chosen rows at once: forward them, mark them handled, delete them (the words under the icons, delete in red).
    private var bulkBar: some View {
        let items: [GlassActionBar.Item] = [
            .init(id: "forward", title: L10n.text("转发"), glyph: .forward) { picking = PickRequest(records: model.chosen) },
            .init(id: "done", title: L10n.text("已处理"), glyph: .check) { Task { await model.mark(.done, model.chosen, using: store) } },
            .init(id: "delete", title: L10n.text("删除"), glyph: .trash, destructive: true) { deleting = model.chosen },
        ]
        return GlassActionBar(items: model.chosen.isEmpty ? items.map { $0.disabled() } : items)
    }
}

/// A new issue's starting words: the record's title and text when it is made of one.
struct NewIssueDraft: Identifiable {
    let id = UUID()
    var title = ""
    var brief = ""
    var record: Int?
}

/// One record: where it comes from as a small picture, its title (two lines at most), who it is from and which collector, and at the right when (or the issue it went to) and its number
/// (owner, 2026-11-18, the inbox redesign: `.local/designs/inbox-forward-2026-11-18/`, 44pt picture, 16pt title, 13pt line under it, 12pt time and 11pt number, 66pt at least).
/// The information card of 嘟嘟's chat draws its rows with it too (`QuickCardView`).
struct CollectorRow: View {
    let record: CollectorRecord
    let tab: CollectorTab
    let selecting: Bool
    let selected: Bool
    /// Its context is being filled in (`CollectorModel.complete`): a small spinner stands before the time, as on the desktop's row.
    var completing = false

    /// A handled record that went to an issue is the issue's: nothing to choose it for.
    private var choosable: Bool { tab != .done || record.issue == nil }

    /// The room the column at the right takes from the text: the widest time ("11月16日", 12pt) with a little air.
    private static let trailingColumn: CGFloat = 56

    var body: some View {
        HStack(spacing: 12) {
            // The circle to choose the row is in front of the picture, which stays (owner, 2026-11-07, of the desktop's box: "移动到图标前面的位置，
            // 而不是覆盖图标"); a row that cannot be chosen keeps the place, so that the pictures line up.
            if selecting {
                ZStack {
                    if choosable {
                        Circle()
                            .strokeBorder(selected ? DuduStyle.blue : Color(white: 0.77), lineWidth: 1.5)
                            .background(Circle().fill(selected ? DuduStyle.blue : Color.clear))
                            .overlay {
                                if selected { DuduIcon(.check, size: 13, strokeWidth: 3.2).foregroundStyle(.white) }
                            }
                    }
                }
                .frame(width: 22, height: 22)
                .transition(.move(edge: .leading).combined(with: .opacity))
            }
            // The unread mark is the board's own (`ConversationAvatarStatus`: same red, halo, size and anchor on a rounded-square tile), not a second drawing of it (owner, 2026-11-21: "和看板页面上的红点一样").
            ConnectorAvatar(icon: record.connectorIcon, name: record.connectorName, size: 44)
                .modifier(ConversationAvatarStatus(state: record.unread == true ? .unread : .idle, size: 44, roundedSquare: true))
            VStack(alignment: .leading, spacing: 3) {
                Text(record.title)
                    .font(.system(size: 16, weight: .medium))
                    .lineSpacing(2)
                    .foregroundStyle(DuduStyle.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                Text(record.byLine)
                    .font(.system(size: 13))
                    .foregroundStyle(DuduStyle.muted)
                    .lineLimit(1)
            }
            .padding(.trailing, Self.trailingColumn)
            .frame(maxWidth: .infinity, alignment: .leading)
            // The column at the right is held to the text's two ends: the time on the first line, the number on the last.
            .overlay(alignment: .topTrailing) {
                HStack(spacing: 6) {
                    if completing {
                        ProgressView()
                            .controlSize(.small)
                            .scaleEffect(0.7)
                            .tint(DuduStyle.muted)
                            .frame(width: 14, height: 14)
                            .accessibilityHidden(true)
                    }
                    if let first = firstLine {
                        Text(first)
                            .font(.system(size: 12))
                            .foregroundStyle(DuduStyle.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                    }
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if let ref = record.ref, !ref.isEmpty {
                    Text(ref)
                        .font(.system(size: 11))
                        .foregroundStyle(DuduStyle.muted)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 10)
        .frame(minHeight: 62)
        .background(selected ? DuduStyle.selected : Color.clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }

    /// The first line of the column at the right: the issue a handled record went to, or when it came.
    private var firstLine: String? {
        if tab == .done, let issue = record.issue { return issue.reference }
        return record.at.map(relativeTime)
    }
}

/// The card a pressed record lifts into while its menu is open: the row itself, on white (a conversation's is its title on white).
private struct CollectorRowCard: View {
    let record: CollectorRecord
    let tab: CollectorTab
    var completing = false

    var body: some View {
        CollectorRow(record: record, tab: tab, selecting: false, selected: false, completing: completing)
            .padding(.horizontal, 6)
            .frame(width: 340)
            .background(Color.white)
    }
}

/// A glass bar of a page's actions, each an icon over its word (owner, 2026-11-18, the inbox redesign: the bar of icons alone had no words): the bar of chosen rows, the bottom of a record in full and of a task.
/// An item is a button, or a menu of actions (更多). The word and the icon of one that deletes are red.
struct GlassActionBar: View {
    static let barHeight: CGFloat = 58
    static let bottomGap: CGFloat = 2
    static var reservedHeight: CGFloat { barHeight + bottomGap }

    /// One action of an item's menu.
    struct MenuEntry: Identifiable {
        let id: String
        let title: String
        let glyph: DuduGlyph
        var isDestructive = false
        var isDisabled = false
        let action: () -> Void
    }

    struct Item: Identifiable {
        let id: String
        let title: String
        let glyph: DuduGlyph
        var isDisabled = false
        /// What it asks for is under way: a spinner stands in the place of its icon (so that it shows at once and is not pressed again) and it cannot be pressed.
        var isBusy = false
        var isDestructive = false
        /// An item with entries opens them as a menu when it is pressed; it has no action of its own.
        var menu: [MenuEntry] = []
        let action: () -> Void

        init(id: String, title: String, glyph: DuduGlyph, destructive: Bool = false, action: @escaping () -> Void) {
            self.id = id
            self.title = title
            self.glyph = glyph
            self.isDestructive = destructive
            self.action = action
        }

        init(id: String, title: String, glyph: DuduGlyph, menu: [MenuEntry]) {
            self.id = id
            self.title = title
            self.glyph = glyph
            self.menu = menu
            self.action = {}
        }

        func disabled() -> Item {
            var copy = self
            copy.isDisabled = true
            return copy
        }

        func busy(_ on: Bool) -> Item {
            var copy = self
            copy.isBusy = on
            return copy
        }
    }

    let items: [Item]

    @Environment(\.homeIndicatorInset) private var homeInset

    /// The blur starts at the top of the bar and runs to the screen's bottom edge, across the whole width: it is on the bar's left, right and below it, and nothing above the bar is
    /// blurred (owner, 2026-11-07: "上部不要模糊，左右下模糊"; the first try faded it upwards from the bar, over the page above).
    private var blurHeight: CGFloat { Self.reservedHeight + max(homeInset, 20) }
    var body: some View {
        bar
            .background(alignment: .bottom) {
                if !DuduScrollEdges.usesSystemEffect {
                    DuduEdgeBlur(edge: .bottom, height: blurHeight, strength: 0.9)
                        .frame(height: blurHeight)
                        .ignoresSafeArea(edges: .bottom)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
    }

    /// A small glass pill of actions, each an icon over a 11pt word.
    private var bar: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                cell(item)
                    .accessibilityLabel(item.title)
                    .accessibilityIdentifier("collector.action.\(item.id)")
            }
        }
        .padding(.horizontal, 6)
        .duduGlass(in: Capsule())
        .padding(.horizontal, 20)
    }

    @ViewBuilder
    private func cell(_ item: Item) -> some View {
        if item.menu.isEmpty {
            Button(action: item.action) { label(item) }
                .buttonStyle(DuduQuietPressStyle())
                .disabled(item.isDisabled || item.isBusy)
        } else {
            Menu {
                ForEach(item.menu) { entry in
                    Button(role: entry.isDestructive ? .destructive : nil, action: entry.action) { DuduLabel(inbox: entry.title, icon: entry.glyph, destructive: entry.isDestructive) }
                        .disabled(entry.isDisabled)
                }
            } label: { label(item) }
            .menuIndicator(.hidden)
            // The words in the order they are written, also when the menu opens upward over the bar (the system turns it round by default): the first one on top, delete last, nearest the bar.
            .menuOrder(.fixed)
            .buttonStyle(DuduQuietPressStyle())
            .disabled(item.isDisabled)
        }
    }

    private func label(_ item: Item) -> some View {
        let color = (item.isDestructive ? DuduStyle.chatError : DuduStyle.ink).opacity(item.isDisabled ? 0.35 : 1)
        return VStack(spacing: 5) {
            if item.isBusy {
                ProgressView()
                    .controlSize(.small)
                    .tint(DuduStyle.ink)
                    .frame(width: 22, height: 22)
            } else {
                DuduInboxIcon(glyph: item.glyph, slot: 22)
            }
            Text(item.title)
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .foregroundStyle(color)
        .frame(maxWidth: .infinity)
        .frame(height: Self.barHeight)
        .contentShape(Rectangle())
    }
}

/// A record in full, as a sheet over the list: what it says, what was around it, who it is from and when, and what can be done with it.
#if DEBUG && targetEnvironment(simulator)
struct SimulatorCollectorRecordReview: View {
    let record: CollectorRecord
    @ObservedObject var model: CollectorModel
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DuduStore

    var body: some View {
        CollectorRecordSheet(record: record, tab: model.tab, model: model, board: board, store: store, onOpenIssue: { _ in })
    }
}
#endif

private struct CollectorRecordSheet: View {
    let record: CollectorRecord
    let tab: CollectorTab
    @ObservedObject var model: CollectorModel
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DuduStore
    let onOpenIssue: (Int) -> Void
    var quickNavigation: QuickDetailNavigation? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmingDelete = false
    @State private var detail: (record: CollectorRecord, draft: CollectorDraft)?
    @State private var failed = false
    @State private var next: Next?
    @State private var activeAction: String?
    /// The record went to a conversation: the page it was opened from takes it away once the picker is gone.
    @State private var forwarded = false

    private enum Next: Identifiable {
        case forward
        case newIssue(NewIssueDraft)

        var id: String {
            switch self {
            case .forward: return "forward"
            case .newIssue: return "newIssue"
            }
        }
    }

    private var shown: CollectorRecord { detail?.record ?? record }

    /// The collector's session is filling in this record's context (asked here or in the list, or at it already when the record was opened).
    private var isCompleting: Bool { model.completing.contains(record.id) }

    /// Why the last completion failed, in the plugin's own words or in the word for a change that did not go through (the desktop's toast says the same); the sheet says it itself, for it
    /// covers the page's toast. What the plugin said of an earlier one comes with the record (it keeps that ten minutes).
    private var completionProblem: String? {
        guard !isCompleting else { return nil }
        if let problem = model.completionProblems[record.id] { return problem.isEmpty ? L10n.text("更改没能保存") : problem }
        guard let error = detail?.record.completeError, !error.isEmpty else { return nil }
        return error
    }

    private var meta: String {
        [shown.ref ?? "", shown.from ?? "", shown.connectorName, shown.at.map(relativeTime) ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    /// The link to the source, when the record has one a browser can open.
    private var sourceURL: URL? {
        shown.url.flatMap(URL.init(string:)).flatMap { ["http", "https"].contains($0.scheme?.lowercased()) ? $0 : nil }
    }

    private var recordContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(shown.title)
                .font(.system(size: 19, weight: .semibold))
                .lineSpacing(2)
                .foregroundStyle(DuduStyle.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(meta)
                .font(.system(size: 13))
                .foregroundStyle(DuduStyle.muted)
                .padding(.top, 10)
            if let issue = shown.issue {
                Text("\(shown.verdict == "issue" ? L10n.text("已新建 ") : L10n.text("已转发到 "))\(issue.reference)")
                    .font(.system(size: 13))
                    .foregroundStyle(DuduStyle.chatSecondary)
                    .padding(.top, 6)
            }
            if failed {
                Text(L10n.text("信息没能加载"))
                    .font(.system(size: 15))
                    .foregroundStyle(DuduStyle.muted)
                    .padding(.top, 20)
            }
            if let problem = completionProblem {
                Text(problem)
                    .font(.system(size: 13))
                    .foregroundStyle(DuduStyle.chatError)
                    .padding(.top, 20)
                    .accessibilityIdentifier("collector.record.completeError")
            }
            recordCard
            if let context = detail?.record.context, !context.isEmpty {
                Text(L10n.text("上下文"))
                    .font(.system(size: 12))
                    .foregroundStyle(DuduStyle.muted)
                    .padding(.top, 24)
                ForEach(Array(context.enumerated()), id: \.offset) { _, entry in
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 8) {
                            Text(entry.from ?? "").font(.system(size: 13, weight: .semibold)).foregroundStyle(DuduStyle.ink)
                            if let at = entry.at { Text(relativeTime(at)).font(.system(size: 12)).foregroundStyle(DuduStyle.muted) }
                        }
                        Text(entry.text ?? "").font(.system(size: 13)).foregroundStyle(DuduStyle.chatSecondary)
                    }
                    .padding(.top, 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// What the record says, in one white card (owner, 2026-11-18, the inbox redesign): a conversation as a talk when the plugin sent its messages one by one, otherwise the text as it is; the source is the
    /// card's last row, 打开来源, when the record has a link.
    @ViewBuilder
    private var recordCard: some View {
        let messages = detail?.record.messages ?? []
        let text = detail?.record.text ?? ""
        let hasWords = !messages.isEmpty || !text.isEmpty
        if hasWords || sourceURL != nil {
            VStack(alignment: .leading, spacing: 0) {
                if !messages.isEmpty {
                    RecordTalk(messages: messages)
                        .padding(.horizontal, 16)
                        .padding(.top, 14)
                        .padding(.bottom, 8)
                } else if !text.isEmpty {
                    Text(text)
                        .font(.system(size: 16))
                        .foregroundStyle(DuduStyle.ink)
                        .lineSpacing(4)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                }
                if let url = sourceURL {
                    if hasWords { Rectangle().fill(DuduStyle.line).frame(height: 1).padding(.horizontal, 16) }
                    Button { openURL(url) } label: {
                        HStack(spacing: 8) {
                            Text(L10n.text("打开来源")).font(.system(size: 16)).foregroundStyle(DuduStyle.ink)
                            Spacer(minLength: 8)
                            DuduIcon(.openLink, size: 18).foregroundStyle(DuduStyle.muted)
                        }
                        .padding(.horizontal, 16)
                        .frame(height: 53)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(DuduRowButtonStyle())
                    .accessibilityIdentifier("collector.record.source")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.top, 14)
        }
    }

    /// The header is the page's frame and no more (owner, 2026-11-18): ‹ when it is pushed, the title, ✕. What can be done is in the bar at the bottom.
    private var standalone: some View {
        QuickSheetPage(title: L10n.text("收件箱"), onClose: { dismiss() }, centersTitle: true, actions: {}, filters: {}) {
            recordContent.padding(.horizontal, 4).padding(.top, 14)
        } footer: {
            GlassActionBar(items: barItems)
                .padding(.bottom, GlassActionBar.bottomGap)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(DuduStyle.sheet)
    }

    var body: some View {
        Group {
            if let quickNavigation {
                QuickSheetPage(
                    title: L10n.text("收件箱"), onBack: quickNavigation.back, onClose: quickNavigation.close,
                    allowsExpansion: true, actions: {}, filters: {}
                ) {
                    recordContent.padding(.horizontal, 4).padding(.top, 14)
                } footer: {
                    GlassActionBar(items: barItems).padding(.bottom, GlassActionBar.bottomGap)
                }
            } else {
                standalone
            }
        }
        .alert(L10n.text("删除"), isPresented: $confirmingDelete) {
            Button(L10n.text("取消"), role: .cancel) {}
            Button(L10n.text("删除"), role: .destructive) { performMore(.delete) }
        } message: {
            Text(record.title)
        }
        .task {
            if let loaded = await model.detail(of: record, using: store) {
                detail = loaded
                // One that was running when the record was opened is waited for as well.
                if loaded.record.completing == true { model.follow(record, using: store) }
            } else {
                failed = true
            }
        }
        .task(id: VisibleRecordRead(revision: detail?.record.revision,
                                   active: scenePhase == .active && next == nil)) {
            guard scenePhase == .active, next == nil, let full = detail?.record else { return }
            await model.acknowledgeVisible(full, using: store)
        }
        // A completion has begun (what the computer said of the last one is out of date) or has come to its end: read the record again, for the lines it added.
        .onChange(of: isCompleting) { was, now in
            detail?.record.completeError = nil
            guard was, !now else { return }
            Task { if let loaded = await model.detail(of: record, using: store) { detail = loaded } }
        }
        .onDisappear { model.clearProblem(record.id) }
        .sheet(item: $next, onDismiss: {
            // Forwarded: the record has left this tab, so the page it was opened from goes (back to the list, or away when it was opened on its own).
            if forwarded {
                forwarded = false
                finish()
            }
        }) { destination in
            switch destination {
            case .forward:
                ForwardPickerSheet(records: [record], board: board, store: store) { issue in
                    let went = await model.share([record], to: issue, using: store)
                    if went { forwarded = true }
                    return went
                }
            case let .newIssue(draft):
                NewIssueSheet(board: board, store: store, title: draft.title, brief: draft.brief, record: draft.record) {
                    Task {
                        await model.refresh(using: store)
                        await model.refreshCount(using: store)
                    }
                    finish()
                }
            }
        }
    }

    private struct VisibleRecordRead: Equatable {
        let revision: Int?
        let active: Bool
    }

    private func finish() {
        if let quickNavigation { quickNavigation.back() } else { dismiss() }
    }

    private struct MoreAction {
        let title: String
        let glyph: DuduGlyph
        let mark: CollectorMark
    }

    /// What is left after the bar's: delete (not for a record an issue holds); 更多 opens it after filling in the context.
    private var moreActions: [MoreAction] {
        guard record.issue == nil else { return [] }
        return [MoreAction(title: L10n.text("删除"), glyph: .trash, mark: .delete)]
    }

    /// One of 更多's marks, one at a time like the bar's (a delete comes here once the person has said yes).
    private func performMore(_ action: CollectorMark) {
        activeAction = "more"
        Task {
            defer { activeAction = nil }
            if await model.mark(action, [record], using: store) { finish() }
        }
    }

    /// Fill in the context of the record: a spinner stands in the button's place while it runs, and the sheet stays open (the new lines come into it).
    private func completeContext() {
        guard !isCompleting else { return }
        model.complete(record, using: store)
    }

    /// What can be done with the record, left to right (owner, 2026-11-18, the inbox redesign): what passes it on (转发, 新建事项), the mark that is done with it (已处理, or 恢复 on the
    /// handled), and 更多, a menu of filling in the context and delete (in red). A record an issue holds has 打开事项 and 补全上下文 and no 更多.
    private var barItems: [GlassActionBar.Item] {
        func mark(_ id: String, _ title: String, _ glyph: DuduGlyph, _ action: CollectorMark) -> GlassActionBar.Item {
            .init(id: id, title: title, glyph: glyph) {
                activeAction = id
                Task {
                    defer { activeAction = nil }
                    if await model.mark(action, [record], using: store) { finish() }
                }
            }
        }
        let complete = GlassActionBar.Item(id: "complete", title: L10n.text("补全上下文"), glyph: .completeContext) { completeContext() }.busy(isCompleting)
        // 更多: the spinner of a completion in the place of its icon (the menu stays open to the other actions); its own marks are one at a time like the bar's.
        var entries = [GlassActionBar.MenuEntry(id: "complete", title: L10n.text("补全上下文"), glyph: .completeContext, isDisabled: isCompleting) { completeContext() }]
        for item in moreActions {
            entries.append(GlassActionBar.MenuEntry(
                id: "mark.\(item.mark.rawValue)", title: item.title, glyph: item.glyph, isDestructive: item.glyph == .trash,
                isDisabled: model.changing.contains(record.id) || activeAction != nil
            ) {
                if item.mark == .delete { confirmingDelete = true } else { performMore(item.mark) }
            })
        }
        let more = GlassActionBar.Item(id: "more", title: L10n.text("更多"), glyph: .options, menu: entries).busy(isCompleting || activeAction == "more")
        func ready(_ items: [GlassActionBar.Item]) -> [GlassActionBar.Item] {
            model.changing.contains(record.id) || activeAction != nil
                ? items.map { $0.id == activeAction ? $0.busy(true).disabled() : $0.disabled() } : items
        }
        if tab == .done {
            if let issue = record.issue {
                return ready([.init(id: "issue", title: L10n.text("打开事项"), glyph: .open) {
                    if quickNavigation == nil { dismiss() }
                    onOpenIssue(issue.id)
                }, complete])
            }
            return ready([mark("restore", L10n.text("恢复"), .restore, .restore), more])
        }
        let draft = NewIssueDraft(title: detail?.draft.title ?? record.title, brief: detail?.draft.brief ?? "", record: record.id)
        return ready([
            .init(id: "forward", title: L10n.text("转发"), glyph: .forward) { next = .forward },
            .init(id: "new", title: L10n.text("新建事项"), glyph: .plus) { next = .newIssue(draft) },
            mark("done", L10n.text("已处理"), .check, .done),
            more,
        ])
    }
}

/// A conversation record's messages as a talk, inside the record's white card (owner, 2026-11-18, the inbox redesign): the day between the days (`MM-DD`, centred on two hairlines), the sender's name
/// (14pt semibold) when the sender changes, each message in 16pt with its time (12pt, muted) at the right.
private struct RecordTalk: View {
    let messages: [CollectorMessage]

    private struct Line: Identifiable {
        let id: Int
        let message: CollectorMessage
        /// The day starts here: its date goes first.
        let startsDay: Bool
        /// The sender is named before the message: it is the first of the day, or another one than before.
        let showsName: Bool
    }

    private var lines: [Line] {
        var out: [Line] = []
        for (index, message) in messages.enumerated() {
            let previous = index > 0 ? messages[index - 1] : nil
            let startsDay = previous?.day != message.day
            out.append(Line(id: index, message: message, startsDay: startsDay, showsName: message.from != nil && (startsDay || previous?.from != message.from)))
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(lines) { line in
                if line.startsDay { dateDivider(line.message.day) }
                if line.showsName, let name = line.message.from {
                    Text(name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DuduStyle.ink)
                        .frame(height: 24, alignment: .leading)
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(line.message.text)
                        .font(.system(size: 16))
                        .lineSpacing(3)
                        .foregroundStyle(DuduStyle.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(line.message.time)
                        .font(.system(size: 12))
                        .foregroundStyle(DuduStyle.muted)
                        .monospacedDigit()
                }
                .padding(.bottom, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func dateDivider(_ day: String) -> some View {
        HStack(spacing: 10) {
            Rectangle().fill(DuduStyle.line).frame(height: 1)
            Text(day).font(.system(size: 12)).foregroundStyle(DuduStyle.muted)
            Rectangle().fill(DuduStyle.line).frame(height: 1)
        }
        .frame(height: 30)
    }
}
