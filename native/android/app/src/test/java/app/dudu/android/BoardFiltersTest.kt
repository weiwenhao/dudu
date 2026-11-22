package app.dudu.android

import app.dudu.android.data.*
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class BoardFiltersTest {
    @Test fun aKeptFilterComesBackAsItWasChosen() {
        val chosen = BoardFilters().toggle(BoardFilterField.Project, null).toggle(BoardFilterField.Project, "mobile")
            .toggle(BoardFilterField.Label, "12").toggle(BoardFilterField.Due, "today")
        assertEquals(chosen, BoardFilters.parse(chosen.saved()))
        // A field this build does not know, or a date choice that is not one of the field's own, is dropped; anything unreadable is no filter.
        val kept = BoardFilters.parse("""{"sessionState":["unread"],"mood":["happy"],"created":["year"]}""")
        assertEquals(BoardFilters().toggle(BoardFilterField.SessionState, "unread"), kept)
        assertTrue(BoardFilters.parse("not json").isEmpty)
    }

    @Test fun scopesAndCombinedFiltersUseOneSnapshotAndKeepThePinOrder() {
        val rows = listOf(
            row(1, "in_progress", project = "mobile", label = 12, state = "unread", source = "connector"),
            row(2, "in_review", project = "desktop", label = 12, state = "unread", source = "connector"),
            row(3, "todo", project = "mobile", label = 9, state = "processing", source = "owner"),
            row(4, "backlog", project = "mobile", label = 12, state = "unread", source = "connector"),
            row(5, "done", project = "desktop", label = 12, state = "idle", source = "owner"),
            json("id" to "assistant", "title" to "Dudu", "receivedAt" to 0, "unread" to false,
                "sessionState" to "idle", "readSeq" to -1, "pinned" to true),
        )
        val home = Home.parse(json("outcome" to "success", "tab" to "all", "conversations" to JSONArray(rows),
            "pins" to JSONArray(listOf("assistant", "issue:4", "issue:1")), "unreadCount" to 3,
            "statuses" to JSONArray(listOf(json("id" to "custom-in_progress", "type" to "in_progress", "name" to "Reviewing")))),
            Scope.All)
        val active = home.rows.filter(Scope.Active::includes)
        assertEquals(listOf("issue:1", "issue:2", "issue:3", "assistant"), active.map(Conversation::id))
        // 未读 keeps every unread conversation whatever its workflow (the backlog one included), and nothing that is read.
        assertEquals(listOf("issue:1", "issue:2", "issue:4"), home.rows.filter(Scope.Unread::includes).map(Conversation::id))
        assertEquals("Reviewing", home.statuses.single().name)

        val filters = BoardFilters().toggle(BoardFilterField.Project, "mobile")
            .toggle(BoardFilterField.Project, "desktop").toggle(BoardFilterField.Label, "12")
            .toggle(BoardFilterField.SessionState, "unread").toggle(BoardFilterField.Source, "connector")
        assertEquals(listOf("issue:1", "issue:2"), filters.matching(active).map(Conversation::id))
        assertEquals(listOf("assistant", "issue:4", "issue:1"), home.pinnedRows.map(Conversation::id))
        assertEquals(mapOf("mobile" to 1, "desktop" to 1, null to 0),
            filters.options(BoardFilterField.Project, active, home.statuses).associate { it.key to it.count })
        assertEquals(3, home.unreadCount)
        assertEquals("The visible scope excludes unpinned backlog and completed rows", 2, unreadSessionCount(active))
        assertEquals("A pinned copy counts once and the pinned shelf stays outside the filters",
            3, unreadSessionCount(filters.matching(active) + home.pinnedRows))
        val doneUnread = Conversation.parse(row(7, "done", state = "unread"))
        assertEquals(2, unreadSessionCount((home.rows + doneUnread).filter(Scope.Active::includes)))
        assertEquals(0, unreadSessionCount(listOf(home.rows.first().copy(sessionId = null))))
    }

    @Test fun dueDatesRespectTheLocalDayAndUpdatesUseTheCompletedReplyTime() {
        val zone = ZoneId.of("America/New_York")
        val now = millis("2026-11-01T05:30:00Z")
        val previousReply = millis("2026-10-31T04:59:59Z")
        val rows = listOf(
            Conversation.parse(row(1, "todo", due = millis("2026-11-02T04:59:59Z"), received = previousReply)),
            Conversation.parse(row(2, "todo", due = millis("2026-11-02T05:00:00Z"), received = now)),
            Conversation.parse(row(3, "todo", received = now)),
        )
        val due = BoardFilters().toggle(BoardFilterField.Due, "today")
        assertEquals(listOf("issue:1"), due.matching(rows, now = now, zone = zone).map(Conversation::id))
        assertTrue(due.toggle(BoardFilterField.Updated, "day").matching(rows, now = now, zone = zone).isEmpty())
        val nextWeek = due.toggle(BoardFilterField.Due, "next7").toggle(BoardFilterField.Updated, "day")
        assertEquals(listOf("issue:2"), nextWeek.matching(rows, now = now, zone = zone).map(Conversation::id))
    }

    private fun millis(value: String) = Instant.parse(value).toEpochMilli()

    private fun row(
        id: Int, type: String, project: String? = null, label: Int = 12, state: String = "idle",
        source: String = "owner", due: Long? = null, received: Long = 0,
    ) = json("id" to "issue:$id", "title" to "Issue $id", "receivedAt" to received,
        "sessionId" to "s$id", "sessionState" to state, "readSeq" to 0, "unread" to (state == "unread"),
        "pinned" to (id == 1 || id == 4),
        "issue" to json("id" to id, "title" to "Issue $id", "status" to "custom-$type", "statusType" to type,
            "project" to project, "source" to source, "dueAt" to due, "updatedAt" to millis("2026-11-01T06:00:00Z"),
            "labels" to JSONArray(listOf(json("id" to label, "name" to "Label $label", "color" to "red")))),
    )
}
