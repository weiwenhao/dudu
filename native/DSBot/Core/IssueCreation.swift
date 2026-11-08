import Foundation

struct IssueWorkflowStatus: Decodable, Identifiable, Equatable, Sendable {
    var id: String
    var type: String
    var name: String?
    var color: String?
    var isDefault: Bool

    var title: String { name ?? Self.title(for: type) }

    static func title(for type: String) -> String {
        switch type {
        case "backlog": return "待规划"
        case "todo": return "待办"
        case "in_progress": return "处理中"
        case "in_review": return "待审核"
        case "done": return "已完成"
        case "canceled": return "已取消"
        default: return type
        }
    }
}

enum IssuePriority: String, CaseIterable, Identifiable, Sendable {
    case none, urgent, high, medium, low
    var id: String { rawValue }

    var title: String {
        switch self {
        case .none: return "无优先级"
        case .urgent: return "紧急"
        case .high: return "高"
        case .medium: return "中"
        case .low: return "低"
        }
    }
}

struct IssueProject: Codable, Identifiable, Equatable, Sendable {
    var name: String
    var path: String?
    var id: String { path ?? name }
}

struct IssueLabel: Decodable, Identifiable, Equatable, Sendable {
    var id: Int
    var name: String
    var color: String
}

struct IssueCreationOptions: Decodable, Sendable {
    var outcome: String
    var statuses: [IssueWorkflowStatus]
    var projects: [IssueProject]
    var labels: [IssueLabel]
}

/// Only the values exposed by Desktop's New issue dialog. Source and session metadata stay on the computer.
struct IssueCreationDraft: Sendable {
    var title = ""
    var brief = ""
    var status: String?
    var priority: IssuePriority = .none
    var project: IssueProject?
    var agent: SessionAgent?
    var labels: Set<Int> = []
    var dueAt: Date?
    var parent: BoardIssue?

    var parameters: [String: JSONValue] {
        var values: [String: JSONValue] = [
            "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "priority": .string(priority.rawValue),
        ]
        let description = brief.trimmingCharacters(in: .whitespacesAndNewlines)
        if !description.isEmpty { values["description"] = .string(description) }
        if let status { values["status"] = .string(status) }
        if let project {
            var fields: [String: JSONValue] = ["name": .string(project.name)]
            if let path = project.path, !path.isEmpty {
                fields["path"] = .string(path)
                if let agent { values["agent"] = .string(agent.rawValue) }
            }
            values["project"] = .object(fields)
        }
        if !labels.isEmpty { values["labels"] = .array(labels.sorted().map { .number(Double($0)) }) }
        if let dueAt { values["dueAt"] = .number((dueAt.timeIntervalSince1970 * 1000).rounded()) }
        if let parent { values["parent"] = .number(Double(parent.id)) }
        return values
    }
}
