import Foundation
import SwiftUI

// The search page (owner, 2026-11-27: Lark's search, one design on every screen; drawn in `.local/designs/phone-search-2026-11-27/`): three ranges (会话, 收件箱, 任务), one request to the
// computer (`search.query`, `host/assistant/home/search.mjs`) and what the phone keeps for itself: the words searched for, and when each conversation was last opened.

// MARK: Ranges and filters

enum SearchScope: String, CaseIterable, Identifiable, Sendable {
    case sessions, inbox, tasks

    var id: String { rawValue }

    var title: String {
        switch self {
        case .sessions: return L10n.text("会话")
        case .inbox: return L10n.text("收件箱")
        case .tasks: return L10n.text("任务")
        }
    }

    /// What a picked range says while nothing is typed and no filter is chosen.
    var hint: String {
        switch self {
        case .sessions: return L10n.text("输入关键词或使用筛选查找会话")
        case .inbox: return L10n.text("输入关键词或使用筛选查找信息")
        case .tasks: return L10n.text("输入关键词或使用筛选查找任务")
        }
    }
}

/// The filter pills of a picked range: the conversations' are the board's own fields, the inbox's and the tasks' are read from what the computer answered.
enum SearchFilterField: String, Identifiable, Hashable, Sendable {
    case agent, project, updated
    case state, source
    case taskStatus, taskAgent

    var id: String { rawValue }

    static func fields(for scope: SearchScope) -> [SearchFilterField] {
        switch scope {
        case .sessions: return [.agent, .project, .updated]
        case .inbox: return [.state, .source]
        case .tasks: return [.taskStatus, .taskAgent]
        }
    }

    var title: String {
        switch self {
        case .agent, .taskAgent: return L10n.text("智能体")
        case .project: return L10n.text("项目")
        case .updated: return L10n.text("更新时间")
        case .state, .taskStatus: return L10n.text("状态")
        case .source: return L10n.text("来源")
        }
    }

    /// A date is one choice (as the board's), every other filter takes several.
    var allowsSeveral: Bool { self != .updated }

    var boardField: BoardFilterField? {
        switch self {
        case .agent: return .agent
        case .project: return .project
        case .updated: return .updated
        default: return nil
        }
    }
}

/// One choice of a filter's sheet. `key` is what the filter keeps; nil is the board's 无 choice (no project, no agent).
struct SearchChoice: Identifiable, Equatable {
    enum Mark: Equatable { case none, agent(SessionAgent), taskAgent(TaskAgent) }

    var key: String?
    var title: String
    var count: Int? = nil
    var mark: Mark = .none

    var id: String { key ?? "\u{0}none" }
}

/// What was chosen on each range's pills. Each range starts without any, and the board's own filters are never touched.
struct SearchRangeFilters: Equatable {
    var conversations = BoardFilters()
    var states: Set<String> = []
    var sources: Set<String> = []
    var taskStatuses: Set<String> = []
    var taskAgents: Set<String> = []

    func isEmpty(in scope: SearchScope) -> Bool {
        switch scope {
        case .sessions: return conversations.isEmpty
        case .inbox: return states.isEmpty && sources.isEmpty
        case .tasks: return taskStatuses.isEmpty && taskAgents.isEmpty
        }
    }

    func chosen(_ field: SearchFilterField) -> Set<String?> {
        switch field {
        case .agent, .project, .updated:
            return field.boardField.map { conversations.chosenKeys(in: $0) } ?? []
        case .state: return Set(states.map(Optional.some))
        case .source: return Set(sources.map(Optional.some))
        case .taskStatus: return Set(taskStatuses.map(Optional.some))
        case .taskAgent: return Set(taskAgents.map(Optional.some))
        }
    }

    mutating func toggle(_ key: String?, in field: SearchFilterField) {
        func flip(_ set: inout Set<String>) {
            guard let key else { return }
            if set.remove(key) == nil { set.insert(key) }
        }
        switch field {
        case .agent, .project, .updated: if let board = field.boardField { conversations.toggle(key, in: board) }
        case .state: flip(&states)
        case .source: flip(&sources)
        case .taskStatus: flip(&taskStatuses)
        case .taskAgent: flip(&taskAgents)
        }
    }

    /// The one state the inbox is asked for: both chosen is no restriction.
    var inboxState: String? { states.count == 1 ? states.first : nil }

    func requestFilters(for scope: SearchScope?) -> [String: Set<String?>] {
        switch scope {
        case .sessions: return conversations.saved.mapValues { Set($0) }
        case .tasks:
            return ["status": Set(taskStatuses.map(Optional.some)), "agent": Set(taskAgents.map(Optional.some))]
                .filter { !$0.value.isEmpty }
        default: return [:]
        }
    }

    func matching(_ tasks: [ScheduledTask]) -> [ScheduledTask] {
        tasks.filter { task in
            (taskStatuses.isEmpty || taskStatuses.contains(task.status)) && (taskAgents.isEmpty || taskAgents.contains(task.agent))
        }
    }
}

// MARK: Answers

struct SearchConversationHit: Decodable, Identifiable, Equatable, Sendable {
    var conversation: BoardConversation
    /// A line of the conversation's text, when the text is what matched.
    var snippet: String?

    var id: String { conversation.id }

    init(conversation: BoardConversation, snippet: String? = nil) {
        self.conversation = conversation
        self.snippet = snippet
    }

    private enum Keys: String, CodingKey { case snippet }

    init(from decoder: Decoder) throws {
        conversation = try BoardConversation(from: decoder)
        snippet = try decoder.container(keyedBy: Keys.self).decodeIfPresent(String.self, forKey: .snippet)
    }
}

struct SearchRecordHit: Decodable, Identifiable, Equatable, Sendable {
    var record: CollectorRecord
    /// A line of the record's text, when the text is what matched and the title does not show it.
    var snippet: String?

    var id: Int { record.id }

    private enum Keys: String, CodingKey { case snippet }

    init(from decoder: Decoder) throws {
        record = try CollectorRecord(from: decoder)
        snippet = try decoder.container(keyedBy: Keys.self).decodeIfPresent(String.self, forKey: .snippet)
    }
}

struct SearchGroup<Item: Decodable & Equatable & Sendable>: Decodable, Equatable, Sendable {
    var total: Int
    var items: [Item]
    /// The computer could not look in this place (the others are answered).
    var failed: Bool?
    /// The sessions' text index is still being built.
    var indexing: Bool?
    /// Only the conversations' titles were looked in: the text index did not answer in time.
    var partial: Bool?
    /// The inbox only: every collector's name by id, for the 来源 choices.
    var names: [String: String]?
    var facets: [String: [SearchFacet]]?

    static var empty: SearchGroup { SearchGroup(total: 0, items: []) }
}

struct SearchFacet: Decodable, Equatable, Sendable {
    var key: String?
    var count: Int
}

struct SearchAnswer: Decodable, Equatable, Sendable {
    var outcome: String
    var sessions: SearchGroup<SearchConversationHit>?
    var inbox: SearchGroup<SearchRecordHit>?
    var tasks: SearchGroup<ScheduledTask>?

    func failed(in places: [SearchScope]) -> Bool {
        places.allSatisfy { place in
            switch place {
            case .sessions: return sessions?.failed == true
            case .inbox: return inbox?.failed == true
            case .tasks: return tasks?.failed == true
            }
        }
    }
}

// MARK: What the phone remembers

/// The words searched for, newest first, each once (case aside), twelve at most.
struct SearchHistory: Equatable, Codable {
    static let limit = 12
    private(set) var words: [String] = []

    mutating func add(_ word: String) {
        let word = word.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !word.isEmpty else { return }
        words.removeAll { $0.compare(word, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
        words.insert(word, at: 0)
        if words.count > Self.limit { words.removeLast(words.count - Self.limit) }
    }

    mutating func clear() { words = [] }
}

/// 常用: every conversation of the board's 全部 list, the one opened last first; those never opened follow in the list's own order.
enum FrequentConversations {
    static let limit = 6

    static func ordered(_ rows: [BoardConversation], opened: [String: Double]) -> [BoardConversation] {
        rows.enumerated().sorted { left, right in
            let (a, b) = (opened[left.element.id] ?? 0, opened[right.element.id] ?? 0)
            return a != b ? a > b : left.offset < right.offset
        }.map(\.element)
    }
}

/// The history and the opening times, in the phone's own defaults (not synced, as Lark's): history is shared by every computer, the opening times are of one computer's conversations.
final class SearchMemory: @unchecked Sendable {
    static let shared = SearchMemory()
    private let defaults: UserDefaults
    private let lock = NSLock()
    private static let historyKey = "dudu.search.history.v1"
    private static let openedKey = "dudu.search.opened.v1"
    /// What is kept of one computer: the newest openings only.
    private static let openedLimit = 200

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    var history: SearchHistory {
        get { lock.withLock { defaults.data(forKey: Self.historyKey).flatMap { try? JSONDecoder().decode(SearchHistory.self, from: $0) } ?? SearchHistory() } }
        set { lock.withLock { defaults.set(try? JSONEncoder().encode(newValue), forKey: Self.historyKey) } }
    }

    func opened(for computer: String?) -> [String: Double] {
        guard let computer else { return [:] }
        return lock.withLock { ((defaults.dictionary(forKey: Self.openedKey)?[computer]) as? [String: Double]) ?? [:] }
    }

    func recordOpen(_ conversation: String, computer: String?, at date: Date = .now) {
        guard let computer else { return }
        lock.withLock {
            var all = (defaults.dictionary(forKey: Self.openedKey) as? [String: [String: Double]]) ?? [:]
            var times = all[computer] ?? [:]
            times[conversation] = date.timeIntervalSince1970 * 1000
            if times.count > Self.openedLimit {
                for key in times.sorted(by: { $0.value < $1.value }).prefix(times.count - Self.openedLimit).map(\.key) { times[key] = nil }
            }
            all[computer] = times
            defaults.set(all, forKey: Self.openedKey)
        }
    }
}

// MARK: Marking the words found

enum SearchText {
    /// The words a result row marks: each word of what was typed (a phrase without a space is one word).
    static func terms(_ query: String) -> [String] {
        let words = query.split(whereSeparator: \.isWhitespace).map(String.init)
        var seen: [String] = []
        for word in words where !seen.contains(where: { $0.compare(word, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) { seen.append(word) }
        return seen.sorted { $0.count > $1.count }
    }

    /// Where the terms are in `value`, in order and apart (the leftmost first, the longer of two that start together).
    static func ranges(in value: String, terms: [String]) -> [Range<String.Index>] {
        guard !terms.isEmpty else { return [] }
        var found: [Range<String.Index>] = []
        var cursor = value.startIndex
        while cursor < value.endIndex {
            let next = terms.compactMap { value.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive], range: cursor..<value.endIndex) }
                .min { left, right in left.lowerBound == right.lowerBound ? left.upperBound > right.upperBound : left.lowerBound < right.lowerBound }
            guard let range = next, !range.isEmpty else { break }
            found.append(range)
            cursor = range.upperBound
        }
        return found
    }

    /// The text with the found words in the app's blue (Lark's mark, owner 2026-11-27), at the weight the text has.
    static func marked(_ value: String, terms: [String]) -> Text {
        let ranges = ranges(in: value, terms: terms)
        guard !ranges.isEmpty else { return Text(value) }
        var output = Text("")
        var cursor = value.startIndex
        for range in ranges {
            output = output + Text(String(value[cursor..<range.lowerBound])) + Text(String(value[range])).foregroundColor(DuduStyle.blue)
            cursor = range.upperBound
        }
        return output + Text(String(value[cursor...]))
    }
}

// MARK: The page's state

@MainActor
final class SearchModel: ObservableObject {
    /// What one request is for: the same key is not asked twice.
    struct RequestKey: Equatable {
        var phrase: String
        var scope: SearchScope?
        var state: String?
        var sources: [String]
        var filters: [String: Set<String?>]
        var computerID: String?
        var revision: Int
        var retry: Int

        /// The places the answer has to hold.
        var places: [SearchScope] { scope.map { [$0] } ?? SearchScope.allCases }
    }

    @Published var query = ""
    @Published private(set) var scope: SearchScope?
    @Published private(set) var filters = SearchRangeFilters()
    @Published private(set) var answer: SearchAnswer?
    /// The request `answer` was the answer to (nil before the first): the page waits while it is not the request it wants now.
    @Published private(set) var answeredKey: RequestKey?
    @Published private(set) var isLoading = false
    @Published private(set) var failure: String?
    @Published private(set) var retryRevision = 0
    @Published private(set) var history: SearchHistory
    private let memory: SearchMemory
    private let json = DuduJSON()
    private var requestID = UUID()
    private var loaded: RequestKey?

    init(memory: SearchMemory = .shared) {
        self.memory = memory
        history = memory.history
    }

    var phrase: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }
    var terms: [String] { SearchText.terms(phrase) }

    /// Nothing is typed and no range is picked: the page shows the history and 常用.
    var showsHome: Bool { phrase.isEmpty && scope == nil }
    /// A range is picked, nothing is typed and nothing is chosen on its pills: the page says how to look.
    var showsHint: Bool { phrase.isEmpty && scope.map { filters.isEmpty(in: $0) } == true }

    func select(_ next: SearchScope?) {
        guard scope != next else { return }
        scope = next
        filters = SearchRangeFilters()
        failure = nil
    }

    func toggle(_ key: String?, in field: SearchFilterField) { filters.toggle(key, in: field) }
    func reset(_ field: SearchFilterField) {
        for key in filters.chosen(field) { filters.toggle(key, in: field) }
    }

    /// The words are kept when they were searched with: the keyboard's search key, or a result opened.
    func submit() {
        history.add(phrase)
        memory.history = history
    }

    /// The history as the phone keeps it: read again whenever the page opens.
    func reloadHistory() { history = memory.history }

    func clearHistory() {
        history.clear()
        memory.history = history
    }

    func retry() {
        loaded = nil
        retryRevision &+= 1
    }

    func reset() {
        requestID = UUID()
        query = ""
        scope = nil
        filters = SearchRangeFilters()
        answer = nil
        answeredKey = nil
        isLoading = false
        failure = nil
        loaded = nil
    }

    /// Whether the answer to `key` (what `wantedRequest` says the page wants now) is still to come: the page says so with a spinner, never with nothing.
    func isAwaiting(_ key: RequestKey?) -> Bool { key != nil && failure == nil && answeredKey != key }

    /// The request the page is waiting for, or nil when it needs none (nothing to look for, or the conversations of a range with nothing typed, which the board already holds).
    func wantedRequest(computerID: String?, revision: Int) -> RequestKey? {
        switch scope {
        case nil, .sessions: if phrase.isEmpty { return nil }
        case .inbox, .tasks: break
        }
        return RequestKey(
            phrase: phrase, scope: scope, state: scope == .inbox ? filters.inboxState : nil,
            sources: scope == .inbox ? filters.sources.sorted() : [], filters: filters.requestFilters(for: scope),
            computerID: computerID, revision: revision, retry: retryRevision
        )
    }

    private func parameters(_ key: RequestKey) -> [String: JSONValue] {
        var values: [String: JSONValue] = ["q": .string(key.phrase), "limit": .number(key.scope == nil ? 20 : 100)]
        if let scope = key.scope { values["scope"] = .string(scope.rawValue) }
        if let state = key.state { values["state"] = .string(state) }
        if !key.sources.isEmpty { values["connector"] = .array(key.sources.map(JSONValue.string)) }
        if key.scope == .sessions || key.scope == .tasks {
            values["filters"] = .object(key.filters.mapValues { keys in
                .array(keys.map { $0.map(JSONValue.string) ?? .null })
            })
        }
        return values
    }

    func load(using store: DuduStore) async {
        guard let key = wantedRequest(computerID: store.activeComputer?.id, revision: store.connectionRevision) else {
            requestID = UUID()
            answer = nil
            answeredKey = nil
            isLoading = false
            failure = nil
            loaded = nil
            return
        }
        if loaded == key, answer != nil { return }
        let id = UUID()
        requestID = id
        failure = nil
        isLoading = true
        defer { if requestID == id { isLoading = false } }
        do {
            // Words are asked for once the typing pauses; a choice on a pill is asked for at once.
            if !key.phrase.isEmpty, key.phrase != answeredKey?.phrase { try await Task.sleep(for: .milliseconds(250)) }
            try Task.checkCancellation()
            var rounds = 0
            while !Task.isCancelled {
                DuduLog.record("search.query", counts: ["payloadBytes": key.phrase.utf8.count])
                let value = try await store.request("search.query", parameters(key))
                let result = try await json.decode(SearchAnswer.self, from: value)
                guard requestID == id, !Task.isCancelled else { return }
                guard result.outcome == "success" else { throw DuduFailure.protocolError }
                if result.failed(in: key.places) { throw DuduFailure.connectionFailed }
                answer = result
                answeredKey = key
                isLoading = false
                // The text index of the computer is still being built: ask again for a while, keeping what is there.
                if result.sessions?.indexing == true, rounds < 20 {
                    rounds += 1
                    try await Task.sleep(for: .seconds(1))
                    continue
                }
                loaded = key
                return
            }
        } catch is CancellationError {
            return
        } catch {
            guard requestID == id, !Task.isCancelled else { return }
            if let failure = error as? DuduFailure, case let .remote(code) = failure, ["UNSUPPORTED", "METHOD_NOT_ALLOWED"].contains(code) {
                self.failure = L10n.text("请更新电脑端的 Dudu 插件")
            } else if error as? DuduFailure == .unsupportedRequest {
                self.failure = L10n.text("请更新电脑端的 Dudu 插件")
            } else {
                self.failure = (error as? DuduFailure ?? .connectionFailed).localizedDescription
            }
        }
    }

    // MARK: Rows

    private var answerForPhrase: SearchAnswer? { answeredKey?.phrase == phrase ? answer : nil }

    private func matchesFilters(_ scope: SearchScope) -> Bool {
        answeredKey?.filters == filters.requestFilters(for: scope)
    }

    /// With words, the computer applies the filters. With an older plugin or the local board, filter the available rows here.
    func conversationHits(boardRows: [BoardConversation]) -> [SearchConversationHit] {
        let group = answerForPhrase?.sessions
        if !phrase.isEmpty, !matchesFilters(.sessions) { return [] }
        if !phrase.isEmpty, let group, group.facets != nil { return group.items }
        let base = phrase.isEmpty ? boardRows.map { SearchConversationHit(conversation: $0) } : group?.items ?? []
        guard !filters.conversations.isEmpty else { return base }
        let kept = Set(filters.conversations.matching(base.map(\.conversation)).map(\.id))
        return base.filter { kept.contains($0.id) }
    }

    func recordHits() -> [SearchRecordHit] { answer?.inbox?.items ?? [] }
    func taskRows() -> [ScheduledTask] {
        guard matchesFilters(.tasks), let group = answerForPhrase?.tasks else { return [] }
        return group.facets == nil ? filters.matching(group.items) : group.items
    }

    /// The choices of a pill's sheet.
    func choices(for field: SearchFilterField, boardRows: [BoardConversation]) -> [SearchChoice] {
        switch field {
        case .agent, .project, .updated:
            guard let board = field.boardField else { return [] }
            let group = phrase.isEmpty ? nil : answerForPhrase?.sessions
            let base = phrase.isEmpty ? boardRows : (group?.items ?? []).map(\.conversation)
            let counts = group?.facets?[board.rawValue]?.reduce(into: [String?: Int]()) { counts, facet in
                if facet.count > 0 { counts[facet.key] = facet.count }
            }
            return filters.conversations.options(for: board, in: base, statuses: [], labels: [:], counts: counts).map { option in
                var mark = SearchChoice.Mark.none
                if field == .agent, let agent = option.id.flatMap(SessionAgent.init(rawValue:)) { mark = .agent(agent) }
                return SearchChoice(key: option.id, title: option.title, count: option.count, mark: mark)
            }
        case .state:
            return [SearchChoice(key: "todo", title: CollectorTab.todo.title), SearchChoice(key: "done", title: CollectorTab.done.title)]
        case .source:
            return (answer?.inbox?.names ?? [:]).sorted { $0.value.localizedStandardCompare($1.value) == .orderedAscending }
                .map { SearchChoice(key: $0.key, title: $0.value) }
        case .taskStatus:
            return ["active", "paused", "ended"].map { SearchChoice(key: $0, title: ScheduledTask.statusName($0)) }
        case .taskAgent:
            let group = answerForPhrase?.tasks
            let agents = group?.facets?["agent"]?.reduce(into: [String: Int]()) { counts, facet in
                if let key = facet.key { counts[key] = facet.count }
            } ?? Dictionary(grouping: group?.items ?? [], by: \.agent).mapValues(\.count)
            return Set(agents.keys).union(filters.taskAgents).compactMap { id -> SearchChoice? in
                guard let agent = TaskAgent(id: id) else { return nil }
                return SearchChoice(key: id, title: agent.name, count: agents[id] ?? 0, mark: .taskAgent(agent))
            }.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
        }
    }

    /// What a pill says: the field's name, or what was chosen in it.
    func pillTitle(for field: SearchFilterField, boardRows: [BoardConversation]) -> String {
        let chosen = filters.chosen(field)
        guard !chosen.isEmpty else { return field.title }
        let titles = choices(for: field, boardRows: boardRows).filter { chosen.contains($0.key) }.map(\.title)
        return titles.isEmpty ? field.title : ListFormatter.localizedString(byJoining: titles)
    }
}
