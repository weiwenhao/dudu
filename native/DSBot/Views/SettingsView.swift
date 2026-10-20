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
    /// DSH's settings page boots behind the list while the user chooses, so a category opens at once.
    @StateObject private var embeddedSession = EmbeddedPageSession()
    @State private var embeddedRetryToken = 0
    @State private var selectedRowID: String?

    /// DSH's own settings sections, from the plugin. A host that cannot list them yet falls back to the
    /// sections the settings page itself reports once it has loaded.
    private var rows: [SettingsRow] {
        let provided = store.activeNavigation.settings
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

            if selectedRow == nil {
                settingsHome
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
                    DSBotIcon(selectedRow == nil ? .close : .back, size: 20)
                        .foregroundStyle(DSBotStyle.ink)
                }
                .accessibilityLabel(selectedRow == nil ? "关闭设置" : "返回设置栏目")
                .accessibilityIdentifier(selectedRow == nil ? "settings.close" : "settings.dsh.back")
            }
            ToolbarItem(placement: .principal) {
                Text(selectedRow?.title ?? "设置")
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

    /// Close the list, or go back from a section to the list.
    private func leave() {
        if selectedRow == nil {
            refreshCatalogAfterEmbeddedSettings()
            dismiss()
        } else {
            selectedRowID = nil
            refreshCatalogAfterEmbeddedSettings()
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
                        Text("重新加载设置")
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
