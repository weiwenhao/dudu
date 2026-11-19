import SwiftUI

private enum BoardFilterCategory: String, Identifiable {
    case status, agent, sessionState, priority, dates, project, label, source

    static let groups: [[Self]] = [
        [.status, .agent, .sessionState, .priority, .dates], [.project, .label], [.source],
    ]

    var id: String { rawValue }
    var title: String { self == .dates ? L10n.text("日期") : fields[0].title }
    var fields: [BoardFilterField] {
        if self == .dates { return [.due, .created, .updated] }
        return BoardFilterField(rawValue: rawValue).map { [$0] } ?? []
    }

    var glyph: DuduGlyph {
        switch self {
        case .status: return .filterStatus
        case .agent: return .model
        case .sessionState: return .trace
        case .priority: return .issuePriority
        case .dates: return .filterDates
        case .project: return .issueProject
        case .label: return .issueLabel
        case .source: return .issueSource
        }
    }
}

struct BoardFilterSheet: View {
    @ObservedObject var board: BoardModel
    @Environment(\.dismiss) private var dismiss
    @FocusState private var isSearching: Bool
    @State private var category: BoardFilterCategory?
    @State private var search = ""
    @State private var height: CGFloat = 492
    @State private var detent: PresentationDetent = .height(492)

    private let rowHeight: CGFloat = 44

    var body: some View {
        let labels = board.filterLabels
        let scopedRows = board.scopedConversations
        let fields = category?.fields ?? []
        let options = fields.map { field in
            board.filters.options(for: field, in: scopedRows, statuses: board.filterStatuses, labels: labels)
        }
        let contentHeight = category == nil ? 8 * rowHeight + 16
            : CGFloat(options.reduce(0) { $0 + $1.count }) * rowHeight
                + (fields.count > 1 ? CGFloat(fields.count) * 32 - 8 : 0)
        let fittedHeight = min(max(188, contentHeight + 124), max(188, DuduLayout.screenHeight * 0.79))

        QuickSheetPage(
            title: category?.title ?? L10n.text("筛选"),
            onBack: category == nil ? nil : { open(nil) },
            onClose: { dismiss() },
            centersTitle: true,
            leading: category == nil ? QuickSheetLeading(
                title: L10n.text("重置"), isEnabled: !board.filters.isEmpty, action: board.resetFilters
            ) : nil,
            horizontalInset: DuduLayout.sidebarPadding,
            actions: {}
        ) {
            searchBox
        } content: {
            if category == nil { categories(labels: labels) }
            else { choices(fields: fields, options: options) }
        } footer: {}
        .id(category)
        .tint(DuduStyle.ink)
        .presentationDetents([.height(height), .large], selection: $detent)
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(31)
        .presentationBackground(DuduStyle.sheet)
        .onChange(of: fittedHeight, initial: true) { _, next in
            height = next
            if detent != .large { detent = .height(next) }
        }
    }

    private func open(_ next: BoardFilterCategory?) {
        isSearching = false
        search = ""
        category = next
    }

    private func matches(_ title: String) -> Bool {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty || title.localizedStandardContains(query)
    }

    private var searchBox: some View {
        HStack(spacing: 12) {
            DuduIcon(.search, size: 16)
                .foregroundStyle(DuduStyle.muted)
                .accessibilityHidden(true)
            TextField(
                "", text: $search,
                prompt: Text(category == nil ? L10n.text("添加筛选…") : L10n.text("筛选…"))
                    .foregroundStyle(DuduStyle.chatSecondary)
            )
            .accessibilityLabel(category == nil ? L10n.text("添加筛选…") : L10n.text("筛选…"))
            .textFieldStyle(.plain)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .submitLabel(.search)
            .focused($isSearching)
            if !search.isEmpty {
                Button { search = "" } label: {
                    DuduIcon(.close, size: 14)
                        .foregroundStyle(DuduStyle.muted)
                        .frame(width: 32, height: 36)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DuduQuietPressStyle())
                .accessibilityLabel(L10n.text("清除搜索"))
            }
        }
        .font(.system(size: 15))
        .padding(.horizontal, 15)
        .frame(height: 38)
        .background(.white, in: RoundedRectangle(cornerRadius: 12))
        .padding(.horizontal, DuduLayout.sidebarPadding)
        .padding(.bottom, 8)
    }

    private func categories(labels: [String: IssueLabel]) -> some View {
        VStack(spacing: 8) {
            ForEach(BoardFilterCategory.groups.indices, id: \.self) { index in
                let rows = BoardFilterCategory.groups[index].filter { matches($0.title) }
                if !rows.isEmpty {
                    card {
                        ForEach(rows) { category in
                            let selected = category.fields.flatMap { field in
                                board.filters.selectedTitles(in: field, statuses: board.filterStatuses, labels: labels)
                            }
                            Button { open(category) } label: {
                                HStack(spacing: 12) {
                                    if category == .priority {
                                        IssuePriorityIcon(priority: .high).frame(width: 18)
                                    } else {
                                        DuduIcon(category.glyph, size: 18)
                                            .foregroundStyle(DuduStyle.chatSecondary)
                                            .accessibilityHidden(true)
                                    }
                                    Text(category.title)
                                        .font(.system(size: 16))
                                        .fixedSize(horizontal: true, vertical: false)
                                    Spacer(minLength: 0)
                                    if !selected.isEmpty {
                                        Text(ListFormatter.localizedString(byJoining: selected))
                                            .font(.system(size: 14))
                                            .foregroundStyle(DuduStyle.blue)
                                            .lineLimit(1)
                                    }
                                    DuduIcon(.right, size: 14)
                                        .foregroundStyle(DuduStyle.muted)
                                        .accessibilityHidden(true)
                                }
                                .padding(.horizontal, 15)
                                .frame(minHeight: rowHeight)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(DuduRowButtonStyle())
                            .overlay(alignment: .top) {
                                if category != rows.first { QuickTodoSeparator(leading: 15).allowsHitTesting(false) }
                            }
                        }
                    }
                }
            }
        }
    }

    private func choices(fields: [BoardFilterField], options: [[BoardFilterOption]]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(fields.indices, id: \.self) { index in
                let field = fields[index]
                let shown = options[index].filter { matches($0.title) }
                if !shown.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        if fields.count > 1 {
                            Text(field.title)
                                .font(.system(size: 13))
                                .foregroundStyle(DuduStyle.chatSecondary)
                                .padding(.horizontal, 9)
                                .accessibilityAddTraits(.isHeader)
                        }
                        card {
                            ForEach(shown) { option in
                                optionRow(option, field: field)
                                    .overlay(alignment: .top) {
                                        if option.id != shown.first?.id {
                                            QuickTodoSeparator(leading: 15).allowsHitTesting(false)
                                        }
                                    }
                            }
                        }
                    }
                }
            }
        }
    }

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0, content: content)
            .background(.white, in: RoundedRectangle(cornerRadius: 16))
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func optionRow(_ option: BoardFilterOption, field: BoardFilterField) -> some View {
        let checked = board.filters.contains(option.id, in: field)
        return Button { board.toggle(option, in: field) } label: {
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(checked ? DuduStyle.blue : .white)
                    .overlay {
                        if checked {
                            DuduIcon(.check, size: 14).foregroundStyle(.white)
                        } else {
                            RoundedRectangle(cornerRadius: 4)
                                .strokeBorder(DuduStyle.muted.opacity(0.45), lineWidth: 1)
                        }
                    }
                    .frame(width: 18, height: 18)
                    .accessibilityHidden(true)
                optionIcon(option, field: field)
                Text(option.title).font(.system(size: 16)).lineLimit(1)
                Spacer(minLength: 8)
                if let count = option.count {
                    Text(count.formatted())
                        .font(.system(size: 14))
                        .foregroundStyle(DuduStyle.chatSecondary)
                }
            }
            .padding(.horizontal, 15)
            .frame(minHeight: rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(DuduRowButtonStyle())
        .accessibilityAddTraits(checked ? .isSelected : [])
    }

    @ViewBuilder private func optionIcon(_ option: BoardFilterOption, field: BoardFilterField) -> some View {
        switch field {
        case .priority:
            if let priority = option.id.flatMap(IssuePriority.init(rawValue:)) {
                IssuePriorityIcon(priority: priority)
            }
        case .status:
            if let type = option.status?.type ?? option.id {
                IssueStatusIcon(type: type, color: option.status?.color, iconProgress: option.status?.iconProgress)
            }
        case .agent:
            if let agent = option.id.flatMap(SessionAgent.init(rawValue:)) {
                AgentLogo(agent: agent, size: 16).accessibilityHidden(true)
            }
        case .label:
            if let color = option.labelColor {
                Circle().fill(IssueLabelPalette.color(color)).frame(width: 9, height: 9).accessibilityHidden(true)
            }
        default:
            EmptyView()
        }
    }
}
