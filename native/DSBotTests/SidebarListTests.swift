import XCTest
@testable import dsbot

final class SidebarListTests: XCTestCase {
    private func session(
        _ id: String, workspace: String? = nil, updated: Double = 0, blank: Bool? = nil, archived: Bool? = nil,
        pinned: Bool? = nil, pinRank: Int? = nil
    ) -> SessionSummary {
        SessionSummary(
            id: id, title: "标题 \(id)", workspaceId: workspace, workspaceName: workspace.map { "名 \($0)" },
            updatedAt: updated, status: "idle", blank: blank, archived: archived, pinned: pinned, pinRank: pinRank
        )
    }

    private let workspaces = [
        WorkspaceSummary(id: "w1", name: "项目一", path: "/p/one"),
        WorkspaceSummary(id: "w2", name: "项目二", path: "/p/two"),
        // A workspace inside another is listed on its own: the phone shows one level.
        WorkspaceSummary(id: "w3", name: "嵌套", path: "/p/one/nested"),
    ]

    private func layout(_ entries: [SidebarEntry]) -> [String] {
        entries.map {
            switch $0 {
            case let .group(group, collapsed): return "G:\(group.id)\(collapsed ? "(折叠)" : "")"
            case let .session(session): return "S:\(session.id)"
            }
        }
    }

    private func entries(
        _ sessions: [SessionSummary], _ options: SidebarOptions = SidebarOptions(),
        search: String = "", collapsed: Set<String> = [],
        in list: [WorkspaceSummary]? = nil
    ) -> [SidebarEntry] {
        SidebarList.entries(
            sessions: sessions, workspaces: list ?? workspaces, options: options,
            search: search, collapsed: collapsed
        )
    }

    func testTheDefaultsAreDSHsGroupedByWorkspaceWithoutArchived() {
        XCTAssertEqual(SidebarOptions().grouping, .workspace)
        XCTAssertEqual(SidebarOptions().archive, .hide)
    }

    func testWorkspacesAreGroupsInHostOrderEvenWhenEmptyAndLooseConversationsComeLast() {
        let list = entries([
            session("a", workspace: "w2", updated: 1), session("b", workspace: "w1", updated: 5),
            session("c", workspace: "w1", updated: 9), session("loose", workspace: nil, updated: 7),
            session("gone", workspace: "unregistered", updated: 8),
        ], in: Array(workspaces.prefix(2)))
        XCTAssertEqual(layout(list), [
            "G:w1", "S:c", "S:b",
            "G:w2", "S:a",
            "G:ungrouped", "S:gone", "S:loose",
        ])
    }

    func testAConversationNobodyHasWrittenInNeverShowsNotEvenWhileItIsOpen() {
        // The new-task page is a page of its own; the conversation joins the list when its first message is sent.
        let rows = [
            session("blank-1", workspace: "w1", blank: true), session("blank-2", workspace: "w1", blank: true),
            session("real", workspace: "w1", updated: 3),
        ]
        XCTAssertEqual(layout(entries(rows, in: [workspaces[0]])), ["G:w1", "S:real"])
        XCTAssertEqual(layout(entries(rows, SidebarOptions(grouping: .flat))), ["S:real"])
        XCTAssertEqual(layout(entries([session("only-blank", workspace: "w1", blank: true)], in: [workspaces[0]])), ["G:w1"],
                       "A workspace with nothing but an empty conversation is a heading with nothing under it.")
        // The moment it has a message the host stops flagging it, and it appears.
        XCTAssertEqual(layout(entries([session("blank-1", workspace: "w1", blank: false)], in: [workspaces[0]])), ["G:w1", "S:blank-1"])
    }

    func testPinnedConversationsLeadTheirGroupMostRecentlyPinnedFirst() {
        let rows = [
            session("new", workspace: "w1", updated: 9), session("old", workspace: "w1", updated: 1),
            session("p2", workspace: "w1", updated: 2, pinned: true, pinRank: 1),
            session("p1", workspace: "w1", updated: 3, pinned: true, pinRank: 0),
        ]
        XCTAssertEqual(layout(entries(rows, in: [workspaces[0]])), ["G:w1", "S:p1", "S:p2", "S:new", "S:old"])
    }

    func testTheArchiveFilterHidesShowsOrIsolatesArchivedConversations() {
        let rows = [
            session("live", workspace: "w1", updated: 2), session("old", workspace: "w1", updated: 1, archived: true),
            session("gone", workspace: "w2", updated: 3, archived: true),
        ]
        var options = SidebarOptions()
        XCTAssertEqual(layout(entries(rows, options, in: Array(workspaces.prefix(2)))),
                       ["G:w1", "S:live", "G:w2"], "Archived rows are hidden; the empty workspace stays.")
        options.archive = .all
        XCTAssertEqual(layout(entries(rows, options, in: Array(workspaces.prefix(2)))),
                       ["G:w1", "S:live", "S:old", "G:w2", "S:gone"])
        options.archive = .only
        XCTAssertEqual(layout(entries(rows, options, in: Array(workspaces.prefix(2)))),
                       ["G:w1", "S:old", "G:w2", "S:gone"])
        XCTAssertEqual(layout(entries([rows[0], rows[1]], options, in: Array(workspaces.prefix(2)))),
                       ["G:w1", "S:old"], "A workspace without archived conversations is dropped.")
    }

    func testTheFlatListHasNoGroupsAndSortsNewestFirstWithPinsOnTop() {
        var options = SidebarOptions()
        options.grouping = .flat
        let rows = [
            session("a", workspace: "w1", updated: 1), session("b", workspace: "w2", updated: 5),
            session("p", workspace: "w1", updated: 0, pinned: true, pinRank: 0),
        ]
        XCTAssertEqual(layout(entries(rows, options)), ["S:p", "S:b", "S:a"])
    }

    func testCollapsingAWorkspaceHidesItsRowsAndKeepsItsHeader() {
        let rows = [
            session("one", workspace: "w1"), session("nest", workspace: "w3"), session("two", workspace: "w2"),
        ]
        XCTAssertEqual(layout(entries(rows)), ["G:w1", "S:one", "G:w2", "S:two", "G:w3", "S:nest"])
        XCTAssertEqual(layout(entries(rows, collapsed: ["w1"])), ["G:w1(折叠)", "G:w2", "S:two", "G:w3", "S:nest"])
        XCTAssertEqual(layout(entries(rows, collapsed: ["w1", "w2", "w3"])), ["G:w1(折叠)", "G:w2(折叠)", "G:w3(折叠)"])
    }

    func testAFoldedWorkspaceOpensAgainWhileSearching() {
        let rows = [session("one", workspace: "w1")]
        XCTAssertEqual(layout(entries(rows, search: "one")), ["S:one"], "A search lists every match, folded or not.")
    }

    func testASearchListsMatchesWithoutGroupsAndIgnoresTheArchiveFilter() {
        let rows = [
            session("alpha", workspace: "w1", updated: 1), session("beta", workspace: "w2", updated: 2, archived: true),
            session("blank-hit", workspace: "w1", blank: true),
        ]
        XCTAssertEqual(layout(entries(rows, search: "标题 alpha")), ["S:alpha"])
        XCTAssertEqual(layout(entries(rows, search: "项目二")).count, 0, "The workspace name matched is the session's own.")
        XCTAssertEqual(layout(entries(rows, search: "名 w2")), ["S:beta"])
        XCTAssertEqual(layout(entries(rows, search: "  ")).first, "G:w1", "A blank query is no search.")
    }
}
