import XCTest
@testable import dsbot

@MainActor
final class CoreStoreTests: XCTestCase {
    func testStartupKeepsHomeWhileRestoringAndAuthenticatingSavedComputer() async {
        let repository = StoreComputerFixture()
        let transport = StoreTransportFixture()
        await repository.holdNextLoad()
        await transport.holdNextConnection()
        let store = DSBotStore(repository: repository, client: transport)
        XCTAssertFalse(store.showsConnectionGuide)

        let startup = Task { await store.start() }
        await repository.waitForLoad()
        XCTAssertTrue(store.isRestoring)
        XCTAssertFalse(store.showsConnectionGuide)

        await repository.finishLoad()
        await transport.waitForConnection()
        XCTAssertEqual(store.status, .connecting)
        XCTAssertFalse(store.isRestoring)
        XCTAssertFalse(store.showsConnectionGuide)
        XCTAssertEqual(store.activeComputer?.id, "local-fixture")

        await transport.finishConnection()
        await startup.value
        XCTAssertEqual(store.status, .connected)
        XCTAssertFalse(store.showsConnectionGuide)
    }

    func testFirstLaunchWithoutSavedComputerShowsGuideAfterRestore() async {
        let store = DSBotStore(repository: StoreComputerFixture(paired: false), client: StoreTransportFixture())
        XCTAssertFalse(store.showsConnectionGuide)

        await store.start()

        XCTAssertFalse(store.isRestoring)
        XCTAssertTrue(store.computers.isEmpty)
        XCTAssertTrue(store.showsConnectionGuide)
    }

    func testCancelledRestoreFailureDoesNotShowGuideAfterBackgrounding() async {
        let repository = StoreComputerFixture()
        await repository.holdNextLoad()
        await repository.failNextLoad(with: .storage)
        let store = DSBotStore(repository: repository, client: StoreTransportFixture())
        let startup = Task { await store.start() }
        await repository.waitForLoad()

        store.suspend()
        await repository.finishLoad()
        await startup.value

        XCTAssertEqual(store.status, .disconnected)
        XCTAssertFalse(store.showsConnectionGuide)
    }

    func testRejectedPairingPreservesComputerAndStopsAutomaticRetries() async throws {
        let transport = StoreTransportFixture()
        await transport.failConnections(with: .remote("AUTH_FAILED"))
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)

        await store.start()
        try await Task.sleep(nanoseconds: 1_150_000_000)

        XCTAssertEqual(store.status, .disconnected)
        XCTAssertEqual(store.computers.count, 1)
        XCTAssertEqual(store.activeComputer?.id, "local-fixture")
        XCTAssertEqual(store.connectionFailure, .remote("AUTH_FAILED"))
        XCTAssertEqual(store.error, DSBotFailure.remote("AUTH_FAILED").localizedDescription)
        XCTAssertTrue(store.showsConnectionGuide)
        let attempts = await transport.connectionCount()
        XCTAssertEqual(attempts, 1)

        await transport.failConnections(with: nil)
        await transport.holdNextConnection()
        let retry = Task { await store.reconnect() }
        await transport.waitForConnection()
        XCTAssertEqual(store.status, .connecting)
        XCTAssertTrue(store.showsConnectionGuide)
        await transport.finishConnection()
        await retry.value

        XCTAssertEqual(store.status, .connected)
        XCTAssertNil(store.connectionFailure)
        XCTAssertFalse(store.showsConnectionGuide)
    }

    func testLostConnectionShowsGuideAndFailedRetryKeepsItVisible() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.failConnections(with: .remote("AUTH_FAILED"))

        await transport.emitDisconnect()
        XCTAssertEqual(store.status, .disconnected)
        XCTAssertTrue(store.showsConnectionGuide)
        await store.reconnect()

        XCTAssertEqual(store.status, .disconnected)
        XCTAssertTrue(store.showsConnectionGuide)
        XCTAssertEqual(store.connectionFailure, .remote("AUTH_FAILED"))
    }

    func testSessionSwitchDoesNotWaitForPreviousStreamCleanup() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.delayUnwatch()
        let startedAt = ProcessInfo.processInfo.systemUptime

        await store.selectSession(session("b"))

        XCTAssertEqual(store.selectedSession?.id, "b")
        XCTAssertEqual(store.messages.first?.text, "b")
        XCTAssertLessThan(ProcessInfo.processInfo.systemUptime - startedAt, 0.8)
    }

    func testSessionListShowsLoadingAndCoalescesRefreshes() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let requestCount = await transport.requestCount("session.list")
        await transport.holdNextRequest("session.list")

        let refresh = Task { await store.refreshSessions() }
        await transport.waitForRequest("session.list")
        XCTAssertTrue(store.isLoadingSessions)

        let duplicate = Task { await store.refreshSessions() }
        await Task.yield()
        let countDuringRefresh = await transport.requestCount("session.list")
        XCTAssertEqual(countDuringRefresh, requestCount + 1)

        await transport.finishRequest("session.list")
        await refresh.value
        await duplicate.value
        let finalRequestCount = await transport.requestCount("session.list")
        XCTAssertFalse(store.isLoadingSessions)
        XCTAssertNil(store.sessionsError)
        XCTAssertEqual(finalRequestCount, requestCount + 1)
    }

    func testSessionListFailureKeepsCachedRowsAndCanRetry() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let cachedSessionIDs = store.sessions.map(\.id)
        await transport.failNextRequest("session.list", with: .remote("TEMPORARY"))

        await store.refreshSessions()

        XCTAssertEqual(store.sessions.map(\.id), cachedSessionIDs)
        XCTAssertEqual(store.sessionsError, DSBotFailure.remote("TEMPORARY").localizedDescription)
        XCTAssertFalse(store.isLoadingSessions)
        XCTAssertNil(store.error)

        await store.refreshSessions()

        XCTAssertNil(store.sessionsError)
        XCTAssertEqual(store.sessions.map(\.id), ["a", "b", "c"])
    }

    func testCatalogShowsLoadingAndCoalescesRefreshes() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let requestCount = await transport.requestCount("catalog.get")
        await transport.holdNextRequest("catalog.get")

        let refresh = Task { await store.refreshCatalog() }
        await transport.waitForRequest("catalog.get")
        XCTAssertTrue(store.isLoadingCatalog)

        let duplicate = Task { await store.refreshCatalog() }
        await Task.yield()
        let countDuringRefresh = await transport.requestCount("catalog.get")
        XCTAssertEqual(countDuringRefresh, requestCount + 1)

        await transport.finishRequest("catalog.get")
        await refresh.value
        await duplicate.value
        let finalRequestCount = await transport.requestCount("catalog.get")
        XCTAssertFalse(store.isLoadingCatalog)
        XCTAssertNil(store.catalogError)
        XCTAssertEqual(finalRequestCount, requestCount + 1)
    }

    func testCatalogFailureIsScopedAndCanRetry() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.failNextRequest("catalog.get", with: .remote("TEMPORARY"))

        await store.refreshCatalog()

        XCTAssertEqual(store.catalogError, DSBotFailure.remote("TEMPORARY").localizedDescription)
        XCTAssertFalse(store.isLoadingCatalog)
        XCTAssertNil(store.error)

        await store.refreshCatalog()

        XCTAssertNil(store.catalogError)
        XCTAssertEqual(store.models, [])
    }

    func testChatScrollSchedulerKeepsFiringDuringContinuousStreaming() async throws {
        let scheduler = ChatLatestScrollScheduler()
        var scrollCount = 0

        for _ in 0..<8 {
            scheduler.schedule(
                afterNanoseconds: 70_000_000,
                shouldScroll: { true },
                action: { scrollCount += 1 }
            )
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        try await Task.sleep(nanoseconds: 90_000_000)

        XCTAssertGreaterThanOrEqual(scrollCount, 3)
    }

    func testChatScrollSchedulerPreservesHistoryPositionDuringViewportChanges() async throws {
        let scheduler = ChatLatestScrollScheduler()
        var followsLatest = true
        var isDraggingHistory = false
        var scrollCount = 0

        scheduler.schedule(
            afterNanoseconds: 70_000_000,
            shouldScroll: { followsLatest && !isDraggingHistory },
            action: { scrollCount += 1 }
        )
        followsLatest = false
        isDraggingHistory = true
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(scrollCount, 0)
    }

    func testKeyboardViewportChangesDebounceAndRespectHistoryPosition() async throws {
        let scheduler = ChatViewportScrollScheduler()
        var followsLatest = true
        var isDraggingHistory = false
        var scrollCount = 0

        for _ in 0..<5 {
            scheduler.schedule(
                afterNanoseconds: 70_000_000,
                shouldScroll: { followsLatest && !isDraggingHistory },
                action: { scrollCount += 1 }
            )
            try await Task.sleep(nanoseconds: 25_000_000)
        }
        try await Task.sleep(nanoseconds: 90_000_000)
        XCTAssertEqual(scrollCount, 1)

        scheduler.schedule(
            afterNanoseconds: 70_000_000,
            shouldScroll: { followsLatest && !isDraggingHistory },
            action: { scrollCount += 1 }
        )
        followsLatest = false
        isDraggingHistory = true
        try await Task.sleep(nanoseconds: 100_000_000)

        XCTAssertEqual(scrollCount, 1)
    }

    func testChatScrollSchedulersCancelOldSessionAndAcceptNewScroll() async throws {
        let contentScheduler = ChatLatestScrollScheduler()
        let viewportScheduler = ChatViewportScrollScheduler()
        var scrollCount = 0

        contentScheduler.schedule(
            afterNanoseconds: 100_000_000,
            shouldScroll: { true },
            action: { scrollCount += 10 }
        )
        viewportScheduler.schedule(
            afterNanoseconds: 100_000_000,
            shouldScroll: { true },
            action: { scrollCount += 100 }
        )
        contentScheduler.cancel()
        viewportScheduler.cancel()
        contentScheduler.schedule(
            afterNanoseconds: 20_000_000,
            shouldScroll: { true },
            action: { scrollCount += 1 }
        )
        viewportScheduler.schedule(
            afterNanoseconds: 20_000_000,
            shouldScroll: { true },
            action: { scrollCount += 1 }
        )
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertEqual(scrollCount, 2)
        try await Task.sleep(nanoseconds: 80_000_000)

        XCTAssertEqual(scrollCount, 2)
    }

    func testLateSessionReplyCannotReplaceNewerSelection() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.holdWatch("b")

        let olderSelection = Task { await store.selectSession(session("b")) }
        await transport.waitForWatch("b")
        await store.selectSession(session("c"))
        await transport.finishWatch("b", text: "old result")
        await olderSelection.value

        XCTAssertEqual(store.selectedSession?.id, "c")
        XCTAssertEqual(store.messages.first?.text, "c")
        XCTAssertFalse(store.isLoading)
    }

    func testOpeningReplyCannotOverwriteNewerStreamSnapshot() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.holdWatch("b")

        let selection = Task { await store.selectSession(session("b")) }
        await transport.waitForWatch("b")
        await transport.emitSnapshot("b", text: "new stream value")
        await transport.finishWatch("b", text: "stale opening value")
        await selection.value

        XCTAssertEqual(store.selectedSession?.id, "b")
        XCTAssertEqual(store.messages.first?.text, "new stream value")
        XCTAssertFalse(store.isLoading)
    }

    func testForegroundReconnectRestartsCurrentSessionWatch() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await store.selectSession(session("b"))
        let before = await transport.watchCount("b")
        let cachedMessages = store.messages.map(\.text)

        store.suspend()
        XCTAssertFalse(store.showsConnectionGuide)
        XCTAssertEqual(store.messages.map(\.text), cachedMessages)
        await transport.holdNextConnection()
        let resume = Task { await store.start() }
        await transport.waitForConnection()
        XCTAssertEqual(store.status, .connecting)
        XCTAssertFalse(store.showsConnectionGuide)
        XCTAssertEqual(store.selectedSession?.id, "b")
        XCTAssertEqual(store.messages.map(\.text), cachedMessages)
        await transport.finishConnection()
        await resume.value
        let after = await transport.watchCount("b")

        XCTAssertEqual(store.selectedSession?.id, "b")
        XCTAssertEqual(after, before + 1)
        XCTAssertEqual(store.status, .connected)
        XCTAssertFalse(store.showsConnectionGuide)
    }

    func testLateApprovalReplyCannotClearNewSessionApproval() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.emitSnapshot("a", text: "review", approvalID: "old-approval")
        let oldApproval = try XCTUnwrap(store.approvals.first)
        let response = Task { await store.respondToApproval(oldApproval, allow: true) }
        await transport.waitForApprovalResponse()
        await store.respondToApproval(oldApproval, allow: true)

        await store.selectSession(session("b"))
        await transport.emitSnapshot("b", text: "another review", approvalID: "new-approval")
        await transport.finishApprovalResponse()
        await response.value

        let responseCount = await transport.approvalResponseCount()
        XCTAssertEqual(responseCount, 1)
        XCTAssertEqual(store.approvals.map(\.id), ["new-approval"])
        XCTAssertTrue(store.isRespondingApprovals.isEmpty)
    }

    func testAcceptedApprovalDoesNotReappearWhileReplyIsQueued() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.emitSnapshot("a", text: "review", approvalID: "approval")
        let approval = try XCTUnwrap(store.approvals.first)
        let response = Task { await store.respondToApproval(approval, allow: false) }
        await transport.waitForApprovalResponse()
        await transport.finishApprovalResponse()
        await response.value
        await transport.emitSnapshot("a", text: "reply queued", approvalID: "approval")

        XCTAssertTrue(store.approvals.isEmpty)
        XCTAssertTrue(store.isRespondingApprovals.isEmpty)
    }

    func testSnapshotFromEarlierWatchCannotOverwriteReopenedSession() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let oldWatch = await transport.watchID("a")
        await store.selectSession(session("b"))
        await store.selectSession(session("a"))
        await transport.emitSnapshot("a", text: "stale watch", watchID: oldWatch)

        XCTAssertEqual(store.selectedSession?.id, "a")
        XCTAssertEqual(store.messages.first?.text, "a")
    }

    func testPairingQueuedDuringSwitchCannotConnectAfterBackground() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.holdNextConnection()
        let other = Computer(
            id: "another-local-id", name: "Another fixture",
            url: "http://127.0.0.1:3170/dsbot?pair=" + String(repeating: "b", count: 43),
            lastUsedAt: 0
        )
        let switching = Task { await store.selectComputer(other) }
        await transport.waitForConnection()
        let pairing = Task {
            try? await store.pair(link: "http://127.0.0.1:3170/dsbot?pair=" + String(repeating: "c", count: 43))
        }
        await Task.yield()
        store.suspend()
        await transport.finishConnection()
        await switching.value
        await pairing.value
        let connects = await transport.connectionCount()

        XCTAssertEqual(connects, 2)
        XCTAssertEqual(store.status, .disconnected)
    }

    func testQueuedForegroundResumeCannotUndoBackgroundSuspension() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        store.resume()
        store.suspend()
        await Task.yield()
        let connects = await transport.connectionCount()

        XCTAssertEqual(connects, 1)
        XCTAssertEqual(store.status, .disconnected)
    }

    func testRunCommandSendsOnlyTheNamedCommandAndReportsTheDesktopReply() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()

        let outcome = await store.runCommand(.plan, argument: "off")
        let compact = await store.runCommand(.compact)

        XCTAssertEqual(outcome, CommandOutcome(isError: false, text: "Plan mode off."))
        XCTAssertEqual(compact, CommandOutcome(isError: false, text: "Plan mode off."))
        let requests = await transport.commandParams()
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0]["id"]?.stringValue, "a")
        XCTAssertEqual(requests[0]["command"]?.stringValue, "plan")
        XCTAssertEqual(requests[0]["argument"]?.stringValue, "off")
        XCTAssertEqual(requests[1]["command"]?.stringValue, "compact")
        XCTAssertNil(requests[1]["argument"], "A command without an argument sends none.")
        XCTAssertNil(store.error)
    }

    func testRunCommandSurfacesDesktopRefusalsAsErrorOutcomes() async throws {
        let transport = StoreTransportFixture()
        await transport.setCommandReply(.object([
            "kind": .string("error"), "text": .string("Compaction is unavailable while the session is busy.")
        ]))
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()

        let outcome = await store.runCommand(.compact)

        XCTAssertEqual(outcome?.isError, true)
        XCTAssertEqual(
            CommandText.message(for: .compact, argument: nil, outcome: try XCTUnwrap(outcome)),
            "当前无法压缩，请等会话空闲后再试"
        )
        XCTAssertNil(store.error, "A refusal is the caller's message to show, not a transport failure.")
    }

    func testOlderPluginWithoutCommandsAsksForAnUpdate() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.failNextRequest("session.command", with: .remote("UNSUPPORTED"))
        await transport.failNextRequest("file.upload", with: .remote("METHOD_NOT_ALLOWED"))

        let outcome = await store.runCommand(.compact)
        XCTAssertNil(outcome)
        XCTAssertEqual(store.error, "请先在电脑上更新 dsbot 插件，再使用此功能。")

        store.error = nil
        do {
            _ = try await store.uploadFile(name: "notes.txt", data: Data("abc".utf8))
            XCTFail("An old plugin cannot stage files")
        } catch {
            XCTAssertEqual(store.error, "请先在电脑上更新 dsbot 插件，再使用此功能。")
        }
    }

    func testUploadedFileTravelsToTheNextPromptAsAReceipt() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()

        let file = try await store.uploadFile(name: "notes.txt", data: Data("abc".utf8))
        try await store.send(text: "看看这个文件", files: [file])

        XCTAssertEqual(file, UploadedFile(receiptId: "receipt-1", name: "notes.txt", bytes: 3))
        let uploads = await transport.uploadParams()
        XCTAssertEqual(uploads.first?["id"]?.stringValue, "a")
        XCTAssertEqual(uploads.first?["name"]?.stringValue, "notes.txt")
        XCTAssertEqual(uploads.first?["data"]?.stringValue, "YWJj")
        let sends = await transport.sendParams()
        let attachments = try XCTUnwrap(sends.first?["attachments"]?.arrayValue)
        XCTAssertEqual(attachments.count, 1)
        XCTAssertEqual(attachments.first?["receiptId"]?.stringValue, "receipt-1")
        XCTAssertEqual(attachments.first?["name"]?.stringValue, "notes.txt")
    }

    func testTranscriptSnapshotFeedsRowsGoalAndPlanMode() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        XCTAssertTrue(store.transcriptRows.isEmpty)
        XCTAssertNil(store.goal)
        XCTAssertFalse(store.planMode)
        let revision = store.contentRevision

        await transport.emitTranscriptSnapshot("a")

        XCTAssertEqual(store.transcriptRows.map(\.id), ["user:u1", "turn:turn-1"])
        XCTAssertEqual(store.goal?.phase, "paused")
        XCTAssertEqual(store.goal?.title, "已暂停的目标")
        XCTAssertTrue(store.planMode)
        XCTAssertGreaterThan(store.contentRevision, revision)

        // The same snapshot again changes nothing, so the chat does not re-scroll or re-render.
        let settled = store.contentRevision
        await transport.emitTranscriptSnapshot("a")
        XCTAssertEqual(store.contentRevision, settled)

        // A plain snapshot (old plugin, or the transcript switched off) clears the structured state.
        await transport.emitSnapshot("a", text: "plain")
        XCTAssertTrue(store.transcriptRows.isEmpty)
        XCTAssertNil(store.goal)
        XCTAssertFalse(store.planMode)
    }

    func testSwitchingSessionsDropsTheOpenSessionsGoalAndTranscript() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.emitTranscriptSnapshot("a")
        XCTAssertNotNil(store.goal)

        await store.selectSession(session("b"))

        XCTAssertEqual(store.selectedSession?.id, "b")
        XCTAssertNil(store.goal)
        XCTAssertFalse(store.planMode)
        XCTAssertTrue(store.transcriptRows.isEmpty)
    }

    func testCatalogCarriesChineseNamesReasoningLevelsAndModes() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()

        XCTAssertEqual(store.permissions.map(\.name), ["仅可查看", "完全权限"])
        XCTAssertEqual(store.models.first?.efforts?.map(\.id), ["high", "max"])
        XCTAssertEqual(store.presets.map(\.id), ["standard", "minimal"])
        XCTAssertEqual(store.currentPreset?.id, "standard", "The host default shows until the session names a mode.")
    }

    func testReasoningLevelAndModeAreSentWithTheOpenSession() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()

        await store.configure(reasoningEffort: "max")
        await store.configure(agentPreset: "minimal")

        let requests = await transport.configureParams()
        XCTAssertEqual(requests.count, 2)
        XCTAssertEqual(requests[0]["id"]?.stringValue, "a")
        XCTAssertEqual(requests[0]["reasoningEffort"]?.stringValue, "max")
        XCTAssertNil(requests[0]["modelId"])
        XCTAssertEqual(requests[1]["agentPreset"]?.stringValue, "minimal")
        XCTAssertEqual(store.selectedEffort, "max")
        XCTAssertEqual(store.selectedPresetId, "minimal")
        XCTAssertEqual(store.currentPreset?.id, "minimal")
    }

    func testNewSessionCarriesProjectModeAndTheBlankConversationToReuse() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()

        await store.createSession(workspaceId: "w2", agentPreset: "minimal", reusing: "blank-1")

        let requests = await transport.createParams()
        XCTAssertEqual(requests.count, 1)
        XCTAssertEqual(requests[0]["workspaceId"]?.stringValue, "w2")
        XCTAssertEqual(requests[0]["agentPreset"]?.stringValue, "minimal")
        XCTAssertEqual(requests[0]["reuse"]?.stringValue, "blank-1")
        XCTAssertEqual(store.selectedSession?.id, "new-1")
    }

    func testStartingANewSessionOnAnEmptyConversationKeepsIt() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        XCTAssertFalse(store.isBlankSession, "The open conversation has a message.")

        await store.startNewSession(workspaceId: "w1")
        let created = await transport.createParams()
        XCTAssertEqual(created.count, 1, "A conversation with content gets a new session.")

        await transport.emitEmptySnapshot("new-1")
        XCTAssertTrue(store.isBlankSession)
        await store.startNewSession(workspaceId: "w1")
        let afterSecondTap = await transport.createParams()
        XCTAssertEqual(afterSecondTap.count, 1, "An empty conversation is reused instead of piling up blank rows.")
    }

    func testNewTaskHomeOpensNoConversationUntilAWorkspaceIsPicked() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        XCTAssertNotNil(store.selectedSession)

        store.beginNewTask()
        XCTAssertNil(store.selectedSession)
        XCTAssertTrue(store.isChoosingWorkspace)
        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertEqual(store.currentPreset?.id, "standard", "The host default shows before a mode is picked.")

        store.chooseDraftPreset("minimal")
        XCTAssertEqual(store.currentPreset?.id, "minimal")
        let beforePick = await transport.createParams()
        XCTAssertTrue(beforePick.isEmpty, "Nothing is created until a workspace is picked.")

        await store.startTask(in: "w2")
        let created = await transport.createParams()
        XCTAssertEqual(created.count, 1)
        XCTAssertEqual(created[0]["workspaceId"]?.stringValue, "w2")
        XCTAssertEqual(created[0]["agentPreset"]?.stringValue, "minimal")
        XCTAssertNil(created[0]["reuse"])
        XCTAssertEqual(store.selectedSession?.id, "new-1")
        XCTAssertFalse(store.isChoosingWorkspace)
    }

    func testPickingAWorkspaceReusesItsBlankConversation() async {
        let transport = StoreTransportFixture()
        await transport.listBlankSession("blank-w2", workspaceId: "w2")
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        XCTAssertEqual(store.blankSession(in: "w2")?.id, "blank-w2")
        XCTAssertNil(store.blankSession(in: "w3"))

        store.beginNewTask()
        await store.startTask(in: "w2")
        await store.startNewSession(workspaceId: "w3")

        let created = await transport.createParams()
        XCTAssertEqual(created.count, 2)
        XCTAssertEqual(created[0]["reuse"]?.stringValue, "blank-w2")
        XCTAssertNil(created[1]["reuse"])
    }

    func testTheModePickedOnTheNewTaskHomeIsOnlyKeptWhileChoosing() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()

        store.chooseDraftPreset("minimal")
        XCTAssertNotEqual(store.selectedPresetId, "minimal", "A conversation that is open keeps its own mode.")

        store.beginNewTask()
        store.chooseDraftPreset("not-a-mode")
        XCTAssertNil(store.selectedPresetId)
        store.chooseDraftPreset("minimal")
        XCTAssertEqual(store.selectedPresetId, "minimal")
    }

    func testNavigationComesFromThePluginAndSaysWhyItIsEmptyWhenItCannot() async {
        // A plugin that predates navigation: empty lists and a reason, never a guess at DSH's entries.
        let withoutPlugin = StoreTransportFixture()
        await withoutPlugin.failNextRequest("navigation.get", with: .remote("UNSUPPORTED"))
        let plain = DSBotStore(repository: StoreComputerFixture(), client: withoutPlugin)
        await plain.start()
        XCTAssertEqual(plain.navigationAvailability, .unsupported)
        XCTAssertTrue(plain.activeNavigation.sidebar.isEmpty)
        XCTAssertTrue(plain.activeNavigation.views.isEmpty)

        // A current plugin that DSH's window has not reported to yet.
        let waiting = StoreTransportFixture()
        await waiting.setNavigation(.object(["schemaVersion": .number(1), "available": .bool(false)]))
        let idle = DSBotStore(repository: StoreComputerFixture(), client: waiting)
        await idle.start()
        XCTAssertEqual(idle.navigationAvailability, .waiting)

        let transport = StoreTransportFixture()
        await transport.setNavigation(.object([
            "schemaVersion": .number(1), "available": .bool(true), "updatedAt": .number(5),
            "sidebar": .array([.object([
                "id": .string("insight"), "title": .string("上下文洞察"), "order": .number(1),
                "open": .object(["web": .object(["page": .string("panel"), "target": .string("insight")])])
            ])]),
            "views": .array([]), "dock": .array([]), "settings": .array([])
        ]))
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        XCTAssertEqual(store.navigationAvailability, .ready)
        XCTAssertEqual(store.activeNavigation.sidebar.map(\.id), ["insight"])
        XCTAssertEqual(
            store.activeNavigation.sidebar.first?.target,
            .web(page: .panel, target: "insight")
        )
        XCTAssertTrue(store.activeNavigation.views.isEmpty, "Empty stays empty: the app adds nothing.")
        XCTAssertTrue(store.activeNavigation.dock.isEmpty)
    }

    func testRenamingAndDeletingAWorkspaceAndUnarchivingGoThroughThePlugin() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()

        let renamed = await store.renameWorkspace("w1", to: "  新名称  ")
        let blank = await store.renameWorkspace("w1", to: "   ")
        let deleted = await store.deleteWorkspace("w1")
        let unarchived = await store.unarchiveSession("s1")
        XCTAssertTrue(renamed)
        XCTAssertFalse(blank, "A blank name is not sent.")
        XCTAssertTrue(deleted)
        XCTAssertTrue(unarchived)
        let rename = await transport.requestCount("workspace.rename")
        let delete = await transport.requestCount("workspace.delete")
        let unarchive = await transport.requestCount("session.unarchive")
        XCTAssertEqual([rename, delete, unarchive], [1, 1, 1])
    }

    func testRenamingPinningAndArchivingAConversationGoThroughThePluginAndNothingElse() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()

        let renamed = await store.renameSession("a", to: "  新标题  ")
        let blank = await store.renameSession("a", to: "   ")
        let pinned = await store.setSessionPinned("a", true)
        let unpinned = await store.setSessionPinned("a", false)
        let archived = await store.archiveSession("b")
        XCTAssertTrue(renamed)
        XCTAssertFalse(blank, "A blank title is not sent.")
        XCTAssertTrue(pinned)
        XCTAssertTrue(unpinned)
        XCTAssertTrue(archived)

        let changes = await transport.conversationChanges()
        XCTAssertEqual(changes.map(\.method), ["session.rename", "session.pin", "session.pin", "session.archive"])
        XCTAssertEqual(changes[0].params, ["id": .string("a"), "title": .string("新标题")])
        XCTAssertEqual(changes[1].params, ["id": .string("a"), "pinned": .bool(true)])
        XCTAssertEqual(changes[2].params, ["id": .string("a"), "pinned": .bool(false)])
        XCTAssertEqual(changes[3].params, ["id": .string("b")])
        // DSH has no session deletion; the app asks for none.
        let deleted = await transport.requestCount("session.delete")
        XCTAssertEqual(deleted, 0)
    }

    func testARefusedConversationChangeSaysSoAndLeavesTheListAlone() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let before = store.sessions

        await transport.failNextRequest("session.pin", with: .remote("UPSTREAM_ERROR"))
        let pinned = await store.setSessionPinned("a", true)
        XCTAssertFalse(pinned)
        XCTAssertNotNil(store.error)
        XCTAssertEqual(store.sessions, before)

        // A plugin that predates the menu does not know the method.
        store.error = nil
        await transport.failNextRequest("session.archive", with: .remote("METHOD_NOT_ALLOWED"))
        let archived = await store.archiveSession("a")
        XCTAssertFalse(archived)
        XCTAssertEqual(store.error, "请先在电脑上更新 dsbot 插件，再使用此功能。")
    }

    private func session(_ id: String) -> SessionSummary {
        SessionSummary(id: id, title: id, updatedAt: 1, status: "idle")
    }
}

private actor StoreComputerFixture: DSBotComputerStorage {
    private let paired: Bool
    private var shouldHoldLoad = false
    private var nextLoadFailure: DSBotFailure?
    private var loadContinuation: CheckedContinuation<Void, Never>?
    private var loadObserver: CheckedContinuation<Void, Never>?
    private let computer = Computer(
        id: "local-fixture", name: "Fixture",
        url: "http://127.0.0.1:3170/dsbot?pair=" + String(repeating: "a", count: 43),
        computerId: "desktop-fixture", lastUsedAt: 0
    )

    init(paired: Bool = true) {
        self.paired = paired
    }

    func load() async throws -> ComputerLibrary {
        if shouldHoldLoad {
            shouldHoldLoad = false
            await withCheckedContinuation { continuation in
                loadContinuation = continuation
                loadObserver?.resume()
                loadObserver = nil
            }
        }
        if let failure = nextLoadFailure {
            nextLoadFailure = nil
            throw failure
        }
        return library
    }

    private var library: ComputerLibrary {
        ComputerLibrary(computers: paired ? [computer] : [], activeId: paired ? computer.id : nil)
    }

    func pairAuthenticated(endpoint: ConnectionEndpoint, readyId: String) -> ComputerLibrary { library }
    func activateAuthenticated(localId: String, readyId: String) -> ComputerLibrary { library }
    func remove(_ localId: String) -> ComputerLibrary { ComputerLibrary(computers: [], activeId: nil) }
    func holdNextLoad() { shouldHoldLoad = true }

    func waitForLoad() async {
        if loadContinuation != nil { return }
        await withCheckedContinuation { loadObserver = $0 }
    }

    func finishLoad() {
        loadContinuation?.resume()
        loadContinuation = nil
    }

    func failNextLoad(with failure: DSBotFailure) { nextLoadFailure = failure }
}

private actor StoreTransportFixture: DSBotTransport {
    private var event: (@Sendable (JSONValue) async -> Void)?
    private var onDisconnect: (@Sendable () async -> Void)?
    private var heldIDs: Set<String> = []
    private var pending: [String: CheckedContinuation<JSONValue, Error>] = [:]
    private var observers: [String: CheckedContinuation<Void, Never>] = [:]
    private var counts: [String: Int] = [:]
    private var approvalContinuation: CheckedContinuation<JSONValue, Error>?
    private var approvalObserver: CheckedContinuation<Void, Never>?
    private var approvalCount = 0
    private var watchIDs: [String: String] = [:]
    private var shouldHoldConnection = false
    private var connectionContinuation: CheckedContinuation<Void, Never>?
    private var connectionObserver: CheckedContinuation<Void, Never>?
    private var connections = 0
    private var connectionFailure: DSBotFailure?
    private var unwatchDelay: UInt64 = 0
    private var nextRequestFailures: [String: DSBotFailure] = [:]
    private var heldRequests: Set<String> = []
    private var pendingRequests: [String: CheckedContinuation<Void, Never>] = [:]
    private var requestObservers: [String: CheckedContinuation<Void, Never>] = [:]
    private var requestCounts: [String: Int] = [:]
    private var commandRequests: [[String: JSONValue]] = []
    private var uploadRequests: [[String: JSONValue]] = []
    private var sendRequests: [[String: JSONValue]] = []
    private var changeRequests: [(method: String, params: [String: JSONValue])] = []
    private var commandReply: JSONValue = .object(["kind": .string("success"), "text": .string("Plan mode off.")])
    private var createRequests: [[String: JSONValue]] = []
    private var configureRequests: [[String: JSONValue]] = []
    private var extraListedRows: [JSONValue] = []
    private var createdWorkspaces: [String: String] = [:]
    private var navigationReply: JSONValue?

    func connect(
        endpoint: ConnectionEndpoint,
        expectedComputerId: String?,
        generation: Int,
        onEvent: @escaping @Sendable (JSONValue) async -> Void,
        onDisconnect: @escaping @Sendable () async -> Void
    ) async throws -> (id: String, name: String) {
        connections += 1
        if shouldHoldConnection {
            shouldHoldConnection = false
            await withCheckedContinuation { continuation in
                connectionContinuation = continuation
                connectionObserver?.resume()
                connectionObserver = nil
            }
        }
        if let connectionFailure { throw connectionFailure }
        event = onEvent
        self.onDisconnect = onDisconnect
        return ("desktop-fixture", "Fixture")
    }

    func request(_ method: String, params: [String: JSONValue], timeoutSeconds: UInt64) async throws -> JSONValue {
        requestCounts[method, default: 0] += 1
        if ["session.rename", "session.pin", "session.archive"].contains(method) {
            changeRequests.append((method, params))
        }
        if let failure = nextRequestFailures.removeValue(forKey: method) {
            throw failure
        }
        if heldRequests.remove(method) != nil {
            await withCheckedContinuation { continuation in
                pendingRequests[method] = continuation
                requestObservers.removeValue(forKey: method)?.resume()
            }
        }
        switch method {
        case "session.list":
            return .array(["a", "b", "c"].map { summary($0) } + extraListedRows)
        case "navigation.get":
            return navigationReply ?? .object([:])
        case "session.watch":
            let id = params["id"]!.stringValue!
            watchIDs[id] = params["watchId"]?.stringValue
            counts[id, default: 0] += 1
            if heldIDs.contains(id) {
                return try await withCheckedThrowingContinuation { continuation in
                    pending[id] = continuation
                    observers.removeValue(forKey: id)?.resume()
                }
            }
            return detail(id, text: id)
        case "workspace.list":
            return .array([])
        case "catalog.get":
            return .object([
                "models": .array([.object([
                    "id": .string("deepseek:v4"), "name": .string("DeepSeek V4"),
                    "efforts": .array([
                        .object(["id": .string("high"), "name": .string("High")]),
                        .object(["id": .string("max"), "name": .string("Max")])
                    ]),
                    "defaultEffort": .string("high")
                ])]),
                "permissions": .array([
                    .object(["id": .string("read-only"), "name": .string("read-only")]),
                    .object(["id": .string("danger-full-access"), "name": .string("danger-full-access")])
                ]),
                "presets": .array([
                    .object(["id": .string("standard"), "name": .string("标准模式"), "isDefault": .bool(true)]),
                    .object(["id": .string("minimal"), "name": .string("极简模式"), "isDefault": .bool(false)])
                ])
            ])
        case "session.create":
            createRequests.append(params)
            if let workspaceId = params["workspaceId"]?.stringValue { createdWorkspaces["new-1"] = workspaceId }
            return summary("new-1")
        case "session.configure":
            configureRequests.append(params)
            return .bool(true)
        case "approval.respond":
            approvalCount += 1
            return try await withCheckedThrowingContinuation { continuation in
                approvalContinuation = continuation
                approvalObserver?.resume()
                approvalObserver = nil
            }
        case "session.unwatch":
            try await Task.sleep(nanoseconds: unwatchDelay)
            return .object([:])
        case "session.command":
            commandRequests.append(params)
            return commandReply
        case "file.upload":
            uploadRequests.append(params)
            return .object([
                "receiptId": .string("receipt-1"), "name": params["name"] ?? .string("file"), "bytes": .number(3)
            ])
        case "session.send":
            sendRequests.append(params)
            return .bool(true)
        default:
            return .object([:])
        }
    }

    func disconnect() {}
    func disconnect(throughGeneration: Int) {}
    func holdWatch(_ id: String) { heldIDs.insert(id) }
    func watchCount(_ id: String) -> Int { counts[id, default: 0] }
    func watchID(_ id: String) -> String? { watchIDs[id] }
    func approvalResponseCount() -> Int { approvalCount }
    func connectionCount() -> Int { connections }
    func requestCount(_ method: String) -> Int { requestCounts[method, default: 0] }
    func conversationChanges() -> [(method: String, params: [String: JSONValue])] { changeRequests }
    func failConnections(with failure: DSBotFailure?) { connectionFailure = failure }
    func emitDisconnect() async { await onDisconnect?() }
    func holdNextConnection() { shouldHoldConnection = true }
    func failNextRequest(_ method: String, with failure: DSBotFailure) {
        nextRequestFailures[method] = failure
    }
    func holdNextRequest(_ method: String) { heldRequests.insert(method) }
    func delayUnwatch() { unwatchDelay = 2_000_000_000 }
    func commandParams() -> [[String: JSONValue]] { commandRequests }
    func createParams() -> [[String: JSONValue]] { createRequests }
    func configureParams() -> [[String: JSONValue]] { configureRequests }
    func uploadParams() -> [[String: JSONValue]] { uploadRequests }
    func sendParams() -> [[String: JSONValue]] { sendRequests }
    func setCommandReply(_ reply: JSONValue) { commandReply = reply }
    func setNavigation(_ reply: JSONValue) { navigationReply = reply }
    /// A conversation that has no message yet, as the host lists it.
    func listBlankSession(_ id: String, workspaceId: String) {
        extraListedRows.append(.object([
            "id": .string(id), "title": .string("新对话"), "workspaceId": .string(workspaceId),
            "updatedAt": .number(0), "status": .string("idle"), "blank": .bool(true)
        ]))
    }

    func waitForRequest(_ method: String) async {
        if pendingRequests[method] != nil { return }
        await withCheckedContinuation { requestObservers[method] = $0 }
    }

    func finishRequest(_ method: String) {
        pendingRequests.removeValue(forKey: method)?.resume()
    }

    func waitForConnection() async {
        if connectionContinuation != nil { return }
        await withCheckedContinuation { connectionObserver = $0 }
    }

    func finishConnection() {
        connectionContinuation?.resume()
        connectionContinuation = nil
    }

    func waitForApprovalResponse() async {
        if approvalContinuation != nil { return }
        await withCheckedContinuation { approvalObserver = $0 }
    }

    func finishApprovalResponse() {
        approvalContinuation?.resume(returning: .bool(true))
        approvalContinuation = nil
    }

    func waitForWatch(_ id: String) async {
        if pending[id] != nil { return }
        await withCheckedContinuation { observers[id] = $0 }
    }

    func finishWatch(_ id: String, text: String) {
        heldIDs.remove(id)
        pending.removeValue(forKey: id)?.resume(returning: detail(id, text: text))
    }

    func emitSnapshot(
        _ id: String, text: String, approvalID: String? = nil, watchID: String? = nil
    ) async {
        var params = detail(id, text: text, approvalID: approvalID).objectValue!
        params["watchId"] = .string(watchID ?? watchIDs[id] ?? "")
        await event?(.object([
            "type": .string("event"), "topic": .string("session.snapshot"),
            "params": .object(params)
        ]))
    }

    /// A snapshot of a conversation that has nothing in it yet.
    func emitEmptySnapshot(_ id: String) async {
        var params = detail(id, text: id).objectValue!
        params["messages"] = .array([])
        params["watchId"] = .string(watchIDs[id] ?? "")
        await event?(.object([
            "type": .string("event"), "topic": .string("session.snapshot"),
            "params": .object(params)
        ]))
    }

    /// A snapshot in the plugin's "transcript" mode: structured entries, a paused goal and plan mode on.
    func emitTranscriptSnapshot(_ id: String) async {
        var params = detail(id, text: id).objectValue!
        params["messages"] = .array([])
        params["transcript"] = .object([
            "entries": .array([
                .object(["type": .string("user"), "id": .string("u1"), "seq": .number(1), "text": .string("你好")]),
                .object([
                    "type": .string("assistant"), "id": .string("a1"), "seq": .number(2), "text": .string("你好呀"),
                    "turn": .number(1), "step": .number(1)
                ])
            ]),
            "turns": .array([.object([
                "turn": .number(1), "start": .number(0), "end": .number(2_000), "outcome": .string("done")
            ])])
        ])
        params["goal"] = .object([
            "id": .string("g1"), "phase": .string("paused"), "objective": .string("ship it")
        ])
        params["planMode"] = .bool(true)
        params["watchId"] = .string(watchIDs[id] ?? "")
        await event?(.object([
            "type": .string("event"), "topic": .string("session.snapshot"),
            "params": .object(params)
        ]))
    }

    private func summary(_ id: String) -> JSONValue {
        var row: [String: JSONValue] = [
            "id": .string(id), "title": .string(id),
            "updatedAt": .number(1), "status": .string("idle")
        ]
        if let workspaceId = createdWorkspaces[id] { row["workspaceId"] = .string(workspaceId) }
        return .object(row)
    }

    private func detail(_ id: String, text: String, approvalID: String? = nil) -> JSONValue {
        .object([
            "session": summary(id),
            "messages": .array([.object([
                "id": .string("message-" + id), "role": .string("assistant"), "text": .string(text)
            ])]),
            "context": .array([]), "trace": .array([]), "team": .array([]),
            "approvals": .array(approvalID.map { approvalID in
                [.object([
                    "id": .string(approvalID), "sessionId": .string(id), "title": .string("Review")
                ])]
            } ?? [])
        ])
    }
}
