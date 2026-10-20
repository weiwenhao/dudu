import XCTest
@testable import dsbot

final class TranscriptTitleTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        return calendar
    }()

    private func milliseconds(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) -> Double {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
            .timeIntervalSince1970 * 1_000
    }

    func testDurationDropsEmptyLeadingUnits() {
        XCTAssertEqual(TranscriptTitles.duration(milliseconds: 44_000), "44秒")
        XCTAssertEqual(TranscriptTitles.duration(milliseconds: 313_000), "5分13秒")
        XCTAssertEqual(TranscriptTitles.duration(milliseconds: 60_000), "1分0秒")
        XCTAssertEqual(TranscriptTitles.duration(milliseconds: 3_720_000), "1小时2分0秒")
        XCTAssertEqual(TranscriptTitles.duration(milliseconds: -5), "0秒")
    }

    func testTokenFiguresAreCompact() {
        XCTAssertEqual(TranscriptTitles.tokens(517), "517")
        XCTAssertEqual(TranscriptTitles.tokens(12_200), "12.2K")
        XCTAssertEqual(TranscriptTitles.tokens(192_127), "192K")
        XCTAssertEqual(TranscriptTitles.tokens(1_300_000), "1.3M")
        XCTAssertEqual(TranscriptTitles.tokens(2_000_000), "2M")
    }

    func testClockShowsTheDateOnlyWhenItIsNotToday() {
        let now = calendar.date(from: DateComponents(year: 2025, month: 10, day: 20, hour: 13, minute: 17))!
        XCTAssertEqual(TranscriptTitles.clock(milliseconds(2025, 10, 20, 9, 5), now: now, calendar: calendar), "09:05")
        XCTAssertEqual(
            TranscriptTitles.clock(milliseconds(2025, 10, 19, 11, 37), now: now, calendar: calendar),
            "10月19日 11:37"
        )
        XCTAssertEqual(
            TranscriptTitles.clock(milliseconds(2024, 12, 31, 23, 59), now: now, calendar: calendar),
            "2024年12月31日 23:59"
        )
    }

    func testGroupTitleJoinsTheTopKindsLikeDSH() {
        XCTAssertEqual(TranscriptTitles.groupTitle([(.commands, 3)]), "执行了命令")
        XCTAssertEqual(TranscriptTitles.groupTitle([(.read, 2), (.search, 1)]), "已读取文件并搜索代码")
        XCTAssertEqual(
            TranscriptTitles.groupTitle([(.read, 3), (.search, 2), (.commands, 1)]),
            "已读取文件，已搜索代码，执行了命令"
        )
        XCTAssertEqual(
            TranscriptTitles.groupTitle([(.read, 4), (.search, 3), (.commands, 2), (.edit, 1)]),
            "已读取文件，已搜索代码，执行了命令等"
        )
        XCTAssertEqual(TranscriptTitles.groupTitle([]), "已完成分析")
    }

    func testToolRowTitlesAndTriggerTitles() {
        XCTAssertEqual(TranscriptTitles.rowTitle(forTool: "bash"), "运行命令")
        XCTAssertEqual(TranscriptTitles.rowTitle(forTool: "terminal_run"), "运行命令")
        XCTAssertEqual(TranscriptTitles.rowTitle(forTool: "apply_patch"), "编辑")
        XCTAssertEqual(TranscriptTitles.rowTitle(forTool: "subagent_spawn"), "子智能体")
        XCTAssertEqual(TranscriptTitles.rowTitle(forTool: "something_new"), "工具调用")
        XCTAssertEqual(TranscriptTitles.triggerTitle("goal"), "继续执行目标")
        XCTAssertEqual(TranscriptTitles.triggerTitle("schedule"), "自动化任务")
        XCTAssertEqual(TranscriptTitles.triggerTitle("unheard-of"), "收到执行请求")
    }

    func testCompactionSummaryNeedsAnItemCount() {
        XCTAssertEqual(
            TranscriptTitles.compactionSummary(items: 348, tokens: 192_127),
            "已压缩 348 条历史记录（约 192127 tokens）"
        )
        XCTAssertNil(TranscriptTitles.compactionSummary(items: nil, tokens: 10))
    }

    func testGoalTitlesFollowThePhase() {
        XCTAssertEqual(SessionGoal(id: "g", phase: "active", objective: "x").title, "进行中的目标")
        XCTAssertEqual(SessionGoal(id: "g", phase: "paused", objective: "x").title, "已暂停的目标")
        XCTAssertEqual(SessionGoal(id: "g", phase: "blocked", objective: "x").title, "受阻的目标")
        XCTAssertFalse(SessionGoal(id: "g", phase: "active", objective: "x").isPaused)
        XCTAssertTrue(SessionGoal(id: "g", phase: "paused", objective: "x").isPaused)
    }
}

final class TranscriptBuilderTests: XCTestCase {
    private func call(_ id: String, _ name: String, _ detail: String, activity: String = "commands", status: String = "done")
        -> TranscriptCall {
        TranscriptCall(id: id, name: name, activity: activity, detail: detail, status: status)
    }

    private func turns(in rows: [TranscriptRow]) -> [TurnRow] {
        rows.compactMap { if case let .turn(turn) = $0 { return turn } else { return nil } }
    }

    func testFinishedTurnFoldsProcessIntoOneGroupAndKeepsTheAnswer() throws {
        let transcript = Transcript(
            entries: [
                TranscriptEntry(type: "user", id: "u1", seq: 1, time: 1_000, text: "谁占用的内存"),
                TranscriptEntry(
                    type: "assistant", id: "a1", seq: 2, time: 2_000,
                    reasoning: "Check the top processes first.\n\nThen compare.", turn: 1, step: 1,
                    calls: [call("c1", "bash", "List top memory processes"), call("c2", "bash", "Break down memory")]
                ),
                TranscriptEntry(
                    type: "assistant", id: "a2", seq: 3, time: 3_000, turn: 1, step: 2,
                    calls: [call("c3", "read", "/tmp/vm_stat.txt", activity: "read")]
                ),
                TranscriptEntry(
                    type: "assistant", id: "a3", seq: 4, time: 4_000, text: "Docker 占用最多。",
                    turn: 1, step: 3, usage: 1_300_000
                )
            ],
            turns: [TranscriptTurn(turn: 1, start: 1_500, end: 45_500, outcome: "done")],
            live: nil
        )

        let rows = TranscriptBuilder.rows(from: transcript, isRunning: false)

        XCTAssertEqual(rows.count, 2)
        guard case let .user(user) = rows[0] else { return XCTFail("The first row is the user's message") }
        XCTAssertEqual(user.text, "谁占用的内存")
        let turn = try XCTUnwrap(turns(in: rows).first)
        XCTAssertEqual(turn.outcome, .done)
        XCTAssertEqual(turn.summaryTitle, "已完成，用时 44秒")
        XCTAssertEqual(turn.answer, "Docker 占用最多。")
        XCTAssertEqual(turn.answerID, "a3")
        XCTAssertEqual(turn.usage, 1_300_000)
        XCTAssertFalse(turn.staysOpen)
        XCTAssertEqual(turn.segments.count, 1)
        guard case let .group(group) = turn.segments[0] else { return XCTFail("Expected one process group") }
        XCTAssertEqual(group.calls.map(\.id), ["c1", "c2", "c3"])
        XCTAssertEqual(group.thoughts.map(\.id), ["a1"])
        XCTAssertEqual(group.thoughts.first?.summary, "Check the top processes first.")
        XCTAssertEqual(group.title, "执行了命令并已读取文件")
        XCTAssertFalse(group.isRunning)
    }

    func testInterimReplyBreaksTheProcessIntoSeparateGroups() throws {
        let transcript = Transcript(
            entries: [
                TranscriptEntry(
                    type: "assistant", id: "a1", seq: 1, text: "先看一下配置。", reasoning: "Plan the check",
                    turn: 1, step: 1, calls: [call("c1", "read", "config.json", activity: "read")]
                ),
                TranscriptEntry(type: "assistant", id: "a2", seq: 2, text: "配置没有问题。", turn: 1, step: 2)
            ],
            turns: [TranscriptTurn(turn: 1, start: 0, end: 10_000, outcome: "done")],
            live: nil
        )

        let turn = try XCTUnwrap(turns(in: TranscriptBuilder.rows(from: transcript, isRunning: false)).first)

        XCTAssertEqual(turn.answer, "配置没有问题。")
        XCTAssertEqual(turn.segments.count, 3)
        guard case let .group(first) = turn.segments[0],
              case let .reply(replyID, replyText) = turn.segments[1],
              case let .group(second) = turn.segments[2] else { return XCTFail("Expected group, reply, group") }
        XCTAssertEqual(first.thoughts.map(\.id), ["a1"])
        XCTAssertTrue(first.calls.isEmpty)
        XCTAssertEqual(replyID, "a1")
        XCTAssertEqual(replyText, "先看一下配置。")
        XCTAssertEqual(second.calls.map(\.id), ["c1"])
    }

    func testTurnWithoutProcessHasNoDisclosure() throws {
        let transcript = Transcript(
            entries: [TranscriptEntry(type: "assistant", id: "a1", seq: 1, text: "你好", turn: 1, step: 1)],
            turns: [TranscriptTurn(turn: 1, start: 0, end: 2_000, outcome: "done")],
            live: nil
        )

        let turn = try XCTUnwrap(turns(in: TranscriptBuilder.rows(from: transcript, isRunning: false)).first)

        XCTAssertFalse(turn.hasProcess)
        XCTAssertNil(turn.summaryTitle)
        XCTAssertEqual(turn.answer, "你好")
    }

    func testFailedAndStoppedTurnsKeepTheirProcessOpen() throws {
        func turn(outcome: String) throws -> TurnRow {
            let transcript = Transcript(
                entries: [TranscriptEntry(
                    type: "assistant", id: "a1", seq: 1, reasoning: "Trying", turn: 1, step: 1,
                    calls: [call("c1", "bash", "run", status: "error")]
                )],
                turns: [TranscriptTurn(turn: 1, start: 0, end: 5_000, outcome: outcome)],
                live: nil
            )
            return try XCTUnwrap(turns(in: TranscriptBuilder.rows(from: transcript, isRunning: false)).first)
        }

        let failed = try turn(outcome: "failed")
        XCTAssertEqual(failed.summaryTitle, "处理失败")
        XCTAssertTrue(failed.staysOpen)
        XCTAssertEqual(try turn(outcome: "interrupted").summaryTitle, "处理失败")
        let stopped = try turn(outcome: "stopped")
        XCTAssertEqual(stopped.summaryTitle, "已停止")
        XCTAssertTrue(stopped.staysOpen)
    }

    func testRunningTurnShowsTheLiveStepAndHidesTheDisclosureTitle() throws {
        let transcript = Transcript(
            entries: [
                TranscriptEntry(type: "user", id: "u1", seq: 1, time: 1, text: "继续"),
                TranscriptEntry(
                    type: "assistant", id: "a1", seq: 2, reasoning: "Edit the transport", turn: 2, step: 1,
                    calls: [call("c1", "edit", "src/transport.ts", activity: "edit")]
                )
            ],
            turns: [TranscriptTurn(turn: 2, start: 1_000, end: nil, outcome: nil)],
            live: TranscriptLive(
                id: "live:1", text: nil, reasoning: "**Run** the suite.\n\nWaiting for results.",
                calls: [call("c2", "bash", "Run the full suite", status: "running")]
            )
        )

        let rows = TranscriptBuilder.rows(from: transcript, isRunning: true)
        let turn = try XCTUnwrap(turns(in: rows).first)

        XCTAssertEqual(turn.outcome, .running)
        XCTAssertNil(turn.summaryTitle)
        XCTAssertEqual(turn.startedAt, 1_000)
        XCTAssertEqual(turn.live, LiveStatus(activity: .commands, detail: "Run the full suite"))
        guard case let .group(group) = turn.segments.last else { return XCTFail("Expected a process group") }
        XCTAssertTrue(group.isRunning)
        XCTAssertEqual(group.calls.map(\.id), ["c1", "c2"])
        XCTAssertFalse(rows.contains { if case .status = $0 { return true } else { return false } })
    }

    func testLiveStatusFallsBackToTheNewestReasoningParagraph() throws {
        let transcript = Transcript(
            entries: [],
            turns: [TranscriptTurn(turn: 1, start: 0, end: nil, outcome: nil)],
            live: TranscriptLive(id: "live:1", text: nil, reasoning: "First idea.\n\n**Second** idea\nmore", calls: nil)
        )

        let turn = try XCTUnwrap(turns(in: TranscriptBuilder.rows(from: transcript, isRunning: true)).first)

        XCTAssertEqual(turn.live, LiveStatus(activity: .thinking, detail: "Second idea"))
    }

    func testRunningSessionWithoutATurnYetShowsAStatusRow() {
        let transcript = Transcript(
            entries: [TranscriptEntry(type: "user", id: "u1", seq: 1, text: "开始")], turns: [], live: nil
        )

        let rows = TranscriptBuilder.rows(from: transcript, isRunning: true)

        XCTAssertEqual(rows.count, 2)
        guard case .status = rows[1] else { return XCTFail("Expected the running status row") }
        XCTAssertEqual(TranscriptBuilder.rows(from: transcript, isRunning: false).count, 1)
    }

    func testCommandAndTriggerRowsReadLikeDSH() throws {
        let transcript = Transcript(
            entries: [
                TranscriptEntry(
                    type: "command", id: "command:1", seq: 1, commandId: "1", name: "compact", outcome: "success",
                    summary: "Compacted 348 history items (~192127 tokens).",
                    compaction: TranscriptCompaction(items: 348, tokens: 192_127, summary: "\n## 摘要\n\n保留了计划。\n")
                ),
                TranscriptEntry(type: "command", id: "command:2", seq: 2, commandId: "2", name: "compact"),
                TranscriptEntry(
                    type: "command", id: "command:3", seq: 3, commandId: "3", name: "compact", outcome: "error",
                    summary: "Compaction is unavailable while the session is busy."
                ),
                TranscriptEntry(
                    type: "command", id: "command:4", seq: 4, commandId: "4", name: "plan", outcome: "success",
                    summary: "Plan mode on.\nUse /plan off to leave."
                ),
                TranscriptEntry(type: "trigger", id: "t1", seq: 5, time: 9, text: "Continue.", source: "goal"),
                TranscriptEntry(type: "compaction", id: "old", seq: 6, summary: "自动压缩的摘要。", items: 5, tokens: 60)
            ],
            turns: [],
            live: nil
        )

        let rows = TranscriptBuilder.rows(from: transcript, isRunning: false)
        let commands = rows.compactMap { row -> CommandRow? in
            if case let .command(command) = row { return command } else { return nil }
        }

        XCTAssertEqual(commands.count, 5)
        XCTAssertEqual(commands[0].summary, "已压缩 348 条历史记录（约 192127 tokens）")
        XCTAssertFalse(commands[0].isRunning)
        XCTAssertEqual(commands[1].summary, "正在压缩…")
        XCTAssertTrue(commands[1].isRunning)
        XCTAssertEqual(commands[2].summary, "当前无法压缩，请等会话空闲后再试")
        XCTAssertTrue(commands[2].isError)
        XCTAssertEqual(commands[3].summary, "Plan mode on.")
        XCTAssertEqual(commands[4].name, "上下文已压缩")
        XCTAssertEqual(commands[4].summary, "已压缩 5 条历史记录（约 60 tokens）")
        // The compaction summary is what opens when the row is tapped; other commands have none.
        XCTAssertEqual(commands[0].detail, "## 摘要\n\n保留了计划。")
        XCTAssertTrue(commands[0].isCompaction)
        XCTAssertNil(commands[1].detail, "A compaction that is still running has no summary yet.")
        XCTAssertNil(commands[2].detail)
        XCTAssertNil(commands[3].detail)
        XCTAssertFalse(commands[3].isCompaction)
        XCTAssertEqual(commands[4].detail, "自动压缩的摘要。")
        XCTAssertTrue(commands[4].isCompaction)
        guard case let .trigger(trigger) = rows[4] else { return XCTFail("Expected the goal trigger row") }
        XCTAssertEqual(trigger.title, "继续执行目标")
        XCTAssertEqual(trigger.time, 9)
    }

    func testEntriesOfOneTurnAreOrderedByStepAndKeepTheirPosition() throws {
        let transcript = Transcript(
            entries: [
                TranscriptEntry(type: "user", id: "u1", seq: 1, text: "问"),
                TranscriptEntry(type: "assistant", id: "late", seq: 4, text: "结论", turn: 1, step: 2),
                TranscriptEntry(
                    type: "assistant", id: "early", seq: 3, turn: 1, step: 1,
                    calls: [call("c1", "grep", "needle", activity: "search")]
                ),
                TranscriptEntry(type: "user", id: "u2", seq: 5, text: "再问")
            ],
            turns: [TranscriptTurn(turn: 1, start: 0, end: 1_000, outcome: "done")],
            live: nil
        )

        let rows = TranscriptBuilder.rows(from: transcript, isRunning: false)

        XCTAssertEqual(rows.map(\.id), ["user:u1", "turn:turn-1", "user:u2"])
        let turn = try XCTUnwrap(turns(in: rows).first)
        XCTAssertEqual(turn.answer, "结论")
        XCTAssertEqual(turn.answerID, "late")
    }

    func testBlankCompactionSummaryIsNotExpandable() throws {
        let transcript = Transcript(
            entries: [
                TranscriptEntry(
                    type: "command", id: "command:1", seq: 1, commandId: "1", name: "compact", outcome: "success",
                    summary: "Compacted 2 history items (~10 tokens).",
                    compaction: TranscriptCompaction(items: 2, tokens: 10, summary: "  \n ")
                )
            ],
            turns: [],
            live: nil
        )

        guard case let .command(row) = TranscriptBuilder.rows(from: transcript, isRunning: false)[0] else {
            return XCTFail("Expected a command row")
        }

        XCTAssertNil(row.detail)
        XCTAssertEqual(row.summary, "已压缩 2 条历史记录（约 10 tokens）")
    }

    func testWireModelDecodesCompactionSummaries() throws {
        let json = """
        {"entries":[{"type":"command","id":"command:1","name":"compact","outcome":"success",
                     "compaction":{"items":3,"tokens":4200,"summary":"## Summary\\nKept the plan."}},
                    {"type":"compaction","id":"compaction:auto","items":1,"summary":"Auto."}],
         "turns":[]}
        """
        let transcript = try JSONDecoder().decode(Transcript.self, from: Data(json.utf8))

        XCTAssertEqual(transcript.entries[0].compaction?.summary, "## Summary\nKept the plan.")
        XCTAssertEqual(transcript.entries[1].summary, "Auto.")
    }

    func testWireModelDecodesWithOptionalFieldsMissing() throws {
        let json = """
        {"entries":[{"type":"user","id":"u1"},
                    {"type":"assistant","id":"a1","turn":1,"step":1,
                     "calls":[{"id":"c1","name":"bash","activity":"commands","detail":"ls"}]}],
         "turns":[{"turn":1}]}
        """
        let transcript = try JSONDecoder().decode(Transcript.self, from: Data(json.utf8))

        XCTAssertNil(transcript.live)
        XCTAssertEqual(transcript.entries[1].calls?.first?.detail, "ls")
        XCTAssertNil(transcript.entries[1].calls?.first?.status)
        let rows = TranscriptBuilder.rows(from: transcript, isRunning: false)
        XCTAssertEqual(rows.count, 2)
    }
}

final class CommandTextTests: XCTestCase {
    private func text(_ command: SessionCommand, _ reply: String, argument: String? = nil, error: Bool = false) -> String {
        CommandText.message(for: command, argument: argument, outcome: CommandOutcome(isError: error, text: reply))
    }

    func testCompactRepliesBecomeChinese() {
        XCTAssertEqual(
            text(.compact, "Compacted 14 history items (~3200 tokens)."),
            "已压缩 14 条历史（约 3200 tokens）"
        )
        XCTAssertEqual(text(.compact, "No compactable history is available."), "暂无可压缩的历史")
        XCTAssertEqual(text(.compact, "Compaction cancelled."), "压缩已取消")
        XCTAssertEqual(text(.compact, "", error: true), "压缩失败")
    }

    func testPlanRepliesBecomeChinese() {
        XCTAssertEqual(text(.plan, "Plan mode on. Use /plan off to leave."), "已进入计划模式")
        XCTAssertEqual(text(.plan, "Plan mode off."), "已退出计划模式")
        XCTAssertEqual(text(.plan, "Plan mode is already inactive."), "计划模式当前未开启")
        XCTAssertEqual(text(.plan, "Attachments cannot be sent while leaving plan mode."), "退出计划模式时不能带附件")
    }

    func testGoalRepliesBecomeChinese() {
        XCTAssertEqual(text(.goal, "Goal created\nStatus: active"), "已设置目标")
        XCTAssertEqual(text(.goal, "Goal updated\nStatus: active"), "已更新目标")
        XCTAssertEqual(text(.goal, "Goal paused\nStatus: paused"), "目标已暂停")
        XCTAssertEqual(text(.goal, "Goal resumed\nStatus: active"), "目标已继续")
        XCTAssertEqual(text(.goal, "Goal cleared."), "已清除目标")
        XCTAssertEqual(text(.goal, "No goal to clear."), "没有可清除的目标")
        XCTAssertEqual(text(.goal, "A goal is already active. Use /goal edit."), "已有进行中的目标，请使用「更新目标」")
    }

    func testUnfamiliarRepliesAreShownAsTheyAre() {
        XCTAssertEqual(text(.goal, "Something new happened."), "Something new happened.")
        XCTAssertEqual(text(.plan, "Please retry later.", error: true), "Please retry later.")
    }
}
