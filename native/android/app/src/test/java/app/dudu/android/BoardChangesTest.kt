package app.dudu.android

import app.dudu.android.data.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BoardChangesTest {
    @Test fun onlyBoardIssueAndSessionsTopicsSayTheBoardChanged() {
        listOf("board.changed", "issue.updated", "sessions.changed").forEach { assertTrue(it, BoardChanges.says(it)) }
        listOf("notification", "session.snapshot", "boardwalk").forEach { assertFalse(it, BoardChanges.says(it)) }
    }

    @Test fun theBoardOfAComputerKeepsTheNameOlderBuildsWroteItUnder() {
        // The app and the background service share this name; changing it would drop the board that people already have on their phone.
        assertEquals("home-mac-all", BoardChanges.cacheName("mac"))
        assertEquals("home-mac-active", BoardChanges.cacheName("mac", Scope.Active))
    }

    private fun row(id: String, unread: Boolean = false, pinned: Boolean = false, state: String = "idle") =
        Conversation(id, id, "session-$id", null, "", 0, state, unread, 0, pinned)

    @Test fun aFailedPinRestoresOnlyItsRowAndItsPlaceInTheShelf() {
        val before = Home(listOf(row("a", pinned = true), row("b", pinned = true), row("c")), listOf("a", "b"), 0)
        val unpinned = BoardChanges.pinned(before, "a", false)
        assertEquals(listOf("b"), unpinned.pins)
        assertEquals(listOf("b"), unpinned.pinnedRows.map(Conversation::id))
        // Meanwhile another row was pinned and confirmed: the rollback keeps it.
        val other = BoardChanges.pinned(unpinned, "c", true)
        val restored = BoardChanges.restore(other, before, "a")
        assertEquals(listOf("a", "b", "c"), restored.pins)
        assertEquals(true, restored.rows.first { it.id == "a" }.pinned)
        assertEquals(true, restored.rows.first { it.id == "c" }.pinned)
    }

    @Test fun aReadMarkKeepsTheWorkingMarkAndRollsBackToTheOldDot() {
        val before = Home(listOf(row("a", unread = true, state = "unread"), row("b", unread = false, state = "processing")), emptyList(), 1)
        val read = BoardChanges.read(before, "a", false)
        assertEquals("idle", read.rows[0].sessionState)
        assertEquals(false, read.rows[0].unread)
        val marked = BoardChanges.read(read, "b", true)
        assertEquals("processing", marked.rows[1].sessionState)
        assertEquals(true, marked.rows[1].unread)
        val restored = BoardChanges.restore(marked, before, "a")
        assertEquals("unread", restored.rows[0].sessionState)
        assertEquals(true, restored.rows[0].unread)
        assertEquals(true, restored.rows[1].unread)
        // A row that was never pinned stays out of the shelf.
        assertEquals(emptyList<String>(), restored.pins)
    }
}
