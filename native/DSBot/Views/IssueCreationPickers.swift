import SwiftUI

/// The app's settings card and choice rows, inside the new-issue sheet's navigation stack.
struct IssueChoiceList<Content: View>: View {
    let title: String
    @ViewBuilder var content: () -> Content

    var body: some View {
        ScrollView {
            VStack(spacing: 0, content: content)
                .frame(maxWidth: .infinity)
                .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(DSBotStyle.canvas)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct IssueChoiceRow<Icon: View>: View {
    let title: String
    var subtitle: String? = nil
    var selected = false
    @ViewBuilder var icon: () -> Icon
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                icon().frame(width: 20, height: 20).foregroundStyle(DSBotStyle.chatSecondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 15))
                        .foregroundStyle(DSBotStyle.ink)
                        .lineLimit(2)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: 13))
                            .foregroundStyle(DSBotStyle.muted)
                            .lineLimit(2)
                    }
                }
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                if selected { DSBotIcon(.check, size: 18).foregroundStyle(DSBotStyle.ink) }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct IssueProjectPicker: View {
    let projects: [IssueProject]
    let selected: IssueProject?
    let onSelect: (IssueProject?) -> Void
    @State private var query = ""

    private var shown: [IssueProject] {
        let values = selected.map { project in projects.contains(where: { $0.id == project.id }) ? projects : [project] + projects } ?? projects
        let words = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return words.isEmpty ? values : values.filter { "\($0.name) \($0.path ?? "")".localizedCaseInsensitiveContains(words) }
    }

    var body: some View {
        IssueChoiceList(title: L10n.text("项目")) {
            IssueChoiceRow(title: L10n.text("无项目"), selected: selected == nil) {
                DSBotIcon(.issueProject, size: 18, scalesStroke: true)
            } action: { onSelect(nil) }
            ForEach(shown) { project in
                IssueChoiceRow(title: project.name, subtitle: project.path, selected: project.id == selected?.id) {
                    DSBotIcon(.issueProject, size: 18, scalesStroke: true)
                } action: { onSelect(project) }
            }
            if projects.isEmpty {
                Text(L10n.text("还没有项目")).font(.system(size: 14)).foregroundStyle(DSBotStyle.muted).padding(20)
            }
            Divider().padding(.leading, 16)
            NavigationLink(value: IssueCreationPicker.newProject) {
                HStack(spacing: 12) {
                    DSBotIcon(.plus, size: 18)
                    Text(L10n.text("新建项目")).font(.system(size: 15))
                    Spacer()
                }
                .foregroundStyle(DSBotStyle.ink)
                .padding(16)
                .contentShape(Rectangle())
            }
            .buttonStyle(DSBotRowButtonStyle())
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L10n.text("选择项目"))
    }
}

struct IssueProjectCreatePage: View {
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    let onCreated: (IssueProject) -> Void
    @State private var name = ""
    @State private var path = ""
    @State private var createDirectory = false
    @State private var busy = false
    @State private var failed = false

    var body: some View {
        IssueChoiceList(title: L10n.text("新建项目")) {
            VStack(alignment: .leading, spacing: 16) {
                field(L10n.text("项目名称"), value: $name)
                Divider()
                field(L10n.text("项目文件夹"), value: $path)
                Divider()
                Toggle(L10n.text("文件夹不存在时创建"), isOn: $createDirectory)
                    .font(.system(size: 15))
                if failed {
                    Text(L10n.text("项目文件夹没能打开，请检查路径，或勾选创建文件夹。"))
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.chatError)
                }
            }
            .padding(16)
            .disabled(busy)
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(action: submit) {
                    if busy { ProgressView() } else { Text(L10n.text("新建项目")) }
                }
                .disabled(busy || path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.status != .connected)
                .accessibilityLabel(L10n.text("新建项目"))
            }
        }
        .navigationBarBackButtonHidden(busy)
        .interactiveDismissDisabled(busy)
    }

    private func field(_ title: String, value: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 13)).foregroundStyle(DSBotStyle.muted)
            TextField(title, text: value)
                .font(.system(size: 15))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
    }

    private func submit() {
        guard !busy else { return }
        busy = true
        failed = false
        Task {
            let made = await board.createProject(name: name, path: path, createDirectory: createDirectory, using: store)
            busy = false
            if let made { onCreated(made) } else { failed = true }
        }
    }
}

struct IssueLabelsPicker: View {
    @Binding var labels: [IssueLabel]
    @Binding var selected: Set<Int>
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    var onSave: (() -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var naming: String?
    @State private var busy = false
    @State private var failed = false

    private var typed: String { query.split(whereSeparator: \.isWhitespace).joined(separator: " ") }
    private var shown: [IssueLabel] { typed.isEmpty ? labels : labels.filter { $0.name.localizedCaseInsensitiveContains(typed) } }

    var body: some View {
        page
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L10n.text("保存")) {
                        if let onSave { onSave() } else { dismiss() }
                    }.disabled(busy)
                }
            }
            .navigationBarBackButtonHidden(busy)
            .interactiveDismissDisabled(busy)
    }

    @ViewBuilder
    private var page: some View {
        if let naming {
            IssueChoiceList(title: L10n.text("选择标签颜色")) {
                if busy {
                    ProgressView().tint(DSBotStyle.muted).padding(24)
                } else {
                    ForEach(IssueLabelPalette.colors, id: \.id) { color in
                        IssueChoiceRow(title: color.title) {
                            Circle().fill(IssueLabelPalette.color(color.id)).frame(width: 10, height: 10)
                        } action: { create(naming, color: color.id) }
                    }
                }
                if failed { Text(L10n.text("标签没能创建")).font(.system(size: 13)).foregroundStyle(DSBotStyle.chatError).padding(16) }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("取消")) { self.naming = nil; failed = false }.disabled(busy)
                }
            }
        } else {
            IssueChoiceList(title: L10n.text("标签")) {
                ForEach(shown) { label in
                    IssueChoiceRow(title: label.name, selected: selected.contains(label.id)) {
                        Circle().fill(IssueLabelPalette.color(label.color)).frame(width: 10, height: 10)
                    } action: {
                        if selected.contains(label.id) { selected.remove(label.id) } else { selected.insert(label.id) }
                    }
                }
                if labels.isEmpty && typed.isEmpty {
                    Text(L10n.text("还没有标签")).font(.system(size: 14)).foregroundStyle(DSBotStyle.muted).padding(20)
                }
                if !typed.isEmpty && !labels.contains(where: { $0.name.localizedCaseInsensitiveCompare(typed) == .orderedSame }) {
                    IssueChoiceRow(title: L10n.text("新建标签：“{0}”", "\(typed)")) {
                        DSBotIcon(.plus, size: 18)
                    } action: { naming = typed; failed = false }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L10n.text("修改或添加标签…"))
        }
    }

    private func create(_ name: String, color: String) {
        guard !busy else { return }
        busy = true
        failed = false
        Task {
            let made = await board.createLabel(name: name, color: color, using: store)
            busy = false
            if let made {
                labels.append(made)
                labels.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
                selected.insert(made.id)
                naming = nil
                query = ""
            } else { failed = true }
        }
    }
}

struct IssueDuePicker: View {
    let dueAt: Date?
    let onSelect: (Date?) -> Void
    @State private var date: Date

    init(dueAt: Date?, onSelect: @escaping (Date?) -> Void) {
        self.dueAt = dueAt
        self.onSelect = onSelect
        _date = State(initialValue: dueAt ?? Date())
    }

    var body: some View {
        IssueChoiceList(title: L10n.text("截止日期")) {
            ForEach(presets, id: \.title) { preset in
                IssueChoiceRow(title: preset.title, subtitle: preset.date.formatted(.dateTime.month().day())) {
                    DSBotIcon(.dueDate, size: 18, scalesStroke: true)
                } action: { onSelect(Self.atNoon(preset.date)) }
            }
            Divider().padding(.horizontal, 16)
            DatePicker(L10n.text("截止日期"), selection: $date, displayedComponents: .date)
                .datePickerStyle(.graphical)
                .padding(8)
            if dueAt != nil {
                Divider().padding(.horizontal, 16)
                IssueChoiceRow(title: L10n.text("移除截止日期")) {
                    DSBotIcon(.remove, size: 18, scalesStroke: true)
                } action: { onSelect(nil) }
            }
        }
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(L10n.text("保存")) { onSelect(Self.atNoon(date)) }
            }
        }
    }

    private var presets: [(title: String, date: Date)] {
        let calendar = Calendar.current
        let now = Date()
        let friday = (6 - calendar.component(.weekday, from: now) + 7) % 7
        return [(L10n.text("明天"), 1), (L10n.text("本周结束"), friday), (L10n.text("一周后"), 7)].compactMap { title, days in
            calendar.date(byAdding: .day, value: days, to: now).map { (title, $0) }
        }
    }

    private static func atNoon(_ date: Date) -> Date {
        Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: date) ?? date
    }
}

struct IssueParentPicker: View {
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    let onSelect: (BoardIssue) -> Void
    @State private var query = ""
    @State private var items: [BoardIssue] = []
    @State private var loading = true
    @State private var failed = false
    @State private var retry = 0

    var body: some View {
        IssueChoiceList(title: L10n.text("父事项")) {
            if loading {
                ProgressView().tint(DSBotStyle.muted).padding(24)
            } else if failed {
                HStack(spacing: 12) {
                    Text(L10n.text("事项没能加载")).foregroundStyle(DSBotStyle.muted)
                    Button(L10n.text("重试")) { loading = true; retry += 1 }
                }
                .font(.system(size: 14))
                .padding(20)
            } else if items.isEmpty {
                Text(L10n.text("没有找到事项")).font(.system(size: 14)).foregroundStyle(DSBotStyle.muted).padding(20)
            } else {
                ForEach(items) { issue in
                    IssueChoiceRow(title: issue.title, subtitle: issue.ref) {
                        IssueStatusIcon(type: issue.statusType)
                    } action: { onSelect(issue) }
                }
            }
        }
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L10n.text("搜索事项…"))
        .task(id: "\(query)/\(store.connectionRevision)/\(store.status)/\(retry)") {
            loading = true
            failed = false
            if !query.isEmpty {
                do { try await Task.sleep(for: .milliseconds(200)) } catch { return }
            }
            let found = await board.parentIssues(query: String(query.prefix(300)), using: store)
            guard !Task.isCancelled else { return }
            loading = false
            if let found { items = found } else { failed = true }
        }
    }
}
