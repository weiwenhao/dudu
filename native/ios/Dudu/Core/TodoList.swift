import Foundation

/// One line of the conversation's task list, as DSH's "任务" panel above the composer shows it.
struct TodoItem: Codable, Equatable, Sendable {
    var content: String
    /// `completed`, `in_progress` or `pending`.
    var status: String

    var isCompleted: Bool { status == "completed" }
    var isInProgress: Bool { status == "in_progress" }
}

enum TodoSummary {
    /// DSH's header counts: each state that has items, joined by " · ", in the order done, active, pending.
    static func progress(_ todos: [TodoItem]) -> String {
        let done = todos.filter(\.isCompleted).count
        let active = todos.filter(\.isInProgress).count
        let pending = todos.count - done - active
        return [
            done > 0 ? L10n.text("{0} 已完成", "\(done)") : nil,
            active > 0 ? L10n.text("{0} 进行中", "\(active)") : nil,
            pending > 0 ? L10n.text("{0} 待处理", "\(pending)") : nil
        ].compactMap { $0 }.joined(separator: " · ")
    }
}
