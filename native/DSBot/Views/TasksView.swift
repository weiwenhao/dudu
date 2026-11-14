import SwiftUI

/// The logo of whoever does a task: 嘟嘟's own (`DuduLogo`) or the agent's.
struct TaskAgentLogo: View {
    let agent: TaskAgent
    var size: CGFloat

    var body: some View {
        switch agent {
        case .dudu: DuduLogo(size: size)
        case .agent(let agent): AgentLogo(agent: agent, size: size)
        }
    }
}

/// A task as one row: the logo of the agent that runs it, its name, its rule and when it runs next, and whether it is on. The card of 嘟嘟's chat (`QuickCardView`) and the tasks page draw the same row.
struct TaskSummaryRow: View {
    let agent: TaskAgent?
    let title: String
    let line: String
    /// 已开启 / 已暂停 / 已结束, or nothing.
    let statusText: String?
    let isOn: Bool
    var isBusy = false
    var horizontalPadding: CGFloat = 16

    /// The desktop's `--dudu-success` in its light theme.
    private static let on = Color(red: 0x17 / 255, green: 0x7a / 255, blue: 0x3c / 255)

    var body: some View {
        HStack(spacing: 14) {
            Group {
                if let agent {
                    TaskAgentLogo(agent: agent, size: 22)
                } else {
                    DSBotIcon(.schedule, size: 20).foregroundStyle(DSBotStyle.muted)
                }
            }
            .frame(width: 22, height: 22)
            .opacity(isOn ? 1 : 0.55)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(isOn ? DSBotStyle.ink : DSBotStyle.muted)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if isBusy {
                        ProgressView().controlSize(.small).tint(DSBotStyle.muted)
                    } else if let statusText {
                        Text(statusText)
                            .font(.system(size: 12))
                            .foregroundStyle(isOn ? Self.on : DSBotStyle.muted)
                            .lineLimit(1)
                    }
                }
                if !line.isEmpty {
                    Text(line)
                        .font(.system(size: 12))
                        .foregroundStyle(DSBotStyle.muted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, horizontalPadding)
        .frame(height: 58)
        .accessibilityElement(children: .combine)
    }
}

/// The scheduled tasks, a page of its own (owner, 2026-11-10: "定时任务页列表选 b"): the desktop's four status filters as the Collector's glass tabs over one flat list, the status at the right of each row.
/// Its header (back, the title, "+") is the root's toolbar; this is the rest of the page. A tap opens the task in full; a swipe to the left (the app's own, `SwipeActionRow`) pauses or resumes it, runs it now
/// or deletes it; pressing and holding opens the menu of what can be done with it, as on a record of the Collector.
struct TasksView: View {
    /// What the page's reading is for: whether the computer is there to ask.
    struct TasksLoad: Hashable {
        var connection: Int
        var active: Bool
    }

    @ObservedObject var model: TasksModel
    @ObservedObject var store: DSBotStore
    /// The toolbar above the page (the page itself starts below the status bar).
    let topInset: CGFloat
    /// Open a conversation (the one a task's runs go to).
    let onOpenSession: (String) -> Void
    var quickSheet: AssistantQuickSheetState? = nil

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var opened: ScheduledTask?
    @State private var editing: ScheduledTask?
    @State private var deleting: ScheduledTask?
    /// The task whose swipe actions are showing (one at a time).
    @State private var revealed: String?

    var body: some View {
        Group {
            if let quickSheet {
                quickPage(quickSheet)
            } else {
                VStack(spacing: 0) {
                    GlassTabs(tabs: TaskTab.allCases, title: \.title, selection: model.tab, identifier: "tasks.tab", onSelect: model.select)
                    content
                }
                .padding(.top, topInset + 10)
            }
        }
        .background(DSBotStyle.canvas)
        .accessibilityIdentifier("tasks.page")
        // Read when the page is shown and when the computer connects; the next runs move on by themselves, so it is read again while the page stays.
        .task(id: TasksLoad(connection: store.connectionRevision, active: scenePhase == .active && store.status == .connected)) {
            guard scenePhase == .active, store.status == .connected else { return }
            await model.refresh(using: store)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled else { break }
                await model.refresh(using: store)
            }
        }
        .sheet(item: $opened) { task in
            TaskSheet(initial: task, model: model, store: store, onOpenSession: onOpenSession)
        }
        .sheet(isPresented: $model.isMaking) {
            TaskEditorSheet(model: model, store: store, task: nil)
        }
        .sheet(item: $editing) { task in
            TaskEditorSheet(model: model, store: store, task: task)
        }
        .confirmationDialog(
            L10n.text("删除任务"), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible, presenting: deleting
        ) { task in
            Button(L10n.text("删除任务"), role: .destructive) { Task { await model.act(.delete, task, using: store) } }
        } message: { task in
            Text(task.title)
        }
        .onChange(of: model.tab) { _, _ in revealed = nil }
        #if DEBUG && targetEnvironment(simulator)
        // The simulator has no finger: `-dsbot-review-task-tab active|paused|ended`, `-dsbot-review-task-detail N`, `-dsbot-review-task-edit N`, `-dsbot-review-task-new` and
        // `-dsbot-review-task-swipe N` do what a tap, a tap on a row, a long press's "编辑", the "+" and a swipe would, once the list is there.
        .task(id: model.state == .loaded) {
            guard model.state == .loaded else { return }
            let arguments = ProcessInfo.processInfo.arguments
            func value(_ flag: String) -> String? { arguments.firstIndex(of: flag).flatMap { $0 + 1 < arguments.count ? arguments[$0 + 1] : nil } }
            if let name = value("-dsbot-review-task-tab"), let wanted = TaskTab(rawValue: name) { model.select(wanted) }
            try? await Task.sleep(nanoseconds: 800_000_000)
            let rows = model.items
            if let index = value("-dsbot-review-task-detail").flatMap(Int.init), rows.indices.contains(index) { opened = rows[index] }
            if let index = value("-dsbot-review-task-edit").flatMap(Int.init), rows.indices.contains(index) { editing = rows[index] }
            if arguments.contains("-dsbot-review-task-new") { model.isMaking = true }
            if let index = value("-dsbot-review-task-swipe").flatMap(Int.init), rows.indices.contains(index) { revealed = rows[index].id }
            // `-dsbot-review-task-act pause:0` (also resume, run, duplicate, delete): what a swipe's block does to the Nth row.
            if let spec = value("-dsbot-review-task-act") {
                let parts = spec.split(separator: ":")
                if parts.count == 2, let action = TaskAction(rawValue: String(parts[0])), let index = Int(parts[1]), rows.indices.contains(index) {
                    await model.act(action, rows[index], using: store)
                }
            }
        }
        #endif
    }

    private func quickPage(_ sheet: AssistantQuickSheetState) -> some View {
        QuickSheetNavigation(state: sheet) { quickContent($0) }
    }

    private func quickContent(_ sheet: AssistantQuickSheetState) -> some View {
        ZStack {
            QuickSheetPage(
                title: L10n.text("任务"), count: model.state == .loaded ? model.items.count : nil,
                onClose: { dismiss() }, active: sheet.task == nil,
                scrollID: Binding(get: { sheet.scrollID }, set: { sheet.scrollID = $0 })
            ) {
                Button { model.isMaking = true } label: {
                    DSBotIcon(.plus, size: 14)
                        .foregroundStyle(DSBotStyle.chatSecondary)
                        .frame(width: 28, height: 28)
                        .background(DSBotStyle.selected, in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DSBotQuietPressStyle())
                .accessibilityLabel(L10n.text("新建任务"))
            } filters: {
                GlassTabs(tabs: TaskTab.allCases, title: \.title, selection: model.tab, identifier: "tasks.tab", onSelect: model.select)
                    .padding(.bottom, 14)
            } content: {
                if model.state == .loaded, !model.items.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(model.items) { task in
                            SwipeActionRow(actions: swipeActions(for: task), isRevealed: revealed == task.id, onReveal: { revealed = $0 ? task.id : nil }) {
                                Button { tap(task) } label: { row(task) }
                                    .buttonStyle(DSBotRowButtonStyle())
                                    .contextMenu { rowMenu(for: task) } preview: { TaskRowCard(task: task) }
                            }
                            .id(task.id)
                            if task.id != model.items.last?.id { Divider().padding(.leading, 52).padding(.trailing, 16) }
                        }
                    }
                    .scrollTargetLayout()
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                } else {
                    content.frame(minHeight: 82)
                }
            } footer: {}
            .opacity(sheet.task == nil ? 1 : 0)
            .allowsHitTesting(sheet.task == nil)
            .accessibilityHidden(sheet.task != nil)

            if let task = sheet.task {
                TaskSheet(
                    initial: task, model: model, store: store, onOpenSession: onOpenSession,
                    quickNavigation: QuickDetailNavigation(back: { sheet.task = nil }, close: { dismiss() })
                )
                .id(task.id)
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
                .accessibilityIdentifier("tasks.loading")
        case .failed:
            VStack(spacing: 14) {
                Text(L10n.text("任务没能加载"))
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                Button(L10n.text("重试")) { Task { await model.refresh(using: store) } }
                    .font(.system(size: 15, weight: .medium))
                    .buttonStyle(DSBotGlassCapsuleButtonStyle())
                    .padding(.horizontal, 20)
                    .frame(height: 44)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .loaded:
            if model.items.isEmpty {
                Text(L10n.text("没有任务"))
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityIdentifier("tasks.empty")
            } else {
                list
            }
        }
    }

    private var list: some View {
        List {
            ForEach(model.items) { task in
                SwipeActionRow(actions: swipeActions(for: task), isRevealed: revealed == task.id, onReveal: { revealed = $0 ? task.id : nil }) {
                    Button { tap(task) } label: {
                        row(task)
                    }
                    .buttonStyle(DSBotRowButtonStyle())
                    // Press and hold: the row lifts as a card and the menu opens under it, as on a record of the Collector.
                    .contextMenu {
                        rowMenu(for: task)
                    } preview: {
                        TaskRowCard(task: task)
                    }
                    .accessibilityIdentifier("tasks.task.\(task.id)")
                }
                .listRowInsets(EdgeInsets(top: 0, leading: DSBotLayout.sidebarPadding, bottom: 2, trailing: DSBotLayout.sidebarPadding))
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
            }
            Color.clear.frame(height: 24)
                .listRowInsets(EdgeInsets())
                .listRowSeparator(.hidden)
                .listRowBackground(Color.clear)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { await model.refresh(using: store) }
    }

    private func row(_ task: ScheduledTask) -> some View {
        TaskSummaryRow(
            agent: task.taskAgent, title: task.title, line: task.line, statusText: task.statusText,
            isOn: task.isActive, isBusy: model.busy.contains(task.id), horizontalPadding: 10
        )
    }

    /// A tap puts away the swipe actions that are showing; otherwise it opens the task.
    private func tap(_ task: ScheduledTask) {
        if revealed != nil {
            revealed = nil
        } else {
            if let quickSheet { quickSheet.task = task } else { opened = task }
        }
    }

    private func act(_ action: TaskAction, _ task: ScheduledTask) {
        revealed = nil
        Task { await model.act(action, task, using: store) }
    }

    /// What a swipe to the left offers: pause (a quiet grey) and run now (blue, not black: owner, 2026-11-10) and delete (red) for a task that is on; resume and delete for one that is paused; delete for one
    /// that is over. Run now, copy and edit are also in the menu of a press and hold, and in the task in full.
    private func swipeActions(for task: ScheduledTask) -> [SwipeAction] {
        guard !model.busy.contains(task.id) else { return [] }
        let pause = SwipeAction(id: "pause", title: L10n.text("暂停任务"), symbol: "pause", color: SwipeAction.grey) { act(.pause, task) }
        let resume = SwipeAction(id: "resume", title: L10n.text("恢复任务"), symbol: "play", color: DSBotStyle.blue) { act(.resume, task) }
        let run = SwipeAction(id: "run", title: L10n.text("立即执行"), symbol: "bolt.fill", color: DSBotStyle.blue) { act(.run, task) }
        let delete = SwipeAction(id: "delete", title: L10n.text("删除任务"), symbol: "trash", color: SwipeAction.red) { revealed = nil; deleting = task }
        switch task.status {
        case "active": return [pause, run, delete]
        case "paused": return [resume, delete]
        default: return [delete]
        }
    }

    /// What pressing and holding a task offers: the desktop's buttons and menu, for that one task.
    @ViewBuilder
    private func rowMenu(for task: ScheduledTask) -> some View {
        if task.status == "active" {
            Button { act(.pause, task) } label: { DSBotLabel(L10n.text("暂停任务"), icon: .pause) }
        } else if task.status == "paused" {
            Button { act(.resume, task) } label: { DSBotLabel(L10n.text("恢复任务"), icon: .play) }
        }
        Button { act(.run, task) } label: { DSBotLabel(L10n.text("立即执行"), icon: .zap) }
        Button { act(.duplicate, task) } label: { DSBotLabel(L10n.text("复制任务"), icon: .copy) }
        Button { editing = task } label: { DSBotLabel(L10n.text("编辑"), icon: .editLine) }
        Button(role: .destructive) { deleting = task } label: { DSBotLabel(L10n.text("删除任务"), icon: .trash) }
    }
}

/// The card a pressed task lifts into while its menu is open: the row itself, on white.
private struct TaskRowCard: View {
    let task: ScheduledTask

    var body: some View {
        TaskSummaryRow(agent: task.taskAgent, title: task.title, line: task.line, statusText: task.statusText, isOn: task.isActive, horizontalPadding: 16)
            .frame(width: 340)
            .background(Color.white)
    }
}
