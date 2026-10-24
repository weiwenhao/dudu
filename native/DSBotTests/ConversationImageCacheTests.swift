import CoreGraphics
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import dsbot

final class ConversationImageCacheTests: XCTestCase {
    func testDiskImagesAreScopedAndDownsampledForThumbnailAndPreview() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let key = imageKey(computer: "first")
        let cache = ConversationImageCache(directory: directory)
        let payload = try await picture()
        let thumbnail = try await cache.store(payload, for: key, fullSize: false)
        XCTAssertEqual(thumbnail?.image.size.height, 800)

        let restored = ConversationImageCache(directory: directory)
        let preview = try await restored.load(key, fullSize: true)
        XCTAssertEqual(preview?.image.size.height, 1_800)
        let other = try await restored.load(imageKey(computer: "second"), fullSize: true)
        XCTAssertNil(other)
        await restored.remove(for: "first")
        let removed = try await restored.load(key, fullSize: true)
        let lateWrite = try await restored.store(payload, for: key, fullSize: false)
        let anotherLaunch = ConversationImageCache(directory: directory)
        let removedOnDisk = try await anotherLaunch.load(key, fullSize: true)
        XCTAssertNil(removed)
        XCTAssertNil(lateWrite)
        XCTAssertNil(removedOnDisk)
    }

    func testInvalidImagePayloadsNeverCreateCacheFiles() async {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = ConversationImageCache(directory: directory)
        for payload in [
            ConversationImagePayload(mediaType: "image/svg+xml", data: "AAAA"),
            ConversationImagePayload(mediaType: "image/png", data: "not!base64"),
            ConversationImagePayload(mediaType: "image/png", data: Data("invalid image".utf8).base64EncodedString()),
            ConversationImagePayload(mediaType: "image/png", data: String(repeating: "A", count: 14 * 1_024 * 1_024))
        ] {
            do {
                _ = try await cache.store(payload, for: imageKey(computer: "first"), fullSize: false)
                XCTFail("Invalid image replies must report a protocol failure.")
            } catch {
                XCTAssertEqual(error as? DSBotFailure, .protocolError)
            }
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }

    func testCorruptDiskImageReportsFailureAndCanBeFetchedAgain() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let key = imageKey(computer: "first")
        let cache = ConversationImageCache(directory: directory)
        let payload = try await picture()
        _ = try await cache.store(payload, for: key, fullSize: false)
        let computerDirectory = try XCTUnwrap(
            FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first
        )
        let file = try XCTUnwrap(
            FileManager.default.contentsOfDirectory(at: computerDirectory, includingPropertiesForKeys: nil).first
        )
        try Data("corrupt".utf8).write(to: file)
        let restored = ConversationImageCache(directory: directory)
        do {
            _ = try await restored.load(key, fullSize: false)
            XCTFail("A corrupt disk image must be reported.")
        } catch {
            XCTAssertEqual(error as? ConversationStorageError, .invalidData)
        }
        let missing = try await restored.load(key, fullSize: false)
        XCTAssertNil(missing)
        let refreshed = try await restored.store(payload, for: key, fullSize: false)
        XCTAssertNotNil(refreshed)
    }

    private func imageKey(computer: String) -> ConversationImageKey {
        ConversationImageKey(target: DraftTarget(computerID: computer, sessionID: "session"), attachmentID: "photo:1")
    }

    private func picture() async throws -> ConversationImagePayload {
        try await Task.detached {
            let context = try XCTUnwrap(CGContext(
                data: nil, width: 1_200, height: 1_800, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ))
            context.setFillColor(CGColor(gray: 1, alpha: 1))
            context.fill(CGRect(x: 0, y: 0, width: 1_200, height: 1_800))
            let image = try XCTUnwrap(context.makeImage())
            let data = NSMutableData()
            let destination = try XCTUnwrap(CGImageDestinationCreateWithData(data, UTType.png.identifier as CFString, 1, nil))
            CGImageDestinationAddImage(destination, image, nil)
            XCTAssertTrue(CGImageDestinationFinalize(destination))
            return ConversationImagePayload(mediaType: "image/png", data: (data as Data).base64EncodedString())
        }.value
    }
}
