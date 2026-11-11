import SwiftUI
import UIKit

/// 嘟嘟's own settings, drawn by the app (owner, 2026-11-07: "嘟嘟自己的设置不用 webview 用原生实现"): the page the plugin describes, in the settings' look (white cards on the
/// canvas), one page over another. Its header (back, title and save) is the host's native toolbar.
struct NativeSettingsView: View {
    @ObservedObject var navigator: SettingsNavigator
    @ObservedObject var store: DSBotStore
    /// The toolbar above the page (the page itself starts below the status bar).
    let topInset: CGFloat
    let report: SettingsReport

    var body: some View {
        if let model = navigator.current {
            SettingsPageView(model: model, navigator: navigator, store: store, topInset: topInset, report: report)
                .id(model.id)
        } else {
            Color.clear
        }
    }
}

/// Shared by the settings navigation bar and the root toolbar.
struct NativeSettingsSaveButton: View {
    @ObservedObject var navigator: SettingsNavigator
    @ObservedObject var store: DSBotStore
    let report: SettingsReport

    var body: some View {
        if let model = navigator.current {
            if let save = model.page?.save {
                Button {
                    Task {
                        if await model.act(save.act, form: true, using: store, report: report),
                           navigator.current?.id == model.id {
                            navigator.pop()
                        }
                    }
                } label: {
                    Group {
                        if model.busy || model.isPreviewing {
                            ProgressView().tint(DSBotStyle.ink)
                        } else {
                            Text(save.title).font(.system(size: 15, weight: .medium))
                        }
                    }
                    .frame(minWidth: 44, minHeight: 44)
                }
                .disabled(!model.canSave || store.status != .connected)
                .accessibilityLabel(save.title)
                .accessibilityIdentifier("settings.save")
            } else if model.busy {
                ProgressView().tint(DSBotStyle.muted)
                    .frame(width: 44, height: 44)
            }
        }
    }
}

private struct PendingConfirm: Identifiable {
    let id = UUID()
    let confirm: SettingsConfirm
    let act: SettingsAct
    let value: String?
}

private struct SettingsPageView: View {
    @ObservedObject var model: SettingsPageModel
    @ObservedObject var navigator: SettingsNavigator
    @ObservedObject var store: DSBotStore
    let topInset: CGFloat
    let report: SettingsReport
    @State private var revealed: String?
    @State private var confirming: PendingConfirm?
    @State private var switches: [String: Bool] = [:]
    @State private var environmentRows: [Int] = []

    private let amber = Color(red: 245.0 / 255, green: 158.0 / 255, blue: 11.0 / 255)

    var body: some View {
        page
            .alert(confirmTitle, isPresented: confirmShown, presenting: confirming) { pending in
                Button(pending.confirm.button, role: .destructive) { perform(pending.act, value: pending.value) }
                Button("取消", role: .cancel) {}
            } message: { pending in
                if let message = pending.confirm.message { Text(message) }
            }
    }

    private var confirmTitle: String { confirming?.confirm.title ?? "" }

    private var confirmShown: Binding<Bool> {
        Binding(get: { confirming != nil }, set: { shown in if !shown { confirming = nil } })
    }

    private var page: some View {
        ScrollView {
            VStack(spacing: 0) {
                content
            }
            .padding(.top, topInset + 10)
            .padding(.horizontal, 18)
            .padding(.bottom, 40)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.load(using: store) }
        .background(DSBotStyle.settingsBackground)
        .accessibilityIdentifier("settings.page")
        .task(id: "\(model.id)/\(store.connectionRevision)/\(store.status)/\(model.page?.poll ?? 0)") { await keepRead() }
        .task(id: previewKey) { await model.preview(using: store) }
        .onAppear { if let title = model.page?.title { navigator.title = title } }
        .onChange(of: model.page?.title) { _, title in navigator.title = title }
        .onChange(of: model.busy) { _, busy in
            if !busy { switches.removeAll() }
        }
    }

    private var previewKey: String {
        guard let preview = model.page?.preview else { return "" }
        return "\(store.connectionRevision)/\(preview.act.name)/\(model.values[preview.key, default: ""])"
    }

    /// Read the page, and again every few seconds while it asks to be (a connector waits for the browser).
    private func keepRead() async {
        await model.load(using: store)
        while !Task.isCancelled {
            guard store.status == .connected else { return }
            guard let seconds = model.page?.poll, seconds > 0 else { return }
            do { try await Task.sleep(for: .seconds(seconds)) } catch { return }
            guard !Task.isCancelled else { return }
            await model.load(using: store)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView()
                .controlSize(.regular)
                .tint(DSBotStyle.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 80)
        case .failed:
            VStack(spacing: 14) {
                Text("这一页没能加载")
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                Button("重试") { Task { await model.load(using: store) } }
                    .font(.system(size: 15, weight: .medium))
                    .buttonStyle(DSBotGlassCapsuleButtonStyle())
                    .padding(.horizontal, 20)
                    .frame(height: 44)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 80)
        case .loaded:
            if let page = model.page {
                ForEach(Array(page.sections.enumerated()), id: \.offset) { _, section in
                    sectionView(section)
                }
                if let problem = model.problem {
                    Text(problem)
                        .font(.system(size: 14))
                        .foregroundStyle(SwipeAction.red)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 6)
                        .padding(.top, 16)
                }
            }
        }
    }

    // MARK: Sections and rows

    private func sectionView(_ section: SettingsSection) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if let header = section.header {
                Text(header)
                    .font(.system(size: 13))
                    .foregroundStyle(DSBotStyle.muted)
                    .padding(.horizontal, 6)
                    .padding(.top, 18)
                    .padding(.bottom, 8)
            } else {
                Color.clear.frame(height: 10)
            }
            VStack(spacing: 0) {
                ForEach(Array(section.rows.enumerated()), id: \.element.id) { index, row in
                    rowView(row)
                    if index < section.rows.count - 1 {
                        Divider().padding(.leading, 16)
                    }
                }
            }
            .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .disabled(model.busy || store.status != .connected)
            if let footer = section.footer {
                Text(footer)
                    .font(.system(size: 13))
                    .foregroundStyle(DSBotStyle.muted)
                    .padding(.horizontal, 6)
                    .padding(.top, 8)
            }
        }
    }

    @ViewBuilder
    private func rowView(_ row: SettingsItem) -> some View {
        let actions = swipeActions(for: row)
        if actions.isEmpty {
            rowContent(row)
        } else {
            SwipeActionRow(actions: actions, cornerRadius: 0, isRevealed: revealed == row.id, onReveal: { revealed = $0 ? row.id : nil }) {
                rowContent(row)
            }
        }
    }

    @ViewBuilder
    private func rowContent(_ row: SettingsItem) -> some View {
        switch row.kind {
        case "switch": switchRow(row)
        case "choice": choiceRow(row)
        case "field": fieldRow(row)
        case "environment": environmentRow(row)
        case "action": actionRow(row)
        default: textRow(row)
        }
    }

    private func toneColor(_ tone: String?) -> Color {
        switch tone {
        case "bad": return SwipeAction.red
        case "warn": return amber
        default: return DSBotStyle.muted
        }
    }

    private func titleFont(_ row: SettingsItem) -> Font {
        row.mono == true ? .system(size: 14, design: .monospaced) : .system(size: 15)
    }

    @ViewBuilder
    private func textRow(_ row: SettingsItem) -> some View {
        if let to = row.to {
            Button { navigator.open(to) } label: { textRowLabel(row) }
                .buttonStyle(DSBotRowButtonStyle())
        } else {
            textRowLabel(row)
        }
    }

    private func textRowLabel(_ row: SettingsItem) -> some View {
        HStack(alignment: .center, spacing: 12) {
            if let icon = row.icon {
                ConnectorAvatar(icon: icon, name: row.title, size: 28)
            }
            if let color = row.color.flatMap(Color.init(settingsHex:)) {
                Circle().fill(color).frame(width: 12, height: 12)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(row.title)
                    .font(titleFont(row))
                    .foregroundStyle(row.tone == "bad" ? SwipeAction.red : row.tone == "muted" ? DSBotStyle.muted : DSBotStyle.ink)
                    .multilineTextAlignment(.leading)
                if let subtitle = row.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.muted)
                        .lineLimit(3)
                        .multilineTextAlignment(.leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if let detail = row.detail {
                Text(detail)
                    .font(.system(size: 13))
                    .foregroundStyle(toneColor(row.tone))
                    .lineLimit(2)
                    .multilineTextAlignment(.trailing)
            }
            if let button = row.button {
                capsule(button)
            }
            if row.to != nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DSBotStyle.muted.opacity(0.7))
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(minHeight: 48)
        .background(Color.white)
        .contentShape(Rectangle())
        .accessibilityElement(children: row.button == nil ? .combine : .contain)
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    private func actionRow(_ row: SettingsItem) -> some View {
        Button {
            if let button = row.button { run(button.act, confirm: button.confirm) }
        } label: {
            Text(row.title)
                .font(.system(size: 15))
                .foregroundStyle(row.tone == "bad" ? SwipeAction.red : DSBotStyle.ink)
                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .padding(.horizontal, 16)
                .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    private func capsule(_ button: SettingsButton) -> some View {
        Button {
            run(button.act, confirm: button.confirm)
        } label: {
            Text(button.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(button.role == "destructive" ? SwipeAction.red : DSBotStyle.ink)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(DSBotStyle.selected, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(model.busy)
    }

    private func switchRow(_ row: SettingsItem) -> some View {
        Toggle(isOn: Binding(
            get: { switches[row.id] ?? row.on ?? false },
            set: { next in
                switches[row.id] = next
                if let act = row.act { perform(act, value: next ? "true" : "false") }
            }
        )) {
            Text(row.title).font(.system(size: 15)).foregroundStyle(DSBotStyle.ink)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(minHeight: 48)
        .background(Color.white)
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    private func selectedID(_ row: SettingsItem) -> String {
        if let key = row.key { return model.values[key] ?? row.selected ?? "" }
        return row.selected ?? ""
    }

    private func choiceRow(_ row: SettingsItem) -> some View {
        var options = row.options ?? []
        if row.id == "permission" {
            // The host reports DSH's preset ids; the phone's own menu shows them under DSH's names.
            options = options.map { option in
                var named = option
                named.title = PermissionLabels.name(id: option.id, name: option.title)
                return named
            }
        }
        let selected = selectedID(row)
        let shown = options.first { $0.id == selected }
        return Menu {
            if row.id == "model", Set(options.compactMap(\.subtitle)).count > 1 {
                ForEach(orderedSources(options), id: \.self) { source in
                    Section(source) {
                        ForEach(options.filter { $0.subtitle == source }) { option in
                            optionButton(option, row: row, selected: selected)
                        }
                    }
                }
            } else {
                ForEach(options) { option in
                    optionButton(option, row: row, selected: selected)
                }
            }
        } label: {
            HStack(spacing: 8) {
                Text(row.title)
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let color = shown?.color.flatMap(Color.init(settingsHex:)) {
                    Circle().fill(color).frame(width: 12, height: 12)
                }
                VStack(alignment: .trailing, spacing: 3) {
                    Text(shown?.title ?? "")
                        .font(.system(size: 15))
                        .lineLimit(1)
                    // The group's name is dropped when the model's own name already starts with it ("DeepSeek" under "DeepSeek Flash").
                    if row.id == "model", let source = shown?.subtitle, let name = shown?.title,
                       !name.lowercased().hasPrefix(source.lowercased()) {
                        Text(source).font(.system(size: 13)).lineLimit(1)
                    }
                }
                .foregroundStyle(DSBotStyle.muted)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DSBotStyle.muted.opacity(0.7))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 48)
            .background(Color.white)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.busy || options.isEmpty)
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    private func orderedSources(_ options: [SettingsOption]) -> [String] {
        var seen = Set<String>()
        return options.compactMap(\.subtitle).filter { seen.insert($0).inserted }
    }

    private func optionButton(_ option: SettingsOption, row: SettingsItem, selected: String) -> some View {
        Button { choose(row, option) } label: {
            if option.id == selected {
                Label { Text(option.title) } icon: { Image(systemName: "checkmark") }
            } else if let color = option.color.flatMap(Color.init(settingsHex:)) {
                Label { Text(option.title) } icon: { Image(uiImage: Self.swatch(UIColor(color))).renderingMode(.original) }
            } else {
                Text(option.title)
            }
        }
    }

    private static func swatch(_ color: UIColor) -> UIImage {
        let size = CGSize(width: 14, height: 14)
        return UIGraphicsImageRenderer(size: size).image { _ in
            color.setFill()
            UIBezierPath(ovalIn: CGRect(origin: .zero, size: size)).fill()
        }
    }

    private func fieldRow(_ row: SettingsItem) -> some View {
        let key = row.key ?? row.id
        return VStack(alignment: .leading, spacing: 6) {
            Text(row.title)
                .font(.system(size: 13))
                .foregroundStyle(DSBotStyle.muted)
            Group {
                if row.secret == true {
                    SecureField(row.placeholder ?? "", text: fieldBinding(key))
                } else {
                    TextField(row.placeholder ?? "", text: fieldBinding(key), axis: row.multiline == true ? .vertical : .horizontal)
                }
            }
                .lineLimit(row.multiline == true ? 3...12 : 1...1)
                .font(titleFont(row))
                .foregroundStyle(DSBotStyle.ink)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(row.mono == true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    private func fieldBinding(_ key: String) -> Binding<String> {
        Binding(get: { model.values[key] ?? "" }, set: { model.values[key] = $0 })
    }

    private func environmentRow(_ row: SettingsItem) -> some View {
        VStack(spacing: 12) {
            ForEach(environmentRows, id: \.self) { id in
                HStack(spacing: 8) {
                    TextField("变量名", text: fieldBinding("envName\(id)"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField("值", text: fieldBinding("envValue\(id)"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        environmentRows.removeAll { $0 == id }
                        model.values.removeValue(forKey: "envName\(id)")
                        model.values.removeValue(forKey: "envValue\(id)")
                    } label: {
                        DSBotIcon(.close, size: 16)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("删除")
                }
                .font(.system(size: 14, design: .monospaced))
            }
            Button(row.title) {
                if let id = (0..<40).first(where: { !environmentRows.contains($0) }) { environmentRows.append(id) }
            }
            .font(.system(size: 15))
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .buttonStyle(.plain)
            .disabled(environmentRows.count >= 40)
        }
        .foregroundStyle(DSBotStyle.ink)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: Acts

    private func choose(_ row: SettingsItem, _ option: SettingsOption) {
        if let key = row.key {
            model.values[key] = option.id
            if key == "common", !option.id.isEmpty { model.values["frequency"] = option.id }
        } else if let act = row.act {
            perform(act, value: option.id)
        }
    }

    private func run(_ act: SettingsAct, confirm: SettingsConfirm?, value: String? = nil) {
        revealed = nil
        if let confirm {
            confirming = PendingConfirm(confirm: confirm, act: act, value: value)
        } else {
            perform(act, value: value)
        }
    }

    private func perform(_ act: SettingsAct, value: String? = nil) {
        Task {
            DSBotLog.record("settings.act")
            if await model.act(act, value: value, using: store, report: report, refreshAfterUndo: {
                if let current = navigator.current, current.id != model.id { await current.load(using: store) }
            }), navigator.current?.id == model.id {
                navigator.pop()
            }
        }
    }

    private func swipeActions(for row: SettingsItem) -> [SwipeAction] {
        (row.swipe ?? []).map { item in
            SwipeAction(
                id: item.title, title: item.title, symbol: Self.symbol(for: item),
                color: item.role == "destructive" ? SwipeAction.red : SwipeAction.grey
            ) { run(item.act, confirm: item.confirm) }
        }
    }

    private static func symbol(for item: SettingsSwipe) -> String {
        switch item.title {
        case "删除", "忘记": return "trash"
        case "设为默认": return "star"
        case "上移": return "arrow.up"
        case "下移": return "arrow.down"
        case "授权": return "key"
        case "重试": return "arrow.clockwise"
        case "取消": return "xmark"
        default: return item.role == "destructive" ? "trash" : "ellipsis"
        }
    }
}

private extension Color {
    /// `#rrggbb`.
    init?(settingsHex text: String) {
        let digits = text.hasPrefix("#") ? String(text.dropFirst()) : text
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
