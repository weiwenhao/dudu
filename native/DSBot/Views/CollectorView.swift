import SwiftUI

/// The Collector, a page of its own (owner, 2026-11-07): what the collectors brought back, in the desktop's three tabs. Its header (back, the
/// title, the button that starts choosing, or the count and "全选" while choosing) is the root's toolbar; this is the rest of the page.
/// A tap opens a record in full; a swipe to the left (the app's own, `SwipeActionRow`) marks it handled, ignores it or deletes it; pressing and holding opens the menu of what
/// can be done with that record, as it does on a conversation (owner, 2026-11-07: a long press that looked like choosing several, and did not choose several,
/// was "非常奇怪"); choosing several is the button at the top right, and brings up the bar of what can be done to all of them.
struct CollectorView: View {
    /// What the page's reading is for: the tab, and whether the computer is there to ask.
    struct CollectorLoad: Hashable {
        var tab: CollectorTab
        var connected: Bool
    }

    @ObservedObject var model: CollectorModel
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    /// The toolbar above the page (the page itself starts below the status bar).
    let topInset: CGFloat
    /// Open the session of an issue (a record that went to an issue has it).
    let onOpenIssue: (Int) -> Void

    @State private var opened: CollectorRecord?
    @State private var picking: PickRequest?
    @State private var making: NewIssueDraft?
    /// The record whose swipe actions are showing (one at a time).
    @State private var revealed: Int?

    private enum PickTarget { case issue, session }

    /// The records to share, and where to: to an issue, or to the session of one.
    private struct PickRequest: Identifiable {
        let id = UUID()
        let target: PickTarget
        let records: [CollectorRecord]
    }

    var body: some View {
        VStack(spacing: 0) {
            GlassTabs(tabs: CollectorTab.allCases, title: \.title, selection: model.tab, identifier: "collector.tab", onSelect: model.select)
            content
        }
        .padding(.top, topInset + 10)
        .background(DSBotStyle.canvas)
        .modifier(DSBotScrollEdgeBar(edge: .bottom) {
            if model.isSelecting {
                bulkBar
                    .padding(.bottom, GlassActionBar.bottomGap)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        })
        .animation(.easeOut(duration: 0.2), value: model.isSelecting)
        .accessibilityIdentifier("collector.page")
        // Read when the tab is shown and when the computer connects (a read before that is skipped, and the page would stay empty until it was pulled).
        .task(id: CollectorLoad(tab: model.tab, connected: store.status == .connected)) { await model.refresh(using: store) }
        .sheet(item: $opened) { record in
            CollectorRecordSheet(record: record, tab: model.tab, model: model, board: board, store: store, onOpenIssue: onOpenIssue)
        }
        .sheet(item: $picking) { request in
            IssuePickerSheet(withSession: request.target == .session, board: board, store: store) { issue in
                picking = nil
                Task { await model.share(request.records, to: issue, session: request.target == .session, using: store) }
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
        .onChange(of: model.tab) { _, _ in revealed = nil }
        // A completion that failed while its record was not open is said here, as the page says its other failures: the plugin's own words, or the word for a change that did not go
        // through (the desktop's toast says the same). A record in full that is open says it itself, inside the sheet, because the sheet covers this toast.
        .onChange(of: model.completionProblems) { old, new in
            for (id, problem) in new where old[id] != problem && opened?.id != id {
                model.report?(DSBotToastMessage(text: problem.isEmpty ? "更改没能保存" : problem, kind: .error))
                model.clearProblem(id)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView()
                .tint(DSBotStyle.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityIdentifier("collector.loading")
        case .failed:
            VStack(spacing: 14) {
                Text("信息没能加载")
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                Button("重试") { Task { await model.refresh(using: store) } }
                    .font(.system(size: 15, weight: .medium))
                    .buttonStyle(DSBotGlassCapsuleButtonStyle())
                    .padding(.horizontal, 20)
                    .frame(height: 44)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            if model.items.isEmpty {
                Text("没有信息")
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
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
                SwipeActionRow(actions: swipeActions(for: record), isRevealed: revealed == record.id, onReveal: { revealed = $0 ? record.id : nil }) {
                    Button { tap(record) } label: {
                        CollectorRow(record: record, tab: model.tab, selecting: model.isSelecting, selected: model.selection.contains(record.id), completing: model.completing.contains(record.id))
                    }
                    .buttonStyle(DSBotRowButtonStyle())
                    // Press and hold: the row lifts as a card and the menu opens under it, as on a conversation.
                    .contextMenu {
                        rowMenu(for: record)
                    } preview: {
                        CollectorRowCard(record: record, tab: model.tab, completing: model.completing.contains(record.id))
                    }
                    .accessibilityIdentifier("collector.record.\(record.id)")
                }
                .listRowInsets(EdgeInsets(top: 0, leading: DSBotLayout.sidebarPadding, bottom: 2, trailing: DSBotLayout.sidebarPadding))
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
        return DSBotScrollEdges.usesSystemEffect ? 96 - GlassActionBar.reservedHeight : 96
    }

    /// A tap: puts away the swipe actions that are showing; chooses or leaves out the row while rows are being chosen; otherwise opens the record.
    private func tap(_ record: CollectorRecord) {
        if revealed != nil {
            revealed = nil
        } else if model.isSelecting {
            model.toggle(record.id)
        } else {
            opened = record
        }
    }

    private func mark(_ action: CollectorMark, _ record: CollectorRecord) {
        Task { await model.mark(action, [record], using: store) }
    }

    /// What a swipe to the left offers (owner, 2026-11-07: "删除，忽略，已处理三个情况放在左滑里面"), the same words as pressing and holding, no issue needed: on the
    /// to-do list Handled, Ignore and Delete; on Ignored, Restore, Handled and Delete; on Handled, Restore and Delete. A record that went to an issue is the issue's.
    /// Not while rows are being chosen.
    private func swipeActions(for record: CollectorRecord) -> [SwipeAction] {
        guard !model.isSelecting, model.tab == .todo || record.issue == nil else { return [] }
        let done = SwipeAction(id: "done", title: "已处理", symbol: "checkmark", color: DSBotStyle.ink) { mark(.done, record) }
        let ignore = SwipeAction(id: "ignore", title: "忽略", symbol: "eye.slash", color: SwipeAction.grey) { mark(.ignore, record) }
        let restore = SwipeAction(id: "restore", title: "恢复", symbol: "arrow.counterclockwise", color: DSBotStyle.blue) { mark(.restore, record) }
        let delete = SwipeAction(id: "delete", title: "删除", symbol: "trash", color: SwipeAction.red) { mark(.delete, record) }
        switch model.tab {
        case .todo: return [done, ignore, delete]
        case .ignored: return [restore, done, delete]
        default: return [restore, delete]
        }
    }

    /// What pressing and holding a record offers: the desktop's right-click menu (and the bar of a record in full), for that one record. Nothing while rows are
    /// being chosen. A record that went to an issue is the issue's: it can be opened, and that is all but filling in its context, which every record has, in every tab (it comes after
    /// what passes the record on and before the marks, as the desktop's menu has it).
    @ViewBuilder
    private func rowMenu(for record: CollectorRecord) -> some View {
        if !model.isSelecting {
            if let issue = record.issue {
                Button { onOpenIssue(issue.id) } label: { DSBotLabel("打开事项", icon: .open) }
                completeButton(for: record)
            } else {
                if model.tab != .done {
                    Button { picking = PickRequest(target: .issue, records: [record]) } label: { DSBotLabel("分享到事项", icon: .shareToIssue) }
                    Button { picking = PickRequest(target: .session, records: [record]) } label: { DSBotLabel("分享到会话", icon: .shareToSession) }
                    Button { makeIssue(from: record) } label: { DSBotLabel("新建事项", icon: .plus) }
                }
                completeButton(for: record)
                if model.tab == .todo {
                    Button { mark(.done, record) } label: { DSBotLabel("已处理", icon: .check) }
                    Button { mark(.ignore, record) } label: { DSBotLabel("忽略", icon: .hide) }
                } else {
                    Button { mark(.restore, record) } label: { DSBotLabel("恢复", icon: .restore) }
                    if model.tab == .ignored {
                        Button { mark(.done, record) } label: { DSBotLabel("已处理", icon: .check) }
                    }
                }
                Button(role: .destructive) { mark(.delete, record) } label: { DSBotLabel("删除", icon: .trash) }
            }
        }
    }

    /// Fill in the context of a record: its collector's session goes back to the source and reads what is around it. The row shows a spinner at once and the item cannot be chosen again
    /// until it is over; what comes of it is in the record when it is opened, and a failure is said by a toast (`model.completionProblems`).
    private func completeButton(for record: CollectorRecord) -> some View {
        Button { model.complete(record, using: store) } label: { DSBotLabel("补全上下文", icon: .completeContext) }
            .disabled(model.completing.contains(record.id))
    }

    /// A new issue that starts with the record's title and text (the record in full has them).
    private func makeIssue(from record: CollectorRecord) {
        Task {
            let loaded = await model.detail(of: record, using: store)
            making = NewIssueDraft(title: loaded?.draft.title ?? record.title, brief: loaded?.draft.brief ?? "", record: record.id)
        }
    }

    /// What can be done to all the chosen rows at once: share them, mark them handled, put them aside or bring them back, delete them.
    private var bulkBar: some View {
        var items: [GlassActionBar.Item] = [
            .init(id: "share", title: "分享到事项", glyph: .shareToIssue) { picking = PickRequest(target: .issue, records: model.chosen) },
            .init(id: "session", title: "分享到会话", glyph: .shareToSession) { picking = PickRequest(target: .session, records: model.chosen) },
            .init(id: "done", title: "已处理", glyph: .check) { Task { await model.mark(.done, model.chosen, using: store) } },
        ]
        items.append(model.tab == .ignored
            ? .init(id: "restore", title: "恢复", glyph: .restore) { Task { await model.mark(.restore, model.chosen, using: store) } }
            : .init(id: "ignore", title: "忽略", glyph: .hide) { Task { await model.mark(.ignore, model.chosen, using: store) } })
        items.append(.init(id: "delete", title: "删除", glyph: .trash) { Task { await model.mark(.delete, model.chosen, using: store) } })
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

/// One record: where it comes from as a small picture, its title, who it is from and which collector, and when (or the issue it went to).
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

    var body: some View {
        HStack(spacing: 12) {
            // The circle to choose the row is in front of the picture, which stays (owner, 2026-11-07, of the desktop's box: "移动到图标前面的位置，
            // 而不是覆盖图标"); a row that cannot be chosen keeps the place, so that the pictures line up.
            if selecting {
                ZStack {
                    if choosable {
                        Circle()
                            .strokeBorder(selected ? DSBotStyle.blue : Color(white: 0.77), lineWidth: 1.5)
                            .background(Circle().fill(selected ? DSBotStyle.blue : Color.clear))
                            .overlay {
                                if selected { DSBotIcon(.check, size: 13, strokeWidth: 3.2).foregroundStyle(.white) }
                            }
                    }
                }
                .frame(width: 22, height: 22)
                .transition(.move(edge: .leading).combined(with: .opacity))
            }
            ConnectorAvatar(icon: record.connectorIcon, name: record.connectorName)
            VStack(alignment: .leading, spacing: 2) {
                Text(record.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                Text(record.byLine)
                    .font(.system(size: 12))
                    .foregroundStyle(DSBotStyle.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 6) {
                if completing {
                    ProgressView()
                        .controlSize(.small)
                        .scaleEffect(0.7)
                        .tint(DSBotStyle.muted)
                        .frame(width: 14, height: 14)
                        .accessibilityHidden(true)
                }
                trailing
            }
        }
        .frame(minHeight: 58)
        .padding(.horizontal, 10)
        .background(selected ? DSBotStyle.selected : Color.clear, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var trailing: some View {
        if tab == .done, let issue = record.issue {
            Text(issue.reference)
                .font(.system(size: 10))
                .foregroundStyle(DSBotStyle.muted)
        } else if let at = record.at {
            Text(relativeTime(at))
                .font(.system(size: 10))
                .foregroundStyle(DSBotStyle.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
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

/// A glass bar of actions, each an icon over its word: the bar of chosen rows, and the bottom of a record in full.
struct GlassActionBar: View {
    static let barHeight: CGFloat = 46
    static let bottomGap: CGFloat = 2
    static var reservedHeight: CGFloat { barHeight + bottomGap }

    struct Item: Identifiable {
        let id: String
        let title: String
        let glyph: DSBotGlyph
        var isDisabled = false
        /// What it asks for is under way: a spinner stands in the place of its icon (so that it shows at once and is not pressed again) and it cannot be pressed.
        var isBusy = false
        let action: () -> Void

        init(id: String, title: String, glyph: DSBotGlyph, action: @escaping () -> Void) {
            self.id = id
            self.title = title
            self.glyph = glyph
            self.action = action
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
        ZStack(alignment: .bottom) {
            if !DSBotScrollEdges.usesSystemEffect {
                DSBotEdgeBlur(edge: .bottom, height: blurHeight, strength: 0.9)
                    .frame(height: blurHeight)
                    .ignoresSafeArea(edges: .bottom)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            bar
        }
    }

    /// A small glass pill of icons, no words (each keeps its word for VoiceOver).
    private var bar: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                Button(action: item.action) {
                    Group {
                        if item.isBusy {
                            ProgressView()
                                .controlSize(.small)
                                .tint(DSBotStyle.ink)
                                .frame(width: 21, height: 21)
                        } else {
                            DSBotIcon(item.glyph, size: 21)
                                .foregroundStyle(DSBotStyle.ink.opacity(item.isDisabled ? 0.35 : 1))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: Self.barHeight)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DSBotQuietPressStyle())
                .disabled(item.isDisabled || item.isBusy)
                .accessibilityLabel(item.title)
                .accessibilityIdentifier("collector.action.\(item.id)")
            }
        }
        .padding(.horizontal, 6)
        .dsbotGlass(in: Capsule())
        .padding(.horizontal, DSBotLayout.sidebarPadding + 10)
    }
}

/// A record in full, as a sheet over the list: what it says, what was around it, who it is from and when, and what can be done with it.
private struct CollectorRecordSheet: View {
    let record: CollectorRecord
    let tab: CollectorTab
    @ObservedObject var model: CollectorModel
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    let onOpenIssue: (Int) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var detail: (record: CollectorRecord, draft: CollectorDraft)?
    @State private var failed = false
    @State private var next: Next?

    private enum Next: Identifiable {
        case shareIssue, shareSession
        case newIssue(NewIssueDraft)

        var id: String {
            switch self {
            case .shareIssue: return "shareIssue"
            case .shareSession: return "shareSession"
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
        if let problem = model.completionProblems[record.id] { return problem.isEmpty ? "更改没能保存" : problem }
        guard let error = detail?.record.completeError, !error.isEmpty else { return nil }
        return error
    }

    private var meta: String {
        [shown.ref ?? "", shown.from ?? "", shown.connectorName, shown.at.map(relativeTime) ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    var body: some View {
        ZStack(alignment: .top) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(shown.title)
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(DSBotStyle.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(meta)
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.muted)
                        .padding(.top, 10)
                    if let issue = shown.issue {
                        Text("\(shown.verdict == "issue" ? "已新建 " : "已分享到 ")\(issue.reference)")
                            .font(.system(size: 13))
                            .foregroundStyle(DSBotStyle.chatSecondary)
                            .padding(.top, 6)
                    }
                    if failed {
                        Text("信息没能加载")
                            .font(.system(size: 15))
                            .foregroundStyle(DSBotStyle.muted)
                            .padding(.top, 20)
                    }
                    if let problem = completionProblem {
                        Text(problem)
                            .font(.system(size: 13))
                            .foregroundStyle(DSBotStyle.chatError)
                            .padding(.top, 20)
                            .accessibilityIdentifier("collector.record.completeError")
                    }
                    if let text = detail?.record.text, !text.isEmpty {
                        Text(text)
                            .font(.system(size: 16))
                            .foregroundStyle(DSBotStyle.ink)
                            .lineSpacing(4)
                            .textSelection(.enabled)
                            .padding(.top, 20)
                    }
                    if let context = detail?.record.context, !context.isEmpty {
                        Text("上下文")
                            .font(.system(size: 12))
                            .foregroundStyle(DSBotStyle.muted)
                            .padding(.top, 24)
                        ForEach(Array(context.enumerated()), id: \.offset) { _, entry in
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(spacing: 8) {
                                    Text(entry.from ?? "").font(.system(size: 13, weight: .semibold)).foregroundStyle(DSBotStyle.ink)
                                    if let at = entry.at { Text(relativeTime(at)).font(.system(size: 12)).foregroundStyle(DSBotStyle.muted) }
                                }
                                Text(entry.text ?? "").font(.system(size: 13)).foregroundStyle(DSBotStyle.chatSecondary)
                            }
                            .padding(.top, 12)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, 84)
                .padding(.bottom, DSBotScrollEdges.usesSystemEffect ? 100 - GlassActionBar.reservedHeight : 100)
            }
            header
        }
        .modifier(DSBotScrollEdgeBar(edge: .bottom) {
            GlassActionBar(items: barItems)
                .padding(.bottom, GlassActionBar.bottomGap)
        })
        .background(DSBotStyle.canvas.ignoresSafeArea())
        .presentationDetents([.large])
        .presentationDragIndicator(.hidden)
        .presentationCornerRadius(32)
        .presentationBackground(DSBotStyle.canvas)
        .task {
            if let loaded = await model.detail(of: record, using: store) {
                detail = loaded
                // One that was running when the record was opened is waited for as well.
                if loaded.record.completing == true { model.follow(record, using: store) }
            } else {
                failed = true
            }
        }
        // A completion has begun (what the computer said of the last one is out of date) or has come to its end: read the record again, for the lines it added.
        .onChange(of: isCompleting) { was, now in
            detail?.record.completeError = nil
            guard was, !now else { return }
            Task { if let loaded = await model.detail(of: record, using: store) { detail = loaded } }
        }
        .onDisappear { model.clearProblem(record.id) }
        .sheet(item: $next) { destination in
            switch destination {
            case .shareIssue, .shareSession:
                IssuePickerSheet(withSession: destination.id == "shareSession", board: board, store: store) { issue in
                    next = nil
                    let withSession = destination.id == "shareSession"
                    Task {
                        await model.share([record], to: issue, session: withSession, using: store)
                        dismiss()
                    }
                }
            case let .newIssue(draft):
                NewIssueSheet(board: board, store: store, title: draft.title, brief: draft.brief, record: draft.record) {
                    Task {
                        await model.refresh(using: store)
                        await model.refreshCount(using: store)
                    }
                    dismiss()
                }
            }
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Button { dismiss() } label: {
                DSBotIcon(.close, size: 20)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(DSBotGlassButtonStyle())
            .accessibilityLabel("关闭")
            .accessibilityIdentifier("collector.record.close")
            Spacer(minLength: 0)
            if let url = shown.url.flatMap(URL.init(string:)), ["http", "https"].contains(url.scheme?.lowercased()) {
                Button { openURL(url) } label: {
                    DSBotIcon(.openLink, size: 20)
                        .foregroundStyle(DSBotStyle.ink)
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(DSBotGlassButtonStyle())
                .accessibilityLabel("打开来源")
                .accessibilityIdentifier("collector.record.source")
            }
            if !moreActions.isEmpty {
                Menu {
                    Button { completeContext() } label: { DSBotLabel("补全上下文", icon: .completeContext) }
                        .disabled(isCompleting)
                    ForEach(moreActions, id: \.title) { item in
                        Button(role: item.glyph == .trash ? .destructive : nil) {
                            Task {
                                await model.mark(item.mark, [record], using: store)
                                dismiss()
                            }
                        } label: {
                            DSBotLabel(item.title, icon: item.glyph)
                        }
                    }
                } label: {
                    DSBotIcon(.options, size: 22)
                        .foregroundStyle(DSBotStyle.ink)
                        .frame(width: 44, height: 44)
                        .dsbotGlass(in: Circle(), interactive: true)
                        .contentShape(Circle())
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .menuIndicator(.hidden)
                .accessibilityLabel("更多")
                .accessibilityIdentifier("collector.record.more")
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
    }

    private struct MoreAction {
        let title: String
        let glyph: DSBotGlyph
        let mark: CollectorMark
    }

    /// What is left after the bar's: put aside or handled, and delete (not for a record an issue holds), with filling in the context first.
    private var moreActions: [MoreAction] {
        guard record.issue == nil else { return [] }
        switch tab {
        case .todo: return [MoreAction(title: "忽略", glyph: .hide, mark: .ignore), MoreAction(title: "删除", glyph: .trash, mark: .delete)]
        case .ignored: return [MoreAction(title: "已处理", glyph: .check, mark: .done), MoreAction(title: "删除", glyph: .trash, mark: .delete)]
        case .done: return [MoreAction(title: "删除", glyph: .trash, mark: .delete)]
        }
    }

    /// Fill in the context of the record: a spinner stands in the button's place while it runs, and the sheet stays open (the new lines come into it).
    private func completeContext() {
        guard !isCompleting else { return }
        model.complete(record, using: store)
    }

    /// What can be done with the record, left to right: what passes it on, then filling in its context (every record, in every tab; between the two, as the desktop's menu has it), then
    /// the mark that is done with it, which stays last.
    private var barItems: [GlassActionBar.Item] {
        func mark(_ id: String, _ title: String, _ glyph: DSBotGlyph, _ action: CollectorMark) -> GlassActionBar.Item {
            .init(id: id, title: title, glyph: glyph) {
                Task {
                    await model.mark(action, [record], using: store)
                    dismiss()
                }
            }
        }
        let complete = GlassActionBar.Item(id: "complete", title: "补全上下文", glyph: .completeContext) { completeContext() }.busy(isCompleting)
        if tab == .done {
            if let issue = record.issue {
                return [.init(id: "issue", title: "打开事项", glyph: .open) {
                    dismiss()
                    onOpenIssue(issue.id)
                }, complete]
            }
            return [complete, mark("restore", "恢复", .restore, .restore)]
        }
        let draft = NewIssueDraft(title: detail?.draft.title ?? record.title, brief: detail?.draft.brief ?? "", record: record.id)
        return [
            .init(id: "share", title: "分享到事项", glyph: .shareToIssue) { next = .shareIssue },
            .init(id: "session", title: "分享到会话", glyph: .shareToSession) { next = .shareSession },
            .init(id: "new", title: "新建事项", glyph: .plus) { next = .newIssue(draft) },
            complete,
            tab == .ignored ? mark("restore", "恢复", .restore, .restore) : mark("done", "已处理", .check, .done),
        ]
    }
}

/// The open issues, the one touched last first, to share a record to: a box finds one by its number or its words.
struct IssuePickerSheet: View {
    let withSession: Bool
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    let onPick: (BoardIssue) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var issues: [BoardIssue]?
    @State private var failed = false
    @State private var query = ""

    private var shown: [BoardIssue] {
        let words = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let issues else { return [] }
        return words.isEmpty ? issues : issues.filter { $0.title.localizedCaseInsensitiveContains(words) || $0.reference.localizedCaseInsensitiveContains(words) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let issues {
                    if shown.isEmpty {
                        Text(issues.isEmpty ? "没有事项" : "没有找到事项")
                            .font(.system(size: 15))
                            .foregroundStyle(DSBotStyle.muted)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        List(shown) { issue in
                            Button { onPick(issue) } label: {
                                HStack(spacing: 10) {
                                    Text(issue.reference)
                                        .font(.system(size: 12))
                                        .foregroundStyle(DSBotStyle.muted)
                                        .lineLimit(1)
                                        .frame(minWidth: 56, alignment: .leading)
                                        .fixedSize(horizontal: true, vertical: false)
                                    Text(issue.title)
                                        .font(.system(size: 15))
                                        .foregroundStyle(DSBotStyle.ink)
                                        .lineLimit(1)
                                }
                                .frame(minHeight: 40)
                            }
                            .listRowBackground(Color.clear)
                            .accessibilityIdentifier("picker.issue.\(issue.id)")
                        }
                        .listStyle(.plain)
                    }
                } else if failed {
                    Text("事项没能加载")
                        .font(.system(size: 15))
                        .foregroundStyle(DSBotStyle.muted)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ProgressView().tint(DSBotStyle.muted).frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .background(DSBotStyle.canvas)
            .navigationTitle(withSession ? "分享到会话" : "分享到事项")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索事项…")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .accessibilityIdentifier("picker.cancel")
                }
            }
        }
        .presentationDetents([.large])
        .task {
            if let found = await board.openIssues(withSession: withSession, using: store) { issues = found } else { failed = true }
        }
    }
}
