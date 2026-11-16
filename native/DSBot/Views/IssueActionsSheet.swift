import SwiftUI

enum IssueQuickAction: String, CaseIterable, Identifiable, Hashable {
    case priority, agent, status, due, labels, project, subIssue

    var id: String { rawValue }
    var title: String {
        switch self {
        case .status: return L10n.text("状态")
        case .priority: return L10n.text("优先级")
        case .agent: return L10n.text("智能体")
        case .due: return L10n.text("截止日期")
        case .labels: return L10n.text("标签")
        case .project: return L10n.text("项目")
        case .subIssue: return L10n.text("添加子事项")
        }
    }
    var glyph: DSBotGlyph {
        switch self {
        case .status: return .issueStatus
        case .priority: return .issuePriority
        case .agent: return .stateUnassigned
        case .due: return .dueDate
        case .labels: return .issueLabel
        case .project: return .issueProject
        case .subIssue: return .open
        }
    }
    func isAvailable(for issue: BoardIssue) -> Bool {
        switch self {
        case .agent, .project: return issue.agent == nil
        default: return true
        }
    }
}

struct IssueActionRequest: Identifiable {
    let issue: BoardIssue
    var action: IssueQuickAction?
    var id: String { "\(issue.id)/\(action?.rawValue ?? "more")" }
}

/// Existing issue values use the same native choice pages as New issue, with Desktop's assignment locks.
struct IssueActionsSheet: View {
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    @Environment(\.dismiss) private var dismiss
    @State private var issue: BoardIssue
    @State private var options: IssueCreationOptions?
    @State private var path = NavigationPath()
    @State private var activeAction: IssueQuickAction?
    @State private var assignmentProject: IssueProject?
    @State private var selectedLabels: Set<Int> = []
    @State private var loading = true
    @State private var loadFailed = false
    @State private var saving = false
    @State private var saveFailed = false
    @State private var addingSubIssue = false
    private let computerID: String?
    private let rootAction: IssueQuickAction?

    init(board: BoardModel, store: DSBotStore, issue: BoardIssue, action: IssueQuickAction?) {
        self.board = board
        self.store = store
        computerID = store.activeComputer?.id
        rootAction = action
        _issue = State(initialValue: issue)
        _activeAction = State(initialValue: action)
    }

    var body: some View {
        NavigationStack(path: $path) {
            page(rootAction)
                .navigationDestination(for: IssueQuickAction.self) { page($0) }
                .navigationDestination(for: IssueCreationPicker.self) { picker in
                    if picker == .newProject {
                        IssueProjectCreatePage(board: board, store: store) { project in
                            if activeAction == .agent {
                                assignmentProject = project
                                path.removeLast()
                            } else { saveProject(project) }
                        }
                    }
                }
                .toolbar {
                    if rootAction != nil && path.isEmpty {
                        ToolbarItem(placement: .cancellationAction) {
                            Button { dismiss() } label: {
                                DSBotIcon(.back, size: 20)
                            }
                            .disabled(saving)
                            .accessibilityLabel(L10n.text("返回"))
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        SheetCloseButton { dismiss() }.disabled(saving)
                    }
                }
        }
        .disabled(saving)
        .overlay {
            if saving {
                ProgressView()
                    .tint(DSBotStyle.ink)
                    .padding(20)
                    .dsbotGlass(in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        }
        .safeAreaInset(edge: .bottom) {
            if saveFailed {
                Text(L10n.text("更改没能保存"))
                    .font(.system(size: 13))
                    .foregroundStyle(DSBotStyle.chatError)
                    .padding(16)
                    .frame(maxWidth: .infinity)
                    .background(DSBotStyle.canvas)
            }
        }
        .presentationDetents([.large])
        .presentationCornerRadius(28)
        .interactiveDismissDisabled(saving)
        .sheet(isPresented: $addingSubIssue) {
            NewIssueSheet(board: board, store: store, parent: issue) { dismiss() }
        }
        .task(id: "\(store.connectionRevision)/\(store.status)") { await load() }
        .onChange(of: store.activeComputer?.id) { _, id in if id != computerID { dismiss() } }
    }

    @ViewBuilder
    private func page(_ action: IssueQuickAction?) -> some View {
        if loading || loadFailed {
            IssueChoiceList(title: action?.title ?? L10n.text("更多")) {
                if loadFailed {
                    Text(L10n.text("事项没能加载")).font(.system(size: 14)).foregroundStyle(DSBotStyle.muted).padding(16)
                    Button(L10n.text("重试")) { Task { await load() } }.padding(16)
                } else { ProgressView().tint(DSBotStyle.muted).padding(24) }
            }
        } else if let action {
            choices(action)
                .disabled(!action.isAvailable(for: issue) || store.status != .connected)
        } else {
            menu
        }
    }

    private var menu: some View {
        IssueChoiceList(title: L10n.text("更多")) {
            ForEach(IssueQuickAction.allCases) { action in
                if action == .subIssue { Divider().padding(.leading, 16) }
                Button {
                    if action == .subIssue { addingSubIssue = true }
                    else { activeAction = action; path.append(action) }
                } label: {
                    HStack(spacing: 12) {
                        DSBotIcon(action.glyph, size: 18, scalesStroke: true).frame(width: 20, height: 20)
                        Text(action.title).font(.system(size: 15)).frame(maxWidth: .infinity, alignment: .leading)
                        DSBotIcon(.right, size: 16, scalesStroke: true).foregroundStyle(DSBotStyle.muted)
                    }
                    .foregroundStyle(action.isAvailable(for: issue) ? DSBotStyle.ink : DSBotStyle.muted)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(minHeight: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DSBotRowButtonStyle())
                .disabled(!action.isAvailable(for: issue) || store.status != .connected)
            }
        }
    }

    @ViewBuilder
    private func choices(_ action: IssueQuickAction) -> some View {
        switch action {
        case .status:
            IssueChoiceList(title: action.title) {
                ForEach(options?.statuses ?? []) { status in
                    IssueChoiceRow(title: status.title, selected: status.id == issue.status) {
                        IssueStatusIcon(type: status.type, color: status.color, iconProgress: status.iconProgress)
                    } action: { save(["status": .string(status.id)]) }
                }
            }
        case .priority:
            IssueChoiceList(title: action.title) {
                ForEach(IssuePriority.allCases) { priority in
                    IssueChoiceRow(title: priority.title, selected: priority.rawValue == issue.priority) {
                        IssuePriorityIcon(priority: priority)
                    } action: { save(["priority": .string(priority.rawValue)]) }
                }
            }
        case .project:
            IssueProjectPicker(projects: options?.projects ?? [], selected: issue.projectInfo, onSelect: saveProject)
        case .agent:
            agentChoices
        case .due:
            IssueDuePicker(dueAt: issue.dueAt.map { Date(timeIntervalSince1970: $0 / 1000) }) { date in
                save(["dueAt": date.map { .number(($0.timeIntervalSince1970 * 1000).rounded()) } ?? .null])
            }
        case .labels:
            IssueLabelsPicker(
                labels: Binding(get: { options?.labels ?? [] }, set: { options?.labels = $0 }),
                selected: $selectedLabels, board: board, store: store,
                onSave: { save(["labels": .array(selectedLabels.sorted().map { .number(Double($0)) })]) }
            )
        case .subIssue:
            EmptyView()
        }
    }

    @ViewBuilder
    private var agentChoices: some View {
        if let project = assignmentProject, let folder = project.path, !folder.isEmpty {
            IssueChoiceList(title: L10n.text("智能体")) {
                ForEach(store.agentChoices(keeping: issue.sessionAgent), id: \.rawValue) { agent in
                    IssueChoiceRow(title: agent.name) { AgentLogo(agent: agent, size: 20) } action: {
                        perform { await board.assign(issue, agent: agent, project: project, using: store) }
                    }
                }
            }
        } else {
            IssueProjectPicker(projects: options?.projects ?? [], selected: assignmentProject) { assignmentProject = $0 }
        }
    }

    private func saveProject(_ project: IssueProject?) {
        save(["project": project.map { .object([
            "name": .string($0.name), "path": $0.path.map(JSONValue.string) ?? .null,
        ]) } ?? .null])
    }

    private func save(_ patch: [String: JSONValue]) {
        perform { await board.update(issue, patch: patch, using: store) }
    }

    private func perform(_ operation: @escaping () async -> BoardIssue?) {
        guard !saving, computerID == store.activeComputer?.id, store.status == .connected else { return }
        saving = true
        saveFailed = false
        Task {
            let changed = await operation()
            guard computerID == store.activeComputer?.id else { return }
            saving = false
            if changed != nil { dismiss() } else { saveFailed = true }
        }
    }

    private func load() async {
        guard computerID == store.activeComputer?.id, store.status == .connected else {
            loading = false
            loadFailed = options == nil
            return
        }
        loading = options == nil
        loadFailed = false
        async let detail = board.detail(of: issue, using: store)
        async let catalog = board.creationOptions(using: store)
        let (full, fresh) = await (detail, catalog)
        guard !Task.isCancelled, computerID == store.activeComputer?.id else { return }
        loading = false
        guard let full, let fresh, fresh.outcome == "success" else { loadFailed = options == nil; return }
        if options == nil {
            assignmentProject = full.projectInfo
            selectedLabels = Set((full.labels ?? []).map(\.id))
        }
        issue = full
        options = fresh
    }
}
