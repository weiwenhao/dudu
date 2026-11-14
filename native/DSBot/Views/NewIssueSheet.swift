import SwiftUI

enum IssueCreationPicker: Hashable {
    case status, priority, project, agent, labels, due, parent, newProject
}

/// Desktop's New issue values, in the app's native sheet and context pills.
struct NewIssueSheet: View {
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    @Environment(\.dismiss) private var dismiss
    @State private var draft: IssueCreationDraft
    @State private var options: IssueCreationOptions?
    @State private var path: [IssueCreationPicker] = []
    @State private var optionsFailed = false
    @State private var computerID: String?
    @State private var isCreating = false
    @State private var failed = false
    @State private var formHeight: CGFloat = 0
    @State private var formTopInset: CGFloat = 0
    @FocusState private var titleFocused: Bool
    @Namespace private var sheetSpace

    let record: Int?
    let onCreated: () -> Void
    private let parentToLoad: BoardIssue?

    init(board: BoardModel, store: DSBotStore, title: String = "", brief: String = "", record: Int? = nil, parent: BoardIssue? = nil, onCreated: @escaping () -> Void = {}) {
        self.board = board
        self.store = store
        self.record = record
        parentToLoad = parent?.projectInfo == nil && parent?.project != nil ? parent : nil
        _draft = State(initialValue: IssueCreationDraft(title: title, brief: brief, project: parent?.projectInfo, parent: parent))
        _computerID = State(initialValue: store.activeComputer?.id)
        self.onCreated = onCreated
    }

    private var sameComputer: Bool { computerID != nil && computerID == store.activeComputer?.id }
    private var canCreate: Bool {
        !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && status != nil && options != nil && !isCreating && sameComputer && store.status == .connected
    }
    private var status: IssueWorkflowStatus? { options?.statuses.first { $0.id == draft.status } }
    private var selectedLabels: [IssueLabel] { (options?.labels ?? []).filter { draft.labels.contains($0.id) } }

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if let parent = draft.parent { parentChip(parent) }
                    TextField("事项标题", text: $draft.title, axis: .vertical)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(DSBotStyle.chatInk)
                        .lineLimit(1...4)
                        .focused($titleFocused)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityIdentifier("newissue.title")
                    TextField("添加描述…", text: $draft.brief, axis: .vertical)
                        .font(.system(size: 16))
                        .foregroundStyle(DSBotStyle.chatInk)
                        .lineLimit(4...8)
                        .padding(16)
                        .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityIdentifier("newissue.brief")
                    if options != nil {
                        properties
                    } else if optionsFailed {
                        HStack(spacing: 12) {
                            Text("事项没能加载").foregroundStyle(DSBotStyle.muted)
                            Button("重试") {
                                optionsFailed = false
                                Task { await loadOptions() }
                            }
                        }
                        .font(.system(size: 14))
                    } else {
                        ProgressView().tint(DSBotStyle.muted).frame(height: 44)
                    }
                    if failed {
                        Text("事项没能创建")
                            .font(.system(size: 13))
                            .foregroundStyle(DSBotStyle.chatError)
                            .accessibilityIdentifier("newissue.error")
                    }
                }
                .disabled(isCreating)
                .padding(20)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                    if height > 0, abs(formHeight - height) > 0.5 { formHeight = height }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
            .background(DSBotStyle.canvas)
            .onGeometryChange(for: CGFloat.self) { geometry in
                max(0, geometry.frame(in: .named(sheetSpace)).minY) + geometry.safeAreaInsets.top
            } action: { inset in
                if path.isEmpty, abs(formTopInset - inset) > 0.5 { formTopInset = inset }
            }
            .navigationTitle("新建事项")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .disabled(isCreating)
                        .accessibilityIdentifier("newissue.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        submit()
                    } label: {
                        if isCreating {
                            ProgressView()
                        } else {
                            Text("创建事项")
                        }
                    }
                    .disabled(!canCreate)
                    .accessibilityLabel("创建事项")
                    .accessibilityIdentifier("newissue.create")
                }
            }
            .navigationDestination(for: IssueCreationPicker.self) { picker in
                destination(picker)
            }
        }
        .coordinateSpace(name: sheetSpace)
        .background {
            SheetOutsideTapDismiss(isEnabled: !isCreating) { dismiss() }
        }
        .presentationDetents(path.isEmpty ? [.height(formHeight > 0 ? formHeight + formTopInset : 360)] : [.large])
        .presentationCornerRadius(32)
        .interactiveDismissDisabled(isCreating)
        .task { titleFocused = true }
        .task(id: "\(store.connectionRevision)/\(store.status)") { await loadOptions() }
        .onChange(of: store.activeComputer?.id) { _, id in
            if id != computerID { dismiss() }
        }
    }

    private var properties: some View {
        IssueValueFlow(spacing: 6) {
            chip(status?.title ?? "状态", identifier: "status", picker: .status) {
                IssueStatusIcon(type: status?.type ?? "todo", color: status?.color, iconProgress: status?.iconProgress)
            }
            chip(draft.priority == .none ? "优先级" : draft.priority.title, identifier: "priority", picker: .priority) {
                IssuePriorityIcon(priority: draft.priority)
            }
            chip(draft.project?.name ?? "项目", identifier: "project", picker: .project) {
                DSBotIcon(.issueProject, size: 16, scalesStroke: true)
            }
            if let folder = draft.project?.path, !folder.isEmpty {
                chip(draft.agent?.name ?? "智能体", identifier: "agent", picker: .agent) {
                    if let agent = draft.agent { AgentLogo(agent: agent, size: 16) }
                    else { DSBotIcon(.stateUnassigned, size: 16, scalesStroke: true) }
                }
            }
            chip(selectedLabels.isEmpty ? "标签" : selectedLabels.map(\.name).joined(separator: ", "), identifier: "labels", picker: .labels) {
                DSBotIcon(.issueLabel, size: 16, scalesStroke: true)
            }
            if let due = draft.dueAt {
                chip(due.formatted(.dateTime.month().day()), identifier: "due", picker: .due) {
                    DSBotIcon(.dueDate, size: 16, scalesStroke: true)
                }
            }
            Menu {
                Button { choose(.due) } label: { DSBotLabel("截止日期", icon: .dueDate) }
                Button { choose(.parent) } label: { DSBotLabel("设置父事项…", icon: .open) }
            } label: {
                ContextChipLabel(title: "更多", iconOnly: true) { DSBotIcon(.options, size: 16, scalesStroke: true) }
                    .frame(minHeight: 44)
            }
            .buttonStyle(DSBotQuietPressStyle())
            .accessibilityLabel("更多")
        }
        .disabled(store.status != .connected || !sameComputer)
    }

    private func chip<Icon: View>(_ title: String, identifier: String, picker: IssueCreationPicker, @ViewBuilder icon: @escaping () -> Icon) -> some View {
        Button { choose(picker) } label: {
            ContextChipLabel(title: title, maxTextWidth: 220, icon: icon)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(DSBotQuietPressStyle())
        .accessibilityLabel(title)
        .accessibilityIdentifier("newissue.\(identifier)")
    }

    private func parentChip(_ parent: BoardIssue) -> some View {
        HStack(spacing: 0) {
            Button { choose(.parent) } label: {
                HStack(spacing: 8) {
                    DSBotIcon(.open, size: 16, scalesStroke: true)
                    if let ref = parent.ref { Text(ref).foregroundStyle(DSBotStyle.muted) }
                    Text(parent.title).lineLimit(1)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
            }
            Button { draft.parent = nil } label: {
                DSBotIcon(.close, size: 16, scalesStroke: true).frame(width: 44, height: 44)
            }
            .accessibilityLabel("移除父事项")
        }
        .font(.system(size: 14))
        .foregroundStyle(DSBotStyle.chatSecondary)
        .background(DSBotStyle.chatPanel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DSBotStyle.chatBorder, lineWidth: 0.5))
        .buttonStyle(DSBotQuietPressStyle())
    }

    @ViewBuilder
    private func destination(_ picker: IssueCreationPicker) -> some View {
        switch picker {
        case .status:
            IssueChoiceList(title: "状态") {
                ForEach(options?.statuses ?? []) { item in
                    IssueChoiceRow(title: item.title, selected: draft.status == item.id) {
                        IssueStatusIcon(type: item.type, color: item.color, iconProgress: item.iconProgress)
                    } action: { draft.status = item.id; path.removeLast() }
                }
            }
        case .priority:
            IssueChoiceList(title: "优先级") {
                ForEach(IssuePriority.allCases) { item in
                    IssueChoiceRow(title: item.title, selected: draft.priority == item) {
                        IssuePriorityIcon(priority: item)
                    } action: { draft.priority = item; path.removeLast() }
                }
            }
        case .project:
            IssueProjectPicker(projects: options?.projects ?? [], selected: draft.project) { project in
                if project?.path != draft.project?.path { draft.agent = nil }
                draft.project = project
                path.removeLast()
            }
        case .agent:
            IssueChoiceList(title: "智能体") {
                IssueChoiceRow(title: "未分配", selected: draft.agent == nil) {
                    DSBotIcon(.stateUnassigned, size: 18, scalesStroke: true)
                } action: { draft.agent = nil; path.removeLast() }
                ForEach(store.agentChoices(keeping: draft.agent), id: \.rawValue) { item in
                    IssueChoiceRow(title: item.name, selected: draft.agent == item) {
                        AgentLogo(agent: item, size: 20)
                    } action: { draft.agent = item; path.removeLast() }
                }
            }
        case .labels:
            IssueLabelsPicker(
                labels: Binding(get: { options?.labels ?? [] }, set: { options?.labels = $0 }),
                selected: $draft.labels, board: board, store: store
            )
        case .due:
            IssueDuePicker(dueAt: draft.dueAt) { date in draft.dueAt = date; path.removeLast() }
        case .parent:
            IssueParentPicker(board: board, store: store) { parent in draft.parent = parent; path.removeLast() }
        case .newProject:
            IssueProjectCreatePage(board: board, store: store) { project in
                options?.projects.removeAll { $0.id == project.id }
                options?.projects.append(project)
                draft.project = project
                draft.agent = nil
                path = []
            }
        }
    }

    private func choose(_ picker: IssueCreationPicker) {
        titleFocused = false
        path.append(picker)
    }

    private func loadOptions() async {
        guard sameComputer, store.status == .connected else { return }
        optionsFailed = false
        async let catalog = board.creationOptions(using: store)
        if options == nil, let parent = parentToLoad, draft.parent?.id == parent.id {
            guard let full = await board.detail(of: parent, using: store), sameComputer, !Task.isCancelled else {
                if !Task.isCancelled && sameComputer { optionsFailed = true }
                return
            }
            if draft.parent?.id == parent.id, draft.project == nil { draft.project = full.projectInfo }
        }
        guard let fresh = await catalog, fresh.outcome == "success", sameComputer, !Task.isCancelled else {
            if !Task.isCancelled && sameComputer { optionsFailed = true }
            return
        }
        // Reconnecting refreshes the catalog while retaining every value already chosen for this draft.
        options = fresh
        if draft.status == nil { draft.status = fresh.statuses.first(where: \.isDefault)?.id ?? fresh.statuses.first?.id }
    }

    private func submit() {
        guard canCreate else { return }
        isCreating = true
        failed = false
        Task {
            let made = await board.create(draft, record: record, using: store)
            isCreating = false
            if made != nil {
                onCreated()
                dismiss()
            } else {
                failed = true
            }
        }
    }
}

/// The desktop's wrapping property row, sized from its pills without reading window geometry.
struct IssueValueFlow: Layout {
    let spacing: CGFloat

    private func arrange(_ subviews: Subviews, width: CGFloat) -> (sizes: [CGSize], origins: [CGPoint], height: CGFloat, width: CGFloat) {
        var sizes: [CGSize] = []
        var origins: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var usedWidth: CGFloat = 0
        for subview in subviews {
            var size = subview.sizeThatFits(.unspecified)
            if size.width > width { size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
            if x > 0 && x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            sizes.append(size)
            usedWidth = max(usedWidth, x + size.width)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (sizes, origins, y + rowHeight, usedWidth)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(subviews, width: proposal.width ?? .infinity)
        return CGSize(width: result.width, height: result.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(subviews, width: bounds.width)
        for index in subviews.indices {
            subviews[index].place(at: CGPoint(x: bounds.minX + result.origins[index].x, y: bounds.minY + result.origins[index].y), proposal: ProposedViewSize(result.sizes[index]))
        }
    }
}

/// An issue that has no conversation to open (nobody has it yet): what it says and where it stands, read only.
struct IssueDetailSheet: View {
    let issue: BoardIssue
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore

    @Environment(\.dismiss) private var dismiss
    @State private var full: BoardIssue?

    private var shown: BoardIssue { full ?? issue }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(shown.title)
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(DSBotStyle.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text([shown.reference, Self.statusName(shown.status), shown.project ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.muted)
                    if let words = full?.description, !words.isEmpty {
                        Text(words)
                            .font(.system(size: 16))
                            .foregroundStyle(DSBotStyle.ink)
                            .lineSpacing(4)
                            .textSelection(.enabled)
                            .padding(.top, 8)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
            .background(DSBotStyle.canvas)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button { dismiss() } label: {
                        DSBotIcon(.close, size: 18).foregroundStyle(DSBotStyle.ink)
                    }
                    .accessibilityLabel("关闭")
                    .accessibilityIdentifier("issue.detail.close")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(32)
        .task { full = await board.detail(of: issue, using: store) }
    }

    /// The desktop's names for the six statuses.
    private static func statusName(_ status: String) -> String {
        switch status {
        case "backlog": return "待规划"
        case "todo": return "待办"
        case "in_progress": return "处理中"
        case "in_review": return "待审核"
        case "done": return "已完成"
        case "canceled": return "已取消"
        default: return status
        }
    }
}
