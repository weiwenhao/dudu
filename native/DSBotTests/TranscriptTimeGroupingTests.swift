import XCTest
@testable import dsbot

final class TranscriptTimeGroupingTests: XCTestCase {
    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        return calendar
    }

    private var base: Double {
        calendar.date(from: DateComponents(year: 2026, month: 10, day: 20, hour: 18, minute: 38))!
            .timeIntervalSince1970 * 1_000
    }

    private func user(_ id: String, _ time: Double?) -> TranscriptRow {
        .user(UserRow(id: id, text: "继续", attachments: [], time: time))
    }

    private func turn(_ id: String, start: Double?, end: Double?, answerTime: Double? = nil) -> TranscriptRow {
        .turn(TurnRow(
            id: id, turn: nil, outcome: end == nil ? .running : .done, segments: [],
            answerID: id, answer: end == nil ? nil : "回复", answerTime: answerTime ?? end,
            duration: start.flatMap { start in end.map { $0 - start } }, startedAt: start, usage: nil, live: nil
        ))
    }

    private func separators(_ rows: [TranscriptRow]) -> [String: Double] {
        TranscriptTimeGrouping.separators(for: rows, calendar: calendar)
    }

    func testContinuousExchangesShareTheFirstTimestamp() {
        let rows = (0..<12).flatMap { index in
            let time = base + Double(index) * 60_000
            return [user("u\(index)", time), turn("a\(index)", start: time + 1_000, end: time + 10_000)]
        }
        XCTAssertEqual(separators(rows), ["user:u0": base])
    }

    func testFiveMinuteGapIsMeasuredFromThePreviousTurnEnd() {
        let end = base + 180_000
        let next = end + 299_999
        let later = next + 300_000
        XCTAssertEqual(separators([
            user("u1", base), turn("a1", start: base + 1_000, end: end),
            user("u2", next), user("u3", later)
        ]), ["user:u1": base, "user:u3": later])
    }

    func testLongReplyDoesNotAddAnotherTimestampWithinItsExchange() {
        let end = base + 40 * 60_000
        XCTAssertEqual(separators([
            user("u1", base), turn("a1", start: base + 1_000, end: end), user("u2", end + 1_000)
        ]), ["user:u1": base])
    }

    func testLocalMidnightStartsANewGroupEvenAfterALongReply() {
        let midnight = calendar.startOfDay(for: Date(timeIntervalSince1970: base / 1_000))
            .addingTimeInterval(24 * 60 * 60).timeIntervalSince1970 * 1_000
        XCTAssertEqual(separators([
            user("u1", midnight - 30_000),
            turn("a1", start: midnight - 29_000, end: midnight + 1_000),
            user("u2", midnight + 2_000)
        ]), ["user:u1": midnight - 30_000, "user:u2": midnight + 2_000])
    }

    func testFinishingAStreamingTurnKeepsItsTimestampOnTheUserMessage() {
        let prompt = user("u1", base)
        let running = separators([prompt, turn("a1", start: base + 1_000, end: nil)])
        let completed = separators([prompt, turn("a1", start: base + 1_000, end: base + 600_000)])
        XCTAssertEqual(running, ["user:u1": base])
        XCTAssertEqual(completed, running)
    }

    func testTriggerAndItsReplyShareOneTimestamp() {
        let time = base + 600_000
        XCTAssertEqual(separators([
            user("u1", base), turn("a1", start: base + 1_000, end: base + 10_000),
            .trigger(TriggerRow(id: "goal", title: "继续执行目标", text: "继续", time: time)),
            turn("a2", start: time + 1_000, end: time + 600_000)
        ]), ["user:u1": base, "trigger:goal": time])
    }

    func testStandaloneAssistantTurnUsesItsStartTime() {
        XCTAssertEqual(separators([
            turn("a1", start: base, end: base + 1_000),
            turn("a2", start: base + 301_000, end: base + 900_000)
        ]), ["turn:a1": base, "turn:a2": base + 301_000])
    }

    func testMissingAndInvalidDatesDoNotCreateFalseTimestamps() {
        XCTAssertEqual(separators([
            user("unknown", nil), user("nan", .nan), user("negative", -1), user("infinite", .infinity),
            turn("answer", start: nil, end: nil, answerTime: base),
            user("older", base - 60_000), user("next", base + 300_000)
        ]), ["turn:answer": base, "user:next": base + 300_000])
    }

    func testCommandsAndRunningStatusDoNotRepeatTheTime() {
        XCTAssertEqual(separators([
            user("u1", base),
            .command(CommandRow(id: "compact", name: "compact", summary: "正在压缩…", isError: false, isRunning: true)),
            .status(startedAt: base + 1_000),
            turn("a1", start: base + 1_000, end: base + 600_000)
        ]), ["user:u1": base])
    }
}
