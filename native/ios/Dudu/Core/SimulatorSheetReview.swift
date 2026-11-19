#if DEBUG && targetEnvironment(simulator)
import SwiftUI

/// Local review entry points present the real sheets with disposable fixture data.
/// Nothing here is compiled into the phone's Release build.
struct SimulatorSheetReview: ViewModifier {
    @ObservedObject var store: DuduStore
    @ObservedObject var board: BoardModel
    @ObservedObject var collector: CollectorModel
    @ObservedObject var tasks: TasksModel
    let maximumHeight: CGFloat
    @State private var presented = false
    @State private var prepared = false
    @State private var quick: AssistantQuickSheetState?
    @State private var issue: BoardIssue?
    @State private var toast: DuduToastMessage?

    private var name: String? {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-dudu-ui-review"),
              let index = args.firstIndex(of: "-dudu-review-sheet"),
              args.indices.contains(index + 1) else { return nil }
        return args[index + 1]
    }

    func body(content: Content) -> some View {
        content
            .sheet(isPresented: $presented) {
                reviewedSheet
                    .tint(DuduStyle.ink)
                    .environment(\.conversationAccess, access)
            }
            .task(id: store.selectedSession?.id) {
                guard let name, !prepared, store.status == .connected,
                      store.selectedSession?.isAssistant == true,
                      let computer = store.activeComputer?.id,
                      let session = store.selectedSession else { return }
                prepared = true
                // The root's toast sits behind a sheet: the review shows the pages' own answers in the sheet's toast.
                collector.report = { toast = $0 }
                tasks.report = { toast = $0 }
                if name.hasPrefix("todo") || name.hasPrefix("info") || name.hasPrefix("task") {
                    let kind: QuickCardKind = name.hasPrefix("todo") ? .todo : name.hasPrefix("info") ? .info : .task
                    let state = AssistantQuickSheetState(kind: kind, target: DraftTarget(computerID: computer, sessionID: session.id))
                    quick = state
                    switch kind {
                    case .todo:
                        await state.todos.refresh(state, using: store)
                        if name == "todo-expanded", let first = state.todos.issues.first {
                            state.todos.expandedID = first.id
                            await state.todos.expand(first, in: state, using: store)
                        }
                    case .info:
                        await collector.refresh(using: store)
                        if name == "info-detail" { state.record = collector.items.first }
                    case .task:
                        await tasks.refresh(using: store)
                        if name == "task-detail" { state.task = tasks.items.first }
                    }
                }
                if ["subissues", "issue-detail", "issue-agent"].contains(name) {
                    if let value = try? await store.request("issue.get", ["id": .number(1234)]),
                       let payload = value["issue"] {
                        issue = try? await DuduJSON().decode(BoardIssue.self, from: payload)
                    }
                }
                guard !Task.isCancelled else { return }
                presented = true
            }
    }

    @ViewBuilder private var reviewedSheet: some View {
        switch name {
        case "todo", "todo-expanded", "info", "info-detail", "task", "task-detail":
            if let quick {
                AssistantQuickSheet(
                    state: quick, store: store, board: board, collector: collector, tasks: tasks,
                    maximumHeight: maximumHeight,
                    onOpenIssue: { _ in }, onOpenIssueID: { _ in }, onOpenSession: { _ in }, onReply: { _ in },
                    toast: $toast
                )
            }
        case "task-standalone":
            if let task = tasks.items.first {
                TaskSheet(initial: task, model: tasks, store: store, onOpenSession: { _ in })
            }
        case "info-standalone":
            if let record = collector.items.first {
                SimulatorCollectorRecordReview(record: record, model: collector, board: board, store: store)
            }
        case "team", "jobs", "job-detail":
            if let session = store.selectedSession, let computer = store.activeComputer {
                SessionActivitySheet(
                    request: SessionActivityRequest(panel: name == "team" ? .team : .jobs, computerID: computer.id, session: session),
                    store: store, onOpenChild: { _ in }
                )
            }
        case "session-tasks":
            // The scheduled tasks of the conversation (`-dudu-review-tasks .local/designs/session-schedules-2026-11-17/verify/tasks.json`: four of them go into the assistant's conversation, three do not).
            if let session = store.selectedSession, let computer = store.activeComputer {
                SessionTasksSheet(
                    request: SessionActivityRequest(panel: .tasks, computerID: computer.id, session: session),
                    model: tasks, store: store, toast: $toast
                )
            }
        case "subissues":
            if let issue { BoardSubIssuesSheet(issue: issue, board: board, store: store, onOpen: { _ in }) }
        case "issue-detail":
            if let issue { IssueDetailSheet(issue: issue, board: board, store: store) }
        case "issue-agent":
            if let issue { IssueActionsSheet(board: board, store: store, issue: issue, action: .agent) }
        case "diff":
            NavigationStack {
                ConversationDiffContent(seq: 109, index: 0, name: "report.txt")
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        case "files", "changes":
            SimulatorFileBrowserReview(delivered: name == "files")
        case "file-preview":
            SimulatorProjectFileReview(store: store)
        case "computers":
            NavigationStack {
                ComputerListView(store: store, onClose: { presented = false })
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.hidden)
            .presentationCornerRadius(32)
            .presentationBackground(DuduStyle.settingsBackground)
        default:
            EmptyView()
        }
    }

    private var access: ConversationAccess? {
        guard let computer = store.activeComputer?.id, let session = store.selectedSession else { return nil }
        return ConversationAccess(
            target: DraftTarget(computerID: computer, sessionID: session.id), connected: true,
            request: { method, params in try await store.request(method, params) },
            fork: { _ in }, loadImage: { _, _, _ in nil }
        )
    }
}
#endif
