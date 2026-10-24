import XCTest
@testable import dsbot

final class ConversationStorageTests: XCTestCase {
    func testMissingCacheIsTheOnlySuccessfulEmptyLoad() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = FileConversationStorage(directory: directory)
        let absent = try await cache.load(for: "missing")
        XCTAssertNil(absent)
        var snapshot = snapshot(for: "computer")
        try await cache.save(snapshot)
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let file = try XCTUnwrap(files.first)
        try Data("broken JSON".utf8).write(to: file)
        await assertLoadFailure(cache, computerID: "computer", failure: .invalidData)
        snapshot.version = 2
        try JSONEncoder().encode(snapshot).write(to: file)
        await assertLoadFailure(cache, computerID: "computer", failure: .unsupportedVersion)
        snapshot.version = 1
        snapshot.computerID = "another-computer"
        try JSONEncoder().encode(snapshot).write(to: file)
        await assertLoadFailure(cache, computerID: "computer", failure: .identityMismatch)
        try Data(repeating: 0, count: 33 * 1_024 * 1_024).write(to: file)
        await assertLoadFailure(cache, computerID: "computer", failure: .limitExceeded)
    }

    func testCacheHasSizeLimitsAndKeepsMostRecentlyWrittenComputer() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let size = try JSONEncoder().encode(snapshot(for: "first")).count
        let cache = FileConversationStorage(directory: directory, maximumBytes: size * 2, totalMaximumBytes: size * 2 - 1)
        try await cache.save(snapshot(for: "first"))
        try await cache.save(snapshot(for: "second"))
        let first = try await cache.load(for: "first")
        let second = try await cache.load(for: "second")
        XCTAssertNil(first)
        XCTAssertEqual(second?.computerID, "second")
        var oversized = snapshot(for: "large")
        oversized.drafts = ["session": String(repeating: "x", count: size * 3)]
        do {
            try await cache.save(oversized)
            XCTFail("An oversized write must report failure.")
        } catch {
            XCTAssertEqual(error as? ConversationStorageError, .limitExceeded)
        }
        let large = try await cache.load(for: "large")
        XCTAssertNil(large)
    }

    private func assertLoadFailure(
        _ cache: FileConversationStorage, computerID: String, failure: ConversationStorageError
    ) async {
        do {
            _ = try await cache.load(for: computerID)
            XCTFail("Invalid cache data must report failure.")
        } catch {
            XCTAssertEqual(error as? ConversationStorageError, failure)
        }
    }

    private func snapshot(for computerID: String) -> ConversationSnapshot {
        ConversationSnapshot(
            computerID: computerID, sessions: [], workspaces: [], detail: nil,
            isChoosingWorkspace: true, drafts: ["session": "unsent draft"]
        )
    }
}
