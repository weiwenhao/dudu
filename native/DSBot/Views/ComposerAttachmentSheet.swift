import SwiftUI

/// Sheet opened from the composer's "+" button. Photo and file tiles on top, then the DSH
/// commands that make sense on a phone. Goal, plan and compact act at once (goal moves into the
/// composer, plan toggles plan mode, compact runs immediately); permission, model and reasoning
/// level open a list.
/// Laid out like the system resource sheet it is modelled on: grey title, white tiles and white
/// grouped cards on a light sheet.
struct ComposerAttachmentSheet: View {
    enum Page: Equatable {
        case root, models, efforts, permissions
        /// Model and reasoning level together; what the model chip above the composer opens.
        case modelSettings
    }

    /// Metrics are in layout points. iOS 26 shows a partial-height sheet as a card inset 8pt from
    /// the screen edges and scales its content by (width - 16) / width, so these values land
    /// 4% smaller on screen — the proportions of the reference sheet it is modelled on.
    enum Layout {
        static let sideInset: CGFloat = 16
        static let titleBlock: CGFloat = 59
        static let tileSize: CGFloat = 80
        static let tileSpacing: CGFloat = 8
        static let tileRadius: CGFloat = 24
        static let tileGap: CGFloat = 30.5
        static let rowHeight: CGFloat = 60
        static let sectionGap: CGFloat = 20
        static let sectionHeader: CGFloat = 26
        static let bottomInset: CGFloat = 8
        static let cardRadius: CGFloat = 27
        static let maximumHeight: CGFloat = 600

        /// Height of the model chip's page: the model list and, when it has levels, the level list.
        static func height(modelRows: Int, effortRows: Int, modelGroups: Int = 1) -> CGFloat {
            let levels = effortRows > 0 ? sectionGap + sectionHeader + CGFloat(effortRows) * rowHeight : 0
            let sources = modelGroups > 1 ? CGFloat(modelGroups) * sectionHeader + CGFloat(modelGroups - 1) * sectionGap : 0
            return min(titleBlock + sources + CGFloat(max(1, modelRows)) * rowHeight + levels + bottomInset + 16, maximumHeight)
        }

        /// Content height of the root page; the sheet adds the bottom safe area itself. `primaryRows` is the card between the
        /// tiles and the commands (goal and plan); a page without one goes from the tiles straight to the commands.
        static func height(commandRows: Int, primaryRows: Int = 2) -> CGFloat {
            let primary = primaryRows > 0 ? tileGap + CGFloat(primaryRows) * rowHeight : 0
            let content = titleBlock + tileSize + primary + sectionGap
                + sectionHeader + CGFloat(commandRows) * rowHeight + bottomInset
            return min(content, maximumHeight)
        }
    }

    static let background = Color(white: 244.0 / 255)
    static let card = Color(white: 252.0 / 255)

    @ObservedObject var store: DSBotStore
    let canAddPhotos: Bool
    let canAddVideos: Bool
    let canAddFiles: Bool
    let onAddPhotos: () -> Void
    let onAddVideos: () -> Void
    let onAddFiles: () -> Void
    let onGoal: () -> Void
    let onPlan: () -> Void
    let onCompact: () -> Void
    let onStopTask: () -> Void
    let onClose: () -> Void

    @State private var page: Page
    @State private var riskyPermission: PermissionLabels.Confirmation?
    @State private var riskyPermissionID: String?

    init(
        store: DSBotStore,
        initialPage: Page = .root,
        canAddPhotos: Bool,
        canAddVideos: Bool,
        canAddFiles: Bool,
        onAddPhotos: @escaping () -> Void,
        onAddVideos: @escaping () -> Void,
        onAddFiles: @escaping () -> Void,
        onGoal: @escaping () -> Void,
        onPlan: @escaping () -> Void,
        onCompact: @escaping () -> Void,
        onStopTask: @escaping () -> Void,
        onClose: @escaping () -> Void
    ) {
        self.store = store
        self.canAddPhotos = canAddPhotos
        self.canAddVideos = canAddVideos
        self.canAddFiles = canAddFiles
        self.onAddPhotos = onAddPhotos
        self.onAddVideos = onAddVideos
        self.onAddFiles = onAddFiles
        self.onGoal = onGoal
        self.onPlan = onPlan
        self.onCompact = onCompact
        self.onStopTask = onStopTask
        self.onClose = onClose
        _page = State(initialValue: initialPage)
    }

    var isTaskRunning: Bool { store.selectedSession?.status == "running" }

    /// Rows in the second card of the root page; the presenter sizes the sheet from it.
    static func commandRowCount(isTaskRunning: Bool, hasReasoningLevels: Bool = false) -> Int {
        3 + (isTaskRunning ? 1 : 0) + (hasReasoningLevels ? 1 : 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            titleRow
                .frame(height: Layout.titleBlock, alignment: .top)
            ScrollView {
                pageContent
                    .padding(.horizontal, Layout.sideInset)
                    .padding(.bottom, Layout.bottomInset)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            .accessibilityIdentifier("composer.sheet.content")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Self.background)
        .animation(.easeOut(duration: 0.18), value: page)
        .alert(
            riskyPermission?.title ?? "",
            isPresented: Binding(
                get: { riskyPermission != nil },
                set: { if !$0 { riskyPermission = nil; riskyPermissionID = nil } }
            ),
            presenting: riskyPermission
        ) { confirmation in
            Button(confirmation.action, role: .destructive) {
                guard let id = riskyPermissionID else { return }
                DSBotLog.record("permission.select")
                onClose()
                Task { await store.configure(permissionId: id) }
            }
            Button(L10n.text("取消"), role: .cancel) {}
        } message: { confirmation in
            Text(confirmation.message)
        }
        #if DEBUG && targetEnvironment(simulator)
        .onAppear {
            let arguments = ProcessInfo.processInfo.arguments
            if arguments.contains("-dsbot-review-sheet-models") { page = .models }
            if arguments.contains("-dsbot-review-sheet-efforts") { page = .efforts }
            if arguments.contains("-dsbot-review-sheet-model-settings") { page = .modelSettings }
            if arguments.contains("-dsbot-review-sheet-permissions") { page = .permissions }
        }
        #endif
    }

    // MARK: Title

    @ViewBuilder
    private var titleRow: some View {
        if page == .root || page == .modelSettings {
            Text(pageTitle)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color(white: 0.4))
                .padding(.leading, 40.5)
                .padding(.top, 22)
                .accessibilityAddTraits(.isHeader)
        } else {
            Button {
                page = .root
            } label: {
                HStack(spacing: 6) {
                    DSBotIcon(.back, size: 18)
                    Text(pageTitle)
                        .font(.system(size: 17, weight: .semibold))
                }
                .foregroundStyle(Color(white: 0.4))
                .frame(height: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.leading, 32)
            .padding(.top, 10)
            .accessibilityLabel(L10n.text("返回"))
            .accessibilityIdentifier("composer.sheet.back")
        }
    }

    private var pageTitle: String {
        switch page {
        case .root: return L10n.text("添加")
        case .models, .modelSettings: return L10n.text("模型")
        case .efforts: return L10n.text("推理等级")
        case .permissions: return L10n.text("权限")
        }
    }

    // MARK: Pages

    @ViewBuilder
    private var pageContent: some View {
        switch page {
        case .root:
            VStack(alignment: .leading, spacing: 0) {
                tileRow
                // 嘟嘟's own conversation has no goal or plan, so its sheet goes from the tiles straight to the commands.
                if !store.isAssistantConversation {
                    goalAndPlanCard.padding(.top, Layout.tileGap)
                }
                sectionTitle(L10n.text("指令"))
                commandCard
            }
        case .models:
            modelList(closesOnSelection: true)
        case .modelSettings:
            VStack(alignment: .leading, spacing: 0) {
                modelList(closesOnSelection: false)
                if !store.currentEfforts.isEmpty {
                    sectionTitle(L10n.text("推理等级"))
                    choiceList(
                        store.currentEfforts.map { ($0.id, $0.name) },
                        selected: store.effectiveEffort,
                        empty: L10n.text("当前模型未提供推理等级"),
                        identifierPrefix: "composer.effort."
                    ) { id in
                        DSBotLog.record("effort.select")
                        Task { await store.configure(reasoningEffort: id) }
                    }
                }
            }
        case .efforts:
            choiceList(
                store.currentEfforts.map { ($0.id, $0.name) },
                selected: store.effectiveEffort,
                empty: L10n.text("当前模型未提供推理等级"),
                identifierPrefix: "composer.effort."
            ) { id in
                DSBotLog.record("effort.select")
                onClose()
                Task { await store.configure(reasoningEffort: id) }
            }
        case .permissions:
            choiceList(
                store.permissions.map { ($0.id, $0.name) },
                selected: store.selectedPermissionId,
                empty: L10n.text("暂无权限选项"),
                identifierPrefix: "composer.permission."
            ) { id in
                // Presets that run with fewer confirmations ask first, as DSH does.
                if id != store.selectedPermissionId, let confirmation = PermissionLabels.confirmation(for: id) {
                    riskyPermissionID = id
                    riskyPermission = confirmation
                    return
                }
                DSBotLog.record("permission.select")
                onClose()
                Task { await store.configure(permissionId: id) }
            }
        }
    }

    private var tileRow: some View {
        HStack(spacing: Layout.tileSpacing) {
            tile(.image, label: L10n.text("照片"), identifier: "composer.photos", isEnabled: canAddPhotos, action: onAddPhotos)
            tile(.video, label: L10n.text("发送视频"), identifier: "composer.videos", isEnabled: canAddVideos, action: onAddVideos)
            tile(.attach, label: L10n.text("文件"), identifier: "composer.files", isEnabled: canAddFiles, action: onAddFiles)
        }
    }

    private func tile(
        _ glyph: DSBotGlyph,
        label: String,
        identifier: String,
        isEnabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            DSBotIcon(glyph, size: 24)
                .foregroundStyle(isEnabled ? Color.black : DSBotStyle.muted)
                .frame(width: Layout.tileSize, height: Layout.tileSize)
                .background(Self.card, in: RoundedRectangle(cornerRadius: Layout.tileRadius, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: Layout.tileRadius, style: .continuous))
        }
        .buttonStyle(ComposerSheetPressStyle())
        .disabled(!isEnabled)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }

    private var goalAndPlanCard: some View {
        VStack(spacing: 0) {
            commandRow(
                icon: .goal, title: L10n.text("目标"),
                showsChevron: false, identifier: "composer.goal", isEnabled: true
            ) { onGoal() }
            separator
            commandRow(
                icon: .plan, title: store.planMode ? L10n.text("退出计划模式") : L10n.text("计划"),
                showsChevron: false, isSelected: store.planMode,
                identifier: "composer.plan", isEnabled: !store.isChangingPlanMode
            ) { onPlan() }
        }
        .background(Self.card, in: RoundedRectangle(cornerRadius: Layout.cardRadius, style: .continuous))
    }

    private var commandCard: some View {
        VStack(spacing: 0) {
            commandRow(
                icon: .compact, title: L10n.text("压缩"),
                showsChevron: false, identifier: "composer.compact", isEnabled: !isTaskRunning
            ) { onCompact() }
            separator
            commandRow(
                icon: .permission, title: L10n.text("权限"),
                value: selectedName(store.permissions.map { ($0.id, $0.name) }, store.selectedPermissionId),
                identifier: "composer.menu.permission", isEnabled: !store.permissions.isEmpty
            ) { page = .permissions }
            separator
            commandRow(
                icon: .model, title: L10n.text("模型"),
                value: store.currentModelName,
                identifier: "composer.menu.model", isEnabled: !store.models.isEmpty
            ) { page = .models }
            if !store.currentEfforts.isEmpty {
                separator
                commandRow(
                    icon: .think, title: L10n.text("推理等级"),
                    value: store.effortName,
                    identifier: "composer.menu.effort", isEnabled: true
                ) { page = .efforts }
            }
            if isTaskRunning {
                separator
                commandRow(
                    icon: .stop, title: L10n.text("停止任务"), showsChevron: false,
                    identifier: "composer.stop", isEnabled: true
                ) {
                    DSBotLog.record("session.stop")
                    onClose()
                    onStopTask()
                }
            }
        }
        .background(Self.card, in: RoundedRectangle(cornerRadius: Layout.cardRadius, style: .continuous))
    }

    private func sectionTitle(_ title: String, isFirst: Bool = false) -> some View {
        Text(title)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(DSBotStyle.muted)
            .padding(.leading, 24)
            .padding(.top, isFirst ? 0 : Layout.sectionGap)
            .frame(height: Layout.sectionHeader + (isFirst ? 0 : Layout.sectionGap), alignment: .bottomLeading)
            .accessibilityAddTraits(.isHeader)
    }

    private var separator: some View {
        Rectangle()
            .fill(Color(white: 233.0 / 255))
            .frame(height: 0.5)
            .padding(.leading, 51)
            .padding(.trailing, 17)
    }

    private func commandRow(
        icon: DSBotGlyph,
        title: String,
        value: String? = nil,
        showsChevron: Bool = true,
        isSelected: Bool = false,
        identifier: String,
        isEnabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 0) {
                DSBotIcon(icon, size: 24)
                    .frame(width: 24, height: 24)
                    .padding(.leading, 15)
                Text(title)
                    .font(.system(size: 17))
                    .padding(.leading, 13)
                Spacer(minLength: 12)
                if let value {
                    Text(value)
                        .font(.system(size: 15))
                        .foregroundStyle(DSBotStyle.muted)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: 130, alignment: .trailing)
                }
                if isSelected {
                    DSBotIcon(.check, size: 20)
                        .padding(.leading, 6)
                } else if showsChevron {
                    DSBotIcon(.right, size: 16)
                        .foregroundStyle(DSBotStyle.muted)
                        .padding(.leading, 6)
                }
            }
            .padding(.trailing, 16)
            .foregroundStyle(isEnabled ? Color.black : DSBotStyle.muted)
            .frame(height: Layout.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(ComposerSheetPressStyle())
        .disabled(!isEnabled)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(value ?? "")
        .accessibilityAddTraits(.isButton)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .accessibilityIdentifier(identifier)
    }

    // MARK: Choice pages

    private func modelList(closesOnSelection: Bool) -> some View {
        let groups = store.currentModelGroups
        return VStack(alignment: .leading, spacing: 0) {
            if groups.isEmpty {
                modelChoices([], closesOnSelection: closesOnSelection)
            } else {
                ForEach(Array(groups.enumerated()), id: \.element.id) { index, group in
                    if groups.count > 1 { sectionTitle(group.name, isFirst: index == 0) }
                    modelChoices(group.models, closesOnSelection: closesOnSelection)
                }
            }
        }
    }

    private func modelChoices(_ models: [Choice], closesOnSelection: Bool) -> some View {
        choiceList(
            models.map { ($0.id, $0.name) },
            selected: store.selectedModelId,
            empty: L10n.text("暂无可选模型"),
            identifierPrefix: "composer.model."
        ) { id in
            DSBotLog.record("model.select")
            if closesOnSelection { onClose() }
            Task { await store.configure(modelId: id) }
        }
    }

    private func choiceList(
        _ choices: [(id: String, name: String)],
        selected: String?,
        empty: String,
        identifierPrefix: String,
        onSelect: @escaping (String) -> Void
    ) -> some View {
        VStack(spacing: 0) {
            if choices.isEmpty {
                Text(empty)
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                    .frame(maxWidth: .infinity, minHeight: Layout.rowHeight)
            } else {
                ForEach(Array(choices.enumerated()), id: \.element.id) { index, choice in
                    if index > 0 {
                        Rectangle()
                            .fill(Color(white: 233.0 / 255))
                            .frame(height: 0.5)
                            .padding(.leading, 20)
                            .padding(.trailing, 16)
                    }
                    Button {
                        onSelect(choice.id)
                    } label: {
                        HStack {
                            Text(choice.name)
                                .font(.system(size: 17))
                                .foregroundStyle(Color.black)
                                .lineLimit(1)
                            Spacer(minLength: 12)
                            if choice.id == selected {
                                DSBotIcon(.check, size: 20)
                                    .foregroundStyle(DSBotStyle.ink)
                            }
                        }
                        .padding(.horizontal, 20)
                        .frame(height: Layout.rowHeight)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(ComposerSheetPressStyle())
                    .accessibilityLabel(choice.name)
                    .accessibilityAddTraits(choice.id == selected ? .isSelected : [])
                    .accessibilityIdentifier(identifierPrefix + choice.id)
                }
            }
        }
        .background(Self.card, in: RoundedRectangle(cornerRadius: Layout.cardRadius, style: .continuous))
    }

    private func selectedName(_ choices: [(id: String, name: String)], _ id: String?) -> String? {
        choices.first { $0.id == id }?.name
    }
}

private struct ComposerSheetPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}
