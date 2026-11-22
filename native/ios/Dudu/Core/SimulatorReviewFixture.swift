#if DEBUG && targetEnvironment(simulator)
import Foundation
import UIKit

enum SimulatorReviewFixture {
    @MainActor
    static func makeStore() -> DuduStore {
        let arguments = ProcessInfo.processInfo.arguments
        let storage: any DuduConversationStorage
        if let index = arguments.firstIndex(of: "-dudu-review-cache-id"), index + 1 < arguments.count,
           let identifier = UUID(uuidString: arguments[index + 1]) {
            storage = FileConversationStorage(directory: FileManager.default.temporaryDirectory
                .appendingPathComponent("review-conversations-" + identifier.uuidString))
        } else {
            storage = MemoryConversationStorage()
        }
        let conversationStorage: any DuduConversationStorage = arguments.contains("-dudu-review-delayed-cache")
            ? DelayedReviewConversationStorage(storage: storage) : storage
        return DuduStore(repository: ReviewComputerRepository(), client: ReviewTransport(), conversationStorage: conversationStorage)
    }
}

private actor DelayedReviewConversationStorage: DuduConversationStorage {
    private let storage: any DuduConversationStorage

    init(storage: any DuduConversationStorage) {
        self.storage = storage
    }

    func load(for computerID: String) async throws -> ConversationSnapshot? {
        try await Task.sleep(nanoseconds: 3_000_000_000)
        return try await storage.load(for: computerID)
    }

    func save(_ snapshot: ConversationSnapshot) async throws {
        try await storage.save(snapshot)
    }

    func remove(for computerID: String) async throws {
        try await storage.remove(for: computerID)
    }
}

private actor ReviewComputerRepository: DuduComputerStorage {
    private var hasDelayedRestore = false
    private var library = ComputerLibrary(
        computers: [
            Computer(
                id: "review-local", name: "我的 Mac",
                url: "https://desktop.example.invalid/?pair=" + String(repeating: "A", count: 43),
                computerId: "review-desktop", lastUsedAt: 2
            ),
            Computer(
                id: "review-secondary", name: "工作电脑",
                url: "https://work.example.invalid/?pair=" + String(repeating: "B", count: 43),
                computerId: "review-work", lastUsedAt: 1
            )
        ],
        activeId: "review-local"
    )

    init() {
        if ProcessInfo.processInfo.arguments.contains("-dudu-review-dual-addresses") {
            library.computers[0].url = "http://192.168.31.201:3170/?pair=" + String(repeating: "A", count: 43)
            library.computers[0].addresses = [
                ConnectionAddress(kind: .lan, url: "http://192.168.31.201:3170"),
                ConnectionAddress(kind: .internet, url: "https://dudu.example.com"),
            ]
            library.computers[0].probeId = "review-phone"
        }
        if ProcessInfo.processInfo.arguments.contains("-dudu-review-unpaired") {
            library = ComputerLibrary(computers: [], activeId: nil)
        } else if ProcessInfo.processInfo.arguments.contains("-dudu-review-many-computers") {
            for index in 1...20 {
                library.computers.append(Computer(
                    id: "review-extra-\(index)", name: "测试电脑 \(index)",
                    url: "http://desktop-\(index).example.invalid/?pair=" + String(repeating: "B", count: 43),
                    computerId: "review-work", lastUsedAt: 0
                ))
            }
        }
    }

    func load() async throws -> ComputerLibrary {
        if ProcessInfo.processInfo.arguments.contains("-dudu-review-startup-transition"),
           !hasDelayedRestore {
            hasDelayedRestore = true
            try await Task.sleep(nanoseconds: 3_000_000_000)
        }
        return library
    }

    func pairAuthenticated(endpoint: ConnectionEndpoint, readyId: String) -> ComputerLibrary {
        let existing = library.computers.first { $0.computerId == readyId }
        let computer = Computer(
            id: existing?.id ?? UUID().uuidString,
            name: endpoint.name,
            url: endpoint.originalURL,
            computerId: readyId,
            lastUsedAt: Date().timeIntervalSince1970 * 1_000
        )
        library.computers.removeAll { $0.id == computer.id }
        library.computers.append(computer)
        library.activeId = computer.id
        return library
    }

    func activateAuthenticated(localId: String, readyId: String) -> ComputerLibrary {
        library.activeId = localId
        return library
    }

    func activateAuthenticated(localId: String, readyId: String, endpoint: ConnectionEndpoint) async -> ComputerLibrary {
        if let index = library.computers.firstIndex(where: { $0.id == localId }) {
            library.computers[index].url = endpoint.originalURL
            library.computers[index].addresses = endpoint.addresses
            library.computers[index].probeId = endpoint.probeId
            library.computers[index].addressesEdited = endpoint.addressesEdited
        }
        library.activeId = localId
        return library
    }

    func updateAddresses(localId: String, endpoint: ConnectionEndpoint) async throws -> ComputerLibrary {
        guard let index = library.computers.firstIndex(where: { $0.id == localId }) else {
            throw DuduFailure.switchedComputer
        }
        library.computers[index].addresses = endpoint.addresses
        library.computers[index].addressesEdited = true
        return library
    }

    func remove(_ localId: String) -> ComputerLibrary {
        library.computers.removeAll { $0.id == localId }
        if library.activeId == localId { library.activeId = library.computers.first?.id }
        return library
    }
}

private actor ReviewTransport: DuduTransport {
    func uploadFile(_ file: PickedFile, sessionID: String) async throws -> JSONValue {
        .object(["receiptId": .string(UUID().uuidString), "name": .string(file.name), "bytes": .number(Double(file.bytes))])
    }

    private var connectedEndpoint: ConnectionEndpoint?
    private var searchRequests = 0

    func resolvedEndpoint() async -> ConnectionEndpoint? { connectedEndpoint }

    func verifyEndpoint(_ endpoint: ConnectionEndpoint) async throws -> ConnectionEndpoint {
        try await Task.sleep(for: .milliseconds(400))
        if ProcessInfo.processInfo.arguments.contains("-dudu-review-address-failed") {
            throw DuduFailure.identityMismatch
        }
        guard let route = endpoint.addresses.first else { throw DuduFailure.invalidLink }
        return try endpoint.selecting(route)
    }
    private var onEvent: (@Sendable (JSONValue) async -> Void)?
    private var onDisconnect: (@Sendable () async -> Void)?
    private var connectionCount = 0
    private var watchID = ""
    private var selectedID = "review-chat"
    private var newSessionCount = ProcessInfo.processInfo.arguments.contains("-dudu-review-blank-session") ? 1 : 0
    private var newSessionWorkspace = "mobile"
    private var renamedWorkspaces: [String: String] = [:]
    private var deletedWorkspaces: Set<String> = []
    private var unarchivedSessions: Set<String> = []
    /// What the conversation menu changed: titles, the pin set (most recently pinned first) and archived ones.
    private var renamedSessions: [String: String] = [:]
    private var pinnedSessions: [String] = []
    private var archivedSessions: Set<String> = []
    private var sessionListRequests = 0
    private static let richSidebar = ProcessInfo.processInfo.arguments.contains("-dudu-review-sidebar-rich")
    /// `-dudu-review-long-names` uses names as long as the real desktop's, to check chip layout.
    private static let longNames = ProcessInfo.processInfo.arguments.contains("-dudu-review-long-names")
    private var modelID = "deepseek"
    private var effortID = "high"
    private var permissionID = "ask"
    private var presetID = "standard"
    private var goal: (objective: String, phase: String)? =
        ProcessInfo.processInfo.arguments.contains("-dudu-review-goal")
        ? ("继续完善通用游戏助手 1. 每完成一轮，都停下确认正在做的事情是否符合我们的通用游戏助手的目标。 2. 是否有更好的方案", "active")
        : nil
    private var planMode = ProcessInfo.processInfo.arguments.contains("-dudu-review-plan-mode")
    private var uploadCount = 0
    private var compactionCount = 0
    private var compactionRunning = false
    private var wasStopped = false
    private var awaitingFirstOutputAt: Double?
    private var queueUpdateCount = 0
    private var wantsTranscript = false
    private var answeredParityQuestions = false
    private var streamingTask: Task<Void, Never>?
    private var streamedParagraphs = 0
    private static let fastStreamText = (1...1_000).map {
        "流式输出第 \($0) 段：持续补充回答，检查滚动位置。"
    }.joined(separator: "\n\n")
    private var sentMessages: [String: [ChatMessage]] = [:]
    /// `-dudu-review-quick-cards <file>`: 嘟嘟's own conversation, with the cards the plugin's card module made (the file holds the command entries as its bridge attaches the rows to them:
    /// `.local/designs/quick-chips-2026-11-09/verify/make-phone-cards.mjs`). `-dudu-review-quick-cards-initial N` shows the first N of them from the start; a tap on a button adds
    /// the last one of its kind, as `assistant.card` does on a real computer, and `-dudu-review-slow-card` makes that answer take a while.
    private static let quickCardsFile: String? = {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-dudu-review-quick-cards"), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }()
    private lazy var quickCardEntries: [TranscriptEntry] = {
        guard let file = Self.quickCardsFile, let data = try? Data(contentsOf: URL(fileURLWithPath: file)) else { return [] }
        return (try? JSONDecoder().decode([TranscriptEntry].self, from: data)) ?? []
    }()
    private var tappedCards: [TranscriptEntry] = []
    /// `-dudu-review-tasks <file>`: the scheduled tasks the plugin's own tasks service made (`.local/designs/phone-tasks-2026-11-10/verify/make-tasks.mjs`), answered and changed in memory like the plugin's
    /// `tasks.*`. `-dudu-review-navigation <file>` answers `navigation.get` with a sidebar the plugin's own navigation store made, instead of the old fixed one.
    private struct ReviewTasksFile: Decodable {
        var tasks: [ScheduledTask]
        var options: JSONValue
        var sessions: JSONValue
        var history: [String: [JSONValue]]
    }
    private struct ReviewTaskFields: Decodable {
        var title: String
        var prompt: String
        var agent: String
        var model: String?
        var project: TaskProject?
        var target: TaskTarget
        var schedule: TaskSchedule
    }
    private static func reviewArgument(_ name: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }
    private static let tasksFile = reviewArgument("-dudu-review-tasks")
    /// The answer of `board.list`, as the plugin's own board would give it (a JSON file): what the board shows in the simulator, offline (made-up issues for pictures).
    private static let boardFile = reviewArgument("-dudu-review-board")
    private static let navigationFile = reviewArgument("-dudu-review-navigation")
    private lazy var reviewTasksData: ReviewTasksFile? = {
        guard let file = Self.tasksFile, let data = try? Data(contentsOf: URL(fileURLWithPath: file)) else { return nil }
        return try? JSONDecoder().decode(ReviewTasksFile.self, from: data)
    }()
    private var reviewTasks: [ScheduledTask]?
    private var reviewRuns: [String: [JSONValue]] = [:]
    private var queues: [String: [QueuedMessage]] = ProcessInfo.processInfo.arguments.contains("-dudu-review-queue")
        ? ["review-chat": [QueuedMessage(id: "queued-desktop", text: "电脑端排队的消息", editable: true)],
           "review-assistant": [QueuedMessage(id: "queued-assistant", text: "等 HOU-15 回复后再看测试环境", editable: true)]] : [:]
    private var embeddedPages: [String: String] = [:]
    private let realPages = ReviewEmbeddedPages()
    /// Local-only replay data is copied into the simulator, never bundled with the app.
    private lazy var replayDetail: SessionDetail? = {
        guard ProcessInfo.processInfo.arguments.contains("-dudu-review-replay"),
              let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
              let data = try? Data(contentsOf: documents.appendingPathComponent("ReviewSession.json")) else { return nil }
        return try? JSONDecoder().decode(SessionDetail.self, from: data)
    }()
    private let hostPageReview: JSONValue? = {
        guard let encoded = ProcessInfo.processInfo.environment["DUDU_HOST_PAGE_REVIEW"],
              let data = Data(base64Encoded: encoded) else { return nil }
        return try? JSONDecoder().decode(JSONValue.self, from: data)
    }()
    private var computerID = "review-desktop"
    private let now = Date().timeIntervalSince1970 * 1_000

    func connect(
        endpoint: ConnectionEndpoint,
        expectedComputerId: String?,
        generation: Int,
        onEvent: @escaping @Sendable (JSONValue) async -> Void,
        onDisconnect: @escaping @Sendable () async -> Void
    ) async throws -> (id: String, name: String) {
        connectionCount += 1
        let arguments = ProcessInfo.processInfo.arguments
        let isPrimary = expectedComputerId == nil || expectedComputerId == "review-desktop"
        if isPrimary {
            if arguments.contains("-dudu-review-connecting") {
                try await Task.sleep(nanoseconds: 20_000_000_000)
            }
            if arguments.contains("-dudu-review-auth-failed"),
               endpoint.token == String(repeating: "A", count: 43) {
                if arguments.contains("-dudu-review-startup-transition") {
                    try await Task.sleep(nanoseconds: 25_000_000_000)
                }
                throw DuduFailure.remote("AUTH_FAILED")
            }
            if arguments.contains("-dudu-review-disconnected")
                || (arguments.contains("-dudu-review-drop-session") && connectionCount > 1) {
                throw DuduFailure.connectionFailed
            }
            if arguments.contains("-dudu-review-retry"), connectionCount == 1 {
                throw DuduFailure.remote("AUTH_REQUIRED")
            }
        }
        self.onEvent = onEvent
        self.onDisconnect = onDisconnect
        if let preferred = endpoint.addresses.first {
            connectedEndpoint = try endpoint.selecting(preferred)
        } else {
            connectedEndpoint = endpoint
        }
        computerID = expectedComputerId ?? "review-desktop"
        return (computerID, endpoint.name)
    }

    private func publishSnapshot(_ id: String) async {
        guard var snapshot = try? encode(detail(id, transcript: wantsTranscript)).objectValue else { return }
        snapshot["watchId"] = .string(watchID)
        await onEvent?(.object([
            "type": .string("event"), "topic": .string("session.snapshot"), "params": .object(snapshot)
        ]))
    }

    private func startStreaming(_ id: String) {
        streamingTask?.cancel()
        let fast = ProcessInfo.processInfo.arguments.contains("-dudu-review-streaming-fast")
        guard fast || ProcessInfo.processInfo.arguments.contains("-dudu-review-streaming"), id == "review-chat" else { return }
        let expectedWatchID = watchID
        streamingTask = Task { [weak self] in
            for _ in 0..<(fast ? 900 : 120) {
                do {
                    try await Task.sleep(nanoseconds: fast ? 100_000_000 : 800_000_000)
                } catch {
                    return
                }
                guard let self, await self.advanceStream(id, expectedWatchID: expectedWatchID) else { return }
            }
        }
    }

    private func advanceStream(_ id: String, expectedWatchID: String) async -> Bool {
        guard selectedID == id, watchID == expectedWatchID, !wasStopped else { return false }
        streamedParagraphs += 1
        await publishSnapshot(id)
        return true
    }

    /// Mirrors the replies of DSH's `/goal`, `/plan` and `/compact` handlers.
    private func reviewCommand(_ command: String, argument: String) -> JSONValue {
        func reply(_ text: String, error: Bool = false) -> JSONValue {
            .object(["kind": .string(error ? "error" : "success"), "text": .string(text)])
        }
        func render(_ title: String) -> JSONValue {
            guard let goal else { return reply("No goal is currently set.") }
            return reply([
                title, "Status: \(goal.phase)", "Objective: \(goal.objective)",
                "Rounds: 2/20", "Activation: \(goal.phase == "active" ? "armed" : "disarmed")",
                "", "Commands: /goal edit <objective>, /goal clear"
            ].joined(separator: "\n"))
        }
        switch command {
        case "compact":
            compactionCount += 1
            return reply("Compacted 14 history items (~3200 tokens).")
        case "plan":
            if argument == "off" {
                defer { planMode = false }
                return reply(planMode ? "Plan mode off." : "Plan mode is already inactive.")
            }
            planMode = true
            return reply("Plan mode on. Use /plan off to leave.")
        case "goal":
            switch argument {
            case "": return render("Goal")
            case "clear":
                defer { goal = nil }
                return reply(goal == nil ? "No goal to clear." : "Goal cleared.")
            case "pause":
                goal?.phase = "paused"
                return render("Goal paused")
            case "resume":
                goal?.phase = "active"
                return render("Goal resumed")
            default:
                if argument.hasPrefix("edit ") {
                    goal = (String(argument.dropFirst(5)), goal?.phase ?? "active")
                    return render("Goal updated")
                }
                goal = (argument, "active")
                return render("Goal created")
            }
        default:
            return reply("Unknown command.", error: true)
        }
    }

    func request(_ method: String, params: [String: JSONValue], timeoutSeconds: UInt64) async throws -> JSONValue {
        // Simulator-only UI review may exercise the real homepage store in a disposable local service.
        // Neither arbitrary hosts nor unrelated DSH actions can enter this route.
        if ["board.list", "board.pin", "board.read", "issue.get", "issue.open", "issue.update", "issue.options", "issue.pick", "assistant.open", "session.read"].contains(method),
           let address = Self.reviewArgument("-dudu-review-home-url"),
           let url = URL(string: address), url.scheme == "http", url.host == "127.0.0.1" {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(JSONValue.object([
                "method": .string(method), "params": .object(params),
            ]))
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw DuduFailure.protocolError }
            return try JSONDecoder().decode(JSONValue.self, from: data)
        }
        if let response = hostPageReview?["responses"]?[method] { return response }
        if method == "session.page", ProcessInfo.processInfo.arguments.contains("-dudu-review-paged-history") {
            // Another page of older turns, as the host answers one: the entries before `beforeSeq`, and where the next page ends.
            // `-dudu-review-slow-paged-load`: the page lands nine seconds later, when the reader has come to rest at the start.
            try await Task.sleep(nanoseconds: ProcessInfo.processInfo.arguments.contains("-dudu-review-slow-paged-load") ? 9_000_000_000 : 350_000_000)
            return try encode(ConversationPage(transcript: Self.pagedTranscript(before: params["beforeSeq"]?.numberValue)))
        }
        if ProcessInfo.processInfo.arguments.contains("-dudu-review-parity") {
            switch method {
            case "session.page":
                if ProcessInfo.processInfo.arguments.contains("-dudu-review-slow-history-page") {
                    try await Task.sleep(nanoseconds: 4_000_000_000)
                }
                return try encode(ConversationParityFixture.older)
            case "session.changes":
                if ProcessInfo.processInfo.arguments.contains("-dudu-review-changes-expired") {
                    throw DuduFailure.remote("NOT_FOUND")
                }
                if ProcessInfo.processInfo.arguments.contains("-dudu-review-changes-unavailable") {
                    throw DuduFailure.protocolError
                }
                return try encode(ConversationParityFixture.changes)
            case "session.diff": return try encode(ConversationParityFixture.fileDiff(params))
            case "session.tool": return try encode(ConversationParityFixture.tool(params))
            case "session.performance": return try encode(ConversationParityFixture.performance)
            case "session.file":
                return try encode(ConversationFilePayload(name: "report.txt", mediaType: "text/plain",
                                                         dataBase64: Data("报告\n新内容\n已验证".utf8).base64EncodedString()))
            case "question.answer":
                answeredParityQuestions = true
                await publishSnapshot(selectedID)
                return .bool(true)
            default: break
            }
        }
        if method.hasPrefix("web.") && ProcessInfo.processInfo.arguments.contains("-dudu-review-real-pages") {
            return try await realPages.request(method, params: params)
        }
        if method.hasPrefix("tasks."), Self.tasksFile != nil { return try reviewTasksRequest(method, params) }
        if method == "board.list", let file = Self.boardFile, let data = try? Data(contentsOf: URL(fileURLWithPath: file)), let answer = try? JSONDecoder().decode(JSONValue.self, from: data) { return answer }
        switch method {
        case "assistant.hide":
            return .object(["outcome": .string("success")])
        case "assistant.card":
            // What the plugin does for a quick button: the command makes the card, and it comes back as an entry of the thread (here, a snapshot that has it).
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-slow-card") { try await Task.sleep(nanoseconds: 2_500_000_000) }
            guard let kind = params["kind"]?.stringValue,
                  var entry = quickCardEntries.last(where: { $0.card?.card?.kind.rawValue == kind }) else { throw DuduFailure.remote("BAD_REQUEST") }
            // A repeat: the same list as the card the phone names (`since`) makes nothing, and the plugin says so.
            if let since = params["since"]?.stringValue,
               let earlier = (quickCardEntries + tappedCards).first(where: { $0.commandId == since }), earlier.card == entry.card {
                return .object(["outcome": .string("success"), "commandId": .string(since), "unchanged": .bool(true)])
            }
            let number = tappedCards.count + 1
            entry.id = "command:review-card-\(number)"
            entry.commandId = "review-card-\(number)"
            entry.seq = Double(1_000 + number)
            entry.time = Date().timeIntervalSince1970 * 1_000
            tappedCards.append(entry)
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-late-card") {
                // The answer comes first and the card arrives with the thread's snapshot a moment later, as it can on a real computer.
                Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    await self?.publishSnapshot("review-assistant")
                }
            } else {
                await publishSnapshot("review-assistant")
            }
            return .object(["outcome": .string("success"), "commandId": .string("review-card-\(number)")])
        case "session.list":
            sessionListRequests += 1
            if sessionListRequests > 1,
               ProcessInfo.processInfo.arguments.contains("-dudu-review-slow-session-refresh") {
                try await Task.sleep(nanoseconds: 4_000_000_000)
            }
            return try encode(sessions)
        case "session.search":
            searchRequests += 1
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-search-retry") {
                if searchRequests == 1 { throw DuduFailure.remote("UPSTREAM_UNAVAILABLE") }
                if searchRequests == 2 {
                    return try encode(SessionSearchPage(items: [], hasMore: false, indexing: true))
                }
            }
            let query = params["query"]?.stringValue ?? ""
            let hits = sessions.compactMap { session -> SessionSearchHit? in
                guard session.blank != true,
                      let message = detail(session.id).messages.first(where: { $0.text.localizedCaseInsensitiveContains(query) }) else {
                    return nil
                }
                return SessionSearchHit(session: session, snippet: String(message.text.prefix(240)))
            }
            return try encode(SessionSearchPage(items: hits, hasMore: false))
        case "workspace.list":
            return try encode(reviewWorkspaces)
        case "workspace.rename":
            if let id = params["id"]?.stringValue, let title = params["title"]?.stringValue { renamedWorkspaces[id] = title }
            return .object([:])
        case "workspace.delete":
            if let id = params["id"]?.stringValue { deletedWorkspaces.insert(id) }
            return .object([:])
        case "session.unarchive":
            if let id = params["id"]?.stringValue {
                unarchivedSessions.insert(id)
                archivedSessions.remove(id)
            }
            return .object([:])
        case "session.rename":
            if let id = params["id"]?.stringValue, let title = params["title"]?.stringValue { renamedSessions[id] = title }
            return .object([:])
        case "session.pin":
            if let id = params["id"]?.stringValue {
                pinnedSessions.removeAll { $0 == id }
                if params["pinned"]?.boolValue == true { pinnedSessions.insert(id, at: 0) }
            }
            return .object([:])
        case "session.archive":
            if let id = params["id"]?.stringValue {
                archivedSessions.insert(id)
                pinnedSessions.removeAll { $0 == id }
            }
            return .object([:])
        case "navigation.get":
            // A host whose plugin predates navigation answers nothing useful here, so the app falls back.
            guard !ProcessInfo.processInfo.arguments.contains("-dudu-review-no-navigation") else {
                throw DuduFailure.remote("UNSUPPORTED")
            }
            if let file = Self.navigationFile, let data = try? Data(contentsOf: URL(fileURLWithPath: file)) {
                return try JSONDecoder().decode(JSONValue.self, from: data)
            }
            return try JSONDecoder().decode(JSONValue.self, from: Data(ReviewNavigation.json.utf8))
        case "catalog.get":
            return .object([
                "models": try encode([
                    Choice(
                        id: "deepseek", name: Self.longNames ? "DeepSeek-V4.1-Flash" : "DeepSeek",
                        efforts: [Choice(id: "high", name: "High"), Choice(id: "max", name: "Max")],
                        defaultEffort: "high"
                    ),
                    Choice(id: "deepseek-reasoner", name: "DeepSeek · 深度思考"),
                    Choice(id: "claude:sonnet", name: "Claude Sonnet"),
                    Choice(id: "codex:gpt", name: "GPT", efforts: [Choice(id: "low", name: "Low"), Choice(id: "high", name: "High")], defaultEffort: "high")
                ]),
                "providers": try encode([
                    SessionProvider(id: "deepseek", name: "DeepSeek", modelIds: ["deepseek", "deepseek-reasoner"], defaultModelId: "deepseek", isDefault: true),
                    SessionProvider(id: "claude", name: "Claude", modelIds: ["claude:sonnet"], defaultModelId: "claude:sonnet"),
                    SessionProvider(id: "codex", name: "ChatGPT", modelIds: ["codex:gpt"], defaultModelId: "codex:gpt")
                ]),
                "permissions": try encode([
                    Choice(id: "ask", name: L10n.language == "en" ? "Full access" : "完全权限"), // the product's default (owner, 2026-11-09), and what the desktop says in Chinese: the README picture shows it
                    Choice(id: "allow", name: "自动允许"),
                    Choice(id: "danger-full-access", name: "danger-full-access")
                ]),
                "presets": try encode([
                    Choice(id: "standard", name: "标准模式", description: "处理代码、文件和资料，适合大多数任务。", isDefault: true),
                    Choice(id: "minimal", name: "极简模式", description: "使用终端和图片读取工具，适合测试基础表现。", isDefault: false),
                    Choice(id: "cordis", name: "创造模式", description: "用对话定制 DSH，让智能体编写插件。", isDefault: false)
                ])
            ])
        case "session.watch", "session.open":
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-slow-session") {
                // The conversation takes a long while to arrive: the chat shows its loading state meanwhile.
                try await Task.sleep(nanoseconds: 30_000_000_000)
            }
            selectedID = params["id"]?.stringValue ?? selectedID
            watchID = params["watchId"]?.stringValue ?? watchID
            wantsTranscript = params["transcript"]?.boolValue == true
            startStreaming(selectedID)
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-drop-session"),
               selectedID == "review-second" {
                await onDisconnect?()
            }
            return try encode(detail(selectedID, transcript: wantsTranscript))
        case "session.unwatch":
            streamingTask?.cancel()
            return .bool(true)
        case "session.create":
            newSessionCount += 1
            newSessionWorkspace = params["workspaceId"]?.stringValue ?? newSessionWorkspace
            presetID = params["agentPreset"]?.stringValue ?? "standard"
            modelID = params["modelId"]?.stringValue ?? "deepseek"
            effortID = modelID == "deepseek" || modelID == "codex:gpt" ? "high" : ""
            return try encode(sessions.first!)
        case "session.configure":
            if let model = params["modelId"]?.stringValue {
                modelID = model
                effortID = model == "deepseek" || model == "codex:gpt" ? "high" : ""
            }
            effortID = params["reasoningEffort"]?.stringValue ?? effortID
            permissionID = params["permissionId"]?.stringValue ?? permissionID
            presetID = params["agentPreset"]?.stringValue ?? presetID
            return .bool(true)
        case "session.command":
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-commands-unsupported") {
                throw DuduFailure.remote("UNSUPPORTED")
            }
            if params["command"]?.stringValue == "compact",
               ProcessInfo.processInfo.arguments.contains("-dudu-review-slow-compact") {
                compactionRunning = true
                await publishSnapshot(selectedID)
                try await Task.sleep(nanoseconds: 4_000_000_000)
                compactionRunning = false
            }
            let reply = reviewCommand(
                params["command"]?.stringValue ?? "",
                argument: params["argument"]?.stringValue ?? ""
            )
            if params["command"]?.stringValue != "plan" ||
                !ProcessInfo.processInfo.arguments.contains("-dudu-review-deferred-plan-snapshot") {
                await publishSnapshot(params["id"]?.stringValue ?? selectedID)
            }
            return reply
        case "session.stop":
            wasStopped = true
            await publishSnapshot(selectedID)
            return .bool(true)
        case "session.attachment":
            if let source = params["source"]?.stringValue {
                guard source == "/review/%E8%AE%BE%E7%BD%AE%2520screenshot.png",
                      params["seq"]?.numberValue == 2 else { throw DuduFailure.remote("NOT_FOUND") }
                if ProcessInfo.processInfo.arguments.contains("-dudu-review-slow-image") {
                    try await Task.sleep(for: .seconds(2))
                }
                let arguments = ProcessInfo.processInfo.arguments
                if let index = arguments.firstIndex(of: "-dudu-review-markdown-file"),
                   arguments.indices.contains(index + 1) {
                    let bytes = try Data(contentsOf: URL(fileURLWithPath: arguments[index + 1]))
                    return .object(["mediaType": .string("image/png"), "data": .string(bytes.base64EncodedString())])
                }
            }
            let renderer = UIGraphicsImageRenderer(size: CGSize(width: 240, height: 360))
            let image = renderer.image { context in
                UIColor(red: 0.77, green: 0.85, blue: 0.89, alpha: 1).setFill()
                context.fill(CGRect(x: 0, y: 0, width: 240, height: 360))
                UIColor(red: 0.91, green: 0.93, blue: 0.86, alpha: 1).setFill()
                context.fill(CGRect(x: 16, y: 180, width: 208, height: 164))
                UIColor.white.setFill()
                context.fill(CGRect(x: 16, y: 16, width: 208, height: 148))
            }
            return .object(["mediaType": .string("image/png"), "data": .string(image.pngData()!.base64EncodedString())])
        case "file.upload":
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-commands-unsupported") {
                throw DuduFailure.remote("UNSUPPORTED")
            }
            uploadCount += 1
            let size = params["data"]?.stringValue.map { ($0.count / 4) * 3 } ?? 0
            return .object([
                "receiptId": .string("review-receipt-\(uploadCount)"),
                "name": .string(params["name"]?.stringValue ?? "file"),
                "bytes": .number(Double(size))
            ])
        case "session.send":
            let id = params["id"]?.stringValue ?? selectedID
            let text = params["text"]?.stringValue ?? ""
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-slow-send") {
                try await Task.sleep(nanoseconds: 4_000_000_000)
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-queue"), !wasStopped {
                queues[id, default: []].append(QueuedMessage(id: "queued-phone", text: text, editable: true))
            } else {
                sentMessages[id, default: []].append(ChatMessage(id: UUID().uuidString, role: "user", text: text))
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-awaiting-first-output") {
                awaitingFirstOutputAt = Date().timeIntervalSince1970 * 1_000
                wasStopped = false
            }
            await publishSnapshot(id)
            return .bool(true)
        case "session.queue.update":
            let id = params["id"]?.stringValue ?? selectedID
            queueUpdateCount += 1
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-slow-queue-update") {
                try await Task.sleep(nanoseconds: 4_000_000_000)
            }
            if queueUpdateCount == 1,
               ProcessInfo.processInfo.arguments.contains("-dudu-review-failing-queue-update") {
                throw DuduFailure.remote("UPSTREAM_ERROR")
            }
            guard let index = queues[id]?.firstIndex(where: { $0.id == params["itemId"]?.stringValue }) else {
                throw DuduFailure.remote("NOT_FOUND")
            }
            if params["action"]?.stringValue == "edit" {
                queues[id]?[index].text = params["text"]?.stringValue ?? ""
            } else {
                let message = queues[id]!.remove(at: index)
                if params["action"]?.stringValue == "steer" {
                    sentMessages[id, default: []].append(ChatMessage(id: message.id, role: "user", text: message.text))
                }
            }
            await publishSnapshot(id)
            return .object(["queuedMessages": try encode(queues[id] ?? [])])
        case "plugins.list":
            return try encode([
                LibraryEntry(id: "dudu", name: "dudu", subtitle: "手机连接", enabled: true, detail: "已安装 · 0.3.0"),
                LibraryEntry(id: "files", name: "文件", subtitle: "项目文件与附件", enabled: true, detail: "已启用"),
                LibraryEntry(id: "terminal", name: "终端", subtitle: "命令执行", enabled: true, detail: "已启用")
            ])
        case "schedule.list":
            return try encode([
                LibraryEntry(id: "daily", name: "每日项目摘要", subtitle: "每天 09:00", enabled: true, detail: "汇总项目中的最新进展")
            ])
        case "files.list":
            let path = params["path"]?.stringValue ?? ""
            let entries: [ProjectFileEntry] = path == "src" ? [
                ProjectFileEntry(name: "ChatView.swift", path: "src/ChatView.swift", isDirectory: false, size: 180),
                ProjectFileEntry(name: "SidebarView.swift", path: "src/SidebarView.swift", isDirectory: false, size: 92)
            ] : [
                ProjectFileEntry(name: ".claude", path: ".claude", isDirectory: true, size: nil),
                ProjectFileEntry(name: ".git", path: ".git", isDirectory: true, size: nil),
                ProjectFileEntry(name: "native", path: "native", isDirectory: true, size: nil),
                ProjectFileEntry(name: "src", path: "src", isDirectory: true, size: nil),
                ProjectFileEntry(name: "README.md", path: "README.md", isDirectory: false, size: 124),
                ProjectFileEntry(name: "package.json", path: "package.json", isDirectory: false, size: 86)
            ]
            return try encode(ProjectDirectory(name: "dudu", path: path, entries: entries, truncated: false))
        case "files.read":
            let path = params["path"]?.stringValue ?? ""
            return try encode(ProjectFileContent(
                name: path.split(separator: "/").last.map(String.init) ?? "README.md",
                path: path,
                text: path.hasSuffix(".swift")
                    ? "import SwiftUI\n\nstruct ConversationView: View {\n    var body: some View {\n        Text(\"继续对话\")\n    }\n}\n"
                    : "# dudu\n\n在手机上继续电脑里的对话。\n\n- 原生界面\n- 语音输入\n- 项目文件\n",
                truncated: false
            ))
        case "web.open":
            let page = params["page"]?.stringValue ?? ""
            guard ["plugins", "trace", "context", "team", "tools", "panel", "view", "settings"].contains(page) else {
                throw DuduFailure.unsupportedRequest
            }
            let id = UUID().uuidString.lowercased()
            embeddedPages[id] = page
            let html = page == "plugins" ? hostPageReview?["html"]?.stringValue : nil
            return .object(["id": .string(id), "html": .string(html ?? Self.embeddedHTML)])
        case "web.close":
            if let id = params["id"]?.stringValue { embeddedPages[id] = nil }
            return .bool(true)
        case "web.resource":
            if let id = params["id"]?.stringValue, embeddedPages[id] == "plugins",
               params["path"]?.stringValue == "/page.js",
               let resource = hostPageReview?["resource"] {
                return resource
            }
            guard let id = params["id"]?.stringValue, embeddedPages[id] != nil,
                  params["path"]?.stringValue == "/review-page.js" else {
                throw DuduFailure.unsupportedRequest
            }
            let data = Data(Self.embeddedScript.utf8)
            return .object([
                "mimeType": .string("text/javascript; charset=utf-8"),
                "dataBase64": .string(data.base64EncodedString()),
                "totalBytes": .number(Double(data.count)),
                "eof": .bool(true)
            ])
        case "web.invoke":
            guard let id = params["id"]?.stringValue, let page = embeddedPages[id] else {
                throw DuduFailure.unsupportedRequest
            }
            if page == "plugins", params["endpoint"]?.stringValue == "pluginManager/listPlugins",
               let response = hostPageReview?["response"] {
                return response
            }
            return .object(["ok": .bool(true), "value": .string(page)])
        default:
            return .bool(true)
        }
    }

    func disconnect() async {
        streamingTask?.cancel()
        onEvent = nil
        embeddedPages.removeAll()
        await realPages.disconnect()
    }
    func disconnect(throughGeneration: Int) async { await disconnect() }

    // This document exercises WebKit's module/resource bridge without using a live pairing.
    private static let embeddedHTML = """
    <!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src dudu-ui:; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'">
    <style>
    *{box-sizing:border-box}body{margin:0;padding:20px 18px;color:#17191d;background:#fff;font:16px -apple-system,sans-serif}
    h1{font-size:19px;margin:0 0 18px}button{display:block;width:100%;min-height:48px;padding:12px 10px;text-align:left;font:inherit;color:inherit;background:white;border:0;border-bottom:1px solid #f0f1f3}
    button:active{background:#eef0f4}pre{font-size:13px;white-space:pre-wrap}p{line-height:1.6}
    </style><script type="module" src="./review-page.js"></script></head><body><main></main></body></html>
    """

    private static let embeddedScript = """
    const native = window.__DUDU_NATIVE__;
    const result = await window.__DSH_TRANSPORT__.rpc.call('/api', 'fixture.describe', {args:{}});
    if (!result.ok || result.value !== native.page.kind) throw new Error('FIXTURE_BRIDGE');
    const main = document.querySelector('main');
    const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; main.append(node); return node; };
    const button = (label, action) => { const node = text('button', label); node.onclick = action; return node; };
    const root = () => {
      main.replaceChildren();
      switch (native.page.kind) {
        case 'plugins':
          text('h1', '插件');
          button('dudu', () => { main.replaceChildren(); text('h1', 'dudu'); text('p', '手机连接'); button('返回插件', root); });
          button('文件', () => {}); button('终端', () => {});
          break;
        case 'trace': text('h1', '轨迹'); text('p', '已完成'); text('p', '检查输入栏与导航'); break;
        case 'context': text('h1', '上下文'); text('p', '当前项目'); text('p', 'dudu'); break;
        case 'team': text('h1', '编队'); text('p', '暂无编队'); break;
        case 'tools':
          text('h1', '文件');
          button('src', () => {
            main.replaceChildren(); text('h1', 'src');
            button('上一级', root);
            button('ChatView.swift', () => {
              main.replaceChildren(); text('h1', 'ChatView.swift');
              text('pre', 'import SwiftUI\\n\\nstruct ConversationView: View {\\n    var body: some View { Text("继续对话") }\\n}');
              button('返回文件', root);
            });
          });
          button('README.md', () => {}); break;
      }
    };
    root();
    await native.ready();
    """

    private var reviewWorkspaces: [WorkspaceSummary] {
        var list = [
            WorkspaceSummary(id: "mobile", name: Self.longNames ? "harness-mobile" : "dudu", path: "/work/dudu"),
            WorkspaceSummary(id: "notes", name: "日常", path: "/work/notes"),
        ]
        if Self.richSidebar { list.append(WorkspaceSummary(id: "docs", name: "文档", path: "/work/docs")) }
        return list
            .filter { !deletedWorkspaces.contains($0.id) }
            .map { WorkspaceSummary(id: $0.id, name: renamedWorkspaces[$0.id] ?? $0.name, path: $0.path) }
    }

    private var sessions: [SessionSummary] {
        let isRunning = (ProcessInfo.processInfo.arguments.contains("-dudu-review-running")
            || awaitingFirstOutputAt != nil) && !wasStopped
        var values = [
            SessionSummary(id: "review-chat", title: "优化手机上的对话体验", workspaceId: "mobile", workspaceName: "dudu", updatedAt: now, status: isRunning ? "running" : "idle"),
            SessionSummary(id: "review-second", title: "检查连接与配对", workspaceId: "mobile", workspaceName: "dudu", updatedAt: now - 18 * 60_000, status: "idle"),
            SessionSummary(id: "review-notes", title: "整理本周的项目进展", workspaceId: "notes", workspaceName: "日常", updatedAt: now - 41 * 60_000, status: "idle"),
            SessionSummary(id: "review-fourth", title: "接口设计与实现", workspaceId: "mobile", workspaceName: "dudu", updatedAt: now - 2 * 3_600_000, status: "idle"),
            SessionSummary(id: "review-fifth", title: "阅读资料与工作记录", workspaceId: "notes", workspaceName: "日常", updatedAt: now - 4 * 3_600_000, status: "idle")
        ]
        if newSessionCount > 0 {
            let workspaceName = newSessionWorkspace == "notes" ? "日常" : "dudu"
            // A conversation nobody has written in yet: the host flags it so the sidebar can hide it.
            values.insert(SessionSummary(id: "review-new-\(newSessionCount)", title: "新会话", workspaceId: newSessionWorkspace, workspaceName: workspaceName, updatedAt: now + Double(newSessionCount), status: "idle", blank: true), at: 0)
        }
        if Self.richSidebar {
            values[3].pinned = true
            values[3].pinRank = 0
            values.append(SessionSummary(id: "review-archived", title: "旧的调研记录", workspaceId: "notes", workspaceName: "日常", updatedAt: now - 30 * 3_600_000, status: "idle", archived: !unarchivedSessions.contains("review-archived")))
            values.append(SessionSummary(id: "review-blank-a", title: "新对话", workspaceId: "mobile", workspaceName: "dudu", updatedAt: now - 3_600_000, status: "idle", blank: true))
            values.append(SessionSummary(id: "review-blank-b", title: "新对话", workspaceId: "notes", workspaceName: "日常", updatedAt: now - 3_600_000, status: "idle", blank: true))
            values.append(SessionSummary(id: "review-docs", title: "文档整理", workspaceId: "docs", workspaceName: "文档", updatedAt: now - 5 * 3_600_000, status: "idle"))
        }
        if ProcessInfo.processInfo.arguments.contains("-dudu-review-many-sessions") {
            // A list long enough to scroll under the sidebar's footer.
            for index in 1...24 {
                let inMobile = index.isMultiple(of: 2)
                values.append(SessionSummary(
                    id: "review-many-\(index)", title: "示例会话 \(index)",
                    workspaceId: inMobile ? "mobile" : "notes", workspaceName: inMobile ? "dudu" : "日常",
                    updatedAt: now - Double(index) * 50 * 60_000, status: "idle"
                ))
            }
        }
        // A deleted workspace leaves its conversations loose, as DSH does.
        values = values.map { session in
            guard let id = session.workspaceId, deletedWorkspaces.contains(id) else { return session }
            var loose = session
            loose.workspaceId = nil
            loose.workspaceName = nil
            return loose
        }
        if ProcessInfo.processInfo.arguments.contains("-dudu-review-long-history") {
            values.insert(SessionSummary(id: "review-long", title: "长对话与排版检查", workspaceId: "mobile", workspaceName: "dudu", updatedAt: now + 1, status: "idle"), at: 0)
        }
        if Self.quickCardsFile != nil {
            // The plugin's fixed conversation: the plugin says so (`isAssistant`), the app never guesses it from the title.
            var assistant = SessionSummary(id: "review-assistant", title: "嘟嘟", workspaceId: "mobile", workspaceName: "dudu", updatedAt: now + 3, status: "idle")
            assistant.isAssistant = true
            values.insert(assistant, at: 0)
        }
        if ProcessInfo.processInfo.arguments.contains("-dudu-review-paged-history") {
            values.insert(SessionSummary(id: "review-paged", title: "分页历史", workspaceId: "mobile", workspaceName: "dudu", updatedAt: now + 4, status: "idle"), at: 0)
        }
        if ProcessInfo.processInfo.arguments.contains("-dudu-review-heavy-history") {
            values.insert(SessionSummary(id: "review-heavy", title: "很长的对话", workspaceId: "mobile", workspaceName: "dudu", updatedAt: now + 2, status: "idle"), at: 0)
        }
        // What the conversation menu changed.
        return values.map { session in
            var changed = session
            let agent: SessionAgent = session.id == "review-second" ? .claude : session.id == "review-notes" ? .codex : .deepseek
            changed.agent = session.id.hasPrefix("review-new-") ? (modelID.hasPrefix("claude:") ? .claude : modelID.hasPrefix("codex:") ? .codex : .deepseek) : agent
            changed.sessionState = session.status == "running" ? .processing
                : session.id == "review-second" || session.id == "review-notes" ? .unread : .idle
            if let title = renamedSessions[session.id] { changed.title = title }
            if let rank = pinnedSessions.firstIndex(of: session.id) {
                changed.pinned = true
                changed.pinRank = rank
            }
            if archivedSessions.contains(session.id) {
                changed.archived = true
                changed.pinned = nil
                changed.pinRank = nil
            }
            return changed
        }
    }

    private func detail(_ id: String, transcript wantsTranscript: Bool = false) -> SessionDetail {
        if let replayDetail, replayDetail.session.id == id { return replayDetail }
        let session = sessions.first { $0.id == id } ?? sessions[0]
        let messages: [ChatMessage]
        if id == "review-long" {
            let indices = ProcessInfo.processInfo.arguments.contains("-dudu-review-shortened-history") ? 56..<59 : 0..<59
            messages = indices.map { index in
                ChatMessage(
                    id: "review-long-\(index)", role: index.isMultiple(of: 2) ? "user" : "assistant",
                    text: index.isMultiple(of: 2)
                        ? "第 \(index + 1) 条记录：检查对话中的输入与滚动。"
                        : "这是一段较长的会话内容。\n\n**交互检查**\n\n保持输入区的位置，滚动历史时保留阅读位置。\n\n- 支持键盘输入\n- 支持长按说话\n- 支持查看项目文件\n",
                    status: "complete"
                )
            } + [
                ChatMessage(
                    id: "review-markdown", role: "assistant",
                    text: "## 排版检查\n\n这是独立的段落，包含 **加粗**、*斜体* 和 `行内代码`。\n\n1. 第一项\n2. 第二项\n\n```swift\nlet message = \"继续对话\"\nprint(message)\n```\n\n| 功能 | 状态 |\n| --- | --- |\n| 对话 | 正常 |\n| 输入 | 正常 |\n\n> 阅读较早的消息时，保留当前位置。\n\n长对话检查完成。",
                    status: "complete"
                )
            ]
        } else if id == "review-heavy" {
            // Rows of wildly different heights, as a real conversation with command output and tables has.
            let count = ProcessInfo.processInfo.arguments.contains("-dudu-review-heavy-cache-prefix") ? 10 : 80
            messages = (0..<count).map { index in
                let isUser = index.isMultiple(of: 2)
                return ChatMessage(
                    id: "review-heavy-\(index)", role: isUser ? "user" : "assistant",
                    text: isUser ? "第 \(index / 2 + 1) 个问题" : Self.heavyAnswer(index / 2),
                    status: "complete"
                )
            }
        } else if id == "review-chat" {
            messages = ProcessInfo.processInfo.arguments.contains("-dudu-review-markdown-image") ? [
                ChatMessage(id: "review-question", role: "user", text: "用 markdown 格式发图片给我看看"),
                ChatMessage(id: "review-answer", role: "assistant",
                            text: "供应商页：\n\n![图片](/review/设置%20screenshot.png)\n\n图片后面的消息。",
                            process: nil)
            ] : [
                ChatMessage(id: "review-question", role: "user", text: "把手机上的交互整理一下，保留现在的布局。"),
                ChatMessage(id: "review-answer", role: "assistant", text: "我会按这几个地方逐项检查：\n\n**输入与发送**\n\n照片入口保持在左侧，键盘和更多选项放在右侧。长按说话，松开发送，上移取消。\n\n**会话与导航**\n\n最近会话按活跃时间排列，也可以按项目分组。弹层支持点空白区域或再次点入口关闭。\n\n**连接与设置**\n\n电脑可以随时切换，设置入口集中在侧栏底部。",
                    process: ProcessInfo.processInfo.arguments.contains("-dudu-review-process")
                        ? "Earlier assistant progress stays available here." : nil)
            ]
        } else if id.hasPrefix("review-new") {
            messages = []
        } else {
            messages = [ChatMessage(id: "review-content-\(id)", role: "assistant", text: "这是“\(session.title)”的会话内容。")]
        }
        let all = messages + (sentMessages[id] ?? [])
        let arguments = ProcessInfo.processInfo.arguments
        let transcript = wantsTranscript ? reviewTranscript(id, messages: all) : nil
        let homeReviewPosition = Self.reviewArgument("-dudu-review-home-url") == nil ? nil
            : SessionReadPosition(seq: Int(transcript?.entries.compactMap(\.seq).max() ?? -1))
        return SessionDetail(
            session: session, messages: wantsTranscript ? [] : all,
            modelId: modelID, permissionId: permissionID,
            context: [LibraryEntry(id: "project", name: "当前项目", subtitle: "dudu", detail: "手机界面与交互")],
            trace: [LibraryEntry(id: "step", name: "已完成", subtitle: "界面检查", detail: "检查输入栏与导航")],
            team: [],
            approvals: arguments.contains("-dudu-review-plan-review") && id == "review-chat" ? [
                Approval(
                    id: "review-plan", sessionId: id,
                    title: "无操作测试目标 — 执行计划（Plan Mode 验证）",
                    detail: "当前会话的持久目标是「测试目标不需要任何操作」（active，round 1/256）。用户切入 plan mode 并输入「测试计划」。\n\n本计划针对该无操作测试目标本身：不修改仓库、不运行命令，只确认流程可以走通。\n\n## 步骤\n\n1. 读取当前目标\n2. 汇报结论"
                )
            ] : [],
            transcript: transcript,
            goal: goal.map { SessionGoal(id: "review-goal", phase: $0.phase, objective: $0.objective) },
            // `-dudu-review-tasks`: a task list like the one DSH shows above its composer.
            todos: reviewTodos(id, arguments: arguments),
            queuedMessages: arguments.contains("-dudu-review-queue-image") && id == "review-chat"
                ? [QueuedMessage(id: "parity-queue", text: "检查这张图片", editable: false,
                                 attachments: [TranscriptAttachment(kind: "image", name: "排队图片", id: "queue:parity:0")])]
                : queues[id] ?? [],
            questions: arguments.contains("-dudu-review-questions") && id == "review-chat" && !answeredParityQuestions
                ? [ConversationParityFixture.questions] : [],
            planMode: planMode,
            reasoningEffort: effortID.isEmpty ? nil : effortID,
            agentPreset: presetID,
            readPosition: homeReviewPosition
        )
    }

    private func reviewTodos(_ id: String, arguments: [String]) -> [TodoItem]? {
        guard arguments.contains("-dudu-review-tasks"), id == "review-chat" || id == "review-long" else { return nil }
        let items = [
            TodoItem(content: "梳理现有页面的结构", status: "completed"),
            TodoItem(content: "调整侧栏列表的对齐", status: "in_progress"),
            TodoItem(content: "补充任务清单的显示", status: "pending"),
            TodoItem(content: "整理测试并检查布局", status: "pending")
        ]
        guard arguments.contains("-dudu-review-many-tasks") else { return items }
        return items + (5...20).map { TodoItem(content: "检查第 \($0) 项任务", status: "pending") }
    }

    /// `-dudu-review-paged-history`: 150 turns of very different heights served five at a time from the end (the latest page when `before` is nil),
    /// so that reading upward loads older pages again and again, as the log of the owner's phone showed (2026-11-16).
    private static let pagedTurnCount = 150
    private static func pagedTranscript(before: Double?) -> Transcript {
        let last = before.map { Int($0 / 2) - 1 } ?? pagedTurnCount
        let first = max(1, last - (before == nil ? 3 : 4))
        let day = Date().timeIntervalSince1970 * 1_000
        var entries: [TranscriptEntry] = []
        var turns: [TranscriptTurn] = []
        for index in first...max(first, last) where index <= last {
            let sequence = Double(index * 2)
            let start = day - Double(pagedTurnCount - index) * 120_000
            entries.append(TranscriptEntry(type: "user", id: "paged-user-\(index)", seq: sequence, time: start, text: "第 \(index) 个问题"))
            entries.append(TranscriptEntry(type: "assistant", id: "paged-answer-\(index)", seq: sequence + 1, time: start + 20_000, text: heavyAnswer(index), turn: index, step: 1))
            turns.append(TranscriptTurn(turn: index, start: start, end: start + 20_000, outcome: "done", lastSeq: sequence + 1))
        }
        return Transcript(entries: entries, turns: turns, live: nil, beforeSeq: Double(first * 2), throughSeq: Double(pagedTurnCount * 2 + 1), hasMore: first > 1)
    }

    private static func heavyAnswer(_ index: Int) -> String {
        switch index % 7 {
        case 0:
            return "好的。"
        case 1:
            return "命令的输出如下：\n\n```\n" + (1...140).map { "line \($0): the quick brown fox jumps over the lazy dog" }.joined(separator: "\n") + "\n```\n\n以上。"
        case 2:
            return "对照表：\n\n| 名称 | 数值 |\n| --- | --- |\n" + (1...45).map { "| 项目 \($0) | \($0 * 7) |" }.joined(separator: "\n")
        case 3:
            return (1...36).map { "- 第 \($0) 项：保持输入区的位置，滚动历史时保留阅读位置。" }.joined(separator: "\n")
        case 4:
            return "收到，继续。\n\n再确认一次。"
        case 5:
            return "```swift\n" + (1...260).map { "let value\($0) = compute(\($0)) // step \($0)" }.joined(separator: "\n") + "\n```"
        default:
            return (1...9).map { "第 \($0) 段：这是一段较长的说明文字，用来让这一条回复占据好几屏的高度，并且和相邻的短回复形成很大的差别。" }.joined(separator: "\n\n")
        }
    }

    /// The legacy review messages as transcript entries, plus a richer history behind `-dudu-review-rich`.
    private func reviewTranscript(_ id: String, messages: [ChatMessage]) -> Transcript {
        let arguments = ProcessInfo.processInfo.arguments
        if id == "review-paged" { return Self.pagedTranscript(before: nil) }
        if id == "review-assistant" {
            let initial = arguments.firstIndex(of: "-dudu-review-quick-cards-initial")
                .flatMap { $0 + 1 < arguments.count ? Int(arguments[$0 + 1]) : nil } ?? 0
            let entries = [
                TranscriptEntry(type: "user", id: "assistant-user-1", seq: 1, time: now - 3_600_000, text: L10n.language == "en" ? "What needs my attention today?" : "今天有什么要处理的？"),
                TranscriptEntry(type: "assistant", id: "assistant-a1", seq: 2, time: now - 3_590_000, text: L10n.language == "en" ? "Let me look at the todos first." : "先看一眼待办吧。", turn: 1, step: 1),
            ] + Array(quickCardEntries.prefix(initial)) + tappedCards
            return Transcript(entries: entries, turns: [TranscriptTurn(turn: 1, start: now - 3_595_000, end: now - 3_590_000, outcome: "done")], live: nil)
        }
        if id == "review-chat", arguments.contains("-dudu-review-partial-history") {
            // A paged tail may start inside a tall interrupted turn, followed by two short rows.
            let progress = (0..<60).flatMap { index in
                [
                    TranscriptEntry(
                        type: "assistant", id: "partial-tool-\(index)", seq: Double(index * 2 + 100),
                        text: nil, turn: 130, step: index + 1,
                        calls: [TranscriptCall(
                            id: "partial-call-\(index)", name: "shell", activity: "commands",
                            detail: "Check the current build and its runtime", status: "done"
                        )]
                    ),
                    TranscriptEntry(
                        type: "assistant", id: "partial-progress-\(index)", seq: Double(index * 2 + 101),
                        text: "检查第 \(index + 1) 项的结果。", turn: 130, step: index + 1
                    )
                ]
            }
            return Transcript(entries: progress + [
                TranscriptEntry(type: "user", id: "partial-user", seq: 300, text: "重启好了，你看看吧"),
                TranscriptEntry(
                    type: "assistant", id: "partial-answer", seq: 301,
                    text: "看过了，这次重启已经生效，插件正常加载了。", turn: 131, step: 1
                )
            ], turns: [
                TranscriptTurn(turn: 130, end: now - 60_000, outcome: "interrupted"),
                TranscriptTurn(turn: 131, start: now - 30_000, end: now, outcome: "done")
            ], live: nil)
        }
        if id == "review-chat", arguments.contains("-dudu-review-parity") {
            return ConversationParityFixture.transcript
        }
        if id == "review-chat", arguments.contains("-dudu-review-interleaved") {
            let running = arguments.contains("-dudu-review-running") && !wasStopped
            return Transcript(entries: [
                TranscriptEntry(type: "user", id: "interleaved-question", seq: 1, time: now - 60_000, text: "这是什么问题？"),
                TranscriptEntry(type: "assistant", id: "interleaved-before", seq: 3, time: now - 50_000,
                                text: "先检查日志。", turn: 1, step: 1),
                TranscriptEntry(type: "user", id: "interleaved-follow-up", seq: 5, time: now - 40_000,
                                text: "这个气泡是什么，也无法关闭？",
                                attachments: [TranscriptAttachment(kind: "image", name: "测试图片", id: "review-image")]),
                TranscriptEntry(type: "assistant", id: "interleaved-after", seq: 7, time: now - 30_000,
                                text: "我会修复附件传话和气泡关闭。", turn: 1, step: 2)
            ], turns: [TranscriptTurn(
                turn: 1, start: now - 59_000, end: running ? nil : now - 20_000, outcome: running ? nil : "done"
            )], live: nil)
        }
        if id == "review-chat", arguments.contains("-dudu-review-message-actions") {
            let first = now - 900_000
            let second = first + 320_000
            let third = second + 60_000
            return Transcript(entries: [
                TranscriptEntry(type: "user", id: "review-menu-question", seq: 1, time: first,
                                text: "测试复制和选择，保留换行。\n这是第二行。"),
                TranscriptEntry(type: "assistant", id: "review-menu-answer", seq: 2, time: first + 20_000,
                                text: "支持 **复制** 和选择文字。\n\n- 保留换行\n- 保留代码 `value`", turn: 1, step: 1),
                TranscriptEntry(type: "user", id: "review-menu-question-2", seq: 3, time: second, text: "继续。"),
                TranscriptEntry(type: "assistant", id: "review-menu-answer-2", seq: 4, time: second + 10_000,
                                text: "第二轮回复。", turn: 2, step: 1),
                TranscriptEntry(type: "user", id: "review-menu-question-3", seq: 5, time: third, text: "再继续。"),
                TranscriptEntry(type: "assistant", id: "review-menu-answer-3", seq: 6, time: third + 10_000,
                                text: "连续交流共用时间。", turn: 3, step: 1)
            ], turns: [
                TranscriptTurn(turn: 1, start: first + 1_000, end: first + 20_000, outcome: "done"),
                TranscriptTurn(turn: 2, start: second + 1_000, end: second + 10_000, outcome: "done"),
                TranscriptTurn(turn: 3, start: third + 1_000, end: third + 10_000, outcome: "done")
            ], live: nil)
        }
        var entries: [TranscriptEntry] = []
        var turns: [TranscriptTurn] = []
        var turn = 0
        var seq = 0.0
        func nextSeq() -> Double { seq += 1; return seq }
        let clockBase = now - 90_000

        for message in messages {
            if message.role == "user" {
                entries.append(TranscriptEntry(
                    type: "user", id: message.id, seq: nextSeq(),
                    time: message.id == "review-question" ? clockBase : now, text: message.text,
                    attachments: arguments.contains("-dudu-review-chat-image") && message.id == "review-question"
                        ? [TranscriptAttachment(kind: "image", name: "测试图片", id: "review-image")] : nil
                ))
            } else {
                turn += 1
                if let process = message.process {
                    entries.append(TranscriptEntry(
                        type: "assistant", id: "\(message.id)-process", seq: nextSeq(), time: clockBase + 8_000,
                        reasoning: process, turn: turn, step: 1
                    ))
                }
                entries.append(TranscriptEntry(
                    type: "assistant", id: message.id, seq: nextSeq(), time: clockBase + 14_000,
                    text: message.text, turn: turn, step: message.process == nil ? 1 : 2
                ))
                turns.append(TranscriptTurn(turn: turn, start: clockBase + 500, end: clockBase + 14_000, outcome: "done"))
            }
        }
        /// What `/compact` leaves behind on the desktop: a command row with the compaction summary.
        func compactionEntries() -> [TranscriptEntry] {
            let completed = (0..<compactionCount).map { index in
                TranscriptEntry(
                    type: "command", id: "command:review-compact-\(index)", seq: 1_000 + Double(index), time: now,
                    commandId: "review-compact-\(index)", name: "compact", outcome: "success",
                    summary: "Compacted 14 history items (~3200 tokens).",
                    compaction: TranscriptCompaction(
                        items: 14, tokens: 3_200,
                        summary: "## 对话摘要\n\n- 目标：整理手机端的输入区、侧栏和设置入口。\n- 已确认：照片入口放在左侧，语音和键盘切换放在右侧。\n\n**接下来**：继续检查长对话的滚动位置。"
                    )
                )
            }
            return completed + (compactionRunning ? [TranscriptEntry(
                type: "command", id: "command:review-compact-running", seq: 2_000, time: now,
                commandId: "review-compact-running", name: "compact"
            )] : [])
        }
        guard id == "review-chat", arguments.contains("-dudu-review-rich") else {
            if id == "review-chat", let awaitingFirstOutputAt {
                turns.append(TranscriptTurn(
                    turn: turn + 1, start: awaitingFirstOutputAt,
                    end: wasStopped ? awaitingFirstOutputAt + 1_000 : nil,
                    outcome: wasStopped ? "stopped" : nil
                ))
            }
            return Transcript(entries: entries + compactionEntries(), turns: turns, live: nil)
        }

        func call(_ id: String, _ name: String, _ detail: String, _ activity: String = "commands", status: String = "done") -> TranscriptCall {
            TranscriptCall(id: id, name: name, activity: activity, detail: detail, status: status)
        }
        let day = now - 26 * 3_600_000
        entries = [
            TranscriptEntry(type: "user", id: "rich-user-1", seq: 1, time: day, text: "谁占用的内存。"),
            TranscriptEntry(
                type: "assistant", id: "rich-a1", seq: 2, time: day + 8_000,
                reasoning: "The user asks: \"谁占用的内存。\" — who's using the memory. They want a precise breakdown/ranking, probably more precise than my aggregate.\n\nLet me check the top processes first.",
                turn: 1, step: 1,
                calls: [
                    call("c1", "bash", "List top memory processes"),
                    call("c2", "bash", "Break down physical memory composition")
                ]
            ),
            TranscriptEntry(
                type: "assistant", id: "rich-a2", seq: 3, time: day + 20_000,
                reasoning: "Interesting: total RSS 7.7GB but vm_stat shows active 2.45 + inactive 2.22 + wired 3.84 + compressor 6.48 + free 0.2 = 15.2GB.",
                turn: 1, step: 2,
                calls: [
                    call("c3", "bash", "Categorize memory usage by owner"),
                    call("c4", "bash", "Show top individual processes by memory and CPU")
                ]
            ),
            TranscriptEntry(
                type: "assistant", id: "rich-a3", seq: 4, time: day + 31_000,
                reasoning: "The measurements are fluctuating a lot (system is churning). Numbers differ between calls:",
                turn: 1, step: 3,
                calls: [call("c5", "bash", "Take one consistent memory sample"), call("c6", "read", "/tmp/vm_stat.txt", "read", status: "error")]
            ),
            TranscriptEntry(
                type: "assistant", id: "rich-a4", seq: 5, time: day + 45_000,
                text: "这是 19:31:39 的一次统一采样，按占用从大到小列出来：\n\n| 排名 | 占用者 | 内存 | 进程数 |\n| --- | --- | --- | --- |\n| 1 | Docker 虚拟机 | 1.57GB | 5 |\n| 2 | claude agent 会话 | 1.2GB | 25 |\n| 3 | Notion | 696MB | 14 |\n\n要我把 Docker 和那些僵尸 claude 会话清掉吗？清理前我会先列清单给你确认。",
                turn: 1, step: 4, usage: 1_300_000
            ),
            TranscriptEntry(
                type: "command", id: "command:rich-compact", seq: 6, time: day + 90_000,
                commandId: "rich-compact", name: "compact", outcome: "success",
                summary: "Compacted 348 history items (~192127 tokens).",
                compaction: TranscriptCompaction(
                    items: 348, tokens: 192_127,
                    summary: "## 会话摘要\n\n- 用户在排查电脑的内存占用：Docker 虚拟机约 1.57GB，claude agent 会话约 1.2GB，Notion 约 696MB。\n- 已按占用从大到小列出，并询问是否清理 Docker 与僵尸会话。\n\n**待办**：清理前先列清单，等用户确认。"
                )
            ),
            TranscriptEntry(type: "user", id: "rich-user-2", seq: 7, time: now - 20 * 60_000, text: "这些方案你能在你电脑上测试吗?")
        ]
        turns = [TranscriptTurn(turn: 1, start: day + 1_000, end: day + 45_000, outcome: "done")]
        if arguments.contains("-dudu-review-streaming-fast") {
            let history = (1...30).flatMap { index -> [TranscriptEntry] in
                let sequence = Double(-200 + index * 2)
                let start = day - Double(31 - index) * 120_000
                return [
                    TranscriptEntry(type: "user", id: "stress-user-\(index)", seq: sequence,
                                    time: start, text: "检查第 \(index) 轮长对话。"),
                    TranscriptEntry(type: "assistant", id: "stress-answer-\(index)", seq: sequence + 1,
                                    time: start + 20_000,
                                    text: Self.heavyAnswer(index), turn: index + 2, step: 1)
                ]
            }
            entries.insert(contentsOf: history, at: 0)
            turns.insert(contentsOf: (1...30).map { index in
                TranscriptTurn(turn: index + 2, start: day - Double(31 - index) * 120_000,
                               end: day - Double(31 - index) * 120_000 + 20_000, outcome: "done")
            }, at: 0)
        }
        var live: TranscriptLive?
        if arguments.contains("-dudu-review-running"), !wasStopped,
           !arguments.contains("-dudu-review-awaiting-reply") {
            entries.append(TranscriptEntry(
                type: "trigger", id: "rich-goal-trigger", seq: 8, time: now - 6 * 60_000,
                text: "Continue working toward the goal. Check progress against the objective, then run the next step.",
                source: "goal"
            ))
            entries.append(TranscriptEntry(
                type: "assistant", id: "rich-a5", seq: 9, time: now - 4 * 60_000,
                reasoning: "Need to update the transport test for JSON retry and run the full suite.",
                turn: 2, step: 1,
                calls: [call("c7", "edit", "src/transport.ts", "edit"), call("c8", "bash", "Run the full test suite")]
            ))
            let liveTurn = arguments.contains("-dudu-review-streaming-fast") ? 33 : 2
            if liveTurn != 2, let index = entries.firstIndex(where: { $0.id == "rich-a5" }) {
                entries[index].turn = liveTurn
            }
            turns.append(TranscriptTurn(turn: liveTurn, start: now - 313_000, end: nil, outcome: nil))
            live = TranscriptLive(
                id: "live:rich",
                text: arguments.contains("-dudu-review-streaming-fast")
                    ? String(Self.fastStreamText.prefix(streamedParagraphs * 6))
                    : streamedParagraphs == 0 ? nil : (1...streamedParagraphs).map {
                        "流式输出第 \($0) 段：持续补充回答，检查滚动位置。"
                    }.joined(separator: "\n\n"),
                reasoning: "Check results.\n\nThe suite is still running.",
                calls: [call("c9", "bash", "Update transport test for JSON retry and run full", status: "running")]
            )
        }
        return Transcript(entries: entries + compactionEntries(), turns: turns, live: live)
    }

    /// What the plugin does for `tasks.*`, on the tasks of the file: a list, the options, a new task, a change of one (its revision must be the one the phone has), a pause or a resume, a run now, a copy, a delete and the deliveries.
    private func reviewTasksRequest(_ method: String, _ params: [String: JSONValue]) throws -> JSONValue {
        guard let file = reviewTasksData else { throw DuduFailure.remote("UNSUPPORTED") }
        var items = reviewTasks ?? file.tasks
        if reviewRuns.isEmpty { reviewRuns = file.history }
        defer { reviewTasks = items }
        func ok(_ extra: [String: JSONValue] = [:]) -> JSONValue {
            .object(["outcome": .string("success")].merging(extra) { _, new in new })
        }
        func failed(_ code: String) -> JSONValue { .object(["outcome": .string("error"), "code": .string(code)]) }
        switch method {
        case "tasks.list":
            return ok(["tasks": try encode(items)])
        case "tasks.options":
            guard case var .object(options) = file.options else { return failed("unavailable") }
            if params["includeSessions"]?.boolValue == true { options["sessions"] = file.sessions }
            return .object(options)
        case "tasks.history":
            return ok(["runs": .array(reviewRuns[params["id"]?.stringValue ?? ""] ?? []), "nextCursor": .null])
        case "tasks.create":
            guard let value = params["fields"],
                  let fields = try? JSONDecoder().decode(ReviewTaskFields.self, from: JSONEncoder().encode(value)) else { return failed("invalid_task") }
            let task = ScheduledTask(
                id: UUID().uuidString, revision: 1, status: "active", title: fields.title, prompt: fields.prompt, agent: fields.agent, model: fields.model,
                project: fields.project, target: fields.target, schedule: fields.schedule, nextRunAt: now + 3_600_000
            )
            items.insert(task, at: 0)
            return ok(["task": try encode(task)])
        default:
            break
        }
        guard let id = params["id"]?.stringValue, let index = items.firstIndex(where: { $0.id == id }) else { return failed("not_found") }
        guard params["revision"].flatMap({ $0.numberValue }).map({ Int($0) }) == items[index].revision else { return failed("conflict") }
        switch method {
        case "tasks.update":
            guard let value = params["patch"],
                  let fields = try? JSONDecoder().decode(ReviewTaskFields.self, from: JSONEncoder().encode(value)) else { return failed("invalid_task") }
            if items[index].status == "ended", fields.schedule != items[index].schedule { items[index].status = "paused" }
            items[index].title = fields.title
            items[index].prompt = fields.prompt
            items[index].agent = fields.agent
            items[index].model = fields.model
            items[index].project = fields.project
            items[index].target = fields.target
            items[index].schedule = fields.schedule
            items[index].revision += 1
            return ok(["task": try encode(items[index])])
        case "tasks.pause", "tasks.resume":
            items[index].status = method == "tasks.pause" ? "paused" : "active"
            if method == "tasks.resume" { items[index].nextRunAt = now + 3_600_000 }
            items[index].revision += 1
            return ok(["task": try encode(items[index])])
        case "tasks.run":
            let run: JSONValue = .object([
                "id": .string(UUID().uuidString), "seq": .number(Double(100 + (reviewRuns[id]?.count ?? 0))), "at": .number(now), "manual": .bool(true),
                "status": .string("delivered"), "sessionId": .string("review-second"),
            ])
            reviewRuns[id, default: []].insert(run, at: 0)
            items[index].lastRun = TaskLastRun(id: UUID().uuidString, at: now, status: "delivered")
            return ok(["run": run, "task": try encode(items[index]), "pending": .bool(true)])
        case "tasks.delete":
            let removed = items.remove(at: index)
            return ok(["id": .string(removed.id), "title": .string(removed.title)])
        default:
            throw DuduFailure.remote("UNSUPPORTED")
        }
    }

    private func encode<T: Encodable>(_ value: T) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(value))
    }
}
#endif
