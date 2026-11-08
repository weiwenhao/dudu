import CryptoKit
import Foundation
import ImageIO
import UIKit

struct ConversationImagePayload: Decodable, Sendable {
    let mediaType: String
    let data: String
}

struct ConversationImageKey: Hashable, Sendable {
    let target: DraftTarget
    let attachmentID: String

    init(target: DraftTarget, attachmentID: String) {
        self.target = target
        self.attachmentID = attachmentID
    }

    init?(target: DraftTarget, attachment: TranscriptAttachment) {
        guard let id = attachment.id else { return nil }
        self.init(
            target: target,
            attachmentID: attachment.kind == "markdown" ? "markdown:\(attachment.seq ?? -1):\(id)" : id
        )
    }
}

actor ConversationImageCache {
    private let directory: URL?
    private var thumbnails: [ConversationImageKey: PreparedPhotoImage] = [:]
    private var order: [ConversationImageKey] = []
    private var removedComputers: Set<String> = []
    private let maximumBytes = 10 * 1_024 * 1_024

    init(directory: URL? = nil) {
        self.directory = directory
    }

    func load(_ key: ConversationImageKey, fullSize: Bool) throws -> PreparedPhotoImage? {
        guard !removedComputers.contains(key.target.computerID) else { return nil }
        if !fullSize, let image = thumbnails[key] { return image }
        let url = try fileURL(for: key)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        guard let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= maximumBytes else {
            try FileManager.default.removeItem(at: url)
            throw ConversationStorageError.limitExceeded
        }
        let data = try Data(contentsOf: url)
        guard let image = prepare(data, fullSize: fullSize) else {
            try FileManager.default.removeItem(at: url)
            throw ConversationStorageError.invalidData
        }
        if !fullSize { remember(image, for: key) }
        return image
    }

    func store(_ payload: ConversationImagePayload, for key: ConversationImageKey, fullSize: Bool) throws -> PreparedPhotoImage? {
        guard !removedComputers.contains(key.target.computerID) else { return nil }
        guard ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(payload.mediaType),
              payload.data.utf8.count <= (maximumBytes + 2) / 3 * 4,
              let data = Data(base64Encoded: payload.data), data.count <= maximumBytes,
              let image = prepare(data, fullSize: fullSize) else { throw DSBotFailure.protocolError }
        do {
            let url = try fileURL(for: key)
            var directory = url.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try directory.setResourceValues(values)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            try prune(in: directory)
        } catch {
            DSBotLog.networkFailure("conversation.image.cache.fail", error: error)
        }
        if !fullSize { remember(image, for: key) }
        return image
    }

    func prepareSubmission(_ attachment: UploadAttachment, fullSize: Bool) -> PreparedPhotoImage? {
        guard ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(attachment.mimeType),
              attachment.dataBase64.utf8.count <= (maximumBytes + 2) / 3 * 4,
              let data = Data(base64Encoded: attachment.dataBase64), data.count <= maximumBytes else { return nil }
        return prepare(data, fullSize: fullSize)
    }

    func remove(for computerID: String) {
        removedComputers.insert(computerID)
        thumbnails = thumbnails.filter { $0.key.target.computerID != computerID }
        order.removeAll { $0.target.computerID == computerID }
        let key = ConversationImageKey(target: DraftTarget(computerID: computerID, sessionID: ""), attachmentID: "")
        do {
            let directory = try fileURL(for: key).deletingLastPathComponent()
            if FileManager.default.fileExists(atPath: directory.path) {
                try FileManager.default.removeItem(at: directory)
            }
        } catch {
            DSBotLog.networkFailure("conversation.image.remove.fail", error: error)
        }
    }

    private func remember(_ image: PreparedPhotoImage, for key: ConversationImageKey) {
        order.removeAll { $0 == key }
        order.append(key)
        thumbnails[key] = image
        while order.count > 8 { thumbnails.removeValue(forKey: order.removeFirst()) }
    }

    private func prepare(_ data: Data, fullSize: Bool) -> PreparedPhotoImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: fullSize ? 2_048 : 800,
                kCGImageSourceShouldCacheImmediately: true,
              ] as CFDictionary) else { return nil }
        return PreparedPhotoImage(image: UIImage(cgImage: image))
    }

    private func fileURL(for key: ConversationImageKey) throws -> URL {
        func digest(_ value: String) -> String {
            SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
        }
        let root: URL
        if let directory {
            root = directory
        } else {
            root = try FileManager.default.url(
                for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false
            ).appendingPathComponent("ConversationImages", isDirectory: true)
        }
        return root
            .appendingPathComponent(digest(key.target.computerID), isDirectory: true)
            .appendingPathComponent(digest(key.target.sessionID + "\u{0}" + key.attachmentID) + ".image")
    }

    private func prune(in directory: URL) throws {
        let files = try FileManager.default.contentsOfDirectory(
            at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]
        ).filter { $0.pathExtension == "image" }
        let records = try files.map { url in
            let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            return (url: url, size: values.fileSize ?? 0, date: values.contentModificationDate ?? .distantPast)
        }.sorted { $0.date > $1.date }
        var total = 0
        for record in records {
            total += record.size
            if total > 64 * 1_024 * 1_024 { try FileManager.default.removeItem(at: record.url) }
        }
    }
}
