import AVFoundation
import CryptoKit
import Foundation
import UIKit

struct PreparedVideo: Sendable, Equatable, Identifiable {
    let url: URL
    let thumbnail: PreparedPhotoImage?
    var id: URL { url }
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.url == rhs.url }
}

struct ConversationVideoKey: Hashable, Sendable {
    let target: DraftTarget
    let attachmentID: String
}

/// Bounded local media, scoped to a computer and session. File I/O and frame extraction
/// stay on this actor, never in a view body or a main-actor gesture callback.
actor VideoPreviewStorage {
    static let shared = VideoPreviewStorage()
    private var prepared: [ConversationVideoKey: PreparedVideo] = [:]
    private var order: [ConversationVideoKey] = []
    private var removedComputers: Set<String> = []
    static var downloadDirectory: URL { FileManager.default.temporaryDirectory.appendingPathComponent("VideoDownloads", isDirectory: true) }

    static func isVideo(name: String) -> Bool {
        ["mp4", "m4v", "mov"].contains((name as NSString).pathExtension.lowercased())
    }

    func load(_ key: ConversationVideoKey) async throws -> PreparedVideo? {
        guard !removedComputers.contains(key.target.computerID) else { return nil }
        if let value = prepared[key], FileManager.default.fileExists(atPath: value.url.path) { remember(value, for: key); return value }
        let directory = try directory(for: key)
        guard FileManager.default.fileExists(atPath: directory.path) else { return nil }
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey])
        guard files.count == 1, let file = files.first, Self.isVideo(name: file.lastPathComponent),
              let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              size > 0 else { throw DuduFailure.protocolError }
        let value = try await prepare(file)
        guard !removedComputers.contains(key.target.computerID) else { return nil }
        remember(value, for: key)
        return value
    }

    func store(_ source: URL, name: String, for key: ConversationVideoKey) async throws -> PreparedVideo {
        guard !removedComputers.contains(key.target.computerID), Self.isVideo(name: name),
              let bytes = try source.resourceValues(forKeys: [.fileSizeKey]).fileSize, bytes > 0 else { throw DuduFailure.protocolError }
        try Task.checkCancellation()
        var directory = try directory(for: key)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        let url = directory.appendingPathComponent((name as NSString).lastPathComponent)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        try FileManager.default.copyItem(at: source, to: url)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        do {
            let value = try await prepare(url)
            try Task.checkCancellation()
            guard !removedComputers.contains(key.target.computerID) else { throw DuduFailure.switchedComputer }
            remember(value, for: key)
            try prune(keeping: url)
            return value
        } catch {
            if prepared[key] == nil { try? FileManager.default.removeItem(at: directory) }
            throw error
        }
    }

    func removeDownload(_ url: URL) {
        guard url.deletingLastPathComponent().standardizedFileURL == Self.downloadDirectory.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: url)
    }

    func remove(for computerID: String) throws {
        removedComputers.insert(computerID)
        prepared = prepared.filter { $0.key.target.computerID != computerID }
        order.removeAll { $0.target.computerID == computerID }
        let directory = try root().appendingPathComponent(digest(computerID), isDirectory: true)
        if FileManager.default.fileExists(atPath: directory.path) { try FileManager.default.removeItem(at: directory) }
    }

    private func prepare(_ url: URL) async throws -> PreparedVideo {
        let asset = AVURLAsset(url: url)
        let generator = AVAssetImageGenerator(asset: asset)
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 800, height: 800)
        let image = try? await generator.image(at: .zero).image
        try Task.checkCancellation()
        return PreparedVideo(url: url, thumbnail: image.map { PreparedPhotoImage(image: UIImage(cgImage: $0)) })
    }

    private func remember(_ value: PreparedVideo, for key: ConversationVideoKey) {
        prepared[key] = value
        order.removeAll { $0 == key }
        order.append(key)
        while order.count > 8 { prepared.removeValue(forKey: order.removeFirst()) }
    }

    private func root() throws -> URL {
        try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("ConversationVideos", isDirectory: true)
    }

    private func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func directory(for key: ConversationVideoKey) throws -> URL {
        try root().appendingPathComponent(digest(key.target.computerID), isDirectory: true)
            .appendingPathComponent(digest(key.target.sessionID + "\0" + key.attachmentID), isDirectory: true)
    }

    private func prune(keeping current: URL) throws {
        let root = try root()
        let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey])
        var records: [(url: URL, size: Int, date: Date)] = []
        while let file = files?.nextObject() as? URL {
            let values = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey])
            if values.isRegularFile == true { records.append((file, values.fileSize ?? 0, values.contentModificationDate ?? .distantPast)) }
        }
        records.sort { $0.url == current ? $1.url != current : $1.url == current ? false : $0.date > $1.date }
        var total = 0
        for record in records {
            total += record.size
            if total > 128 * 1024 * 1024, record.url != current {
                try FileManager.default.removeItem(at: record.url.deletingLastPathComponent())
                let expired = prepared.filter { $0.value.url == record.url }.map(\.key)
                for key in expired { prepared[key] = nil; order.removeAll { $0 == key } }
            }
        }
    }
}
