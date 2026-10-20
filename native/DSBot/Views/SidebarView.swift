import SwiftUI

struct SidebarView: View {
    @ObservedObject var store: DSBotStore
    @AppStorage("dsbot.sidebar.grouping") private var groupingRaw = SidebarGrouping.workspace.rawValue
    @AppStorage("dsbot.sidebar.archive") private var archiveRaw = SidebarArchiveFilter.hide.rawValue
    /// Ids of the workspaces the user folded, kept as a JSON list.
    @AppStorage("dsbot.sidebar.collapsed") private var collapsedRaw = "[]"
    @State private var searchText = ""
    @FocusState private var searchFocused: Bool
    @State private var renaming: SidebarGroup?
    @State private var renameText = ""
    @State private var deleting: SidebarGroup?
    @State private var archivedChoice: SessionSummary?
    @State private var renamingSession: SessionSummary?
    @State private var sessionTitle = ""
    /// The strip under the home indicator, which the list runs on into.
    @Environment(\.homeIndicatorInset) private var homeInset

    /// The entry of DSH's sidebar that is on screen, if the main area shows one.
    let selectedItemID: String?
    let onChooseItem: (NavigationItem) -> Void
    let onChooseConversation: () -> Void
    let onOpenComputers: () -> Void
    let onOpenSettings: () -> Void
    let onClose: () -> Void

    init(
        store: DSBotStore,
        onChooseItem: @escaping (NavigationItem) -> Void,
        onChooseConversation: @escaping () -> Void,
        onOpenComputers: @escaping () -> Void,
        onOpenSettings: @escaping () -> Void,
        onClose: @escaping () -> Void,
        selectedItemID: String? = nil
    ) {
        self.store = store
        self.selectedItemID = selectedItemID
        self.onChooseItem = onChooseItem
        self.onChooseConversation = onChooseConversation
        self.onOpenComputers = onOpenComputers
        self.onOpenSettings = onOpenSettings
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
            ZStack(alignment: .bottom) {
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
                        // The last row can be scrolled clear of the footer that floats over the list.
                        .padding(.bottom, SidebarMetrics.footerHeight + SidebarMetrics.footerBottomGap + 16 + homeInset)
                    }
                    .padding(.bottom, -homeInset)
                }

                accountFooter(homeInset: homeInset)
            }
        }
        .background(DSBotStyle.canvas)
        .accessibilityElement(children: .contain)
        .task {
            await store.refreshSessions()
        }
        .onChange(of: searchText) { _, _ in
            DSBotLog.record("sidebar.search", counts: ["payloadBytes": searchText.utf8.count])
        }
        .onChange(of: groupingRaw) { _, grouping in
            DSBotLog.record("sidebar.grouping", state: grouping)
        }
        .alert("重命名会话", isPresented: Binding(
            get: { renamingSession != nil }, set: { if !$0 { renamingSession = nil } }
        )) {
            TextField("会话名称", text: $sessionTitle)
            Button("取消", role: .cancel) { renamingSession = nil }
            Button("重命名") {
                guard let id = renamingSession?.id else { return }
                let title = sessionTitle
                renamingSession = nil
                Task { await store.renameSession(id, to: title) }
            }
        }
        .alert("重命名工作区", isPresented: Binding(
            get: { renaming != nil }, set: { if !$0 { renaming = nil } }
        )) {
            TextField("工作区名称", text: $renameText)
            Button("取消", role: .cancel) { renaming = nil }
            Button("重命名") {
                guard let workspaceId = renaming?.workspaceId else { return }
                let title = renameText
                renaming = nil
                Task { await store.renameWorkspace(workspaceId, to: title) }
            }
        }
        .alert(
            deleting.map { "删除工作区「\($0.title)」？" } ?? "删除工作区",
            isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })
        ) {
            Button("取消", role: .cancel) { deleting = nil }
            Button("删除", role: .destructive) {
                guard let workspaceId = deleting?.workspaceId else { return }
                deleting = nil
                Task { await store.deleteWorkspace(workspaceId) }
            }
        } message: {
            Text("只移除工作区的登记。目录和其中的会话都会保留，会话会显示在「未分组」下。")
        }
        .alert(
            "已归档的会话",
            isPresented: Binding(get: { archivedChoice != nil }, set: { if !$0 { archivedChoice = nil } })
        ) {
            Button("取消", role: .cancel) { archivedChoice = nil }
            Button("取消归档") {
                guard let session = archivedChoice else { return }
                archivedChoice = nil
                Task { await store.unarchiveSession(session.id) }
            }
        } message: {
            Text("取消归档后才能打开。")
        }
    }

    private var brandHeader: some View {
        HStack {
            Text("dsbot")
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
            .accessibilityLabel("新建会话")
            .accessibilityIdentifier("session.new")
        }
        .frame(height: 44)
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            DSBotIcon(.search, size: 18)
                .foregroundStyle(DSBotStyle.muted)
            TextField("搜索", text: $searchText)
                .font(.system(size: 14))
                .textFieldStyle(.plain)
                .focused($searchFocused)
                .submitLabel(.search)
                .onSubmit { searchFocused = false }
                .accessibilityIdentifier("sidebar.search")
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
        .dsbotGlass(in: Capsule(), interactive: true)
    }

    /// DSH's own sidebar entries (插件, 自动化任务, ...), whatever plugins have added to them.
    private var libraryButtons: some View {
        VStack(spacing: 2) {
            ForEach(store.activeNavigation.sidebar) { item in
                libraryButton(item)
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
        case .unsupported: return "电脑上的 dsbot 插件需要更新后，这里才会显示 DSH 的入口。"
        case .waiting: return "打开一次电脑上的 DSH 窗口后，这里会显示 DSH 的入口。"
        case .unknown, .ready: return nil
        }
    }

    private func libraryButton(_ item: NavigationItem) -> some View {
        Button {
            onChooseItem(item)
        } label: {
            HStack(spacing: 12) {
                libraryIcon(item)
                    .frame(width: 24, height: 24)
                Text(item.title)
                    .lineLimit(1)
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
        .accessibilityLabel(item.title)
        .accessibilityIdentifier("library.\(item.id)")
    }

    /// The icon DSH gave the entry; a glyph of the app's own when it gave none.
    @ViewBuilder
    private func libraryIcon(_ item: NavigationItem) -> some View {
        if let icon = item.icon {
            NavigationIconView(icon: icon, size: 20)
        } else {
            DSBotIcon(glyph(for: item), size: 20)
        }
    }

    private func glyph(for item: NavigationItem) -> DSBotGlyph {
        switch item.target {
        case .schedule: return .schedule
        case .files: return .folder
        case .web(.plugins, _): return .plugins
        default: return .panel
        }
    }

    private var entries: [SidebarEntry] {
        SidebarList.entries(
            sessions: store.sessions, workspaces: store.workspaces, options: options,
            search: searchText,
            // A search lists every match, so nothing is folded away.
            collapsed: searchText.isEmpty ? collapsed : []
        )
    }

    /// The conversations, the way DSH's sidebar lists them.
    private var sessionsList: some View {
        let entries = self.entries
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(options.grouping == .flat ? "会话" : "工作区")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSBotStyle.muted)
                Spacer()
                viewOptionsMenu
            }
            .padding(.leading, SidebarMetrics.textLeading)
            .padding(.trailing, SidebarMetrics.trailing)

            if store.isLoadingSessions {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                        .tint(DSBotStyle.muted)
                    Text("正在加载会话")
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
                    Button("重试") {
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
        if !searchText.isEmpty { return "没有匹配的会话" }
        return options.archive == .only ? "暂无已归档会话" : "暂无会话"
    }

    /// DSH's 视图选项: how conversations are grouped, and which archived ones show.
    private var viewOptionsMenu: some View {
        Menu {
            Section("分组方式") {
                Picker("分组方式", selection: $groupingRaw) {
                    Text("按工作区").tag(SidebarGrouping.workspace.rawValue)
                    Text("单列表").tag(SidebarGrouping.flat.rawValue)
                }
            }
            Section("筛选会话") {
                Picker("筛选会话", selection: $archiveRaw) {
                    Text("隐藏已归档").tag(SidebarArchiveFilter.hide.rawValue)
                    Text("全部对话（显示已归档）").tag(SidebarArchiveFilter.all.rawValue)
                    Text("仅显示已归档").tag(SidebarArchiveFilter.only.rawValue)
                }
            }
        } label: {
            DSBotChecklistGlyph(size: 20)
                .foregroundStyle(DSBotStyle.muted)
                .frame(width: DSBotLayout.actionColumnWidth, height: 42)
                .contentShape(Rectangle())
        }
        .buttonStyle(DSBotIconButtonStyle())
        .accessibilityLabel("会话视图选项")
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
                    Text(store.activeComputer?.name ?? "选择电脑")
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
            .accessibilityLabel("电脑连接")
            .accessibilityIdentifier("computers.open")

            Spacer(minLength: 0)

            Button(action: onOpenSettings) {
                DSBotIcon(.settings)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: DSBotLayout.actionColumnWidth, height: SidebarMetrics.footerHeight)
                    .contentShape(Circle())
            }
            .buttonStyle(DSBotGlassButtonStyle())
            .accessibilityLabel("设置")
            .accessibilityIdentifier("settings.open")
        }
        .padding(.horizontal, DSBotLayout.sidebarPadding)
        .padding(.bottom, SidebarMetrics.footerBottomGap)
        .background(alignment: .bottom) {
            footerFade(height: SidebarMetrics.footerHeight + SidebarMetrics.footerBottomGap + 18 + homeInset)
                // Down to the screen's edge, under the home indicator.
                .offset(y: homeInset)
        }
    }

    private func footerFade(height: CGFloat) -> some View {
        ZStack(alignment: .bottom) {
            DSBotEdgeBlur(edge: .bottom, height: height, strength: 0.8)
            LinearGradient(
                colors: [DSBotStyle.canvas.opacity(0), DSBotStyle.canvas.opacity(0.55)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .frame(height: height, alignment: .bottom)
        .allowsHitTesting(false)
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
            .accessibilityLabel("\(group.title)，\(isCollapsed ? "已折叠" : "已展开")")
            .accessibilityHint("点按折叠或展开")
            .accessibilityIdentifier("sidebar.group.\(group.id)")

            if group.workspaceId != nil {
                Menu {
                    Button("新建会话", action: onCreate)
                    Button("重命名", action: onRename)
                    Button("删除工作区", role: .destructive, action: onDelete)
                } label: {
                    DSBotIcon(.options, size: 20)
                        .foregroundStyle(DSBotStyle.muted)
                        .frame(width: DSBotLayout.actionColumnWidth, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DSBotIconButtonStyle())
                .accessibilityLabel("\(group.title) 的更多操作")
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

    private var title: String { session.title.isEmpty ? "新会话" : session.title }
    private var isPinned: Bool { session.pinned == true && session.archived != true }

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 0) {
                Text(title)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // A running conversation's dot hangs in the margin, so every title starts at the
                    // same edge as the headings above it instead of being pushed in by a slot for it.
                    .overlay(alignment: .leading) {
                        if session.status == "running" {
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
                        .accessibilityLabel("已置顶")
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
        .accessibilityHint(session.archived == true ? "已归档，取消归档后才能打开" : "")
        // Press and hold: the row lifts as a card above the rest and the menu opens under it. DSH has no
        // way to delete a conversation, only to archive it, which is what the last action does.
        .contextMenu {
            if session.archived == true {
                Button(action: onUnarchive) {
                    DSBotLabel("取消归档", icon: .archiveRestore)
                }
            } else {
                Button(action: onRename) {
                    DSBotLabel("重命名", icon: .editLine)
                }
                Button(action: onTogglePin) {
                    DSBotLabel(session.pinned == true ? "取消置顶" : "置顶", image: DSBotPinGlyph.menuImage)
                }
                Button(action: onArchive) {
                    DSBotLabel("归档", icon: .archive)
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
private struct SidebarSessionCard: View {
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
private func relativeTime(_ milliseconds: Double) -> String {
    let date = Date(timeIntervalSince1970: milliseconds / 1_000)
    let seconds = max(0, Date().timeIntervalSince(date))
    if seconds < 60 { return "刚刚" }
    if seconds < 3_600 { return "\(Int(seconds / 60))分钟" }
    if seconds < 86_400 { return "\(Int(seconds / 3_600))小时" }
    if seconds < 172_800 { return "昨天" }
    return SidebarDateFormatter.shared.string(from: date)
}

@MainActor
private enum SidebarDateFormatter {
    static let shared: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日"
        return formatter
    }()
}
