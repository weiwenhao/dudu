import Combine
import XCTest
@testable import dsbot

@MainActor
final class CoreStoreTests: XCTestCase {
    func testForkRequiresAnAuthoritativeBranchAndPreservesTheSourceOnFailure() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let target = DraftTarget(computerID: "local-fixture", sessionID: "a")
        await transport.setForkReply(.object(["sessionId": .string("branch")]))
        do {
            try await store.forkConversation(at: 1, target: target)
            XCTFail("An absent branch must not be fabricated from the source conversation.")
        } catch {
            XCTAssertEqual(error as? DSBotFailure, .protocolError)
        }
        XCTAssertEqual(store.selectedSession?.id, "a")
        XCTAssertEqual(store.messages.first?.text, "a")
        XCTAssertFalse(store.sessions.contains { $0.id == "branch" })

        await transport.listSession("branch")
        try await store.forkConversation(at: 1, target: target)
        XCTAssertEqual(store.selectedSession?.id, "branch")
        XCTAssertEqual(store.messages.first?.text, "branch")
    }

    func testFreshSessionRefreshDoesNotReuseAResponseStartedBeforeMutation() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let initialCount = await transport.requestCount("session.list")
        await transport.holdNextRequest("session.list")
        let existing = Task { await store.refreshSessions() }
        await transport.waitForRequest("session.list")
        let fresh = Task { await store.refreshSessions(requiringNewRequest: true) }
        await transport.listSession("branch")
        await transport.finishRequest("session.list")
        await existing.value
        await fresh.value
        let finalCount = await transport.requestCount("session.list")
        XCTAssertEqual(finalCount, initialCount + 2)
        XCTAssertTrue(store.sessions.contains { $0.id == "branch" })
    }

    func testInvalidCommandRepliesAndWrongSessionSnapshotsCannotReportSuccess() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.setCommandReply(.object([:]))
        let outcome = await store.runCommand(.plan)
        XCTAssertNil(outcome)
        XCTAssertFalse(store.planMode)
        XCTAssertEqual(store.error, DSBotFailure.protocolError.localizedDescription)
        let watchID = await transport.watchID("a")
        await transport.emitSnapshot("b", text: "wrong session", watchID: try XCTUnwrap(watchID))
        XCTAssertEqual(store.status, .disconnected)
        XCTAssertEqual(store.connectionFailure, .protocolError)
        XCTAssertEqual(store.messages.first?.text, "a")
    }

    func testFailedLiveWatchDisconnectsPreservesHistoryAndRejectsLateReplies() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let currentWatchID = await transport.watchID("a")
        let watchID = try XCTUnwrap(currentWatchID)
        let target = DraftTarget(computerID: "local-fixture", sessionID: "a")
        await transport.holdNextRequest("session.tool")
        let pending = Task {
            do {
                _ = try await store.conversationRequest("session.tool", target: target)
                return false
            } catch { return true }
        }
        await transport.waitForRequest("session.tool")
        await transport.emitEvent("session.watch.failed", params: .object([
            "id": .string("a"), "watchId": .string(watchID), "code": .string("UPSTREAM_UNAVAILABLE")
        ]))
        XCTAssertEqual(store.status, .disconnected)
        XCTAssertEqual(store.connectionFailure, .remote("UPSTREAM_UNAVAILABLE"))
        XCTAssertEqual(store.messages.first?.text, "a")
        XCTAssertFalse(store.showsConnectionGuide)
        await transport.emitSnapshot("a", text: "obsolete", watchID: watchID)
        await transport.finishRequest("session.tool")
        let rejected = await pending.value
        XCTAssertTrue(rejected)
        XCTAssertEqual(store.messages.first?.text, "a")
        await store.reconnect()
        XCTAssertEqual(store.status, .connected)
        let newWatchID = await transport.watchID("a")
        XCTAssertNotEqual(newWatchID, watchID)
    }

    func testMalformedCurrentEventsReportProtocolFailureWhileOldWatchEventsAreIgnored() async throws {
        for topic in ["session.snapshot", "navigation.changed"] {
            let transport = StoreTransportFixture()
            let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
            await store.start()
            await transport.emitEvent("session.snapshot", params: .object(["watchId": .string("old")]))
            await transport.emitEvent("session.watch.failed", params: .object(["watchId": .string("old")]))
            XCTAssertEqual(store.status, .connected)
            let watchID = await transport.watchID("a")
            await transport.emitEvent(topic, params: .object([
                "watchId": .string(try XCTUnwrap(watchID)), "session": .null, "schemaVersion": .string("invalid")
            ]))
            XCTAssertEqual(store.status, .disconnected)
            XCTAssertEqual(store.connectionFailure, .protocolError)
            XCTAssertEqual(store.messages.first?.text, "a")
        }
    }

    func testRepeatedSnapshotsDoNotInvalidateTheConversationWithoutAChange() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.emitTranscriptSnapshot("a")
        var publications = 0
        let observation = store.objectWillChange.sink { publications += 1 }
        let revision = store.contentRevision
        for _ in 0..<10 { await transport.emitTranscriptSnapshot("a") }
        XCTAssertEqual(publications, 0)
        XCTAssertEqual(store.contentRevision, revision)
        await transport.emitSnapshot("a", text: "updated")
        XCTAssertGreaterThan(publications, 0)
        XCTAssertNil(store.transcript)
        XCTAssertTrue(store.transcriptRows.isEmpty)
        withExtendedLifetime(observation) {}
    }

    func testQuestionRepliesPreserveDraftsSuppressStaleSnapshotsAndClearOnSessionChange() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.emitQuestionSnapshot("a")
        let batch = try XCTUnwrap(store.questions.first)
        let target = DraftTarget(computerID: try XCTUnwrap(store.activeComputer?.id), sessionID: "a")
        store.messageDrafts[target] = "my draft"
        await transport.failNextRequest("question.answer", with: .remote("UPSTREAM_UNAVAILABLE"))
        do {
            try await store.answerQuestions(batch, answers: [.init(id: "name", selected: [], custom: "answer")], target: target)
            XCTFail("Failed answers must remain editable.")
        } catch {}
        XCTAssertEqual(store.questions.first?.id, batch.id)
        try await store.answerQuestions(batch, answers: [.init(id: "name", selected: [], custom: "answer")], target: target)
        XCTAssertTrue(store.questions.isEmpty)
        await transport.emitQuestionSnapshot("a")
        XCTAssertTrue(store.questions.isEmpty)
        XCTAssertEqual(store.messageDrafts[target], "my draft")
        await store.selectSession(try XCTUnwrap(store.sessions.first { $0.id == "b" }))
        XCTAssertTrue(store.questions.isEmpty)
    }

    func testConversationFeatureRepliesRejectAChangedSession() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let target = DraftTarget(computerID: try XCTUnwrap(store.activeComputer?.id), sessionID: "a")
        await transport.holdNextRequest("session.tool")
        let pending = Task { () -> Bool in
            do {
                _ = try await store.conversationRequest("session.tool", parameters: ["seq": .number(1)], target: target)
                return false
            } catch { return true }
        }
        await transport.waitForRequest("session.tool")
        await store.selectSession(try XCTUnwrap(store.sessions.first { $0.id == "b" }))
        await transport.finishRequest("session.tool")
        let rejected = await pending.value
        XCTAssertTrue(rejected)
    }

    func testQueueSnapshotActionsAndSessionIsolation() async throws {
        let transport = StoreTransportFixture()
        await transport.setQueue("a", texts: ["desktop follow up"])
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let queued = try XCTUnwrap(store.queuedMessages.first)
        XCTAssertEqual(queued.text, "desktop follow up")
        try await store.updateQueuedMessage(queued, action: "edit", text: "edited")
        XCTAssertEqual(store.queuedMessages.first?.text, "edited")
        XCTAssertNil(store.updatingQueueItemID)
        await transport.failNextRequest("session.queue.update", with: .remote("UPSTREAM_ERROR"))
        do {
            try await store.updateQueuedMessage(queued, action: "remove")
            XCTFail("A rejected queue operation must remain visible.")
        } catch {}
        XCTAssertEqual(store.queuedMessages.first?.text, "edited")
        XCTAssertNil(store.updatingQueueItemID)
        try await store.updateQueuedMessage(queued, action: "remove")
        XCTAssertTrue(store.queuedMessages.isEmpty)
        await transport.setQueue("a", texts: ["new desktop item"])
        await transport.emitSnapshot("a", text: "a")
        XCTAssertEqual(store.queuedMessages.first?.text, "new desktop item")
        await store.selectSession(try XCTUnwrap(store.sessions.first { $0.id == "b" }))
        XCTAssertTrue(store.queuedMessages.isEmpty)
    }

    func testQueueActionReplyCannotReplaceAnotherSessionsQueue() async throws {
        let transport = StoreTransportFixture()
        await transport.setQueue("a", texts: ["first"])
        await transport.setQueue("b", texts: ["second"])
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let message = try XCTUnwrap(store.queuedMessages.first)
        await transport.holdNextRequest("session.queue.update")
        let pending = Task { try? await store.updateQueuedMessage(message, action: "remove") }
        await transport.waitForRequest("session.queue.update")
        await store.selectSession(try XCTUnwrap(store.sessions.first { $0.id == "b" }))
        await transport.finishRequest("session.queue.update")
        await pending.value
        XCTAssertEqual(store.queuedMessages.first?.text, "second")
        XCTAssertNil(store.updatingQueueItemID)
    }

    func testSearchKeepsTheLatestQueryWhenAnOlderRequestFinishesLater() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let search = SessionSearchModel()
        search.query = "first phrase"
        await transport.holdNextRequest("session.search")
        let first = Task { await search.load(using: store) }
        await transport.waitForRequest("session.search")

        search.query = "second phrase"
        await search.load(using: store)
        XCTAssertEqual(search.results.first?.snippet, "second phrase")
        await transport.finishRequest("session.search")
        await first.value
        XCTAssertEqual(search.results.first?.snippet, "second phrase")

        await search.load(using: store)
        let requests = await transport.requestCount("session.search")
        XCTAssertEqual(requests, 2)
        XCTAssertFalse(search.isLoading)
    }

    func testClearingSearchDiscardsAnInFlightReply() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let search = SessionSearchModel()
        search.query = "message content"
        await transport.holdNextRequest("session.search")
        let pending = Task { await search.load(using: store) }
        await transport.waitForRequest("session.search")
        search.reset()
        await transport.finishRequest("session.search")
        await pending.value
        XCTAssertTrue(search.query.isEmpty)
        XCTAssertTrue(search.results.isEmpty)
        XCTAssertFalse(search.isLoading)
    }

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

    func testLostConnectionAndFailedRetryKeepConversationVisible() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.failConnections(with: .remote("AUTH_FAILED"))

        await transport.emitDisconnect()
        XCTAssertEqual(store.status, .disconnected)
        XCTAssertFalse(store.showsConnectionGuide)
        XCTAssertEqual(store.messages.first?.text, "a")
        await store.reconnect()

        XCTAssertEqual(store.status, .disconnected)
        XCTAssertFalse(store.showsConnectionGuide)
        XCTAssertEqual(store.messages.first?.text, "a")
        XCTAssertEqual(store.connectionFailure, .remote("AUTH_FAILED"))
    }

    func testColdLaunchRestoresLastConversationAndDraftFromDiskBeforeNetwork() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let firstTransport = StoreTransportFixture()
        let first = DSBotStore(
            repository: StoreComputerFixture(), client: firstTransport,
            conversationStorage: FileConversationStorage(directory: directory)
        )
        await first.start()
        await first.selectSession(session("b"))
        await firstTransport.emitTranscriptSnapshot("b")
        first.messageDrafts[DraftTarget(computerID: "local-fixture", sessionID: "b")] = "继续这里"
        await first.flushConversationCache()

        let transport = StoreTransportFixture()
        await transport.holdNextConnection()
        await transport.holdWatch("b")
        let restored = DSBotStore(
            repository: StoreComputerFixture(), client: transport,
            conversationStorage: FileConversationStorage(directory: directory)
        )
        let startup = Task { await restored.start() }
        await transport.waitForConnection()
        XCTAssertEqual(restored.selectedSession?.id, "b")
        XCTAssertEqual(restored.transcript?.entries.last?.text, "你好呀")
        XCTAssertFalse(restored.transcriptRows.isEmpty)
        XCTAssertEqual(restored.goal?.objective, "ship it")
        XCTAssertEqual(restored.messageDrafts[DraftTarget(computerID: "local-fixture", sessionID: "b")], "继续这里")
        XCTAssertFalse(restored.showsConnectionGuide)

        await transport.finishConnection()
        await transport.waitForWatch("b")
        XCTAssertEqual(restored.transcript?.entries.last?.text, "你好呀")
        await transport.finishWatch("b", text: "fresh history")
        await startup.value
        XCTAssertEqual(restored.selectedSession?.id, "b")
        XCTAssertEqual(restored.messages.last?.text, "fresh history")
        await restored.flushConversationCache()
    }

    func testWatchFailureKeepsPersistedContent() async throws {
        let cache = MemoryConversationStorage()
        await cache.save(cachedConversation())
        let transport = StoreTransportFixture()
        await transport.failNextRequest("session.watch", with: .timedOut)
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport, conversationStorage: cache)

        await store.start()

        XCTAssertEqual(store.selectedSession?.id, "b")
        XCTAssertEqual(store.messages.first?.text, "cached history")
        XCTAssertNotNil(store.error)
        XCTAssertFalse(store.showsConnectionGuide)
        await store.flushConversationCache()
    }

    func testMissingPersistedSessionFallsBackToAvailableConversation() async {
        let cache = MemoryConversationStorage()
        await cache.save(cachedConversation(sessionID: "removed"))
        let transport = StoreTransportFixture()
        await transport.failNextRequest("session.watch", with: .remote("NOT_FOUND"))
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport, conversationStorage: cache)

        await store.start()

        XCTAssertEqual(store.selectedSession?.id, "a")
        XCTAssertEqual(store.messages.first?.text, "a")
        await store.flushConversationCache()
    }

    func testPersistedNewTaskHomeDoesNotSelectFirstConversation() async {
        let cache = MemoryConversationStorage()
        let first = DSBotStore(repository: StoreComputerFixture(), client: StoreTransportFixture(), conversationStorage: cache)
        await first.start()
        first.beginNewTask()
        await first.flushConversationCache()
        let restored = DSBotStore(repository: StoreComputerFixture(), client: StoreTransportFixture(), conversationStorage: cache)

        await restored.start()

        XCTAssertTrue(restored.isChoosingWorkspace)
        XCTAssertNil(restored.selectedSession)
        XCTAssertTrue(restored.messages.isEmpty)
        await restored.flushConversationCache()
    }

    func testAnotherComputersCacheDoesNotAppearDuringStartup() async {
        let cache = MemoryConversationStorage()
        await cache.save(cachedConversation(computerID: "other-computer"))
        let transport = StoreTransportFixture()
        await transport.holdNextConnection()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport, conversationStorage: cache)
        let startup = Task { await store.start() }
        await transport.waitForConnection()

        XCTAssertNil(store.selectedSession)
        XCTAssertTrue(store.messages.isEmpty)
        XCTAssertTrue(store.isLoading)
        XCTAssertFalse(store.isRestoring)
        await transport.finishConnection()
        await startup.value
        await store.flushConversationCache()
    }

    func testRemovingComputerAlsoRemovesQueuedConversationCache() async throws {
        let cache = MemoryConversationStorage()
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport, conversationStorage: cache)
        await store.start()
        await transport.emitSnapshot("a", text: "latest before removal")
        let computer = try XCTUnwrap(store.activeComputer)

        await store.removeComputer(computer)
        await store.flushConversationCache()

        let snapshot = await cache.load(for: computer.id)
        XCTAssertNil(snapshot)
        XCTAssertNil(store.selectedSession)
    }

    func testFailedComputerSwitchCannotLeakItsCacheIntoThePreviousNewTaskHome() async {
        let cache = MemoryConversationStorage()
        await cache.save(cachedConversation(computerID: "other", sessionID: "other-session"))
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport, conversationStorage: cache)
        await store.start()
        store.beginNewTask()
        await transport.failConnections(with: .connectionFailed)
        let other = Computer(
            id: "other", name: "Other computer",
            url: "http://127.0.0.1:3170/dsbot?pair=" + String(repeating: "b", count: 43),
            lastUsedAt: 0
        )

        await store.selectComputer(other)

        XCTAssertEqual(store.activeComputer?.id, "local-fixture")
        XCTAssertTrue(store.isChoosingWorkspace)
        XCTAssertNil(store.selectedSession)
        XCTAssertTrue(store.messages.isEmpty)
        await store.flushConversationCache()
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
        let initialModels = store.models
        await transport.failNextRequest("catalog.get", with: .remote("TEMPORARY"))

        await store.refreshCatalog()

        XCTAssertEqual(store.catalogError, DSBotFailure.remote("TEMPORARY").localizedDescription)
        XCTAssertFalse(store.isLoadingCatalog)
        XCTAssertNil(store.error)
        XCTAssertEqual(store.models, initialModels)

        await store.refreshCatalog()

        XCTAssertNil(store.catalogError)
        XCTAssertEqual(store.models, initialModels)
    }

    func testStopCoalescesRequestsAndResetsWhenStartingANewTask() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.holdNextRequest("session.stop")
        let stopping = Task { await store.stopSession() }
        await transport.waitForRequest("session.stop")
        XCTAssertTrue(store.isStoppingSession)

        await store.stopSession()
        let requests = await transport.requestCount("session.stop")
        XCTAssertEqual(requests, 1)
        store.beginNewTask()
        XCTAssertFalse(store.isStoppingSession)
        await transport.finishRequest("session.stop")
        await stopping.value
        XCTAssertFalse(store.isStoppingSession)
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

    func testPlanCommandUpdatesImmediatelyAndRejectsSnapshotsFromThePreviousWatch() async throws {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        let watchID = await transport.watchID(for: "a")
        let previousWatchID = try XCTUnwrap(watchID)
        let draftTarget = DraftTarget(computerID: "local-fixture", sessionID: "a")
        store.messageDrafts[draftTarget] = "Keep this draft"
        let messages = store.messages
        await transport.holdWatch("a")

        let entering = Task { await store.runCommand(.plan) }
        await transport.waitForWatch("a")

        XCTAssertTrue(store.planMode)
        XCTAssertTrue(store.isChangingPlanMode)
        XCTAssertFalse(store.isLoadingSession)
        XCTAssertEqual(store.messages, messages)
        await transport.emitSnapshot("a", text: "stale", watchID: previousWatchID)
        XCTAssertEqual(store.messages, messages)
        XCTAssertTrue(store.planMode)
        _ = await store.runCommand(.plan)
        let pendingRequests = await transport.commandParams()
        XCTAssertEqual(pendingRequests.count, 1)

        await transport.finishWatch("a", text: "a")
        let outcome = await entering.value
        XCTAssertEqual(outcome?.isError, false)
        XCTAssertTrue(store.planMode)
        XCTAssertFalse(store.isChangingPlanMode)
        XCTAssertEqual(store.messageDrafts[draftTarget], "Keep this draft")

        _ = await store.runCommand(.plan, argument: "off")
        XCTAssertFalse(store.planMode)
        XCTAssertFalse(store.isChangingPlanMode)
        let watchCount = await transport.watchCount("a")
        XCTAssertEqual(watchCount, 3)
    }

    func testRefusedPlanCommandPreservesTheModeAndDoesNotReplaceTheWatch() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.emitTranscriptSnapshot("a")
        await transport.setCommandReply(.object(["kind": .string("error"), "text": .string("Plan mode is unavailable.")]))

        let outcome = await store.runCommand(.plan, argument: "off")

        XCTAssertEqual(outcome?.isError, true)
        XCTAssertTrue(store.planMode)
        XCTAssertFalse(store.isChangingPlanMode)
        let watchCount = await transport.watchCount("a")
        XCTAssertEqual(watchCount, 1)
    }

    func testLatePlanCommandCannotChangeAnotherSessionsModeOrWatch() async {
        let transport = StoreTransportFixture()
        let store = DSBotStore(repository: StoreComputerFixture(), client: transport)
        await store.start()
        await transport.holdNextRequest("session.command")
        let entering = Task { await store.runCommand(.plan) }
        await transport.waitForRequest("session.command")
        XCTAssertTrue(store.isChangingPlanMode)

        await store.selectSession(session("b"))
        XCTAssertFalse(store.isChangingPlanMode)
        await transport.finishRequest("session.command")
        let outcome = await entering.value

        XCTAssertNil(outcome)
        XCTAssertEqual(store.selectedSession?.id, "b")
        XCTAssertFalse(store.planMode)
        XCTAssertFalse(store.isChangingPlanMode)
        let watchCount = await transport.watchCount("b")
        XCTAssertEqual(watchCount, 1)
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

    private func cachedConversation(computerID: String = "local-fixture", sessionID: String = "b") -> ConversationSnapshot {
        ConversationSnapshot(
            computerID: computerID, sessions: [session("a"), session(sessionID)], workspaces: [],
            detail: SessionDetail(
                session: session(sessionID),
                messages: [ChatMessage(id: "cached", role: "assistant", text: "cached history")]
            ), isChoosingWorkspace: false, drafts: [:]
        )
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
    private var planModes: [String: Bool] = [:]
    private var createRequests: [[String: JSONValue]] = []
    private var configureRequests: [[String: JSONValue]] = []
    private var extraListedRows: [JSONValue] = []
    private var createdWorkspaces: [String: String] = [:]
    private var navigationReply: JSONValue?
    private var forkReply: JSONValue = .object([:])
    private var queues: [String: [JSONValue]] = [:]

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
        let listedSessions = method == "session.list" ? ["a", "b", "c"].map { summary($0) } + extraListedRows : []
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
            return .array(listedSessions)
        case "session.fork":
            return forkReply
        case "session.search":
            return .object([
                "items": .array([.object(["session": summary("a"), "snippet": params["query"] ?? .string("")])]),
                "hasMore": .bool(false)
            ])
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
            if params["command"]?.stringValue == "plan", commandReply["kind"]?.stringValue != "error",
               let id = params["id"]?.stringValue {
                planModes[id] = params["argument"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) != "off"
            }
            return commandReply
        case "file.upload":
            uploadRequests.append(params)
            return .object([
                "receiptId": .string("receipt-1"), "name": params["name"] ?? .string("file"), "bytes": .number(3)
            ])
        case "session.send":
            sendRequests.append(params)
            return .bool(true)
        case "session.queue.update":
            let id = params["id"]!.stringValue!
            let itemID = params["itemId"]?.stringValue
            if params["action"]?.stringValue == "edit" {
                queues[id] = queues[id, default: []].map { item in
                    guard item["id"]?.stringValue == itemID else { return item }
                    var value = item.objectValue!
                    value["text"] = params["text"]
                    return .object(value)
                }
            } else {
                queues[id]?.removeAll { $0["id"]?.stringValue == itemID }
            }
            return .object(["queuedMessages": .array(queues[id] ?? [])])
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
    func emitEvent(_ topic: String, params: JSONValue) async {
        await event?(.object(["type": .string("event"), "topic": .string(topic), "params": params]))
    }
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
    func setQueue(_ id: String, texts: [String]) {
        queues[id] = texts.enumerated().map { index, text in
            .object(["id": .string("\(id)-\(index)"), "text": .string(text), "editable": .bool(true)])
        }
    }
    func setCommandReply(_ reply: JSONValue) { commandReply = reply }
    func setForkReply(_ reply: JSONValue) { forkReply = reply }
    func listSession(_ id: String) { extraListedRows.append(summary(id)) }
    func watchID(for id: String) -> String? { watchIDs[id] }
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

    func emitQuestionSnapshot(_ id: String) async {
        var params = detail(id, text: id).objectValue!
        params["questions"] = .array([.object([
            "id": .string("question-\(id)"), "sessionId": .string(id), "state": .string("continued"),
            "questions": .array([.object([
                "id": .string("name"), "question": .string("Name?"), "multiSelect": .bool(false), "options": .array([])
            ])])
        ])])
        params["watchId"] = .string(watchIDs[id] ?? "")
        await event?(.object(["type": .string("event"), "topic": .string("session.snapshot"), "params": .object(params)]))
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
            "planMode": .bool(planModes[id] ?? false),
            "queuedMessages": .array(queues[id] ?? []),
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
