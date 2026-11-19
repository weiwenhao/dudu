import Foundation

// The board (the phone's home page) and the Collector, as the plugin answers them (`host/native-board.mjs`).
// The words are the desktop interface's own; the models hold plain rows and no markup.

// MARK: Board

struct BoardIssueParent: Codable, Equatable, Sendable {
    var id: Int
    var ref: String?
    var title: String
    var status: String
    var statusType: String
}

struct BoardSubIssueProgress: Codable, Equatable, Sendable {
    var total: Int
    var done: Int
}

/// One issue, as a row of the board: a title, the agent that has it and what that agent is doing, and the DSH session behind it.
struct BoardIssue: Codable, Identifiable, Equatable, Sendable {
    var id: Int
    var ref: String?
    var title: String
    var parent: BoardIssueParent?
    var subIssues: BoardSubIssueProgress?
    var agent: String?
    var sessionState: String?
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
    var source: String?
    var projectInfo: IssueProject?
    var labels: [IssueLabel]?
    var children: [BoardIssue]?
    /// Only on the rows of a todo card: the latest message of the issue's session (the owner's own words or the agent's) when the card was made.
    var latest: IssueLatest?

    var sessionAgent: SessionAgent? { agent.flatMap(SessionAgent.init(rawValue:)) }
    var workState: SessionActivityState { sessionState.flatMap(SessionActivityState.init(rawValue:)) ?? .idle }
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

/// Homepage presentation only; the actual issue reference and session identity stay authoritative.
struct BoardConversation: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var title: String
    var sessionId: String?
    var issue: BoardIssue?
    var preview: String
    var receivedAt: Double
    var sessionState: SessionActivityState
    var deepSleep: Bool
    var unread: Bool
    var readSeq: Int
    var pinned: Bool

    var isAssistant: Bool { id == "assistant" }
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

    func includes(statusType: String) -> Bool {
        switch self {
        case .active: return ["todo", "in_progress", "in_review"].contains(statusType)
        case .backlog: return statusType == "backlog"
        case .all: return true
        }
    }

    func includes(_ row: BoardConversation) -> Bool {
        if let issue = row.issue { return includes(statusType: issue.statusType) }
        return self != .backlog
    }
}

private struct BoardAnswer: Decodable, Sendable {
    var outcome: String
    var tab: String?
    var total: Int?
    var conversations: [BoardConversation]?
    var pins: [String]?
    var unreadCount: Int?
    var statuses: [IssueWorkflowStatus]?
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

    @Published private(set) var tab: BoardTab = .active
    @Published private(set) var filters = BoardFilters()
    @Published private(set) var filterStatuses: [IssueWorkflowStatus] = []
    @Published private(set) var states: [BoardTab: LoadState] = [:]
    @Published private(set) var deleting: Set<Int> = []
    @Published private(set) var conversationsByTab: [BoardTab: [BoardConversation]] = [:]
    @Published private(set) var pinOrder: [String] = []
    @Published private(set) var unreadCount = 0
    @Published private(set) var changing: Set<String> = []
    var report: ((DSBotToastMessage) -> Void)?
    private let json = DSBotJSON()
    private var refreshID: UUID?
    private var refreshPending = false
    private var resetID = UUID()
    private var mutationRevision = 0
    private let storage: any DSBotBoardStorage
    private let previewPreparation = BoardPreviewPreparation()
    private var computerID: String?
    private var restoreTask: Task<Void, Never>?
    private var writeTask: Task<Void, Never>?
    private var savedSnapshot: BoardSnapshot?
    private struct VisibleRead {
        var receipt: VisibleSessionRead
        var originals: [BoardTab: [BoardConversation]]
        var reducedCount: Bool
    }
    private var visibleReads: [String: VisibleRead] = [:]

    init(storage: any DSBotBoardStorage = FileBoardStorage.shared) { self.storage = storage }

    var state: LoadState { states[tab] ?? states[.all] ?? .loading }

    // Older snapshots can hold individual scopes. New refreshes replace them with one complete list.
    var scopedConversations: [BoardConversation] {
        let rows = conversationsByTab[tab] ?? conversationsByTab[.all] ?? []
        return tab == .all ? rows : rows.filter(tab.includes)
    }
    var conversations: [BoardConversation] { filters.matching(scopedConversations) }

    var filterLabels: [String: IssueLabel] {
        let scopes = conversationsByTab[.all].map { [$0] } ?? Array(conversationsByTab.values)
        return scopes.reduce(into: [:]) { labels, rows in
            for row in rows {
                for label in row.issue?.labels ?? [] { labels[String(label.id)] = label }
            }
        }
    }

    var pinnedConversations: [BoardConversation] {
        guard !pinOrder.isEmpty else { return [] }
        let keys = Set(pinOrder)
        var pinned: [String: BoardConversation] = [:]
        for scope in [BoardTab.all, .active, .backlog] {
            for row in conversationsByTab[scope] ?? [] where row.pinned && keys.contains(row.id) {
                if pinned[row.id] == nil { pinned[row.id] = row }
            }
        }
        return pinOrder.compactMap { pinned[$0] }
    }

    func select(_ next: BoardTab) { if tab != next { tab = next } }

    func toggle(_ option: BoardFilterOption, in field: BoardFilterField) { filters.toggle(option.id, in: field) }

    func resetFilters() { if !filters.isEmpty { filters = BoardFilters() } }

    /// Forget what was read: another computer has another board.
    func reset(for computerID: String?) {
        guard computerID != self.computerID else { return }
        self.computerID = computerID
        restoreTask?.cancel()
        restoreTask = nil
        savedSnapshot = nil
        resetID = UUID()
        refreshID = nil
        mutationRevision += 1
        refreshPending = false
        visibleReads = [:]
        conversationsByTab = [:]
        filterStatuses = []
        resetFilters()
        pinOrder = []
        changing = []
        unreadCount = 0
        AppNotifications.shared.setUnreadCount(0)
        states = [:]
        deleting = []
        tab = .active
        guard let computerID else { return }
        let reset = resetID
        let precedingWrite = writeTask
        restoreTask = Task {
            await precedingWrite?.value
            do {
                guard let snapshot = try await storage.load(for: computerID) else { return }
                try snapshot.validate(for: computerID)
                var prepared: [BoardTab: [BoardConversation]] = [:]
                for (key, rows) in snapshot.conversationsByTab {
                    if let tab = BoardTab(rawValue: key) {
                        prepared[tab] = await previewPreparation.prepare(rows)
                    }
                }
                guard !Task.isCancelled, reset == resetID else { return }
                conversationsByTab = prepared
                states = conversationsByTab.mapValues { _ in .loaded }
                filterStatuses = snapshot.filterStatuses ?? []
                pinOrder = snapshot.pins
                unreadCount = snapshot.unreadCount
                savedSnapshot = snapshot
                AppNotifications.shared.setUnreadCount(unreadCount)
                DSBotLog.record("board.cache.restore", counts: ["rowCount": conversations.count])
            } catch {
                if !Task.isCancelled, reset == resetID { DSBotLog.networkFailure("board.cache.restore.fail", error: error) }
            }
        }
    }

    /// Save settled presentation facts, never an optimistic mutation that may still fail.
    private func persist() {
        guard let computerID, !conversationsByTab.isEmpty, changing.isEmpty, visibleReads.isEmpty else { return }
        let snapshot = BoardSnapshot(
            computerID: computerID,
            conversationsByTab: Dictionary(uniqueKeysWithValues: conversationsByTab.map { ($0.key.rawValue, $0.value) }),
            pins: pinOrder, unreadCount: unreadCount, filterStatuses: filterStatuses
        )
        guard snapshot != savedSnapshot else { return }
        savedSnapshot = snapshot
        let precedingWrite = writeTask
        let reset = resetID
        writeTask = Task {
            await precedingWrite?.value
            do { try await storage.save(snapshot) }
            catch {
                if reset == resetID, savedSnapshot == snapshot { savedSnapshot = nil }
                DSBotLog.networkFailure("board.cache.save.fail", error: error)
            }
        }
    }

    /// Refresh the whole board once so changing scope or filters needs only the current local rows.
    func refresh(using store: DSBotStore) async {
        reset(for: store.activeComputer?.id)
        let restoring = resetID
        await restoreTask?.value
        guard !Task.isCancelled, restoring == resetID else { return }
        guard store.status == .connected else { return }
        // A cancelled request from an old connection must never hold the homepage refresh gate.
        let currentReads = visibleReads.filter {
            $0.value.receipt.connection == store.connectionRevision && $0.value.receipt.target.computerID == store.activeComputer?.id
        }
        if currentReads.count != visibleReads.count { visibleReads = currentReads; mutationRevision += 1 }
        if refreshID != nil || !changing.isEmpty { refreshPending = true; return }
        let flight = UUID()
        refreshID = flight
        refreshPending = false
        let reset = resetID
        let connection = store.connectionRevision
        defer {
            if refreshID == flight {
                refreshID = nil
                if refreshPending && changing.isEmpty {
                    refreshPending = false
                    // An in-flight poll cannot hide a mutation's authoritative refresh until the next timer tick.
                    Task { if reset == resetID { await refresh(using: store) } }
                }
            }
        }
        let revision = mutationRevision
        if conversationsByTab[.all] == nil, states[.all] != .loading { states[.all] = .loading }
        do {
            let value = try await store.request("board.list", [
                "tab": .string(BoardTab.all.rawValue), "layout": .string("chat"), "filterData": .bool(true),
            ])
            let answer = try await json.decode(BoardAnswer.self, from: value)
            guard !Task.isCancelled, reset == resetID, revision == mutationRevision,
                  connection == store.connectionRevision else { return }
            guard answer.outcome == "success" else { throw DSBotFailure.protocolError }
            guard var conversations = answer.conversations, let count = answer.unreadCount, count >= 0 else {
                DSBotLog.record("board.contract.mismatch", level: "warn", state: "chat_layout_missing")
                throw DSBotFailure.protocolError
            }
            conversations = await previewPreparation.prepare(conversations)
            guard !Task.isCancelled, reset == resetID, revision == mutationRevision,
                  connection == store.connectionRevision else { return }
            // A poll may race a read request. Retain immediate feedback only through that
            // exact delivered sequence, while allowing other sessions to keep updating.
            var locallyRead: Set<String> = []
            for index in conversations.indices {
                guard let session = conversations[index].sessionId, let pending = visibleReads[session],
                      conversations[index].unread, conversations[index].readSeq <= pending.receipt.seq else { continue }
                conversations[index].unread = false
                if conversations[index].sessionState == .unread { conversations[index].sessionState = .idle }
                locallyRead.insert(session)
            }
            let displayedCount = max(0, count - locallyRead.count)
            let boardRows: [BoardTab: [BoardConversation]] = [.all: conversations]
            if conversationsByTab != boardRows { conversationsByTab = boardRows }
            if filterStatuses != (answer.statuses ?? []) { filterStatuses = answer.statuses ?? [] }
            if pinOrder != (answer.pins ?? []) { pinOrder = answer.pins ?? [] }
            if unreadCount != displayedCount { unreadCount = displayedCount }
            if states != [.all: .loaded] { states = [.all: .loaded] }
            AppNotifications.shared.setUnreadCount(displayedCount)
            persist()
        } catch {
            guard !Task.isCancelled, reset == resetID, connection == store.connectionRevision else { return }
            DSBotLog.networkFailure("board.load.fail", error: error)
            if conversationsByTab[.all] == nil { states[.all] = .failed }
        }
    }

    func setPinned(_ entry: BoardConversation, using store: DSBotStore) async {
        await changeHome(entry, method: "board.pin", params: ["pinned": .bool(!entry.pinned)], using: store)
    }

    func toggleUnread(_ entry: BoardConversation, using store: DSBotStore) async {
        guard let session = entry.sessionId else { return }
        await changeHome(entry, method: "board.read", params: [
            "unread": .bool(!entry.unread), "sessionId": .string(session), "seq": .number(Double(entry.readSeq)),
        ], using: store)
    }

    func receiveSessionActivity(_ activity: WatchedSessionActivity, using store: DSBotStore) {
        guard activity.target.computerID == store.activeComputer?.id,
              activity.connection == store.connectionRevision else { return }
        var changed = false
        for scope in BoardTab.allCases {
            guard var rows = conversationsByTab[scope] else { continue }
            for index in rows.indices where rows[index].sessionId == activity.target.sessionID && rows[index].readSeq <= activity.seq && !changing.contains(rows[index].id) {
                // Watch activity owns work and sleep, not homepage read receipts. A stale
                // idle/unread snapshot must not undo a person's explicit read action.
                rows[index].sessionState = activity.state == .processing ? .processing : (rows[index].unread ? .unread : .idle)
                rows[index].deepSleep = activity.asleep
            }
            if rows != conversationsByTab[scope] { conversationsByTab[scope] = rows; changed = true }
        }
        guard changed else { return }
        mutationRevision += 1
        persist()
    }

    /// Clear a visible unread badge in the same main-actor turn as its read request. Do not
    /// wait for the five-second homepage poll, nor clear a later, unseen message's sequence.
    func receiveVisibleRead(_ receipt: VisibleSessionRead, using store: DSBotStore) {
        guard receipt.target.computerID == store.activeComputer?.id,
              receipt.connection == store.connectionRevision else { return }
        let session = receipt.target.sessionID
        switch receipt.phase {
        case .pending:
            let previous = visibleReads[session]
            // Stream-prefix receipts at the same completed cut cannot improve this list's
            // feedback; retain the first request rather than replacing it on every delta.
            if let previous, previous.receipt.seq >= receipt.seq { return }
            var originals = previous?.originals ?? [:]
            var cleared = false
            for scope in BoardTab.allCases {
                guard var rows = conversationsByTab[scope] else { continue }
                var changed = false
                for index in rows.indices where rows[index].sessionId == session && rows[index].readSeq <= receipt.seq && rows[index].unread {
                    if originals[scope]?.contains(where: { $0.id == rows[index].id }) != true {
                        originals[scope, default: []].append(rows[index])
                    }
                    rows[index].unread = false
                    if rows[index].sessionState == .unread { rows[index].sessionState = .idle }
                    changed = true
                }
                if changed { conversationsByTab[scope] = rows; cleared = true }
            }
            guard cleared || previous != nil else { return }
            let reduced = cleared && previous?.reducedCount != true && unreadCount > 0
            if reduced { unreadCount -= 1 }
            visibleReads[session] = VisibleRead(receipt: receipt, originals: originals, reducedCount: reduced || previous?.reducedCount == true)
            mutationRevision += 1 // An older in-flight list must not restore the red badge.
        case .saved, .failed:
            guard let pending = visibleReads[session], pending.receipt.id == receipt.id else { return }
            visibleReads[session] = nil
            mutationRevision += 1
            if receipt.phase == .failed {
                var restored = false
                for (scope, originals) in pending.originals {
                    guard var rows = conversationsByTab[scope] else { continue }
                    for original in originals {
                        guard let index = rows.firstIndex(where: { $0.id == original.id && $0.sessionId == session && $0.readSeq == original.readSeq }) else { continue }
                        rows[index].unread = original.unread
                        if rows[index].sessionState == .idle { rows[index].sessionState = original.sessionState }
                        restored = true
                    }
                    if rows != conversationsByTab[scope] { conversationsByTab[scope] = rows }
                }
                if restored, pending.reducedCount { unreadCount += 1 }
            }
            refreshPending = true
            Task { await refresh(using: store) }
        }
        AppNotifications.shared.setUnreadCount(unreadCount)
        persist()
    }

    private func changeHome(_ entry: BoardConversation, method: String, params: [String: JSONValue], using store: DSBotStore) async {
        guard store.status == .connected, !changing.contains(entry.id) else { return }
        let reset = resetID
        let computer = store.activeComputer?.id
        // A person's explicit mark supersedes feedback from an older read request.
        if method == "board.read", let session = entry.sessionId { visibleReads[session] = nil }
        changing.insert(entry.id)
        mutationRevision += 1
        let before = conversationsByTab
        let previousPins = pinOrder
        for scope in BoardTab.allCases {
            guard var entries = conversationsByTab[scope], let index = entries.firstIndex(where: { $0.id == entry.id }) else { continue }
            if method == "board.pin" { entries[index].pinned = !entry.pinned }
            else {
                entries[index].unread = !entry.unread
                if entries[index].sessionState != .processing { entries[index].sessionState = entry.unread ? .idle : .unread }
            }
            conversationsByTab[scope] = entries
        }
        if method == "board.pin" {
            pinOrder.removeAll { $0 == entry.id }
            if !entry.pinned { pinOrder.append(entry.id) }
        }
        defer { finishHomeChange(entry.id, reset: reset, using: store) }
        var request = params
        request["target"] = .string(entry.id)
        let answer = await creationRequest(IssueAnswer.self, method, request, using: store)
        guard reset == resetID, computer == store.activeComputer?.id else { return }
        mutationRevision += 1
        if answer?.outcome != "success" {
            // Restore only this entry; another row may have completed an independent edit.
            for scope in BoardTab.allCases {
                if let original = before[scope]?.first(where: { $0.id == entry.id }),
                   let index = conversationsByTab[scope]?.firstIndex(where: { $0.id == entry.id }) {
                    conversationsByTab[scope]?[index] = original
                }
            }
            if method == "board.pin" {
                pinOrder.removeAll { $0 == entry.id }
                if let index = previousPins.firstIndex(of: entry.id) { pinOrder.insert(entry.id, at: min(index, pinOrder.count)) }
            }
            report?(DSBotToastMessage(text: L10n.text("更改没能保存"), kind: .error))
        }
    }

    private func finishHomeChange(_ key: String, reset: UUID, using store: DSBotStore) {
        guard reset == resetID else { return }
        changing.remove(key)
        persist()
        if changing.isEmpty { Task { if reset == resetID { await refresh(using: store) } } }
    }

    func complete(_ issue: BoardIssue, using store: DSBotStore) async {
        let key = "issue:\(issue.id)"
        guard store.status == .connected, !changing.contains(key) else { return }
        let reset = resetID
        changing.insert(key)
        defer { finishHomeChange(key, reset: reset, using: store) }
        guard let options = await creationOptions(using: store), reset == resetID,
              let done = options.statuses.first(where: { $0.type == "done" }) else {
            if reset == resetID { report?(DSBotToastMessage(text: L10n.text("更改没能保存"), kind: .error)) }
            return
        }
        if await update(issue, patch: ["status": .string(done.id)], using: store) == nil, reset == resetID {
            report?(DSBotToastMessage(text: L10n.text("更改没能保存"), kind: .error))
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
            for scope in BoardTab.allCases {
                conversationsByTab[scope]?.removeAll { $0.issue?.id == issue.id }
            }
            pinOrder.removeAll { $0 == "issue:\(issue.id)" }
            persist()
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
        for scope in [tab, .all, .active, .backlog] {
            if let issue = conversationsByTab[scope]?.first(where: { $0.sessionId == session.id })?.issue {
                return issue
            }
        }
        return nil
    }

    func detail(of issue: BoardIssue, using store: DSBotStore) async -> BoardIssue? {
        let computer = store.activeComputer?.id
        let connection = store.connectionRevision
        do {
            let value = try await store.request("issue.get", ["id": .number(Double(issue.id))])
            let answer = try await json.decode(IssueAnswer.self, from: value)
            guard !Task.isCancelled, computer == store.activeComputer?.id, connection == store.connectionRevision else { return nil }
            return answer.outcome == "success" ? answer.issue : nil
        } catch {
            if !Task.isCancelled { DSBotLog.networkFailure("issue.get.fail", error: error) }
            return nil
        }
    }

    /// The open issues, the one touched last first: what a collected record is forwarded to (`withSession`: only the ones that have a conversation).
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
        // Keep the latest received message while changing issue metadata; workflow stays explicit.
        for scope in BoardTab.allCases {
            guard let entries = conversationsByTab[scope] else { continue }
            conversationsByTab[scope] = entries.compactMap { entry in
                guard entry.issue?.id == changed.id else { return entry }
                guard scope.includes(statusType: changed.statusType) else { return nil }
                var fresh = entry
                fresh.title = changed.title
                fresh.issue = changed
                if fresh.sessionId != changed.sessionId {
                    fresh.preview = ""; fresh.receivedAt = 0; fresh.unread = false; fresh.readSeq = -1
                    fresh.sessionState = changed.workState; fresh.deepSleep = changed.deepSleep == true
                }
                fresh.sessionId = changed.sessionId
                return fresh
            }
        }
        persist()
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
    case todo, done

    var id: String { rawValue }
    var title: String {
        switch self {
        case .todo: return L10n.text("待处理")
        case .done: return L10n.text("已处理")
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

/// One message of a conversation record (`inbox.get`'s `record.messages`, split by the plugin from the text's one-line-per-message form): its time as the plugin wrote it, `MM-DD HH:mm`, who said it
/// and what. A phone that is given none shows the record's text as it is.
struct CollectorMessage: Codable, Equatable, Sendable {
    var at: String
    var from: String?
    var text: String

    /// `MM-DD`, the date of the divider the message sits under.
    var day: String { String(at.prefix(5)) }
    /// `HH:mm`.
    var time: String { String(at.dropFirst(6)) }
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
    var done: Bool?
    /// What became of it: an issue made of it, or a note shared to one (`issue`, `note`).
    var verdict: String?
    var issue: CollectorIssue?
    var text: String?
    /// A conversation's messages one by one, when the plugin could tell them apart (only in `inbox.get`); an older plugin sends none and the text is shown as it is.
    var messages: [CollectorMessage]?
    var context: [CollectorContext]?
    /// The collector's session is going back to the source to read what is around this record (`inbox.complete`); `inbox.get` says it, and an older plugin says nothing.
    var completing: Bool?
    /// Why the last such completion failed, in the plugin's own words (English system text, which the plugin keeps ten minutes).
    var completeError: String?

    /// The line under the title: who it is from and which collector brought it. Its number (`r143`) is the second line of the column at the right, where a line that is cut short cannot take it
    /// away (owner, 2026-11-11, option A of `.local/designs/record-id-2026-11-11/`, on records that read alike: "设计一个 id 吧，不然我都不知道哪个是哪个"; 2026-11-18, the inbox redesign).
    var byLine: String { [from ?? "", connectorName].filter { !$0.isEmpty }.joined(separator: " · ") }
}

/// What the owner can do with a record without making an issue of it.
enum CollectorMark: String, Sendable {
    case done, delete, restore

    var toast: String? {
        switch self {
        case .done: return nil
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

    /// A mark on one or several records. No undo (owner, 2026-11-12): a restore is the way back for a handled row, and a delete is for a row that is wrong.
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
        if let message = action.toast {
            report?(DSBotToastMessage(text: message, kind: .success))
        }
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

    /// Records forwarded to the conversation of an issue: a message to its agent (owner, 2026-11-18: 转发, to conversations only; the note in an issue's activity is no longer offered on the phone).
    @discardableResult
    func share(_ records: [CollectorRecord], to issue: BoardIssue, using store: DSBotStore) async -> Bool {
        let ids = records.map(\.id)
        guard !ids.isEmpty, changing.isDisjoint(with: ids) else { return false }
        let computer = store.activeComputer?.id
        changing.formUnion(ids)
        defer { if computer == store.activeComputer?.id { changing.subtract(ids) } }
        let params: [String: JSONValue] = ["ids": .array(ids.map { .number(Double($0)) }), "issue": .number(Double(issue.id)), "to": .string("session")]
        do {
            let value = try await store.request("inbox.share", params)
            let answer = try await json.decode(CollectorAnswer.self, from: value)
            guard computer == store.activeComputer?.id else { return false }
            guard answer.outcome == "success" || answer.outcome == "no_op" else {
                report?(DSBotToastMessage(text: L10n.text("更改没能保存"), kind: .error))
                return false
            }
            stopSelecting()
            report?(DSBotToastMessage(text: L10n.text("已转发到 {0}", "\(issue.reference)"), kind: .success))
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
