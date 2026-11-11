import Foundation

// The quick buttons above the input of 嘟嘟's chat and the cards they send (owner, 2026-11-10; the plugin: `host/assistant/home/cards.mjs`, the desktop: `ui/pet/QuickCards.jsx`).
//
// A tap asks the plugin to make 嘟嘟 send a card into the conversation (`assistant.card`). The card comes back as an entry of the thread, like any other message: the plugin keeps the rows
// under the id of the command that made it, and its bridge attaches them to that command's entry of the transcript (`card`). The rows are a snapshot of the moment of the tap, and they are
// the app's own: a todo is a board row, a piece of information is a collector row, a task has the words the desktop's task pages use. Only the rows of a todo card open something.

enum QuickCardKind: String, CaseIterable, Identifiable, Codable, Sendable {
    case todo, info, task

    var id: String { rawValue }

    /// The desktop's words for the three: the status 待办, the Collector's name 信息 and 任务 (`T.status.todo`, `T.widgets.titles.collector`, `T.tasks.title`).
    var title: String {
        switch self {
        case .todo: return "待办"
        case .info: return "信息"
        case .task: return "任务"
        }
    }

    /// What an empty card says at the right of its title: the board's and the Collector's own words, and 没有任务 (it was 没有定时任务, approved by the owner on 2026-11-10; 定时任务 became 任务 on 2026-11-11: `docs/issues-ui-wording.md`).
    var emptyText: String {
        switch self {
        case .todo: return "没有事项"
        case .info: return "没有信息"
        case .task: return "没有任务"
        }
    }
}

/// One scheduled task of a card: what it is called, which agent runs it, whether it is on, its rule and when it runs next.
struct QuickCardTask: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var title: String
    var agent: String?
    /// `active` or `paused`; a task that is over is not on the card.
    var status: String
    var nextRunAt: Double?
    var schedule: TaskSchedule?

    /// Who does it: 嘟嘟 itself or one of the agents (`TaskAgent`).
    var taskAgent: TaskAgent? { agent.flatMap(TaskAgent.init(id:)) }
    var isPaused: Bool { status == "paused" }
    /// 已开启 / 已暂停, the desktop's words for a task's state.
    var statusText: String { isPaused ? "已暂停" : "已开启" }

    /// The line under the title: the rule, then 下次运行 and its time in the task's own time zone (`TaskRow`, `ui/pet/QuickCards.jsx`).
    var line: String { schedule?.line(nextRunAt: nextRunAt) ?? "" }
}

/// One card: the first rows of a list as it was when the button was tapped, and how many the list had in all.
struct QuickCard: Codable, Equatable, Sendable {
    /// The command of 嘟嘟's conversation that makes a card (`CARD_COMMAND`, `host/assistant/home/cards.mjs`).
    static let command = "dudu-card"

    var kind: QuickCardKind
    var at: Double
    var total: Int
    var issues: [BoardIssue] = []
    var records: [CollectorRecord] = []
    var tasks: [QuickCardTask] = []

    var rowCount: Int {
        switch kind {
        case .todo: return issues.count
        case .info: return records.count
        case .task: return tasks.count
        }
    }

    private enum CodingKeys: String, CodingKey { case kind, at, total, rows }

    init(kind: QuickCardKind, at: Double = 0, total: Int? = nil, issues: [BoardIssue] = [], records: [CollectorRecord] = [], tasks: [QuickCardTask] = []) {
        self.kind = kind
        self.at = at
        self.issues = issues
        self.records = records
        self.tasks = tasks
        self.total = 0
        self.total = total ?? rowCount
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(QuickCardKind.self, forKey: .kind)
        at = try container.decodeIfPresent(Double.self, forKey: .at) ?? 0
        total = 0
        switch kind {
        case .todo: issues = try container.decode([BoardIssue].self, forKey: .rows)
        case .info: records = try container.decode([CollectorRecord].self, forKey: .rows)
        case .task: tasks = try container.decode([QuickCardTask].self, forKey: .rows)
        }
        total = try container.decodeIfPresent(Int.self, forKey: .total) ?? rowCount
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(kind, forKey: .kind)
        try container.encode(at, forKey: .at)
        try container.encode(total, forKey: .total)
        switch kind {
        case .todo: try container.encode(issues, forKey: .rows)
        case .info: try container.encode(records, forKey: .rows)
        case .task: try container.encode(tasks, forKey: .rows)
        }
    }
}

extension QuickCard {
    /// The card that a tap of `kind` would only repeat (owner, 2026-11-10: "连点就发一张，如果都一样的话，就去个重"): the newest of its kind with nothing after it in the thread but other cards. The plugin
    /// compares the lists; a conversation since then (a message, a reply, a command line) makes the next card a new one even when the list is the same, so this is nil.
    static func repeatable(in rows: [TranscriptRow], kind: QuickCardKind) -> String? {
        for row in rows.reversed() {
            guard case let .command(command) = row, let card = command.card else { return nil }
            if card.kind == kind { return command.commandId }
        }
        return nil
    }
}

/// What the plugin said to a tap on a quick button.
enum QuickCardAnswer: Equatable, Sendable {
    /// A new card is in the thread (it arrives with the conversation's next snapshot, or has already): the command that made it, which names its entry.
    case made(commandId: String?)
    /// The list is the same as the card at the end of the thread (`commandId`), so nothing was made.
    case unchanged(commandId: String?)
    case failed
}

/// What a command's entry of the transcript carries for a card. A card this app cannot read (a newer plugin's) is no card: the command keeps its plain row and the conversation still opens.
struct QuickCardSlot: Codable, Equatable, Sendable {
    var card: QuickCard?

    init(_ card: QuickCard?) { self.card = card }

    init(from decoder: Decoder) throws {
        card = try? QuickCard(from: decoder)
    }

    func encode(to encoder: Encoder) throws {
        if let card {
            try card.encode(to: encoder)
        } else {
            var container = encoder.singleValueContainer()
            try container.encodeNil()
        }
    }
}
