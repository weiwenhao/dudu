import Foundation
import ImageIO
import PhotosUI
import SwiftUI
import UIKit

struct PreparedPhotoAttachment: Identifiable, Sendable {
    let attachment: UploadAttachment
    let compressedBytes: Int
    let thumbnailData: Data?
    let thumbnailImage: PreparedPhotoImage?

    init(
        attachment: UploadAttachment,
        compressedBytes: Int,
        thumbnailData: Data? = nil,
        thumbnailImage: PreparedPhotoImage? = nil
    ) {
        self.attachment = attachment
        self.compressedBytes = compressedBytes
        self.thumbnailData = thumbnailData
        self.thumbnailImage = thumbnailImage
    }

    var id: String { attachment.id }
}

// UIImage is immutable here and prepared before the value reaches SwiftUI.
struct PreparedPhotoImage: @unchecked Sendable {
    let image: UIImage
}

private struct ProcessedPhoto: Sendable {
    let jpegData: Data
    let thumbnailData: Data?
    let thumbnailImage: PreparedPhotoImage?
}

private struct ProcessedThumbnail: Sendable {
    let data: Data
    let image: PreparedPhotoImage
}

struct PhotoAttachmentLoad: Sendable {
    let photos: [PreparedPhotoAttachment]
    let rejectedCount: Int
    let totalBytes: Int
}

enum PhotoAttachments {
    static let maximumPhotoBytes = 10 * 1_024 * 1_024
    static let maximumTotalBytes = 20 * 1_024 * 1_024
    static let maximumPhotoCount = 3

    static func loadFullSizePreview(fromBase64 base64: String) async -> PreparedPhotoImage? {
        let decodeTask = Task.detached(priority: .utility) { () -> PreparedPhotoImage? in
            guard !Task.isCancelled else { return nil }
            guard
                let data = Data(base64Encoded: base64),
                !Task.isCancelled,
                let source = CGImageSourceCreateWithData(data as CFData, nil),
                !Task.isCancelled
            else {
                return nil
            }

            guard !Task.isCancelled else { return nil }
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 2_048,
                kCGImageSourceShouldCacheImmediately: true,
            ]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                return nil
            }
            guard !Task.isCancelled else { return nil }
            return PreparedPhotoImage(image: UIImage(cgImage: image))
        }

        return await withTaskCancellationHandler {
            await decodeTask.value
        } onCancel: {
            decodeTask.cancel()
        }
    }

    @MainActor
    static func load(
        _ items: [PhotosPickerItem],
        existingCount: Int = 0,
        existingBytes: Int = 0
    ) async -> PhotoAttachmentLoad {
        var photos: [PreparedPhotoAttachment] = []
        var totalBytes = max(0, existingBytes)
        let availableCount = max(0, maximumPhotoCount - existingCount)
        var rejectedCount = max(0, items.count - availableCount)

        for item in items.prefix(availableCount) {
            guard let sourceData = try? await item.loadTransferable(type: Data.self) else {
                rejectedCount += 1
                continue
            }

            let processed = await Task.detached(priority: .utility) {
                processImage(from: sourceData)
            }.value

            guard let processed, processed.jpegData.count <= maximumPhotoBytes else {
                rejectedCount += 1
                continue
            }
            guard totalBytes + processed.jpegData.count <= maximumTotalBytes else {
                rejectedCount += 1
                continue
            }

            let base64 = await Task.detached(priority: .utility) {
                processed.jpegData.base64EncodedString()
            }.value
            totalBytes += processed.jpegData.count

            let upload = UploadAttachment(
                id: UUID().uuidString,
                name: "photo-\(UUID().uuidString.prefix(8)).jpg",
                mimeType: "image/jpeg",
                dataBase64: base64
            )
            photos.append(
                PreparedPhotoAttachment(
                    attachment: upload,
                    compressedBytes: processed.jpegData.count,
                    thumbnailData: processed.thumbnailData,
                    thumbnailImage: processed.thumbnailImage
                )
            )
        }

        return PhotoAttachmentLoad(photos: photos, rejectedCount: rejectedCount, totalBytes: totalBytes)
    }

    @MainActor
    static func load(
        _ data: Data,
        name: String,
        existingCount: Int = 0,
        existingBytes: Int = 0
    ) async -> PhotoAttachmentLoad {
        let totalBytes = max(0, existingBytes)
        guard existingCount < maximumPhotoCount else {
            return PhotoAttachmentLoad(photos: [], rejectedCount: 1, totalBytes: totalBytes)
        }

        let processed = await Task.detached(priority: .utility) {
            processImage(from: data)
        }.value
        guard let processed,
              processed.jpegData.count <= maximumPhotoBytes,
              totalBytes + processed.jpegData.count <= maximumTotalBytes else {
            return PhotoAttachmentLoad(photos: [], rejectedCount: 1, totalBytes: totalBytes)
        }

        let base64 = await Task.detached(priority: .utility) {
            processed.jpegData.base64EncodedString()
        }.value
        let identifier = UUID().uuidString
        let sourceName = URL(fileURLWithPath: name).deletingPathExtension().lastPathComponent
        let safeStem = String(sourceName
            .replacingOccurrences(of: #"[^A-Za-z0-9_-]"#, with: "_", options: .regularExpression)
            .prefix(48))
        let upload = UploadAttachment(
            id: identifier,
            name: "\(safeStem.isEmpty ? "photo" : safeStem)-\(identifier.prefix(8)).jpg",
            mimeType: "image/jpeg",
            dataBase64: base64
        )
        let photo = PreparedPhotoAttachment(
            attachment: upload,
            compressedBytes: processed.jpegData.count,
            thumbnailData: processed.thumbnailData,
            thumbnailImage: processed.thumbnailImage
        )
        return PhotoAttachmentLoad(
            photos: [photo],
            rejectedCount: 0,
            totalBytes: totalBytes + processed.jpegData.count
        )
    }

    private static func processImage(from data: Data) -> ProcessedPhoto? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }

        var maximumPixelSize = 2_048
        for _ in 0..<5 {
            let options: [CFString: Any] = [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
            ]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
                return nil
            }

            let thumbnail = UIImage(cgImage: image)
            for quality in [0.82, 0.70, 0.58, 0.44, 0.30] {
                guard let candidate = thumbnail.jpegData(compressionQuality: quality) else { continue }
                if candidate.count <= maximumPhotoBytes {
                    let preview = makePreviewThumbnail(from: source)
                    return ProcessedPhoto(
                        jpegData: candidate,
                        thumbnailData: preview?.data,
                        thumbnailImage: preview?.image
                    )
                }
            }
            maximumPixelSize = max(640, Int(Double(maximumPixelSize) * 0.72))
        }

        return nil
    }

    private static func makePreviewThumbnail(from source: CGImageSource) -> ProcessedThumbnail? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 260,
            kCGImageSourceShouldCacheImmediately: true,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
            return nil
        }
        let thumbnail = UIImage(cgImage: image)
        guard let data = thumbnail.jpegData(compressionQuality: 0.65) else { return nil }
        return ProcessedThumbnail(
            data: data,
            image: PreparedPhotoImage(image: thumbnail)
        )
    }
}
