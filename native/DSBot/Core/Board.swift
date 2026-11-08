import Foundation

// The board (the phone's home page) and the Collector, as the plugin answers them (`host/native-board.mjs`).
// The words are the desktop interface's own; the models hold plain rows and no markup.

// MARK: Board

/// One issue, as a row of the board: a title, the agent that has it and what that agent is doing, and the DSH session behind it.
struct BoardIssue: Codable, Identifiable, Equatable, Sendable {
    var id: Int
    var ref: String?
    var title: String
    var agent: String?
    var agentState: String
    var agentFinished: Bool?
    var deepSleep: Bool?
    var status: String
    var statusType: String
    var priority: String
    var project: String?
    var dueAt: Double?
    var updatedAt: Double
    /// The DSH session of the issue, when the phone can open one.
    var sessionId: String?
    /// Only in the answer of `issue.get`.
    var description: String?
    var hasSession: Bool?
    var createdAt: Double?

    var sessionAgent: SessionAgent? { agent.flatMap(SessionAgent.init(rawValue:)) }
    var workState: AgentWorkState { AgentWorkState(rawValue: agentState) ?? .idle }
    /// What the issue is called by: its project's reference, else its number.
    var reference: String { ref ?? "#\(id)" }
}

/// The issues of one agent state, in the order the plugin sent them.
struct BoardGroup: Codable, Identifiable, Equatable, Sendable {
    var key: String
    var count: Int
    var nextCursor: String?
    var items: [BoardIssue]

    var id: String { key }
    var title: String { Self.title(for: key) }

    /// The phone puts what needs the owner first (the desktop lists what is working first).
    static let order = ["blocked", "working", "idle", "unassigned"]

    static func title(for key: String) -> String {
        switch key {
        case "blocked": return "需要你"
        case "working": return "工作中"
        case "idle": return "空闲"
        default: return "未分配"
        }
    }
}

enum BoardTab: String, CaseIterable, Identifiable, Sendable {
    case active, backlog, all

    var id: String { rawValue }
    var title: String {
        switch self {
        case .active: return "进行中"
        case .backlog: return "待规划"
        case .all: return "全部事项"
        }
    }
}

private struct BoardAnswer: Decodable, Sendable {
    var outcome: String
    var tab: String?
    var total: Int?
    var groups: [BoardGroup]?
}

private struct IssueAnswer: Decodable, Sendable {
    var outcome: String
    var issue: BoardIssue?
    var items: [BoardIssue]?
    var sessionId: String?
    var project: IssueProject?
    var label: IssueLabel?
}

/// The board and what the phone does with an issue: list, open its session, make one.
@MainActor
final class BoardModel: ObservableObject {
    enum LoadState: Equatable { case loading, loaded, failed }

    @Published private(set) var tab: BoardTab = .active
    @Published private(set) var groupsByTab: [BoardTab: [BoardGroup]] = [:]
    @Published private(set) var states: [BoardTab: LoadState] = [:]
    @Published private(set) var foldedGroups: Set<String> = []
    @Published private(set) var loadingMore: Set<String> = []
    private let json = DSBotJSON()
    private var refreshing = false

    var groups: [BoardGroup] { groupsByTab[tab] ?? [] }
    var state: LoadState { states[tab] ?? .loading }

    /// The issues in the order the board shows them, folded groups included.
    var orderedIssues: [BoardIssue] { groups.flatMap(\.items) }

    func select(_ next: BoardTab) { tab = next }

    /// Forget what was read: another computer has another board.
    func reset() {
        groupsByTab = [:]
        states = [:]
        foldedGroups = []
        loadingMore = []
        tab = .active
    }

    func isFolded(_ group: BoardGroup) -> Bool { foldedGroups.contains("\(tab.rawValue)/\(group.key)") }

    func toggle(_ group: BoardGroup) {
        let key = "\(tab.rawValue)/\(group.key)"
        if foldedGroups.contains(key) { foldedGroups.remove(key) } else { foldedGroups.insert(key) }
    }

    /// Read the tab again. A refresh keeps what is on screen; only a tab that has nothing yet shows its loading.
    func refresh(using store: DSBotStore) async {
        guard !refreshing, store.status == .connected else { return }
        refreshing = true
        defer { refreshing = false }
        let wanted = tab
        if groupsByTab[wanted] == nil { states[wanted] = .loading }
        do {
            let value = try await store.request("board.list", ["tab": .string(wanted.rawValue)])
            let answer = try await json.decode(BoardAnswer.self, from: value)
            guard answer.outcome == "success" else { throw DSBotFailure.protocolError }
            let groups = (answer.groups ?? []).sorted {
                (BoardGroup.order.firstIndex(of: $0.key) ?? .max) < (BoardGroup.order.firstIndex(of: $1.key) ?? .max)
            }
            if groupsByTab[wanted] != groups { groupsByTab[wanted] = groups }
            states[wanted] = .loaded
        } catch {
            DSBotLog.networkFailure("board.load.fail", error: error)
            if groupsByTab[wanted] == nil { states[wanted] = .failed }
        }
    }

    /// The next page of one group.
    func loadMore(_ group: BoardGroup, using store: DSBotStore) async {
        let wanted = tab
        let key = "\(wanted.rawValue)/\(group.key)"
        guard let cursor = group.nextCursor, !loadingMore.contains(key), store.status == .connected else { return }
        loadingMore.insert(key)
        defer { loadingMore.remove(key) }
        do {
            let value = try await store.request("board.list", [
                "tab": .string(wanted.rawValue), "groupKey": .string(group.key), "cursor": .string(cursor),
            ])
            let answer = try await json.decode(BoardAnswer.self, from: value)
            guard answer.outcome == "success", let page = answer.groups?.first,
                  var current = groupsByTab[wanted], let index = current.firstIndex(where: { $0.key == group.key }) else { return }
            let known = Set(current[index].items.map(\.id))
            current[index].items += page.items.filter { !known.contains($0.id) }
            current[index].nextCursor = page.nextCursor
            groupsByTab[wanted] = current
        } catch {
            DSBotLog.networkFailure("board.more.fail", error: error)
        }
    }

    /// The session of an issue, put back in DSH's sidebar when it was folded away, and found among the phone's own list.
    /// Nil when the issue has none the phone can open.
    func session(of issue: BoardIssue, using store: DSBotStore) async -> SessionSummary? {
        guard issue.sessionId != nil else { return nil }
        return await session(ofIssue: issue.id, using: store)
    }

    func session(ofIssue id: Int, using store: DSBotStore) async -> SessionSummary? {
        do {
            let value = try await store.request("issue.open", ["id": .number(Double(id))])
            let answer = try await json.decode(IssueAnswer.self, from: value)
            guard answer.outcome == "success", let sessionId = answer.sessionId else { return nil }
            if !store.sessions.contains(where: { $0.id == sessionId }) { await store.refreshSessions(requiringNewRequest: true) }
            return store.sessions.first(where: { $0.id == sessionId })
        } catch {
            DSBotLog.networkFailure("issue.open.fail", error: error)
            return nil
        }
    }

    /// The issue whose session is open, when it is still among the board's rows.
    func openedIssue(for session: SessionSummary?) -> BoardIssue? {
        guard let session else { return nil }
        return orderedIssues.first { $0.sessionId == session.id }
    }

    /// The issue before (`-1`) or after (`1`) the open one that has a session the phone can open, in the order of the board.
    func neighbor(of session: SessionSummary?, offset: Int) -> BoardIssue? {
        let openable = orderedIssues.filter { $0.sessionId != nil }
        guard let session, let index = openable.firstIndex(where: { $0.sessionId == session.id }) else { return nil }
        let target = index + offset
        return openable.indices.contains(target) ? openable[target] : nil
    }

    func detail(of issue: BoardIssue, using store: DSBotStore) async -> BoardIssue? {
        do {
            let value = try await store.request("issue.get", ["id": .number(Double(issue.id))])
            let answer = try await json.decode(IssueAnswer.self, from: value)
            return answer.outcome == "success" ? answer.issue : nil
        } catch {
            DSBotLog.networkFailure("issue.get.fail", error: error)
            return nil
        }
    }

    /// The open issues, the one touched last first: what a collected record is shared to.
    func openIssues(withSession: Bool, using store: DSBotStore) async -> [BoardIssue]? {
        do {
            let value = try await store.request("issue.pick", withSession ? ["withSession": .bool(true)] : [:])
            let answer = try await json.decode(IssueAnswer.self, from: value)
            return answer.outcome == "success" ? (answer.items ?? []) : nil
        } catch {
            DSBotLog.networkFailure("issue.pick.fail", error: error)
            return nil
        }
    }

    func creationOptions(using store: DSBotStore) async -> IssueCreationOptions? {
        await creationRequest(IssueCreationOptions.self, "issue.options", using: store)
    }

    func parentIssues(query: String, using store: DSBotStore) async -> [BoardIssue]? {
        guard let answer = await creationRequest(IssueAnswer.self, "issue.parents", ["q": .string(query)], using: store),
              answer.outcome == "success" else { return nil }
        return answer.items ?? []
    }

    func createProject(name: String, path: String, createDirectory: Bool, using store: DSBotStore) async -> IssueProject? {
        var params: [String: JSONValue] = ["path": .string(path), "createDirectory": .bool(createDirectory)]
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { params["name"] = .string(trimmed) }
        guard let answer = await creationRequest(IssueAnswer.self, "issue.project.create", params, using: store),
              answer.outcome == "success" else { return nil }
        return answer.project
    }

    func createLabel(name: String, color: String, using store: DSBotStore) async -> IssueLabel? {
        guard let answer = await creationRequest(IssueAnswer.self, "issue.label.create", ["name": .string(name), "color": .string(color)], using: store),
              answer.outcome == "success" else { return nil }
        return answer.label
    }

    /// The creation form keeps its choices on the computer it opened for, including while JSON is decoded off the main thread.
    private func creationRequest<T: Decodable & Sendable>(
        _ type: T.Type, _ method: String, _ params: [String: JSONValue] = [:], using store: DSBotStore
    ) async -> T? {
        let computer = store.activeComputer?.id
        let connection = store.connectionRevision
        do {
            let value = try await store.request(method, params)
            let answer = try await json.decode(type, from: value)
            guard !Task.isCancelled, computer == store.activeComputer?.id, connection == store.connectionRevision else { return nil }
            return answer
        } catch {
            if !Task.isCancelled { DSBotLog.networkFailure("\(method).fail", error: error) }
            return nil
        }
    }

    /// A new issue; with `record`, made of that collected record. Nil when it was not made.
    func create(_ draft: IssueCreationDraft, record: Int?, using store: DSBotStore) async -> BoardIssue? {
        var params = draft.parameters
        if let record { params["record"] = .number(Double(record)) }
        guard let answer = await creationRequest(IssueAnswer.self, "issue.create", params, using: store),
              answer.outcome == "success", let issue = answer.issue else { return nil }
        await refresh(using: store)
        return issue
    }
}

// MARK: Collector

enum CollectorTab: String, CaseIterable, Identifiable, Sendable {
    case todo, done, ignored

    var id: String { rawValue }
    var title: String {
        switch self {
        case .todo: return "待处理"
        case .done: return "已处理"
        case .ignored: return "已忽略"
        }
    }
}

struct CollectorIssue: Decodable, Equatable, Sendable {
    var id: Int
    var ref: String?
    var title: String
    var status: String
    var statusType: String

    var reference: String { ref ?? "#\(id)" }
}

struct CollectorContext: Decodable, Equatable, Sendable {
    var from: String?
    var at: Double?
    var text: String?
}

/// One collected record: what a collector brought back, without its words (those come with `inbox.get`).
struct CollectorRecord: Decodable, Identifiable, Equatable, Sendable {
    var id: Int
    var ref: String?
    var connector: String
    var connectorName: String
    /// The icon key of the service the collector reads through, when it is one of the catalog's.
    var connectorIcon: String?
    var title: String
    var from: String?
    var at: Double?
    var url: String?
    var ignored: Bool?
    var done: Bool?
    /// What became of it: an issue made of it, or a note shared to one (`issue`, `note`).
    var verdict: String?
    var issue: CollectorIssue?
    var text: String?
    var context: [CollectorContext]?

    /// The line under the title: who it is from, and which collector brought it.
    var byLine: String { [from ?? "", connectorName].filter { !$0.isEmpty }.joined(separator: " · ") }
}

/// What the owner can do with a record without making an issue of it.
enum CollectorMark: String, Sendable {
    case ignore, done, delete, restore

    var toast: String {
        switch self {
        case .ignore: return "已忽略"
        case .done: return "已处理"
        case .delete: return "已删除"
        case .restore: return "已恢复"
        }
    }
}

struct CollectorDraft: Decodable, Equatable, Sendable {
    var title: String
    var brief: String
}

private struct CollectorAnswer: Decodable, Sendable {
    var outcome: String
    var items: [CollectorRecord]?
    var nextCursor: String?
    var total: Int?
    var record: CollectorRecord?
    var draft: CollectorDraft?
    var changed: Int?
    var issue: CollectorShared?
}

private struct CollectorShared: Decodable, Sendable {
    var id: Int
    var ref: String?
}

@MainActor
final class CollectorModel: ObservableObject {
    @Published var tab: CollectorTab = .todo
    @Published private(set) var itemsByTab: [CollectorTab: [CollectorRecord]] = [:]
    @Published private(set) var totals: [CollectorTab: Int] = [:]
    @Published private(set) var states: [CollectorTab: BoardModel.LoadState] = [:]
    @Published private(set) var isLoadingMore = false
    @Published var isSelecting = false
    @Published private(set) var selection: Set<Int> = []
    /// The result of the last action, for the toast the page shows (with an undo, where there is one).
    var report: ((DSBotToastMessage) -> Void)?

    private var cursors: [CollectorTab: String] = [:]
    private let json = DSBotJSON()
    private var refreshing: Set<CollectorTab> = []

    var items: [CollectorRecord] { itemsByTab[tab] ?? [] }
    var state: BoardModel.LoadState { states[tab] ?? .loading }
    var waiting: Int { totals[.todo] ?? 0 }
    var hasMore: Bool { cursors[tab] != nil }
    var chosen: [CollectorRecord] { items.filter { selection.contains($0.id) } }
    var allSelected: Bool { !items.isEmpty && selection.count == items.count }

    /// Forget what was read: another computer has other records.
    func reset() {
        itemsByTab = [:]
        totals = [:]
        states = [:]
        cursors = [:]
        tab = .todo
        stopSelecting()
    }

    func select(_ next: CollectorTab) {
        guard next != tab else { return }
        tab = next
        stopSelecting()
    }

    func startSelecting(with id: Int? = nil) {
        isSelecting = true
        if let id { selection = [id] }
    }

    func stopSelecting() {
        isSelecting = false
        selection = []
    }

    func toggle(_ id: Int) {
        if selection.contains(id) { selection.remove(id) } else { selection.insert(id) }
    }

    func selectAll() { selection = Set(items.map(\.id)) }

    /// Read the first page of a tab again, keeping what is on screen meanwhile.
    func refresh(_ wanted: CollectorTab? = nil, using store: DSBotStore) async {
        let target = wanted ?? tab
        guard !refreshing.contains(target), store.status == .connected else { return }
        refreshing.insert(target)
        defer { refreshing.remove(target) }
        if itemsByTab[target] == nil { states[target] = .loading }
        do {
            let value = try await store.request("inbox.list", ["tab": .string(target.rawValue)])
            let answer = try await json.decode(CollectorAnswer.self, from: value)
            guard answer.outcome == "success" else { throw DSBotFailure.protocolError }
            let fresh = answer.items ?? []
            if itemsByTab[target] != fresh { itemsByTab[target] = fresh }
            totals[target] = answer.total ?? fresh.count
            cursors[target] = answer.nextCursor
            states[target] = .loaded
            if target == tab { selection = selection.intersection(Set(fresh.map(\.id))) }
        } catch {
            DSBotLog.networkFailure("inbox.load.fail", error: error)
            if itemsByTab[target] == nil { states[target] = .failed }
        }
    }

    /// The pending count, for the sidebar: read once the app is connected and again whenever a record changes.
    func refreshCount(using store: DSBotStore) async {
        await refresh(.todo, using: store)
    }

    func loadMore(using store: DSBotStore) async {
        let wanted = tab
        guard let cursor = cursors[wanted], !isLoadingMore, store.status == .connected else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let value = try await store.request("inbox.list", ["tab": .string(wanted.rawValue), "cursor": .string(cursor)])
            let answer = try await json.decode(CollectorAnswer.self, from: value)
            guard answer.outcome == "success" else { return }
            let known = Set((itemsByTab[wanted] ?? []).map(\.id))
            itemsByTab[wanted, default: []] += (answer.items ?? []).filter { !known.contains($0.id) }
            cursors[wanted] = answer.nextCursor
        } catch {
            DSBotLog.networkFailure("inbox.more.fail", error: error)
        }
    }

    /// One record in full: its words, what was around it, and what an issue made of it starts with.
    func detail(of record: CollectorRecord, using store: DSBotStore) async -> (record: CollectorRecord, draft: CollectorDraft)? {
        do {
            let value = try await store.request("inbox.get", ["id": .number(Double(record.id))])
            let answer = try await json.decode(CollectorAnswer.self, from: value)
            guard answer.outcome == "success", let full = answer.record, let draft = answer.draft else { return nil }
            return (full, draft)
        } catch {
            DSBotLog.networkFailure("inbox.get.fail", error: error)
            return nil
        }
    }

    /// A mark on one or several records, with one undo for all of them.
    func mark(_ action: CollectorMark, _ records: [CollectorRecord], using store: DSBotStore) async {
        let ids = records.map(\.id)
        guard !ids.isEmpty else { return }
        let from = tab
        guard await send(action, ids: ids, using: store) else {
            report?(DSBotToastMessage(text: "更改没能保存", kind: .error))
            return
        }
        // They leave the list at once; the plugin's answer, a moment later, is what stays.
        itemsByTab[from] = (itemsByTab[from] ?? []).filter { !ids.contains($0.id) }
        stopSelecting()
        let back: CollectorMark = action == .restore ? (from == .done ? .done : .ignore) : .restore
        report?(DSBotToastMessage(text: action.toast, kind: .success, action: DSBotToastAction(title: "撤销") { [weak self] in
            guard let self else { return }
            Task { @MainActor in
                if await self.send(back, ids: ids, using: store) {
                    await self.refresh(from, using: store)
                    await self.refreshCount(using: store)
                }
            }
        }))
        await refresh(from, using: store)
        await refreshCount(using: store)
    }

    private func send(_ action: CollectorMark, ids: [Int], using store: DSBotStore) async -> Bool {
        do {
            let value = try await store.request("inbox.mark", [
                "action": .string(action.rawValue), "ids": .array(ids.map { .number(Double($0)) }),
            ])
            let answer = try await json.decode(CollectorAnswer.self, from: value)
            return answer.outcome == "success" || answer.outcome == "no_op"
        } catch {
            DSBotLog.networkFailure("inbox.mark.fail", error: error)
            return false
        }
    }

    /// Records shared to an issue (a note in its activity) or to the session of one (a message to its agent).
    func share(_ records: [CollectorRecord], to issue: BoardIssue, session: Bool, using store: DSBotStore) async {
        let ids = records.map(\.id)
        var params: [String: JSONValue] = ["ids": .array(ids.map { .number(Double($0)) }), "issue": .number(Double(issue.id))]
        if session { params["to"] = .string("session") }
        do {
            let value = try await store.request("inbox.share", params)
            let answer = try await json.decode(CollectorAnswer.self, from: value)
            guard answer.outcome == "success" || answer.outcome == "no_op" else {
                report?(DSBotToastMessage(text: "更改没能保存", kind: .error))
                return
            }
            stopSelecting()
            report?(DSBotToastMessage(text: session ? "已分享到 \(issue.reference) 的会话" : "已分享到 \(issue.reference)", kind: .success))
            await refresh(tab, using: store)
            await refreshCount(using: store)
        } catch {
            DSBotLog.networkFailure("inbox.share.fail", error: error)
            report?(DSBotToastMessage(text: "更改没能保存", kind: .error))
        }
    }
}
