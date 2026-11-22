import XCTest
@testable import Dudu

final class BoardWakeTests: XCTestCase {
    func testOnlyAWakePushNamingAComputerIsRecognised() {
        func push(_ dudu: [String: Any]) -> [AnyHashable: Any] { ["aps": ["content-available": 1], "dudu": dudu] }
        XCTAssertEqual(BoardWake.computerID(in: push(["version": 1, "kind": "board", "computerId": "desktop"])), "desktop")
        XCTAssertNil(BoardWake.computerID(in: push(["version": 1, "collectorId": "mentions", "computerId": "desktop"])), "a collector's alert is not a wake")
        XCTAssertNil(BoardWake.computerID(in: push(["version": 2, "kind": "board", "computerId": "desktop"])))
        XCTAssertNil(BoardWake.computerID(in: push(["version": 1, "kind": "board", "computerId": ""])))
        XCTAssertNil(BoardWake.computerID(in: push(["version": 1, "kind": "board", "computerId": String(repeating: "x", count: 129)])))
        XCTAssertNil(BoardWake.computerID(in: ["aps": ["content-available": 1]]))
    }

    func testAWakeReadsTheBoardOnceAndWritesItOnlyWhenItChanged() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = FileBoardStorage(directory: directory)
        let computers = WakeComputers()
        let transport = try WakeTransport(reply: Self.answer(["issue:1"]))
        func wake(_ id: String = "desktop-fixture", at seconds: TimeInterval) async -> UIBackgroundFetchResult {
            await BoardWake.run(computerID: id, repository: computers, client: transport, storage: storage, now: { Date(timeIntervalSince1970: seconds) })
        }

        let first = await wake(at: 1_000)
        XCTAssertEqual(first, .newData)
        let saved = try await storage.load(for: "desktop-fixture")
        XCTAssertEqual(saved?.conversationsByTab["all"]?.map(\.id), ["issue:1"])
        XCTAssertEqual(saved?.conversationsByTab["all"]?.first?.preview, "Done", "the preview is prepared as the board prepares it")
        XCTAssertEqual(saved?.savedAt, Date(timeIntervalSince1970: 1_000))

        let again = await wake(at: 2_000)
        XCTAssertEqual(again, .noData, "the same rows are not written again")
        let kept = try await storage.load(for: "desktop-fixture")
        XCTAssertEqual(kept?.savedAt, Date(timeIntervalSince1970: 1_000))
        let stranger = await wake("someone-else", at: 3_000)
        XCTAssertEqual(stranger, .noData, "a computer this phone does not know is not connected to")
        let counts = await transport.counts
        XCTAssertEqual(counts.requests, ["board.list", "board.list"], "only the list is read: never a read receipt")
        XCTAssertEqual([counts.connects, counts.disconnects], [2, 2], "every wake lets go of the connection it made")

        let down = WakeTransport(reply: .null, connectFailure: .connectionFailed)
        let failed = await BoardWake.run(computerID: "desktop-fixture", repository: computers, client: down, storage: storage, now: { Date() })
        XCTAssertEqual(failed, .failed)
        let unchanged = try await storage.load(for: "desktop-fixture")
        XCTAssertEqual(unchanged?.savedAt, Date(timeIntervalSince1970: 1_000), "a wake that could not read writes nothing")
    }

    @MainActor
    func testComingBackShowsABoardWrittenWhileAwayButNeverAnOlderOne() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = FileBoardStorage(directory: directory)
        func write(_ ids: [String], at seconds: TimeInterval) async throws {
            let rows = try Self.rows(ids)
            try await storage.save(BoardSnapshot(
                computerID: "first", conversationsByTab: ["all": rows], pins: [], unreadCount: 0, savedAt: Date(timeIntervalSince1970: seconds)
            ))
        }
        try await write(["issue:1"], at: 100)
        let board = BoardModel(storage: storage)
        board.reset(for: "first")
        board.select(.all)
        await board.adoptNewerSnapshot()
        XCTAssertEqual(board.conversations.map(\.id), ["issue:1"], "the restored board is the one held")

        try await write(["issue:1", "issue:2"], at: 200)
        await board.adoptNewerSnapshot()
        XCTAssertEqual(board.conversations.map(\.id), ["issue:1", "issue:2"], "a board written while away is shown at once")

        try await write(["issue:3"], at: 150)
        await board.adoptNewerSnapshot()
        XCTAssertEqual(board.conversations.map(\.id), ["issue:1", "issue:2"], "an older board never replaces a newer one")
    }

    @MainActor
    func testTheExtensionWritesTheBoardAsARecordAndTheBoardAdoptsItOnlyIfNewer() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let storage = FileBoardStorage(directory: directory)
        let records = WakeRecords()
        let transport = try WakeTransport(reply: Self.answer(["issue:1", "issue:2"]))
        let written = await BoardWakeFetch.write(
            computerID: "desktop-fixture", repository: WakeComputers(), client: transport, store: records, now: { Date(timeIntervalSince1970: 500) }
        )
        XCTAssertTrue(written)
        let stranger = await BoardWakeFetch.write(
            computerID: "someone-else", repository: WakeComputers(), client: transport, store: records, now: { Date(timeIntervalSince1970: 600) }
        )
        XCTAssertFalse(stranger, "a computer this phone does not know is not connected to")
        let counts = await transport.counts
        XCTAssertEqual(counts.requests, ["board.list"], "the extension reads the list and nothing else")
        XCTAssertEqual([counts.connects, counts.disconnects], [1, 1])
        let status = await BoardWakeStatus.load(from: records)
        XCTAssertEqual(status?.written, false, "the last run is the stranger: it wrote nothing")
        XCTAssertEqual(status?.failure, "UNKNOWN_COMPUTER")
        let down = WakeTransport(reply: .null, connectFailure: .connectionFailed)
        let failed = await BoardWakeFetch.write(computerID: "desktop-fixture", repository: WakeComputers(), client: down, store: records, now: { Date(timeIntervalSince1970: 700) })
        XCTAssertFalse(failed)
        let failure = await BoardWakeStatus.load(from: records)
        XCTAssertEqual([failure?.written, failure?.failure == nil], [false, false], "a failed run leaves its code for the App to log")

        // The App's own cache is older: the board takes the extension's record at once, and keeps it for a cold start.
        try await storage.save(BoardSnapshot(
            computerID: "desktop-fixture", conversationsByTab: ["all": try Self.rows(["issue:1"])], pins: [], unreadCount: 0, savedAt: Date(timeIntervalSince1970: 100)
        ))
        let board = BoardModel(storage: storage, wakeStore: records)
        board.reset(for: "desktop-fixture")
        board.select(.all)
        await board.adoptNewerSnapshot()
        XCTAssertEqual(board.conversations.map(\.id), ["issue:1", "issue:2"])
        let kept = try await storage.load(for: "desktop-fixture")
        XCTAssertEqual(kept?.conversationsByTab["all"]?.map(\.id), ["issue:1", "issue:2"])
        XCTAssertEqual(kept?.savedAt, Date(timeIntervalSince1970: 500))

        // A record older than what the board holds is never adopted.
        try await BoardWakeRecord(computerID: "desktop-fixture", savedAt: Date(timeIntervalSince1970: 300), answer: Self.answer(["issue:9"])).write(to: records)
        await board.adoptNewerSnapshot()
        XCTAssertEqual(board.conversations.map(\.id), ["issue:1", "issue:2"])
    }

    private static func rows(_ ids: [String]) throws -> [BoardConversation] {
        let json = ids.enumerated().map { index, id in """
        {"id":"\(id)","title":"Issue \(index)","sessionId":"s\(index)","preview":"**Done**","receivedAt":\(10 + index),"sessionState":"unread","deepSleep":false,"unread":true,"readSeq":3,"pinned":false,
         "issue":{"id":\(index + 1),"title":"Issue \(index)","status":"todo","statusType":"todo","priority":"none","updatedAt":1}}
        """ }.joined(separator: ",")
        return try JSONDecoder().decode([BoardConversation].self, from: Data("[\(json)]".utf8))
    }

    private static func answer(_ ids: [String]) throws -> JSONValue {
        let rows = try JSONEncoder().encode(try rows(ids))
        let text = #"{"outcome":"success","tab":"all","total":\#(ids.count),"conversations":\#(String(decoding: rows, as: UTF8.self)),"pins":[],"statuses":[]}"#
        return try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }
}

private actor WakeRecords: BoardWakeStore {
    private var items: [String: Data] = [:]

    func load(_ key: String) async throws -> Data? { items[key] }
    func save(_ data: Data, for key: String) async throws { items[key] = data }
}

private actor WakeComputers: DuduComputerStorage {
    private let library = ComputerLibrary(
        computers: [Computer(
            id: "local-fixture", name: "Fixture", url: "http://127.0.0.1:3170/?pair=" + String(repeating: "a", count: 43),
            computerId: "desktop-fixture", lastUsedAt: 0
        )],
        activeId: "local-fixture"
    )

    func load() async throws -> ComputerLibrary { library }
    func pairAuthenticated(endpoint: ConnectionEndpoint, readyId: String) async throws -> ComputerLibrary { library }
    func activateAuthenticated(localId: String, readyId: String) async throws -> ComputerLibrary { library }
    func remove(_ localId: String) async throws -> ComputerLibrary { library }
}

private actor WakeTransport: DuduTransport {
    private let reply: JSONValue
    private let connectFailure: DuduFailure?
    private var connects = 0
    private var disconnects = 0
    private var requests: [String] = []

    init(reply: JSONValue, connectFailure: DuduFailure? = nil) {
        self.reply = reply
        self.connectFailure = connectFailure
    }

    var counts: (connects: Int, disconnects: Int, requests: [String]) { (connects, disconnects, requests) }

    func connect(
        endpoint: ConnectionEndpoint, expectedComputerId: String?, generation: Int,
        onEvent: @escaping @Sendable (JSONValue) async -> Void, onDisconnect: @escaping @Sendable () async -> Void
    ) async throws -> (id: String, name: String) {
        connects += 1
        if let connectFailure { throw connectFailure }
        return (id: expectedComputerId ?? "desktop-fixture", name: "Fixture")
    }

    func request(_ method: String, params: [String: JSONValue], timeoutSeconds: UInt64) async throws -> JSONValue {
        requests.append(method)
        return reply
    }

    func disconnect() async { disconnects += 1 }
    func disconnect(throughGeneration: Int) async { disconnects += 1 }
}
