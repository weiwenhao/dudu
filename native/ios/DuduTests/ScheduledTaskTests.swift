import XCTest
@testable import Dudu

/// The two pure rules of a scheduled task done by 嘟嘟 (2026-11-11): what a draft starts from and keeps when its provider changes, and how the line it leaves in the thread is read.
final class ScheduledTaskTests: XCTestCase {
    private let projects = [
        TaskProject(name: "dudu", path: "/work/dudu", workspaceId: "w1"),
        TaskProject(name: "notes", path: "/work/notes", workspaceId: "w2"),
    ]

    private func options(_ ids: [String]) -> TaskOptions {
        TaskOptions(
            outcome: "success", providers: ids.map { TaskProvider(id: $0, name: $0, available: true, models: []) },
            projects: projects, sessions: nil, timezone: "Asia/Shanghai"
        )
    }

    func testDuduHasNoWorkspaceAndEveryChangeOfProviderLeavesAChoiceItCanHave() throws {
        // A blank task takes the first provider; 嘟嘟 has no workspace and a new conversation for each run.
        var draft = TaskDraft(options: options(["dudu", "claude", "codex"]))
        draft.title = "每日热点新闻"
        draft.prompt = "找今天的热点新闻。"
        XCTAssertEqual([draft.agent, draft.target.mode], ["dudu", "new"])
        XCTAssertNil(draft.project)
        XCTAssertTrue(draft.isComplete, "嘟嘟 needs no workspace.")
        guard case let .object(fields) = draft.json else { return XCTFail("The fields are an object.") }
        XCTAssertEqual(fields["project"], JSONValue.null)
        XCTAssertEqual(TaskTarget.choices(for: "dudu"), ["new", "reuse"], "嘟嘟 has no conversation that is named.")

        // To an agent: its own start, the first workspace and one conversation that is reused. A workspace is needed again.
        draft.choose(agent: "claude", projects: projects)
        XCTAssertEqual(draft.project, projects[0])
        XCTAssertEqual(draft.target, TaskTarget(mode: "reuse"))
        draft.project = nil
        XCTAssertFalse(draft.isComplete)

        // Between agents what was chosen stays, as it always did; only the model is the agent's.
        draft.project = projects[1]
        draft.target = TaskTarget(mode: "existing", sessionId: "s1")
        draft.model = "sonnet"
        draft.choose(agent: "codex", projects: projects)
        XCTAssertEqual(draft.project, projects[1])
        XCTAssertEqual(draft.target, TaskTarget(mode: "existing", sessionId: "s1"))
        XCTAssertNil(draft.model)

        // Back to 嘟嘟: no workspace, and a named conversation never stays.
        draft.choose(agent: "dudu", projects: projects)
        XCTAssertNil(draft.project)
        XCTAssertEqual(draft.target, TaskTarget(mode: "new"))

        // An older plugin offers no 嘟嘟: a blank task is what it was.
        let older = TaskDraft(options: options(["claude", "codex", "deepseek"]))
        XCTAssertEqual([older.agent, older.target.mode], ["claude", "reuse"])
        XCTAssertEqual(older.project, projects[0])
    }

    // The editor of a new task is drawn before the computer has said what it offers (2026-11-24): it starts as 嘟嘟 doing it, and the choices that are read then replace that start without taking back what was typed.
    func testTheEditorStartsBeforeTheChoicesAreThereAndKeepsWhatWasTypedAndSetWhenTheyArrive() throws {
        let placeholder = TaskDraft(options: nil)
        XCTAssertEqual([placeholder.agent, placeholder.target.mode], ["dudu", "new"])
        XCTAssertNil(placeholder.project)

        var typed = placeholder
        typed.title = "每日热点新闻"
        typed.prompt = "找今天的热点新闻。"
        typed.schedule = TaskSchedule(kind: "weekly", time: "08:30", timezone: placeholder.schedule.timezone, weekdays: [1, 3])
        // 嘟嘟 is offered: the start stays 嘟嘟's; the time zone nobody chose is the computer's, the rule is as it was set.
        let withDudu = typed.started(with: options(["dudu", "claude"]), placeholder: placeholder)
        XCTAssertEqual([withDudu.title, withDudu.prompt, withDudu.agent, withDudu.schedule.kind, withDudu.schedule.time], ["每日热点新闻", "找今天的热点新闻。", "dudu", "weekly", "08:30"])
        XCTAssertEqual(withDudu.schedule.weekdays, [1, 3])
        XCTAssertEqual(withDudu.schedule.timezone, "Asia/Shanghai")

        // 嘟嘟 is not offered: the first agent and its workspace replace the start; what was typed stays.
        let without = typed.started(with: options(["claude", "codex"]), placeholder: placeholder)
        XCTAssertEqual([without.agent, without.target.mode, without.title], ["claude", "reuse", "每日热点新闻"])
        XCTAssertEqual(without.project, projects[0])

        // A time zone that was chosen before the choices came stays the person's.
        var chosen = typed
        chosen.schedule.timezone = "America/Toronto"
        XCTAssertEqual(chosen.started(with: options(["dudu"]), placeholder: placeholder).schedule.timezone, "America/Toronto")
    }

    func testTheLineOfATaskComesWithoutAnIssueAndIsNotAnswerable() throws {
        func slot(_ json: String) throws -> GroupLine? { try JSONDecoder().decode(GroupLineSlot.self, from: Data(json.utf8)).line }
        let done = try XCTUnwrap(slot(#"{"v":1,"kind":"task","task":{"id":"t1","title":"每日热点新闻"},"text":"今日热点","at":1760000000000,"ok":true}"#))
        XCTAssertEqual(done.kind, .task)
        XCTAssertEqual(done.task, GroupTask(id: "t1", title: "每日热点新闻"))
        XCTAssertFalse(done.isAnswerable)
        XCTAssertEqual(done.taskText, "今日热点")

        // A run that failed says so in front of the reason, which is the plugin's own text.
        let failed = try XCTUnwrap(slot(#"{"v":1,"kind":"task","task":{"id":"t1","title":"每日热点新闻"},"text":"Claude is not logged in.","at":1760000000000,"ok":false}"#))
        XCTAssertEqual(failed.taskText, L10n.text("{0}：{1}", GroupLine.runFailed, "Claude is not logged in."))

        // It is no line that waits for an answer; the other kinds still need their issue, or the thread keeps the command's plain row.
        let row = TranscriptRow.command(CommandRow(
            id: "c1", name: GroupChat.command, summary: "", isError: false, isRunning: false, commandId: "c1", group: done
        ))
        XCTAssertTrue(GroupChat.waiting(in: [row], now: 1_760_000_000_000).isEmpty)
        XCTAssertNil(try slot(#"{"v":1,"kind":"reply","text":"x"}"#))
    }
}
