import CryptoKit
import Foundation

/// Display data only. Restoring the homepage must never send a session read receipt.
struct BoardSnapshot: Codable, Equatable, Sendable {
    var version = 1
    var computerID: String
    var conversationsByTab: [String: [BoardConversation]]
    var pins: [String]
    var unreadCount: Int
    var filterStatuses: [IssueWorkflowStatus]? = nil
    /// When it was written. It orders a board the phone wrote while it was away (`BoardWake`) against the one the App holds; two boards with the same rows are equal whatever their time.
    var savedAt: Date? = nil

    static func == (lhs: BoardSnapshot, rhs: BoardSnapshot) -> Bool {
        lhs.version == rhs.version && lhs.computerID == rhs.computerID && lhs.conversationsByTab == rhs.conversationsByTab
            && lhs.pins == rhs.pins && lhs.unreadCount == rhs.unreadCount && lhs.filterStatuses == rhs.filterStatuses
    }

    func validate(for computerID: String) throws {
        guard version == 1 else { throw ConversationStorageError.unsupportedVersion }
        guard self.computerID == computerID else { throw ConversationStorageError.identityMismatch }
        guard unreadCount >= 0, Set(pins).count == pins.count,
              conversationsByTab.allSatisfy({ key, rows in
                  // "backlog" is the scope 未读 replaced (2026-11-21): an older cache may still hold it, and restoring skips it.
                  (BoardTab(rawValue: key) != nil || key == "backlog") && Set(rows.map(\.id)).count == rows.count
              }) else { throw ConversationStorageError.invalidData }
    }
}

/// The board's filter (筛选), kept per computer so that the App opens on the board as it was left (owner, 2026-11-23: 「退出 APP 再进去就没了，应该持久化一下」). Keyed like the
/// board cache, by the phone's own id of the computer; a few short keys, so `UserDefaults` beside the sidebar's own choices.
struct BoardFilterStore {
    var defaults: UserDefaults = .standard

    func load(for computerID: String) -> BoardFilters {
        guard let data = defaults.data(forKey: key(computerID)),
              let saved = try? JSONDecoder().decode([String: [String?]].self, from: data) else { return BoardFilters() }
        return BoardFilters(saved: saved)
    }

    func save(_ filters: BoardFilters, for computerID: String) {
        guard !filters.isEmpty, let data = try? JSONEncoder().encode(filters.saved) else { return remove(for: computerID) }
        defaults.set(data, forKey: key(computerID))
    }

    func remove(for computerID: String) {
        defaults.removeObject(forKey: key(computerID))
    }

    private func key(_ computerID: String) -> String {
        "dudu.board.filters." + SHA256.hash(data: Data(computerID.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

protocol DuduBoardStorage: Actor {
    func load(for computerID: String) async throws -> BoardSnapshot?
    func save(_ snapshot: BoardSnapshot) async throws
    func remove(for computerID: String) async throws
}

actor FileBoardStorage: DuduBoardStorage {
    static let shared = FileBoardStorage()
    private let directory: URL?
    private let maximumBytes: Int
    private let totalMaximumBytes: Int
    // A write already queued by a removed computer cannot recreate its private cache.
    private var removed: Set<String> = []

    init(directory: URL? = nil, maximumBytes: Int = 4 * 1_024 * 1_024, totalMaximumBytes: Int = 16 * 1_024 * 1_024) {
        self.directory = directory
        self.maximumBytes = maximumBytes
        self.totalMaximumBytes = totalMaximumBytes
    }

    func load(for computerID: String) throws -> BoardSnapshot? {
        guard !removed.contains(computerID) else { return nil }
        let url = try fileURL(for: computerID)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= maximumBytes else {
            throw ConversationStorageError.limitExceeded
        }
        do {
            let snapshot = try JSONDecoder().decode(BoardSnapshot.self, from: Data(contentsOf: url))
            try snapshot.validate(for: computerID)
            return snapshot
        } catch is DecodingError { throw ConversationStorageError.invalidData }
    }

    func save(_ snapshot: BoardSnapshot) throws {
        guard !removed.contains(snapshot.computerID) else { return }
        try snapshot.validate(for: snapshot.computerID)
        let data = try JSONEncoder().encode(snapshot)
        guard data.count <= min(maximumBytes, totalMaximumBytes) else { throw ConversationStorageError.limitExceeded }
        let url = try fileURL(for: snapshot.computerID)
        var folder = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try folder.setResourceValues(values)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        let records = try FileManager.default.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey], options: [.skipsHiddenFiles]
        ).filter { $0.pathExtension == "json" }.map { url in
            let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            return (url: url, size: values.fileSize ?? 0, date: values.contentModificationDate ?? .distantPast)
        }.sorted { $0.date < $1.date }
        var total = records.reduce(0) { $0 + $1.size }
        for record in records where record.url != url && total > totalMaximumBytes {
            try FileManager.default.removeItem(at: record.url)
            total -= record.size
        }
    }

    func remove(for computerID: String) throws {
        removed.insert(computerID)
        let url = try fileURL(for: computerID)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }

    private func fileURL(for computerID: String) throws -> URL {
        let root = try directory ?? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false
        ).appendingPathComponent("ChatHome", isDirectory: true)
        let key = SHA256.hash(data: Data(computerID.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(key + ".json")
    }
}
