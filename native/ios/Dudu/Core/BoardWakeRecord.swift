import CryptoKit
import Foundation

/// The board as the computer last answered it, written where both the App and the notification extension can reach it. The extension runs in a process and a sandbox of its own, even when the App
/// was swiped away, so it cannot write the App's own cache; it writes this record into the Keychain, in the App's own access group, which both can read and which needs nothing the Apple developer
/// account would have to be asked for (an App Group would). The App adopts it (`BoardModel.adoptNewerSnapshot`). The answer is kept as the computer sent it, so that the extension needs none of
/// the App's board types.
struct BoardWakeRecord: Codable, Equatable, Sendable {
    var computerID: String
    var savedAt: Date
    var answer: JSONValue

    /// The Keychain account of one computer's record: made of a hash, so that no identity is an account name.
    static func key(for computerID: String) -> String {
        "dudu.boardwake." + SHA256.hash(data: Data(computerID.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func write(to store: any BoardWakeStore = KeychainVault()) async throws {
        try await store.save(try JSONEncoder().encode(self), for: Self.key(for: computerID))
    }

    static func read(computerID: String, from store: any BoardWakeStore = KeychainVault()) async -> BoardWakeRecord? {
        guard let data = try? await store.load(Self.key(for: computerID)), data.count <= 8 * 1_024 * 1_024,
              let record = try? JSONDecoder().decode(BoardWakeRecord.self, from: data), record.computerID == computerID else { return nil }
        return record
    }
}

/// What the notification extension did the last time it ran. Its own log lies in a container that nothing reads, so it leaves this in the Keychain, and the App logs it when it comes to the front
/// (`board.service.last`): whether the extension ran at all, whether it reached the computer, and how long it took.
struct BoardWakeStatus: Codable, Equatable, Sendable {
    var at: Date
    var written: Bool
    /// The log code of the failure, if there was one.
    var failure: String?
    var elapsedMs: Double

    static let key = "dudu.boardwake.status"

    func save(to store: any BoardWakeStore = KeychainVault()) async {
        guard let data = try? JSONEncoder().encode(self) else { return }
        try? await store.save(data, for: Self.key)
    }

    static func load(from store: any BoardWakeStore = KeychainVault()) async -> BoardWakeStatus? {
        guard let data = try? await store.load(key) else { return nil }
        return try? JSONDecoder().decode(BoardWakeStatus.self, from: data)
    }
}

/// Where a `BoardWakeRecord` is kept: the Keychain, or something else in a test.
protocol BoardWakeStore: Sendable {
    func load(_ key: String) async throws -> Data?
    func save(_ data: Data, for key: String) async throws
}

extension KeychainVault: BoardWakeStore {
    func load(_ key: String) async throws -> Data? { try get(key) }
    func save(_ data: Data, for key: String) async throws { try set(data, for: key) }
}
