import Foundation

// The phone's scheduled tasks (owner, 2026-11-10: "侧边栏选 b … 手机上可以新建和编辑，定时任务页列表选 b"), as the plugin serves them: `tasks.*` of the native bridge, which is the desktop's own
// service (`host/assistant/tasks`). The words are the desktop's (`host/dudu-plugin/ui/strings.js`, `tasks`); this file holds plain rows and no markup.

// MARK: Rule

/// The rule of a task as the plugin stores it; each end writes it in its own words (the desktop's `scheduleLabel`, `ui/tasks/format.js`).
struct TaskSchedule: Codable, Equatable, Sendable {
    var kind: String
    var time: String?
    var timezone: String?
    var date: String?
    var expression: String?
    var day: Int?
    var minutes: Double?
    var weekdays: [Int]?

    /// The seven kinds in the desktop's order, and its words for them.
    static let kinds = ["daily", "workdays", "weekly", "monthly", "interval", "once", "cron"]
    private static let kindNames = [
        "daily": "每天", "workdays": "周一至周五", "weekly": "每周", "monthly": "每月", "interval": "间隔", "once": "仅一次", "cron": "Cron",
    ]
    static func kindName(_ kind: String) -> String { kindNames[kind] ?? kind }
    /// Sunday is 0, as in the plugin; the desktop's buttons start on Monday.
    private static let weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
    static let weekdayOrder = [1, 2, 3, 4, 5, 6, 0]
    static func weekdayName(_ day: Int) -> String { weekdayNames[((day % 7) + 7) % 7] }

    /// The rule as the desktop's task pages write it: 每天 09:00, 每周 周一和周三 18:00, 每月 15 09:00, 间隔 30分, 仅一次 2026-11-12 09:00.
    var label: String {
        let base = Self.kindNames[kind]
        if kind == "interval" {
            let amount = minutes.map { $0.rounded() == $0 ? String(Int($0)) : String($0) } ?? ""
            return "\(base ?? "") \(amount)分"
        }
        if kind == "cron" { return expression ?? "" }
        var parts: [String] = []
        if let base { parts.append(base) }
        if let date, !date.isEmpty { parts.append(date) }
        if kind == "monthly", let day { parts.append(String(day)) }
        if kind == "weekly", let weekdays, !weekdays.isEmpty {
            parts.append(Self.list(weekdays.map(Self.weekdayName)))
        }
        if let time, !time.isEmpty { parts.append(time) }
        return parts.joined(separator: " ")
    }

    /// Chinese list of names: 周一和周三, 周一、周三和周五 (what `Intl.ListFormat` gives the desktop).
    static func list(_ items: [String]) -> String {
        switch items.count {
        case 0: return ""
        case 1: return items[0]
        default: return items.dropLast().joined(separator: "、") + "和" + items[items.count - 1]
        }
    }

    /// The line under a task's name: the rule, then 下次运行 and its time in the task's own time zone (only for a task that has a next run).
    func line(nextRunAt: Double?) -> String {
        var parts: [String] = []
        if !label.isEmpty { parts.append(label) }
        if let nextRunAt { parts.append("下次运行 \(Self.stamp(nextRunAt, timezone: timezone))") }
        return parts.joined(separator: " · ")
    }

    /// `11月10日 18:00`, the desktop's `stamp` in Chinese.
    static func stamp(_ milliseconds: Double, timezone: String?) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = timezone.flatMap(TimeZone.init(identifier:)) ?? .current
        formatter.dateFormat = "M月d日 HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: milliseconds / 1_000))
    }

    /// `Asia/Shanghai · UTC+8`, as the desktop's time zone list writes them.
    static func timezoneLabel(_ identifier: String) -> String {
        guard let zone = TimeZone(identifier: identifier) else { return identifier }
        let seconds = zone.secondsFromGMT()
        let sign = seconds < 0 ? "-" : "+"
        let hours = abs(seconds) / 3_600
        let minutes = abs(seconds) % 3_600 / 60
        return "\(identifier) · UTC\(sign)\(hours)\(minutes > 0 ? String(format: ":%02d", minutes) : "")"
    }

    /// The rule a change of kind starts from, with what that kind needs (the desktop's form fills them the same way).
    static func starting(_ kind: String, from old: TaskSchedule) -> TaskSchedule {
        var schedule = TaskSchedule(kind: kind, timezone: old.timezone)
        switch kind {
        case "cron":
            schedule.expression = "0 9 * * *"
        case "interval":
            schedule.minutes = 60
        default:
            schedule.time = old.time ?? "09:00"
            if kind == "once" {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_CA")
                formatter.timeZone = old.timezone.flatMap(TimeZone.init(identifier:)) ?? .current
                formatter.dateFormat = "yyyy-MM-dd"
                schedule.date = formatter.string(from: Date())
            }
            if kind == "weekly" { schedule.weekdays = [1] }
            if kind == "monthly" { schedule.day = 1 }
        }
        return schedule
    }

    /// What the plugin would refuse: a rule that lacks what its kind needs.
    var isComplete: Bool {
        guard Self.kinds.contains(kind), timezone?.isEmpty == false else { return false }
        switch kind {
        case "interval": return (minutes ?? 0) >= 1
        case "cron": return expression?.trimmingCharacters(in: .whitespaces).isEmpty == false
        default: break
        }
        guard let time, time.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) != nil else { return false }
        if kind == "once", date?.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) == nil { return false }
        if kind == "weekly", weekdays?.isEmpty != false { return false }
        if kind == "monthly", !(1...31).contains(day ?? 0) { return false }
        return true
    }

    /// The plain object the plugin takes: only what the kind has.
    var json: JSONValue {
        var object: [String: JSONValue] = ["kind": .string(kind), "timezone": .string(timezone ?? "")]
        if let time { object["time"] = .string(time) }
        if let date { object["date"] = .string(date) }
        if let expression { object["expression"] = .string(expression) }
        if let day { object["day"] = .number(Double(day)) }
        if let minutes { object["minutes"] = .number(minutes) }
        if let weekdays { object["weekdays"] = .array(weekdays.map { .number(Double($0)) }) }
        return .object(object)
    }
}

// MARK: Tasks

/// Who does a task (a task's `agent`, a provider's `id`): 嘟嘟 itself, which the plugin calls `dudu` and which works in a folder of its own, so it has no workspace and makes a conversation for each run (owner,
/// 2026-11-11: one more choice in the 供应商 list, first), or one of DSH's agents.
enum TaskAgent: Equatable, Sendable {
    case dudu
    case agent(SessionAgent)

    static let duduID = "dudu"

    init?(id: String) {
        if id == Self.duduID {
            self = .dudu
        } else if let agent = SessionAgent(rawValue: id) {
            self = .agent(agent)
        } else {
            return nil
        }
    }

    /// The name the app writes for it: 嘟嘟, and the agents' own.
    var name: String {
        switch self {
        case .dudu: return "嘟嘟"
        case .agent(let agent): return agent.name
        }
    }
}

/// A DSH workspace a task can work in (`options.projects`), and the project a task holds (the plugin keeps the folder it was made for).
struct TaskProject: Codable, Identifiable, Equatable, Hashable, Sendable {
    var name: String
    var path: String
    var workspaceId: String?

    var id: String { path }
    private enum CodingKeys: String, CodingKey { case name, path, workspaceId = "id" }

    var json: JSONValue {
        var object: [String: JSONValue] = ["name": .string(name), "path": .string(path)]
        if let workspaceId { object["id"] = .string(workspaceId) }
        return .object(object)
    }
}

/// Where a run goes: a conversation made once and reused, a new one each time, or a conversation that is named.
struct TaskTarget: Codable, Equatable, Sendable {
    /// `reuse`, `new` or `existing`.
    var mode: String
    var sessionId: String?

    static let modes = ["reuse", "new", "existing"]
    private static let names = ["reuse": "新建对话并复用", "new": "每次新建对话", "existing": "已有会话"]
    static func name(_ mode: String) -> String { names[mode] ?? mode }

    /// The choices of the 执行位置 list of whoever does the task. 嘟嘟 makes a conversation of its own for a run and has none that is named, so it has two, the one it starts from first (as the approved drawing
    /// lists them); the agents have the three.
    static func choices(for agent: String) -> [String] { agent == TaskAgent.duduID ? ["new", "reuse"] : modes }
}

struct TaskLastRun: Codable, Equatable, Sendable {
    var id: String
    var at: Double
    var status: String
}

struct ScheduledTask: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var revision: Int
    /// `active`, `paused` or `ended`.
    var status: String
    var title: String
    var prompt: String
    var agent: String
    var model: String?
    /// The workspace the task works in. A task of 嘟嘟 has none (`null`): it works in 嘟嘟's own folder.
    var project: TaskProject?
    var target: TaskTarget
    var schedule: TaskSchedule
    var nextRunAt: Double?
    var sessionId: String?
    var lastRun: TaskLastRun?

    var isActive: Bool { status == "active" }
    var taskAgent: TaskAgent? { TaskAgent(id: agent) }
    /// 已开启 / 已暂停 / 已结束, the desktop's words.
    var statusText: String { Self.statusName(status) }
    static func statusName(_ status: String) -> String {
        switch status {
        case "active": return "已开启"
        case "paused": return "已暂停"
        default: return "已结束"
        }
    }

    /// The line under the name: the rule and, while it is on, when it runs next.
    var line: String { schedule.line(nextRunAt: isActive ? nextRunAt : nil) }
    /// The conversation the task's runs go to: the one it names, or the one it made and reuses.
    var linkedSessionId: String? { target.mode == "existing" ? target.sessionId : sessionId }
}

/// A delivery of a task (`history`): the fact that its prompt was handed to a conversation, never that the agent finished.
struct TaskRun: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var seq: Int?
    var at: Double
    var manual: Bool?
    /// `delivering`, `delivered`, `failed` or `uncertain`.
    var status: String
    var sessionId: String?

    var statusText: String {
        switch status {
        case "delivered": return "已投递"
        case "delivering": return "正在投递"
        case "failed": return "投递失败"
        default: return "待确认"
        }
    }
}

struct TaskHistoryPage: Equatable, Sendable {
    var runs: [TaskRun]
    var nextCursor: Int?
}

// MARK: Options and draft

struct TaskProvider: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var name: String
    var available: Bool
    var models: [String]

    var taskAgent: TaskAgent? { TaskAgent(id: id) }
}

struct TaskSession: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var title: String
    var workspaceId: String?
}

/// What a task can be made of: the providers and their models, the DSH workspaces, the conversations (only when asked for), and this computer's time zone.
struct TaskOptions: Decodable, Equatable, Sendable {
    var outcome: String
    var providers: [TaskProvider]
    var projects: [TaskProject]
    var sessions: [TaskSession]?
    var timezone: String?
}

/// The values of the editor, for a new task or an existing one.
struct TaskDraft: Equatable {
    var title = ""
    var prompt = ""
    var agent = "deepseek"
    var model: String?
    var project: TaskProject?
    var target = TaskTarget(mode: "reuse")
    var schedule: TaskSchedule

    /// A new task starts as the desktop's does: the first available provider (嘟嘟 when the plugin offers it: no workspace, a new conversation for each run), else the first workspace and one conversation
    /// that is reused, every day at 09:00 in this computer's time zone.
    init(options: TaskOptions?) {
        agent = options?.providers.first(where: \.available)?.id ?? "deepseek"
        if agent == TaskAgent.duduID {
            target = TaskTarget(mode: "new")
        } else {
            project = options?.projects.first
        }
        schedule = TaskSchedule(kind: "daily", time: "09:00", timezone: options?.timezone ?? TimeZone.current.identifier)
    }

    init(task: ScheduledTask) {
        title = task.title
        prompt = task.prompt
        agent = task.agent
        model = task.model
        project = task.project
        target = task.target
        schedule = task.schedule
    }

    var isDudu: Bool { agent == TaskAgent.duduID }

    /// Choosing who does the task in the editor. A change between 嘟嘟 and an agent starts the new one's own way: 嘟嘟 has no workspace and makes a new conversation for each run; an agent works in a workspace (the first
    /// one, as a blank task takes it) and reuses one conversation. So a choice the new one cannot have (a workspace for 嘟嘟, a conversation that is named) never stays. A change between agents leaves the
    /// workspace and the target as they are, as it always did; the model belongs to the agent and is cleared.
    mutating func choose(agent id: String, projects: [TaskProject]) {
        guard id != agent else { return }
        let wasDudu = isDudu
        agent = id
        model = nil
        guard wasDudu != isDudu else { return }
        if isDudu {
            project = nil
            target = TaskTarget(mode: "new")
        } else {
            project = projects.first
            target = TaskTarget(mode: "reuse")
        }
    }

    /// What the plugin would refuse is not sent. 嘟嘟 needs no workspace.
    var isComplete: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (isDudu || project != nil)
            && schedule.isComplete
            && (target.mode != "existing" || target.sessionId?.isEmpty == false)
    }

    /// The editable fields of a task, as `tasks.create` takes them and `tasks.update` takes them as a patch. A task of 嘟嘟 is sent with no project.
    var json: JSONValue {
        var targetObject: [String: JSONValue] = ["mode": .string(target.mode)]
        if target.mode == "existing" { targetObject["sessionId"] = .string(target.sessionId ?? "") }
        return .object([
            "title": .string(title.trimmingCharacters(in: .whitespacesAndNewlines)),
            "prompt": .string(prompt.trimmingCharacters(in: .whitespacesAndNewlines)),
            "agent": .string(agent),
            "model": model.map(JSONValue.string) ?? .null,
            "project": isDudu ? JSONValue.null : (project?.json ?? JSONValue.null),
            "target": .object(targetObject),
            "schedule": schedule.json,
        ])
    }
}

// MARK: Tabs

/// The desktop's status filter: all of them, then the three states.
enum TaskTab: String, CaseIterable, Identifiable, Sendable {
    case all, active, paused, ended

    var id: String { rawValue }
    var status: String? { self == .all ? nil : rawValue }
    var title: String {
        switch self {
        case .all: return "全部"
        case .active: return "已开启"
        case .paused: return "已暂停"
        case .ended: return "已结束"
        }
    }
}

// MARK: Model

private struct TasksAnswer: Decodable, Sendable {
    var outcome: String
    var code: String?
    var tasks: [ScheduledTask]?
    var task: ScheduledTask?
    var runs: [TaskRun]?
    var nextCursor: Int?
}

enum TaskAction: String, Sendable {
    case pause, resume, run, duplicate, delete
}

enum TaskSaveResult: Equatable {
    case saved(ScheduledTask)
    /// The plugin's code (`conflict`, `invalid_project`, …), or nil when the computer could not be asked.
    case failed(String?)
}

@MainActor
final class TasksModel: ObservableObject {
    enum LoadState { case loading, loaded, failed }

    @Published private(set) var tasks: [ScheduledTask] = []
    @Published private(set) var state: LoadState = .loading
    @Published var tab: TaskTab = .all
    /// The tasks with a request on its way: their rows show it.
    @Published private(set) var busy: Set<String> = []
    /// The root's "+" asks for the editor of a new task; the page presents it.
    @Published var isMaking = false
    /// The result of the last action, for the toast the page shows (with an undo, where there is one).
    var report: ((DSBotToastMessage) -> Void)?

    private let json = DSBotJSON()
    private var refreshing = false

    var items: [ScheduledTask] { tasks.filter { tab.status == nil || $0.status == tab.status } }
    /// The number behind the sidebar's row: the tasks that are on.
    var enabled: Int { tasks.filter(\.isActive).count }

    /// Forget what was read: another computer has other tasks.
    func reset() {
        tasks = []
        state = .loading
        tab = .all
        busy = []
    }

    func select(_ next: TaskTab) {
        guard next != tab else { return }
        tab = next
    }

    func task(id: String) -> ScheduledTask? { tasks.first { $0.id == id } }

    /// Read the list again, keeping what is on screen meanwhile.
    func refresh(using store: DSBotStore) async {
        guard !refreshing, store.status == .connected else { return }
        refreshing = true
        defer { refreshing = false }
        if tasks.isEmpty, state != .loaded { state = .loading }
        do {
            let value = try await store.request("tasks.list", [:])
            let answer = try await json.decode(TasksAnswer.self, from: value)
            guard answer.outcome == "success", let fresh = answer.tasks else { throw DSBotFailure.protocolError }
            if tasks != fresh { tasks = fresh }
            state = .loaded
        } catch {
            DSBotLog.networkFailure("tasks.list.fail", error: error)
            if tasks.isEmpty { state = .failed }
        }
    }

    /// The providers, workspaces and time zone, and the conversations when a task is to go to one.
    func options(includeSessions: Bool, using store: DSBotStore) async -> TaskOptions? {
        do {
            let value = try await store.request("tasks.options", ["includeSessions": .bool(includeSessions)], timeoutSeconds: 40)
            let options = try await json.decode(TaskOptions.self, from: value)
            return options.outcome == "success" ? options : nil
        } catch {
            DSBotLog.networkFailure("tasks.options.fail", error: error)
            return nil
        }
    }

    func create(_ draft: TaskDraft, using store: DSBotStore) async -> TaskSaveResult {
        let result = Self.saved(await write("tasks.create", ["fields": draft.json], using: store))
        if case .saved = result { await refresh(using: store) }
        return result
    }

    func update(_ task: ScheduledTask, with draft: TaskDraft, using store: DSBotStore) async -> TaskSaveResult {
        let result = Self.saved(await write("tasks.update", ["id": .string(task.id), "revision": .number(Double(task.revision)), "patch": draft.json], using: store))
        switch result {
        case .saved: await refresh(using: store)
        // Another end changed the task first: what is there now is read again, and the editor says the change was not kept.
        case .failed(let code) where code == "conflict": await refresh(using: store)
        case .failed: break
        }
        return result
    }

    /// What the plugin answered to a write: success (a delete answers without a task), or its code.
    private enum Written {
        case ok(ScheduledTask?)
        case failed(String?)
    }

    private static func saved(_ written: Written) -> TaskSaveResult {
        switch written {
        case .ok(let task?): return .saved(task)
        case .ok(nil): return .failed(nil)
        case .failed(let code): return .failed(code)
        }
    }

    private func write(_ method: String, _ params: [String: JSONValue], using store: DSBotStore) async -> Written {
        do {
            let value = try await store.request(method, params, timeoutSeconds: 45)
            let answer = try await json.decode(TasksAnswer.self, from: value)
            return answer.outcome == "success" ? .ok(answer.task) : .failed(answer.code)
        } catch {
            DSBotLog.networkFailure("\(method).fail", error: error)
            return .failed(nil)
        }
    }

    /// Pause, resume, run now, copy or delete one task. The toast says what was done; a pause and a resume have an undo.
    @discardableResult
    func act(_ action: TaskAction, _ task: ScheduledTask, using store: DSBotStore) async -> Bool {
        guard !busy.contains(task.id) else { return false }
        busy.insert(task.id)
        defer { busy.remove(task.id) }
        let written = await write("tasks.\(action.rawValue)", ["id": .string(task.id), "revision": .number(Double(task.revision))], using: store)
        guard case .ok(let made) = written else {
            if action == .delete, case .failed(let code) = written, code == "not_found" { tasks.removeAll { $0.id == task.id } }
            report?(DSBotToastMessage(text: "更改没能保存", kind: .error))
            await refresh(using: store)
            return false
        }
        switch action {
        case .pause, .resume:
            let back: TaskAction = action == .pause ? .resume : .pause
            report?(DSBotToastMessage(text: action == .pause ? "已暂停任务" : "已恢复任务", kind: .success, action: DSBotToastAction(title: "撤销") { [weak self] in
                guard let self, let made else { return }
                Task { @MainActor in await self.act(back, made, using: store) }
            }))
        case .run:
            report?(DSBotToastMessage(text: "正在投递", kind: .success))
        case .duplicate:
            report?(DSBotToastMessage(text: "已复制任务", kind: .success))
        case .delete:
            tasks.removeAll { $0.id == task.id }
            report?(DSBotToastMessage(text: "已删除任务", kind: .success))
        }
        await refresh(using: store)
        return true
    }

    /// The deliveries of a task, newest first, thirty a page.
    func history(of task: ScheduledTask, before: Int?, using store: DSBotStore) async -> TaskHistoryPage? {
        do {
            var params: [String: JSONValue] = ["id": .string(task.id)]
            if let before { params["before"] = .number(Double(before)) }
            let value = try await store.request("tasks.history", params)
            let answer = try await json.decode(TasksAnswer.self, from: value)
            guard answer.outcome == "success" else { return nil }
            return TaskHistoryPage(runs: answer.runs ?? [], nextCursor: answer.nextCursor)
        } catch {
            DSBotLog.networkFailure("tasks.history.fail", error: error)
            return nil
        }
    }
}
