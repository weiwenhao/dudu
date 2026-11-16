import XCTest
@testable import dsbot

final class BoardStorageTests: XCTestCase {
    func testHomepageSurvivesRecreationAndRemovedComputersRejectLateWrites() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = FileBoardStorage(directory: directory)
        let snapshot = BoardSnapshot(computerID: "first", conversationsByTab: ["active": [], "all": []], pins: [], unreadCount: 2)
        try await cache.save(snapshot)
        let reopened = FileBoardStorage(directory: directory)
        let loaded = try await reopened.load(for: "first")
        let other = try await reopened.load(for: "other")
        XCTAssertEqual(loaded, snapshot, "An empty but loaded tab is also cached.")
        XCTAssertNil(other)
        try await cache.remove(for: "first")
        try await cache.save(snapshot)
        let removed = try await reopened.load(for: "first")
        XCTAssertNil(removed, "Removing a computer must fence a save already queued by its homepage.")
    }

    func testHomepageRejectsCorruptWrongComputerAndOversizedCaches() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = FileBoardStorage(directory: directory, maximumBytes: 512)
        let snapshot = BoardSnapshot(computerID: "first", conversationsByTab: ["active": []], pins: [], unreadCount: 0)
        try await cache.save(snapshot)
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
        let url = try XCTUnwrap(files.first)
        for (data, failure) in [
            (Data("broken".utf8), ConversationStorageError.invalidData),
            (try JSONEncoder().encode(BoardSnapshot(computerID: "other", conversationsByTab: [:], pins: [], unreadCount: 0)), .identityMismatch),
            (Data(repeating: 0, count: 513), .limitExceeded),
        ] {
            try data.write(to: url)
            do { _ = try await cache.load(for: "first"); XCTFail("Invalid caches must not be displayed.") }
            catch { XCTAssertEqual(error as? ConversationStorageError, failure) }
        }
    }
}
