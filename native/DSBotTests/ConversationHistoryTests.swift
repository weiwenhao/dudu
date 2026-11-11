import XCTest
import UIKit
@testable import dsbot

final class ConversationHistoryTests: XCTestCase {
    @MainActor
    func testBlankHistoryUsesItsMaterializedAnchorAndCanRecoverAfterTheRowsDisappear() {
        let history = UIScrollView(frame: CGRect(x: 0, y: 0, width: 400, height: 912))
        history.contentSize = CGSize(width: 400, height: 13_739.67)
        history.contentOffset.y = 12_827.67
        let content = UIView()
        let locator = UIView()
        let latest = UIView(frame: CGRect(x: 0, y: 7_286.67, width: 400, height: 128.33))
        history.addSubview(content)
        content.addSubview(locator)
        content.addSubview(latest)
        let metrics = ScrollMetrics()
        metrics.locator = locator
        metrics.register(latest, id: "latest")
        let built = metrics.followingTarget(latestID: "latest", firstID: "first")
        XCTAssertTrue(built.isRecovery)
        XCTAssertEqual(built.readerID, AnyHashable(RealizedHistoryAnchor(id: "latest")),
                       "Recovery must use the built background, not the lazy occurrence's estimated rectangle.")
        latest.removeFromSuperview()
        let empty = metrics.followingTarget(latestID: "latest", firstID: "first")
        XCTAssertTrue(empty.isRecovery)
        XCTAssertEqual(empty.readerID, AnyHashable("first"))
        XCTAssertEqual(empty.anchor, 0)
    }

    @MainActor
    func testScrollMetricsStayWithTheOwningHistoryWhenAnotherListHasTheSameBounds() {
        let page = UIView()
        let board = UIScrollView(frame: CGRect(x: 0, y: 0, width: 400, height: 900))
        let history = UIScrollView(frame: board.frame)
        let content = UIView()
        let locator = UIView()
        page.addSubview(board)
        page.addSubview(history)
        history.addSubview(content)
        content.addSubview(locator)
        board.contentSize = CGSize(width: 400, height: 824)
        history.contentSize = CGSize(width: 400, height: 39_559)
        let metrics = ScrollMetrics()
        metrics.locator = locator
        XCTAssertEqual(metrics.geometry["contentHeight"], 39_559)

        let replacement = UIScrollView(frame: history.frame)
        replacement.contentSize = CGSize(width: 400, height: 6_000)
        page.addSubview(replacement)
        replacement.addSubview(content)
        XCTAssertEqual(metrics.geometry["contentHeight"], 6_000, "A replaced native history must be located afresh.")
        locator.removeFromSuperview()
        XCTAssertTrue(metrics.geometry.isEmpty, "An unmounted history must never fall back to a matching sibling.")
    }

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
}
