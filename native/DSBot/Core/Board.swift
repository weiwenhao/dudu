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
    var projectInfo: IssueProject?
    var labels: [IssueLabel]?
    /// Only on the rows of a todo card: the latest message of the issue's session (the owner's own words or the agent's) when the card was made.
    var latest: IssueLatest?

    var sessionAgent: SessionAgent? { agent.flatMap(SessionAgent.init(rawValue:)) }
    var workState: AgentWorkState { AgentWorkState(rawValue: agentState) ?? .idle }
    /// What the issue is called by: its project's reference, else its number.
    var reference: String { ref ?? "#\(id)" }
}

/// The latest message of an issue's session, as the plugin kept it (`host/assistant/home/latest.mjs`): who said it (`me` or `agent`), what and when.
struct IssueLatest: Codable, Equatable, Sendable {
    var who: String
    var text: String
    var at: Double

    var isMine: Bool { who == "me" }
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
        case "blocked": return L10n.text("需要你")
        case "working": return L10n.text("工作中")
        case "idle": return L10n.text("空闲中")
        default: return L10n.text("未分配")
        }
    }
}

enum BoardTab: String, CaseIterable, Identifiable, Sendable {
    case active, backlog, all

    var id: String { rawValue }
    var title: String {
        switch self {
        case .active: return L10n.text("进行中")
        case .backlog: return L10n.text("待规划")
        case .all: return L10n.text("全部事项")
        }
    }
}

private struct BoardAnswer: Decodable, Sendable {
    var outcome: String
    var tab: String?
    var total: Int?
    var groups: [BoardGroup]?
    var needsYouColor: String?
}

private struct IssueAnswer: Decodable, Sendable {
    var outcome: String
    var issue: BoardIssue?
    var items: [BoardIssue]?
    var sessionId: String?
    var project: IssueProject?
    var label: IssueLabel?
}

private struct IssueDeletionAnswer: Decodable, Sendable {
    var outcome: String
    var preview: Bool?
    var token: String?
    var issue: BoardIssue?
    var forgotten: Bool?
    var id: Int?
    var code: String?
}

/// The board and what the phone does with an issue: list, open its session, make one.
@MainActor
final class BoardModel: ObservableObject {
    enum LoadState: Equatable { case loading, loaded, failed }

    private static let initiallyFoldedGroups = Set(BoardTab.allCases.flatMap { tab in
        ["working", "idle"].map { "\(tab.rawValue)/\($0)" }
    })

    @Published private(set) var tab: BoardTab = .active
    @Published private(set) var groupsByTab: [BoardTab: [BoardGroup]] = [:]
    @Published private(set) var states: [BoardTab: LoadState] = [:]
    @Published private(set) var foldedGroups = BoardModel.initiallyFoldedGroups
    @Published private(set) var loadingMore: Set<String> = []
    @Published private(set) var deleting: Set<Int> = []
    @Published private(set) var needsYouColor: UInt32 = 0x4f948e
    var report: ((DSBotToastMessage) -> Void)?
    private let json = DSBotJSON()
    private var refreshing = false
    private var refreshPending = false
    private var resetID = UUID()
    private var mutationRevision = 0

    var groups: [BoardGroup] { groupsByTab[tab] ?? [] }
    var state: LoadState { states[tab] ?? .loading }

    /// The issues in the order the board shows them, folded groups included.
    var orderedIssues: [BoardIssue] { groups.flatMap(\.items) }

    func select(_ next: BoardTab) { tab = next }

    /// Forget what was read: another computer has another board.
    func reset() {
        resetID = UUID()
        mutationRevision += 1
        refreshPending = false
        groupsByTab = [:]
        states = [:]
        foldedGroups = Self.initiallyFoldedGroups
        loadingMore = []
        deleting = []
        needsYouColor = 0x4f948e
        tab = .active
    }

    func isFolded(_ group: BoardGroup) -> Bool { foldedGroups.contains("\(tab.rawValue)/\(group.key)") }

    func toggle(_ group: BoardGroup) {
        let key = "\(tab.rawValue)/\(group.key)"
        if foldedGroups.contains(key) { foldedGroups.remove(key) } else { foldedGroups.insert(key) }
    }

    /// Read the tab again. A refresh keeps what is on screen; only a tab that has nothing yet shows its loading.
    func refresh(using store: DSBotStore) async {
        guard store.status == .connected else { return }
        if refreshing { refreshPending = true; return }
        refreshing = true
        let reset = resetID
        defer {
            refreshing = false
            if refreshPending {
                refreshPending = false
                // An in-flight poll cannot hide a mutation's authoritative refresh until the next timer tick.
                Task { if reset == resetID { await refresh(using: store) } }
            }
        }
        let wanted = tab
        let revision = mutationRevision
        if groupsByTab[wanted] == nil { states[wanted] = .loading }
        do {
            let value = try await store.request("board.list", ["tab": .string(wanted.rawValue)])
            let answer = try await json.decode(BoardAnswer.self, from: value)
            guard revision == mutationRevision else { return }
            guard answer.outcome == "success" else { throw DSBotFailure.protocolError }
            if let hex = answer.needsYouColor, let color = UInt32(hex.dropFirst(), radix: 16), needsYouColor != color {
                needsYouColor = color
            }
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
        let revision = mutationRevision
        guard let cursor = group.nextCursor, !loadingMore.contains(key), store.status == .connected else { return }
        loadingMore.insert(key)
        defer { loadingMore.remove(key) }
        do {
            let value = try await store.request("board.list", [
                "tab": .string(wanted.rawValue), "groupKey": .string(group.key), "cursor": .string(cursor),
            ])
            let answer = try await json.decode(BoardAnswer.self, from: value)
            guard revision == mutationRevision, answer.outcome == "success", let page = answer.groups?.first,
                  var current = groupsByTab[wanted], let index = current.firstIndex(where: { $0.key == group.key }) else { return }
            let known = Set(current[index].items.map(\.id))
            current[index].items += page.items.filter { !known.contains($0.id) }
            current[index].nextCursor = page.nextCursor
            groupsByTab[wanted] = current
        } catch {
            DSBotLog.networkFailure("board.more.fail", error: error)
        }
    }

    /// The owner confirmed this exact row. Recheck it on the computer before submitting its single-use deletion token.
    func delete(_ issue: BoardIssue, using store: DSBotStore) async {
        guard !deleting.contains(issue.id) else { return }
        let computer = store.activeComputer?.id
        let connection = store.connectionRevision
        let reset = resetID
        deleting.insert(issue.id)
        defer {
            if reset == resetID { deleting.remove(issue.id) }
        }
        do {
            let value = try await store.request("issue.delete", ["id": .number(Double(issue.id))])
            let preview = try await json.decode(IssueDeletionAnswer.self, from: value)
            guard !Task.isCancelled, computer == store.activeComputer?.id, connection == store.connectionRevision else { return }
            guard preview.outcome == "success", preview.preview == true, let token = preview.token,
                  preview.issue?.id == issue.id, preview.issue?.title == issue.title, preview.issue?.ref == issue.ref else {
                throw DSBotFailure.remote(preview.code?.uppercased() ?? "REQUEST_FAILED")
            }
            let removed = try await store.request("issue.delete", ["id": .number(Double(issue.id)), "token": .string(token)])
            let answer = try await json.decode(IssueDeletionAnswer.self, from: removed)
            guard !Task.isCancelled, computer == store.activeComputer?.id, connection == store.connectionRevision else { return }
            guard answer.outcome == "success", answer.forgotten == true, answer.id == issue.id else {
                throw DSBotFailure.remote(answer.code?.uppercased() ?? "REQUEST_FAILED")
            }
            mutationRevision += 1
            // Remove the row immediately; other scopes and the next poll read their authoritative counts again.
            let current = groups.map { group -> BoardGroup in
                var group = group
                if group.items.contains(where: { $0.id == issue.id }) {
                    group.items.removeAll { $0.id == issue.id }
                    group.count = max(0, group.count - 1)
                }
                return group
            }.filter { $0.count > 0 }
            groupsByTab = [tab: current]
            states = [tab: .loaded]
            await store.refreshSessions(quiet: true)
            await refresh(using: store)
        } catch {
            guard !Task.isCancelled, computer == store.activeComputer?.id, connection == store.connectionRevision else { return }
            DSBotLog.networkFailure("issue.delete.fail", error: error)
            report?(DSBotToastMessage(text: L10n.text("更改没能保存"), kind: .error))
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

    func update(_ issue: BoardIssue, patch: [String: JSONValue], using store: DSBotStore) async -> BoardIssue? {
        await change("issue.update", issue: issue, params: ["patch": .object(patch)], using: store)
    }

    func assign(_ issue: BoardIssue, agent: SessionAgent, project: IssueProject, using store: DSBotStore) async -> BoardIssue? {
        guard let path = project.path, !path.isEmpty else { return nil }
        return await change("issue.assign", issue: issue, params: [
            "agent": .string(agent.rawValue), "project": .object(["name": .string(project.name), "path": .string(path)]),
        ], using: store)
    }

    private func change(_ method: String, issue: BoardIssue, params: [String: JSONValue], using store: DSBotStore) async -> BoardIssue? {
        var params = params
        params["id"] = .number(Double(issue.id))
        guard let answer = await creationRequest(IssueAnswer.self, method, params, using: store),
              answer.outcome == "success", let changed = answer.issue, changed.id == issue.id else { return nil }
        mutationRevision += 1
        // The response updates the loaded row immediately; the authoritative read then reconciles groups and counts.
        let current = groups.map { group -> BoardGroup in
            var group = group
            group.items = group.items.map { $0.id == changed.id ? changed : $0 }
            return group
        }
        groupsByTab = [tab: current]
        states = [tab: .loaded]
        await refresh(using: store)
        return changed
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
        case .todo: return L10n.text("待处理")
        case .done: return L10n.text("已处理")
        case .ignored: return L10n.text("已忽略")
        }
    }
}

struct CollectorIssue: Codable, Equatable, Sendable {
    var id: Int
    var ref: String?
    var title: String
    var status: String
    var statusType: String

    var reference: String { ref ?? "#\(id)" }
}

struct CollectorContext: Codable, Equatable, Sendable {
    var from: String?
    var at: Double?
    var text: String?
}

/// One collected record: what a collector brought back, without its words (those come with `inbox.get`). Codable because a card of 嘟嘟's chat keeps some (`QuickCard`).
struct CollectorRecord: Codable, Identifiable, Equatable, Sendable {
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
    /// The collector's session is going back to the source to read what is around this record (`inbox.complete`); `inbox.get` says it, and an older plugin says nothing.
    var completing: Bool?
    /// Why the last such completion failed, in the plugin's own words (English system text, which the plugin keeps ten minutes).
    var completeError: String?

    /// The line under the title: its number (`r143`), who it is from, and which collector brought it. The number is first, so a line that is cut short keeps it
    /// (owner, 2026-11-11, option A of `.local/designs/record-id-2026-11-11/`, on records that read alike: "设计一个 id 吧，不然我都不知道哪个是哪个").
    var byLine: String { [ref ?? "", from ?? "", connectorName].filter { !$0.isEmpty }.joined(separator: " · ") }
}

/// What the owner can do with a record without making an issue of it.
enum CollectorMark: String, Sendable {
    case ignore, done, delete, restore

    var toast: String {
        switch self {
        case .ignore: return L10n.text("已忽略")
        case .done: return L10n.text("已处理")
        case .delete: return L10n.text("已删除")
        case .restore: return L10n.text("已恢复")
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
    /// `inbox.complete`: whether a completion was begun; an answer that is not a success says why, in the plugin's own words.
    var started: Bool?
    var message: String?
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
    @Published private(set) var changing: Set<Int> = []
    @Published var isSelecting = false
    @Published private(set) var selection: Set<Int> = []
    /// The records whose context the collector's session is completing and which this phone waits for: their button shows it, and cannot be pressed again.
    @Published private(set) var completing: Set<Int> = []
    /// Why a completion failed, in the plugin's own words ("" when it gave none): the record in full says it, or the page when that record is not open.
    @Published private(set) var completionProblems: [Int: String] = [:]
    /// The result of the last action, for the toast the page shows.
    var report: ((DSBotToastMessage) -> Void)?

    private var cursors: [CollectorTab: String] = [:]
    private let json = DSBotJSON()
    private var refreshing: Set<CollectorTab> = []
    private var followers: [Int: Task<Void, Never>] = [:]

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
        changing = []
        tab = .todo
        stopSelecting()
        // The completions that were being waited for ran on the other computer.
        followers.values.forEach { $0.cancel() }
        followers = [:]
        completing = []
        completionProblems = [:]
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
        let computer = store.activeComputer?.id
        let connection = store.connectionRevision
        do {
            let value = try await store.request("inbox.list", ["tab": .string(target.rawValue)])
            let answer = try await json.decode(CollectorAnswer.self, from: value)
            guard !Task.isCancelled, computer == store.activeComputer?.id, connection == store.connectionRevision else { return }
            guard answer.outcome == "success" else { throw DSBotFailure.protocolError }
            let fresh = answer.items ?? []
            if itemsByTab[target] != fresh { itemsByTab[target] = fresh }
            totals[target] = answer.total ?? fresh.count
            cursors[target] = answer.nextCursor
            states[target] = .loaded
            if target == tab { selection = selection.intersection(Set(fresh.map(\.id))) }
        } catch {
            guard !Task.isCancelled, computer == store.activeComputer?.id, connection == store.connectionRevision else { return }
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
        await detail(id: record.id, using: store)
    }

    private func detail(id: Int, using store: DSBotStore) async -> (record: CollectorRecord, draft: CollectorDraft)? {
        do {
            let value = try await store.request("inbox.get", ["id": .number(Double(id))])
            let answer = try await json.decode(CollectorAnswer.self, from: value)
            guard answer.outcome == "success", let full = answer.record, let draft = answer.draft else { return nil }
            return (full, draft)
        } catch {
            DSBotLog.networkFailure("inbox.get.fail", error: error)
            return nil
        }
    }

    /// Fill in the context of a record (`inbox.complete`): its collector's own session goes back to the source and reads the conversation around it. The busy mark is in at once, before the
    /// request goes. The work runs on the computer in the background and takes from ten seconds to a few minutes, so the record is read again every three seconds until the computer says it
    /// is over (and for four minutes at most), as the desktop's page does (`ui/collector/completion.js`). What it came to is the record in full's to read: more lines in `text` or `context`,
    /// and a failure in `completionProblems`.
    func complete(_ record: CollectorRecord, using store: DSBotStore) {
        follow(record.id, asking: true, using: store)
    }

    /// A record the computer says is being completed already (a record in full that was opened in the middle of it): wait for its end in the same way, without asking again.
    func follow(_ record: CollectorRecord, using store: DSBotStore) {
        follow(record.id, asking: false, using: store)
    }

    /// A failure that has been said (in the record in full, or by the page): it is not said again.
    func clearProblem(_ id: Int) {
        if completionProblems[id] != nil { completionProblems[id] = nil }
    }

    private func follow(_ id: Int, asking: Bool, using store: DSBotStore) {
        guard !completing.contains(id) else { return }
        completing.insert(id)
        completionProblems[id] = nil
        let computer = store.activeComputer?.id
        followers[id] = Task { [weak self] in
            guard let self else { return }
            let problem = await self.waitForEnd(of: id, asking: asking, computer: computer, using: store)
            guard !Task.isCancelled else { return }
            self.followers[id] = nil
            // The failure is in before the mark goes, so that whoever shows the record sees both in the same update.
            if let problem { self.completionProblems[id] = problem }
            self.completing.remove(id)
        }
    }

    /// Ask (unless the computer is at it already) and wait for the end. Nil when it went well or when the waiting was cancelled; otherwise why it failed: what the plugin said, or "" when it
    /// said nothing (as the desktop does, a wait that is still not over after four minutes is a failure without a reason).
    private func waitForEnd(of id: Int, asking: Bool, computer: String?, using store: DSBotStore) async -> String? {
        if asking {
            var started = false
            var message = ""
            do {
                let value = try await store.request("inbox.complete", ["id": .number(Double(id))])
                let answer = try await json.decode(CollectorAnswer.self, from: value)
                started = answer.outcome == "success" && answer.started == true
                message = answer.message ?? ""
            } catch {
                guard !Task.isCancelled else { return nil }
                DSBotLog.networkFailure("inbox.complete.fail", error: error)
            }
            if !started {
                // Not started (the plugin says it is busy, or its answer did not come): one for this record may be running all the same, started on the desktop say. The record tells.
                let running = await detail(id: id, using: store)?.record.completing == true
                guard !Task.isCancelled else { return nil }
                guard running else { return message }
            }
        }
        let since = ContinuousClock.now
        while true {
            do { try await Task.sleep(for: .seconds(3)) } catch { return nil }
            guard computer == store.activeComputer?.id else { return nil }
            // A reading that says it is over is believed even when it comes late.
            if store.status == .connected, let full = await detail(id: id, using: store) {
                if Task.isCancelled { return nil }
                if full.record.completing != true {
                    guard let error = full.record.completeError, !error.isEmpty else { return nil }
                    return error
                }
            }
            if Task.isCancelled { return nil }
            if ContinuousClock.now - since >= .seconds(240) { return "" }
        }
    }

    /// A mark on one or several records. No undo (owner, 2026-11-12): a restore is the way back for a row put aside or handled, and a delete is for a row that is wrong.
    @discardableResult
    func mark(_ action: CollectorMark, _ records: [CollectorRecord], using store: DSBotStore) async -> Bool {
        let ids = records.map(\.id)
        guard !ids.isEmpty, changing.isDisjoint(with: ids) else { return false }
        let computer = store.activeComputer?.id
        changing.formUnion(ids)
        defer { if computer == store.activeComputer?.id { changing.subtract(ids) } }
        let from = tab
        guard await send(action, ids: ids, using: store) else {
            report?(DSBotToastMessage(text: L10n.text("更改没能保存"), kind: .error))
            return false
        }
        guard computer == store.activeComputer?.id else { return false }
        // They leave the list at once; the plugin's answer, a moment later, is what stays.
        itemsByTab[from] = (itemsByTab[from] ?? []).filter { !ids.contains($0.id) }
        stopSelecting()
        report?(DSBotToastMessage(text: action.toast, kind: .success))
        await refresh(from, using: store)
        await refreshCount(using: store)
        return true
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
    @discardableResult
    func share(_ records: [CollectorRecord], to issue: BoardIssue, session: Bool, using store: DSBotStore) async -> Bool {
        let ids = records.map(\.id)
        guard !ids.isEmpty, changing.isDisjoint(with: ids) else { return false }
        let computer = store.activeComputer?.id
        changing.formUnion(ids)
        defer { if computer == store.activeComputer?.id { changing.subtract(ids) } }
        var params: [String: JSONValue] = ["ids": .array(ids.map { .number(Double($0)) }), "issue": .number(Double(issue.id))]
        if session { params["to"] = .string("session") }
        do {
            let value = try await store.request("inbox.share", params)
            let answer = try await json.decode(CollectorAnswer.self, from: value)
            guard computer == store.activeComputer?.id else { return false }
            guard answer.outcome == "success" || answer.outcome == "no_op" else {
                report?(DSBotToastMessage(text: L10n.text("更改没能保存"), kind: .error))
                return false
            }
            stopSelecting()
            report?(DSBotToastMessage(text: session ? L10n.text("已分享到 {0} 的会话", "\(issue.reference)") : L10n.text("已分享到 {0}", "\(issue.reference)"), kind: .success))
            await refresh(tab, using: store)
            await refreshCount(using: store)
            return true
        } catch {
            DSBotLog.networkFailure("inbox.share.fail", error: error)
            report?(DSBotToastMessage(text: L10n.text("更改没能保存"), kind: .error))
            return false
        }
    }
}
