import Foundation

struct BoardFilterOption: Identifiable {
    let id: String?
    let title: String
    let count: Int?
    var status: IssueWorkflowStatus?
    var labelColor: String?
}

enum BoardFilterField: String, Hashable {
    case status, agent, sessionState, priority, project, label, source, due, created, updated

    var title: String {
        switch self {
        case .status: return L10n.text("状态")
        case .agent: return L10n.text("智能体")
        case .sessionState: return L10n.text("会话状态")
        case .priority: return L10n.text("优先级")
        case .project: return L10n.text("项目")
        case .label: return L10n.text("标签")
        case .source: return L10n.text("来源")
        case .due: return L10n.text("截止日期")
        case .created: return L10n.text("创建时间")
        case .updated: return L10n.text("更新时间")
        }
    }

    var fixedKeys: [String]? {
        switch self {
        case .sessionState: return ["unread", "processing", "idle", "unassigned"]
        case .priority: return IssuePriority.allCases.map(\.rawValue)
        case .source: return ["owner", "dudu", "connector", "session"]
        case .due: return ["overdue", "today", "next7", "next30"]
        case .created, .updated: return ["day", "week", "month"]
        case .status, .agent, .project, .label: return nil
        }
    }

    var isDate: Bool { self == .due || self == .created || self == .updated }

    func keys(in row: BoardConversation) -> [String?] {
        guard let issue = row.issue else { return [] }
        switch self {
        case .status: return [issue.status]
        case .agent: return [issue.agent]
        case .sessionState:
            // For phone-openable sessions, pending read receipts and watched work may be newer than the poll.
            return [row.sessionId == nil ? issue.sessionState ?? "unassigned" : row.sessionState.rawValue]
        case .priority: return [issue.priority]
        case .project: return [issue.project]
        case .label: return (issue.labels ?? []).map { String($0.id) }
        case .source: return [issue.source]
        case .due, .created, .updated: return []
        }
    }

    func title(for key: String?, statuses: [IssueWorkflowStatus], labels: [String: IssueLabel]) -> String {
        switch self {
        case .status:
            return key.map { id in statuses.first { $0.id == id }?.title ?? IssueWorkflowStatus.title(for: id) } ?? ""
        case .agent:
            return key.flatMap(SessionAgent.init(rawValue:))?.name ?? L10n.text("未分配")
        case .sessionState:
            return key.flatMap(SessionActivityState.init(rawValue:))?.name ?? L10n.text("未分配")
        case .priority:
            return key.flatMap(IssuePriority.init(rawValue:))?.title ?? ""
        case .project:
            return key ?? L10n.text("无项目")
        case .label:
            return key.map { labels[$0]?.name ?? "#\($0)" } ?? ""
        case .source:
            switch key {
            case "owner": return L10n.text("你")
            case "dudu": return L10n.text("嘟嘟")
            case "connector": return L10n.text("信息")
            case "session": return L10n.text("会话")
            default: return ""
            }
        case .due, .created, .updated:
            switch key {
            case "overdue": return L10n.text("已逾期")
            case "today": return L10n.text("今天")
            case "next7": return L10n.text("未来 7 天")
            case "next30": return L10n.text("未来 30 天")
            case "day": return L10n.text("过去一天")
            case "week": return L10n.text("过去一周")
            case "month": return L10n.text("过去一个月")
            default: return ""
            }
        }
    }

    func bounds(for key: String, now: Date, calendar: Calendar) -> Range<Double>? {
        if self == .due {
            let start = calendar.startOfDay(for: now)
            let from = start.timeIntervalSince1970 * 1000
            if key == "overdue" { return -.infinity..<from }
            let days = ["today": 1, "next7": 7, "next30": 30]
            guard let days = days[key], let end = calendar.date(byAdding: .day, value: days, to: start) else { return nil }
            return from..<(end.timeIntervalSince1970 * 1000)
        }
        let days = ["day": 1, "week": 7, "month": 30]
        guard let days = days[key] else { return nil }
        let hour = floor(now.timeIntervalSince1970 / 3600) * 3600
        return ((hour - Double(days) * 86_400) * 1000)..<Double.infinity
    }

    func timestamp(in row: BoardConversation) -> Double? {
        switch self {
        case .due: return row.issue?.dueAt
        case .created: return row.issue?.createdAt
        case .updated: return row.receivedAt // Same completed-message clock as Desktop and the list order.
        default: return nil
        }
    }
}

/// The desktop's named criteria, kept locally so offline rows and read changes filter immediately.
struct BoardFilters: Equatable {
    private var values: [BoardFilterField: Set<String?>] = [:]
    var isEmpty: Bool { values.isEmpty }

    init() {}

    /// The choices as the phone keeps them (`BoardFilterStore`): field → keys, `nil` being the 无 choice (no project, no agent).
    var saved: [String: [String?]] {
        values.reduce(into: [:]) { saved, entry in saved[entry.key.rawValue] = Array(entry.value) }
    }

    /// What was kept, read back: a field this build does not know is dropped, a date field keeps only one of its own choices.
    init(saved: [String: [String?]]) {
        for (name, keys) in saved {
            guard let field = BoardFilterField(rawValue: name) else { continue }
            var selected = Set(keys.prefix(256))
            if field.isDate {
                selected = Set(selected.compactMap { $0 }.filter { field.fixedKeys?.contains($0) == true }.prefix(1).map(Optional.some))
            }
            if !selected.isEmpty { values[field] = selected }
        }
    }
    func contains(_ key: String?, in field: BoardFilterField) -> Bool { values[field]?.contains(key) == true }
    /// What is chosen in one field (the search page's pills list it).
    func chosenKeys(in field: BoardFilterField) -> Set<String?> { values[field] ?? [] }

    mutating func toggle(_ key: String?, in field: BoardFilterField) {
        var selected = values[field] ?? []
        if selected.remove(key) == nil {
            if field.isDate { selected = [key] } else { selected.insert(key) }
        }
        values[field] = selected.isEmpty ? nil : selected
    }

    func matching(
        _ rows: [BoardConversation], ignoring field: BoardFilterField? = nil,
        now: Date = .now, calendar: Calendar = .current
    ) -> [BoardConversation] {
        let criteria = values.filter { $0.key != field }
        guard !criteria.isEmpty else { return rows }
        let dates = criteria.compactMap { key, selected -> (BoardFilterField, Range<Double>)? in
            guard key.isDate, let choice = selected.compactMap({ $0 }).first,
                  let range = key.bounds(for: choice, now: now, calendar: calendar) else { return nil }
            return (key, range)
        }
        let properties = criteria.filter { !$0.key.isDate }
        return rows.filter { row in
            guard row.issue != nil else { return false }
            return properties.allSatisfy { key, selected in key.keys(in: row).contains { selected.contains($0) } }
                && dates.allSatisfy { key, range in key.timestamp(in: row).map(range.contains) == true }
        }
    }

    func options(
        for field: BoardFilterField, in rows: [BoardConversation], statuses: [IssueWorkflowStatus], labels: [String: IssueLabel],
        counts suppliedCounts: [String?: Int]? = nil
    ) -> [BoardFilterOption] {
        let counts = suppliedCounts ?? (field.isDate ? [:] : matching(rows, ignoring: field).reduce(into: [String?: Int]()) { counts, row in
            for key in field.keys(in: row) { counts[key, default: 0] += 1 }
        })
        let selected = values[field] ?? []
        func title(_ key: String?) -> String { field.title(for: key, statuses: statuses, labels: labels) }
        let keys: [String?]
        if let fixed = field.fixedKeys {
            keys = fixed.map(Optional.some)
        } else if field == .status {
            let known = statuses.isEmpty ? ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] : statuses.map(\.id)
            keys = known.map(Optional.some) + selected.subtracting(known.map(Optional.some)).sorted { title($0) < title($1) }
        } else {
            keys = Set(counts.keys).union(selected).sorted { left, right in
                guard let left else { return false }
                guard let right else { return true }
                let order = title(left).localizedStandardCompare(title(right))
                return order == .orderedSame ? left < right : order == .orderedAscending
            }
        }
        return keys.map { key in
            BoardFilterOption(
                id: key, title: title(key), count: field.isDate ? nil : counts[key, default: 0],
                status: field == .status ? statuses.first { $0.id == key } : nil,
                labelColor: key.flatMap { labels[$0]?.color }
            )
        }
    }

    func selectedTitles(in field: BoardFilterField, statuses: [IssueWorkflowStatus], labels: [String: IssueLabel]) -> [String] {
        (values[field] ?? []).map { field.title(for: $0, statuses: statuses, labels: labels) }
            .sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }
}
