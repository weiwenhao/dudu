import XCTest
@testable import Dudu

final class SearchTests: XCTestCase {
    private func row(_ number: Int, agent: String? = "claude", project: String? = "Dudu") throws -> BoardConversation {
        let issue = """
        {"id":\(number),"title":"Issue \(number)","status":"todo","statusType":"todo","priority":"none","updatedAt":1\(agent.map { ",\"agent\":\"\($0)\"" } ?? "")\(project.map { ",\"project\":\"\($0)\"" } ?? "")}
        """
        return try JSONDecoder().decode(BoardConversation.self, from: Data("""
        {"id":"issue:\(number)","title":"Issue \(number)","sessionId":"s\(number)","preview":"","receivedAt":\(number),"sessionState":"idle","deepSleep":false,"unread":false,"readSeq":1,"pinned":false,"issue":\(issue)}
        """.utf8))
    }

    func testHistoryKeepsEachWordOnceNewestFirstAndTwelveAtMost() {
        var history = SearchHistory()
        history.add("预发布")
        history.add("CI runner")
        history.add("  ")
        history.add("预发布")
        XCTAssertEqual(history.words, ["预发布", "CI runner"])
        history.add("ci RUNNER")
        XCTAssertEqual(history.words, ["ci RUNNER", "预发布"], "a word is kept once, as it was typed last")
        for number in 0..<20 { history.add("word \(number)") }
        XCTAssertEqual(history.words.count, SearchHistory.limit)
        XCTAssertEqual(history.words.first, "word 19")
        history.clear()
        XCTAssertTrue(history.words.isEmpty)
    }

    func testFrequentConversationsAreTheLastOpenedFirstThenTheListsOwnOrder() throws {
        let rows = try (1...5).map { try row($0) }
        let ordered = FrequentConversations.ordered(rows, opened: ["issue:4": 20, "issue:2": 30, "gone": 99])
        XCTAssertEqual(ordered.map(\.id), ["issue:2", "issue:4", "issue:1", "issue:3", "issue:5"])
        XCTAssertEqual(FrequentConversations.ordered(rows, opened: [:]).map(\.id), rows.map(\.id))
    }

    func testOpeningTimesAreKeptPerComputerAndCut() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "dudu.search.tests.\(UUID().uuidString)"))
        let memory = SearchMemory(defaults: defaults)
        memory.recordOpen("issue:1", computer: "a", at: Date(timeIntervalSince1970: 10))
        memory.recordOpen("issue:2", computer: "b", at: Date(timeIntervalSince1970: 20))
        XCTAssertEqual(memory.opened(for: "a"), ["issue:1": 10_000])
        XCTAssertEqual(memory.opened(for: "b"), ["issue:2": 20_000])
        XCTAssertTrue(memory.opened(for: nil).isEmpty)
        for number in 0..<260 { memory.recordOpen("issue:\(number + 10)", computer: "a", at: Date(timeIntervalSince1970: Double(100 + number))) }
        let kept = memory.opened(for: "a")
        XCTAssertEqual(kept.count, 200)
        XCTAssertNotNil(kept["issue:269"])
        XCTAssertNil(kept["issue:1"], "the oldest openings go first")
        var history = SearchHistory()
        history.add("预发布")
        memory.history = history
        XCTAssertEqual(SearchMemory(defaults: defaults).history.words, ["预发布"])
    }

    func testMarkedWordsAreEachWordOfTheQueryFoundWhereverTheyAre() {
        XCTAssertEqual(SearchText.terms("  预发布   环境 预发布 "), ["预发布", "环境"])
        let value = "Cart-512 预发布环境: cart 预发布"
        let found = SearchText.ranges(in: value, terms: SearchText.terms("cart 预发布"))
        XCTAssertEqual(found.map { String(value[$0]) }, ["Cart", "预发布", "cart", "预发布"], "case does not matter, and the text keeps its own")
        XCTAssertTrue(SearchText.ranges(in: value, terms: []).isEmpty)
        XCTAssertEqual(SearchText.ranges(in: "预发布", terms: ["预发布", "预发"]).count, 1, "the longer word is the one marked when two start together")
    }

    func testRangeFiltersMatchTasksAndAskTheInboxForOneStateOnly() throws {
        func task(_ id: String, status: String, agent: String) throws -> ScheduledTask {
            try JSONDecoder().decode(ScheduledTask.self, from: Data("""
            {"id":"\(id)","revision":1,"status":"\(status)","title":"T \(id)","prompt":"p","agent":"\(agent)","target":{"mode":"reuse"},"schedule":{"kind":"interval","minutes":60}}
            """.utf8))
        }
        let tasks = try [task("a", status: "active", agent: "claude"), task("b", status: "paused", agent: "codex"), task("c", status: "ended", agent: "claude")]
        var filters = SearchRangeFilters()
        XCTAssertTrue(filters.isEmpty(in: .tasks))
        XCTAssertEqual(filters.matching(tasks).count, 3)
        filters.toggle("claude", in: .taskAgent)
        XCTAssertEqual(filters.matching(tasks).map(\.id), ["a", "c"])
        filters.toggle("ended", in: .taskStatus)
        XCTAssertEqual(filters.matching(tasks).map(\.id), ["c"])
        filters.toggle("ended", in: .taskStatus)
        XCTAssertEqual(filters.chosen(.taskStatus), [])
        XCTAssertFalse(filters.isEmpty(in: .tasks))
        XCTAssertTrue(filters.isEmpty(in: .inbox) && filters.isEmpty(in: .sessions), "each range has its own choices")
        filters.toggle("todo", in: .state)
        XCTAssertEqual(filters.inboxState, "todo")
        filters.toggle("done", in: .state)
        XCTAssertNil(filters.inboxState, "both states are no restriction")
    }

    func testConversationFiltersAreTheBoardsAndNeverTheBoardsOwn() throws {
        let rows = try [row(1, agent: "claude", project: "Dudu"), row(2, agent: "codex", project: "Web"), row(3, agent: nil, project: nil)]
        var filters = SearchRangeFilters()
        filters.toggle("codex", in: .agent)
        XCTAssertEqual(filters.conversations.matching(rows).map(\.id), ["issue:2"])
        XCTAssertEqual(filters.chosen(.agent), ["codex"])
        filters.toggle("codex", in: .agent)
        filters.toggle("Dudu", in: .project)
        XCTAssertEqual(filters.conversations.matching(rows).map(\.id), ["issue:1"])
        XCTAssertEqual(BoardFilters().matching(rows).count, 3, "the board's own filter is another value")
    }

    func testAnAnswerDecodesEachPlacesRowsWithTheirLinesOfText() throws {
        let answer = try JSONDecoder().decode(SearchAnswer.self, from: Data("""
        {"outcome":"success","q":"预发布",
         "sessions":{"total":1,"indexing":true,"items":[{"id":"issue:1","title":"A","sessionId":"s1","preview":"p","receivedAt":5,"sessionState":"idle","deepSleep":false,"unread":false,"readSeq":1,"pinned":false,"snippet":"…预发布…",
           "issue":{"id":1,"title":"A","status":"todo","statusType":"todo","priority":"none","updatedAt":1}}]},
         "inbox":{"total":1,"names":{"lark":"飞书"},"items":[{"id":7,"ref":"r7","connector":"lark","connectorName":"飞书","connectorIcon":"lark","title":"T","from":"Alice","at":1,"unread":true,"snippet":"…预发布…"}]},
         "tasks":{"total":0,"items":[],"failed":true}}
        """.utf8))
        XCTAssertEqual(answer.sessions?.items.first?.snippet, "…预发布…")
        XCTAssertEqual(answer.sessions?.items.first?.conversation.id, "issue:1")
        XCTAssertEqual(answer.sessions?.indexing, true)
        XCTAssertEqual(answer.inbox?.items.first?.record.byLine, "Alice · 飞书")
        XCTAssertEqual(answer.inbox?.names, ["lark": "飞书"])
        XCTAssertTrue(answer.failed(in: [.tasks]))
        XCTAssertFalse(answer.failed(in: SearchScope.allCases), "one place that answered is enough")
    }

    @MainActor
    func testWhatNeedsAskingOfTheComputer() {
        let model = SearchModel(memory: SearchMemory(defaults: UserDefaults(suiteName: "dudu.search.tests.\(UUID().uuidString)") ?? .standard))
        XCTAssertNil(model.wantedRequest(computerID: "a", revision: 1), "nothing typed, no range: the home page")
        XCTAssertTrue(model.showsHome)
        model.select(.sessions)
        XCTAssertNil(model.wantedRequest(computerID: "a", revision: 1), "the conversations of a range with nothing typed are the board's")
        XCTAssertTrue(model.showsHint)
        model.select(.inbox)
        XCTAssertEqual(model.wantedRequest(computerID: "a", revision: 1)?.scope, .inbox, "the inbox's sources and the tasks' agents come with the answer")
        model.toggle("todo", in: .state)
        XCTAssertFalse(model.showsHint)
        XCTAssertEqual(model.wantedRequest(computerID: "a", revision: 1)?.state, "todo")
        model.select(nil)
        model.query = "  预发布 "
        XCTAssertEqual(model.wantedRequest(computerID: "a", revision: 1)?.phrase, "预发布")
        XCTAssertEqual(model.wantedRequest(computerID: "a", revision: 1)?.places, SearchScope.allCases)
        XCTAssertNotEqual(model.wantedRequest(computerID: "a", revision: 1), model.wantedRequest(computerID: "a", revision: 2), "a new connection asks again")
    }
}
