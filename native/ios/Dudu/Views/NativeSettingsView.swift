import SwiftUI
import UIKit
import LucideSwift

/// 嘟嘟's own settings, drawn by the app (owner, 2026-11-07: "嘟嘟自己的设置不用 webview 用原生实现"): the page `SettingsLayouts` lays out from the plugin's values (or, for an older plugin,
/// the page it describes), in the settings' look (white cards on the canvas), one page over another. Its header (back, title and save) is the host's native toolbar.
struct NativeSettingsView: View {
    @ObservedObject var navigator: SettingsNavigator
    @ObservedObject var store: DuduStore
    /// The toolbar above the page (the page itself starts below the status bar).
    let topInset: CGFloat
    var displayedModel: SettingsPageModel?
    let report: SettingsReport

    var body: some View {
        if let model = displayedModel ?? navigator.current {
            SettingsPageView(model: model, navigator: navigator, store: store, topInset: topInset, report: report)
                .id(model.id)
        } else {
            Color.clear
        }
    }
}

/// Shared by the settings navigation bar and the root toolbar.
struct NativeSettingsToolbarActions: View {
    @ObservedObject var navigator: SettingsNavigator
    @ObservedObject var store: DuduStore
    var usesGlass = false
    var displayedModel: SettingsPageModel?
    let report: SettingsReport

    var body: some View {
        if let model = displayedModel ?? navigator.current, model.hasToolbarActions {
            HStack(spacing: 8) {
                if let save = model.page?.save {
                    if usesGlass {
                        saveButton(save, model: model).buttonStyle(DuduGlassCapsuleButtonStyle())
                    } else {
                        saveButton(save, model: model)
                    }
                } else if model.busy {
                    ProgressView().tint(DuduStyle.muted)
                        .frame(width: 44, height: 44)
                }
                if let page = model.page, !page.additionLinks.isEmpty || page.environmentItem != nil {
                    if usesGlass {
                        additionControl(page, model: model).buttonStyle(DuduGlassButtonStyle())
                    } else {
                        additionControl(page, model: model)
                    }
                }
            }
        }
    }

    private func saveButton(_ save: SettingsButton, model: SettingsPageModel) -> some View {
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
                    ProgressView().tint(DuduStyle.ink)
                } else {
                    Text(save.title).font(.system(size: 15, weight: .medium))
                }
            }
            .frame(minWidth: 44, minHeight: 44)
        }
        .disabled(!model.canSave || store.status != .connected)
        .accessibilityLabel(save.title)
        .accessibilityIdentifier("settings.save")
    }

    private func additionControl(_ page: SettingsPage, model: SettingsPageModel) -> some View {
        Group {
            if page.additionLinks.count > 1 {
                Menu {
                    ForEach(page.additionLinks) { row in
                        if let to = row.to { Button(row.title) { navigator.open(to) } }
                    }
                } label: { additionLabel }
            } else {
                Button {
                    if let to = page.additionLinks.first?.to {
                        navigator.open(to)
                    } else {
                        model.addEnvironmentRow()
                    }
                } label: { additionLabel }
            }
        }
        .buttonBorderShape(.circle)
        .disabled(model.busy || model.isPreviewing || store.status != .connected ||
                  (page.additionLinks.isEmpty && model.environmentRows.count >= 40))
        .accessibilityLabel(page.additionLinks.count > 1 ? L10n.text("添加") :
                            (page.additionLinks.first?.title ?? page.environmentItem?.title ?? L10n.text("添加")))
        .accessibilityIdentifier("settings.add")
    }

    private var additionLabel: some View {
        // A native toolbar supplies its own touch area and padding around the icon.
        let size = usesGlass ? DuduLayout.toolbarButtonSize : 22
        return DuduIcon(.plus, size: 22)
            .foregroundStyle(DuduStyle.ink)
            .frame(width: size, height: size)
            .contentShape(Circle())
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
    @ObservedObject var store: DuduStore
    let topInset: CGFloat
    let report: SettingsReport
    @Environment(\.conversationIsCovered) private var isCovered
    @State private var revealed: String?
    @State private var confirming: PendingConfirm?
    @State private var switches: [String: Bool] = [:]

    private let amber = Color(red: 245.0 / 255, green: 158.0 / 255, blue: 11.0 / 255)

    var body: some View {
        page
            .alert(confirmTitle, isPresented: confirmShown, presenting: confirming) { pending in
                Button(pending.confirm.button, role: .destructive) { perform(pending.act, value: pending.value) }
                Button(L10n.text("取消"), role: .cancel) {}
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
        .background(DuduStyle.settingsBackground)
        .accessibilityIdentifier("settings.page")
        .task(id: "\(model.id)/\(store.connectionRevision)/\(store.status)/\(model.page?.poll ?? 0)/\(isCovered)") {
            guard !isCovered else { return }
            await keepRead()
        }
        .task(id: "\(previewKey)/\(isCovered)") {
            guard !isCovered else { return }
            await model.preview(using: store)
        }
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
                .tint(DuduStyle.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 80)
        case .failed:
            VStack(spacing: 14) {
                Text(L10n.text("配置加载失败"))
                    .font(.system(size: 15))
                    .foregroundStyle(DuduStyle.muted)
                Button { Task { await model.load(using: store) } } label: {
                    Text(L10n.text("重试"))
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DuduStyle.ink)
                        .padding(.horizontal, 20)
                        .frame(height: 44)
                        .contentShape(Capsule())
                }
                .buttonStyle(DuduGlassCapsuleButtonStyle())
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 80)
        case .loaded:
            if model.page != nil {
                ForEach(Array(model.contentSections.enumerated()), id: \.offset) { _, section in
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
        // The 状态 page is one card with a strip for each category; the form's preview tile stands on the canvas, not in a card (owner's drawing, 2026-11-21).
        let grouped = section.rows.contains { $0.kind == "group" }
        let bare = section.rows.count == 1 && section.rows[0].kind == "statusPreview"
        return VStack(alignment: .leading, spacing: 0) {
            if let header = section.header {
                Text(header)
                    .font(.system(size: 13))
                    .foregroundStyle(DuduStyle.muted)
                    .padding(.horizontal, 6)
                    .padding(.top, 18)
                    .padding(.bottom, 8)
            } else {
                Color.clear.frame(height: bare ? 4 : 10)
            }
            if bare {
                statusPreview(section.rows[0]).padding(.bottom, 8)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(section.rows.enumerated()), id: \.element.id) { index, row in
                        if grouped, row.kind == "group", index > 0 { Color.clear.frame(height: 8) }
                        rowView(row)
                        if index < section.rows.count - 1, let inset = dividerInset(row, next: section.rows[index + 1]) {
                            Divider().padding(.leading, inset.leading).padding(.trailing, inset.trailing)
                        }
                    }
                }
                .padding(.vertical, grouped ? 10 : 0)
                .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .disabled(model.busy || store.status != .connected)
            }
            if let footer = section.footer {
                Text(footer)
                    .font(.system(size: 13))
                    .foregroundStyle(DuduStyle.muted)
                    .padding(.horizontal, 6)
                    .padding(.top, 8)
            }
        }
    }

    @ViewBuilder
    private func rowView(_ row: SettingsItem) -> some View {
        if let menu = row.menu, !menu.isEmpty {
            rowBody(row).contextMenu { menuButtons(menu) }
        } else {
            rowBody(row)
        }
    }

    @ViewBuilder
    private func rowBody(_ row: SettingsItem) -> some View {
        let actions = swipeActions(for: row)
        if actions.isEmpty {
            rowContent(row)
        } else {
            SwipeActionRow(actions: actions, cornerRadius: 0, isRevealed: revealed == row.id, onReveal: { revealed = $0 ? row.id : nil }) {
                rowContent(row)
            }
        }
    }

    /// What a long press offers: the desktop's menu (a destructive item in red, one that cannot be done now grey, 编辑 opening the row's own page).
    @ViewBuilder
    private func menuButtons(_ menu: [SettingsMenuItem]) -> some View {
        ForEach(menu) { item in
            Button(role: item.role == "destructive" ? .destructive : nil) {
                if let to = item.to {
                    navigator.open(to)
                } else if let act = item.act {
                    run(act, confirm: item.confirm)
                }
            } label: {
                if let glyph = Self.glyph(item.glyph) {
                    DuduLabel(item.title, icon: glyph, destructive: item.role == "destructive")
                } else {
                    Text(item.title)
                }
            }
            .disabled(item.enabled == false)
        }
    }

    private static func glyph(_ name: String?) -> DuduGlyph? {
        switch name {
        case "pencil": return .rename
        case "check": return .check
        case "arrow-up": return .moveUp
        case "arrow-down": return .moveDown
        case "trash": return .trash
        case "x": return .close
        case "unplug": return .unplug
        case "key-round": return .keyRound
        case "rotate-cw": return .reconnect
        default: return nil
        }
    }

    /// The line between two rows of a card, or none: a category's strip has none around it, and a status row's starts at its name.
    private func dividerInset(_ row: SettingsItem, next: SettingsItem) -> (leading: CGFloat, trailing: CGFloat)? {
        if row.kind == "group" || next.kind == "group" { return nil }
        if row.status != nil { return (68, 10) }
        return (row.inline == true ? 18 : 16, 0)
    }

    @ViewBuilder
    private func rowContent(_ row: SettingsItem) -> some View {
        switch row.kind {
        case "switch": switchRow(row)
        case "choice": choiceRow(row)
        case "field": fieldRow(row)
        case "environment": environmentRow
        case "action": actionRow(row)
        case "group": groupRow(row)
        case "statusPreview": statusPreview(row)
        default: textRow(row)
        }
    }

    private func toneColor(_ tone: String?) -> Color {
        switch tone {
        case "bad": return SwipeAction.red
        case "warn": return amber
        default: return DuduStyle.muted
        }
    }

    private func titleFont(_ row: SettingsItem) -> Font {
        row.mono == true ? .system(size: 14, design: .monospaced) : .system(size: 15)
    }

    @ViewBuilder
    private func textRow(_ row: SettingsItem) -> some View {
        if let notification = row.notification, let to = row.to {
            HStack(spacing: 0) {
                Button { navigator.open(to) } label: { textRowLabel(row) }
                    .buttonStyle(DuduRowButtonStyle())
                notificationButton(notification, rowID: row.id)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DuduStyle.muted.opacity(0.7))
                    .padding(.leading, 4)
                    .padding(.trailing, 16)
                    .accessibilityHidden(true)
            }
            .background(Color.white)
        } else if let to = row.to {
            Button { navigator.open(to) } label: { textRowLabel(row) }
                .buttonStyle(DuduRowButtonStyle())
        } else {
            textRowLabel(row)
        }
    }

    @ViewBuilder
    private func textRowLabel(_ row: SettingsItem) -> some View {
        if let status = row.status {
            statusRowLabel(row, status)
        } else {
            plainRowLabel(row)
        }
    }

    /// A status of the 状态 page as the owner drew it: its icon in a tile of its colour, the name (and the word after it), the count under it. A tap opens it; a long press has the menu.
    private func statusRowLabel(_ row: SettingsItem, _ status: SettingsStatus) -> some View {
        HStack(spacing: 12) {
            StatusTile(type: status.type, color: status.color, progress: status.progress, size: 36, icon: 18, radius: 10)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(row.title)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DuduStyle.ink)
                        .lineLimit(1)
                    if let tag = row.tag {
                        Text(tag)
                            .font(.system(size: 13))
                            .foregroundStyle(DuduStyle.muted)
                            .lineLimit(1)
                    }
                }
                if let subtitle = row.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 12.5))
                        .foregroundStyle(DuduStyle.muted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 20)
        .padding(.trailing, 10)
        .frame(height: 62)
        .background(Color.white)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    /// A category's strip in the 状态 card, with its "+".
    private func groupRow(_ row: SettingsItem) -> some View {
        HStack(spacing: 0) {
            Text(row.title)
                .font(.system(size: 14))
                .foregroundStyle(DuduStyle.muted)
            Spacer(minLength: 0)
            if let add = row.add {
                Button { navigator.open(add.to) } label: {
                    DuduIcon(.plus, size: 18, strokeWidth: 1.8)
                        .foregroundStyle(DuduStyle.muted)
                        .frame(width: 40, height: 34)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(add.title)
                .accessibilityIdentifier("settings.add.\(row.id)")
            }
        }
        .padding(.leading, 14)
        .frame(height: 34)
        .background(Color(red: 0xF1 / 255, green: 0xF2 / 255, blue: 0xF4 / 255), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .padding(.horizontal, 10)
        .accessibilityElement(children: .contain)
    }

    /// The form's tile: the status's icon at 64pt, following the colour and progress chosen below it.
    private func statusPreview(_ row: SettingsItem) -> some View {
        let status = row.status ?? SettingsStatus(type: "backlog")
        let color = row.colorKey.flatMap { model.values[$0] } ?? status.color
        let progress = row.progressKey.flatMap { model.values[$0] }.flatMap(Double.init) ?? status.progress
        return StatusTile(type: status.type, color: color, progress: progress, size: 64, icon: 32, radius: 18)
            .frame(maxWidth: .infinity)
            .accessibilityHidden(true)
    }

    private func plainRowLabel(_ row: SettingsItem) -> some View {
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
                    .foregroundStyle(row.tone == "bad" ? SwipeAction.red : row.tone == "muted" ? DuduStyle.muted : DuduStyle.ink)
                    .multilineTextAlignment(.leading)
                if let subtitle = row.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(DuduStyle.muted)
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
            if row.to != nil && row.notification == nil {
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(DuduStyle.muted.opacity(0.7))
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

    private func notificationButton(_ notification: SettingsNotification, rowID: String) -> some View {
        let on = model.notificationValues[rowID] ?? notification.on
        return Button {
            model.setNotification(notification, rowID: rowID, on: !on, using: store, report: report)
        } label: {
            LucideIcon(on ? .bell : .bellOff, size: 18, strokeWidth: 2, absoluteStrokeWidth: false)
                .frame(width: 18, height: 18)
                .foregroundStyle(on ? DuduStyle.ink : DuduStyle.muted)
                .frame(width: 32, height: 32)
                .background(on ? DuduStyle.selected : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(model.busy || store.status != .connected)
        .accessibilityLabel(notification.title)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func actionRow(_ row: SettingsItem) -> some View {
        Button {
            if let button = row.button { run(button.act, confirm: button.confirm) }
        } label: {
            Text(row.title)
                .font(.system(size: 15))
                .foregroundStyle(row.tone == "bad" ? SwipeAction.red : DuduStyle.ink)
                .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
                .padding(.horizontal, 16)
                .contentShape(Rectangle())
        }
        .buttonStyle(DuduRowButtonStyle())
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    private func capsule(_ button: SettingsButton) -> some View {
        Button {
            run(button.act, confirm: button.confirm)
        } label: {
            Text(button.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(button.role == "destructive" ? SwipeAction.red : DuduStyle.ink)
                .padding(.horizontal, 14)
                .frame(height: 32)
                .background(DuduStyle.selected, in: Capsule())
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
            Text(row.title).font(.system(size: 15)).foregroundStyle(DuduStyle.ink)
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

    @ViewBuilder
    private func choiceRow(_ row: SettingsItem) -> some View {
        switch row.style {
        case "swatches": swatchChoice(row)
        case "icons": iconChoice(row)
        default: menuChoiceRow(row)
        }
    }

    /// The colours of a status, as dots in a row, the chosen one ringed (not a menu of hex words).
    private func swatchChoice(_ row: SettingsItem) -> some View {
        let selected = selectedID(row)
        return HStack(spacing: 0) {
            ForEach(row.options ?? []) { option in
                Button { choose(row, option) } label: {
                    ZStack {
                        Circle().fill(option.color.flatMap(Color.init(settingsHex:)) ?? DuduStyle.muted).frame(width: 26, height: 26)
                        if option.id == selected {
                            Circle().stroke(DuduStyle.ink, lineWidth: 2).frame(width: 34, height: 34)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(option.title)
                .accessibilityAddTraits(option.id == selected ? .isSelected : [])
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 72)
        .background(Color.white)
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    /// How far a started status is filled: five icons in a row in the colour chosen, the chosen one on a soft block.
    private func iconChoice(_ row: SettingsItem) -> some View {
        let selected = selectedID(row)
        let color = row.colorKey.flatMap { model.values[$0] }
        let block = Color(settingsHex: "#EAEAED") ?? DuduStyle.selected
        let edge = Color(settingsHex: "#C9CBD0") ?? DuduStyle.muted
        return HStack(spacing: 0) {
            ForEach(row.options ?? []) { option in
                if let status = option.status {
                    Button { choose(row, option) } label: {
                        IssueStatusIcon(type: status.type, color: color ?? status.color, iconProgress: status.progress, size: 24)
                            .frame(width: 60, height: 48)
                            .background(option.id == selected ? block : Color.clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay {
                                if option.id == selected {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(edge, lineWidth: 0.8)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(option.title)
                    .accessibilityAddTraits(option.id == selected ? .isSelected : [])
                }
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 76)
        .background(Color.white)
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    private func menuChoiceRow(_ row: SettingsItem) -> some View {
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
                    .foregroundStyle(DuduStyle.ink)
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
                .foregroundStyle(DuduStyle.muted)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(DuduStyle.muted.opacity(0.7))
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

    @ViewBuilder
    private func fieldRow(_ row: SettingsItem) -> some View {
        if row.inline == true {
            inlineFieldRow(row)
        } else {
            stackedFieldRow(row)
        }
    }

    /// A field with its title beside it (the 状态 form: 名称 and 描述).
    private func inlineFieldRow(_ row: SettingsItem) -> some View {
        let key = row.key ?? row.id
        return HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(row.title)
                .font(.system(size: 15))
                .foregroundStyle(DuduStyle.ink)
                .frame(width: 74, alignment: .leading)
            TextField(row.placeholder ?? "", text: fieldBinding(key), axis: row.multiline == true ? .vertical : .horizontal)
                .lineLimit(row.multiline == true ? 1...4 : 1...1)
                .font(.system(size: 15))
                .foregroundStyle(DuduStyle.ink)
                .textInputAutocapitalization(.never)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(minHeight: 56)
        .background(Color.white)
        .accessibilityIdentifier("settings.row.\(row.id)")
    }

    private func stackedFieldRow(_ row: SettingsItem) -> some View {
        let key = row.key ?? row.id
        return VStack(alignment: .leading, spacing: 6) {
            Text(row.title)
                .font(.system(size: 13))
                .foregroundStyle(DuduStyle.muted)
            Group {
                if row.secret == true {
                    SecureField(row.placeholder ?? "", text: fieldBinding(key))
                } else {
                    TextField(row.placeholder ?? "", text: fieldBinding(key), axis: row.multiline == true ? .vertical : .horizontal)
                }
            }
                .lineLimit(row.multiline == true ? 3...12 : 1...1)
                .font(titleFont(row))
                .foregroundStyle(DuduStyle.ink)
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

    private var environmentRow: some View {
        VStack(spacing: 12) {
            ForEach(model.environmentRows, id: \.self) { id in
                HStack(spacing: 8) {
                    TextField(L10n.text("变量名"), text: fieldBinding("envName\(id)"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    SecureField(L10n.text("值"), text: fieldBinding("envValue\(id)"))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button {
                        model.removeEnvironmentRow(id)
                    } label: {
                        DuduIcon(.close, size: 16)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.text("删除"))
                }
                .font(.system(size: 14, design: .monospaced))
            }
        }
        .foregroundStyle(DuduStyle.ink)
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
            DuduLog.record("settings.act")
            if await model.act(act, value: value, using: store, report: report), navigator.current?.id == model.id {
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
        switch item.act.name {
        case "remove", "forget": return "trash"
        case "default": return "star"
        case "move": return (item.act.args?["direction"]?.numberValue ?? 1) < 0 ? "arrow.up" : "arrow.down"
        case "verb":
            switch item.act.args?["verb"]?.stringValue {
            case "authorize": return "key"
            case "retry": return "arrow.clockwise"
            case "cancel": return "xmark"
            default: return "ellipsis"
            }
        default: return item.role == "destructive" ? "trash" : "ellipsis"
        }
    }
}

/// A status icon in a soft tile of its own colour: the rows of the 状态 page (36pt) and the form's preview (64pt) (owner's drawing, 2026-11-21).
private struct StatusTile: View {
    let type: String
    var color: String?
    var progress: Double?
    let size: CGFloat
    let icon: CGFloat
    let radius: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(IssueStatusIcon.ink(type: type, color: color).opacity(0.1))
            .frame(width: size, height: size)
            .overlay { IssueStatusIcon(type: type, color: color, iconProgress: progress, size: icon) }
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
