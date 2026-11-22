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

    /// What one read of the board brought back.
    struct Reading: Sendable {
        /// The phone's own id of the computer (`Computer.id`): the key the board's cache and the shared record are kept under, as `BoardModel` looks for them. A push names the computer by the id
        /// the computer knows itself by (`Computer.computerId`), which is another one: a board written under that id lies where nothing reads it (found 2026-11-22: a board written 0.7 s after
        /// the push was never shown, and opening the App read it again from the computer, 1.5 s later).
        let key: String
        /// The computer's answer to `board.list`, as it came.
        let answer: JSONValue
    }

    /// The computer's answer to `board.list` and the key to keep it under, or nil when this phone does not know the computer. The connection it makes is let go again, whatever happens.
    static func read(
        computerID: String, repository: any DuduComputerStorage, client: any DuduTransport
    ) async throws -> Reading? {
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
            return Reading(key: computer.id, answer: value)
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
            guard let reading = try await read(computerID: computerID, repository: repository, client: client) else {
                DuduLog.record("board.wake.skip", state: "unknown_computer")
                await BoardWakeStatus(at: now(), written: false, failure: "UNKNOWN_COMPUTER", elapsedMs: Date().timeIntervalSince(started) * 1_000).save(to: store)
                return false
            }
            try await BoardWakeRecord(computerID: reading.key, savedAt: now(), answer: reading.answer).write(to: store)
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
