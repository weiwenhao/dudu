import SwiftUI

/// The scheduled tasks that go into this conversation: the third item of the conversation's ⋯ menu (owner, 2026-11-17: "做"; the drawing is `.local/designs/session-schedules-2026-11-17/phone.png`).
/// It is the 任务 page's list, filtered to this conversation: `TaskSummaryRow` in a white card (the status at the right, the rule and 下次运行 under the title), the swipe and the press and hold of that page,
/// a tap on a row opening the task in full (`TaskSheet`) inside the sheet. The frame is that of 智能体团队 and 后台任务 (`QuickSheetPage`, centred title, ✕ at the right, the finished ones folded into one row).
/// A task goes into the conversation when it names it (「已有会话」) or has made it and keeps it (「新建对话并复用」); one that makes a new conversation each time goes into none. The task record has no creator,
/// so the list does not say who made a task: the Agent's own (CronCreate) and the ones made in the tasks window are both here.
struct SessionTasksSheet: View {
    let request: SessionActivityRequest
    @ObservedObject var model: TasksModel
    @ObservedObject var store: DuduStore
    @Binding var toast: DuduToastMessage?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var opened: ScheduledTask?
    @State private var editing: ScheduledTask?
    @State private var deleting: ScheduledTask?
    /// The task whose swipe actions are showing (one at a time).
    @State private var revealed: String?
    /// The finished ones open only when asked (and by themselves when nothing else is left).
    @State private var finishedOpen: Bool?
    /// The height follows the content; the selection moves with it, or the sheet would lose its detent.
    @State private var detent: PresentationDetent = .height(330)

    private struct Reading: Hashable {
        let connection: Int
        let active: Bool
    }

    private var sessionID: String { request.session.id }

    private func belongs(_ task: ScheduledTask) -> Bool {
        switch task.target.mode {
        case "existing": return task.target.sessionId == sessionID
        case "reuse": return task.sessionId == sessionID
        default: return false
        }
    }

    /// The order of the tasks page: the newest made first within each state; the ones that are on, then the paused.
    private var mine: [ScheduledTask] { model.tasks.filter(belongs) }
    private var current: [ScheduledTask] { mine.filter { $0.status == "active" } + mine.filter { $0.status == "paused" } }
    private var finished: [ScheduledTask] { mine.filter { $0.status == "ended" } }
    private var finishedIsOpen: Bool { finishedOpen ?? current.isEmpty }

    private var sheetHeight: CGFloat {
        if opened != nil { return 600 }
        if mine.isEmpty { return 260 }
        var height: CGFloat = 96 + CGFloat(current.count) * 58
        if !finished.isEmpty { height += (current.isEmpty ? 52 : 66) + (finishedIsOpen ? 10 + CGFloat(finished.count) * 58 : 0) }
        return min(600, max(260, height))
    }

    var body: some View {
        ZStack {
            list
                .opacity(opened == nil ? 1 : 0)
                .allowsHitTesting(opened == nil)
                .accessibilityHidden(opened != nil)
            if let task = opened {
                TaskSheet(
                    initial: task, model: model, store: store,
                    onOpenSession: { openSession($0) },
                    quickNavigation: QuickDetailNavigation(back: { opened = nil }, close: { dismiss() })
                )
                .id(task.id)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DuduStyle.sheet)
        .overlay(alignment: .top) {
            DuduToastOverlay(message: toast) { message in
                if toast?.id == message.id { toast = nil }
            }
            .padding(.horizontal, 24)
            .padding(.top, 70)
        }
        .presentationDetents([.height(sheetHeight), .large], selection: $detent)
        .onChange(of: sheetHeight, initial: true) { _, height in
            if detent != .large { detent = .height(height) }
        }
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(DuduStyle.sheet)
        // Read when the sheet opens and when the computer connects; the next runs and the states move on by themselves, so again every few seconds while it stays.
        .task(id: Reading(connection: store.connectionRevision, active: scenePhase == .active)) {
            guard scenePhase == .active else { return }
            await model.refresh(using: store)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled else { break }
                await model.refresh(using: store)
            }
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
        .accessibilityIdentifier("session.activity.tasks")
        #if DEBUG && targetEnvironment(simulator)
        // The simulator has no finger: `-dudu-review-session-tasks-finished`, `-dudu-review-session-tasks-detail N` and `-dudu-review-session-tasks-swipe N` do what a tap on the 已结束 row,
        // a tap on the Nth row and a swipe on it would, once the list is there.
        .task(id: model.state == .loaded) {
            guard model.state == .loaded else { return }
            let arguments = ProcessInfo.processInfo.arguments
            func value(_ flag: String) -> String? { arguments.firstIndex(of: flag).flatMap { $0 + 1 < arguments.count ? arguments[$0 + 1] : nil } }
            if arguments.contains("-dudu-review-session-tasks-finished") { finishedOpen = true }
            try? await Task.sleep(nanoseconds: 700_000_000)
            if let index = value("-dudu-review-session-tasks-detail").flatMap(Int.init), current.indices.contains(index) { opened = current[index] }
            if let index = value("-dudu-review-session-tasks-swipe").flatMap(Int.init), current.indices.contains(index) { revealed = current[index].id }
        }
        #endif
    }

    private var list: some View {
        QuickSheetPage(
            title: request.panel.title,
            onClose: { dismiss() },
            centersTitle: true,
            actions: {}, filters: {}
        ) {
            content
        } footer: {}
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DuduStyle.sheet)
    }

    @ViewBuilder
    private var content: some View {
        if mine.isEmpty {
            switch model.state {
            case .loading:
                ProgressView().tint(DuduStyle.chatSecondary)
                    .frame(maxWidth: .infinity, minHeight: 140)
            case .failed:
                VStack(spacing: 14) {
                    Text(L10n.text("任务没能加载"))
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
                .frame(maxWidth: .infinity, minHeight: 160)
            case .loaded:
                VStack(spacing: 20) {
                    DuduIcon(.schedule, size: 26).foregroundStyle(DuduStyle.muted)
                    Text(L10n.text("暂无定时任务"))
                        .font(.system(size: 15))
                        .foregroundStyle(DuduStyle.muted)
                }
                .frame(maxWidth: .infinity, minHeight: 160)
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if !current.isEmpty { card(current) }
                if !finished.isEmpty {
                    finishedRow
                        .padding(.top, current.isEmpty ? 0 : 14)
                    if finishedIsOpen {
                        card(finished)
                            .padding(.top, 10)
                    }
                }
            }
        }
    }

    private func card(_ tasks: [ScheduledTask]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(tasks.enumerated()), id: \.element.id) { index, task in
                if index > 0 { Divider().padding(.leading, 52).padding(.trailing, 16) }
                SwipeActionRow(actions: swipeActions(for: task), isRevealed: revealed == task.id, onReveal: { revealed = $0 ? task.id : nil }) {
                    Button { tap(task) } label: { row(task, horizontalPadding: 16) }
                        .buttonStyle(DuduRowButtonStyle())
                        // Press and hold: the row lifts as a card and the menu opens under it, as on the tasks page.
                        .contextMenu { rowMenu(for: task) } preview: { row(task, horizontalPadding: 16).frame(width: 340).background(Color.white) }
                }
            }
        }
        .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func row(_ task: ScheduledTask, horizontalPadding: CGFloat) -> some View {
        // No Agent's logo: every task here goes into this conversation, so it is the same Agent on every row.
        TaskSummaryRow(
            agent: nil, title: task.title, line: task.line, statusText: task.statusText,
            isOn: task.isActive, isBusy: model.busy.contains(task.id), horizontalPadding: horizontalPadding,
            failed: task.status != "ended" && task.lastRun?.status == "failed"
        )
    }

    /// The finished ones in one row that opens the list, as the team sheet folds its finished members.
    private var finishedRow: some View {
        Button {
            withAnimation(.easeInOut(duration: 0.2)) { finishedOpen = !finishedIsOpen }
        } label: {
            HStack(spacing: 12) {
                DuduIcon(.check, size: 18).foregroundStyle(DuduStyle.muted)
                    .frame(width: 20, height: 20)
                Text(L10n.text("已结束"))
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(DuduStyle.ink)
                Spacer(minLength: 8)
                Text("\(finished.count)")
                    .font(.system(size: 14))
                    .foregroundStyle(DuduStyle.muted)
                    .monospacedDigit()
                DuduIcon(finishedIsOpen ? .down : .right, size: 16)
                    .foregroundStyle(DuduStyle.muted)
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(DuduRowButtonStyle())
        .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    /// A tap puts away the swipe actions that are showing; otherwise it opens the task.
    private func tap(_ task: ScheduledTask) {
        if revealed != nil { revealed = nil } else { opened = task }
    }

    private func act(_ action: TaskAction, _ task: ScheduledTask) {
        revealed = nil
        Task { await model.act(action, task, using: store) }
    }

    /// The conversation a delivery went to is this one in nearly every case; another one is opened in its place.
    private func openSession(_ id: String) {
        dismiss()
        guard id != sessionID, let session = store.sessions.first(where: { $0.id == id }) else { return }
        Task { await store.selectSession(session) }
    }

    /// What a swipe to the left offers, as on the tasks page: pause and run now and delete for a task that is on; resume and delete for one that is paused; delete for one that is over.
    private func swipeActions(for task: ScheduledTask) -> [SwipeAction] {
        guard !model.busy.contains(task.id) else { return [] }
        let pause = SwipeAction(id: "pause", title: L10n.text("暂停任务"), symbol: "pause", color: SwipeAction.grey) { act(.pause, task) }
        let resume = SwipeAction(id: "resume", title: L10n.text("恢复任务"), symbol: "play", color: DuduStyle.blue) { act(.resume, task) }
        let run = SwipeAction(id: "run", title: L10n.text("立即执行"), symbol: "bolt.fill", color: DuduStyle.blue) { act(.run, task) }
        let delete = SwipeAction(id: "delete", title: L10n.text("删除任务"), symbol: "trash", color: SwipeAction.red) { revealed = nil; deleting = task }
        switch task.status {
        case "active": return [pause, run, delete]
        case "paused": return [resume, delete]
        default: return [delete]
        }
    }

    /// What pressing and holding a task offers: the tasks page's menu, for that one task.
    @ViewBuilder
    private func rowMenu(for task: ScheduledTask) -> some View {
        if task.status == "active" {
            Button { act(.pause, task) } label: { DuduLabel(L10n.text("暂停任务"), icon: .pause) }
        } else if task.status == "paused" {
            Button { act(.resume, task) } label: { DuduLabel(L10n.text("恢复任务"), icon: .play) }
        }
        Button { act(.run, task) } label: { DuduLabel(L10n.text("立即执行"), icon: .zap) }
        Button { editing = task } label: { DuduLabel(L10n.text("编辑"), icon: .editLine) }
        Button(role: .destructive) { deleting = task } label: { DuduLabel(L10n.text("删除任务"), icon: .trash) }
    }
}
