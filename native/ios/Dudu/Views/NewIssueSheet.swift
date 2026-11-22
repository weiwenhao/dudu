import PhotosUI
import SwiftUI

enum IssueCreationPicker: Hashable {
    case status, priority, project, agent, labels, due, parent, newProject
}

/// Desktop's New issue values, in the app's native sheet and context pills.
struct NewIssueSheet: View {
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DuduStore
    @Environment(\.dismiss) private var dismiss
    @State private var draft: IssueCreationDraft
    @State private var options: IssueCreationOptions?
    @State private var path: [IssueCreationPicker] = []
    @State private var optionsFailed = false
    @State private var computerID: String?
    @State private var isCreating = false
    @State private var failed = false
    @State private var isPhotoPickerPresented = false
    @State private var pickedPhotos: [PhotosPickerItem] = []
    @State private var photoLoadGeneration = 0
    @State private var photosSkipped = false
    @State private var formHeight: CGFloat = 0
    @State private var formTopInset: CGFloat = 0
    @State private var detent: PresentationDetent = .height(360)
    @FocusState private var titleFocused: Bool

    let record: Int?
    let onCreated: () -> Void
    private let parentToLoad: BoardIssue?

    init(board: BoardModel, store: DuduStore, title: String = "", brief: String = "", record: Int? = nil, parent: BoardIssue? = nil, onCreated: @escaping () -> Void = {}) {
        self.board = board
        self.store = store
        self.record = record
        parentToLoad = parent?.projectInfo == nil && parent?.project != nil ? parent : nil
        _draft = State(initialValue: IssueCreationDraft(title: title, brief: brief, project: parent?.projectInfo, parent: parent))
        _computerID = State(initialValue: store.activeComputer?.id)
        self.onCreated = onCreated
    }

    /// The form, the bar above it and the home indicator below it (the key window's, which does not change when the keyboard is up).
    private var formDetent: PresentationDetent { .height(formHeight > 0 ? formHeight + formTopInset + DuduLayout.windowSafeAreaBottom : 360) }
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
                    TextField(L10n.text("事项标题"), text: $draft.title, axis: .vertical)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(DuduStyle.chatInk)
                        .lineLimit(1...4)
                        .focused($titleFocused)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                        .background(DuduStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityIdentifier("newissue.title")
                    TextField(L10n.text("添加描述…"), text: $draft.brief, axis: .vertical)
                        .font(.system(size: 16))
                        .foregroundStyle(DuduStyle.chatInk)
                        .lineLimit(4...8)
                        .padding(16)
                        .background(DuduStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityIdentifier("newissue.brief")
                    if !draft.photos.isEmpty { photoTiles }
                    if photosSkipped {
                        Text(L10n.text("部分照片未添加"))
                            .font(.system(size: 13))
                            .foregroundStyle(DuduStyle.chatError)
                            .accessibilityIdentifier("newissue.photos.skipped")
                    }
                    // The buttons are buttons, loaded or not (owner, 2026-11-17: "按钮不就是按钮吗"): what the computer supplies (the statuses, labels and projects) fills in when it arrives, and only a failure to load says so, under the row.
                    properties
                    if optionsFailed {
                        HStack(spacing: 12) {
                            Text(L10n.text("事项没能加载")).foregroundStyle(DuduStyle.muted)
                            Button(L10n.text("重试")) {
                                optionsFailed = false
                                Task { await loadOptions() }
                            }
                        }
                        .font(.system(size: 14))
                    }
                    if failed {
                        Text(L10n.text("事项没能创建"))
                            .font(.system(size: 13))
                            .foregroundStyle(DuduStyle.chatError)
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
            .photosPicker(
                isPresented: $isPhotoPickerPresented,
                selection: $pickedPhotos,
                maxSelectionCount: max(1, PhotoAttachments.maximumPhotoCount - draft.photos.count),
                matching: .images
            )
            .onChange(of: pickedPhotos) { _, items in addPhotos(items) }
            .background(DuduStyle.canvas)
            // The bar above the form: its safe area, and nothing else. The form's offset in the sheet used to be added as well; it is measured from the screen, so it grew as the sheet rose, and every
            // growth of the detent raised the sheet and the offset again until the sheet was full height with a blank page below the values (owner, 2026-11-17: "太高了吧，底下这么多空白").
            .onGeometryChange(for: CGFloat.self) { geometry in
                geometry.safeAreaInsets.top
            } action: { inset in
                if path.isEmpty, abs(formTopInset - inset) > 0.5 { formTopInset = inset }
            }
            .navigationTitle(L10n.text("新建事项"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton(label: L10n.text("取消")) { dismiss() }
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
                            Image(systemName: "checkmark")
                                .font(.system(size: 13, weight: .medium))
                                .frame(width: 20, height: 20)
                        }
                    }
                    .controlSize(.small)
                    .buttonBorderShape(.circle)
                    .disabled(!canCreate)
                    .accessibilityLabel(L10n.text("创建事项"))
                    .accessibilityIdentifier("newissue.create")
                }
            }
            .navigationDestination(for: IssueCreationPicker.self) { picker in
                destination(picker)
            }
        }
        .background {
            SheetOutsideTapDismiss(isEnabled: !isCreating) { dismiss() }
        }
        // The sheet is as tall as its form, and the form changes height (a picture row, a line that says the values did not load). A detent whose height changes is a different detent to the sheet, so the
        // selection follows it, as in the activity sheets.
        .presentationDetents(path.isEmpty ? [formDetent] : [.large], selection: $detent)
        .onChange(of: formDetent, initial: true) { _, new in if path.isEmpty { detent = new } }
        .onChange(of: path.isEmpty) { _, empty in detent = empty ? formDetent : .large }
        .presentationCornerRadius(32)
        .interactiveDismissDisabled(isCreating)
        .task {
            titleFocused = true
            #if DEBUG && targetEnvironment(simulator)
            await reviewPhotos()
            #endif
        }
        .task(id: "\(store.connectionRevision)/\(store.status)") { await loadOptions() }
        .onChange(of: store.activeComputer?.id) { _, id in
            if id != computerID { dismiss() }
        }
    }

    private var properties: some View {
        IssueValueFlow(spacing: 6) {
            chip(status?.title ?? L10n.text("状态"), identifier: "status", picker: .status, needsOptions: true) {
                IssueStatusIcon(type: status?.type ?? "todo", color: status?.color, iconProgress: status?.iconProgress)
            }
            chip(draft.priority == .none ? L10n.text("优先级") : draft.priority.title, identifier: "priority", picker: .priority) {
                IssuePriorityIcon(priority: draft.priority)
            }
            chip(draft.project?.name ?? L10n.text("项目"), identifier: "project", picker: .project, needsOptions: true) {
                DuduIcon(.issueProject, size: 16, scalesStroke: true)
            }
            if let folder = draft.project?.path, !folder.isEmpty {
                chip(draft.agent?.name ?? L10n.text("智能体"), identifier: "agent", picker: .agent) {
                    if let agent = draft.agent { AgentLogo(agent: agent, size: 16) }
                    else { DuduIcon(.stateUnassigned, size: 16, scalesStroke: true) }
                }
            }
            chip(selectedLabels.isEmpty ? L10n.text("标签") : selectedLabels.map(\.name).joined(separator: ", "), identifier: "labels", picker: .labels, needsOptions: true) {
                DuduIcon(.issueLabel, size: 16, scalesStroke: true)
            }
            if let due = draft.dueAt {
                chip(due.formatted(.dateTime.month().day()), identifier: "due", picker: .due) {
                    DuduIcon(.dueDate, size: 16, scalesStroke: true)
                }
            }
            Menu {
                Button { choose(.due) } label: { DuduLabel(L10n.text("截止日期"), icon: .dueDate, ink: 16) }
                Button { choose(.parent) } label: { DuduLabel(L10n.text("设置父事项…"), icon: .open, ink: 16) }
                // Pictures are offered only where the computer can keep them (an older plugin does not say so), and the row greys out at nine.
                if options?.attachments == true {
                    Button { choosePhotos() } label: { DuduLabel(L10n.text("添加图片"), icon: .plus, ink: 16) }
                        .disabled(draft.photos.count >= PhotoAttachments.maximumPhotoCount)
                        .accessibilityIdentifier("newissue.more.photos")
                }
            } label: {
                ContextChipLabel(title: L10n.text("更多"), iconOnly: true) { DuduIcon(.options, size: 16, scalesStroke: true) }
                    .frame(minHeight: 44)
            }
            .buttonStyle(DuduQuietPressStyle())
            .accessibilityLabel(L10n.text("更多"))
        }
        .disabled(store.status != .connected || !sameComputer)
    }

    /// The pictures waiting to be added, as the chat box shows them (76pt tiles, a round × in the corner, a tap for the full picture), and, until there are nine, a tile of the same size that adds more.
    private var photoTiles: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(draft.photos) { photo in
                    PhotoAttachmentPreview(photo: photo) { draft.photos.removeAll { $0.id == photo.id } }
                }
                if draft.photos.count < PhotoAttachments.maximumPhotoCount { addPhotoTile }
            }
            .padding(.horizontal, 20)
        }
        .padding(.horizontal, -20)
        .accessibilityIdentifier("newissue.photos")
    }

    private var addPhotoTile: some View {
        Button { choosePhotos() } label: {
            DuduIcon(.plus, size: 24, strokeWidth: 1.5)
                .foregroundStyle(DuduStyle.chatInk)
                .frame(width: AttachmentTile.size, height: AttachmentTile.size)
                .background(DuduStyle.sheet, in: AttachmentTile.shape)
                .overlay { AttachmentTile.shape.stroke(DuduStyle.chatBorder, lineWidth: 0.5) }
                .contentShape(AttachmentTile.shape)
        }
        .buttonStyle(DuduQuietPressStyle())
        .accessibilityLabel(L10n.text("添加图片"))
        .accessibilityIdentifier("newissue.photos.add")
    }

    private func chip<Icon: View>(_ title: String, identifier: String, picker: IssueCreationPicker, needsOptions: Bool = false, @ViewBuilder icon: @escaping () -> Icon) -> some View {
        Button { choose(picker) } label: {
            ContextChipLabel(title: title, maxTextWidth: 220, icon: icon)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(DuduQuietPressStyle())
        .disabled(needsOptions && options == nil)
        .accessibilityLabel(title)
        .accessibilityIdentifier("newissue.\(identifier)")
    }

    private func parentChip(_ parent: BoardIssue) -> some View {
        HStack(spacing: 0) {
            Button { choose(.parent) } label: {
                HStack(spacing: 8) {
                    DuduIcon(.open, size: 16, scalesStroke: true)
                    if let ref = parent.ref { Text(ref).foregroundStyle(DuduStyle.muted) }
                    Text(parent.title).lineLimit(1)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
            }
            Button { draft.parent = nil } label: {
                DuduIcon(.close, size: 16, scalesStroke: true).frame(width: 44, height: 44)
            }
            .accessibilityLabel(L10n.text("移除父事项"))
        }
        .font(.system(size: 14))
        .foregroundStyle(DuduStyle.chatSecondary)
        .background(DuduStyle.chatPanel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DuduStyle.chatBorder, lineWidth: 0.5))
        .buttonStyle(DuduQuietPressStyle())
    }

    @ViewBuilder
    private func destination(_ picker: IssueCreationPicker) -> some View {
        switch picker {
        case .status:
            IssueChoiceList(title: L10n.text("状态")) {
                ForEach(options?.statuses ?? []) { item in
                    IssueChoiceRow(title: item.title, selected: draft.status == item.id) {
                        IssueStatusIcon(type: item.type, color: item.color, iconProgress: item.iconProgress)
                    } action: { draft.status = item.id; path.removeLast() }
                }
            }
        case .priority:
            IssueChoiceList(title: L10n.text("优先级")) {
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
            IssueChoiceList(title: L10n.text("智能体")) {
                IssueChoiceRow(title: L10n.text("未分配"), selected: draft.agent == nil) {
                    DuduIcon(.stateUnassigned, size: 18, scalesStroke: true)
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

    #if DEBUG && targetEnvironment(simulator)
    /// Local review only, never in the phone's Release build: `-dudu-review-new-issue-photos N` starts the draft with N made-up pictures, because the system picker does not load in the simulator.
    private func reviewPhotos() async {
        let args = ProcessInfo.processInfo.arguments
        guard args.contains("-dudu-ui-review") else { return }
        defer {
            if args.contains("-dudu-review-new-issue-nokeyboard") { Task { try? await Task.sleep(for: .milliseconds(800)); titleFocused = false } }
        }
        guard let index = args.firstIndex(of: "-dudu-review-new-issue-photos"), args.indices.contains(index + 1),
              let count = Int(args[index + 1]), draft.photos.isEmpty else { return }
        draft.photos = (0..<min(count, PhotoAttachments.maximumPhotoCount)).map { number in
            let size = CGSize(width: 800, height: 600)
            let image = UIGraphicsImageRenderer(size: size).image { context in
                let hue = CGFloat((number * 47) % 360) / 360
                UIColor(hue: hue, saturation: 0.6, brightness: 0.85, alpha: 1).setFill()
                context.fill(CGRect(origin: .zero, size: size))
                UIColor(hue: hue, saturation: 0.7, brightness: 0.45, alpha: 1).setFill()
                context.fill(CGRect(x: 0, y: size.height / 2, width: size.width, height: size.height / 2))
                ("\(number + 1)" as NSString).draw(at: CGPoint(x: 60, y: 60), withAttributes: [.font: UIFont.systemFont(ofSize: 220, weight: .bold), .foregroundColor: UIColor.white])
            }
            let jpeg = image.jpegData(compressionQuality: 0.82) ?? Data()
            let upload = UploadAttachment(id: UUID().uuidString, name: "review-\(number + 1).jpg", mimeType: "image/jpeg", dataBase64: jpeg.base64EncodedString())
            return PreparedPhotoAttachment(attachment: upload, compressedBytes: jpeg.count, thumbnailData: nil, thumbnailImage: PreparedPhotoImage(image: image))
        }
    }
    #endif

    private func choosePhotos() {
        titleFocused = false
        photosSkipped = false
        isPhotoPickerPresented = true
    }

    private func addPhotos(_ items: [PhotosPickerItem]) {
        guard !items.isEmpty else { return }
        DuduLog.record("newissue.photos.select")
        photoLoadGeneration += 1
        let generation = photoLoadGeneration
        let existing = draft.photos
        Task {
            let result = await PhotoAttachments.load(items, existingCount: existing.count, existingBytes: existing.reduce(0) { $0 + $1.compressedBytes })
            guard generation == photoLoadGeneration else { return }
            draft.photos.append(contentsOf: result.photos)
            photosSkipped = result.rejectedCount > 0
            pickedPhotos = []
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

/// An issue's description; homepage assignment lives in the row's existing long-press menu.
struct IssueDetailSheet: View {
    let issue: BoardIssue
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DuduStore

    @Environment(\.dismiss) private var dismiss
    @State private var full: BoardIssue?
    @State private var loading = true
    @State private var loadFailed = false
    @State private var loadID = UUID()
    private let computerID: String?

    init(issue: BoardIssue, board: BoardModel, store: DuduStore) {
        self.issue = issue
        self.board = board
        self.store = store
        computerID = store.activeComputer?.id
    }

    private var shown: BoardIssue { full ?? issue }
    private var sameComputer: Bool { computerID != nil && computerID == store.activeComputer?.id }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(shown.title)
                        .font(.system(size: 19, weight: .semibold))
                        .foregroundStyle(DuduStyle.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text([shown.reference, Self.statusName(shown.status), shown.project ?? ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.system(size: 13))
                        .foregroundStyle(DuduStyle.muted)
                    if loading {
                        ProgressView().tint(DuduStyle.muted).padding(.vertical, 8)
                    } else if loadFailed {
                        HStack(spacing: 12) {
                            Text(L10n.text("事项没能加载")).foregroundStyle(DuduStyle.muted)
                            Button(L10n.text("重试")) { Task { await load() } }
                        }
                        .font(.system(size: 14))
                    }
                    if let words = full?.description, !words.isEmpty {
                        Text(words)
                            .font(.system(size: 16))
                            .foregroundStyle(DuduStyle.ink)
                            .lineSpacing(4)
                            .textSelection(.enabled)
                            .padding(.top, 8)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
            }
            .background(DuduStyle.canvas)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    SheetCloseButton { dismiss() }
                    .accessibilityIdentifier("issue.detail.close")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationCornerRadius(28)
        .task(id: "\(store.connectionRevision)/\(store.status)") { await load() }
        .onChange(of: store.activeComputer?.id) { _, id in if id != computerID { dismiss() } }
    }

    private func load() async {
        let request = UUID()
        loadID = request
        guard sameComputer, store.status == .connected else { loading = false; return }
        let connection = store.connectionRevision
        loading = full == nil
        loadFailed = false
        let detail = await board.detail(of: shown, using: store)
        guard !Task.isCancelled, loadID == request, sameComputer, connection == store.connectionRevision else { return }
        loading = false
        if let detail { full = detail } else { loadFailed = true }
    }

    /// The desktop's names for the six statuses.
    private static func statusName(_ status: String) -> String {
        switch status {
        case "backlog": return L10n.text("待规划")
        case "todo": return L10n.text("待办")
        case "in_progress": return L10n.text("处理中")
        case "in_review": return L10n.text("待审核")
        case "done": return L10n.text("已完成")
        case "canceled": return L10n.text("已取消")
        default: return status
        }
    }
}
