import Combine
import Foundation

private struct CatalogResult: Decodable, Sendable {
    var models: [Choice]
    var providers: [SessionProvider]?
    var permissions: [Choice]
    /// Agent presets ("modes"); desktops that predate them send none.
    var presets: [Choice]?
}

private struct AssistantSkillsResult: Decodable, Sendable { var skills: [AssistantSkill] }
private struct AssistantRecipientsResult: Decodable, Sendable { var outcome: String; var items: [AssistantRecipient] }

@MainActor
final class DuduStore: ObservableObject {
    @Published var computers: [Computer] = []
    @Published var activeComputer: Computer? {
        didSet {
            if oldValue?.id != activeComputer?.id {
                if hasForegroundConnectionFailure { hasForegroundConnectionFailure = false }
                loadedConversationTarget = nil
                submissionComputerChanged()
            }
        }
    }
    @Published var sessions: [SessionSummary] = []
    /// Who set the open session last (`select`: a row of a list, `detail`: what the computer answered, `cache`: what the app kept). The chat draws a turn as running or done by the status the session carries, so
    /// every change of it is written down with its source (owner, 2026-11-24: the phone said 已完成 while the desktop still ran the turn).
    private var sessionSource = "other"
    @Published var selectedSession: SessionSummary? {
        didSet {
            if oldValue?.id != selectedSession?.id {
                loadedConversationTarget = nil
                refreshSubmissionPresentation()
            }
            if oldValue?.id != selectedSession?.id || oldValue?.status != selectedSession?.status {
                let status = (selectedSession?.status ?? "none").filter { $0.isLetter || $0.isNumber }
                DuduLog.record("session.status", state: "\(sessionSource).\(status.prefix(16))")
            }
        }
    }
    @Published var messages: [ChatMessage] = []
    /// Structured chat from a transcript-capable desktop plugin; nil means render `messages`.
    @Published var transcript: Transcript?
    @Published var goal: SessionGoal?
    /// The conversation's task list (DSH's "任务" panel); empty when it has none.
    @Published var todos: [TodoItem] = []
    @Published private(set) var queuedMessages: [QueuedMessage] = []
    @Published private(set) var acceptedSubmissions: [AcceptedSubmission] = []
    private var submissionsByTarget: [DraftTarget: [AcceptedSubmission]] = [:]
    private var canceledRequestIds: Set<String> = []
    private var sendingSubmissionIDs: Set<String> = []
    private var sendingDraftTargets: [UUID: DraftTarget] = [:]
    private var observedSendingSubmissionIDs: Set<String> = []
    /// Navigation and watch generations do not cancel delivery to another session on this computer.
    private var submissionComputerRevision = 0
    private var sendConnectionWaiters: [UUID: CheckedContinuation<Void, Error>] = [:]
    /// How long a confirmed send waits for the normal snapshot-driven retirement before `scheduleDeliveryFallback` does it anyway.
    /// Not private: a test shortens it to run the fallback in milliseconds instead of two minutes.
    var deliveryFallbackSeconds: Double = 120
    /// Empty local arrays do not establish that the computer's conversation is empty.
    @Published private var loadedConversationTarget: DraftTarget?
    private var selectedDraftTarget: DraftTarget? {
        guard let computer = activeComputer?.id, let session = selectedSession?.id else { return nil }
        return DraftTarget(computerID: computer, sessionID: session)
    }
    var displayedQueuedMessages: [QueuedMessage] {
        guard !acceptedSubmissions.isEmpty else { return queuedMessages }
        return queuedMessages + acceptedSubmissions.filter { $0.placement == .queued }.map(\.queuedMessage)
    }
    var displayedTranscriptRows: [TranscriptRow] {
        guard !acceptedSubmissions.isEmpty else { return transcriptRows }
        return transcriptRows + acceptedSubmissions.filter { $0.placement == .transcript }.map(\.row)
    }
    @Published private(set) var updatingQueueItemID: String?
    private var queueRevision = 0
    @Published private(set) var questions: [ConversationQuestions] = []
    @Published private(set) var historyLoadTarget: DraftTarget?
    private var historyLoadID: UUID?
    private var answeredQuestionIDs: Set<String> = []
    @Published var planMode = false
    /// `transcript` folded into display rows; rebuilt only when its inputs change.
    @Published private(set) var transcriptRows: [TranscriptRow] = []
    @Published private(set) var conversationMarkdown = ConversationMarkdown.empty
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
    @Published private(set) var providers: [SessionProvider] = []
    @Published var permissions: [Choice] = []
    /// Agent presets DSH calls modes (标准模式, 创造模式, …).
    @Published var presets: [Choice] = []
    @Published var selectedModelId: String?
    @Published var selectedEffort: String?
    @Published var selectedPermissionId: String?
    @Published var selectedPresetId: String?
    @Published private(set) var pendingSessionConfiguration: SessionConfiguration?
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
    @Published var status: ConnectionStatus = .disconnected {
        didSet {
            if status == .connected, hasForegroundConnectionFailure { hasForegroundConnectionFailure = false }
            resumeSendConnectionWaiters()
        }
    }
    @Published var isLoading = false
    @Published private(set) var isLoadingSessions = false
    @Published private(set) var sessionsError: String?
    @Published private(set) var isLoadingCatalog = false
    @Published private(set) var catalogError: String?
    @Published private(set) var isLoadingSession = false
    @Published private(set) var isOpeningAssistant = false
    private var assistantRelayRetry: (signature: JSONValue, entryID: Int)?
    private var assistantRelayPending: (signature: JSONValue, requestID: String)?
    @Published private(set) var loadingLibrarySections: Set<String> = []
    @Published private(set) var libraryErrors: [String: String] = [:]
    @Published var isRestoring = true
    // Background suspension and reconnect attempts keep the current screen until failure is confirmed.
    @Published private(set) var showsConnectionGuide = false
    /// The computer of a first connection that failed, as the pairing link named it: nothing is saved then, and the page of the failure needs a row for it and a link to try again.
    /// In memory only (the link carries the pairing token): gone with the app, and when a computer is saved.
    @Published private(set) var failedPairing: PairingAttempt?
    @Published var isSending = false
    @Published private(set) var isChoosingProvider = false
    @Published private(set) var isStoppingSession = false
    @Published private(set) var isChangingPlanMode = false
    @Published var error: String?
    @Published var notice: String?
    @Published private(set) var connectionFailure: DuduFailure? {
        didSet {
            if connectionFailure != nil {
                if isForeground, !hasForegroundConnectionFailure, foregroundFailureNoticeTask == nil {
                    scheduleForegroundFailureNotice()
                }
            } else {
                foregroundFailureEpoch += 1
                foregroundFailureNoticeTask = nil
            }
            resumeSendConnectionWaiters()
        }
    }
    /// Retain a confirmed failure across retries, but never infer one from lifecycle suspension.
    @Published private var hasForegroundConnectionFailure = false
    private(set) var foregroundFailureNoticeTask: Task<Void, Never>?
    private var foregroundFailureEpoch = 0
    /// A Mac that was asleep answers again, on its own reconnect retries, within a handful of seconds (measured
    /// 2026-11-27: two real wake-from-sleep gaps cleared in 7.8 s and 9.0 s). Only a failure that outlives this grace
    /// period, counted from when the streak first began (a retry that fails again while already waiting does not
    /// restart the clock, or a long real outage would never surface), becomes the "电脑未连接" banner, so an
    /// ordinary wake-up does not flash it. Not private: a test shortens it to run in milliseconds instead of 8 s.
    var foregroundFailureNoticeSeconds: Double = 8
    var foregroundFailureNoticeDelay: @MainActor (Double) async -> Void = { seconds in
        try? await Task.sleep(for: .seconds(seconds))
    }
    private func scheduleForegroundFailureNotice() {
        foregroundFailureEpoch += 1
        let epoch = foregroundFailureEpoch
        foregroundFailureNoticeTask = Task { [weak self] in
            guard let delay = self?.foregroundFailureNoticeDelay,
                  let seconds = self?.foregroundFailureNoticeSeconds else { return }
            await delay(seconds)
            guard let self else { return }
            guard self.foregroundFailureEpoch == epoch, self.isForeground,
                  self.connectionFailure != nil, !self.hasForegroundConnectionFailure else { return }
            self.hasForegroundConnectionFailure = true
            self.foregroundFailureNoticeTask = nil
        }
    }
    var isComputerUnavailable: Bool {
        isForeground && activeComputer != nil && status != .connected
            && hasForegroundConnectionFailure && connectionFailure?.shouldRetryConnection != false
    }
    var messageDrafts: [DraftTarget: String] = [:] {
        didSet { scheduleConversationSave() }
    }
    private var submittedDrafts: [(id: UUID, target: DraftTarget, recovery: MessageDraftRecovery, requestID: String?)] = []
    var connectionRevision: Int { generation }
    var canReadConversation: Bool {
        status == .connected && currentWatchID != nil && !isLoadingSession
    }

    private let repository: any DuduComputerStorage
    private let client: any DuduTransport
    private let conversationStorage: any DuduConversationStorage
    private let networkMonitor: (any ConnectionNetworkMonitoring)?
    private let beforeRemovingComputer: ((Computer, DuduStore) async -> Void)?
    private var networkChangeTask: Task<Void, Never>?
    private let conversationImages = ConversationImageCache()
    private var conversationComputerID: String?
    private var recentConversationDetails: [SessionDetail] = []
    private var conversationSaveTask: Task<Void, Never>?
    private var conversationWriteTask: Task<Void, Never>?
    private var isApplyingConversationCache = false
    private var unavailableSessionID: String?
    private let json = DuduJSON()
    private var generation = 0
    private var sessionSelectionGeneration = 0 {
        didSet {
            isChoosingProvider = false
            pendingSessionConfiguration = nil
            canceledRequestIds = []
        }
    }
    private var loadingTokens: Set<UUID> = []
    private var operationHeld = false
    private var operationWaiters: [CheckedContinuation<Void, Never>] = []
    private var isForeground = false {
        didSet {
            if !isForeground, hasForegroundConnectionFailure { hasForegroundConnectionFailure = false }
            resumeSendConnectionWaiters()
        }
    }
    private var reconnectAttempt = 0
    private var reconnectTask: Task<Void, Never>?
    private var snapshotVersion = 0
    @Published private(set) var sessionReadPosition: SessionReadPosition?
    let visibleSessionReads = PassthroughSubject<VisibleSessionRead, Never>()
    let watchedSessionActivity = PassthroughSubject<WatchedSessionActivity, Never>()
    /// The computer says what the board shows has changed (a turn ended, something was read, an issue changed): read it again now. Once one has come, the computer is
    /// known to say so, and the board's own timer only has to be a safety net (`DuduRootView`).
    let boardChanges = PassthroughSubject<Void, Never>()
    private var boardPushGeneration = -1
    var boardPushSeen: Bool { boardPushGeneration == generation }
    private var readPositionSessionID: String?
    private var lastAcknowledgedRead: (target: DraftTarget, position: SessionReadPosition)?
    private var readVisitID = UUID()
    private var pendingReads: [UUID: SessionReadPosition] = [:]
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
            repository: ComputerRepository.shared, client: DuduHTTPClient(),
            conversationStorage: FileConversationStorage(), networkMonitor: ConnectionNetworkMonitor(),
            beforeRemovingComputer: { computer, store in await AppNotifications.shared.unregister(computer, using: store) }
        )
    }

    init(
        repository: any DuduComputerStorage,
        client: any DuduTransport,
        conversationStorage: any DuduConversationStorage = MemoryConversationStorage(),
        networkMonitor: (any ConnectionNetworkMonitoring)? = nil,
        beforeRemovingComputer: ((Computer, DuduStore) async -> Void)? = nil
    ) {
        self.repository = repository
        self.client = client
        self.conversationStorage = conversationStorage
        self.networkMonitor = networkMonitor
        self.beforeRemovingComputer = beforeRemovingComputer
        self.networkMonitor?.start { [weak self] in
            Task { @MainActor [weak self] in self?.networkPathChanged() }
        }
    }

#if DEBUG && targetEnvironment(simulator)
    /// For the simulator's review of the 「连接嘟嘟」 page of a computer that cannot be reached: a failure that is tried again never shows the page in the app (the board's red bar is what the person sees),
    /// so `-dudu-review-guide-unreachable` puts the state on it (`SimulatorReviewFixture`).
    func reviewShowUnreachableGuide() {
        status = .disconnected
        isRestoring = false
        connectionFailure = .routesUnavailable(onlyLAN: true)
        showsConnectionGuide = true
    }
#endif

    func resume() {
        isForeground = true
        let resumedLifecycle = lifecycleGeneration
        Task { [weak self] in
            guard let self, self.isForeground,
                  self.lifecycleGeneration == resumedLifecycle else { return }
            await self.start(activating: false, reportsFailure: false)
        }
    }

    func start(activating: Bool = true, reportsFailure: Bool = true) async {
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
            if reportsFailure { error = nil }
            DuduLog.record("computer.restore.begin", level: "info", state: "connecting")
            do {
                try await connectSaved(computer, generation: currentGeneration, lifecycle: "restore")
            } catch {
                guard currentGeneration == generation else { return }
                status = .disconnected
                if error is CancellationError {
                    DuduLog.record("computer.restore.cancelled", state: "disconnected")
                    scheduleReconnect(generation: currentGeneration)
                    return
                }
                connectionFailure = safeFailure(for: error)
                if !safeFailure(for: error).shouldRetryConnection {
                    self.error = safeMessage(for: error)
                }
                showsConnectionGuide = needsConnectionGuide
                DuduLog.record(
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
        let scanned = try ConnectionEndpoint.parse(link, name: name)
        let queuedLifecycle = lifecycleGeneration
        await acquireOperation()
        var releaseOnExit = true
        defer { if releaseOnExit { releaseOperation() } }
        guard isForeground, queuedLifecycle == lifecycleGeneration else {
            throw CancellationError()
        }

        let edited = computers.first { $0.computerId == scanned.computerId && $0.addressesEdited == true }
            .flatMap { try? ConnectionEndpoint.saved($0) }
        let endpoint = edited.flatMap {
            $0.token == scanned.token && $0.probeId == scanned.probeId ? $0 : nil
        } ?? scanned
        let previous = activeComputer
        let currentGeneration = nextGeneration()
        status = .connecting
        connectionFailure = nil
        error = nil
        clearConversation()
        DuduLog.record("pair.begin", state: "connecting")
        let attempt = PairingAttempt(link: link, endpoint: endpoint)

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
            guard currentGeneration == generation else { throw DuduFailure.switchedComputer }
            let resolved = await client.resolvedEndpoint() ?? endpoint
            let library = try await repository.pairAuthenticated(endpoint: resolved, readyId: ready.id)
            guard currentGeneration == generation else { throw DuduFailure.switchedComputer }
            apply(library)
            await restoreConversation(for: activeComputer, generation: currentGeneration)
            guard currentGeneration == generation else { throw DuduFailure.switchedComputer }
            status = .connected
            connectionFailure = nil
            error = nil
            showsConnectionGuide = false
            reconnectAttempt = 0
            DuduLog.record("pair.ready", counts: ["computerCount": computers.count], state: "connected")
            releaseOperation()
            releaseOnExit = false
            await loadInitialData(generation: currentGeneration)
        } catch {
            let failure = safeFailure(for: error)
            guard currentGeneration == generation else { throw DuduFailure.switchedComputer }
            await client.disconnect(throughGeneration: currentGeneration)
            status = .disconnected
            connectionFailure = failure
            self.error = safeMessage(for: failure)
            DuduLog.record("pair.fail", level: "warn", state: "disconnected", code: failure.logCode)
            if let previous {
                await restore(previous, generation: currentGeneration)
            } else {
                failedPairing = attempt
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
        DuduLog.record(
            "computer.switch.begin",
            counts: ["computerCount": computers.count],
            state: "connecting"
        )
        do {
            try await connectSaved(computer, generation: currentGeneration, lifecycle: "switch")
            DuduLog.record("computer.switch.ready", state: "connected")
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
            DuduLog.record("computer.switch.fail", level: "warn", state: "disconnected", code: failure.logCode)
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
        await beforeRemovingComputer?(computer, self)
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
            do { try await FileBoardStorage.shared.remove(for: computer.id) }
            catch { DuduLog.networkFailure("board.cache.remove.fail", error: error) }
            BoardFilterStore().remove(for: computer.id)
            await conversationImages.remove(for: computer.id)
            do { try await VideoPreviewStorage.shared.remove(for: computer.id) }
            catch { DuduLog.networkFailure("conversation.video.remove.fail", error: error) }
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

    /// Reuse the plugin's computer-scoped identity so cached history opens before any network
    /// request. Only an unknown assistant needs resolution; the ordinary watch refreshes history.
    func assistantSession() async -> SessionSummary? {
        guard status == .connected, !isOpeningAssistant else { return nil }
        if let computerID = conversationComputerID, computerID == activeComputer?.id {
            let isAssistant: (SessionSummary) -> Bool = {
                $0.isAssistant == true && $0.id != self.unavailableSessionID
            }
            if let cached = sessions.first(where: isAssistant)
                ?? selectedSession.flatMap({ isAssistant($0) ? $0 : nil })
                ?? recentConversationDetails.lazy.map(\.session).first(where: isAssistant) {
                DuduLog.record("assistant.open.cached")
                return cached
            }
        }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        isOpeningAssistant = true
        defer {
            if currentGeneration == generation { isOpeningAssistant = false }
        }
        do {
            let value = try await request("assistant.open")
            var session = try await json.decode(SessionSummary.self, from: value)
            session.isAssistant = true
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  !Task.isCancelled else { return nil }
            return session
        } catch {
            if currentGeneration == generation, currentSelection == sessionSelectionGeneration {
                self.error = featureMessage(for: error)
            }
            return nil
        }
    }

    var isAssistantConversation: Bool { selectedSession?.isAssistant == true }

    /// The lines of 嘟嘟's thread that the owner hid, by the sequence number of their event: the interface leaves them out (the plugin's answers add the ones hidden on another screen). Only for the assistant's own thread.
    @Published private(set) var hiddenSeqs = Set<Double>()
    private var shownHidden: Set<Double> { isAssistantConversation ? hiddenSeqs : [] }

    func assistantSkills() async throws -> [AssistantSkill] {
        guard let session = selectedSession, isAssistantConversation else { throw DuduFailure.switchedComputer }
        let target = sessionSelectionGeneration
        let value = try await request("assistant.skills", ["sessionId": .string(session.id)])
        let result = try await json.decode(AssistantSkillsResult.self, from: value)
        guard target == sessionSelectionGeneration else { throw DuduFailure.switchedComputer }
        return result.skills
    }

    func assistantRecipients(_ query: String) async throws -> [AssistantRecipient] {
        guard let session = selectedSession, isAssistantConversation else { throw DuduFailure.switchedComputer }
        let target = sessionSelectionGeneration
        let value = try await request("assistant.recipients", ["sessionId": .string(session.id), "q": .string(query)])
        let result = try await json.decode(AssistantRecipientsResult.self, from: value)
        guard target == sessionSelectionGeneration else { throw DuduFailure.switchedComputer }
        guard result.outcome == "success" else { throw DuduFailure.remote("UPSTREAM_UNAVAILABLE") }
        return result.items
    }

    /// The owner's 删除 on lines of 嘟嘟's thread (owner, 2026-11-10: "删除只是在会话界面删除这个消息，实际是没有删除"): the plugin keeps which lines are hidden, and nothing else is removed (the session's log
    /// and what 嘟嘟 was told stay). The lines leave the thread at once; one the plugin cannot hide comes back with a message in the app's ordinary words.
    @discardableResult
    func assistantHide(_ seqs: [Double]) async -> Bool {
        guard let session = selectedSession, isAssistantConversation, !seqs.isEmpty else { return false }
        let currentGeneration = generation
        let target = sessionSelectionGeneration
        let numbers = seqs.map { JSONValue.number($0) }
        hiddenSeqs.formUnion(seqs)
        await reprojectRows()
        do {
            let value = try await request("assistant.hide", ["sessionId": .string(session.id), "seqs": .array(numbers)])
            guard currentGeneration == generation, target == sessionSelectionGeneration else { return false }
            guard value["outcome"]?.stringValue == "success" else { throw DuduFailure.remote("UPSTREAM_UNAVAILABLE") }
            return true
        } catch {
            if currentGeneration == generation, target == sessionSelectionGeneration {
                hiddenSeqs.subtract(seqs)
                await reprojectRows()
                self.error = featureMessage(for: error)
            }
            return false
        }
    }

    /// The rows of the transcript that is open, built again (the set of hidden lines changed).
    private func reprojectRows() async {
        let selection = sessionSelectionGeneration
        while true {
            let revision = transcriptRevision
            let projection = await conversationProjector.project(
                current: nil, incoming: transcript, currentRows: transcriptRows,
                isRunning: selectedSession?.status == "running", hidden: shownHidden
            )
            guard selection == sessionSelectionGeneration else { return }
            if revision != transcriptRevision { continue }
            apply(projection)
            return
        }
    }

    /// Explicit @issue messages go to the desktop's routing action, without a turn in Dudu.
    /// A lost HTTP reply retries the same request; a saved-but-undelivered note retries its entry.
    private func forwardAssistant(
        text: String, recipient: AssistantRecipient?, images: [UploadAttachment],
        files: [UploadedFile]
    ) async throws {
        guard let session = selectedSession, let computerID = activeComputer?.id else { throw DuduFailure.disconnected }
        guard let addressed = AssistantCompletion.address(text), !addressed.body.isEmpty else {
            let code = AssistantCompletion.address(text) == nil ? "recipient_unavailable" : "empty_request"
            error = AssistantRelayResult(outcome: "needs_clarification", code: code).errorText
            throw DuduFailure.remote("BAD_REQUEST")
        }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        do {
            var params: [String: JSONValue] = [
                "sessionId": .string(session.id), "id": .string(addressed.id), "text": .string(addressed.body),
                "attachments": try await json.encode(images),
            ]
            if let recipient, recipient.address.lowercased() == addressed.id.lowercased() {
                params["session"] = .string(recipient.session)
            }
            params["files"] = .array(files.map { .object(["name": .string($0.name), "receiptId": .string($0.receiptId)]) })
            guard generation == currentGeneration, currentSelection == sessionSelectionGeneration,
                  activeComputer?.id == computerID else { throw DuduFailure.switchedComputer }
            let signature = JSONValue.object(["computerID": .string(computerID), "message": .object(params)])
            if let retry = assistantRelayRetry, retry.signature == signature {
                params["retryEntry"] = .number(Double(retry.entryID))
            }
            let pendingSignature = JSONValue.object(["message": signature, "retryEntry": params["retryEntry"] ?? .null])
            let requestID = assistantRelayPending?.signature == pendingSignature
                ? assistantRelayPending!.requestID : UUID().uuidString
            assistantRelayPending = (pendingSignature, requestID)
            params["requestId"] = .string(requestID)
            guard generation == currentGeneration, currentSelection == sessionSelectionGeneration else { throw DuduFailure.switchedComputer }
            let value = try await request("assistant.forward", params, timeoutSeconds: 180)
            let result = try await json.decode(AssistantRelayResult.self, from: value)
            guard generation == currentGeneration, currentSelection == sessionSelectionGeneration else { throw DuduFailure.switchedComputer }
            assistantRelayPending = nil
            if !result.succeeded {
                if result.saved == true, let id = result.entryId { assistantRelayRetry = (signature, id) }
                error = result.errorText
                throw DuduFailure.remote("DELIVERY_FAILED")
            }
            assistantRelayRetry = nil
        } catch {
            let failure = safeFailure(for: error)
            if currentSelection == sessionSelectionGeneration, activeComputer?.id == computerID,
               generation == currentGeneration || failure == .resultUnknown {
                if case .remote = failure { assistantRelayPending = nil }
                if case .remote("DELIVERY_FAILED") = failure {
                    // The desktop's exact delivery error is already displayed above.
                } else if let failure = error as? FileAttachments.LoadError {
                    self.error = FileAttachments.message(for: failure)
                } else { self.error = featureMessage(for: error) }
            }
            throw error
        }
    }

    func selectSession(_ session: SessionSummary, onPrepared: () -> Void = {}) async {
        guard let computerID = activeComputer?.id else {
            error = DuduFailure.disconnected.localizedDescription
            return
        }
        // Returning from Home is a new read visit even when the retained watch and content are identical.
        // A manual unread mark must not be hidden by the last visit's local acknowledgement cache.
        readVisitID = UUID()
        lastAcknowledgedRead = nil
        pendingReads = [:]
        if var current = selectedSession, current.id == session.id,
           currentWatchID != nil || status != .connected {
            if session.isAssistant == true, current.isAssistant != true {
                current.isAssistant = true
                selectedSession = current
            }
            onPrepared()
            return
        }
        let startedAt = ProcessInfo.processInfo.systemUptime
        let currentGeneration = generation
        let previousSession = selectedSession
        rememberCurrentConversation()
        sessionSelectionGeneration &+= 1
        let currentSelection = sessionSelectionGeneration
        let watchID = UUID().uuidString
        // Reserve this selection while local history prepares. A reconnect that
        // finishes meanwhile must not replace it with a second selection.
        currentWatchID = watchID
        let loadingToken = beginLoading()
        defer { endLoading(loadingToken) }
        isLoadingSession = true
        defer {
            if currentGeneration == generation, currentSelection == sessionSelectionGeneration {
                isLoadingSession = false
            }
        }
        sessionSource = "select"
        selectedSession = session
        unavailableSessionID = nil
        isStoppingSession = false
        planCommandID = nil
        isChangingPlanMode = false
        isChoosingWorkspace = false
        refreshSubmissionPresentation()
        error = nil
        if previousSession?.id != session.id {
            messages = []
            transcript = nil
            transcriptTimeSeparators = [:]
            transcriptRows = []
            conversationMarkdown = .empty
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
        if previousSession?.id != session.id,
           var cached = recentConversationDetails.first(where: { $0.session.id == session.id }) {
            cached.session = session
            await apply(cached)
            guard activeComputer?.id == computerID, currentSelection == sessionSelectionGeneration else { return }
        }
        // Navigation may now lay out the cached history, without waiting for the remote watch.
        onPrepared()
        scheduleConversationSave()
        guard currentGeneration == generation, status == .connected else {
            if currentWatchID == watchID { currentWatchID = nil }
            DuduLog.record(
                "session.select.local",
                elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000,
                state: status.rawValue
            )
            return
        }
        do {
            // session.watch replaces the prior watch without waiting for its stream to close.
            var parameters = session.historyParameters
            parameters["watchId"] = .string(watchID)
            parameters["transcript"] = .bool(true)
            let result = try await request("session.watch", parameters)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  currentWatchID == watchID else { return }
            let detail = try await json.decode(SessionDetail.self, from: result)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  currentWatchID == watchID else { return }
            guard detail.session.id == session.id else { throw DuduFailure.protocolError }
            if snapshotVersion == openingSnapshotVersion {
                await apply(detail)
            }
            error = nil
            DuduLog.record(
                "session.select.ready",
                elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000,
                counts: ["messageCount": transcript == nil ? messages.count : transcriptRows.count]
            )
        } catch {
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  currentWatchID == watchID else { return }
            currentWatchID = nil
            if case .remote("NOT_FOUND") = safeFailure(for: error) { unavailableSessionID = session.id }
            self.error = safeMessage(for: error)
            DuduLog.record(
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
        guard let sessionID = selectedSession?.id else { throw DuduFailure.disconnected }
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
            error = DuduFailure.disconnected.localizedDescription
            return
        }
        guard selectedSession != nil || !isChoosingWorkspace else { return }
        rememberCurrentConversation()
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
        conversationMarkdown = .empty
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
                    DuduLog.networkFailure("session.unwatch.fail", error: error)
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
        let model = isChoosingWorkspace ? selectedModelId ?? currentProvider?.defaultModelId : nil
        await createSession(
            workspaceId: workspaceId,
            agentPreset: isChoosingWorkspace && usesAgentPresets ? selectedPresetId : nil,
            reusing: blank?.id,
            modelId: model
        )
    }

    /// An empty conversation of a workspace, which a new task can reuse instead of adding another.
    func blankSession(in workspaceId: String) -> SessionSummary? {
        sessions.first { $0.blank == true && $0.workspaceId == workspaceId }
    }

    /// The mode picked on the new-task home; it is applied when the conversation is created.
    func chooseDraftPreset(_ presetId: String) {
        guard isChoosingWorkspace, usesAgentPresets, presets.contains(where: { $0.id == presetId }) else { return }
        selectedPresetId = presetId
    }

    func createSession(workspaceId: String? = nil, agentPreset: String? = nil, reusing blankId: String? = nil, modelId: String? = nil) async {
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        var params: [String: JSONValue] = [:]
        if let workspaceId { params["workspaceId"] = .string(workspaceId) }
        if let agentPreset { params["agentPreset"] = .string(agentPreset) }
        if let blankId { params["reuse"] = .string(blankId) }
        if let modelId { params["modelId"] = .string(modelId) }
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
        if isAssistantConversation { return false }
        guard let session = selectedSession, !isLoadingSession, session.status == "idle",
              loadedConversationTarget != nil, loadedConversationTarget == selectedDraftTarget,
              session.blank != false, transcript?.hasMore != true else { return false }
        guard acceptedSubmissions.isEmpty, (transcript?.pendingInputs ?? []).isEmpty else { return false }
        return transcript != nil ? (transcript?.entries.isEmpty ?? true) : messages.isEmpty
    }

    /// The model the open conversation runs and its reasoning levels, when the host lists them.
    var currentModel: Choice? { models.first { $0.id == selectedModelId } }
    var currentProvider: SessionProvider? {
        if let selectedModelId, let provider = providers.first(where: { $0.modelIds.contains(selectedModelId) }) { return provider }
        if let agent = selectedSession?.agent, let provider = providers.first(where: { $0.id == agent.rawValue }) { return provider }
        return providers.first { $0.isDefault == true } ?? providers.first
    }
    var usesAgentPresets: Bool {
        (currentProvider?.id ?? selectedSession?.agent?.rawValue ?? "deepseek") == "deepseek"
    }
    var currentProviderModels: [Choice] {
        if isAssistantConversation {
            let ids = Set(providers.filter { $0.id == "deepseek" }.flatMap(\.modelIds))
            return models.filter { ids.contains($0.id) }
        }
        guard let provider = currentProvider else { return models }
        return models.filter { provider.modelIds.contains($0.id) }
    }
    var currentModelGroups: [ModelSourceGroup] { ModelSourceGroup.groups(currentProviderModels) }
    var currentModelName: String? {
        guard let currentModel else { return nil }
        let source = currentModelGroups.first { $0.id == currentModel.modelSourceID }?.name ?? currentModel.modelSourceName
        return currentProviderModels.filter { $0.name == currentModel.name }.count > 1
            ? "\(currentModel.name) · \(source)"
            : currentModel.name
    }

    func chooseProvider(_ id: String) async {
        guard !isChoosingProvider, !isSending, isChoosingWorkspace || isBlankSession,
              id != currentProvider?.id,
              let provider = providers.first(where: { $0.id == id }),
              models.contains(where: { $0.id == provider.defaultModelId }) else { return }
        if isChoosingWorkspace {
            selectedModelId = provider.defaultModelId
            selectedEffort = models.first { $0.id == provider.defaultModelId }?.defaultEffort
        } else {
            let currentGeneration = generation
            let currentSelection = sessionSelectionGeneration
            isChoosingProvider = true
            defer {
                if currentGeneration == generation, currentSelection == sessionSelectionGeneration {
                    isChoosingProvider = false
                }
            }
            await configure(modelId: provider.defaultModelId)
        }
    }
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

    func send(
        text: String, attachments: [UploadAttachment] = [], files: [UploadedFile] = [],
        assistantRecipient: AssistantRecipient? = nil,
        draftText: String? = nil, onSubmitted: (() -> Void)? = nil
    ) async throws {
        guard let selectedSession, let computerID = activeComputer?.id else { throw DuduFailure.disconnected }
        guard !isSending, !isChoosingProvider else { throw DuduFailure.remote("BUSY") }
        let target = DraftTarget(computerID: computerID, sessionID: selectedSession.id)
        let draftID = UUID()
        sendingDraftTargets[draftID] = target
        refreshSubmissionPresentation()
        defer {
            sendingDraftTargets.removeValue(forKey: draftID)
            refreshSubmissionPresentation()
        }
        if let draftText {
            submittedDrafts.append((draftID, target, MessageDraftRecovery(text: draftText), nil))
        }
        // Hand the draft to the outgoing message in the same main-actor turn as its echo.
        // Keep a recovery copy in the durable draft until delivery is known.
        onSubmitted?()
        do {
            if isAssistantConversation, text.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("@") {
                try await forwardAssistant(text: text, recipient: assistantRecipient, images: attachments, files: files)
            } else {
                try await sendConversation(text: text, attachments: attachments, files: files, draftID: draftID)
            }
            finishSubmittedDraft(draftID, restoring: false)
        } catch {
            finishSubmittedDraft(draftID, restoring: true)
            throw error
        }
    }

    private func finishSubmittedDraft(_ id: UUID, restoring: Bool) {
        guard let index = submittedDrafts.firstIndex(where: { $0.id == id }) else { return }
        let submitted = submittedDrafts.remove(at: index)
        if restoring {
            messageDrafts[submitted.target] = submitted.recovery.restoring(before: messageDrafts[submitted.target])
            DuduLog.record("message.draft.restored", requestId: submitted.requestID)
        }
        scheduleConversationSave()
    }

    private func sendConversation(
        text: String, attachments: [UploadAttachment], files: [UploadedFile], draftID: UUID
    ) async throws {
        guard let selectedSession, let target = selectedDraftTarget else { throw DuduFailure.disconnected }
        let computerRevision = submissionComputerRevision
        let sessionId = selectedSession.id
        let submission = AcceptedSubmission(
            requestId: UUID().uuidString, text: text, time: Date().timeIntervalSince1970 * 1_000,
            placement: selectedSession.status == "running" ? .queued : .transcript,
            images: attachments, files: files
        )
        if let index = submittedDrafts.firstIndex(where: { $0.id == draftID }) {
            submittedDrafts[index].requestID = submission.requestId
        }
        // Ordinary disconnects retain this echo and its recovery draft. The existing connection
        // lifecycle wakes the send; every attempt carries the same id for DSH's durable deduplication.
        sendingSubmissionIDs.insert(submission.requestId)
        setSubmissions(submissionsByTarget[target, default: []] + [submission], for: target)
        DuduLog.record("message.delivery.pending", requestId: submission.requestId, state: status.rawValue)
        defer {
            sendingSubmissionIDs.remove(submission.requestId)
            observedSendingSubmissionIDs.remove(submission.requestId)
        }
        do {
            var attachmentItems = try await json.encode(attachments).arrayValue ?? []
            attachmentItems += files.map { .object(["receiptId": .string($0.receiptId), "name": .string($0.name)]) }
            let attachmentValue = JSONValue.array(attachmentItems)
            guard computerRevision == submissionComputerRevision else {
                throw DuduFailure.switchedComputer
            }
            let params: [String: JSONValue] = [
                "id": .string(sessionId),
                "requestId": .string(submission.requestId),
                "text": .string(text),
                "attachments": attachmentValue
            ]
            while true {
                try await waitForSendConnection(computerRevision: computerRevision, requestID: submission.requestId)
                if observedSendingSubmissionIDs.contains(submission.requestId) { return }
                let attemptGeneration = generation
                do {
                    DuduLog.record("message.delivery.attempt", requestId: submission.requestId)
                    let receipt = try await request("session.send", params)
                    guard computerRevision == submissionComputerRevision else {
                        retire(submission, target: target)
                        return
                    }
                    // Older plugins cannot reconcile an echo by its request identity.
                    if receipt["requestId"]?.stringValue != submission.requestId { retire(submission, target: target) }
                    DuduLog.record("message.delivery.accepted", requestId: submission.requestId)
                    scheduleDeliveryFallback(submission, target: target)
                    return
                } catch {
                    if observedSendingSubmissionIDs.contains(submission.requestId) { return }
                    try Task.checkCancellation()
                    let failure = safeFailure(for: error)
                    guard computerRevision == submissionComputerRevision,
                          failure.isConnectionInterruption || failure == .switchedComputer else { throw error }
                    // A transport normally invalidates its failed route first. If it did not,
                    // hand the failure to the same reconnect lifecycle rather than retrying in a loop.
                    if generation == attemptGeneration, status == .connected {
                        await handleDisconnect(generation: attemptGeneration, failure: failure)
                    }
                }
            }
        } catch {
            retire(submission, target: target)
            // A watch can confirm admission (or cancellation) before a lost HTTP reply.
            // That message must not be put back into the composer as an unsent draft.
            if observedSendingSubmissionIDs.contains(submission.requestId) { return }
            let failure = safeFailure(for: error)
            DuduLog.record("message.delivery.fail", level: "warn", requestId: submission.requestId, code: failure.logCode)
            if computerRevision == submissionComputerRevision,
               selectedDraftTarget == target,
               !(error is CancellationError) {
                self.error = safeMessage(for: failure)
            }
            throw failure
        }
    }

    /// Suspend a send without polling. Reconnect, foregrounding, confirmation or a destination
    /// change resumes it. Session navigation keeps delivery addressed to the original target;
    /// a genuine change of computer restores its unconfirmed drafts.
    private func waitForSendConnection(computerRevision: Int, requestID: String) async throws {
        while true {
            try Task.checkCancellation()
            guard computerRevision == submissionComputerRevision else { throw DuduFailure.switchedComputer }
            if observedSendingSubmissionIDs.contains(requestID) { return }
            if let failure = connectionFailure, !failure.shouldRetryConnection { throw failure }
            if isForeground, status == .connected { return }
            let id = UUID()
            try await withTaskCancellationHandler {
                try Task.checkCancellation()
                try await withCheckedThrowingContinuation { continuation in
                    sendConnectionWaiters[id] = continuation
                }
            } onCancel: {
                Task { @MainActor [weak self] in
                    self?.sendConnectionWaiters.removeValue(forKey: id)?.resume(throwing: CancellationError())
                }
            }
        }
    }

    private func resumeSendConnectionWaiters() {
        let waiters = sendConnectionWaiters.values
        sendConnectionWaiters.removeAll()
        for waiter in waiters { waiter.resume() }
    }

    private func submissionComputerChanged() {
        submissionComputerRevision &+= 1
        submissionsByTarget = [:]
        sendingDraftTargets = [:]
        if !acceptedSubmissions.isEmpty { acceptedSubmissions = [] }
        isSending = false
        resumeSendConnectionWaiters()
    }

    private func refreshSubmissionPresentation() {
        let submissions = selectedDraftTarget.flatMap { submissionsByTarget[$0] } ?? []
        if acceptedSubmissions != submissions {
            acceptedSubmissions = submissions
            contentRevision &+= 1
        }
        let sending = selectedDraftTarget.map { sendingDraftTargets.values.contains($0) } ?? false
        if isSending != sending { isSending = sending }
    }

    private func setSubmissions(_ submissions: [AcceptedSubmission], for target: DraftTarget) {
        submissionsByTarget[target] = submissions.isEmpty ? nil : submissions
        refreshSubmissionPresentation()
    }

    /// A sent message stops being shown as an echo: its send failed, or the host answered without the request identity its snapshot would retire it by.
    private func retire(_ submission: AcceptedSubmission, target: DraftTarget) {
        guard let submissions = submissionsByTarget[target], submissions.contains(where: { $0.requestId == submission.requestId }) else { return }
        setSubmissions(submissions.filter { $0.requestId != submission.requestId }, for: target)
    }

    /// Normally a fresh snapshot names this request among its entries, pending inputs or queue within moments and
    /// `apply(_:)` retires the echo itself (2181-2188 there). But that only runs for the conversation currently open,
    /// and a connection that keeps dropping (owner, 2026-11-20: a message stayed "sending" for ten minutes although
    /// the computer already had it) can keep missing it. The plugin's own receipt, matched on this request's id, is
    /// proof enough that the message is not actually still sending; this backstops the snapshot path without racing
    /// ahead of it in the common case where the snapshot already arrives well inside this window.
    private func scheduleDeliveryFallback(_ submission: AcceptedSubmission, target: DraftTarget) {
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(deliveryFallbackSeconds))
            guard let self else { return }
            guard let submissions = self.submissionsByTarget[target],
                  submissions.contains(where: { $0.requestId == submission.requestId }) else { return }
            DuduLog.record("message.delivery.fallback", level: "warn", requestId: submission.requestId)
            self.retire(submission, target: target)
        }
    }

    func updateQueuedMessage(_ message: QueuedMessage, action: String, text: String? = nil) async throws {
        guard let session = selectedSession, updatingQueueItemID == nil,
              queuedMessages.contains(where: { $0.id == message.id }) else {
            throw DuduFailure.remote("NOT_FOUND")
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
            throw DuduFailure.switchedComputer
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
        if attachmentID.hasPrefix("submission:") {
            for submission in acceptedSubmissions {
                if let index = submission.attachments.firstIndex(where: { $0.id == attachmentID }),
                   index < submission.images.count {
                    return await conversationImages.prepareSubmission(submission.images[index], fullSize: fullSize)
                }
            }
            return nil
        }
        guard let key = ConversationImageKey(target: target, attachment: attachment) else { return nil }
        let isMarkdown = attachment.kind == "markdown"
        let currentGeneration = generation
        do {
            if let cached = try await conversationImages.load(key, fullSize: fullSize) {
                guard !Task.isCancelled, currentGeneration == generation,
                      target.computerID == activeComputer?.id, target.sessionID == selectedSession?.id else { return nil }
                return cached
            }
            guard !Task.isCancelled, canReadConversation, target.computerID == activeComputer?.id,
                  target.sessionID == selectedSession?.id else { return nil }
            var parameters: [String: JSONValue] = [
                "id": .string(target.sessionID),
                isMarkdown ? "source" : "attachmentId": .string(attachmentID)
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
            DuduLog.networkFailure("conversation.image.load.fail", error: error)
            self.error = error is ConversationStorageError
                ? DuduFailure.protocolError.localizedDescription : safeMessage(for: error)
            return nil
        }
    }

    /// Runs one allowlisted DSH command for the open session. Returns nil (and sets `error`) when the
    /// desktop could not be reached or does not know the command yet.
    /// An editor owns its failure display; other commands use the conversation's result overlay.
    func runCommand(
        _ command: SessionCommand, argument: String? = nil, onFailure: ((String) -> Void)? = nil
    ) async -> CommandOutcome? {
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
                throw DuduFailure.protocolError
            }
            DuduLog.record("session.command", state: command.rawValue)
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
                let message = featureMessage(for: error)
                if let onFailure { onFailure(message) }
                else { self.error = message }
            }
            return nil
        }
    }

    private func refreshSessionWatch(sessionID: String, generation currentGeneration: Int, selection currentSelection: Int) async {
        let watchID = UUID().uuidString
        currentWatchID = watchID
        let openingSnapshotVersion = snapshotVersion
        do {
            guard let session = selectedSession, session.id == sessionID else { return }
            var parameters = session.historyParameters
            parameters["watchId"] = .string(watchID)
            parameters["transcript"] = .bool(true)
            let result = try await request("session.watch", parameters)
            let detail = try await json.decode(SessionDetail.self, from: result)
            guard currentGeneration == generation, currentSelection == sessionSelectionGeneration,
                  currentWatchID == watchID, selectedSession?.id == sessionID else { return }
            guard detail.session.id == sessionID else { throw DuduFailure.protocolError }
            if snapshotVersion == openingSnapshotVersion { await apply(detail) }
        } catch {
            guard currentGeneration == generation, currentSelection == sessionSelectionGeneration,
                  currentWatchID == watchID, selectedSession?.id == sessionID else { return }
            DuduLog.networkFailure("session.watch.refresh.fail", error: error)
            await handleDisconnect(generation: currentGeneration, failure: safeFailure(for: error))
        }
    }

    /// Stages a file from the phone on the desktop for the next prompt of the open session.
    func uploadFile(_ file: PickedFile) async throws -> UploadedFile {
        guard let selectedSession, status == .connected else { throw DuduFailure.disconnected }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        let sessionId = selectedSession.id
        do {
            let value = try await client.uploadFile(file, sessionID: sessionId)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  self.selectedSession?.id == sessionId else { throw DuduFailure.switchedComputer }
            guard let object = value.objectValue,
                  let receiptId = object["receiptId"]?.stringValue, !receiptId.isEmpty,
                  let bytes = object["bytes"]?.numberValue, bytes == Double(file.bytes) else {
                throw DuduFailure.protocolError
            }
            DuduLog.record("file.upload", counts: ["payloadBytes": file.bytes])
            return UploadedFile(
                receiptId: receiptId,
                name: object["name"]?.stringValue ?? file.name,
                bytes: file.bytes
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
            return L10n.text("请更新电脑端的 Dudu 插件")
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
        DuduLog.record(allow ? "approval.allow" : "approval.deny")
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

    func refreshSessions(requiringNewRequest: Bool = false, quiet: Bool = false) async {
        let currentGeneration = generation
        if let sessionsLoadTask {
            await sessionsLoadTask.value
            guard requiringNewRequest, currentGeneration == generation else { return }
        }
        let loadID = UUID()
        sessionsLoadID = loadID
        if !quiet {
            isLoadingSessions = true
            sessionsError = nil
        }
        let task = Task { @MainActor in
            await self.performSessionRefresh(generation: currentGeneration, loadID: loadID, quiet: quiet)
        }
        sessionsLoadTask = task
        await task.value
    }

    private func performSessionRefresh(generation currentGeneration: Int, loadID: UUID, quiet: Bool) async {
        let loadingToken = quiet ? nil : beginLoading()
        defer {
            if let loadingToken { endLoading(loadingToken) }
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
            let ordered = values.sorted { $0.updatedAt > $1.updatedAt }
            if sessions != ordered {
                sessions = ordered
                scheduleConversationSave()
            }
            sessionsError = nil
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
              status == .connected else { throw DuduFailure.disconnected }
        let requestGeneration = generation
        let selection = sessionSelectionGeneration
        var params = parameters
        params["id"] = .string(target.sessionID)
        let result = try await request(method, params)
        guard requestGeneration == generation, selection == sessionSelectionGeneration,
              activeComputer?.id == target.computerID, selectedSession?.id == target.sessionID else {
            throw DuduFailure.switchedComputer
        }
        return result
    }

    func downloadConversationVideo(_ parameters: [String: JSONValue], target: DraftTarget) async throws -> URL {
        guard activeComputer?.id == target.computerID, selectedSession?.id == target.sessionID,
              status == .connected else { throw DuduFailure.disconnected }
        let requestGeneration = generation
        let selection = sessionSelectionGeneration
        var params = parameters
        params["id"] = .string(target.sessionID)
        let url = try await client.downloadVideo(params)
        guard requestGeneration == generation, selection == sessionSelectionGeneration,
              activeComputer?.id == target.computerID, selectedSession?.id == target.sessionID else {
            await VideoPreviewStorage.shared.removeDownload(url)
            throw DuduFailure.switchedComputer
        }
        return url
    }

    /// `beforeApply` runs once the page is in hand and before it is worked into the conversation: the history view uses it to wait until it is at rest.
    /// `willApply` runs in the same turn as `apply`, with nothing in between: the history view raises its flag there, so that no layout between the wait and the page can lower it.
    func loadEarlierHistory(target: DraftTarget, beforeApply: (() async -> Void)? = nil, willApply: (() -> Void)? = nil) async throws {
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
        guard let previous = page.transcript.beforeSeq, previous < before else { throw DuduFailure.protocolError }
        await beforeApply?()
        while true {
            let revision = transcriptRevision
            let projection = await conversationProjector.project(
                current: transcript, incoming: page.transcript, currentRows: transcriptRows,
                isRunning: selectedSession?.status == "running", prepending: true,
                additionalMarkdown: questions.flatMap { $0.questions.compactMap(\.detail) } +
                    approvals.compactMap(\.detail),
                hidden: shownHidden
            )
            guard !Task.isCancelled, connection == generation, watchID == currentWatchID,
                  selection == sessionSelectionGeneration,
                  activeComputer?.id == target.computerID, selectedSession?.id == target.sessionID else { return }
            guard revision == transcriptRevision else { continue }
            willApply?()
            apply(projection)
            break
        }
        scheduleConversationSave()
    }

    func answerQuestions(_ batch: ConversationQuestions, answers: [ConversationAnswer], target: DraftTarget) async throws {
        guard batch.sessionId == target.sessionID, questions.contains(where: { $0.id == batch.id }) else {
            throw DuduFailure.remote("STALE_APPROVAL")
        }
        let encoded = try await json.encode(answers)
        _ = try await conversationRequest("question.answer", parameters: [
            "callId": .string(batch.id), "answers": encoded
        ], target: target)
        answeredQuestionIDs.insert(batch.id)
        questions.removeAll { $0.id == batch.id }
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
            default: throw DuduFailure.unsupportedRequest
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

    @discardableResult
    func configure(
        modelId: String? = nil,
        permissionId: String? = nil,
        reasoningEffort: String? = nil,
        agentPreset: String? = nil,
        onFailure: ((String) -> Void)? = nil
    ) async -> Bool {
        guard let selectedSession, pendingSessionConfiguration == nil else { return false }
        guard modelId != nil || permissionId != nil || reasoningEffort != nil || agentPreset != nil else { return false }
        let currentGeneration = generation
        let currentSelection = sessionSelectionGeneration
        let sessionId = selectedSession.id
        let configuration = SessionConfiguration(
            modelId: modelId, permissionId: permissionId, reasoningEffort: reasoningEffort, agentPreset: agentPreset
        )
        pendingSessionConfiguration = configuration
        defer {
            if pendingSessionConfiguration?.id == configuration.id { pendingSessionConfiguration = nil }
        }
        var params: [String: JSONValue] = ["id": .string(sessionId)]
        if let modelId {
            params["modelId"] = .string(modelId)
            if isAssistantConversation, modelId == selectedModelId, reasoningEffort == nil, let effort = effectiveEffort {
                params["reasoningEffort"] = .string(effort)
            }
        }
        if let permissionId { params["permissionId"] = .string(permissionId) }
        if let reasoningEffort { params["reasoningEffort"] = .string(reasoningEffort) }
        if let agentPreset { params["agentPreset"] = .string(agentPreset) }
        do {
            _ = try await request("session.configure", params)
            guard currentGeneration == generation,
                  currentSelection == sessionSelectionGeneration,
                  self.selectedSession?.id == sessionId else { return false }
            if let modelId {
                let preserveEffort = isAssistantConversation && modelId == selectedModelId
                selectedModelId = modelId
                // A new model starts at its own default level.
                if !preserveEffort { selectedEffort = models.first { $0.id == modelId }?.defaultEffort }
            }
            if let reasoningEffort { selectedEffort = reasoningEffort }
            if let permissionId { selectedPermissionId = permissionId }
            if let agentPreset { selectedPresetId = agentPreset }
            error = nil
            scheduleConversationSave()
            await refreshSessionWatch(sessionID: sessionId, generation: currentGeneration, selection: currentSelection)
            return currentGeneration == generation && currentSelection == sessionSelectionGeneration
                && self.selectedSession?.id == sessionId
        } catch {
            if currentGeneration == generation,
               currentSelection == sessionSelectionGeneration,
               self.selectedSession?.id == sessionId {
                let message = featureMessage(for: error)
                if let onFailure { onFailure(message) }
                else { self.error = message }
            }
            return false
        }
    }

    func request(
        _ method: String,
        _ params: [String: JSONValue] = [:],
        timeoutSeconds: UInt64 = 30
    ) async throws -> JSONValue {
        guard status == .connected else { throw DuduFailure.disconnected }
        let currentGeneration = generation
        let value = try await client.request(method, params: params, timeoutSeconds: timeoutSeconds)
        guard currentGeneration == generation, status == .connected else {
            throw DuduFailure.switchedComputer
        }
        return value
    }

    func reconnect(automatically: Bool = false) async {
        guard status != .connecting else { return }
        let reconnectLifecycle = lifecycleGeneration
        let reconnectGeneration = nextGeneration()
        status = .connecting
        connectionFailure = nil
        await client.disconnect(throughGeneration: reconnectGeneration)
        guard isForeground, reconnectLifecycle == lifecycleGeneration else { return }
        await start(activating: false, reportsFailure: !automatically)
    }

    private func networkPathChanged() {
        networkChangeTask?.cancel()
        guard isForeground, activeComputer != nil else { return }
        networkChangeTask = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            // Only the debounce is cancellable by another callback. Cancelling this
            // task after connect begins aborts probes and produces a false failure.
            guard let self else { return }
            self.networkChangeTask = nil
            guard self.isForeground, self.status != .connecting else { return }
            DuduLog.record("network.path.changed")
            await self.reconnect(automatically: true)
        }
    }

    func updateConnectionAddresses(_ computer: Computer, addresses: [ConnectionAddress]) async throws {
        let editLifecycle = lifecycleGeneration
        await acquireOperation()
        var releaseOnExit = true
        defer { if releaseOnExit { releaseOperation() } }
        guard isForeground, lifecycleGeneration == editLifecycle,
              let current = computers.first(where: { $0.id == computer.id }) else {
            throw DuduFailure.switchedComputer
        }
        let editGeneration = generation
        var endpoint = try ConnectionEndpoint.saved(current)
        endpoint.addresses = try ConnectionAddress.validated(addresses)
        endpoint.addressesEdited = true
        let verified = try await client.verifyEndpoint(endpoint)
        guard generation == editGeneration, lifecycleGeneration == editLifecycle else {
            throw DuduFailure.switchedComputer
        }
        let library = try await repository.updateAddresses(localId: computer.id, endpoint: verified)
        guard generation == editGeneration else { throw DuduFailure.switchedComputer }
        apply(library)
        guard activeComputer?.id == computer.id else { return }
        let currentGeneration = nextGeneration()
        status = .connecting
        connectionFailure = nil
        error = nil
        do {
            guard let updated = activeComputer else { throw DuduFailure.switchedComputer }
            try await connectSaved(updated, generation: currentGeneration, lifecycle: "edit")
        } catch {
            guard generation == currentGeneration else { throw DuduFailure.switchedComputer }
            status = .disconnected
            connectionFailure = safeFailure(for: error)
            showsConnectionGuide = needsConnectionGuide
            scheduleReconnect(generation: currentGeneration, after: safeFailure(for: error))
            throw error
        }
        releaseOperation()
        releaseOnExit = false
        await loadInitialData(generation: currentGeneration)
    }

    func suspend() {
        persistConversation()
        isForeground = false
        lifecycleGeneration &+= 1
        reconnectTask?.cancel()
        reconnectTask = nil
        networkChangeTask?.cancel()
        networkChangeTask = nil
        let suspendedGeneration = nextGeneration()
        sessionSelectionGeneration &+= 1
        refreshSubmissionPresentation()
        isRespondingApprovals = []
        status = .disconnected
        Task { await client.disconnect(throughGeneration: suspendedGeneration) }
        DuduLog.record("network.suspend", state: "disconnected")
    }

    private func connectSaved(
        _ computer: Computer,
        generation currentGeneration: Int,
        lifecycle: String
    ) async throws {
        let endpoint = try ConnectionEndpoint.saved(computer)
        if let savedId = computer.computerId,
           let qrId = endpoint.computerId,
           savedId != qrId {
            throw DuduFailure.identityMismatch
        }
        let expectedId = computer.computerId ?? endpoint.computerId
        await restoreConversation(for: computer, generation: currentGeneration)
        guard currentGeneration == generation else { throw DuduFailure.switchedComputer }
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
        guard currentGeneration == generation else { throw DuduFailure.switchedComputer }
        let library: ComputerLibrary
        do {
            let resolved = await client.resolvedEndpoint() ?? endpoint
            library = try await repository.activateAuthenticated(localId: computer.id, readyId: ready.id, endpoint: resolved)
        } catch {
            await client.disconnect(throughGeneration: currentGeneration)
            throw error
        }
        guard currentGeneration == generation else {
            await client.disconnect(throughGeneration: currentGeneration)
            throw DuduFailure.switchedComputer
        }
        apply(library)
        status = .connected
        connectionFailure = nil
        error = nil
        showsConnectionGuide = false
        reconnectAttempt = 0
        reconnectTask?.cancel()
        reconnectTask = nil
        DuduLog.record(
            "computer.\(lifecycle).ready",
            counts: ["computerCount": computers.count],
            state: "connected"
        )
    }

    private func restore(_ computer: Computer, generation currentGeneration: Int) async {
        guard currentGeneration == generation else { return }
        status = .connecting
        connectionFailure = nil
        DuduLog.record("computer.restore.begin", state: "connecting")
        do {
            try await connectSaved(computer, generation: currentGeneration, lifecycle: "restore")
            DuduLog.record("computer.restore.ready", state: "connected")
        } catch {
            guard currentGeneration == generation else { return }
            status = .disconnected
            if error is CancellationError {
                DuduLog.record("computer.restore.cancelled", state: "disconnected")
                scheduleReconnect(generation: currentGeneration)
                return
            }
            connectionFailure = safeFailure(for: error)
            if !safeFailure(for: error).shouldRetryConnection {
                self.error = safeMessage(for: error)
            }
            showsConnectionGuide = needsConnectionGuide
            DuduLog.record(
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
        async let sessionListLoad: Void = refreshSessions()
        var openedSessionID: String?
        // Resume live history before a slow sidebar refresh can leave accepted messages invisible.
        if !isChoosingWorkspace, let selectedSession {
            openedSessionID = selectedSession.id
            await selectSession(selectedSession)
        }
        await sessionListLoad
        guard currentGeneration == generation else { return }
        if initialSelection == sessionSelectionGeneration, !isChoosingWorkspace,
           let target = selectedSession?.subagent != nil ? selectedSession
                : sessions.first(where: { $0.id == selectedSession?.id }) ?? selectedSession ?? sessions.first {
            openedSessionID = target.id
            await selectSession(target)
        }
        guard currentGeneration == generation else { return }
        if sessionSelectionGeneration == initialSelection &+ 1,
           let openedSessionID, unavailableSessionID == openedSessionID, sessionsError == nil {
            if let replacement = sessions.first(where: { $0.id != openedSessionID }) {
                await selectSession(replacement)
            } else {
                beginNewTask()
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
            DuduLog.networkFailure("navigation.load.fail", error: error)
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
            providers = catalog.providers ?? []
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
        if event["topic"]?.stringValue == "board.changed" {
            boardPushGeneration = eventGeneration
            boardChanges.send()
            return
        }
        if event["topic"]?.stringValue == "navigation.changed" {
            do {
                guard let params = event["params"] else { throw DuduFailure.protocolError }
                let catalog = try await json.decode(NavigationCatalog.self, from: params)
                guard eventGeneration == generation else { return }
                navigation = catalog
                navigationAvailability = catalog.available ? .ready : .waiting
            } catch {
                DuduLog.networkFailure("navigation.event.decode.fail", error: DuduFailure.protocolError)
                await handleDisconnect(generation: eventGeneration, failure: .protocolError)
            }
            return
        }
        guard let topic = event["topic"]?.stringValue,
              ["session.snapshot", "session.watch.failed"].contains(topic),
              let watchID = currentWatchID else { return }
        guard let params = event["params"], let eventWatchID = params["watchId"]?.stringValue else {
            DuduLog.networkFailure("session.event.decode.fail", error: DuduFailure.protocolError)
            await handleDisconnect(generation: eventGeneration, failure: .protocolError)
            return
        }
        guard eventWatchID == watchID else { return }
        if topic == "session.watch.failed" {
            let failure = DuduFailure.remoteCode(params["code"]?.stringValue)
            DuduLog.networkFailure("session.watch.fail", error: failure)
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
            DuduLog.networkFailure("session.event.decode.fail", error: DuduFailure.protocolError)
            await handleDisconnect(generation: eventGeneration, failure: .protocolError)
            return
        }
        guard eventGeneration == generation,
              currentSelection == sessionSelectionGeneration, currentWatchID == watchID else { return }
        guard detail.session.id == selectedSession?.id else {
            DuduLog.networkFailure("session.event.identity.fail", error: DuduFailure.protocolError)
            await handleDisconnect(generation: eventGeneration, failure: .protocolError)
            return
        }
        snapshotVersion &+= 1
        await apply(detail)
    }

    private func handleDisconnect(generation eventGeneration: Int, failure: DuduFailure = .disconnected) async {
        guard eventGeneration == generation else { return }
        let disconnectedGeneration = nextGeneration()
        status = .disconnected
        refreshSubmissionPresentation()
        updatingQueueItemID = nil
        isRespondingApprovals = []
        connectionFailure = failure
        if !failure.shouldRetryConnection { error = failure.localizedDescription }
        showsConnectionGuide = needsConnectionGuide
        scheduleReconnect(generation: disconnectedGeneration, after: failure)
        await client.disconnect(throughGeneration: disconnectedGeneration)
    }

    private func apply(_ library: ComputerLibrary) {
        computers = library.computers.sorted { $0.lastUsedAt > $1.lastUsedAt }
        activeComputer = computers.first { $0.id == library.activeId }
        if !computers.isEmpty { failedPairing = nil }
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
                isRunning: detail.session.status == "running", messages: detail.messages,
                additionalMarkdown: detail.questions.flatMap { $0.questions.compactMap(\.detail) } +
                    detail.approvals.compactMap(\.detail),
                hidden: detail.session.isAssistant == true ? hiddenSeqs : []
            )
            guard application == detailApplicationRevision, selection == sessionSelectionGeneration,
                  connection == generation, watchID == currentWatchID else { return }
            if revision == transcriptRevision { break }
        }
        let commitStartedAt = ProcessInfo.processInfo.systemUptime
        if selectedSession != detail.session {
            sessionSource = "detail"
            selectedSession = detail.session
        }
        if loadedConversationTarget != selectedDraftTarget { loadedConversationTarget = selectedDraftTarget }
        if messages != detail.messages {
            messages = detail.messages
            contentRevision &+= 1
        }
        apply(prepared)
        readPositionSessionID = detail.session.id
        if sessionReadPosition != detail.readPosition { sessionReadPosition = detail.readPosition }
        if let state = detail.session.sessionState, let position = detail.readPosition,
           let computer = activeComputer?.id {
            watchedSessionActivity.send(WatchedSessionActivity(
                target: DraftTarget(computerID: computer, sessionID: detail.session.id),
                connection: connection, seq: position.seq, state: state, asleep: detail.session.deepSleep == true
            ))
        }
        if goal != detail.goal { goal = detail.goal }
        let tasks = detail.todos ?? []
        if todos != tasks { todos = tasks }
        if queuedMessages != detail.queuedMessages {
            queuedMessages = detail.queuedMessages
            queueRevision &+= 1
        }
        canceledRequestIds = Set(detail.canceledRequestIds)
        let observed = observedSubmissionIds
        observedSendingSubmissionIDs.formUnion(observed.intersection(sendingSubmissionIDs))
        if !observedSendingSubmissionIDs.isEmpty { resumeSendConnectionWaiters() }
        submittedDrafts.removeAll { $0.target == selectedDraftTarget && $0.requestID.map(observed.contains) == true }
        if let target = selectedDraftTarget, let submissions = submissionsByTarget[target],
           submissions.contains(where: { observed.contains($0.requestId) }) {
            setSubmissions(submissions.filter { !observed.contains($0.requestId) }, for: target)
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
            DuduLog.record(
                "chat.snapshot.prepare", elapsedMs: (commitStartedAt - preparationStartedAt) * 1_000,
                counts: ["messageCount": transcriptRows.count + messages.count]
            )
            DuduLog.record("chat.snapshot.apply", elapsedMs: (completedAt - commitStartedAt) * 1_000)
        }
    }

    /// Called only by an uncovered history after its latest rendered content is visible.
    func acknowledgeVisibleConversation(_ position: SessionReadPosition, target: DraftTarget) async {
        guard isForeground, canReadConversation, activeComputer?.id == target.computerID,
              selectedSession?.id == target.sessionID, readPositionSessionID == target.sessionID,
              let currentPosition = sessionReadPosition, currentPosition.seq == position.seq,
              position.stream == nil || position.stream == currentPosition.stream,
              let watchID = currentWatchID else { return }
        if lastAcknowledgedRead?.target == target, lastAcknowledgedRead?.position == position { return }
        let visit = readVisitID
        guard pendingReads[visit] != position else { return }
        pendingReads[visit] = position
        defer { if pendingReads[visit] == position { pendingReads.removeValue(forKey: visit) } }
        let selection = sessionSelectionGeneration
        let connection = generation
        var feedback = VisibleSessionRead(id: UUID(), target: target, connection: connection, seq: position.seq, phase: .pending)
        visibleSessionReads.send(feedback)
        do {
            let stream = position.stream.map {
                JSONValue.object(["turn": .number(Double($0.turn)), "step": .number(Double($0.step)), "digest": .string($0.digest)])
            }
            var value: [String: JSONValue] = ["seq": .number(Double(position.seq))]
            if let stream { value["stream"] = stream }
            let result = try await request("session.read", [
                "id": .string(target.sessionID), "watchId": .string(watchID), "position": .object(value)
            ])
            feedback.phase = .saved
            visibleSessionReads.send(feedback)
            guard visit == readVisitID, selection == sessionSelectionGeneration, watchID == currentWatchID,
                  connection == generation, activeComputer?.id == target.computerID,
                  sessionReadPosition == currentPosition else { return }
            lastAcknowledgedRead = (target, position)
            if let raw = result.objectValue?["sessionState"]?.stringValue,
               let state = SessionActivityState(rawValue: raw) {
                selectedSession?.sessionState = state
                if let index = sessions.firstIndex(where: { $0.id == target.sessionID }) {
                    sessions[index].sessionState = state
                }
                watchedSessionActivity.send(WatchedSessionActivity(
                    target: target, connection: connection, seq: position.seq,
                    state: state, asleep: selectedSession?.deepSleep == true
                ))
            }
        } catch {
            feedback.phase = .failed
            visibleSessionReads.send(feedback)
            DuduLog.networkFailure("session.read.fail", error: error)
        }
    }

    private func apply(_ projection: ConversationProjection) {
        if conversationMarkdown !== projection.markdown { conversationMarkdown = projection.markdown }
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

    private var observedSubmissionIds: Set<String> {
        canceledRequestIds
            .union((transcript?.entries ?? []).filter { $0.type == "user" }.compactMap(\.requestId))
            .union((transcript?.pendingInputs ?? []).compactMap(\.requestId))
            .union(queuedMessages.compactMap(\.requestId))
    }

    private var needsConnectionGuide: Bool {
        selectedSession == nil && !isChoosingWorkspace
            && (activeComputer == nil || connectionFailure?.shouldRetryConnection == false)
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
            DuduLog.networkFailure("conversation.cache.restore.fail", error: error)
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
        providers = snapshot.providers ?? []
        permissions = snapshot.permissions.map(PermissionLabels.localized)
        presets = snapshot.presets
        let pendingDraftTargets = Set(submittedDrafts.map(\.target))
        messageDrafts = messageDrafts.filter { $0.key.computerID != computer.id || pendingDraftTargets.contains($0.key) }
        for (sessionID, text) in snapshot.drafts {
            let target = DraftTarget(computerID: computer.id, sessionID: sessionID)
            if !pendingDraftTargets.contains(target) { messageDrafts[target] = text }
        }
        isChoosingWorkspace = snapshot.isChoosingWorkspace
        recentConversationDetails = Array((snapshot.recentDetails ?? []).prefix(12)).map { detail in
            var safe = detail
            safe.approvals = []
            safe.questions = []
            return safe
        }
        if !snapshot.isChoosingWorkspace, var detail = snapshot.detail {
            detail.approvals = []
            detail.questions = []
            await apply(detail)
        } else {
            if !snapshot.isChoosingWorkspace {
                sessionSource = "cache"
                selectedSession = snapshot.selection
            }
            selectedPresetId = snapshot.selectedPresetID
        }
        DuduLog.record(
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
        let detail = currentConversationDetail
        rememberCurrentConversation()
        var drafts = Dictionary(uniqueKeysWithValues: messageDrafts.compactMap { target, text in
            target.computerID == computerID ? (target.sessionID, text) : nil
        })
        for submitted in submittedDrafts.reversed() where submitted.target.computerID == computerID {
            let sessionID = submitted.target.sessionID
            drafts[sessionID] = submitted.recovery.restoring(before: drafts[sessionID])
        }
        let snapshot = ConversationSnapshot(
            computerID: computerID, sessions: sessions, workspaces: workspaces, detail: detail,
            isChoosingWorkspace: isChoosingWorkspace, drafts: drafts,
            models: models, permissions: permissions, presets: presets, selectedPresetID: selectedPresetId,
            providers: providers,
            recentDetails: recentConversationDetails.filter { $0.session.id != detail?.session.id },
            selection: selectedSession
        )
        let precedingWrite = conversationWriteTask
        let storage = conversationStorage
        conversationWriteTask = Task {
            await precedingWrite?.value
            do {
                try await storage.save(snapshot)
            } catch {
                DuduLog.networkFailure("conversation.cache.save.fail", error: error)
            }
        }
    }

    private var currentConversationDetail: SessionDetail? {
        guard loadedConversationTarget != nil, loadedConversationTarget == selectedDraftTarget else { return nil }
        return selectedSession.map {
            SessionDetail(
                session: $0, messages: messages, modelId: selectedModelId, permissionId: selectedPermissionId,
                context: context, trace: trace, team: team, transcript: transcript, goal: goal, todos: todos,
                queuedMessages: queuedMessages,
                planMode: planMode, reasoningEffort: selectedEffort, agentPreset: selectedPresetId
            )
        }
    }

    private func rememberCurrentConversation() {
        guard let detail = currentConversationDetail else { return }
        recentConversationDetails.removeAll { $0.session.id == detail.session.id }
        recentConversationDetails.insert(detail, at: 0)
        if recentConversationDetails.count > 12 { recentConversationDetails.removeLast() }
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
                DuduLog.networkFailure("conversation.cache.remove.fail", error: error)
            }
        }
        conversationWriteTask = removal
        await removal.value
    }

    private func clearConversation() {
        persistConversation()
        assistantRelayRetry = nil
        assistantRelayPending = nil
        isStoppingSession = false
        planCommandID = nil
        isChangingPlanMode = false
        conversationComputerID = nil
        recentConversationDetails = []
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
        conversationMarkdown = .empty
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
        providers = []
        permissions = []
        presets = []
        hiddenSeqs = []
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
        isOpeningAssistant = false
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
        isChoosingProvider = false
        pendingSessionConfiguration = nil
        isStoppingSession = false
        planCommandID = nil
        isChangingPlanMode = false
        currentWatchID = nil
        isLoadingSession = false
        isOpeningAssistant = false
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

    private func scheduleReconnect(generation expectedGeneration: Int, after failure: DuduFailure? = nil) {
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
            await self.start(activating: false, reportsFailure: false)
        }
    }

    private func safeFailure(for error: Error) -> DuduFailure {
        error as? DuduFailure ?? .connectionFailed
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
