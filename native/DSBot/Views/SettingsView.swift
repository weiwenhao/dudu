import SwiftUI

/// One entry of DSH's settings list.
private struct SettingsRow: Identifiable, Equatable {
    let id: String
    let title: String
    let icon: NavigationIcon?
}

struct SettingsView: View {
    @ObservedObject var store: DSBotStore
    @Environment(\.dismiss) private var dismiss
    /// Only DSH's own settings need an embedded page, created when its list is entered.
    @StateObject private var embeddedSession = EmbeddedPageSession()
    @State private var embeddedRetryToken = 0
    @State private var selectedRowID: String?
    /// DSH's own pages are one level down, behind "其他设置" (owner, 2026-11-08), not listed beside 嘟嘟's.
    @State private var showsDSHSettings = false

    /// 嘟嘟's own settings pages, and the entry that leads to DSH's, from the plugin.
    private var duduItems: [NavigationItem] {
        store.activeNavigation.settings.filter { $0.group == "dudu" }
    }

    /// DSH's own settings sections, from the plugin. A host that cannot list them yet falls back to the
    /// sections the settings page itself reports once it has loaded.
    private var rows: [SettingsRow] {
        let provided = store.activeNavigation.settings.filter { $0.group != "dudu" }
        if !provided.isEmpty {
            return provided.map { SettingsRow(id: $0.id, title: $0.title, icon: $0.icon) }
        }
        return embeddedSession.settingsCategories.map { SettingsRow(id: $0.id, title: $0.label, icon: nil) }
    }

    private var selectedRow: SettingsRow? {
        guard let selectedRowID else { return nil }
        return rows.first { $0.id == selectedRowID }
    }

    var body: some View {
        ZStack {
            pageBackground.ignoresSafeArea()

            if showsDSHSettings {
                EmbeddedPageView(
                    store: store,
                    page: .settings,
                    session: embeddedSession,
                    retryToken: embeddedRetryToken,
                    isVisible: selectedRow != nil,
                    isInteractive: selectedRow != nil
                )
                .allowsHitTesting(selectedRow != nil)
                .accessibilityHidden(selectedRow == nil)
            }

            if selectedRow == nil {
                (showsDSHSettings ? AnyView(dshSettingsPage) : AnyView(settingsHome))
                    .transition(.opacity)
            }
        }
        .background(pageBackground.ignoresSafeArea())
        // DSH's page is white, so the bar above it is white too; the list is on the grouped grey.
        .navigationBarBackButtonHidden(true)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(pageBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button(action: leave) {
                    DSBotIcon(closes ? .close : .back, size: 20)
                        .foregroundStyle(DSBotStyle.ink)
                }
                .accessibilityLabel(closes ? "关闭设置" : "返回设置栏目")
                .accessibilityIdentifier(closes ? "settings.close" : "settings.dsh.back")
            }
            ToolbarItem(placement: .principal) {
                Text(selectedRow?.title ?? (showsDSHSettings ? "其他设置" : "设置"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .task { await store.refreshNavigation() }
        #if DEBUG && targetEnvironment(simulator)
        .task {
            // Review launch flag: open a settings section without tapping.
            let arguments = ProcessInfo.processInfo.arguments
            if let index = arguments.firstIndex(of: "-dsbot-review-settings-section"),
               arguments.indices.contains(index + 1) {
                try? await Task.sleep(nanoseconds: 800_000_000)
                selectedRowID = arguments[index + 1]
            }
        }
        #endif
        .onChange(of: selectedRowID) { _, _ in pushSelection() }
        .onChange(of: embeddedSession.hasPage) { _, _ in pushSelection() }
        .onDisappear(perform: refreshCatalogAfterEmbeddedSettings)
    }

    private var pageBackground: Color {
        selectedRow == nil ? DSBotStyle.settingsBackground : .white
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
        .background(DSBotStyle.settingsBackground.ignoresSafeArea())
    }

    /// The first level closes the settings; the levels below it go back one.
    private var closes: Bool { selectedRow == nil && !showsDSHSettings }

    /// Close the settings, or go back one level: from a DSH section to DSH's list, from that list to the settings.
    private func leave() {
        if selectedRow != nil {
            selectedRowID = nil
            refreshCatalogAfterEmbeddedSettings()
        } else if showsDSHSettings {
            showsDSHSettings = false
        } else {
            refreshCatalogAfterEmbeddedSettings()
            dismiss()
        }
    }

    /// Hand the choice to the page; it switches as soon as it is ready.
    private func pushSelection() {
        embeddedSession.selectSettingsCategory(selectedRowID)
    }

    private var settingsHome: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                connectionCard
                duduSettingsCard
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .padding(.bottom, 30)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DSBotStyle.settingsBackground.ignoresSafeArea())
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
        } label: {
            HStack(spacing: 12) {
                DSBotIcon(.computer)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.activeComputer?.name ?? "选择电脑")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DSBotStyle.ink)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Circle()
                            .fill(connectionStatusColor)
                            .frame(width: 6, height: 6)
                        Text(connectionStatusText)
                            .font(.system(size: 12))
                            .foregroundStyle(DSBotStyle.muted)
                    }
                }
                Spacer(minLength: 0)
                DSBotIcon(.right, size: 16)
                    .foregroundStyle(DSBotStyle.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 68)
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .accessibilityIdentifier("settings.computers")
        .accessibilityHint("查看、切换或添加电脑")
    }

    /// 嘟嘟's native settings pages, and the separate entry to DSH's own pages.
    private var duduSettingsCard: some View {
        VStack(spacing: 0) {
            ForEach(Array(duduItems.enumerated()), id: \.element.id) { index, item in
                if index > 0 { rowDivider }
                duduRow(item)
            }
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    @ViewBuilder
    private func duduRow(_ item: NavigationItem) -> some View {
        let label = HStack(spacing: 12) {
            Group {
                if let icon = item.icon {
                    NavigationIconView(icon: icon, size: 22)
                } else {
                    DSBotIcon(.settings)
                }
            }
            .foregroundStyle(DSBotStyle.ink)
            .frame(width: 28)
            // Keep the approved name when an older plugin or cached catalog supplies the old label.
            Text(item.target == .dshSettings ? "其他设置" : item.title)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(DSBotStyle.ink)
                .lineLimit(1)
            Spacer(minLength: 0)
            DSBotIcon(.right, size: 16)
                .foregroundStyle(DSBotStyle.muted)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 58)
        .contentShape(Rectangle())
        if item.target == .dshSettings {
            Button {
                showsDSHSettings = true
                DSBotLog.record("settings.dsh.open")
            } label: { label }
                .buttonStyle(DSBotRowButtonStyle())
                .accessibilityIdentifier("settings.dsh")
        } else {
            NavigationLink {
                DuduSettingsPage(store: store, item: item)
                    .id(store.activeComputer?.id)
            } label: { label }
                .buttonStyle(DSBotRowButtonStyle())
                .accessibilityIdentifier("settings.\(item.id)")
        }
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
                    DSBotIcon(.settings)
                        .foregroundStyle(DSBotStyle.ink)
                        .frame(width: 28)
                    Text("加载设置…")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DSBotStyle.muted)
                    Spacer(minLength: 0)
                    ProgressView()
                        .controlSize(.small)
                        .tint(DSBotStyle.muted)
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
                        DSBotIcon(.reconnect)
                            .foregroundStyle(DSBotStyle.ink)
                            .frame(width: 28)
                        Text("重试")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(DSBotStyle.ink)
                        Spacer(minLength: 0)
                        DSBotIcon(.right, size: 16)
                            .foregroundStyle(DSBotStyle.muted)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(minHeight: 58)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DSBotRowButtonStyle())
                .accessibilityIdentifier("settings.dsh.retry")
            }
        }
        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var rowDivider: some View {
        Rectangle()
            .fill(DSBotStyle.line)
            .frame(height: 1)
            .padding(.leading, 56)
    }

    private func settingsRow(_ row: SettingsRow) -> some View {
        Button {
            selectedRowID = row.id
            DSBotLog.record("settings.dsh.section")
        } label: {
            HStack(spacing: 12) {
                Group {
                    if let icon = row.icon {
                        NavigationIconView(icon: icon, size: 22)
                    } else {
                        DSBotIcon(categoryGlyph(for: row))
                    }
                }
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: 28)
                Text(row.title)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                DSBotIcon(.right, size: 16)
                    .foregroundStyle(DSBotStyle.muted)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 58)
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .accessibilityIdentifier("settings.dsh.\(row.id)")
    }

    private func refreshCatalogAfterEmbeddedSettings() {
        guard embeddedSession.consumeSettingsMutation(), store.status == .connected else { return }
        Task { await store.refreshCatalog() }
    }

    /// A glyph for a section DSH sent no icon for, guessed from its name.
    private func categoryGlyph(for category: SettingsRow) -> DSBotGlyph {
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
        case .connected: return "已连接"
        case .connecting: return "正在连接"
        case .disconnected: return "未连接"
        }
    }

    private var connectionStatusColor: Color {
        switch store.status {
        case .connected: return Color(red: 0.20, green: 0.66, blue: 0.40)
        case .connecting: return DSBotStyle.blue
        case .disconnected: return DSBotStyle.muted
        }
    }

}

/// One of 嘟嘟's settings pages, using the app's own controls and navigation bar.
private struct DuduSettingsPage: View {
    @ObservedObject var store: DSBotStore
    let item: NavigationItem
    @Environment(\.dismiss) private var dismiss
    @StateObject private var navigator: SettingsNavigator
    @State private var toast: DSBotToastMessage?

    init(store: DSBotStore, item: NavigationItem) {
        self.store = store
        self.item = item
        _navigator = StateObject(wrappedValue: SettingsNavigator(section: item.target.settingsSection ?? "general"))
    }

    var body: some View {
        NativeSettingsView(navigator: navigator, store: store, topInset: 0) { toast = $0 }
        .overlay(alignment: .top) {
            DSBotToastOverlay(message: toast) { message in
                if toast?.id == message.id { toast = nil }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
        }
        .background(DSBotStyle.settingsBackground.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(DSBotStyle.settingsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    if navigator.canPop { navigator.pop() } else { dismiss() }
                } label: {
                    if navigator.current?.page?.isForm == true {
                        Text("取消")
                    } else {
                        DSBotIcon(.back, size: 20).foregroundStyle(DSBotStyle.ink)
                    }
                }
                .disabled(navigator.current?.busy == true)
                .accessibilityLabel(navigator.current?.page?.isForm == true ? "取消" : "返回")
                .accessibilityIdentifier("settings.dudu.back")
            }
            ToolbarItem(placement: .principal) {
                Text(navigator.title ?? item.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
            }
            ToolbarItem(placement: .topBarTrailing) {
                NativeSettingsSaveButton(navigator: navigator, store: store) { toast = $0 }
            }
        }
        .interactiveDismissDisabled(navigator.current?.busy == true)
    }
}
