import XCTest
import UIKit
@testable import Dudu

final class ConversationHistoryTests: XCTestCase {
    func testRunningIndicatorFollowsSteeredAndPendingMessagesWithoutResettingItsClock() throws {
        var transcript = Transcript(entries: [
            TranscriptEntry(type: "user", id: "request", seq: 1, text: "Work"),
            TranscriptEntry(type: "assistant", id: "progress", seq: 2, reasoning: "Working", turn: 1, step: 1)
        ], turns: [TranscriptTurn(turn: 1, start: 1_000)], live: nil)
        let initial = ConversationHistoryItem.transcriptItems(TranscriptBuilder.rows(from: transcript, isRunning: true))
        transcript.entries.append(TranscriptEntry(type: "user", id: "steered", seq: 3, text: "Also do this"))
        transcript.pendingInputs = [QueuedMessage(id: "pending", text: "One more thing", editable: true)]
        let rows = TranscriptBuilder.rows(from: transcript, isRunning: true)
        let items = ConversationHistoryItem.transcriptItems(rows)
        XCTAssertEqual(items.map(\.id), [
            "transcript:user:request", "transcript:turn:turn-1",
            "transcript:user:steered", "transcript:user:pending", "running:turn-1"
        ])
        XCTAssertEqual(items.last, initial.last, "Follow-ups must keep the original running turn and start time.")
        XCTAssertEqual(items.last, .running(turnID: "turn-1", startedAt: 1_000))
    }

    func testRunningIndicatorWithoutTurnTimingAlsoFollowsPendingInput() {
        let transcript = Transcript(
            entries: [TranscriptEntry(type: "user", id: "request", seq: 1, text: "Work")],
            turns: [], live: nil,
            pendingInputs: [QueuedMessage(id: "pending", text: "Follow up", editable: true)]
        )
        let items = ConversationHistoryItem.transcriptItems(
            TranscriptBuilder.rows(from: transcript, isRunning: true)
        )
        XCTAssertEqual(items.map(\.id), ["transcript:user:request", "transcript:user:pending", "running:status"])
        XCTAssertEqual(items.last, .running(turnID: "status", startedAt: nil))
    }

    func testStoppedTurnRemovesOnlyTheRunningIndicator() {
        var transcript = Transcript(entries: [
            TranscriptEntry(type: "assistant", id: "progress", seq: 1, text: "Progress", turn: 1, step: 1),
            TranscriptEntry(type: "user", id: "follow-up", seq: 2, text: "Continue")
        ], turns: [TranscriptTurn(turn: 1, start: 1_000)], live: nil)
        let running = ConversationHistoryItem.transcriptItems(TranscriptBuilder.rows(from: transcript, isRunning: true))
        transcript.turns[0].end = 2_000
        transcript.turns[0].outcome = "stopped"
        let stopped = ConversationHistoryItem.transcriptItems(TranscriptBuilder.rows(from: transcript, isRunning: false))
        XCTAssertEqual(stopped.map(\.id), Array(running.dropLast()).map(\.id))
        XCTAssertEqual(stopped.last?.id, "transcript:user:follow-up")
    }

    func testQuestionsRemainVisibleInMessageModeAfterTranscriptOptOut() {
        let question = ConversationQuestions(
            id: "question-call", sessionId: "session", state: "open",
            questions: [ConversationQuestion(id: "choice", question: "Continue?", multiSelect: false, options: [])]
        )
        let items = ConversationHistoryItem.messageHistoryItems(messages: [], transcriptRows: [], questions: [question])

        XCTAssertEqual(items, [.questions(question)])
    }
}
