import SwiftUI

/// The colours the search page has of its own: Lark's light grey behind the history and 常用 (the drawing's #F3F4F6), the line magnifier of an empty page.
private enum SearchStyle {
    static let page = Color(red: 0xF3 / 255, green: 0xF4 / 255, blue: 0xF6 / 255)
    static let emptyMark = Color(red: 0xC9 / 255, green: 0xCB / 255, blue: 0xD0 / 255)
    static let clearMark = Color(red: 0xC4 / 255, green: 0xC6 / 255, blue: 0xCB / 255)
    /// How many rows a range shows in the page of all three before 更多.
    static let groupRows = 3
}

/// The search page (owner, 2026-11-27: Lark's search; drawn in `.local/designs/phone-search-2026-11-27/`): a field with 取消, the three ranges as pills, and under them the history with 常用,
/// the results of the three ranges in groups, or one range alone with its filters in the same row. Each range's rows are the rows of its own page.
struct SearchView: View {
    @ObservedObject var model: SearchModel
    @ObservedObject var board: BoardModel
    @ObservedObject var collector: CollectorModel
    @ObservedObject var tasks: TasksModel
    @ObservedObject var store: DuduStore
    let onClose: () -> Void
    let onOpenConversation: (BoardConversation) -> Void
    /// A record that went to an issue, or a task, opens a conversation: the page is left first.
    let onOpenIssue: (Int) -> Void
    let onOpenSession: (String) -> Void

    @FocusState private var isFocused: Bool
    @State private var openedRecord: CollectorRecord?
    @State private var openedTask: ScheduledTask?
    @State private var filtering: SearchFilterField?
    @State private var opened: [String: Double] = [:]

    private var boardRows: [BoardConversation] { board.conversationsByTab[.all] ?? [] }

    var body: some View {
        VStack(spacing: 0) {
            searchBar
            pills
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.white.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("search.page")
        .sheet(item: $filtering) { field in
            SearchFilterSheet(model: model, field: field, boardRows: boardRows)
        }
        .sheet(item: $openedRecord, onDismiss: refreshAfterSheet) { record in
            CollectorRecordSheet(
                record: record, tab: record.done == true || record.issue != nil ? .done : .todo, model: collector, board: board, store: store, onOpenIssue: onOpenIssue
            )
        }
        .sheet(item: $openedTask, onDismiss: refreshAfterSheet) { task in
            TaskSheet(initial: task, model: tasks, store: store, onOpenSession: onOpenSession)
        }
        .task {
            model.reloadHistory()
            opened = SearchMemory.shared.opened(for: store.activeComputer?.id)
            if model.query.isEmpty { isFocused = true }
        }
        .task(id: model.wantedRequest(computerID: store.activeComputer?.id, revision: store.connectionRevision)) {
            await model.load(using: store)
        }
    }

    private func close() {
        isFocused = false
        onClose()
    }

    /// A mark or a change made in a sheet changes what the rows say: ask again.
    private func refreshAfterSheet() {
        if model.wantedRequest(computerID: store.activeComputer?.id, revision: store.connectionRevision) != nil { model.retry() }
    }

    // MARK: Field and pills

    private var searchBar: some View {
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                DuduIcon(.search, size: 18)
                    .foregroundStyle(DuduStyle.muted)
                    .accessibilityHidden(true)
                TextField("", text: $model.query, prompt: Text(L10n.text("搜索")).foregroundStyle(DuduStyle.muted))
                    .font(.system(size: 16))
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .focused($isFocused)
                    .submitLabel(.search)
                    .onSubmit { model.submit(); isFocused = false }
                    .accessibilityLabel(L10n.text("搜索"))
                    .accessibilityIdentifier("search.query")
                if !model.query.isEmpty {
                    Button {
                        model.query = ""
                        isFocused = true
                    } label: {
                        ZStack {
                            Circle().fill(SearchStyle.clearMark)
                            DuduIcon(.close, size: 11, strokeWidth: 2.4).foregroundStyle(.white)
                        }
                        .frame(width: 20, height: 20)
                        .frame(width: 36, height: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.text("清除搜索"))
                    .accessibilityIdentifier("search.clear")
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, model.query.isEmpty ? 14 : 0)
            .frame(height: 44)
            .background(DuduStyle.sheet, in: Capsule())
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("search.field")

            Button(action: close) {
                Text(L10n.text("取消"))
                    .font(.system(size: 17))
                    .foregroundStyle(DuduStyle.blue)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(DuduQuietPressStyle())
            .accessibilityIdentifier("search.cancel")
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    private var pills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                if let scope = model.scope {
                    rangePill(scope, picked: true)
                    ForEach(SearchFilterField.fields(for: scope)) { filterPill($0) }
                } else {
                    ForEach(SearchScope.allCases) { rangePill($0, picked: false) }
                }
            }
            .padding(.horizontal, 16)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: 36)
        .padding(.top, 16)
        .padding(.bottom, 6)
    }

    private func rangePill(_ scope: SearchScope, picked: Bool) -> some View {
        Button {
            model.select(picked ? nil : scope)
        } label: {
            HStack(spacing: 6) {
                Text(scope.title).font(.system(size: 15))
                if picked { DuduIcon(.close, size: 14, strokeWidth: 2.2).accessibilityHidden(true) }
            }
            .foregroundStyle(picked ? DuduStyle.blue : DuduStyle.ink)
            .padding(.leading, picked ? 14 : 16)
            .padding(.trailing, picked ? 10 : 16)
            .frame(height: 36)
            .background(picked ? DuduStyle.blue.opacity(0.12) : DuduStyle.sheet, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(DuduQuietPressStyle())
        .accessibilityAddTraits(picked ? .isSelected : [])
        .accessibilityIdentifier("search.range.\(scope.rawValue)")
    }

    private func filterPill(_ field: SearchFilterField) -> some View {
        let chosen = !model.filters.chosen(field).isEmpty
        // A choice the computer has not told yet (the collectors' names, the tasks' agents) waits, disabled, in its place.
        let waiting = model.choices(for: field, boardRows: boardRows).isEmpty && !chosen
        return Button {
            isFocused = false
            filtering = field
        } label: {
            HStack(spacing: 6) {
                Text(model.pillTitle(for: field, boardRows: boardRows)).font(.system(size: 15)).lineLimit(1)
                DuduIcon(.down, size: 14, strokeWidth: 2.2).foregroundStyle(chosen ? DuduStyle.blue : DuduStyle.muted).accessibilityHidden(true)
            }
            .foregroundStyle(chosen ? DuduStyle.blue : DuduStyle.ink)
            .padding(.leading, 14)
            .padding(.trailing, 10)
            .frame(height: 36)
            .background(chosen ? DuduStyle.blue.opacity(0.12) : DuduStyle.sheet, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(DuduQuietPressStyle())
        .disabled(waiting)
        .opacity(waiting ? 0.5 : 1)
        .accessibilityIdentifier("search.filter.\(field.rawValue)")
    }

    // MARK: Body

    @ViewBuilder private var content: some View {
        if model.showsHome {
            home
        } else if model.showsHint, let scope = model.scope {
            emptyState(scope.hint)
        } else {
            results
        }
    }

    private func emptyState(_ text: String) -> some View {
        VStack(spacing: 14) {
            DuduIcon(.search, size: 44, strokeWidth: 1.3)
                .foregroundStyle(SearchStyle.emptyMark)
                .accessibilityHidden(true)
            Text(text)
                .font(.system(size: 15))
                .foregroundStyle(DuduStyle.muted)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.top, 136)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("search.empty")
    }

    // MARK: History and 常用

    private var home: some View {
        let frequent = FrequentConversations.ordered(boardRows, opened: opened).prefix(FrequentConversations.limit)
        return ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if !model.history.words.isEmpty { historySection }
                if !frequent.isEmpty { frequentCard(Array(frequent)) }
            }
            .padding(.top, 14)
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(SearchStyle.page.ignoresSafeArea(edges: .bottom))
    }

    private var historySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(L10n.text("搜索历史"))
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 0)
                Button { model.clearHistory() } label: {
                    DuduIcon(.trash, size: 20)
                        .foregroundStyle(DuduStyle.muted)
                        .frame(width: 44, height: 30, alignment: .trailing)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DuduQuietPressStyle())
                .accessibilityLabel(L10n.text("清除搜索"))
                .accessibilityIdentifier("search.history.clear")
            }
            .frame(height: 30)
            SearchFlowLayout(horizontalSpacing: 8, verticalSpacing: 10) {
                ForEach(model.history.words, id: \.self) { word in
                    Button {
                        model.query = word
                        model.submit()
                        isFocused = false
                    } label: {
                        Text(word)
                            .font(.system(size: 15))
                            .foregroundStyle(DuduStyle.ink)
                            .lineLimit(1)
                            .padding(.horizontal, 13)
                            .frame(height: 32, alignment: .center)
                            .frame(maxWidth: 320)
                            .background(.white, in: Capsule())
                            .contentShape(Capsule())
                    }
                    .buttonStyle(DuduQuietPressStyle())
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private func frequentCard(_ rows: [BoardConversation]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(L10n.text("常用"))
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(DuduStyle.ink)
                .frame(height: 28, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                ForEach(rows) { entry in
                    Button { onOpenConversation(entry) } label: {
                        HStack(spacing: 12) {
                            BoardConversationAvatar(entry: entry, size: BoardHomeLayout.avatarSize)
                            Text(entry.isAssistant ? L10n.text("嘟嘟") : entry.title)
                                .font(.system(size: 17))
                                .foregroundStyle(DuduStyle.ink)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .frame(height: 62)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("search.frequent.\(entry.id)")
                }
            }
            .padding(.top, 4)
        }
        .padding(.top, 14)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white, in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, 8)
    }

    // MARK: Results

    @ViewBuilder private var results: some View {
        if let failure = model.failure {
            failureRow(failure)
        } else {
            switch model.scope {
            case nil: groups
            case .sessions: sessionList
            case .inbox: recordList
            case .tasks: taskList
            }
        }
    }

    private func failureRow(_ text: String) -> some View {
        HStack(spacing: 12) {
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(DuduStyle.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button { model.retry(); isFocused = false } label: {
                DuduIcon(.reconnect, size: 16)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(DuduQuietPressStyle())
            .accessibilityLabel(L10n.text("重试"))
            .accessibilityIdentifier("search.retry")
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .frame(maxHeight: .infinity, alignment: .top)
    }

    /// No rows: either the answer to these words is on its way (a spinner under the pills) or it found nothing (the empty line). Never a blank page.
    @ViewBuilder private func noRows(_ empty: Bool) -> some View {
        if empty {
            if model.isAwaiting(model.wantedRequest(computerID: store.activeComputer?.id, revision: store.connectionRevision)) {
                ProgressView().tint(DuduStyle.muted).frame(maxWidth: .infinity).padding(24)
            } else {
                emptyState(L10n.text("没有匹配的内容"))
            }
        }
    }

    private var groups: some View {
        let sessions = model.answer?.sessions.flatMap { $0.failed == true ? nil : $0 } ?? .empty
        let records = model.answer?.inbox.flatMap { $0.failed == true ? nil : $0 } ?? .empty
        let taskGroup = model.answer?.tasks.flatMap { $0.failed == true ? nil : $0 } ?? .empty
        let none = sessions.items.isEmpty && records.items.isEmpty && taskGroup.items.isEmpty
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if !sessions.items.isEmpty {
                    groupHeader(.sessions, total: sessions.total)
                    ForEach(sessions.items.prefix(SearchStyle.groupRows)) { conversationRow($0) }
                }
                if !records.items.isEmpty {
                    groupHeader(.inbox, total: records.total)
                    ForEach(records.items.prefix(SearchStyle.groupRows)) { recordRow($0) }
                }
                if !taskGroup.items.isEmpty {
                    groupHeader(.tasks, total: taskGroup.total)
                    ForEach(taskGroup.items.prefix(SearchStyle.groupRows)) { taskRow($0) }
                }
                noRows(none)
            }
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func groupHeader(_ scope: SearchScope, total: Int) -> some View {
        HStack(spacing: 0) {
            Text(scope.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(DuduStyle.ink)
            Text(total.formatted()).font(.system(size: 14)).foregroundStyle(DuduStyle.muted).padding(.leading, 6)
            Spacer(minLength: 8)
            if total > SearchStyle.groupRows {
                Button { model.select(scope) } label: {
                    HStack(spacing: 2) {
                        Text(L10n.text("更多")).font(.system(size: 14))
                        DuduIcon(.right, size: 15, strokeWidth: 2).accessibilityHidden(true)
                    }
                    .foregroundStyle(DuduStyle.muted)
                    .frame(minHeight: 34)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DuduQuietPressStyle())
                .accessibilityIdentifier("search.more.\(scope.rawValue)")
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 34)
        .padding(.top, 6)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var sessionList: some View {
        let hits = model.conversationHits(boardRows: boardRows)
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(hits) { conversationRow($0) }
                noRows(hits.isEmpty)
            }
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var recordList: some View {
        let hits = model.recordHits()
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(hits) { recordRow($0) }
                noRows(hits.isEmpty)
            }
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var taskList: some View {
        let rows = model.taskRows()
        return ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(rows) { taskRow($0) }
                noRows(rows.isEmpty)
            }
            .padding(.bottom, 24)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    // MARK: Rows

    private func conversationRow(_ hit: SearchConversationHit) -> some View {
        SearchConversationRow(hit: hit, terms: model.terms) {
            model.submit()
            isFocused = false
            onOpenConversation(hit.conversation)
        }
        .accessibilityIdentifier("search.result.\(hit.id)")
    }

    private func recordRow(_ hit: SearchRecordHit) -> some View {
        Button {
            model.submit()
            isFocused = false
            openedRecord = hit.record
        } label: {
            CollectorRow(
                record: hit.record, tab: hit.record.done == true || hit.record.issue != nil ? .done : .todo, selecting: false, selected: false,
                terms: model.terms, snippet: hit.snippet
            )
            .padding(.horizontal, 6)
        }
        .buttonStyle(DuduRowButtonStyle())
        .accessibilityIdentifier("search.result.record.\(hit.id)")
    }

    private func taskRow(_ task: ScheduledTask) -> some View {
        TaskSummaryRow(
            agent: task.taskAgent, title: task.title, line: task.line, statusText: task.statusText, isOn: task.isActive,
            onOpen: {
                model.submit()
                isFocused = false
                openedTask = task
            },
            terms: model.terms
        )
        .accessibilityIdentifier("search.result.task.\(task.id)")
    }
}

/// A conversation as the search lists it: the board's row (the tile, the title and its time, the preview and the agent), with the found words marked and, when the conversation's text is what
/// matched, a line of that text in two lines in place of the preview.
struct SearchConversationRow: View {
    let hit: SearchConversationHit
    let terms: [String]
    let onOpen: () -> Void

    private var entry: BoardConversation { hit.conversation }
    private var snippet: String? { hit.snippet.flatMap { $0.isEmpty ? nil : $0 } }

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: snippet == nil ? .center : .top, spacing: BoardHomeLayout.avatarTextSpacing) {
                BoardConversationAvatar(entry: entry, size: BoardHomeLayout.avatarSize)
                VStack(alignment: .leading, spacing: snippet == nil ? BoardHomeLayout.lineSpacing : 3) {
                    HStack(spacing: 8) {
                        SearchText.marked(entry.isAssistant ? L10n.text("嘟嘟") : entry.title, terms: terms)
                            .font(.system(size: 17))
                            .foregroundStyle(DuduStyle.ink)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if entry.receivedAt > 0 {
                            Text(entry.receivedLabel)
                                .font(.system(size: 14))
                                .foregroundStyle(DuduStyle.muted)
                                .fixedSize()
                        }
                    }
                    .frame(height: BoardHomeLayout.titleLineHeight)
                    HStack(alignment: .bottom, spacing: 8) {
                        Group {
                            if let snippet { SearchText.marked(snippet, terms: terms) } else { Text(entry.preview) }
                        }
                        .font(.system(size: 14))
                        .foregroundStyle(DuduStyle.muted)
                        .lineLimit(snippet == nil ? 1 : 2)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        BoardAgentMark(entry: entry)
                    }
                    .frame(minHeight: BoardHomeLayout.previewLineHeight)
                }
            }
            .padding(.horizontal, BoardHomeLayout.horizontalInset)
            .padding(.vertical, snippet == nil ? 0 : 9)
            .frame(minHeight: BoardHomeLayout.rowHeight)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(DuduRowButtonStyle())
    }
}

/// The half sheet of one filter pill: the board's own sheet (its card, its rows with the box and the mark, 重置 at the left), for the one field.
struct SearchFilterSheet: View {
    @ObservedObject var model: SearchModel
    let field: SearchFilterField
    let boardRows: [BoardConversation]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        let choices = model.choices(for: field, boardRows: boardRows)
        let chosen = model.filters.chosen(field)
        let height = min(max(188, CGFloat(choices.count) * FilterOptionRow<EmptyView>.height + 124), max(188, DuduLayout.screenHeight * 0.79))
        QuickSheetPage(
            title: field.title,
            onClose: { dismiss() },
            centersTitle: true,
            leading: QuickSheetLeading(title: L10n.text("重置"), isEnabled: !chosen.isEmpty) { model.reset(field) },
            horizontalInset: DuduLayout.sidebarPadding,
            actions: {},
            filters: {},
            content: {
                FilterCard {
                    ForEach(choices) { choice in
                        FilterOptionRow(
                            title: choice.title, count: choice.count, checked: chosen.contains(choice.key),
                            action: { model.toggle(choice.key, in: field) }
                        ) { mark(choice) }
                            .overlay(alignment: .top) {
                                if choice.id != choices.first?.id { QuickTodoSeparator(leading: 15).allowsHitTesting(false) }
                            }
                    }
                }
            },
            footer: {}
        )
        .tint(DuduStyle.ink)
        .presentationDetents([.height(height), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(31)
        .presentationBackground(DuduStyle.sheet)
    }

    @ViewBuilder private func mark(_ choice: SearchChoice) -> some View {
        switch choice.mark {
        case .none: EmptyView()
        case let .agent(agent): AgentLogo(agent: agent, size: 16).accessibilityHidden(true)
        case let .taskAgent(agent): TaskAgentLogo(agent: agent, size: 16).accessibilityHidden(true)
        }
    }
}

/// Words laid out in lines that wrap (the history).
struct SearchFlowLayout: Layout {
    var horizontalSpacing: CGFloat
    var verticalSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width { y += line + verticalSpacing; x = 0; line = 0 }
            x += size.width
            widest = max(widest, x)
            x += horizontalSpacing
            line = max(line, size.height)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX { y += line + verticalSpacing; x = bounds.minX; line = 0 }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + horizontalSpacing
            line = max(line, size.height)
        }
    }
}
