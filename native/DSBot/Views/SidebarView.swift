import SwiftUI

struct SidebarView: View {
    @ObservedObject var store: DSBotStore
    @AppStorage("dsbot.sidebar.grouping") private var groupingRaw = SidebarGrouping.workspace.rawValue
    @AppStorage("dsbot.sidebar.archive") private var archiveRaw = SidebarArchiveFilter.hide.rawValue
    /// Ids of the workspaces the user folded, kept as a JSON list.
    @AppStorage("dsbot.sidebar.collapsed") private var collapsedRaw = "[]"
    @State private var renaming: SidebarGroup?
    @State private var renameText = ""
    @State private var deleting: SidebarGroup?
    @State private var archivedChoice: SessionSummary?
    @State private var renamingSession: SessionSummary?
    @State private var sessionTitle = ""
    @State private var isMoreExpanded = SidebarView.startsExpanded
    /// The strip under the home indicator, which the list runs on into.
    @Environment(\.homeIndicatorInset) private var homeInset

    /// The entry of DSH's sidebar that is on screen, if the main area shows one.
    let selectedItemID: String?
    /// A number to show at the end of an entry's row (the records waiting in the Collector), by the entry's id.
    let itemCounts: [String: Int]
    var isActive = true
    let onChooseItem: (NavigationItem) -> Void
    let onChooseConversation: () -> Void
    let onOpenComputers: () -> Void
    let onOpenSettings: () -> Void
    let onSearch: () -> Void
    let onClose: () -> Void

    init(
        store: DSBotStore,
        onChooseItem: @escaping (NavigationItem) -> Void,
        onChooseConversation: @escaping () -> Void,
        onOpenComputers: @escaping () -> Void,
        onOpenSettings: @escaping () -> Void,
        onSearch: @escaping () -> Void,
        onClose: @escaping () -> Void,
        selectedItemID: String? = nil,
        itemCounts: [String: Int] = [:],
        isActive: Bool = true
    ) {
        self.store = store
        self.selectedItemID = selectedItemID
        self.itemCounts = itemCounts
        self.isActive = isActive
        self.onChooseItem = onChooseItem
        self.onChooseConversation = onChooseConversation
        self.onOpenComputers = onOpenComputers
        self.onOpenSettings = onOpenSettings
        self.onSearch = onSearch
        self.onClose = onClose
    }

    private var options: SidebarOptions {
        SidebarOptions(
            grouping: SidebarGrouping(rawValue: groupingRaw) ?? .workspace,
            archive: SidebarArchiveFilter(rawValue: archiveRaw) ?? .hide
        )
    }

    private var collapsed: Set<String> {
        Set((try? JSONDecoder().decode([String].self, from: Data(collapsedRaw.utf8))) ?? [])
    }

    private func setCollapsed(_ id: String, _ isCollapsed: Bool) {
        var ids = collapsed
        if isCollapsed { ids.insert(id) } else { ids.remove(id) }
        collapsedRaw = (try? JSONEncoder().encode(ids.sorted())).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
    }

    var body: some View {
        DSBotGlassGroup(spacing: 8) {
            VStack(spacing: 0) {
                brandHeader
                    .padding(.horizontal, 20)
                    .padding(.top, 8)
                    .padding(.bottom, 10)

                searchField
                    .padding(.horizontal, DSBotLayout.sidebarPadding)
                    .padding(.bottom, 16)

                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 18) {
                        libraryButtons
                        sessionsList
                    }
                    .padding(.horizontal, DSBotLayout.sidebarPadding)
                    .padding(.bottom, listBottomPadding)
                }
                .padding(.bottom, DSBotScrollEdges.usesSystemEffect ? 0 : -homeInset)
            }
            .modifier(DSBotScrollEdgeBar(edge: .bottom) {
                accountFooter(homeInset: homeInset)
            })
        }
        .background(DSBotStyle.canvas)
        .accessibilityElement(children: .contain)
        .task(id: SidebarLoad(active: isActive, connected: store.status == .connected)) {
            guard isActive, store.status == .connected else { return }
            await store.refreshSessions(quiet: !store.sessions.isEmpty || !store.workspaces.isEmpty)
            while !Task.isCancelled && store.status == .connected {
                do { try await Task.sleep(for: .seconds(5)) }
                catch { return }
                if !Task.isCancelled { await store.refreshSessions(quiet: true) }
            }
        }
        .onChange(of: groupingRaw) { _, grouping in
            DSBotLog.record("sidebar.grouping", state: grouping)
        }
        .alert(L10n.text("重命名会话"), isPresented: Binding(
            get: { renamingSession != nil }, set: { if !$0 { renamingSession = nil } }
        )) {
            TextField(L10n.text("会话名称"), text: $sessionTitle)
            Button(L10n.text("取消"), role: .cancel) { renamingSession = nil }
            Button(L10n.text("重命名")) {
                guard let id = renamingSession?.id else { return }
                let title = sessionTitle
                renamingSession = nil
                Task { await store.renameSession(id, to: title) }
            }
        }
        .alert(L10n.text("重命名工作区"), isPresented: Binding(
            get: { renaming != nil }, set: { if !$0 { renaming = nil } }
        )) {
            TextField(L10n.text("工作区名称"), text: $renameText)
            Button(L10n.text("取消"), role: .cancel) { renaming = nil }
            Button(L10n.text("重命名")) {
                guard let workspaceId = renaming?.workspaceId else { return }
                let title = renameText
                renaming = nil
                Task { await store.renameWorkspace(workspaceId, to: title) }
            }
        }
        .alert(
            deleting.map { L10n.text("删除工作区「{0}」？", "\($0.title)") } ?? L10n.text("删除工作区"),
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
        ) {
            Button(L10n.text("取消"), role: .cancel) { deleting = nil }
            Button(L10n.text("删除"), role: .destructive) {
                guard let workspaceId = deleting?.workspaceId else { return }
                deleting = nil
                Task { await store.deleteWorkspace(workspaceId) }
            }
        } message: {
            Text(L10n.text("只移除工作区的登记。目录和其中的会话都会保留，会话会显示在「未分组」下。"))
        }
        .alert(
            L10n.text("已归档的会话"),
            isPresented: Binding(get: { archivedChoice != nil }, set: { if !$0 { archivedChoice = nil } })
        ) {
            Button(L10n.text("取消"), role: .cancel) { archivedChoice = nil }
            Button(L10n.text("取消归档")) {
                guard let session = archivedChoice else { return }
                archivedChoice = nil
                Task { await store.unarchiveSession(session.id) }
            }
        } message: {
            Text(L10n.text("取消归档后才能打开。"))
        }
    }

    private struct SidebarLoad: Equatable {
        let active: Bool
        let connected: Bool
    }

    private var listBottomPadding: CGFloat {
        // The native bar reserves its own height; the overlay fallback needs that room here.
        DSBotScrollEdges.usesSystemEffect ? 16
            : SidebarMetrics.footerHeight + SidebarMetrics.footerBottomGap + 16 + homeInset
    }

    private var brandHeader: some View {
        HStack {
            Text("Dudu")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DSBotStyle.ink)

            Spacer()

            Button {
                onChooseConversation()
                DSBotLog.record("session.create")
                store.beginNewTask()
            } label: {
                DSBotIcon(.plus, size: 20)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
            }
            .buttonStyle(DSBotGlassButtonStyle())
            .accessibilityLabel(L10n.text("新建会话"))
            .accessibilityIdentifier("session.new")
        }
        .frame(height: 44)
    }

    /// `-dsbot-review-sidebar-more` opens 查看更多 from the start (the simulator has no finger).
    private static var startsExpanded: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("-dsbot-review-sidebar-more")
        #else
        return false
        #endif
    }

    private var searchField: some View {
        Button(action: onSearch) {
            HStack(spacing: 10) {
                DSBotIcon(.search, size: 18)
                Text(L10n.text("搜索对话内容…"))
                    .font(.system(size: 14))
                Spacer(minLength: 0)
            }
            .foregroundStyle(DSBotStyle.muted)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .dsbotGlass(in: Capsule(), interactive: true)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("sidebar.search")
    }

    /// The approved primary entries stay visible. The remaining registry entries share the same
    /// rows and columns, folded by default, with no additional indentation.
    private var libraryButtons: some View {
        VStack(spacing: 2) {
            ForEach(store.activeNavigation.primarySidebar) { item in
                libraryButton(item)
            }
            if !store.activeNavigation.additionalSidebar.isEmpty {
                DisclosureGroup(isExpanded: $isMoreExpanded) {
                    VStack(spacing: 2) {
                        ForEach(store.activeNavigation.additionalSidebar) { item in
                            libraryButton(item)
                        }
                    }
                } label: {
                    HStack(spacing: 12) {
                        DSBotIcon(.options, size: 20)
                            .frame(width: 24, height: 24)
                        Text(L10n.text("查看更多"))
                    }
                }
                .disclosureGroupStyle(SidebarNavigationDisclosureStyle())
            }
            if store.activeNavigation.sidebar.isEmpty, let hint = navigationHint {
                Text(hint)
                    .font(.system(size: 12))
                    .foregroundStyle(DSBotStyle.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .accessibilityIdentifier("sidebar.navigation.hint")
            }
        }
    }

    /// Say why DSH's entries are missing instead of listing a guess at them.
    private var navigationHint: String? {
        switch store.navigationAvailability {
        case .unsupported: return L10n.text("电脑上的 Dudu 插件需要更新后，这里才会显示 DSH 的入口。")
        case .waiting: return L10n.text("打开一次电脑上的 DSH 窗口后，这里会显示 DSH 的入口。")
        case .unknown, .ready: return nil
        }
    }

    private func libraryButton(_ item: NavigationItem) -> some View {
        let title = item.target == .tasks ? L10n.text("定时任务") : item.title
        return Button {
            onChooseItem(item)
        } label: {
            HStack(spacing: 12) {
                libraryIcon(item)
                    .frame(width: 24, height: 24)
                Text(title)
                    .lineLimit(1)
                if item.target == .assistant, store.isOpeningAssistant {
                    Spacer(minLength: 0)
                    ProgressView()
                        .controlSize(.small)
                        .tint(DSBotStyle.muted)
                        .frame(width: 20, height: 20)
                } else if let count = itemCounts[item.id] {
                    Spacer(minLength: 0)
                    Text("\(count)")
                        .font(.system(size: 13, weight: .regular))
                        .foregroundStyle(DSBotStyle.muted)
                        .monospacedDigit()
                        .padding(.trailing, 2)
                        .accessibilityLabel(item.target == .tasks ? L10n.plural("\(count) 个任务") : L10n.plural("\(count) 条"))
                }
            }
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(DSBotStyle.ink)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, 10)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .background(
                selectedItemID == item.id ? DSBotStyle.selected : Color.clear,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
        }
        .buttonStyle(DSBotRowButtonStyle())
        .disabled(item.target == .assistant && (store.isOpeningAssistant || store.status != .connected))
        .accessibilityLabel(title)
        .accessibilityIdentifier("library.\(item.id)")
    }

    /// The icon DSH gave the entry; a glyph of the app's own when it gave none.
    @ViewBuilder
    private func libraryIcon(_ item: NavigationItem) -> some View {
        if item.target == .assistant {
            DuduLogo(size: 28)
        } else if let icon = item.icon {
            NavigationIconView(icon: icon, size: 20)
        } else {
            // The app's own glyph for an entry that came without a picture, at the weight of the pictures around it: a Lucide icon of a 24 grid at 20pt has a line of 1.67pt (the plugin's own
            // icons, 看板 and 收件箱, are drawn so), and the plain 2pt of `DSBotIcon` made it the one bold icon of the list (owner, 2026-11-10: "那个定时任务的图标也很奇怪，是加粗的").
            DSBotIcon(glyph(for: item), size: 20, scalesStroke: true)
        }
    }

    private func glyph(for item: NavigationItem) -> DSBotGlyph {
        switch item.target {
        case .tasks: return .schedule
        case .files: return .folder
        case .collector: return .inbox
        case .web(.plugins, _): return .plugins
        default: return .panel
        }
    }

    private var entries: [SidebarEntry] {
        SidebarList.entries(
            sessions: store.sessions, workspaces: store.workspaces, options: options,
            collapsed: collapsed
        )
    }

    /// The conversations, the way DSH's sidebar lists them.
    private var sessionsList: some View {
        let entries = self.entries
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(options.grouping == .flat ? L10n.text("会话") : L10n.text("工作区"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSBotStyle.muted)
                Spacer()
                viewOptionsMenu
            }
            .padding(.leading, SidebarMetrics.textLeading)
            .padding(.trailing, SidebarMetrics.trailing)

            if store.isLoadingSessions && entries.isEmpty {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(DSBotStyle.muted)
                    Text(L10n.text("正在加载会话"))
                        .font(.system(size: 12))
                        .foregroundStyle(DSBotStyle.muted)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .accessibilityIdentifier("sidebar.sessions.loading")
            }

            if let sessionsError = store.sessionsError {
                HStack(alignment: .top, spacing: 8) {
                    Text(sessionsError)
                        .font(.system(size: 12))
                        .foregroundStyle(DSBotStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button(L10n.text("重试")) {
                        Task { await store.refreshSessions() }
                    }
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(DSBotStyle.ink)
                    .accessibilityIdentifier("sidebar.sessions.retry")
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .accessibilityIdentifier("sidebar.sessions.error")
            }

            if entries.isEmpty {
                if store.sessionsError == nil && !store.isLoadingSessions {
                    Text(emptyListText)
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.muted)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                }
            } else {
                LazyVStack(spacing: 2) {
                    ForEach(entries) { entry in
                        switch entry {
                        case let .group(group, isCollapsed):
                            groupHeader(group, isCollapsed: isCollapsed)
                        case let .session(session):
                            sessionRow(session)
                        }
                    }
                }
            }
        }
    }

    private var emptyListText: String {
        return options.archive == .only ? L10n.text("暂无已归档会话") : L10n.text("暂无会话")
    }

    /// DSH's 视图选项: how conversations are grouped, and which archived ones show.
    private var viewOptionsMenu: some View {
        Menu {
            Section(L10n.text("分组方式")) {
                Picker(L10n.text("分组方式"), selection: $groupingRaw) {
                    Text(L10n.text("按工作区")).tag(SidebarGrouping.workspace.rawValue)
                    Text(L10n.text("单列表")).tag(SidebarGrouping.flat.rawValue)
                }
            }
            Section(L10n.text("筛选会话")) {
                Picker(L10n.text("筛选会话"), selection: $archiveRaw) {
                    Text(L10n.text("隐藏已归档")).tag(SidebarArchiveFilter.hide.rawValue)
                    Text(L10n.text("全部对话（显示已归档）")).tag(SidebarArchiveFilter.all.rawValue)
                    Text(L10n.text("仅显示已归档")).tag(SidebarArchiveFilter.only.rawValue)
                }
            }
        } label: {
            DSBotChecklistGlyph(size: 20)
                .foregroundStyle(DSBotStyle.muted)
                .frame(width: DSBotLayout.actionColumnWidth, height: 42)
                .contentShape(Rectangle())
        }
        .buttonStyle(DSBotIconButtonStyle())
        .accessibilityLabel(L10n.text("会话视图选项"))
        .accessibilityIdentifier("sidebar.sort")
    }

    private func groupHeader(_ group: SidebarGroup, isCollapsed: Bool) -> some View {
        SidebarGroupHeader(
            group: group,
            isCollapsed: isCollapsed,
            onToggle: { withAnimation(.easeOut(duration: 0.18)) { setCollapsed(group.id, !isCollapsed) } },
            onCreate: {
                guard let workspaceId = group.workspaceId else { return }
                onChooseConversation()
                DSBotLog.record("session.create")
                Task { await store.startNewSession(workspaceId: workspaceId) }
            },
            onRename: {
                renameText = group.title
                renaming = group
            },
            onDelete: { deleting = group }
        )
    }

    private func sessionRow(_ session: SessionSummary) -> some View {
        SidebarSessionRow(
            session: session,
            selectedSessionID: store.selectedSession?.id,
            onSelect: {
                if session.archived == true {
                    archivedChoice = session
                    return
                }
                onChooseConversation()
                DSBotLog.record("session.select")
                Task { await store.selectSession(session) }
            },
            onRename: {
                sessionTitle = session.title
                renamingSession = session
            },
            onTogglePin: {
                DSBotLog.record(session.pinned == true ? "session.unpin" : "session.pin")
                Task { await store.setSessionPinned(session.id, session.pinned != true) }
            },
            onArchive: {
                DSBotLog.record("session.archive")
                Task { await store.archiveSession(session.id) }
            },
            onUnarchive: {
                DSBotLog.record("session.unarchive")
                Task { await store.unarchiveSession(session.id) }
            }
        )
        .equatable()
    }

    /// The computer and the settings float over the list, on glass, and the list blurs away beneath them
    /// towards the bottom edge of the screen: no line, no band between the two.
    private func accountFooter(homeInset: CGFloat) -> some View {
        HStack(spacing: 8) {
            Button(action: onOpenComputers) {
                HStack(spacing: 9) {
                    DSBotIcon(.computer, size: 20)
                        .foregroundStyle(DSBotStyle.muted)
                    Text(store.activeComputer?.name ?? L10n.text("选择电脑"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DSBotStyle.ink)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    DSBotIcon(.down, size: 13)
                        .foregroundStyle(DSBotStyle.muted)
                        .fixedSize()
                }
                .padding(.horizontal, 16)
                .frame(height: SidebarMetrics.footerHeight)
                .contentShape(Capsule())
            }
            .buttonStyle(DSBotGlassCapsuleButtonStyle())
            .accessibilityLabel(L10n.text("电脑连接"))
            .accessibilityIdentifier("computers.open")

            Spacer(minLength: 0)

            Button(action: onOpenSettings) {
                DSBotIcon(.settings)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: DSBotLayout.actionColumnWidth, height: SidebarMetrics.footerHeight)
                    .contentShape(Circle())
            }
            .buttonStyle(DSBotGlassButtonStyle())
            .accessibilityLabel(L10n.text("设置"))
            .accessibilityIdentifier("settings.open")
        }
        .padding(.trailing, SidebarMetrics.trailing)
        .padding(.horizontal, DSBotLayout.sidebarPadding)
        .padding(.bottom, SidebarMetrics.footerBottomGap)
        .background {
            if !DSBotScrollEdges.usesSystemEffect {
                DSBotPanelBackdrop(
                    horizontalExtension: 0,
                    topExtension: 16,
                    bottomExtension: homeInset,
                    tintOpacity: 0.65
                )
            }
        }
    }
}

/// SwiftUI owns the disclosure state; its presentation follows the app's existing navigation rows.
/// Content stays at the same leading edge as the primary entries.
private struct SidebarNavigationDisclosureStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) {
                    configuration.isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 12) {
                    configuration.label
                    Spacer(minLength: 0)
                    DSBotIcon(.right, size: 14)
                        .rotationEffect(.degrees(configuration.isExpanded ? 90 : 0))
                }
                .font(.system(size: 16))
                .foregroundStyle(DSBotStyle.muted)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 10)
                .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(DSBotRowButtonStyle())
            .accessibilityIdentifier("sidebar.more")
            if configuration.isExpanded {
                configuration.content
            }
        }
    }
}

/// A workspace's header: its name, a › while it is folded, and a menu to rename or remove it. Tapping the
/// name folds or unfolds it; an open workspace shows no icon at all.
/// Where the sidebar's list puts things, once, so the heading, the workspaces and the conversations share
/// one left edge and one trailing column of controls.
private enum SidebarMetrics {
    /// The height of the controls in the footer, and their distance from the bottom of the sidebar's layout.
    static let footerHeight: CGFloat = 44
    static let footerBottomGap: CGFloat = 12

    static let textLeading: CGFloat = 10
    static let trailing: CGFloat = 4
}

private struct SidebarGroupHeader: View {
    let group: SidebarGroup
    let isCollapsed: Bool
    let onToggle: () -> Void
    let onCreate: () -> Void
    let onRename: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onToggle) {
                // Grey title, and when folded a small chevron one space behind it on the same baseline —
                // the way a Doubao section heading reads ("更早 ❯"). Both are text-sized, so the pair
                // stays together at any Dynamic Type size; an icon in its own box never did.
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(group.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DSBotStyle.muted)
                        .lineLimit(1)
                    if isCollapsed {
                        // The symbol carries side room of its own, so the stack adds almost none; the
                        // guide lifts it from the baseline to the middle of the letters.
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(DSBotStyle.muted)
                            .alignmentGuide(.firstTextBaseline) { $0[.firstTextBaseline] + 1.2 }
                            .layoutPriority(1)
                            .accessibilityHidden(true)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(DSBotQuietPressStyle())
            .accessibilityLabel(L10n.text("{0}，{1}", "\(group.title)", "\(isCollapsed ? L10n.text("已折叠") : L10n.text("已展开"))"))
            .accessibilityHint(L10n.text("点按折叠或展开"))
            .accessibilityIdentifier("sidebar.group.\(group.id)")

            if group.workspaceId != nil {
                Menu {
                    Button(L10n.text("新建会话"), action: onCreate)
                    Button(L10n.text("重命名"), action: onRename)
                    Button(L10n.text("删除工作区"), role: .destructive, action: onDelete)
                } label: {
                    DSBotIcon(.options, size: 20)
                        .foregroundStyle(DSBotStyle.muted)
                        .frame(width: DSBotLayout.actionColumnWidth, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DSBotIconButtonStyle())
                .accessibilityLabel(L10n.text("{0} 的更多操作", "\(group.title)"))
                .accessibilityIdentifier("sidebar.group.menu.\(group.id)")
            }
        }
        // The same left edge as the heading above and the same trailing column as its options button,
        // so the "…" of every workspace sits straight under that button (and over the times below).
        .padding(.leading, SidebarMetrics.textLeading)
        .padding(.trailing, SidebarMetrics.trailing)
    }
}

private struct SidebarSessionRow: View, Equatable {
    let session: SessionSummary
    let selectedSessionID: String?
    let onSelect: () -> Void
    let onRename: () -> Void
    let onTogglePin: () -> Void
    let onArchive: () -> Void
    let onUnarchive: () -> Void

    static func == (lhs: SidebarSessionRow, rhs: SidebarSessionRow) -> Bool {
        lhs.session == rhs.session && lhs.selectedSessionID == rhs.selectedSessionID
    }

    private var title: String { session.title.isEmpty ? L10n.text("新会话") : session.title }
    private var isPinned: Bool { session.pinned == true && session.archived != true }

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 0) {
                if let agent = session.agent {
                    AgentAvatar(agent: agent, state: session.sessionState ?? .idle, asleep: session.deepSleep == true)
                        .padding(.trailing, 10)
                        .accessibilityIdentifier("session.agent.\(session.id)")
                }
                Text(title)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .leading) {
                        if session.agent == nil && session.status == "running" {
                            Circle()
                                .fill(DSBotStyle.blue)
                                .frame(width: 5, height: 5)
                                .offset(x: -8.5)
                        }
                    }
                // A pinned conversation shows the pin where the time would be.
                if isPinned {
                    DSBotPinGlyph(size: 16, strokeWidth: 1.5)
                        .foregroundStyle(DSBotStyle.muted)
                        .frame(width: DSBotLayout.actionColumnWidth, alignment: .center)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel(L10n.text("已置顶"))
                        .accessibilityIdentifier("session.pin.\(session.id)")
                } else {
                    Text(relativeTime(session.updatedAt))
                        .font(.system(size: 10))
                        .foregroundStyle(DSBotStyle.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .frame(width: DSBotLayout.actionColumnWidth, alignment: .center)
                        .accessibilityIdentifier("session.time.\(session.id)")
                }
            }
            .frame(minHeight: 46)
            .padding(.leading, SidebarMetrics.textLeading)
            .padding(.trailing, SidebarMetrics.trailing)
            .contentShape(Rectangle())
            // An archived conversation shows greyed out; DSH does not open it until it is unarchived.
            .opacity(session.archived == true ? 0.45 : 1)
        }
        .buttonStyle(DSBotRowButtonStyle())
        .accessibilityIdentifier("session.select.\(session.id)")
        .accessibilityHint(session.archived == true ? L10n.text("已归档，取消归档后才能打开") : "")
        // Press and hold: the row lifts as a card above the rest and the menu opens under it. DSH has no
        // way to delete a conversation, only to archive it, which is what the last action does.
        .contextMenu {
            if session.archived == true {
                Button(action: onUnarchive) {
                    DSBotLabel(L10n.text("取消归档"), icon: .archiveRestore)
                }
            } else {
                Button(action: onRename) {
                    DSBotLabel(L10n.text("重命名"), icon: .editLine)
                }
                Button(action: onTogglePin) {
                    DSBotLabel(session.pinned == true ? L10n.text("取消置顶") : L10n.text("置顶"), image: DSBotPinGlyph.menuImage)
                }
                Button(action: onArchive) {
                    DSBotLabel(L10n.text("归档"), icon: .archive)
                }
            }
        } preview: {
            SidebarSessionCard(title: title)
        }
        .background(session.id == selectedSessionID ? DSBotStyle.selected : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
    }
}

/// The card the pressed row lifts into while its menu is open.
struct SidebarSessionCard: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 17))
            .foregroundStyle(DSBotStyle.ink)
            .lineLimit(1)
            .padding(.horizontal, 24)
            .frame(width: 300, height: 60, alignment: .leading)
            .background(Color.white)
    }
}

@MainActor
func relativeTime(_ milliseconds: Double) -> String {
    let date = Date(timeIntervalSince1970: milliseconds / 1_000)
    let seconds = max(0, Date().timeIntervalSince(date))
    if seconds < 60 { return L10n.text("刚刚") }
    if seconds < 3_600 { return L10n.text("{0}分钟", "\(Int(seconds / 60))") }
    if seconds < 86_400 { return L10n.text("{0}小时", "\(Int(seconds / 3_600))") }
    if seconds < 172_800 { return L10n.text("昨天") }
    return SidebarDateFormatter.shared.string(from: date)
}

@MainActor
private enum SidebarDateFormatter {
    static let shared: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = L10n.locale
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter
    }()
}
