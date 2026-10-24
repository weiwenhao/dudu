import Combine
import Foundation

private struct CatalogResult: Decodable, Sendable {
    var models: [Choice]
    var permissions: [Choice]
    /// Agent presets ("modes"); desktops that predate them send none.
    var presets: [Choice]?
}

@MainActor
final class DSBotStore: ObservableObject {
    @Published var computers: [Computer] = []
    @Published var activeComputer: Computer?
    @Published var sessions: [SessionSummary] = []
    @Published var selectedSession: SessionSummary?
    @Published var messages: [ChatMessage] = []
    /// Structured chat from a transcript-capable desktop plugin; nil means render `messages`.
    @Published var transcript: Transcript?
    @Published var goal: SessionGoal?
    /// The conversation's task list (DSH's "任务" panel); empty when it has none.
    @Published var todos: [TodoItem] = []
    @Published private(set) var queuedMessages: [QueuedMessage] = []
    @Published private(set) var updatingQueueItemID: String?
    private var queueRevision = 0
    @Published private(set) var questions: [ConversationQuestions] = []
    @Published private(set) var historyLoadTarget: DraftTarget?
    private var historyLoadID: UUID?
    private var answeredQuestionIDs: Set<String> = []
    @Published var planMode = false
    /// `transcript` folded into display rows; rebuilt only when its inputs change.
    @Published private(set) var transcriptRows: [TranscriptRow] = []
    private(set) var transcriptTimeSeparators: [String: Double] = [:]
    /// Bumps whenever the visible conversation changes so views can follow the latest content.
    @Published private(set) var contentRevision = 0
    private let conversationProjector = ConversationProjector()
    private var transcriptRevision = 0
    private var detailApplicationRevision = 0
    private var lastConversationMetricsAt = -Double.greatestFiniteMagnitude
    @Published var workspaces: [WorkspaceSummary] = []
    @Published var plugins: [LibraryEntry] = []
    @Published var schedules: [LibraryEntry] = []
    @Published var models: [Choice] = []
    @Published var permissions: [Choice] = []
    /// Agent presets DSH calls modes (标准模式, 创造模式, …).
    @Published var presets: [Choice] = []
    @Published var selectedModelId: String?
    @Published var selectedEffort: String?
    @Published var selectedPermissionId: String?
    @Published var selectedPresetId: String?
    /// DSH's new-task home: no conversation is open until a workspace is chosen.
    @Published private(set) var isChoosingWorkspace = false
    /// What DSH shows in its sidebar, conversation tabs and settings (see `Navigation.swift`).
    @Published private(set) var navigation = NavigationCatalog.empty
    @Published private(set) var navigationAvailability = NavigationAvailability.unknown
    @Published var context: [LibraryEntry] = []
    @Published var trace: [LibraryEntry] = []
    @Published var team: [LibraryEntry] = []
    @Published var approvals: [Approval] = []
    @Published var isRespondingApprovals: Set<String> = []
    @Published var status: ConnectionStatus = .disconnected
    @Published var isLoading = false
    @Published private(set) var isLoadingSessions = false
    @Published private(set) var sessionsError: String?
    @Published private(set) var isLoadingCatalog = false
    @Published private(set) var catalogError: String?
    @Published private(set) var isLoadingSession = false
    @Published private(set) var loadingLibrarySections: Set<String> = []
    @Published private(set) var libraryErrors: [String: String] = [:]
    @Published var isRestoring = true
    // Background suspension and reconnect attempts keep the current screen until failure is confirmed.
    @Published private(set) var showsConnectionGuide = false
    @Published var isSending = false
    @Published private(set) var isStoppingSession = false
    @Published private(set) var isChangingPlanMode = false
    @Published var error: String?
    @Published var notice: String?
    @Published private(set) var connectionFailure: DSBotFailure?
    var messageDrafts: [DraftTarget: String] = [:] {
        didSet { scheduleConversationSave() }
    }
    var connectionRevision: Int { generation }

    private let repository: any DSBotComputerStorage
    private let client: any DSBotTransport
    private let conversationStorage: any DSBotConversationStorage
    private let conversationImages = ConversationImageCache()
    private var conversationComputerID: String?
    private var conversationSaveTask: Task<Void, Never>?
    private var conversationWriteTask: Task<Void, Never>?
    private var isApplyingConversationCache = false
    private var unavailableSessionID: String?
    private let json = DSBotJSON()
    private var generation = 0
    private var sessionSelectionGeneration = 0
    private var loadingTokens: Set<UUID> = []
    private var operationHeld = false
    private var operationWaiters: [CheckedContinuation<Void, Never>] = []
    private var isForeground = false
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    private var snapshotVersion = 0
    private var answeredApprovalIDs: Set<String> = []
    private var lifecycleGeneration = 0
    private var currentWatchID: String?
    private var planCommandID: UUID?
    private var libraryLoadIDs: [String: UUID] = [:]
    private var sessionsLoadID: UUID?
    private var sessionsLoadTask: Task<Void, Never>?
    private var catalogLoadID: UUID?
    private var catalogLoadTask: Task<Void, Never>?

    convenience init() {
        self.init(
            repository: ComputerRepository(), client: DSBotHTTPClient(),
            conversationStorage: FileConversationStorage()
        )
    }

    init(
        repository: any DSBotComputerStorage,
        client: any DSBotTransport,
        conversationStorage: any DSBotConversationStorage = MemoryConversationStorage()
    ) {
        self.repository = repository
        self.client = client
        self.conversationStorage = conversationStorage
    }

    func resume() {
        isForeground = true
        let resumedLifecycle = lifecycleGeneration
        Task { [weak self] in
            guard let self, self.isForeground,
                  self.lifecycleGeneration == resumedLifecycle else { return }
            await self.start(activating: false)
        }
    }

    func start(activating: Bool = true) async {
        if activating { isForeground = true }
        let startupLifecycle = lifecycleGeneration
        guard isForeground else { return }
        reconnectTask?.cancel()
        reconnectTask = nil
        await acquireOperation()
        var releaseOnExit = true
        defer { if releaseOnExit { releaseOperation() } }
        guard isForeground, startupLifecycle == lifecycleGeneration else { return }
        let loadingToken = beginLoading()
        defer {
            endLoading(loadingToken)
            if startupLifecycle == lifecycleGeneration { isRestoring = false }
        }
        do {
            let library = try await repository.load()
            guard isForeground, startupLifecycle == lifecycleGeneration else { return }
            apply(library)
            guard status != .connected else {
                isRestoring = false
                return
            }
            guard let computer = activeComputer
                    ?? computers.max(by: { $0.lastUsedAt < $1.lastUsedAt }) else {
                status = .disconnected
                isRestoring = false
                showsConnectionGuide = true
                return
            }
            let currentGeneration = nextGeneration()
            status = .connecting
            connectionFailure = nil
            error = nil
            DSBotLog.record("computer.restore.begin", level: "info", state: "connecting")
            do {
                try await connectSaved(computer, generation: currentGeneration, lifecycle: "restore")
            } catch {
                guard currentGeneration == generation else { return }
                status = .disconnected
                connectionFailure = safeFailure(for: error)
                self.error = safeMessage(for: error)
                showsConnectionGuide = needsConnectionGuide
                DSBotLog.record(
                    "computer.restore.fail",
                    level: "warn",
                    state: "disconnected",
                    code: safeFailure(for: error).logCode
                )
                scheduleReconnect(generation: currentGeneration, after: safeFailure(for: error))
            }
            if currentGeneration == generation, status == .connected {
                releaseOperation()
                releaseOnExit = false
                await loadInitialData(generation: currentGeneration)
            }
        } catch {
            guard isForeground, startupLifecycle == lifecycleGeneration else { return }
            status = .disconnected
            connectionFailure = safeFailure(for: error)
            self.error = safeMessage(for: error)
            isRestoring = false
            showsConnectionGuide = true
        }
    }

    func pair(link: String, name: String = "") async throws {
        let endpoint = try ConnectionEndpoint.parse(link, name: name)
        let queuedLifecycle = lifecycleGeneration
        await acquireOperation()
        var releaseOnExit = true
        defer { if releaseOnExit { releaseOperation() } }
        guard isForeground, queuedLifecycle == lifecycleGeneration else {
            throw CancellationError()
        }

        let previous = activeComputer
        let currentGeneration = nextGeneration()
        status = .connecting
        connectionFailure = nil
        error = nil
        clearConversation()
        DSBotLog.record("pair.begin", state: "connecting")

        do {
            let ready = try await client.connect(
                endpoint: endpoint,
                expectedComputerId: endpoint.computerId,
                generation: currentGeneration,
                onEvent: { [weak self] event in
                    await self?.consume(event, generation: currentGeneration)
                },
                onDisconnect: { [weak self] in
                    await self?.handleDisconnect(generation: currentGeneration)
                }
            )
            guard currentGeneration == generation else { throw DSBotFailure.switchedComputer }
            let library = try await repository.pairAuthenticated(endpoint: endpoint, readyId: ready.id)
            guard currentGeneration == generation else { throw DSBotFailure.switchedComputer }
            apply(library)
            await restoreConversation(for: activeComputer, generation: currentGeneration)
            guard currentGeneration == generation else { throw DSBotFailure.switchedComputer }
            status = .connected
            connectionFailure = nil
            error = nil
            showsConnectionGuide = false
            reconnectAttempt = 0
            DSBotLog.record("pair.ready", counts: ["computerCount": computers.count], state: "connected")
            releaseOperation()
            releaseOnExit = false
            await loadInitialData(generation: currentGeneration)
        } catch {
            let failure = safeFailure(for: error)
            guard currentGeneration == generation else { throw DSBotFailure.switchedComputer }
            await client.disconnect(throughGeneration: currentGeneration)
            status = .disconnected
            connectionFailure = failure
            self.error = safeMessage(for: failure)
            DSBotLog.record("pair.fail", level: "warn", state: "disconnected", code: failure.logCode)
            if let previous {
                await restore(previous, generation: currentGeneration)
            } else {
                showsConnectionGuide = true
            }
            releaseOperation()
            releaseOnExit = false
            if status == .connected {
                await loadInitialData(generation: currentGeneration)
            }
            throw failure
        }
    }

    func selectComputer(_ computer: Computer) async {
        let queuedLifecycle = lifecycleGeneration
        await acquireOperation()
        var releaseOnExit = true
        defer { if releaseOnExit { releaseOperation() } }
        guard isForeground, queuedLifecycle == lifecycleGeneration else { return }
        guard computer.id != activeComputer?.id else { return }

        let previous = activeComputer
        let currentGeneration = nextGeneration()
        status = .connecting
        connectionFailure = nil
        error = nil
        clearConversation()
        DSBotLog.record(
            "computer.switch.begin",
            counts: ["computerCount": computers.count],
            state: "connecting"
        )
        do {
            try await connectSaved(computer, generation: currentGeneration, lifecycle: "switch")
            DSBotLog.record("computer.switch.ready", state: "connected")
            reconnectAttempt = 0
            releaseOperation()
            releaseOnExit = false
            await loadInitialData(generation: currentGeneration)
        } catch {
            guard currentGeneration == generation else { return }
            let failure = safeFailure(for: error)
            status = .disconnected
            connectionFailure = failure
            self.error = safeMessage(for: failure)
            DSBotLog.record("computer.switch.fail", level: "warn", state: "disconnected", code: failure.logCode)
            if let previous {
                await restore(previous, generation: currentGeneration)
            } else {
                showsConnectionGuide = true
            }
            releaseOperation()
            releaseOnExit = false
            if status == .connected {
                await loadInitialData(generation: currentGeneration)
            }
        }
    }

    func removeComputer(_ computer: Computer) async {
        let removalLifecycle = lifecycleGeneration
        await acquireOperation()
        var releaseOnExit = true
        defer { if releaseOnExit { releaseOperation() } }
        guard isForeground, removalLifecycle == lifecycleGeneration else { return }
        let wasActive = computer.id == activeComputer?.id
        let currentGeneration = wasActive ? nextGeneration() : generation
        if wasActive {
            status = .disconnected
            clearConversation()
            await client.disconnect(throughGeneration: currentGeneration)
        }
        do {
            let library = try await repository.remove(computer.id)
            guard isForeground, removalLifecycle == lifecycleGeneration,
                  !wasActive || currentGeneration == generation else { return }
            apply(library)
            await removeConversationCache(for: computer.id)
            await conversationImages.remove(for: computer.id)
            guard isForeground, removalLifecycle == lifecycleGeneration,
                  !wasActive || currentGeneration == generation else { return }
            error = nil
            if wasActive,
               isForeground,
               let next = computers.max(by: { $0.lastUsedAt < $1.lastUsedAt }) {
                status = .connecting
                do {
                    try await connectSaved(next, generation: currentGeneration, lifecycle: "restore")
                    reconnectAttempt = 0
                    // The selected endpoint is committed; the next desktop can proceed while lists load.
                    releaseOperation()
                    releaseOnExit = false
                    await loadInitialData(generation: currentGeneration)
                    return
                } catch {
                    guard currentGeneration == generation else { return }
                    status = .disconnected
                    connectionFailure = safeFailure(for: error)
                    self.error = safeMessage(for: error)
                    showsConnectionGuide = needsConnectionGuide
                }
            } else if wasActive {
                showsConnectionGuide = true
            }
        } catch {
            guard isForeground, removalLifecycle == lifecycleGeneration,
                  !wasActive || currentGeneration == generation else { return }
            self.error = safeMessage(for: error)
            if wasActive { showsConnectionGuide = true }
        }
    }

    func selectSession(_ session: SessionSummary) async {
        guard status == .connected else {
            error = DSBotFailure.disconnected.localizedDescription
            return
        }
        if selectedSession?.id == session.id, currentWatchID != nil { return }
        let startedAt = ProcessInfo.processInfo.systemUptime
        let currentGeneration = generation
        let previousSession = selectedSession
        sessionSelectionGeneration &+= 1
        let currentSelection = sessionSelectionGeneration
        let watchID = UUID().uuidString
        currentWatchID = watchID
        let loadingToken = beginLoading()
        defer { endLoading(loadingToken) }
        isLoadingSession = true
        defer {
            if currentGeneration == generation, currentSelection == sessionSelectionGeneration {
                isLoadingSession = false
            }
        }
        selectedSession = session
        unavailableSessionID = nil
        isStoppingSession = false
        planCommandID = nil
        isChangingPlanMode = false
        isChoosingWorkspace = false
        isSending = false
        error = nil
        if previousSession?.id != session.id {
            messages = []
            transcript = nil
            transcriptTimeSeparators = [:]
            transcriptRows = []
            transcriptRevision &+= 1
            goal = nil
            todos = []
            queuedMessages = []
            updatingQueueItemID = nil
            planMode = false
            selectedModelId = nil
            selectedEffort = nil
            selectedPermissionId = nil
            selectedPresetId = nil
        }
        context = []
        trace = []
        team = []
        approvals = []
        questions = []
        historyLoadID = nil
        historyLoadTarget = nil
        isRespondingApprovals = []
        if previousSession?.id != session.id {
            answeredApprovalIDs = []
            answeredQuestionIDs = []
        }
        let openingSnapshotVersion = snapshotVersion
        scheduleConversationSave()
        do {
            // session.watch replaces the prior watch without waiting for its stream to close.
            let result = try await request("session.watch", [
                "id": .string(session.id), "watchId": .string(watchID), "transcript": .bool(true)
            ])
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration else { return }
            let detail = try await json.decode(SessionDetail.self, from: result)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration else { return }
            guard detail.session.id == session.id else { throw DSBotFailure.protocolError }
            if snapshotVersion == openingSnapshotVersion {
                await apply(detail)
            }
            error = nil
            DSBotLog.record(
                "session.select.ready",
                elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000,
                counts: ["messageCount": transcript == nil ? messages.count : transcriptRows.count]
            )
        } catch {
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration else { return }
            currentWatchID = nil
            if case .remote("NOT_FOUND") = safeFailure(for: error) { unavailableSessionID = session.id }
            self.error = safeMessage(for: error)
            DSBotLog.record(
                "session.select.fail", level: "warn",
                elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000,
                code: safeFailure(for: error).logCode
            )
        }
    }

    func projectDirectory(path: String) async throws -> ProjectDirectory {
        try await projectFileRequest("files.list", path: path, as: ProjectDirectory.self)
    }

    func projectFile(path: String) async throws -> ProjectFileContent {
        try await projectFileRequest("files.read", path: path, as: ProjectFileContent.self)
    }

    private func projectFileRequest<T: Decodable & Sendable>(
        _ method: String, path: String, as type: T.Type
    ) async throws -> T {
        guard let sessionID = selectedSession?.id else { throw DSBotFailure.disconnected }
        let connection = generation
        let selection = sessionSelectionGeneration
        let value = try await request(method, [
            "id": .string(sessionID), "path": .string(path)
        ])
        let result = try await json.decode(type, from: value)
        guard !Task.isCancelled,
              connection == generation, selection == sessionSelectionGeneration,
              selectedSession?.id == sessionID else { throw CancellationError() }
        return result
    }

    /// Starts a conversation, in `workspaceId` or else the project the open one belongs to. Tapping
    /// "new" while already on an empty conversation of that project keeps it instead of piling up
    /// blank rows, as DSH does.
    /// The "新会话" button: DSH's new-task home. Nothing is created until a workspace is picked.
    func beginNewTask() {
        guard status == .connected else {
            error = DSBotFailure.disconnected.localizedDescription
            return
        }
        guard selectedSession != nil || !isChoosingWorkspace else { return }
        let previousWatchID = currentWatchID
        let currentGeneration = generation
        sessionSelectionGeneration &+= 1
        isStoppingSession = false
        planCommandID = nil
        isChangingPlanMode = false
        currentWatchID = nil
        selectedSession = nil
        messages = []
        transcript = nil
        transcriptTimeSeparators = [:]
        transcriptRows = []
        transcriptRevision &+= 1
        goal = nil
        todos = []
        queuedMessages = []
        updatingQueueItemID = nil
        planMode = false
        selectedModelId = nil
        selectedEffort = nil
        selectedPermissionId = nil
        selectedPresetId = nil
        context = []
        trace = []
        team = []
        approvals = []
        questions = []
        answeredQuestionIDs = []
        historyLoadID = nil
        historyLoadTarget = nil
        isRespondingApprovals = []
        isLoadingSession = false
        isSending = false
        error = nil
        isChoosingWorkspace = true
        scheduleConversationSave()
        // The stream of the conversation that was open is no longer wanted.
        if let previousWatchID {
            Task { [weak self] in
                guard let self, self.generation == currentGeneration else { return }
                do {
                    _ = try await self.request("session.unwatch", ["watchId": .string(previousWatchID)])
                } catch {
                    guard self.generation == currentGeneration else { return }
                    DSBotLog.networkFailure("session.unwatch.fail", error: error)
                    if self.currentWatchID == nil {
                        await self.handleDisconnect(generation: currentGeneration, failure: self.safeFailure(for: error))
                    }
                }
            }
        }
    }

    /// A project's "+" button: a new task in that workspace, reusing its blank conversation.
    func startNewSession(workspaceId: String) async {
        if let current = selectedSession, isBlankSession, current.workspaceId == workspaceId { return }
        await startTask(in: workspaceId)
    }

    /// Picking a workspace on the new-task home (or a project's "+"): open its blank conversation, or
    /// create one with the mode chosen so far.
    func startTask(in workspaceId: String) async {
        let blank = blankSession(in: workspaceId)
        await createSession(
            workspaceId: workspaceId,
            agentPreset: isChoosingWorkspace ? selectedPresetId : nil,
            reusing: blank?.id
        )
    }

    /// An empty conversation of a workspace, which a new task can reuse instead of adding another.
    func blankSession(in workspaceId: String) -> SessionSummary? {
        sessions.first { $0.blank == true && $0.workspaceId == workspaceId }
    }

    /// The mode picked on the new-task home; it is applied when the conversation is created.
    func chooseDraftPreset(_ presetId: String) {
        guard isChoosingWorkspace, presets.contains(where: { $0.id == presetId }) else { return }
        selectedPresetId = presetId
    }

    func createSession(workspaceId: String? = nil, agentPreset: String? = nil, reusing blankId: String? = nil) async {
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        var params: [String: JSONValue] = [:]
        if let workspaceId { params["workspaceId"] = .string(workspaceId) }
        if let agentPreset { params["agentPreset"] = .string(agentPreset) }
        if let blankId { params["reuse"] = .string(blankId) }
        do {
            let result = try await request("session.create", params)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration else { return }
            let session = try await json.decode(SessionSummary.self, from: result)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration else { return }
            if !sessions.contains(where: { $0.id == session.id }) { sessions.insert(session, at: 0) }
            await selectSession(session)
        } catch {
            if currentGeneration == generation,
               currentSelection == sessionSelectionGeneration {
                self.error = featureMessage(for: error)
            }
        }
    }

    /// The open conversation has nothing in it yet, so project and mode can still be chosen.
    var isBlankSession: Bool {
        guard let session = selectedSession, !isLoadingSession, session.status == "idle" else { return false }
        return transcript != nil ? (transcript?.entries.isEmpty ?? true) : messages.isEmpty
    }

    /// The model the open conversation runs and its reasoning levels, when the host lists them.
    var currentModel: Choice? { models.first { $0.id == selectedModelId } }
    var currentEfforts: [Choice] { currentModel?.efforts ?? [] }
    var effectiveEffort: String? { selectedEffort ?? currentModel?.defaultEffort }
    var effortName: String? {
        guard let effort = effectiveEffort else { return nil }
        return currentEfforts.first { $0.id == effort }?.name ?? effort
    }

    /// Project the open conversation belongs to.
    var currentWorkspaceName: String? {
        guard let session = selectedSession else { return nil }
        return workspaces.first { $0.id == session.workspaceId }?.name ?? session.workspaceName
    }

    /// Mode of the open conversation, or the host default while it is still unset.
    var currentPreset: Choice? {
        presets.first { $0.id == selectedPresetId } ?? presets.first { $0.isDefault == true }
    }

    func send(text: String, attachments: [UploadAttachment] = [], files: [UploadedFile] = []) async throws {
        guard let selectedSession else { throw DSBotFailure.disconnected }
        guard !isSending else { throw DSBotFailure.remote("BUSY") }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        let sessionId = selectedSession.id
        isSending = true
        defer {
            if currentGeneration == generation, currentSelection == sessionSelectionGeneration {
                isSending = false
            }
        }
        do {
            var attachmentItems = try await json.encode(attachments).arrayValue ?? []
            attachmentItems += files.map { .object(["receiptId": .string($0.receiptId), "name": .string($0.name)]) }
            let attachmentValue = JSONValue.array(attachmentItems)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  self.selectedSession?.id == sessionId else {
                throw DSBotFailure.switchedComputer
            }
            _ = try await request("session.send", [
                "id": .string(sessionId),
                "text": .string(text),
                "attachments": attachmentValue
            ])
        } catch {
            let failure = safeFailure(for: error)
            if currentGeneration == generation,
               currentSelection == sessionSelectionGeneration {
                self.error = safeMessage(for: failure)
            }
            throw failure
        }
    }

    func updateQueuedMessage(_ message: QueuedMessage, action: String, text: String? = nil) async throws {
        guard let session = selectedSession, updatingQueueItemID == nil,
              queuedMessages.contains(where: { $0.id == message.id }) else {
            throw DSBotFailure.remote("NOT_FOUND")
        }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        let revision = queueRevision
        updatingQueueItemID = message.id
        defer {
            if currentGeneration == generation, currentSelection == sessionSelectionGeneration {
                updatingQueueItemID = nil
            }
        }
        var params: [String: JSONValue] = [
            "id": .string(session.id), "itemId": .string(message.id), "action": .string(action)
        ]
        if let text { params["text"] = .string(text) }
        let result = try await request("session.queue.update", params)
        guard currentGeneration == generation, currentSelection == sessionSelectionGeneration else {
            throw DSBotFailure.switchedComputer
        }
        if let value = result["queuedMessages"], revision == queueRevision {
            let queue = try await json.decode([QueuedMessage].self, from: value)
            guard currentGeneration == generation, currentSelection == sessionSelectionGeneration,
                  revision == queueRevision else { return }
            queuedMessages = queue
            queueRevision &+= 1
            scheduleConversationSave()
        }
    }

    func stopSession() async {
        guard let selectedSession, !isStoppingSession else { return }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        isStoppingSession = true
        defer {
            if currentGeneration == generation, currentSelection == sessionSelectionGeneration {
                isStoppingSession = false
            }
        }
        do {
            _ = try await request("session.stop", ["id": .string(selectedSession.id)])
        } catch {
            if currentGeneration == generation,
               currentSelection == sessionSelectionGeneration {
                self.error = safeMessage(for: error)
            }
        }
    }

    func conversationImage(
        _ attachment: TranscriptAttachment, target: DraftTarget, fullSize: Bool
    ) async -> PreparedPhotoImage? {
        guard let attachmentID = attachment.id, target.computerID == activeComputer?.id,
              target.sessionID == selectedSession?.id else { return nil }
        let key = ConversationImageKey(target: target, attachmentID: attachmentID)
        let currentGeneration = generation
        do {
            if let cached = try await conversationImages.load(key, fullSize: fullSize) {
                guard !Task.isCancelled, currentGeneration == generation,
                      target.computerID == activeComputer?.id, target.sessionID == selectedSession?.id else { return nil }
                return cached
            }
            guard !Task.isCancelled, status == .connected, target.computerID == activeComputer?.id,
                  target.sessionID == selectedSession?.id else { return nil }
            var parameters: [String: JSONValue] = [
                "id": .string(target.sessionID), "attachmentId": .string(attachmentID)
            ]
            if let seq = attachment.seq { parameters["seq"] = .number(seq) }
            let value = try await request("session.attachment", parameters)
            let payload = try await json.decode(ConversationImagePayload.self, from: value)
            guard !Task.isCancelled, currentGeneration == generation,
                  target.computerID == activeComputer?.id, target.sessionID == selectedSession?.id else { return nil }
            return try await conversationImages.store(payload, for: key, fullSize: fullSize)
        } catch {
            guard !Task.isCancelled, currentGeneration == generation,
                  target.computerID == activeComputer?.id, target.sessionID == selectedSession?.id else { return nil }
            DSBotLog.networkFailure("conversation.image.load.fail", error: error)
            self.error = error is ConversationStorageError
                ? DSBotFailure.protocolError.localizedDescription : safeMessage(for: error)
            return nil
        }
    }

    /// Runs one allowlisted DSH command for the open session. Returns nil (and sets `error`) when the
    /// desktop could not be reached or does not know the command yet.
    func runCommand(_ command: SessionCommand, argument: String? = nil) async -> CommandOutcome? {
        guard let selectedSession else { return nil }
        guard command != .plan || !isChangingPlanMode else { return nil }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        let sessionId = selectedSession.id
        let commandID = command == .plan ? UUID() : nil
        if let commandID {
            planCommandID = commandID
            isChangingPlanMode = true
        }
        defer {
            if let commandID, planCommandID == commandID {
                planCommandID = nil
                isChangingPlanMode = false
            }
        }
        var params: [String: JSONValue] = [
            "id": .string(sessionId),
            "command": .string(command.rawValue)
        ]
        if let argument, !argument.isEmpty { params["argument"] = .string(argument) }
        do {
            let value = try await request("session.command", params, timeoutSeconds: 120)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  self.selectedSession?.id == sessionId else { return nil }
            guard let object = value.objectValue, let kind = object["kind"]?.stringValue,
                  ["success", "error"].contains(kind), let text = object["text"]?.stringValue else {
                throw DSBotFailure.protocolError
            }
            DSBotLog.record("session.command", state: command.rawValue)
            let outcome = CommandOutcome(
                isError: kind == "error", text: text
            )
            if command == .plan, !outcome.isError {
                planMode = argument?.trimmingCharacters(in: .whitespacesAndNewlines) != "off"
                scheduleConversationSave()
                await refreshSessionWatch(sessionID: sessionId, generation: currentGeneration, selection: currentSelection)
            }
            return outcome
        } catch {
            if currentGeneration == generation,
               currentSelection == sessionSelectionGeneration,
               self.selectedSession?.id == sessionId {
                self.error = featureMessage(for: error)
            }
            return nil
        }
    }

    private func refreshSessionWatch(sessionID: String, generation currentGeneration: Int, selection currentSelection: Int) async {
        let watchID = UUID().uuidString
        currentWatchID = watchID
        let openingSnapshotVersion = snapshotVersion
        do {
            let result = try await request("session.watch", [
                "id": .string(sessionID), "watchId": .string(watchID), "transcript": .bool(true)
            ])
            let detail = try await json.decode(SessionDetail.self, from: result)
            guard currentGeneration == generation, currentSelection == sessionSelectionGeneration,
                  currentWatchID == watchID, selectedSession?.id == sessionID else { return }
            guard detail.session.id == sessionID else { throw DSBotFailure.protocolError }
            if snapshotVersion == openingSnapshotVersion { await apply(detail) }
        } catch {
            guard currentGeneration == generation, currentSelection == sessionSelectionGeneration,
                  currentWatchID == watchID, selectedSession?.id == sessionID else { return }
            DSBotLog.networkFailure("session.plan.refresh.fail", error: error)
            await handleDisconnect(generation: currentGeneration, failure: safeFailure(for: error))
        }
    }

    /// Stages a file from the phone on the desktop for the next prompt of the open session.
    func uploadFile(name: String, data: Data) async throws -> UploadedFile {
        guard let selectedSession else { throw DSBotFailure.disconnected }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        let sessionId = selectedSession.id
        do {
            let encoded = await Task.detached(priority: .userInitiated) { data.base64EncodedString() }.value
            let value = try await request("file.upload", [
                "id": .string(sessionId),
                "name": .string(name),
                "data": .string(encoded)
            ], timeoutSeconds: 180)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  self.selectedSession?.id == sessionId else { throw DSBotFailure.switchedComputer }
            guard let object = value.objectValue,
                  let receiptId = object["receiptId"]?.stringValue, !receiptId.isEmpty else {
                throw DSBotFailure.protocolError
            }
            DSBotLog.record("file.upload", counts: ["payloadBytes": data.count])
            return UploadedFile(
                receiptId: receiptId,
                name: object["name"]?.stringValue ?? name,
                bytes: object["bytes"]?.numberValue.map { Int($0) } ?? data.count
            )
        } catch {
            let failure = safeFailure(for: error)
            if currentGeneration == generation,
               currentSelection == sessionSelectionGeneration,
               self.selectedSession?.id == sessionId {
                self.error = featureMessage(for: failure)
            }
            throw failure
        }
    }

    /// Older desktop plugins answer unknown methods with these codes.
    private func featureMessage(for error: Error) -> String {
        if case let .remote(code) = safeFailure(for: error),
           ["UNSUPPORTED", "METHOD_NOT_ALLOWED"].contains(code) {
            return "请先在电脑上更新 dsbot 插件，再使用此功能。"
        }
        return safeMessage(for: error)
    }

    func respondToApproval(_ approval: Approval, allow: Bool) async {
        guard approval.sessionId == selectedSession?.id,
              approvals.contains(where: { $0.id == approval.id }),
              !isRespondingApprovals.contains(approval.id) else { return }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        isRespondingApprovals.insert(approval.id)
        DSBotLog.record(allow ? "approval.allow" : "approval.deny")
        defer {
            if currentGeneration == generation, currentSelection == sessionSelectionGeneration {
                isRespondingApprovals.remove(approval.id)
            }
        }
        do {
            _ = try await request("approval.respond", [
                "id": .string(approval.id),
                "sessionId": .string(approval.sessionId),
                "decision": .string(allow ? "allow" : "deny")
            ])
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration else { return }
            answeredApprovalIDs.insert(approval.id)
            approvals.removeAll { $0.id == approval.id }
        } catch {
            if currentGeneration == generation, currentSelection == sessionSelectionGeneration {
                self.error = safeMessage(for: error)
            }
        }
    }

    func refreshSessions(requiringNewRequest: Bool = false) async {
        let currentGeneration = generation
        if let sessionsLoadTask {
            await sessionsLoadTask.value
            guard requiringNewRequest, currentGeneration == generation else { return }
        }
        let loadID = UUID()
        sessionsLoadID = loadID
        isLoadingSessions = true
        sessionsError = nil
        let task = Task { @MainActor in
            await self.performSessionRefresh(generation: currentGeneration, loadID: loadID)
        }
        sessionsLoadTask = task
        await task.value
    }

    private func performSessionRefresh(generation currentGeneration: Int, loadID: UUID) async {
        let loadingToken = beginLoading()
        defer {
            endLoading(loadingToken)
            if sessionsLoadID == loadID {
                sessionsLoadID = nil
                sessionsLoadTask = nil
                isLoadingSessions = false
            }
        }
        do {
            let result = try await request("session.list")
            guard currentGeneration == generation,
                  sessionsLoadID == loadID,
                  !Task.isCancelled else { return }
            let values = try await json.decode([SessionSummary].self, from: result)
            guard currentGeneration == generation,
                  sessionsLoadID == loadID,
                  !Task.isCancelled else { return }
            sessions = values.sorted { $0.updatedAt > $1.updatedAt }
            sessionsError = nil
            scheduleConversationSave()
        } catch is CancellationError {
            return
        } catch {
            if currentGeneration == generation,
               sessionsLoadID == loadID,
               !Task.isCancelled {
                sessionsError = safeMessage(for: error)
            }
        }
    }

    func conversationRequest(
        _ method: String, parameters: [String: JSONValue] = [:], target: DraftTarget
    ) async throws -> JSONValue {
        guard activeComputer?.id == target.computerID, selectedSession?.id == target.sessionID,
              status == .connected else { throw DSBotFailure.disconnected }
        let requestGeneration = generation
        let selection = sessionSelectionGeneration
        var params = parameters
        params["id"] = .string(target.sessionID)
        let result = try await request(method, params)
        guard requestGeneration == generation, selection == sessionSelectionGeneration,
              activeComputer?.id == target.computerID, selectedSession?.id == target.sessionID else {
            throw DSBotFailure.switchedComputer
        }
        return result
    }

    func loadEarlierHistory(target: DraftTarget) async throws {
        guard historyLoadTarget != target, let before = transcript?.beforeSeq,
              transcript?.hasMore == true else { return }
        let identifier = UUID()
        historyLoadID = identifier
        historyLoadTarget = target
        let selection = sessionSelectionGeneration
        let connection = generation
        let watchID = currentWatchID
        defer {
            if historyLoadID == identifier {
                historyLoadID = nil
                historyLoadTarget = nil
            }
        }
        var params: [String: JSONValue] = ["beforeSeq": .number(before)]
        if let through = transcript?.throughSeq { params["throughSeq"] = .number(through) }
        let result = try await conversationRequest("session.page", parameters: params, target: target)
        let page = try await json.decode(ConversationPage.self, from: result)
        guard !Task.isCancelled, connection == generation, watchID == currentWatchID,
              selection == sessionSelectionGeneration, transcript != nil,
              activeComputer?.id == target.computerID, selectedSession?.id == target.sessionID else { return }
        guard let previous = page.transcript.beforeSeq, previous < before else { throw DSBotFailure.protocolError }
        while true {
            let revision = transcriptRevision
            let projection = await conversationProjector.project(
                current: transcript, incoming: page.transcript, currentRows: transcriptRows,
                isRunning: selectedSession?.status == "running", prepending: true
            )
            guard !Task.isCancelled, connection == generation, watchID == currentWatchID,
                  selection == sessionSelectionGeneration,
                  activeComputer?.id == target.computerID, selectedSession?.id == target.sessionID else { return }
            guard revision == transcriptRevision else { continue }
            apply(projection)
            break
        }
        scheduleConversationSave()
    }

    func answerQuestions(_ batch: ConversationQuestions, answers: [ConversationAnswer], target: DraftTarget) async throws {
        guard batch.sessionId == target.sessionID, questions.contains(where: { $0.id == batch.id }) else {
            throw DSBotFailure.remote("STALE_APPROVAL")
        }
        let encoded = try await json.encode(answers)
        _ = try await conversationRequest("question.answer", parameters: [
            "callId": .string(batch.id), "answers": encoded
        ], target: target)
        answeredQuestionIDs.insert(batch.id)
        questions.removeAll { $0.id == batch.id }
    }

    func forkConversation(at seq: Double, target: DraftTarget) async throws {
        let connection = generation
        let selection = sessionSelectionGeneration
        let result = try await conversationRequest("session.fork", parameters: ["seq": .number(seq)], target: target)
        guard let id = result["sessionId"]?.stringValue else { throw DSBotFailure.protocolError }
        await refreshSessions(requiringNewRequest: true)
        guard connection == generation, selection == sessionSelectionGeneration,
              activeComputer?.id == target.computerID, selectedSession?.id == target.sessionID else { return }
        guard sessionsError == nil else { throw DSBotFailure.connectionFailed }
        guard let branch = sessions.first(where: { $0.id == id }) else { throw DSBotFailure.protocolError }
        await selectSession(branch)
    }

    func searchSessions(_ query: String) async throws -> SessionSearchPage {
        let result = try await request("session.search", ["query": .string(query)])
        return try await json.decode(SessionSearchPage.self, from: result)
    }

    func refreshCatalog() async {
        if let catalogLoadTask {
            await catalogLoadTask.value
            return
        }
        let currentGeneration = generation
        let loadID = UUID()
        catalogLoadID = loadID
        isLoadingCatalog = true
        catalogError = nil
        let task = Task { @MainActor in
            await self.performCatalogLoad(generation: currentGeneration, loadID: loadID)
        }
        catalogLoadTask = task
        await task.value
    }

    func loadLibrary(_ section: String) async {
        let currentGeneration = generation
        let loadID = UUID()
        libraryLoadIDs[section] = loadID
        loadingLibrarySections.insert(section)
        libraryErrors[section] = nil
        defer {
            if libraryLoadIDs[section] == loadID {
                loadingLibrarySections.remove(section)
            }
        }
        do {
            let method: String
            let params: [String: JSONValue] = [:]
            switch section {
            case "plugins": method = "plugins.list"
            case "schedule": method = "schedule.list"
            default: throw DSBotFailure.unsupportedRequest
            }
            let result = try await request(method, params)
            guard currentGeneration == generation, libraryLoadIDs[section] == loadID, !Task.isCancelled else { return }
            let entries = try await json.decode([LibraryEntry].self, from: result)
            guard currentGeneration == generation, libraryLoadIDs[section] == loadID, !Task.isCancelled else { return }
            switch section {
            case "plugins": plugins = entries
            case "schedule": schedules = entries
            default: break
            }
        } catch is CancellationError {
            return
        } catch {
            if currentGeneration == generation, libraryLoadIDs[section] == loadID, !Task.isCancelled {
                libraryErrors[section] = safeMessage(for: error)
            }
        }
    }

    func configure(
        modelId: String? = nil,
        permissionId: String? = nil,
        reasoningEffort: String? = nil,
        agentPreset: String? = nil
    ) async {
        guard let selectedSession else { return }
        guard modelId != nil || permissionId != nil || reasoningEffort != nil || agentPreset != nil else { return }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        let sessionId = selectedSession.id
        var params: [String: JSONValue] = ["id": .string(sessionId)]
        if let modelId { params["modelId"] = .string(modelId) }
        if let permissionId { params["permissionId"] = .string(permissionId) }
        if let reasoningEffort { params["reasoningEffort"] = .string(reasoningEffort) }
        if let agentPreset { params["agentPreset"] = .string(agentPreset) }
        do {
            _ = try await request("session.configure", params)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  self.selectedSession?.id == sessionId else { return }
            if let modelId {
                selectedModelId = modelId
                // A new model starts at its own default level.
                selectedEffort = models.first { $0.id == modelId }?.defaultEffort
            }
            if let reasoningEffort { selectedEffort = reasoningEffort }
            if let permissionId { selectedPermissionId = permissionId }
            if let agentPreset { selectedPresetId = agentPreset }
            error = nil
        } catch {
            if currentGeneration == generation,
               currentSelection == sessionSelectionGeneration,
               self.selectedSession?.id == sessionId {
                self.error = featureMessage(for: error)
            }
        }
    }

    func request(
        _ method: String,
        _ params: [String: JSONValue] = [:],
        timeoutSeconds: UInt64 = 30
    ) async throws -> JSONValue {
        guard status == .connected else { throw DSBotFailure.disconnected }
        let currentGeneration = generation
        let value = try await client.request(method, params: params, timeoutSeconds: timeoutSeconds)
        guard currentGeneration == generation, status == .connected else {
            throw DSBotFailure.switchedComputer
        }
        return value
    }

    func reconnect() async {
        let reconnectLifecycle = lifecycleGeneration
        let reconnectGeneration = nextGeneration()
        status = .disconnected
        await client.disconnect(throughGeneration: reconnectGeneration)
        guard isForeground, reconnectLifecycle == lifecycleGeneration else { return }
        await start(activating: false)
    }

    func suspend() {
        persistConversation()
        isForeground = false
        lifecycleGeneration &+= 1
        reconnectTask?.cancel()
        reconnectTask = nil
        let suspendedGeneration = nextGeneration()
        sessionSelectionGeneration &+= 1
        isSending = false
        isRespondingApprovals = []
        status = .disconnected
        Task { await client.disconnect(throughGeneration: suspendedGeneration) }
        DSBotLog.record("network.suspend", state: "disconnected")
    }

    private func connectSaved(
        _ computer: Computer,
        generation currentGeneration: Int,
        lifecycle: String
    ) async throws {
        let endpoint = try ConnectionEndpoint.parse(computer.url, name: computer.name)
        if let savedId = computer.computerId,
           let qrId = endpoint.computerId,
           savedId != qrId {
            throw DSBotFailure.identityMismatch
        }
        let expectedId = computer.computerId ?? endpoint.computerId
        await restoreConversation(for: computer, generation: currentGeneration)
        guard currentGeneration == generation else { throw DSBotFailure.switchedComputer }
        isRestoring = false
        let ready = try await client.connect(
            endpoint: endpoint,
            expectedComputerId: expectedId,
            generation: currentGeneration,
            onEvent: { [weak self] event in
                await self?.consume(event, generation: currentGeneration)
            },
            onDisconnect: { [weak self] in
                await self?.handleDisconnect(generation: currentGeneration)
            }
        )
        guard currentGeneration == generation else { throw DSBotFailure.switchedComputer }
        let library: ComputerLibrary
        do {
            library = try await repository.activateAuthenticated(localId: computer.id, readyId: ready.id)
        } catch {
            await client.disconnect(throughGeneration: currentGeneration)
            throw error
        }
        guard currentGeneration == generation else {
            await client.disconnect(throughGeneration: currentGeneration)
            throw DSBotFailure.switchedComputer
        }
        apply(library)
        status = .connected
        connectionFailure = nil
        error = nil
        showsConnectionGuide = false
        reconnectAttempt = 0
        reconnectTask?.cancel()
        reconnectTask = nil
        DSBotLog.record(
            "computer.\(lifecycle).ready",
            counts: ["computerCount": computers.count],
            state: "connected"
        )
    }

    private func restore(_ computer: Computer, generation currentGeneration: Int) async {
        guard currentGeneration == generation else { return }
        status = .connecting
        connectionFailure = nil
        DSBotLog.record("computer.restore.begin", state: "connecting")
        do {
            try await connectSaved(computer, generation: currentGeneration, lifecycle: "restore")
            DSBotLog.record("computer.restore.ready", state: "connected")
        } catch {
            guard currentGeneration == generation else { return }
            status = .disconnected
            connectionFailure = safeFailure(for: error)
            self.error = safeMessage(for: error)
            showsConnectionGuide = needsConnectionGuide
            DSBotLog.record(
                "computer.restore.fail",
                level: "warn",
                state: "disconnected",
                code: safeFailure(for: error).logCode
            )
            scheduleReconnect(generation: currentGeneration, after: safeFailure(for: error))
        }
    }

    private func loadInitialData(generation currentGeneration: Int) async {
        guard currentGeneration == generation else { return }
        let initialSelection = sessionSelectionGeneration
        async let workspaceLoad: Void = loadWorkspaces(generation: currentGeneration)
        async let catalogLoad: Void = refreshCatalog()
        async let navigationLoad: Void = refreshNavigation()
        await refreshSessions()
        guard currentGeneration == generation else { return }
        if initialSelection == sessionSelectionGeneration, !isChoosingWorkspace,
           let target = sessions.first(where: { $0.id == selectedSession?.id }) ?? selectedSession ?? sessions.first {
            await selectSession(target)
            guard currentGeneration == generation else { return }
            if sessionSelectionGeneration == initialSelection &+ 1,
               unavailableSessionID == target.id, sessionsError == nil {
                if let replacement = sessions.first(where: { $0.id != target.id }) {
                    await selectSession(replacement)
                } else {
                    beginNewTask()
                }
            }
        }

        _ = await (workspaceLoad, catalogLoad, navigationLoad)
    }

    /// The entries DSH shows, from the plugin. A plugin without `navigation.get` leaves the lists empty
    /// (the app never lists DSH's features itself), and a failed read keeps the last good copy.
    func refreshNavigation() async {
        let currentGeneration = generation
        guard status == .connected else { return }
        do {
            let value = try await request("navigation.get")
            let catalog = try await json.decode(NavigationCatalog.self, from: value)
            guard currentGeneration == generation else { return }
            if navigation != catalog { navigation = catalog }
            navigationAvailability = catalog.available ? .ready : .waiting
        } catch {
            guard currentGeneration == generation else { return }
            if case let .remote(code) = safeFailure(for: error), ["UNSUPPORTED", "METHOD_NOT_ALLOWED"].contains(code) {
                navigationAvailability = .unsupported
            }
            DSBotLog.networkFailure("navigation.load.fail", error: error)
        }
    }

    /// What the lists show: exactly what DSH reported.
    var activeNavigation: NavigationCatalog { navigation }

    /// Workspaces, as DSH lists them (names, paths and their order).
    func refreshWorkspaces() async {
        await loadWorkspaces(generation: generation)
    }

    /// Rename a workspace on the desktop; true when DSH accepted the new name.
    @discardableResult
    func renameWorkspace(_ id: String, to title: String) async -> Bool {
        let currentGeneration = generation
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return false }
        do {
            _ = try await request("workspace.rename", ["id": .string(id), "title": .string(name)])
            guard currentGeneration == generation else { return false }
            await refreshWorkspaces()
            await refreshSessions()
            return true
        } catch {
            if currentGeneration == generation { self.error = featureMessage(for: error) }
            return false
        }
    }

    /// Remove a workspace's registration. The directory and its conversations stay, under "未分组".
    @discardableResult
    func deleteWorkspace(_ id: String) async -> Bool {
        let currentGeneration = generation
        do {
            _ = try await request("workspace.delete", ["id": .string(id)])
            guard currentGeneration == generation else { return false }
            await refreshWorkspaces()
            await refreshSessions()
            return true
        } catch {
            if currentGeneration == generation { self.error = featureMessage(for: error) }
            return false
        }
    }

    /// Bring an archived conversation back; DSH does not open an archived one.
    @discardableResult
    func unarchiveSession(_ id: String) async -> Bool {
        let currentGeneration = generation
        do {
            _ = try await request("session.unarchive", ["id": .string(id)])
            guard currentGeneration == generation else { return false }
            await refreshSessions()
            return true
        } catch {
            if currentGeneration == generation { self.error = featureMessage(for: error) }
            return false
        }
    }

    /// Rename a conversation on the desktop; true when DSH accepted the new title.
    @discardableResult
    func renameSession(_ id: String, to title: String) async -> Bool {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return false }
        return await changeSession("session.rename", ["id": .string(id), "title": .string(name)])
    }

    /// Pin a conversation to the top of its workspace, or take it off the top again.
    @discardableResult
    func setSessionPinned(_ id: String, _ pinned: Bool) async -> Bool {
        await changeSession("session.pin", ["id": .string(id), "pinned": .bool(pinned)])
    }

    /// Archive a conversation. DSH never deletes one; an archived conversation stays recoverable.
    @discardableResult
    func archiveSession(_ id: String) async -> Bool {
        await changeSession("session.archive", ["id": .string(id)])
    }

    /// One change to a conversation on the desktop, then the list as DSH now has it.
    private func changeSession(_ method: String, _ params: [String: JSONValue]) async -> Bool {
        let currentGeneration = generation
        do {
            _ = try await request(method, params)
            guard currentGeneration == generation else { return false }
            await refreshSessions()
            return true
        } catch {
            if currentGeneration == generation { self.error = featureMessage(for: error) }
            return false
        }
    }

    private func loadWorkspaces(generation currentGeneration: Int) async {
        do {
            let workspaceResult = try await request("workspace.list")
            let nextWorkspaces = try await json.decode([WorkspaceSummary].self, from: workspaceResult)
            guard currentGeneration == generation else { return }
            workspaces = nextWorkspaces
            scheduleConversationSave()
        } catch {
            if currentGeneration == generation, !Task.isCancelled { self.error = safeMessage(for: error) }
        }
    }

    private func performCatalogLoad(generation currentGeneration: Int, loadID: UUID) async {
        defer {
            if catalogLoadID == loadID {
                catalogLoadID = nil
                catalogLoadTask = nil
                isLoadingCatalog = false
            }
        }
        guard currentGeneration == generation else { return }
        do {
            let catalogResult = try await request("catalog.get")
            let catalog = try await json.decode(CatalogResult.self, from: catalogResult)
            guard currentGeneration == generation,
                  catalogLoadID == loadID,
                  !Task.isCancelled else { return }
            models = catalog.models
            permissions = catalog.permissions.map(PermissionLabels.localized)
            presets = catalog.presets ?? []
            catalogError = nil
            scheduleConversationSave()
        } catch is CancellationError {
            return
        } catch {
            if currentGeneration == generation,
               catalogLoadID == loadID,
               !Task.isCancelled {
                catalogError = safeMessage(for: error)
            }
        }
    }

    private func consume(_ event: JSONValue, generation eventGeneration: Int) async {
        guard eventGeneration == generation, event["type"]?.stringValue == "event" else { return }
        if event["topic"]?.stringValue == "navigation.changed" {
            do {
                guard let params = event["params"] else { throw DSBotFailure.protocolError }
                let catalog = try await json.decode(NavigationCatalog.self, from: params)
                guard eventGeneration == generation else { return }
                navigation = catalog
                navigationAvailability = catalog.available ? .ready : .waiting
            } catch {
                DSBotLog.networkFailure("navigation.event.decode.fail", error: DSBotFailure.protocolError)
                await handleDisconnect(generation: eventGeneration, failure: .protocolError)
            }
            return
        }
        guard let topic = event["topic"]?.stringValue,
              ["session.snapshot", "session.watch.failed"].contains(topic),
              let watchID = currentWatchID else { return }
        guard let params = event["params"], let eventWatchID = params["watchId"]?.stringValue else {
            DSBotLog.networkFailure("session.event.decode.fail", error: DSBotFailure.protocolError)
            await handleDisconnect(generation: eventGeneration, failure: .protocolError)
            return
        }
        guard eventWatchID == watchID else { return }
        if topic == "session.watch.failed" {
            let failure = DSBotFailure.remoteCode(params["code"]?.stringValue)
            DSBotLog.networkFailure("session.watch.fail", error: failure)
            await handleDisconnect(generation: eventGeneration, failure: failure)
            return
        }
        let currentSelection = sessionSelectionGeneration
        let detail: SessionDetail
        do {
            detail = try await json.decode(SessionDetail.self, from: params)
        } catch {
            guard eventGeneration == generation, currentSelection == sessionSelectionGeneration,
                  currentWatchID == watchID else { return }
            DSBotLog.networkFailure("session.event.decode.fail", error: DSBotFailure.protocolError)
            await handleDisconnect(generation: eventGeneration, failure: .protocolError)
            return
        }
        guard eventGeneration == generation,
              currentSelection == sessionSelectionGeneration, currentWatchID == watchID else { return }
        guard detail.session.id == selectedSession?.id else {
            DSBotLog.networkFailure("session.event.identity.fail", error: DSBotFailure.protocolError)
            await handleDisconnect(generation: eventGeneration, failure: .protocolError)
            return
        }
        snapshotVersion &+= 1
        await apply(detail)
    }

    private func handleDisconnect(generation eventGeneration: Int, failure: DSBotFailure = .disconnected) async {
        guard eventGeneration == generation else { return }
        let disconnectedGeneration = nextGeneration()
        status = .disconnected
        isSending = false
        updatingQueueItemID = nil
        isRespondingApprovals = []
        connectionFailure = failure
        error = failure.localizedDescription
        showsConnectionGuide = needsConnectionGuide
        scheduleReconnect(generation: disconnectedGeneration, after: failure)
        await client.disconnect(throughGeneration: disconnectedGeneration)
    }

    private func apply(_ library: ComputerLibrary) {
        computers = library.computers.sorted { $0.lastUsedAt > $1.lastUsedAt }
        activeComputer = computers.first { $0.id == library.activeId }
    }

    private func apply(_ detail: SessionDetail) async {
        let preparationStartedAt = ProcessInfo.processInfo.systemUptime
        detailApplicationRevision &+= 1
        let application = detailApplicationRevision
        let selection = sessionSelectionGeneration
        let connection = generation
        let watchID = currentWatchID
        var prepared: ConversationProjection
        while true {
            let revision = transcriptRevision
            prepared = await conversationProjector.project(
                current: transcript, incoming: detail.transcript, currentRows: transcriptRows,
                isRunning: detail.session.status == "running"
            )
            guard application == detailApplicationRevision, selection == sessionSelectionGeneration,
                  connection == generation, watchID == currentWatchID else { return }
            if revision == transcriptRevision { break }
        }
        let commitStartedAt = ProcessInfo.processInfo.systemUptime
        if selectedSession != detail.session { selectedSession = detail.session }
        if messages != detail.messages {
            messages = detail.messages
            contentRevision &+= 1
        }
        apply(prepared)
        if goal != detail.goal { goal = detail.goal }
        let tasks = detail.todos ?? []
        if todos != tasks { todos = tasks }
        if queuedMessages != detail.queuedMessages {
            queuedMessages = detail.queuedMessages
            queueRevision &+= 1
        }
        if planMode != detail.planMode { planMode = detail.planMode }
        if selectedModelId != detail.modelId { selectedModelId = detail.modelId }
        if selectedEffort != detail.reasoningEffort { selectedEffort = detail.reasoningEffort }
        if selectedPermissionId != detail.permissionId { selectedPermissionId = detail.permissionId }
        if selectedPresetId != detail.agentPreset { selectedPresetId = detail.agentPreset }
        if context != detail.context { context = detail.context }
        if trace != detail.trace { trace = detail.trace }
        if team != detail.team { team = detail.team }
        answeredApprovalIDs.formIntersection(Set(detail.approvals.map(\.id)))
        let pendingApprovals = detail.approvals.filter { !answeredApprovalIDs.contains($0.id) }
        if approvals != pendingApprovals { approvals = pendingApprovals }
        answeredQuestionIDs.formIntersection(Set(detail.questions.map(\.id)))
        let pendingQuestions = detail.questions.filter { !answeredQuestionIDs.contains($0.id) }
        if questions != pendingQuestions { questions = pendingQuestions }
        if let index = sessions.firstIndex(where: { $0.id == detail.session.id }),
           sessions[index] != detail.session {
            sessions[index] = detail.session
        }
        scheduleConversationSave()
        let completedAt = ProcessInfo.processInfo.systemUptime
        if completedAt - lastConversationMetricsAt >= 10 {
            lastConversationMetricsAt = completedAt
            DSBotLog.record(
                "chat.snapshot.prepare", elapsedMs: (commitStartedAt - preparationStartedAt) * 1_000,
                counts: ["messageCount": transcriptRows.count + messages.count]
            )
            DSBotLog.record("chat.snapshot.apply", elapsedMs: (completedAt - commitStartedAt) * 1_000)
        }
    }

    private func apply(_ projection: ConversationProjection) {
        if projection.transcriptChanged {
            transcript = projection.transcript
            transcriptRevision &+= 1
        }
        transcriptTimeSeparators = projection.timeSeparators
        if projection.rowsChanged {
            transcriptRows = projection.rows
            contentRevision &+= 1
        }
    }

    private var needsConnectionGuide: Bool {
        selectedSession == nil && !isChoosingWorkspace
    }

    private func restoreConversation(for computer: Computer?, generation currentGeneration: Int) async {
        guard let computer, currentGeneration == generation,
              conversationComputerID != computer.id else { return }
        if conversationComputerID != nil { clearConversation() }
        await conversationWriteTask?.value
        guard currentGeneration == generation else { return }
        let snapshot: ConversationSnapshot?
        do {
            snapshot = try await conversationStorage.load(for: computer.id)
        } catch {
            snapshot = nil
            DSBotLog.networkFailure("conversation.cache.restore.fail", error: error)
        }
        guard currentGeneration == generation else { return }
        activeComputer = computer
        conversationComputerID = computer.id
        guard let snapshot, snapshot.computerID == computer.id, snapshot.version == 1 else { return }
        isApplyingConversationCache = true
        defer { isApplyingConversationCache = false }
        sessions = snapshot.sessions
        workspaces = snapshot.workspaces
        models = snapshot.models
        permissions = snapshot.permissions
        presets = snapshot.presets
        messageDrafts = messageDrafts.filter { $0.key.computerID != computer.id }
        for (sessionID, text) in snapshot.drafts {
            messageDrafts[DraftTarget(computerID: computer.id, sessionID: sessionID)] = text
        }
        isChoosingWorkspace = snapshot.isChoosingWorkspace
        if !snapshot.isChoosingWorkspace, var detail = snapshot.detail {
            detail.approvals = []
            detail.questions = []
            await apply(detail)
        } else {
            selectedPresetId = snapshot.selectedPresetID
        }
        DSBotLog.record(
            "conversation.cache.restore",
            counts: ["messageCount": transcript == nil ? messages.count : transcriptRows.count]
        )
    }

    private func scheduleConversationSave() {
        guard !isApplyingConversationCache, conversationComputerID != nil else { return }
        conversationSaveTask?.cancel()
        conversationSaveTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: 350_000_000)
            } catch {
                return
            }
            self?.persistConversation()
        }
    }

    private func persistConversation() {
        conversationSaveTask?.cancel()
        conversationSaveTask = nil
        guard !isApplyingConversationCache, let computerID = conversationComputerID,
              computerID == activeComputer?.id else { return }
        let detail = selectedSession.map {
            SessionDetail(
                session: $0, messages: messages, modelId: selectedModelId, permissionId: selectedPermissionId,
                context: context, trace: trace, team: team, transcript: transcript, goal: goal, todos: todos,
                queuedMessages: queuedMessages,
                planMode: planMode, reasoningEffort: selectedEffort, agentPreset: selectedPresetId
            )
        }
        let drafts = Dictionary(uniqueKeysWithValues: messageDrafts.compactMap { target, text in
            target.computerID == computerID ? (target.sessionID, text) : nil
        })
        let snapshot = ConversationSnapshot(
            computerID: computerID, sessions: sessions, workspaces: workspaces, detail: detail,
            isChoosingWorkspace: isChoosingWorkspace, drafts: drafts,
            models: models, permissions: permissions, presets: presets, selectedPresetID: selectedPresetId
        )
        let precedingWrite = conversationWriteTask
        let storage = conversationStorage
        conversationWriteTask = Task {
            await precedingWrite?.value
            do {
                try await storage.save(snapshot)
            } catch {
                DSBotLog.networkFailure("conversation.cache.save.fail", error: error)
            }
        }
    }

    func flushConversationCache() async {
        persistConversation()
        await conversationWriteTask?.value
    }

    private func removeConversationCache(for computerID: String) async {
        messageDrafts = messageDrafts.filter { $0.key.computerID != computerID }
        let precedingWrite = conversationWriteTask
        let storage = conversationStorage
        let removal = Task {
            await precedingWrite?.value
            do {
                try await storage.remove(for: computerID)
            } catch {
                DSBotLog.networkFailure("conversation.cache.remove.fail", error: error)
            }
        }
        conversationWriteTask = removal
        await removal.value
    }

    private func clearConversation() {
        persistConversation()
        isStoppingSession = false
        planCommandID = nil
        isChangingPlanMode = false
        conversationComputerID = nil
        unavailableSessionID = nil
        sessionSelectionGeneration &+= 1
        currentWatchID = nil
        sessions = []
        selectedSession = nil
        isChoosingWorkspace = false
        messages = []
        transcript = nil
        transcriptTimeSeparators = [:]
        transcriptRows = []
        transcriptRevision &+= 1
        goal = nil
        todos = []
        queuedMessages = []
        updatingQueueItemID = nil
        planMode = false
        context = []
        trace = []
        team = []
        plugins = []
        schedules = []
        models = []
        permissions = []
        presets = []
        navigation = .empty
        navigationAvailability = .unknown
        selectedModelId = nil
        selectedEffort = nil
        selectedPermissionId = nil
        selectedPresetId = nil
        workspaces = []
        approvals = []
        questions = []
        answeredQuestionIDs = []
        historyLoadID = nil
        historyLoadTarget = nil
        isRespondingApprovals = []
        answeredApprovalIDs = []
        loadingTokens.removeAll()
        isLoading = false
        isLoadingSession = false
        libraryLoadIDs.removeAll()
        loadingLibrarySections = []
        libraryErrors = [:]
        sessionsLoadID = nil
        sessionsLoadTask?.cancel()
        sessionsLoadTask = nil
        isLoadingSessions = false
        sessionsError = nil
        catalogLoadID = nil
        catalogLoadTask?.cancel()
        catalogLoadTask = nil
        isLoadingCatalog = false
        catalogError = nil
        isSending = false
    }

    @discardableResult
    private func beginLoading() -> UUID {
        let token = UUID()
        loadingTokens.insert(token)
        isLoading = true
        return token
    }

    private func endLoading(_ token: UUID) {
        loadingTokens.remove(token)
        isLoading = !loadingTokens.isEmpty
    }

    private func nextGeneration() -> Int {
        generation &+= 1
        isStoppingSession = false
        planCommandID = nil
        isChangingPlanMode = false
        currentWatchID = nil
        isLoadingSession = false
        sessionsLoadID = nil
        sessionsLoadTask?.cancel()
        sessionsLoadTask = nil
        isLoadingSessions = false
        sessionsError = nil
        catalogLoadID = nil
        catalogLoadTask?.cancel()
        catalogLoadTask = nil
        isLoadingCatalog = false
        catalogError = nil
        reconnectTask?.cancel()
        reconnectTask = nil
        return generation
    }

    private func scheduleReconnect(generation expectedGeneration: Int, after failure: DSBotFailure? = nil) {
        guard failure?.shouldRetryConnection != false,
              isForeground, activeComputer != nil, reconnectTask == nil else { return }
        reconnectAttempt += 1
        let delay = min(30, 1 << min(reconnectAttempt - 1, 5))
        reconnectTask = Task { [weak self] in
            do {
                try await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000_000)
            } catch {
                return
            }
            guard let self,
                  self.isForeground,
                  self.generation == expectedGeneration else { return }
            self.reconnectTask = nil
            await self.start(activating: false)
        }
    }

    private func safeFailure(for error: Error) -> DSBotFailure {
        error as? DSBotFailure ?? .connectionFailed
    }

    private func safeMessage(for error: Error) -> String {
        safeFailure(for: error).localizedDescription
    }

    private func acquireOperation() async {
        if !operationHeld {
            operationHeld = true
            return
        }
        await withCheckedContinuation { continuation in
            operationWaiters.append(continuation)
        }
    }

    private func releaseOperation() {
        if operationWaiters.isEmpty {
            operationHeld = false
        } else {
            operationWaiters.removeFirst().resume()
        }
    }
}
