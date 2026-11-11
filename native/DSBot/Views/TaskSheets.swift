import SwiftUI

// A task in full, and the editor that makes a new one or changes it (owner, 2026-11-10: "手机上可以新建和编辑"). The words are the desktop's (`ui/strings.js`, `tasks`); the look is the app's own: the Collector's
// sheet with its glass bar for the task, and the new-issue sheet's title, text and context pills for the editor, with the settings' white cards for the rule.

/// One block of the task in full: a small title and a white card.
private struct TaskSection<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(DSBotStyle.chatSecondary)
                .padding(.leading, 16)
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
    }
}

/// Rows of a name on the left and its value on the right, in one card.
private struct TaskValueRows: View {
    let rows: [(String, String)]

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 { Divider().padding(.leading, 16) }
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(row.0)
                        .font(.system(size: 15))
                        .foregroundStyle(DSBotStyle.ink)
                    Spacer(minLength: 12)
                    Text(row.1)
                        .font(.system(size: 15))
                        .foregroundStyle(DSBotStyle.muted)
                        .multilineTextAlignment(.trailing)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(minHeight: 52)
            }
        }
    }
}

// MARK: - The task in full

struct TaskSheet: View {
    let initial: ScheduledTask
    @ObservedObject var model: TasksModel
    @ObservedObject var store: DSBotStore
    let onOpenSession: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var runs: [TaskRun] = []
    @State private var nextCursor: Int?
    @State private var historyFailed = false
    @State private var loadingMore = false
    @State private var editing = false
    @State private var confirmingDelete = false

    private static let on = Color(red: 0x17 / 255, green: 0x7a / 255, blue: 0x3c / 255)

    /// What the page knows now (a pause, an edit and a run change it); the one that was tapped until the page has read again.
    private var task: ScheduledTask { model.task(id: initial.id) ?? initial }
    private var linkedSession: SessionSummary? { task.linkedSessionId.flatMap { id in store.sessions.first { $0.id == id } } }

    var body: some View {
        ZStack(alignment: .top) {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    titleBlock
                    TaskSection(title: "规则") {
                        TaskValueRows(rows: ruleRows)
                    }
                    TaskSection(title: "自动化任务内容") {
                        Text(task.prompt)
                            .font(.system(size: 15))
                            .foregroundStyle(DSBotStyle.ink)
                            .lineSpacing(4)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(16)
                    }
                    if !runs.isEmpty || historyFailed {
                        TaskSection(title: "任务运行记录") { history }
                    }
                    if let session = linkedSession {
                        TaskSection(title: "关联会话") {
                            Button {
                                dismiss()
                                onOpenSession(session.id)
                            } label: {
                                HStack(spacing: 12) {
                                    Text(session.title)
                                        .font(.system(size: 15))
                                        .foregroundStyle(DSBotStyle.ink)
                                        .lineLimit(1)
                                    Spacer(minLength: 8)
                                    DSBotIcon(.right, size: 16).foregroundStyle(DSBotStyle.muted)
                                }
                                .padding(.horizontal, 16)
                                .frame(minHeight: 52)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(DSBotRowButtonStyle())
                            .accessibilityIdentifier("task.session")
                        }
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 84)
                .padding(.bottom, DSBotScrollEdges.usesSystemEffect ? 100 - GlassActionBar.reservedHeight : 100)
            }
            header
        }
        .modifier(DSBotScrollEdgeBar(edge: .bottom) {
            GlassActionBar(items: barItems)
                .padding(.bottom, GlassActionBar.bottomGap)
        })
        .background(DSBotStyle.settingsBackground.ignoresSafeArea())
        .presentationDetents([.large])
        .presentationDragIndicator(.hidden)
        .presentationCornerRadius(32)
        .presentationBackground(DSBotStyle.settingsBackground)
        .accessibilityIdentifier("task.sheet")
        // A run, a pause or an edit is a change of the task: its deliveries are read again.
        .task(id: "\(task.lastRun?.id ?? "")/\(task.revision)") { await loadRuns() }
        .sheet(isPresented: $editing) {
            TaskEditorSheet(model: model, store: store, task: task)
        }
        .confirmationDialog("删除任务", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("删除任务", role: .destructive) {
                Task { if await model.act(.delete, task, using: store) { dismiss() } }
            }
        } message: {
            Text(task.title)
        }
    }

    private var titleBlock: some View {
        HStack(alignment: .center, spacing: 12) {
            if let agent = task.taskAgent {
                TaskAgentLogo(agent: agent, size: 26)
            }
            Text(task.title)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(DSBotStyle.ink)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Text(task.statusText)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(task.isActive ? Self.on : DSBotStyle.muted)
                .padding(.horizontal, 10)
                .frame(height: 24)
                .background(task.isActive ? Self.on.opacity(0.10) : DSBotStyle.selected, in: Capsule())
        }
        .padding(.horizontal, 8)
    }

    /// The rule, as the desktop's rules tab lists it. A task of 嘟嘟 has no workspace, so it has no row for one.
    private var ruleRows: [(String, String)] {
        let next = task.isActive ? task.nextRunAt.map { TaskSchedule.stamp($0, timezone: task.schedule.timezone) } ?? "—" : "—"
        var rows = [
            ("运行时间", task.schedule.label),
            ("时区", task.schedule.timezone.map(TaskSchedule.timezoneLabel) ?? "—"),
            ("下次运行", next),
            ("执行位置", TaskTarget.name(task.target.mode)),
        ]
        if let project = task.project { rows.append(("关联工作区", project.name)) }
        rows.append(("供应商", task.taskAgent?.name ?? task.agent))
        rows.append(("模型", task.model ?? "默认模型"))
        return rows
    }

    private var history: some View {
        VStack(spacing: 0) {
            ForEach(Array(runs.enumerated()), id: \.element.id) { index, run in
                if index > 0 { Divider().padding(.leading, 52) }
                runRow(run)
            }
            if historyFailed {
                Text("任务没能加载")
                    .font(.system(size: 14))
                    .foregroundStyle(DSBotStyle.muted)
                    .frame(maxWidth: .infinity)
                    .padding(16)
            }
            if nextCursor != nil {
                Divider()
                Button {
                    Task { await loadMore() }
                } label: {
                    Group {
                        if loadingMore { ProgressView().tint(DSBotStyle.muted) } else { Text("加载更多") }
                    }
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DSBotRowButtonStyle())
                .disabled(loadingMore)
            }
        }
    }

    private func runRow(_ run: TaskRun) -> some View {
        let session = run.sessionId.flatMap { id in store.sessions.first { $0.id == id } }
        let mark: (String, Color) = {
            switch run.status {
            case "delivered": return ("checkmark.circle", Self.on)
            case "failed": return ("exclamationmark.circle", DSBotStyle.chatError)
            case "delivering": return ("clock", DSBotStyle.muted)
            default: return ("questionmark.circle", DSBotStyle.muted)
            }
        }()
        return Button {
            if let session {
                dismiss()
                onOpenSession(session.id)
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: mark.0)
                    .font(.system(size: 17))
                    .foregroundStyle(mark.1)
                    .frame(width: 24)
                Text(TaskSchedule.stamp(run.at, timezone: task.schedule.timezone))
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.ink)
                Spacer(minLength: 8)
                Text(run.statusText)
                    .font(.system(size: 14))
                    .foregroundStyle(DSBotStyle.muted)
                if session != nil { DSBotIcon(.right, size: 16).foregroundStyle(DSBotStyle.muted) }
            }
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .disabled(session == nil)
    }

    private func loadRuns() async {
        guard let page = await model.history(of: task, before: nil, using: store) else {
            if runs.isEmpty { historyFailed = true }
            return
        }
        historyFailed = false
        runs = page.runs
        nextCursor = page.nextCursor
    }

    private func loadMore() async {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let page = await model.history(of: task, before: cursor, using: store) else {
            historyFailed = true
            return
        }
        let known = Set(runs.map(\.id))
        runs += page.runs.filter { !known.contains($0.id) }
        nextCursor = page.nextCursor
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
            .accessibilityIdentifier("task.close")
            Spacer(minLength: 0)
            Button { editing = true } label: {
                DSBotIcon(.editLine, size: 20)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(DSBotGlassButtonStyle())
            .accessibilityLabel("编辑")
            .accessibilityIdentifier("task.edit")
        }
        .padding(.horizontal, 20)
        .padding(.top, 18)
    }

    /// What can be done with the task: pause or resume it (not one that is over), run it now, copy it, delete it.
    private var barItems: [GlassActionBar.Item] {
        var items: [GlassActionBar.Item] = []
        switch task.status {
        case "active": items.append(.init(id: "pause", title: "暂停任务", glyph: .pause) { Task { await model.act(.pause, task, using: store) } })
        case "paused": items.append(.init(id: "resume", title: "恢复任务", glyph: .play) { Task { await model.act(.resume, task, using: store) } })
        default: break
        }
        items.append(.init(id: "run", title: "立即执行", glyph: .zap) { Task { await model.act(.run, task, using: store) } })
        items.append(.init(id: "duplicate", title: "复制任务", glyph: .copy) {
            Task { if await model.act(.duplicate, task, using: store) { dismiss() } }
        })
        items.append(.init(id: "delete", title: "删除任务", glyph: .trash) { confirmingDelete = true })
        return model.busy.contains(task.id) ? items.map { $0.disabled() } : items
    }
}

// MARK: - The editor

private enum TaskPicker: Hashable {
    case provider, model, workspace, target, session, timezone
}

/// One thing to choose in a list: what it is called, a line under it, a logo, whether it can be chosen.
private struct TaskChoice: Identifiable {
    let id: String
    let title: String
    var subtitle: String?
    var agent: TaskAgent?
    var glyph: DSBotGlyph?
    var isDisabled = false
}

/// The app's settings card with choice rows (as the new-issue sheet's), lazy because the list of time zones is long, with a search when there is much to choose from.
private struct TaskChoicePage: View {
    let title: String
    let choices: [TaskChoice]
    let selected: String?
    var searchPrompt: String?
    var emptyText: String?
    let onSelect: (String) -> Void

    @State private var query = ""

    private var shown: [TaskChoice] {
        let words = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return words.isEmpty ? choices : choices.filter { "\($0.title) \($0.subtitle ?? "")".localizedCaseInsensitiveContains(words) }
    }

    var body: some View {
        if let searchPrompt {
            list.searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: searchPrompt)
        } else {
            list
        }
    }

    private var list: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(shown) { choice in
                    IssueChoiceRow(title: choice.title, subtitle: choice.subtitle, selected: choice.id == selected) {
                        if let agent = choice.agent {
                            TaskAgentLogo(agent: agent, size: 20)
                        } else if let glyph = choice.glyph {
                            DSBotIcon(glyph, size: 18, scalesStroke: true)
                        } else {
                            Color.clear
                        }
                    } action: { onSelect(choice.id) }
                    .disabled(choice.isDisabled)
                    .opacity(choice.isDisabled ? 0.45 : 1)
                }
                if shown.isEmpty, let emptyText {
                    Text(emptyText).font(.system(size: 14)).foregroundStyle(DSBotStyle.muted).padding(20)
                }
            }
            .frame(maxWidth: .infinity)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(DSBotStyle.canvas)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// New task, and edit task: the desktop's fields in the native sheet. A title and the text, the pills for who runs it and where (provider, model, workspace, where the run goes), and the rule in one card.
struct TaskEditorSheet: View {
    @ObservedObject var model: TasksModel
    @ObservedObject var store: DSBotStore
    /// The task to change; nil makes a new one.
    let task: ScheduledTask?

    @Environment(\.dismiss) private var dismiss
    @State private var draft: TaskDraft
    @State private var original: TaskDraft
    @State private var options: TaskOptions?
    @State private var optionsFailed = false
    @State private var sessions: [TaskSession]?
    @State private var sessionsFailed = false
    @State private var path: [TaskPicker] = []
    @State private var isSaving = false
    @State private var failure: String?
    @State private var confirmingDiscard = false
    @State private var computerID: String?
    @FocusState private var titleFocused: Bool

    init(model: TasksModel, store: DSBotStore, task: ScheduledTask?) {
        self.model = model
        self.store = store
        self.task = task
        let start = task.map(TaskDraft.init(task:)) ?? TaskDraft(options: nil)
        _draft = State(initialValue: start)
        _original = State(initialValue: start)
        _computerID = State(initialValue: store.activeComputer?.id)
    }

    private var sameComputer: Bool { computerID != nil && computerID == store.activeComputer?.id }
    private var isDirty: Bool { draft != original }
    private var provider: TaskProvider? { options?.providers.first { $0.id == draft.agent } }
    private var canSave: Bool {
        draft.isComplete && options != nil && provider?.available != false && !isSaving && sameComputer && store.status == .connected && (task == nil || isDirty)
    }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    TextField("自动化任务名称", text: $draft.title, axis: .vertical)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(DSBotStyle.chatInk)
                        .lineLimit(1...4)
                        .focused($titleFocused)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityIdentifier("taskeditor.title")
                    TextField("自动化任务内容", text: $draft.prompt, axis: .vertical)
                        .font(.system(size: 16))
                        .foregroundStyle(DSBotStyle.chatInk)
                        .lineLimit(4...10)
                        .padding(16)
                        .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityIdentifier("taskeditor.prompt")
                    if options != nil {
                        properties
                        timing
                    } else if optionsFailed {
                        HStack(spacing: 12) {
                            Text("任务没能加载").foregroundStyle(DSBotStyle.muted)
                            Button("重试") {
                                optionsFailed = false
                                Task { await loadOptions() }
                            }
                        }
                        .font(.system(size: 14))
                    } else {
                        ProgressView().tint(DSBotStyle.muted).frame(height: 44)
                    }
                    if let failure {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("更改没能保存")
                                .font(.system(size: 13))
                                .foregroundStyle(DSBotStyle.chatError)
                            if !failure.isEmpty {
                                Text(failure).font(.system(size: 12)).foregroundStyle(DSBotStyle.muted)
                            }
                        }
                        .accessibilityIdentifier("taskeditor.error")
                    }
                }
                .disabled(isSaving)
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(DSBotStyle.canvas)
            .navigationTitle(task == nil ? "新建任务" : "编辑")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") {
                        if isDirty { confirmingDiscard = true } else { dismiss() }
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier("taskeditor.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        save()
                    } label: {
                        if isSaving { ProgressView() } else { Text("保存") }
                    }
                    .disabled(!canSave)
                    .accessibilityIdentifier("taskeditor.save")
                }
            }
            .navigationDestination(for: TaskPicker.self) { picker in
                destination(picker)
            }
        }
        .presentationDetents([.large])
        .presentationCornerRadius(32)
        .interactiveDismissDisabled(isSaving || isDirty)
        .confirmationDialog("有未保存的修改", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("放弃", role: .destructive) { dismiss() }
            Button("保存修改") { save() }
                .disabled(!canSave)
        }
        .task { if task == nil { titleFocused = true } }
        #if DEBUG && targetEnvironment(simulator)
        // `-dsbot-review-task-save`: the review's stand-in for typing a name and a text and tapping 保存 on a new task.
        .task(id: options != nil) {
            guard options != nil, task == nil, ProcessInfo.processInfo.arguments.contains("-dsbot-review-task-save") else { return }
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            draft.title = "新的每日摘要"
            draft.prompt = "汇总今天的变更。"
            try? await Task.sleep(nanoseconds: 800_000_000)
            save()
        }
        #endif
        .task(id: "\(store.connectionRevision)/\(store.status)") { await loadOptions() }
        .onChange(of: store.activeComputer?.id) { _, id in
            if id != computerID { dismiss() }
        }
    }

    // MARK: Pills

    /// Who runs it and where: provider, model, workspace (not for 嘟嘟, which works in a folder of its own), where a run goes, and the conversation when it is a named one.
    private var properties: some View {
        IssueValueFlow(spacing: 6) {
            chip(provider?.name ?? TaskAgent(id: draft.agent)?.name ?? draft.agent, identifier: "provider", picker: .provider) {
                if let agent = TaskAgent(id: draft.agent) { TaskAgentLogo(agent: agent, size: 16) } else { DSBotIcon(.model, size: 16, scalesStroke: true) }
            }
            chip(draft.model ?? "默认模型", identifier: "model", picker: .model) {
                DSBotIcon(.model, size: 16, scalesStroke: true)
            }
            if !draft.isDudu {
                chip(draft.project?.name ?? "关联工作区", identifier: "workspace", picker: .workspace) {
                    DSBotIcon(.workspace, size: 16, scalesStroke: true)
                }
            }
            chip(TaskTarget.name(draft.target.mode), identifier: "target", picker: .target) {
                DSBotIcon(.message, size: 16, scalesStroke: true)
            }
            if draft.target.mode == "existing" {
                chip(sessionTitle ?? "关联会话", identifier: "session", picker: .session) {
                    DSBotIcon(.queue, size: 16, scalesStroke: true)
                }
            }
        }
        .disabled(store.status != .connected || !sameComputer)
    }

    private var sessionTitle: String? {
        guard let id = draft.target.sessionId, !id.isEmpty else { return nil }
        return sessions?.first { $0.id == id }?.title ?? store.sessions.first { $0.id == id }?.title
    }

    private func chip<Icon: View>(_ title: String, identifier: String, picker: TaskPicker, @ViewBuilder icon: @escaping () -> Icon) -> some View {
        Button { choose(picker) } label: {
            ContextChipLabel(title: title, maxTextWidth: 220, icon: icon)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(DSBotQuietPressStyle())
        .accessibilityLabel(title)
        .accessibilityIdentifier("taskeditor.\(identifier)")
    }

    private func choose(_ picker: TaskPicker) {
        titleFocused = false
        path.append(picker)
        if picker == .session { Task { await loadSessions() } }
    }

    // MARK: The rule

    /// The rule in one card: the kind, then what the kind needs (a time, a date, the days of the week, a day of the month, the minutes, an expression), and the time zone.
    private var timing: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("运行时间")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(DSBotStyle.chatSecondary)
                .padding(.leading, 4)
            VStack(spacing: 0) {
                kindRow
                if !["interval", "cron"].contains(draft.schedule.kind) {
                    Divider().padding(.leading, 16)
                    timeRow
                }
                if draft.schedule.kind == "once" {
                    Divider().padding(.leading, 16)
                    dateRow
                }
                if draft.schedule.kind == "monthly" {
                    Divider().padding(.leading, 16)
                    dayRow
                }
                if draft.schedule.kind == "weekly" {
                    Divider().padding(.leading, 16)
                    weekdaysRow
                }
                if draft.schedule.kind == "interval" {
                    Divider().padding(.leading, 16)
                    minutesRow
                }
                if draft.schedule.kind == "cron" {
                    Divider().padding(.leading, 16)
                    expressionRow
                }
                Divider().padding(.leading, 16)
                timezoneRow
            }
            .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .disabled(store.status != .connected || !sameComputer)
    }

    private func ruleRow<Trailing: View>(_ label: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(DSBotStyle.ink)
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 48)
    }

    private var kindRow: some View {
        ruleRow("规则") {
            Menu {
                Picker("规则", selection: Binding(
                    get: { draft.schedule.kind },
                    set: { kind in
                        if kind != draft.schedule.kind { draft.schedule = TaskSchedule.starting(kind, from: draft.schedule) }
                    }
                )) {
                    ForEach(TaskSchedule.kinds, id: \.self) { kind in
                        Text(TaskSchedule.kindName(kind)).tag(kind)
                    }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: 6) {
                    Text(TaskSchedule.kindName(draft.schedule.kind))
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold))
                }
                .font(.system(size: 15))
                .foregroundStyle(DSBotStyle.muted)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityIdentifier("taskeditor.kind")
        }
    }

    /// `HH:mm` as the clock face the date picker has: the wall time is kept as it is, whatever zone the phone is in.
    private var timeBinding: Binding<Date> {
        Binding(
            get: {
                let parts = (draft.schedule.time ?? "09:00").split(separator: ":").compactMap { Int($0) }
                return Calendar.current.date(bySettingHour: parts.first ?? 9, minute: parts.count > 1 ? parts[1] : 0, second: 0, of: Date()) ?? Date()
            },
            set: { date in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                draft.schedule.time = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
            }
        )
    }

    private var dateBinding: Binding<Date> {
        Binding(
            get: {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_CA")
                formatter.dateFormat = "yyyy-MM-dd"
                return draft.schedule.date.flatMap(formatter.date(from:)) ?? Date()
            },
            set: { date in
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_CA")
                formatter.dateFormat = "yyyy-MM-dd"
                draft.schedule.date = formatter.string(from: date)
            }
        )
    }

    private var timeRow: some View {
        ruleRow("运行时间") {
            DatePicker("运行时间", selection: timeBinding, displayedComponents: .hourAndMinute)
                .labelsHidden()
                .accessibilityIdentifier("taskeditor.time")
        }
    }

    private var dateRow: some View {
        ruleRow("仅一次") {
            DatePicker("仅一次", selection: dateBinding, displayedComponents: .date)
                .labelsHidden()
                .accessibilityIdentifier("taskeditor.date")
        }
    }

    private var dayRow: some View {
        ruleRow("每月") {
            Menu {
                Picker("每月", selection: Binding(get: { draft.schedule.day ?? 1 }, set: { draft.schedule.day = $0 })) {
                    ForEach(1...31, id: \.self) { Text("\($0)").tag($0) }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: 6) {
                    Text("\(draft.schedule.day ?? 1)")
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold))
                }
                .font(.system(size: 15))
                .foregroundStyle(DSBotStyle.muted)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .accessibilityIdentifier("taskeditor.day")
        }
    }

    private var weekdaysRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("每周")
                .font(.system(size: 15))
                .foregroundStyle(DSBotStyle.ink)
            HStack(spacing: 6) {
                ForEach(TaskSchedule.weekdayOrder, id: \.self) { day in
                    let on = draft.schedule.weekdays?.contains(day) == true
                    Button {
                        var days = Set(draft.schedule.weekdays ?? [])
                        if on { days.remove(day) } else { days.insert(day) }
                        draft.schedule.weekdays = days.sorted()
                    } label: {
                        Text(TaskSchedule.weekdayName(day))
                            .font(.system(size: 13, weight: on ? .medium : .regular))
                            .foregroundStyle(on ? DSBotStyle.ink : DSBotStyle.muted)
                            .frame(maxWidth: .infinity)
                            .frame(height: 36)
                            .background(on ? DSBotStyle.selected : Color.clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(DSBotStyle.line, lineWidth: on ? 0 : 1))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(DSBotQuietPressStyle())
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityIdentifier("taskeditor.weekday.\(day)")
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var minutesRow: some View {
        ruleRow("间隔") {
            HStack(spacing: 6) {
                TextField("", value: Binding(
                    get: { Int(draft.schedule.minutes ?? 60) },
                    set: { draft.schedule.minutes = Double(max($0, 0)) }
                ), format: .number)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .frame(width: 80)
                    .accessibilityIdentifier("taskeditor.minutes")
                Text("分").foregroundStyle(DSBotStyle.muted)
            }
            .font(.system(size: 15))
        }
    }

    private var expressionRow: some View {
        ruleRow("Cron") {
            TextField("", text: Binding(get: { draft.schedule.expression ?? "" }, set: { draft.schedule.expression = $0 }))
                .font(.system(size: 15, design: .monospaced))
                .multilineTextAlignment(.trailing)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("taskeditor.cron")
        }
    }

    private var timezoneRow: some View {
        Button { choose(.timezone) } label: {
            ruleRow("时区") {
                HStack(spacing: 6) {
                    Text(draft.schedule.timezone.map(TaskSchedule.timezoneLabel) ?? "")
                        .lineLimit(1)
                        .truncationMode(.middle)
                    DSBotIcon(.right, size: 14)
                }
                .font(.system(size: 15))
                .foregroundStyle(DSBotStyle.muted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .accessibilityIdentifier("taskeditor.timezone")
    }

    // MARK: Pickers

    @ViewBuilder
    private func destination(_ picker: TaskPicker) -> some View {
        switch picker {
        case .provider:
            TaskChoicePage(
                title: "供应商",
                choices: (options?.providers ?? []).map { TaskChoice(id: $0.id, title: $0.name, agent: $0.taskAgent, isDisabled: !$0.available) },
                selected: draft.agent
            ) { id in
                draft.choose(agent: id, projects: options?.projects ?? [])
                path.removeLast()
            }
        case .model:
            let known = provider?.models ?? []
            let models = [draft.model].compactMap { $0 }.filter { !known.contains($0) } + known
            TaskChoicePage(
                title: "模型",
                choices: [TaskChoice(id: "", title: "默认模型")] + models.map { TaskChoice(id: $0, title: $0) },
                selected: draft.model ?? "",
                searchPrompt: "模型"
            ) { id in
                draft.model = id.isEmpty ? nil : id
                path.removeLast()
            }
        case .workspace:
            TaskChoicePage(
                title: "关联工作区",
                choices: (options?.projects ?? []).map { TaskChoice(id: $0.path, title: $0.name, subtitle: $0.path, glyph: .workspace) },
                selected: draft.project?.path,
                searchPrompt: "关联工作区",
                emptyText: "没有可用的工作区"
            ) { id in
                if let project = options?.projects.first(where: { $0.path == id }) {
                    if project.path != draft.project?.path, draft.target.mode == "existing" { draft.target.sessionId = nil }
                    draft.project = project
                }
                path.removeLast()
            }
        case .target:
            TaskChoicePage(
                title: "执行位置",
                choices: TaskTarget.choices(for: draft.agent).map { TaskChoice(id: $0, title: TaskTarget.name($0), glyph: .message) },
                selected: draft.target.mode
            ) { id in
                if id != draft.target.mode { draft.target = TaskTarget(mode: id, sessionId: id == "existing" ? "" : nil) }
                path.removeLast()
            }
        case .session:
            let workspace = draft.project?.workspaceId
            let rows = (sessions ?? []).filter { $0.workspaceId == workspace }
            TaskChoicePage(
                title: "关联会话",
                choices: rows.map { TaskChoice(id: $0.id, title: $0.title, glyph: .queue) },
                selected: draft.target.sessionId,
                searchPrompt: "关联会话",
                emptyText: sessions == nil ? (sessionsFailed ? "任务没能加载" : "") : "没有可用的会话"
            ) { id in
                draft.target.sessionId = id
                path.removeLast()
            }
        case .timezone:
            let zones = Array(Set([draft.schedule.timezone, options?.timezone].compactMap { $0 } + TimeZone.knownTimeZoneIdentifiers)).sorted()
            TaskChoicePage(
                title: "时区",
                choices: zones.map { TaskChoice(id: $0, title: TaskSchedule.timezoneLabel($0)) },
                selected: draft.schedule.timezone,
                searchPrompt: "时区"
            ) { id in
                draft.schedule.timezone = id
                path.removeLast()
            }
        }
    }

    // MARK: Loading and saving

    private func loadOptions() async {
        guard sameComputer, store.status == .connected else { return }
        optionsFailed = false
        guard let fresh = await model.options(includeSessions: draft.target.mode == "existing", using: store), sameComputer, !Task.isCancelled else {
            if !Task.isCancelled && sameComputer && options == nil { optionsFailed = true }
            return
        }
        let firstRead = options == nil
        options = fresh
        if fresh.sessions != nil { sessions = fresh.sessions }
        // A new task starts as the desktop's does, once its choices are known (嘟嘟 first when the plugin offers it, else the first agent and workspace); what has been typed or chosen meanwhile stays.
        if task == nil {
            if draft == original || firstRead {
                // Until the choices were there only the name and the text could be typed (the pills and the rule appear with them), so the rest starts as a blank task's does.
                let blank = TaskDraft(options: fresh)
                var start = blank
                start.title = draft.title
                start.prompt = draft.prompt
                draft = start
                original = blank
            } else {
                // Read again while it is being edited (the computer reconnected): what was chosen stays. A provider that is gone is replaced by the first there is, with its own start; only an agent needs a workspace.
                if fresh.providers.first(where: { $0.id == draft.agent })?.available != true, let first = fresh.providers.first(where: \.available) {
                    draft.choose(agent: first.id, projects: fresh.projects)
                }
                if !draft.isDudu, draft.project == nil { draft.project = fresh.projects.first }
            }
        }
    }

    private func loadSessions() async {
        sessionsFailed = false
        guard let fresh = await model.options(includeSessions: true, using: store), sameComputer else {
            sessionsFailed = true
            return
        }
        sessions = fresh.sessions ?? []
    }

    private func save() {
        guard canSave else { return }
        isSaving = true
        failure = nil
        Task {
            let result: TaskSaveResult
            if let task {
                result = await model.update(task, with: draft, using: store)
            } else {
                result = await model.create(draft, using: store)
            }
            isSaving = false
            switch result {
            case .saved:
                model.report?(DSBotToastMessage(text: task == nil ? "已创建任务" : "已更新任务", kind: .success))
                original = draft
                dismiss()
            case .failed(let code):
                DSBotLog.record("task.save.failed")
                failure = code ?? ""
            }
        }
    }
}
