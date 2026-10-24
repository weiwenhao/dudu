import CryptoKit
import Foundation

struct ConversationSnapshot: Codable, Sendable, Equatable {
    var version = 1
    var computerID: String
    var sessions: [SessionSummary]
    var workspaces: [WorkspaceSummary]
    var detail: SessionDetail?
    var isChoosingWorkspace: Bool
    var drafts: [String: String]
    var models: [Choice] = []
    var permissions: [Choice] = []
    var presets: [Choice] = []
    var selectedPresetID: String?
}

protocol DSBotConversationStorage: Actor {
    func load(for computerID: String) async throws -> ConversationSnapshot?
    func save(_ snapshot: ConversationSnapshot) async throws
    func remove(for computerID: String) async throws
}

enum ConversationStorageError: Error, Sendable, Equatable {
    case invalidData
    case unsupportedVersion
    case identityMismatch
    case limitExceeded

    var logCode: String {
        switch self {
        case .invalidData: return "CACHE_INVALID_DATA"
        case .unsupportedVersion: return "CACHE_UNSUPPORTED_VERSION"
        case .identityMismatch: return "CACHE_IDENTITY_MISMATCH"
        case .limitExceeded: return "CACHE_LIMIT_EXCEEDED"
        }
    }
}

actor MemoryConversationStorage: DSBotConversationStorage {
    private var snapshots: [String: ConversationSnapshot] = [:]

    func load(for computerID: String) -> ConversationSnapshot? { snapshots[computerID] }
    func save(_ snapshot: ConversationSnapshot) { snapshots[snapshot.computerID] = snapshot }
    func remove(for computerID: String) { snapshots.removeValue(forKey: computerID) }
}

actor FileConversationStorage: DSBotConversationStorage {
    private let directory: URL?
    private let maximumBytes: Int
    private let totalMaximumBytes: Int

    init(directory: URL? = nil, maximumBytes: Int = 32 * 1_024 * 1_024, totalMaximumBytes: Int = 64 * 1_024 * 1_024) {
        self.directory = directory
        self.maximumBytes = maximumBytes
        self.totalMaximumBytes = totalMaximumBytes
    }

    func load(for computerID: String) throws -> ConversationSnapshot? {
        let url = try fileURL(for: computerID)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber, size.intValue <= maximumBytes else {
            throw ConversationStorageError.limitExceeded
        }
        do {
            let data = try Data(contentsOf: url)
            let snapshot = try JSONDecoder().decode(ConversationSnapshot.self, from: data)
            guard snapshot.version == 1 else { throw ConversationStorageError.unsupportedVersion }
            guard snapshot.computerID == computerID else { throw ConversationStorageError.identityMismatch }
            return snapshot
        } catch is DecodingError {
            throw ConversationStorageError.invalidData
        }
    }

    func save(_ snapshot: ConversationSnapshot) throws {
        guard snapshot.version == 1 else { throw ConversationStorageError.unsupportedVersion }
        let data = try JSONEncoder().encode(snapshot)
        guard data.count <= maximumBytes, data.count <= totalMaximumBytes else {
            throw ConversationStorageError.limitExceeded
        }
        let url = try fileURL(for: snapshot.computerID)
        var directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        try prune(keeping: url)
    }

    func remove(for computerID: String) throws {
        let url = try fileURL(for: computerID)
        if FileManager.default.fileExists(atPath: url.path) {
            try FileManager.default.removeItem(at: url)
        }
    }

    private func fileURL(for computerID: String) throws -> URL {
        let root: URL
        if let directory {
            root = directory
        } else {
            root = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false
            ).appendingPathComponent("Conversations", isDirectory: true)
        }
        let key = SHA256.hash(data: Data(computerID.utf8)).map { String(format: "%02x", $0) }.joined()
        return root.appendingPathComponent(key + ".json")
    }

    private func prune(keeping current: URL) throws {
        let files = try FileManager.default.contentsOfDirectory(
            at: current.deletingLastPathComponent(),
            includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey], options: [.skipsHiddenFiles]
        ).filter { $0.pathExtension == "json" }
        let records = try files.map { url in
            let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            return (url: url, size: values.fileSize ?? 0, date: values.contentModificationDate ?? .distantPast)
        }.sorted { $0.date < $1.date }
        var total = records.reduce(0) { $0 + $1.size }
        for record in records where record.url != current && total > totalMaximumBytes {
            try FileManager.default.removeItem(at: record.url)
            total -= record.size
        }
    }
}
