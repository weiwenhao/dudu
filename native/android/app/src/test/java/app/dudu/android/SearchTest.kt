package app.dudu.android

import app.dudu.android.data.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** The search page's logic (`data/Search.kt`, `data/SearchModel.kt`): what it remembers, what it colours, how it reads and narrows the computer's answer, and when it asks. */
@OptIn(ExperimentalCoroutinesApi::class)
class SearchTest {
    private fun conversationJson(n: Int, agent: String? = "claude", project: String? = "mobile", snippet: String? = null) = json(
        "id" to "issue:$n", "title" to "Issue $n", "sessionId" to "s$n", "preview" to "p", "receivedAt" to 1000L + n, "sessionState" to "idle",
        "unread" to false, "readSeq" to -1, "pinned" to false,
        "issue" to json("id" to n.toLong(), "title" to "Issue $n", "status" to "todo", "statusType" to "todo", "agent" to agent, "project" to project,
            "priority" to "none", "updatedAt" to 1000L + n)).apply { snippet?.let { put("snippet", it) } }
    private fun conversation(n: Int, agent: String? = "claude", project: String? = "mobile") = Conversation.parse(conversationJson(n, agent, project))
    private fun task(id: String, status: String, agent: String?) = json("id" to id, "title" to "Task $id", "status" to status, "agent" to agent)
    private fun answerJson(sessions: Int = 0, indexing: Boolean = false) = json("outcome" to "success",
        "sessions" to json("total" to sessions, "indexing" to indexing, "items" to JSONArray()),
        "inbox" to json("total" to 0, "names" to json(), "items" to JSONArray()), "tasks" to json("total" to 0, "items" to JSONArray()))

    @Test fun theWordsSearchedForAreKeptNewestFirstOnceAndTwelveAtMost() {
        var memory = SearchMemory()
        for (words in listOf("a", "b", "c")) memory = memory.searched(words)
        assertEquals(listOf("c", "b", "a"), memory.history)
        // The same words in another case move to the front, as typed last; spaces around and blanks are nothing.
        memory = memory.searched("  A  ")
        assertEquals(listOf("A", "c", "b"), memory.history)
        assertEquals(memory, memory.searched("   "))
        repeat(20) { memory = memory.searched("w$it") }
        assertEquals(12, memory.history.size)
        assertEquals("w19", memory.history.first())
        assertTrue(memory.withoutHistory().history.isEmpty())
    }

    @Test fun frequentIsEveryConversationTheOneOpenedLastFirstThenTheListsOwnOrder() {
        val rows = (1..8).map { conversation(it) }
        val memory = SearchMemory().open("issue:5", 100).open("issue:2", 300).open("issue:7", 200)
        assertEquals(listOf("issue:2", "issue:7", "issue:5", "issue:1", "issue:3", "issue:4"), memory.frequent(rows).map(Conversation::id))
        // What was opened and is not on the board any more takes no place; nothing opened leaves the list as it is.
        assertEquals(listOf("issue:1", "issue:2"), SearchMemory().open("issue:9", 5).frequent(rows.take(2)).map(Conversation::id))
        assertEquals(rows.take(6).map(Conversation::id), SearchMemory().frequent(rows).map(Conversation::id))
    }

    @Test fun whatWasKeptComesBackAndOnlyTheLastTwoHundredOpenedAreKept() {
        val kept = SearchMemory().searched("预发布").searched("Cart-512").open("issue:3", 5)
        assertEquals(kept, SearchMemory.parse(kept.saved()))
        assertEquals(SearchMemory(), SearchMemory.parse("not json"))
        var many = SearchMemory()
        for (i in 1..250) many = many.open("issue:$i", i.toLong())
        assertEquals(200, many.opened.size)
        assertFalse("issue:1" in many.opened)
        assertTrue("issue:250" in many.opened)
    }

    @Test fun theTypedWordsAreFoundInAnyCaseAndTouchingStretchesAreOne() {
        assertEquals(listOf("bb", "a"), searchTerms("  a  bb a "))
        val text = "预发布环境 Cart-512 预发布"
        assertEquals(listOf(0..2, 15..17), matchRanges(text, searchTerms("预发布")))
        assertEquals(listOf(6..9), matchRanges(text, searchTerms("cart")))
        assertEquals(listOf(0..2, 6..9, 15..17), matchRanges(text, searchTerms("预发布 CART")))
        // Words that overlap or touch are one stretch to colour.
        assertEquals(listOf(0..2), matchRanges("abcd", listOf("ab", "bc")))
        assertEquals(listOf(0..3), matchRanges("abcd", listOf("ab", "cd")))
        assertTrue(matchRanges("abcd", searchTerms("  ")).isEmpty())
        assertTrue(matchRanges("", listOf("a")).isEmpty())
    }

    @Test fun theAnswerIsReadPlaceByPlaceAndOneThatCannotBeReadDoesNotSpoilTheRest() {
        val raw = json("outcome" to "success", "q" to "预发布",
            "sessions" to json("total" to 7, "indexing" to true, "items" to JSONArray(listOf(conversationJson(1, snippet = "…预发布…"), json("id" to "broken"))),
                "facets" to json("agent" to JSONArray(listOf(json("key" to "codex", "count" to 6))))),
            "inbox" to json("total" to 2, "names" to json("lark" to "飞书", "mail" to ""),
                "items" to JSONArray(listOf(json("id" to 5, "title" to "x", "snippet" to "s"), json("title" to "no id")))),
            "tasks" to json("failed" to true, "total" to 0, "items" to JSONArray()))
        val answer = SearchAnswer.parse(raw)
        assertEquals(7, answer.sessions!!.total)
        assertEquals(listOf("issue:1"), answer.sessions.items.map { it.row.id })
        assertEquals("…预发布…", answer.sessions.items.single().snippet)
        assertEquals("codex", answer.sessions.facets?.get("agent")?.single()?.key)
        assertEquals(6, answer.sessions.facets?.get("agent")?.single()?.count)
        assertTrue(answer.indexing)
        assertEquals(1, answer.inbox!!.items.size)
        assertEquals(mapOf("lark" to "飞书"), answer.sources)
        assertTrue(answer.tasks!!.failed)
        assertFalse("one place that answered is enough to show", answer.failedEverywhere)
        // A place that was not asked for is nothing; every place that was asked failing is the page's error.
        val one = SearchAnswer.parse(json("outcome" to "success", "tasks" to json("failed" to true, "total" to 0, "items" to JSONArray())))
        assertNull(one.sessions)
        assertTrue(one.failedEverywhere)
        assertFalse(SearchAnswer.parse(json("outcome" to "success")).failedEverywhere)
    }

    @Test fun aRangePageNarrowsItsRowsByTheChoicesMadeOnIt() {
        val hits = listOf(SessionHit(conversation(1), null), SessionHit(conversation(2, agent = "codex"), "…"), SessionHit(conversation(3, project = "desktop"), null))
        val agent = BoardFilters().toggle(BoardFilterField.Agent, "claude")
        assertEquals(listOf("issue:1", "issue:3"), narrowSessions(hits, agent).map { it.row.id })
        assertEquals(listOf("issue:3"), narrowSessions(hits, agent.toggle(BoardFilterField.Project, "desktop")).map { it.row.id })
        assertEquals(hits, narrowSessions(hits, BoardFilters()))
        val tasks = listOf(task("a", "active", "claude"), task("b", "paused", "dudu"), task("c", "ended", "claude"))
        assertEquals(listOf("a", "c"), narrowTasks(tasks, SearchFilters(taskAgents = setOf("claude"))).map { it.getString("id") })
        assertEquals(listOf("c"), narrowTasks(tasks, SearchFilters(taskStatuses = setOf("ended"), taskAgents = setOf("claude"))).map { it.getString("id") })
        assertEquals(tasks, narrowTasks(tasks, SearchFilters()))
    }

    @Test fun theComputerIsAskedForWordsAndForARecordsOrTasksRangeAsSoonAsItIsPicked() {
        assertFalse(SearchKey("", null).asks)
        assertTrue(SearchKey("预发布", null).asks)
        // The conversations are the board's own rows, which the phone has: not asked for without words. The records and the tasks are the computer's, and are asked for as soon as the range is
        // picked, with no words and no choice: what 来源 and the tasks' 智能体 offer is in that answer.
        assertFalse(SearchKey("", SearchRange.Sessions).asks)
        assertTrue(SearchKey("", SearchRange.Inbox).asks)
        assertTrue(SearchKey("", SearchRange.Tasks).asks)
        val bare = SearchKey("", SearchRange.Inbox).params()
        assertEquals("", bare.getString("q"))
        assertEquals("inbox", bare.getString("scope"))
        assertFalse(bare.has("state") || bare.has("connector"))
        val all = SearchKey("预发布", null).params()
        assertEquals("预发布", all.getString("q"))
        assertEquals(20, all.getInt("limit"))
        assertFalse(all.has("scope"))
        val records = SearchKey("", SearchRange.Inbox, "done", setOf("mail", "lark")).params()
        assertEquals("inbox", records.getString("scope"))
        assertEquals(100, records.getInt("limit"))
        assertEquals("done", records.getString("state"))
        assertEquals(listOf("lark", "mail"), (0 until 2).map { records.getJSONArray("connector").getString(it) })
        // 状态 and 来源 are the records' alone.
        val tasks = SearchKey("x", SearchRange.Tasks, "todo", setOf("lark")).params()
        assertFalse(tasks.has("state") || tasks.has("connector"))
        assertEquals(0, tasks.getJSONObject("filters").length())
        val sessions = SearchUi(query = "x", range = SearchRange.Sessions, filters = SearchFilters(
            sessions = BoardFilters().toggle(BoardFilterField.Agent, "codex").toggle(BoardFilterField.Project, null),
        )).key.params().getJSONObject("filters")
        assertEquals("codex", sessions.getJSONArray("agent").getString(0))
        assertTrue(sessions.getJSONArray("project").isNull(0))
    }

    @Test fun theAnswerShownIsTheOneToTheWordsAskedAndAPickedRangeStartsFromTheAnswerOfAll() {
        val all = SearchAnswer(null, null, null, false, emptyMap())
        val ui = SearchUi(query = "预发布", answer = all, answered = SearchKey("预发布", null))
        assertSame(all, ui.shown)
        assertSame("spaces around the words are nothing", all, ui.copy(query = " 预发布 ").shown)
        assertSame("a range picked after the words has its first rows in the answer of all", all, ui.copy(range = SearchRange.Sessions).shown)
        assertNull(ui.copy(query = "迁移").shown)
        assertNull("a choice of the records is another request", ui.copy(range = SearchRange.Inbox, filters = SearchFilters(inboxState = "done")).shown)
        assertNull(ui.copy(range = null, answered = SearchKey("预发布", SearchRange.Sessions)).shown)
        assertNull(SearchUi(query = "预发布").shown)
    }

    @Test fun wordsTypedInQuickSuccessionAreAskedForOnceAndARangeAsksAtOnceWithItsOwnChoices() = runTest {
        val asked = mutableListOf<JSONObject>()
        val search = SearchModel(this, { 1 }, StandardTestDispatcher(testScheduler)) { asked += it; answerJson(sessions = 3) }
        search.type("预"); advanceTimeBy(100); search.type("预发"); advanceTimeBy(100); search.type("预发布")
        advanceTimeBy(200); runCurrent()
        assertEquals("nothing is asked before the keys have stopped", 0, asked.size)
        advanceTimeBy(100); runCurrent()
        assertEquals(1, asked.size)
        assertEquals("预发布", asked.single().getString("q"))
        assertEquals(SearchKey("预发布", null), search.state.value.answered)
        assertFalse(search.state.value.loading)
        assertEquals(3, search.state.value.shown!!.sessions!!.total)
        // A space at the end asks nothing new; a range asks at once, for its own place and as many rows as there are.
        search.type("预发布 "); advanceTimeBy(1000); runCurrent()
        assertEquals(1, asked.size)
        search.pick(SearchRange.Inbox); runCurrent()
        assertEquals(2, asked.size)
        assertEquals("inbox", asked[1].getString("scope"))
        assertEquals(100, asked[1].getInt("limit"))
        search.change { it.copy(inboxState = "done") }; runCurrent()
        assertEquals("done", asked[2].getString("state"))
        // Tasks fetch their agents before a filter is selected. A selection asks the computer for the filtered page.
        search.pick(null); search.type(""); search.pick(SearchRange.Tasks); runCurrent()
        assertFalse(search.state.value.filters.any(SearchRange.Inbox))
        assertEquals(4, asked.size)
        assertEquals("tasks", asked[3].getString("scope"))
        assertEquals("", asked[3].getString("q"))
        assertEquals(SearchKey("", SearchRange.Tasks), search.state.value.answered)
        search.change { it.copy(taskStatuses = setOf("active")) }; runCurrent()
        assertEquals(5, asked.size)
        assertEquals("active", asked[4].getJSONObject("filters").getJSONArray("status").getString(0))
        search.pick(SearchRange.Sessions); runCurrent()
        assertEquals("keyword-free conversations use the local board", 5, asked.size)
    }

    @Test fun aRecordsRangePickedWithNothingTypedAsksAtOnceAndKeepsItsAnswerForTheChoicesItOffers() = runTest {
        val asked = mutableListOf<JSONObject>()
        val search = SearchModel(this, { 1 }, StandardTestDispatcher(testScheduler)) {
            asked += it
            json("outcome" to "success", "inbox" to json("total" to 1, "names" to json("lark" to "飞书"), "items" to JSONArray(listOf(json("id" to 5, "title" to "x")))))
        }
        search.pick(SearchRange.Inbox); runCurrent()
        assertEquals(1, asked.size)
        assertEquals("", asked.single().getString("q"))
        // The answer is there for the pill 来源 to offer from; the page shows no rows for it until a word or a choice.
        assertEquals(mapOf("lark" to "飞书"), search.state.value.shown!!.sources)
        // A choice of 来源 is another request, and the names stay in the last answer meanwhile.
        search.change { it.copy(sources = setOf("lark")) }
        assertNull(search.state.value.shown)
        assertEquals(mapOf("lark" to "飞书"), search.state.value.answer!!.sources)
        runCurrent()
        assertEquals(listOf("lark"), (0 until 1).map { asked[1].getJSONArray("connector").getString(it) })
        assertEquals(mapOf("lark" to "飞书"), search.state.value.shown!!.sources)
    }

    @Test fun afterWordsTheBodyIsNeverBlank() = runTest {
        // Every combination of what the page may have: rows, an answer to what is asked now, a failure. The page draws a gap in all of them, or the rows.
        for (rows in listOf(0, 2)) for (answered in listOf(false, true)) for (failure in listOf(null, "UPSTREAM_UNAVAILABLE")) {
            val gap = searchGap(rows, answered, failure)
            assertEquals(rows > 0, gap == SearchGap.None)
            if (rows == 0) assertTrue("$answered $failure", gap in listOf(SearchGap.Loading, SearchGap.Nothing, SearchGap.Failure))
        }
        assertEquals(SearchGap.Loading, searchGap(0, answered = false, failure = null))
        assertEquals(SearchGap.Nothing, searchGap(0, answered = true, failure = null))
        assertEquals(SearchGap.Failure, searchGap(0, answered = false, failure = "CONNECTION_FAILED"))
        // The three frames the iPhone left blank. The first word typed, before the request has gone out: a spinner.
        val asked = mutableListOf<String>()
        val replies = mutableListOf<CompletableDeferred<JSONObject>>()
        val search = SearchModel(this, { 1 }, StandardTestDispatcher(testScheduler)) { params ->
            asked += params.getString("q")
            CompletableDeferred<JSONObject>().also { replies += it }.await()
        }
        fun gap() = search.state.value.let { ui -> searchGap(0, answered = ui.shown != null, failure = ui.failure) }
        search.type("预")
        assertEquals(0, asked.size)
        assertEquals(SearchGap.Loading, gap())
        advanceTimeBy(300); runCurrent()
        assertEquals(SearchGap.Loading, gap())
        // An answer to the words, with no rows in it: 没有匹配的内容, also while the conversations' words are still being indexed and the page asks again.
        replies[0].complete(answerJson(sessions = 0, indexing = true)); runCurrent()
        assertEquals(SearchGap.Nothing, gap())
        advanceTimeBy(2100); runCurrent()
        assertEquals(2, asked.size)
        assertFalse("an indexing read shows no spinner", search.state.value.loading)
        assertEquals(SearchGap.Nothing, gap())
        // New words while the old answer is still there and the new request is on its way: the old answer is not an answer to them, so the spinner, not an empty page.
        search.type("预发布"); runCurrent()
        assertNotNull(search.state.value.answer)
        assertNull(search.state.value.shown)
        assertEquals(SearchGap.Loading, gap())
        advanceTimeBy(300); runCurrent()
        replies.last().complete(answerJson(sessions = 0)); runCurrent()
        assertEquals(SearchGap.Nothing, gap())
    }

    @Test fun backOnThePageAsksTheSameWordsAgainWithoutASignOfItAndKeepsWhatIsThereWhenItFails() = runTest {
        var rows = 1
        var failing = false
        val asked = mutableListOf<JSONObject>()
        val search = SearchModel(this, { 1 }, StandardTestDispatcher(testScheduler)) {
            asked += it
            if (failing) throw ApiFailure("CONNECTION_FAILED")
            json("outcome" to "success", "sessions" to json("total" to rows, "items" to JSONArray((1..rows).map { n -> conversationJson(n) })))
        }
        search.refresh(); runCurrent()
        assertEquals("nothing is asked when there is nothing on the page", 0, asked.size)
        search.type("预发布"); advanceTimeBy(300); runCurrent()
        val first = search.state.value.answer
        assertEquals(1, first!!.sessions!!.items.size)
        // The page comes back: asked again at once, with no spinner and with the rows still shown while it is on its way; the new answer takes their place.
        rows = 2
        val states = mutableListOf<SearchUi>()
        search.refresh()
        states += search.state.value
        assertFalse(states.single().loading)
        assertSame(first, states.single().shown)
        runCurrent()
        assertEquals(2, asked.size)
        assertEquals(asked[0].toString(), asked[1].toString())
        assertEquals(2, search.state.value.shown!!.sessions!!.items.size)
        // A read that cannot be made says nothing and leaves the rows.
        failing = true
        val kept = search.state.value.answer
        search.refresh(); runCurrent()
        assertEquals(3, asked.size)
        assertSame(kept, search.state.value.answer)
        assertNull(search.state.value.failure)
        assertFalse(search.state.value.loading)
        // One that is already on its way is not asked twice.
        failing = false
        search.pick(SearchRange.Sessions); search.refresh(); runCurrent()
        assertEquals(4, asked.size)
    }

    @Test fun theBackOfAConversationOpenedFromTheSearchPageGoesToTheSearchPageAndNotToTheBoard() {
        val search = Route("search")
        val trail = ConversationTrail()
        // Opened from the board: nothing is left, back is the board.
        assertNull(trail.origin)
        assertFalse(trail.returnsToConversation)
        // Opened from the search page (a result, or 常用): the page it was opened from is what back ends on.
        trail.push(ConversationReturn(null, null, null, false, null, search, emptyList()))
        assertSame(search, trail.origin)
        assertFalse(trail.returnsToConversation)
        // A conversation opened from inside it: back goes to that conversation first, and the search page stays the origin all the way.
        trail.push(ConversationReturn("s1", "Issue 1", 1, false, null, null, emptyList()))
        assertTrue(trail.returnsToConversation)
        assertSame(search, trail.origin)
        assertEquals("Issue 1", trail.pop()!!.title)
        assertFalse(trail.returnsToConversation)
        val back = trail.pop()!!
        assertSame("the route that comes back as the current one", search, back.route)
        assertNull(trail.origin)
        trail.push(ConversationReturn(null, null, null, false, null, search, emptyList()))
        trail.clear()
        assertNull(trail.origin)
        assertNull(trail.pop())
    }

    @Test fun aSlowAnswerToOldWordsNeverReplacesTheNewOnesAndWhileTheWordsAreIndexedThePageAsksAgain() = runTest {
        val replies = mutableListOf<Pair<String, CompletableDeferred<JSONObject>>>()
        val search = SearchModel(this, { 1 }, StandardTestDispatcher(testScheduler)) { params ->
            val reply = CompletableDeferred<JSONObject>()
            replies += params.getString("q") to reply
            reply.await()
        }
        search.type("a"); advanceTimeBy(300); runCurrent()
        assertEquals(listOf("a"), replies.map { it.first })
        assertTrue(search.state.value.loading)
        search.type("ab"); advanceTimeBy(300); runCurrent()
        replies[0].second.complete(answerJson(sessions = 1))
        runCurrent()
        assertNull("the answer to the words that were left is thrown away", search.state.value.answered)
        replies[1].second.complete(answerJson(sessions = 2, indexing = true))
        runCurrent()
        assertEquals(SearchKey("ab", null), search.state.value.answered)
        assertEquals(2, search.state.value.shown!!.sessions!!.total)
        // Still being indexed: asked again two seconds later, and again until it is done.
        advanceTimeBy(2100); runCurrent()
        assertEquals(listOf("a", "ab", "ab"), replies.map { it.first })
        replies[2].second.complete(answerJson(sessions = 5))
        runCurrent()
        assertEquals(5, search.state.value.shown!!.sessions!!.total)
        advanceTimeBy(10_000); runCurrent()
        assertEquals(3, replies.size)
    }

    @Test fun aFailureIsTheCodeOfWhatWentWrongAndAnEmptyPageAsksNothing() = runTest {
        var failing = true
        var refusing = false
        var asks = 0
        val search = SearchModel(this, { 1 }, StandardTestDispatcher(testScheduler)) {
            asks++
            if (failing) throw ApiFailure("UNSUPPORTED")
            if (refusing) json("outcome" to "error", "code" to "unavailable")
            else json("outcome" to "success", "tasks" to json("failed" to true, "total" to 0, "items" to JSONArray()))
        }
        search.type("x"); advanceTimeBy(300); runCurrent()
        assertEquals("UNSUPPORTED", search.state.value.failure)
        assertFalse(search.state.value.loading)
        // 重试 asks again; every place that was asked failing is told as the computer being unreachable.
        failing = false
        search.retry(); runCurrent()
        assertEquals("UPSTREAM_UNAVAILABLE", search.state.value.failure)
        assertEquals(2, asks)
        // An answer that is the computer's refusal, not rows, is the page's failure with the computer's code.
        refusing = true
        search.retry(); runCurrent()
        assertEquals("unavailable", search.state.value.failure)
        search.reset(); runCurrent()
        assertEquals(SearchUi(), search.state.value)
        search.type("   "); advanceTimeBy(1000); runCurrent()
        assertEquals(3, asks)
    }
}
