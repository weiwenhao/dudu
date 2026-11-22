import XCTest
@testable import Dudu

/// The settings are laid out in the app from the plugin's values (`SettingsLayouts`). These guard the rules that are easy to get wrong in pure logic; how a page looks is the owner's to review.
final class NativeSettingsLayoutsTests: XCTestCase {
    private func json(_ text: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
    }

    private func rows(_ page: SettingsPage, header: String) -> [SettingsItem] {
        page.sections.first { $0.header == header }?.rows ?? []
    }

    /// 已连接 is what works (owner, 2026-11-21: GitLab and Sentry timing out were listed there). Every other connector, a timeout too, is among 可用 with the words of its state and its one verb.
    func testOnlyAWorkingConnectorIsConnected() throws {
        let list = try json("""
        {"connectors": [
          {"id": "none", "name": "No state"},
          {"id": "ok", "name": "Connected", "state": {"status": "connected"}},
          {"id": "auth", "name": "Needs auth", "state": {"status": "needs-auth"}},
          {"id": "wait", "name": "Waiting", "state": {"status": "waiting"}},
          {"id": "login", "name": "Login", "state": {"status": "needs-login"}},
          {"id": "miss", "name": "Missing", "state": {"status": "missing", "command": "glab"}},
          {"id": "late", "name": "Timeout", "state": {"status": "error", "message": "timeout"}},
          {"id": "new", "name": "A status of a newer plugin", "state": {"status": "reauth"}},
          {"id": "busy", "name": "Busy", "state": {"status": "connected"}, "busy": true}
        ]}
        """)
        let page = try SettingsLayouts.page(for: SettingsLocation(section: "connectors", target: nil), values: [
            "connectors/catalog": .object(["groups": .array([])]), "connectors/list": list,
        ])
        XCTAssertEqual(rows(page, header: L10n.text("已连接")).map(\.id), ["none", "ok"])
        let available = rows(page, header: L10n.text("可用"))
        XCTAssertEqual(available.map(\.id), ["auth", "wait", "login", "miss", "late", "new", "busy"])
        // The timeout keeps its red words and its retry; a waiting one asks for the computer.
        XCTAssertEqual(available.first { $0.id == "late" }?.detail, L10n.text("连接超时"))
        XCTAssertEqual(available.first { $0.id == "late" }?.tone, "bad")
        XCTAssertEqual(available.first { $0.id == "late" }?.menu?.first?.title, L10n.text("重试"))
        XCTAssertEqual(available.first { $0.id == "wait" }?.detail, L10n.text("请在电脑上授权"))
        XCTAssertEqual(available.first { $0.id == "wait" }?.tone, "warn")
        XCTAssertEqual(page.poll, 1.5)
    }

    /// A status row's menu: the default is not offered for the finished categories, the ends cannot move past themselves, and the last one of a category cannot be deleted.
    func testStatusMenuOffersWhatCanBeDone() throws {
        let data = try json("""
        {"counts": {"backlog": 2}, "statuses": [
          {"id": "backlog", "category": "backlog", "type": "backlog", "isDefault": true},
          {"id": "b", "category": "backlog", "type": "backlog", "name": "Icebox"},
          {"id": "done", "category": "completed", "type": "done"}
        ]}
        """)
        let page = try SettingsLayouts.page(for: SettingsLocation(section: "statuses", target: nil), values: ["issues/statuses": data])
        let all = page.sections.flatMap(\.rows)
        let first = try XCTUnwrap(all.first { $0.id == "backlog" }).menu ?? []
        let last = try XCTUnwrap(all.first { $0.id == "b" }).menu ?? []
        let finished = try XCTUnwrap(all.first { $0.id == "done" }).menu ?? []
        func item(_ menu: [SettingsMenuItem], _ title: String) -> SettingsMenuItem? { menu.first { $0.title == L10n.text(title) } }
        XCTAssertEqual(item(first, "设为默认")?.enabled, false)
        XCTAssertEqual(item(last, "设为默认")?.enabled, true)
        XCTAssertEqual(item(first, "上移")?.enabled, false)
        XCTAssertEqual(item(first, "下移")?.enabled, true)
        XCTAssertEqual(item(last, "下移")?.enabled, false)
        XCTAssertNil(item(finished, "设为默认"))
        XCTAssertNil(item(finished, "删除"))
        // The issues of a deleted status go to the other one, and the question says so.
        XCTAssertEqual(item(first, "删除")?.confirm?.message, "\(L10n.text("待规划")) · \(L10n.text("将事项移至：{0}", "Icebox"))")
        XCTAssertEqual(item(last, "删除")?.confirm?.message, "Icebox")
    }

    /// The form of a status has the progress only for a started one, the plugin's `String(0.25)` as the ids.
    func testStatusFormHasProgressOnlyForAStartedStatus() throws {
        let data = try json("""
        {"statuses": [
          {"id": "doing", "category": "started", "type": "in_progress", "iconProgress": 0.25},
          {"id": "review", "category": "started", "type": "in_review"},
          {"id": "later", "category": "backlog", "type": "backlog"}
        ]}
        """)
        func form(_ id: String) throws -> SettingsPage {
            try SettingsLayouts.page(for: SettingsLocation(section: "statuses", target: "edit:\(id)"), values: ["issues/statuses": data])
        }
        let doing = try form("doing").sections.flatMap(\.rows).first { $0.id == "progress" }
        XCTAssertEqual(doing?.options?.map(\.id), ["0", "0.25", "0.5", "0.75", "1"])
        XCTAssertEqual(doing?.selected, "0.25")
        XCTAssertEqual(try form("review").sections.flatMap(\.rows).first { $0.id == "progress" }?.selected, "0.75")
        XCTAssertNil(try form("later").sections.flatMap(\.rows).first { $0.id == "progress" })
        XCTAssertNil(try form("later").sections.flatMap(\.rows).first { $0.id == "preview" }?.progressKey)
    }

    /// How often a collector reads: a common frequency by its name, `2h` as every 2 hours, a cron as it was written.
    func testFrequencyWords() {
        XCTAssertEqual(SettingsLayouts.describeFrequency(nil), L10n.text("每 30 分钟"))
        XCTAssertEqual(SettingsLayouts.describeFrequency("1h"), L10n.text("每小时"))
        XCTAssertEqual(SettingsLayouts.describeFrequency("0 9 * * 1-5"), L10n.text("周一至周五 09:00"))
        XCTAssertEqual(SettingsLayouts.describeFrequency("2h"), L10n.plural("每 \(2) 小时"))
        XCTAssertEqual(SettingsLayouts.describeFrequency("1 D"), L10n.text("每天"))
        XCTAssertEqual(SettingsLayouts.describeFrequency("*/5 * * * *"), "*/5 * * * *")
    }

    /// The add form follows what the plugin recognized: an environment only for a local command, a token only for a remote one that asks for it, neither for several at once.
    func testAddConnectorFormFollowsWhatWasRecognized() throws {
        func ids(_ recognized: String?) throws -> [String] {
            let page = SettingsLayouts.customConnector(recognized: try recognized.map(json))
            XCTAssertEqual(page.preview?.key, "text")
            return page.sections.flatMap(\.rows).map(\.id)
        }
        XCTAssertEqual(try ids(nil), ["text", "name"])
        XCTAssertEqual(try ids(#"{"kind": "local", "name": "files"}"#), ["text", "recognized", "name", "env"])
        XCTAssertEqual(try ids(#"{"kind": "remote", "auth": "token"}"#), ["text", "recognized", "name", "token"])
        XCTAssertEqual(try ids(#"{"kind": "remote", "auth": "oauth"}"#), ["text", "recognized", "name"])
        XCTAssertEqual(try ids(#"{"kind": "local", "count": 3}"#), ["text", "recognized"])
    }

    /// An older plugin answers a method it does not know with one of two codes: the page is then the one it describes. Any other failure is a failure.
    func testAnOlderPluginIsRecognizedByItsAnswer() {
        XCTAssertTrue(DuduFailure.remote("METHOD_NOT_ALLOWED").isUnknownMethod)
        XCTAssertTrue(DuduFailure.remote("UNSUPPORTED").isUnknownMethod)
        XCTAssertFalse(DuduFailure.remote("NOT_FOUND").isUnknownMethod)
        XCTAssertFalse(DuduFailure.disconnected.isUnknownMethod)
    }

    /// An action that succeeded is not turned into a failure by a page this app cannot read (the plugin may still send one).
    func testAnUnreadablePageDoesNotFailAnAnswer() throws {
        let value = try json(#"{"outcome": "success", "page": {"title": 5}, "recognized": {"kind": "local"}}"#)
        let answer = try JSONDecoder().decode(SettingsAnswer.self, from: JSONEncoder().encode(value))
        XCTAssertEqual(answer.outcome, "success")
        XCTAssertNil(answer.page)
        XCTAssertEqual(answer.recognized?["kind"]?.stringValue, "local")
    }
}
