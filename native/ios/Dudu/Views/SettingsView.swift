import SwiftUI

/// One entry of DSH's settings list.
private struct SettingsRow: Identifiable, Hashable {
    let id: String
    let title: String
    let icon: NavigationIcon?

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id && lhs.title == rhs.title && lhs.icon == rhs.icon }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}

struct SettingsView: View {
    @ObservedObject var store: DuduStore
    @ObservedObject var pagePool: EmbeddedPagePool
    var isHome = false
    var isActive = true
    var onOpenSidebar: (() -> Void)?
    var onRootVisibility: ((Bool) -> Void)?
    /// The drawer's gear opens DSH's settings on their own (owner, 2026-11-21): its list and sections, with no 嘟嘟 settings around them.
    var showsOnlyDSHSettings = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    /// Only DSH's own settings need an embedded page, created when its list is entered.
    @StateObject private var embeddedSession = EmbeddedPageSession()
    @State private var embeddedRetryToken = 0
    @State private var selectedRow: SettingsRow?
    /// The feedback popup under the privacy policy (owner, 2026-11-27), and the line that says it was sent.
    @State private var isFeedbackPresented = false
    @State private var feedbackToast: DuduToastMessage?

    /// 嘟嘟's own settings pages: a fixed list in the app (owner, 2026-11-21: 「这个列表应该是原生组件写死的…不需要从 API 加载」). The plugin supplies the values a page shows (`settings.data`;
    /// the layout of each page is `SettingsLayouts`), not which pages there are, nor their names or icons, so an older plugin cannot bring back older icons. DSH's settings are not one of
    /// these rows: the drawer's gear opens them.
    private static let duduPages: [DuduSettingsEntry] = [
        DuduSettingsEntry(section: "general", title: "常规", glyph: .settingsGeneral),
        DuduSettingsEntry(section: "statuses", title: "状态", glyph: .settingsStatuses),
        DuduSettingsEntry(section: "connectors", title: "连接器", glyph: .settingsConnectors, iconSize: 24.2),
        DuduSettingsEntry(section: "collectors", title: "收集器", glyph: .settingsCollectors),
        DuduSettingsEntry(section: "rules", title: "规则", glyph: .settingsRules),
        DuduSettingsEntry(section: "memory", title: "记忆", glyph: .settingsMemory),
        DuduSettingsEntry(section: "skills", title: "技能", glyph: .settingsSkills),
        // The harnesses found on the computer (owner, 2026-11-24, .local/designs/providers-redesign-2026-11-24); a plugin from before answers nothing for it.
        DuduSettingsEntry(section: "providers", title: "供应商", glyph: .settingsProviders),
    ]

    /// DSH's own settings sections, from the plugin. A host that cannot list them yet falls back to the
    /// sections the settings page itself reports once it has loaded.
    private var rows: [SettingsRow] {
        let provided = store.activeNavigation.settings.filter { $0.group != "dudu" }
        if embeddedSession.isCurrent, embeddedSession.hasReceivedSettingsCategories {
            return embeddedSession.settingsCategories.map { category in
                SettingsRow(
                    id: category.id, title: category.label,
                    icon: provided.first { $0.id == category.id }?.icon
                )
            }
        }
        if !provided.isEmpty {
            return provided.map { SettingsRow(id: $0.id, title: $0.title, icon: $0.icon) }
        }
        return embeddedSession.settingsCategories.map { SettingsRow(id: $0.id, title: $0.label, icon: nil) }
    }

    var body: some View {
        Group {
            if showsOnlyDSHSettings { dshOnlyBody } else { homeBody }
        }
        .task(id: isActive) {
            guard isActive else { return }
            await store.refreshNavigation()
        }
        .onChange(of: rows) { _, current in
            if embeddedSession.isCurrent, embeddedSession.hasReceivedSettingsCategories,
               let selectedRow, !current.contains(where: { $0.id == selectedRow.id }) {
                self.selectedRow = nil
            }
        }
        .onDisappear(perform: refreshCatalogAfterEmbeddedSettings)
    }

    /// DSH's own settings, as the drawer's gear opens them: its list and sections alone, closed by the sheet's own button.
    private var dshOnlyBody: some View {
        dshSettingsRoot
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    SheetCloseButton(label: L10n.text("关闭设置")) {
                        refreshCatalogAfterEmbeddedSettings()
                        dismiss()
                    }
                    .accessibilityIdentifier("settings.close")
                }
            }
    }

    private var homeBody: some View {
        settingsHome
        .onAppear { onRootVisibility?(true) }
        .onDisappear { onRootVisibility?(false) }
        .background(DuduStyle.settingsBackground.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        // This root has no back button of its own; the pages pushed from it are the ones that take the chevron alone from it.
        .minimalBackButton()
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(DuduStyle.settingsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .sheet(isPresented: $isFeedbackPresented) {
            FeedbackSheet { feedbackToast = DuduToastMessage(text: L10n.text("已发送"), kind: .success) }
        }
        .overlay(alignment: .top) {
            DuduToastOverlay(message: feedbackToast) { dismissed in
                if feedbackToast?.id == dismissed.id { feedbackToast = nil }
            }
            .padding(.top, 8)
            .padding(.horizontal, 16)
        }
        .toolbar {
            if !isHome {
                ToolbarItem(placement: .topBarTrailing) {
                    SheetCloseButton(label: L10n.text("关闭设置")) {
                        refreshCatalogAfterEmbeddedSettings()
                        dismiss()
                    }
                    .accessibilityIdentifier("settings.close")
                }
            } else {
                ToolbarItem(placement: .topBarLeading) {
                    Button { onOpenSidebar?() } label: {
                        DuduIcon(.menu, size: 22)
                    }
                    .buttonBorderShape(.circle)
                    .accessibilityLabel(L10n.text("打开会话列表"))
                }
            }
            ToolbarItem(placement: .principal) {
                Text(L10n.text("设置"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }

    private var dshSettingsRoot: some View {
        ZStack {
            // Load DSH's section registry behind its list, retaining the same authenticated page session.
            EmbeddedPageView(
                store: store, page: .settings, session: embeddedSession,
                retryToken: embeddedRetryToken, isVisible: false, isInteractive: false
            )
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            dshSettingsPage
        }
        .navigationBarBackButtonHidden(false)
        .minimalBackButton()
        .tint(DuduStyle.ink)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(DuduStyle.settingsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(L10n.text("DSH 设置"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
            }
        }
        .navigationDestination(item: $selectedRow) { row in
            EmbeddedSettingsSection(store: store, pool: pagePool, row: row)
        }
        .onAppear {
            refreshCatalogAfterEmbeddedSettings()
        }
    }

    /// DSH's own pages, as DSH lists them: the page the "其他设置" row opens.
    private var dshSettingsPage: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                dshSettingsCard
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 30)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DuduStyle.settingsBackground.ignoresSafeArea())
    }

    private var settingsHome: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                connectionCard
                duduSettingsCard
                aboutCard
                Text(verbatim: AppInfo.versionText)
                    .font(.system(size: 13))
                    .foregroundStyle(DuduStyle.muted)
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("settings.version")
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 30)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DuduStyle.settingsBackground.ignoresSafeArea())
    }

    /// The computer this phone controls. Reconnecting and switching live on its own page.
    private var connectionCard: some View {
        VStack(spacing: 0) {
            computerRow
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var computerRow: some View {
        NavigationLink {
            ComputerListView(store: store)
                .hidesTabBarWhenPushed()
        } label: {
            HStack(spacing: 12) {
                DuduIcon(.computer)
                    .foregroundStyle(DuduStyle.ink)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.activeComputer?.name ?? L10n.text("选择电脑"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DuduStyle.ink)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Circle()
                            .fill(connectionStatusColor)
                            .frame(width: 6, height: 6)
                        Text(connectionStatusText)
                            .font(.system(size: 12))
                            .foregroundStyle(DuduStyle.muted)
                    }
                }
                Spacer(minLength: 0)
                DuduIcon(.right, size: 16)
                    .foregroundStyle(DuduStyle.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 68)
            .contentShape(Rectangle())
        }
        .buttonStyle(DuduRowButtonStyle())
        .accessibilityIdentifier("settings.computers")
        .accessibilityHint(L10n.text("查看、切换或添加电脑"))
    }

    /// 嘟嘟's native settings pages, and the separate entry to DSH's own pages.
    private var duduSettingsCard: some View {
        VStack(spacing: 0) {
            ForEach(Array(Self.duduPages.enumerated()), id: \.element.id) { index, page in
                if index > 0 { rowDivider }
                duduRow(page)
            }
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    @ViewBuilder
    private func duduRow(_ page: DuduSettingsEntry) -> some View {
        let label = HStack(spacing: 12) {
            DuduIcon(page.glyph, size: page.iconSize)
                .foregroundStyle(DuduStyle.ink)
                .frame(width: 28)
            Text(L10n.text(page.title))
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(DuduStyle.ink)
                .lineLimit(1)
            Spacer(minLength: 0)
            DuduIcon(.right, size: 16)
                .foregroundStyle(DuduStyle.muted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 58)
        .contentShape(Rectangle())
        NavigationLink {
            DuduSettingsPage(store: store, entry: page)
                .id(store.activeComputer?.id)
                .hidesTabBarWhenPushed()
        } label: { label }
            .buttonStyle(DuduRowButtonStyle())
            .accessibilityIdentifier("settings.\(page.section)")
    }

    /// The privacy and About entries keep the settings' rows; the version follows the card as a quiet footer.
    private var aboutCard: some View {
        VStack(spacing: 0) {
            Button {
                DuduLog.record("settings.privacy.open")
                openURL(AppInfo.privacyPolicyURL)
            } label: {
                aboutRowLabel(.privacy, L10n.text("隐私政策")) {
                    DuduIcon(.openLink, size: 16)
                        .foregroundStyle(DuduStyle.muted)
                }
            }
            .buttonStyle(DuduRowButtonStyle())
            .accessibilityIdentifier("settings.privacy")

            rowDivider

            Button {
                DuduLog.record("settings.feedback.open")
                isFeedbackPresented = true
            } label: {
                aboutRowLabel(.message, L10n.text("反馈")) {
                    DuduIcon(.right, size: 16)
                        .foregroundStyle(DuduStyle.muted)
                }
            }
            .buttonStyle(DuduRowButtonStyle())
            .accessibilityIdentifier("settings.feedback")

            rowDivider

            NavigationLink {
                AboutView()
                    .hidesTabBarWhenPushed()
            } label: {
                aboutRowLabel(.info, L10n.text("关于")) {
                    DuduIcon(.right, size: 16)
                        .foregroundStyle(DuduStyle.muted)
                }
            }
            .buttonStyle(DuduRowButtonStyle())
            .accessibilityIdentifier("settings.about")
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    /// The row of the cards above: the glyph in its 28pt column, the name, then what the row ends with.
    private func aboutRowLabel<Trailing: View>(
        _ glyph: DuduGlyph, _ title: String, @ViewBuilder trailing: () -> Trailing
    ) -> some View {
        HStack(spacing: 12) {
            DuduIcon(glyph)
                .foregroundStyle(DuduStyle.ink)
                .frame(width: 28)
            Text(title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(DuduStyle.ink)
                .lineLimit(1)
            Spacer(minLength: 0)
            trailing()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 58)
        .contentShape(Rectangle())
    }

    /// DSH's settings sections, as DSH lists them (with its icons). The first read of the list is a
    /// request to the plugin, not a page load, so it appears at once.
    private var dshSettingsCard: some View {
        VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { rowDivider }
                settingsRow(row)
            }

            if rows.isEmpty, !embeddedSession.hasReceivedSettingsCategories, embeddedSession.error == nil {
                HStack(spacing: 12) {
                    DuduIcon(.settings)
                        .foregroundStyle(DuduStyle.ink)
                        .frame(width: 28)
                    Text(L10n.text("加载设置…"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DuduStyle.muted)
                    Spacer(minLength: 0)
                    ProgressView()
                        .controlSize(.small)
                        .tint(DuduStyle.muted)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .frame(minHeight: 58)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("settings.dsh.loading")
            }

            if rows.isEmpty, embeddedSession.error != nil {
                Button {
                    embeddedRetryToken += 1
                } label: {
                    HStack(spacing: 12) {
                        DuduIcon(.reconnect)
                            .foregroundStyle(DuduStyle.ink)
                            .frame(width: 28)
                        Text(L10n.text("重试"))
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(DuduStyle.ink)
                        Spacer(minLength: 0)
                        DuduIcon(.right, size: 16)
                            .foregroundStyle(DuduStyle.muted)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(minHeight: 58)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DuduRowButtonStyle())
                .accessibilityIdentifier("settings.dsh.retry")
            }
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var rowDivider: some View {
        Rectangle()
            .fill(DuduStyle.line)
            .frame(height: 1)
            .padding(.leading, 56)
    }

    private func settingsRow(_ row: SettingsRow) -> some View {
        Button {
            selectedRow = row
            DuduLog.record("settings.dsh.section")
        } label: {
            HStack(spacing: 12) {
                Group {
                    if let icon = row.icon {
                        NavigationIconView(icon: icon, size: 22)
                    } else {
                        DuduIcon(categoryGlyph(for: row))
                    }
                }
                .foregroundStyle(DuduStyle.ink)
                .frame(width: 28)
                Text(row.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(DuduStyle.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                DuduIcon(.right, size: 16)
                    .foregroundStyle(DuduStyle.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(DuduRowButtonStyle())
        .accessibilityIdentifier("settings.dsh.\(row.id)")
    }

    private func refreshCatalogAfterEmbeddedSettings() {
        guard embeddedSession.consumeSettingsMutation(), store.status == .connected else { return }
        Task { await store.refreshCatalog() }
    }

    /// A glyph for a section DSH sent no icon for, guessed from its name.
    private func categoryGlyph(for category: SettingsRow) -> DuduGlyph {
        let key = "\(category.id) \(category.title)".lowercased()
        if ["account", "user", "账号", "账户", "余额", "登录"].contains(where: { key.contains($0) }) {
            return .account
        }
        if ["model", "模型", "provider"].contains(where: { key.contains($0) }) {
            return .model
        }
        if ["plugin", "market", "插件", "市场"].contains(where: { key.contains($0) }) {
            return .plugins
        }
        if ["skill", "agent", "preset", "技能", "智能体", "预设"].contains(where: { key.contains($0) }) {
            return .skills
        }
        if ["schedule", "automation", "定时", "计划", "自动化"].contains(where: { key.contains($0) }) {
            return .schedule
        }
        if ["permission", "security", "权限", "安全"].contains(where: { key.contains($0) }) {
            return .permission
        }
        if ["tool", "terminal", "工具", "终端"].contains(where: { key.contains($0) }) {
            return .terminal
        }
        return .settings
    }

    private var connectionStatusText: String {
        switch store.status {
        case .connected: return L10n.text("已连接")
        case .connecting: return L10n.text("正在连接")
        case .disconnected: return L10n.text("未连接")
        }
    }

    private var connectionStatusColor: Color {
        switch store.status {
        case .connected: return Color(red: 0.20, green: 0.66, blue: 0.40)
        case .connecting: return DuduStyle.blue
        case .disconnected: return DuduStyle.muted
        }
    }

}

/// One of 嘟嘟's settings pages, using the app's own controls and navigation bar.
private struct DuduSettingsPage: View {
    @ObservedObject var store: DuduStore
    let entry: DuduSettingsEntry
    @StateObject private var navigator: SettingsNavigator

    init(store: DuduStore, entry: DuduSettingsEntry) {
        self.store = store
        self.entry = entry
        _navigator = StateObject(wrappedValue: SettingsNavigator(section: entry.section))
    }

    var body: some View {
        if let model = navigator.pages.first {
            DuduSettingsScreen(store: store, navigator: navigator, model: model, fallbackTitle: L10n.text(entry.title))
        }
    }
}

/// One row of 嘟嘟's settings list: which page, its name, its icon. The plug of 连接器 is the narrowest of the seven and is drawn a tenth larger (owner, 2026-11-21: 「小了一点」).
private struct DuduSettingsEntry: Identifiable {
    let section: String
    let title: String
    let glyph: DuduGlyph
    var iconSize: CGFloat = 22
    var id: String { section }
}

/// Each model is a real destination, so the system owns interactive movement and cancellation.
private struct DuduSettingsScreen: View {
    @ObservedObject var store: DuduStore
    @ObservedObject var navigator: SettingsNavigator
    @ObservedObject var model: SettingsPageModel
    var fallbackTitle = ""
    @State private var toast: DuduToastMessage?

    private var nextPage: Binding<SettingsPageModel?> {
        Binding(
            get: { navigator.page(after: model.id) },
            set: { if $0 == nil { navigator.pop(to: model.id) } }
        )
    }

    var body: some View {
        NativeSettingsView(navigator: navigator, store: store, topInset: 0, displayedModel: model) { toast = $0 }
        .overlay(alignment: .top) {
            DuduToastOverlay(message: toast) { message in
                if toast?.id == message.id { toast = nil }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
        }
        .background(DuduStyle.settingsBackground.ignoresSafeArea())
        .navigationBarBackButtonHidden(model.busy)
        .minimalBackButton()
        .tint(DuduStyle.ink)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(DuduStyle.settingsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(model.page?.title ?? fallbackTitle)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                    .lineLimit(1)
            }
            if model.hasToolbarActions {
                ToolbarItem(placement: .topBarTrailing) {
                    NativeSettingsToolbarActions(navigator: navigator, store: store, displayedModel: model) { toast = $0 }
                }
            }
        }
        .navigationDestination(item: nextPage) { child in
            DuduSettingsScreen(store: store, navigator: navigator, model: child)
                .hidesTabBarWhenPushed()
        }
        .interactiveDismissDisabled(model.busy)
    }
}

private struct EmbeddedSettingsSection: View {
    @ObservedObject var store: DuduStore
    @ObservedObject var pool: EmbeddedPagePool
    @StateObject private var session: EmbeddedPageSession
    let row: SettingsRow

    init(store: DuduStore, pool: EmbeddedPagePool, row: SettingsRow) {
        self.store = store
        self.pool = pool
        self.row = row
        _session = StateObject(wrappedValue: pool.session(page: .settings, target: row.id, sessionID: nil))
    }

    var body: some View {
        EmbeddedPageView(
            store: store, page: .settings, target: row.id, session: session, pool: pool,
            isVisible: true, isInteractive: true
        )
        .background(Color.white.ignoresSafeArea())
        .navigationBarBackButtonHidden(false)
        .minimalBackButton()
        .tint(DuduStyle.ink)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.white, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(row.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .onAppear { session.selectSettingsCategory(row.id) }
        .onChange(of: session.hasPage) { _, _ in session.selectSettingsCategory(row.id) }
        .onDisappear {
            if session.consumeSettingsMutation(), store.status == .connected {
                Task { await store.refreshCatalog() }
            }
        }
    }
}
