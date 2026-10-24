import XCTest
@testable import dsbot

final class ConversationFeaturesTests: XCTestCase {
    func testMalformedTaskPayloadsAreProtocolFailures() async throws {
        let json = DSBotJSON()
        let value: JSONValue = .object([
            "session": .object([
                "id": .string("session"), "title": .string("Title"), "status": .string("idle"), "updatedAt": .number(0)
            ]),
            "todos": .string("invalid")
        ])
        do {
            _ = try await json.decode(SessionDetail.self, from: value)
            XCTFail("Malformed tasks must not disappear from a successful snapshot.")
        } catch {
            XCTAssertEqual(error as? DSBotFailure, .protocolError)
        }
    }

    func testIdenticalSnapshotsKeepUnavailableMetadataAbsent() {
        let snapshot = Transcript(
            entries: [TranscriptEntry(type: "assistant", id: "answer", text: "answer", turn: 1)],
            turns: [TranscriptTurn(turn: 1, outcome: "done")], live: nil
        )
        XCTAssertEqual(snapshot.merging(snapshot), snapshot)
        var emptyReferences = snapshot
        emptyReferences.tools = [:]
        XCTAssertEqual(emptyReferences.merging(emptyReferences), emptyReferences)
    }

    func testPrependingHistoryResolvesToolReferencesAcrossPagesAndRetainsLiveTail() {
        let older = Transcript(entries: [
            TranscriptEntry(type: "user", id: "user", seq: 1, text: "old"),
            TranscriptEntry(type: "assistant", id: "process", seq: 4, turn: 1, step: 1, calls: [
                TranscriptCall(id: "tool", name: "read", activity: "read", detail: "file", status: "running")
            ])
        ], turns: [TranscriptTurn(turn: 1, start: 100)], live: nil, beforeSeq: 1, throughSeq: 10, hasMore: false)
        let tail = Transcript(
            entries: [TranscriptEntry(type: "assistant", id: "answer", seq: 8, text: "answer", turn: 1, step: 2)],
            turns: [TranscriptTurn(turn: 1, end: 1000, outcome: "done", lastSeq: 10)],
            live: TranscriptLive(id: "live", text: "current"), beforeSeq: 5, throughSeq: 10, hasMore: true,
            tools: ["tool": TranscriptToolReference(seq: 5, resultSeq: 6, status: "done")]
        )
        let merged = older.merging(tail)
        XCTAssertEqual(merged.entries.map(\.id), ["user", "process", "answer"])
        XCTAssertEqual(merged.entries[1].calls?.first?.seq, 5)
        XCTAssertEqual(merged.entries[1].calls?.first?.resultSeq, 6)
        XCTAssertEqual(merged.entries[1].calls?.first?.status, "done")
        XCTAssertEqual(merged.turns.first?.start, 100)
        XCTAssertEqual(merged.turns.first?.end, 1000)
        XCTAssertEqual(merged.live?.text, "current")
        XCTAssertEqual(merged.beforeSeq, 1)
        XCTAssertEqual(merged.hasMore, false)
        XCTAssertEqual(merged.merging(tail), merged)
    }

    func testTurnNoticesAndArtifactOnlyFailuresCreateAVisibleRow() throws {
        let notice = TurnNotice(id: "error", kind: "error", seq: 5, message: "upstream 502", code: "HTTP_502")
        let transcript = Transcript(
            entries: [TranscriptEntry(type: "turn-marker", id: "failed-turn", seq: 5, turn: 1)],
            turns: [TranscriptTurn(turn: 1, start: 10, end: 20, outcome: "failed", lastSeq: 5, notices: [notice])],
            live: nil
        )
        let rows = TranscriptBuilder.rows(from: transcript, isRunning: false)
        guard case let .turn(row) = try XCTUnwrap(rows.first) else { return XCTFail("Missing failure turn") }
        XCTAssertEqual(row.notices, [notice])
        XCTAssertEqual(row.performanceSeq, 5)
    }

    func testDiffNumbersAdvanceOnlyOnTheirOwnSide() {
        let hunk = ConversationDiff.Hunk(oldStart: 10, oldLines: 2, newStart: 20, newLines: 2,
                                        lines: [" context", "-old", "+new", "\\ No newline at end of file"])
        let lines = hunk.numberedLines
        XCTAssertEqual(lines.map(\.old), [10, 11, nil, nil])
        XCTAssertEqual(lines.map(\.new), [20, nil, 21, nil])
    }

    func testPerformanceShowsRatesAndUnknownValuesRemainAbsent() {
        let value = ConversationPerformance(
            stats: ["ttftMs": 500, "ttftSteps": 2, "decodeMs": 2000, "decodeTokens": 100],
            usage: ["uncachedInputTokens": 50, "cacheReadTokens": 150, "cacheWriteTokens": 0, "outputTokens": 10]
        )
        XCTAssertEqual(value.metrics.first { $0.label.contains("TTFT") }?.value, "0.25 秒")
        XCTAssertEqual(value.metrics.first { $0.label.contains("TPS") }?.value, "50.0 tok/s")
        XCTAssertEqual(value.tokenMetrics.first?.value, "75.0%")
        XCTAssertFalse(value.tokenMetrics.contains { $0.label == "推理" })
        XCTAssertTrue(ConversationPerformance(stats: [:], usage: [:]).tokenMetrics.isEmpty)
    }

    func testPreviewStorageUsesPrivateTemporaryDirectoryAndCleansIt() async throws {
        let payload = ConversationFilePayload(name: "../../report.txt", mediaType: "text/plain", dataBase64: Data("report".utf8).base64EncodedString())
        let url = try await ConversationFileStorage.shared.write(payload)
        XCTAssertEqual(url.lastPathComponent, "report.txt")
        XCTAssertEqual(try String(contentsOf: url, encoding: .utf8), "report")
        XCTAssertEqual(url.deletingLastPathComponent().deletingLastPathComponent().lastPathComponent, "conversation-previews")
        await ConversationFileStorage.shared.remove(url)
        XCTAssertFalse(FileManager.default.fileExists(atPath: url.path))
    }
}
