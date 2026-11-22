import Foundation

/// Reading the board once, for a phone that is away (owner, 2026-11-22). The App does it when a silent push wakes it (`BoardWake`), and the notification extension does it when a notice of a
/// reply arrives (`DuduNotificationService`), also when the App was swiped away and iOS will not wake it. Both compile this file: it needs only the saved computers, the network client and the
/// shared record. A read of the list, never a read receipt.
enum BoardWakeFetch {
    /// The seconds the whole job may take: iOS gives an extension and a woken App about thirty before it stops them.
    static let budgetSeconds: UInt64 = 22

    /// The computer a wake push or a notice names, or nil for any other push.
    static func computerID(in userInfo: [AnyHashable: Any]) -> String? {
        guard let value = userInfo["dudu"] as? [String: Any],
              value["version"] as? Int == 1, value["kind"] as? String == "board",
              let computer = value["computerId"] as? String,
              !computer.isEmpty, computer.utf8.count <= 128 else { return nil }
        return computer
    }

    /// The computer's answer to `board.list`, as it came, or nil when this phone does not know the computer. The connection it makes is let go again, whatever happens.
    static func read(
        computerID: String, repository: any DuduComputerStorage, client: any DuduTransport
    ) async throws -> JSONValue? {
        let library = try await repository.load()
        guard let computer = library.computers.first(where: { $0.computerId == computerID }) else { return nil }
        let endpoint = try ConnectionEndpoint.saved(computer)
        _ = try await client.connect(
            endpoint: endpoint, expectedComputerId: computerID, generation: 1,
            onEvent: { _ in }, onDisconnect: {}
        )
        do {
            let value = try await client.request("board.list", params: [
                "tab": .string("all"), "layout": .string("chat"), "filterData": .bool(true),
            ], timeoutSeconds: 15)
            await client.disconnect()
            return value
        } catch {
            await client.disconnect()
            throw error
        }
    }

    /// Reads the board and writes it to the shared record. True if the record was written.
    static func write(
        computerID: String,
        repository: any DuduComputerStorage = ComputerRepository.shared,
        client: any DuduTransport = DuduHTTPClient(),
        store: any BoardWakeStore = KeychainVault(),
        now: @Sendable () -> Date = { Date() }
    ) async -> Bool {
        let started = Date()
        do {
            guard let answer = try await read(computerID: computerID, repository: repository, client: client) else {
                DuduLog.record("board.wake.skip", state: "unknown_computer")
                await BoardWakeStatus(at: now(), written: false, failure: "UNKNOWN_COMPUTER", elapsedMs: Date().timeIntervalSince(started) * 1_000).save(to: store)
                return false
            }
            try await BoardWakeRecord(computerID: computerID, savedAt: now(), answer: answer).write(to: store)
            let elapsed = Date().timeIntervalSince(started) * 1_000
            DuduLog.record("board.wake.written", elapsedMs: elapsed)
            await BoardWakeStatus(at: now(), written: true, failure: nil, elapsedMs: elapsed).save(to: store)
            return true
        } catch {
            let elapsed = Date().timeIntervalSince(started) * 1_000
            DuduLog.networkFailure("board.wake.fail", error: error, elapsedMs: elapsed)
            await BoardWakeStatus(at: now(), written: false, failure: (error as? DuduFailure)?.logCode ?? "OTHER", elapsedMs: elapsed).save(to: store)
            return false
        }
    }
}
