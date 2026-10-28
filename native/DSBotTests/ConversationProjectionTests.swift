import XCTest
@testable import dsbot

final class ConversationProjectionTests: XCTestCase {
    func testLiveUpdatesPreserveHistoricalRowsAndFinishAsTheSameTurn() async throws {
        let projector = ConversationProjector()
        var transcript = Transcript(entries: [
            TranscriptEntry(type: "user", id: "question", seq: 1, time: 1_000, text: "question"),
            TranscriptEntry(type: "assistant", id: "answer", seq: 2, time: 2_000, text: "answer", turn: 1, step: 1),
            TranscriptEntry(type: "user", id: "follow-up", seq: 3, time: 400_000, text: "follow up"),
            TranscriptEntry(type: "assistant", id: "step", seq: 4, time: 401_000,
                            reasoning: "working", turn: 2, step: 1)
        ], turns: [
            TranscriptTurn(turn: 1, start: 1_100, end: 2_000, outcome: "done"),
            TranscriptTurn(turn: 2, start: 400_100)
        ], live: TranscriptLive(id: "live:2", text: "hello"))
        let initial = await projector.project(current: nil, incoming: transcript, currentRows: [], isRunning: true)
        XCTAssertNotNil(initial.markdown.content(for: "answer"))
        let history = Array(initial.rows.dropLast())
        var current = initial
        for count in 1...40 {
            transcript.live?.text = "hello " + String(repeating: "world ", count: count)
            current = await projector.project(
                current: current.transcript, incoming: transcript, currentRows: current.rows, isRunning: true
            )
            XCTAssertTrue(current.rowsChanged)
            XCTAssertEqual(Array(current.rows.dropLast()), history)
            XCTAssertEqual(current.timeSeparators, initial.timeSeparators)
            XCTAssertEqual(current.rows, TranscriptBuilder.rows(from: transcript, isRunning: true))
            XCTAssertTrue(current.markdown === initial.markdown)
        }
        let unchanged = await projector.project(
            current: current.transcript, incoming: transcript, currentRows: current.rows, isRunning: true
        )
        XCTAssertFalse(unchanged.transcriptChanged)
        XCTAssertFalse(unchanged.rowsChanged)
        let finalText = try XCTUnwrap(transcript.live?.text)
        transcript.entries.append(TranscriptEntry(
            type: "assistant", id: "final", seq: 5, time: 402_000, text: finalText, turn: 2, step: 2
        ))
        transcript.live = nil
        transcript.turns[1].end = 402_000
        transcript.turns[1].outcome = "done"
        let completed = await projector.project(
            current: current.transcript, incoming: transcript, currentRows: current.rows, isRunning: false
        )
        XCTAssertEqual(completed.rows.map(\.id), initial.rows.map(\.id))
        XCTAssertEqual(completed.rows, TranscriptBuilder.rows(from: transcript, isRunning: false))
        XCTAssertNotNil(completed.markdown.content(for: finalText))
    }

    func testEarlierPageSurvivesTailUpdatesAndResetDropsTheOldConversation() async {
        let projector = ConversationProjector()
        let earlier = Transcript(entries: [
            TranscriptEntry(type: "user", id: "earlier", seq: 1, text: "earlier")
        ], turns: [], beforeSeq: 1, throughSeq: 10, hasMore: false)
        var tail = Transcript(entries: [
            TranscriptEntry(type: "user", id: "recent", seq: 10, text: "recent")
        ], turns: [], beforeSeq: 10, throughSeq: 10, hasMore: true)
        let initial = await projector.project(current: nil, incoming: tail, currentRows: [], isRunning: false)
        let paged = await projector.project(
            current: initial.transcript, incoming: earlier, currentRows: initial.rows, isRunning: false, prepending: true
        )
        tail.entries.append(TranscriptEntry(type: "assistant", id: "next", seq: 11, text: "next", turn: 1, step: 1))
        let updated = await projector.project(
            current: paged.transcript, incoming: tail, currentRows: paged.rows, isRunning: false
        )
        XCTAssertEqual(updated.rows.map(\.id), ["user:earlier", "user:recent", "turn:turn-1"])
        XCTAssertEqual(updated.transcript?.beforeSeq, 1)
        XCTAssertEqual(updated.transcript?.hasMore, false)
        let cleared = await projector.project(current: updated.transcript, incoming: nil, currentRows: updated.rows, isRunning: false)
        XCTAssertNil(cleared.transcript)
        XCTAssertTrue(cleared.rows.isEmpty)
        XCTAssertTrue(cleared.timeSeparators.isEmpty)
        XCTAssertTrue(cleared.markdown.texts.isEmpty)
    }

    func testLegacyMessagesAndExpandedDetailsArePreparedBeforeDisplay() async {
        let projector = ConversationProjector()
        let projection = await projector.project(
            current: nil, incoming: nil, currentRows: [], isRunning: false,
            messages: [ChatMessage(id: "legacy", role: "assistant", text: "## Legacy\n\n**Ready**",
                                   reasoning: "Reasoning", process: "Process")],
            additionalMarkdown: ["Question details", "Plan details"]
        )
        for text in ["## Legacy\n\n**Ready**", "Process", "Reasoning", "Question details", "Plan details"] {
            XCTAssertNotNil(projection.markdown.content(for: text))
        }
    }
}
