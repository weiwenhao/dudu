package app.dudu.android

import app.dudu.android.data.*
import org.junit.Assert.*
import org.junit.Test

class SidebarListTest {
    @Test fun archiveChoicesExcludeBlankSessionsAndKeepPinRankAheadOfRecency() {
        val sessions = listOf(
            json("id" to "new", "updatedAt" to 100),
            json("id" to "old-pin", "pinned" to true, "pinRank" to 2, "updatedAt" to 90),
            json("id" to "latest-pin", "pinned" to true, "pinRank" to 1, "updatedAt" to 1),
            json("id" to "archived", "archived" to true, "updatedAt" to 110),
            json("id" to "blank", "blank" to true, "updatedAt" to 120),
            json("id" to "archived-blank", "blank" to true, "archived" to true, "updatedAt" to 130),
        )
        fun ids(filter: SidebarArchiveFilter) = sidebarEntries(sessions, emptyList(),
            SidebarOptions(SidebarGrouping.Flat, filter)).map { (it as SidebarEntry.Session).value.getString("id") }
        assertEquals(listOf("latest-pin", "old-pin", "new"), ids(SidebarArchiveFilter.Hide))
        assertEquals(listOf("latest-pin", "old-pin", "archived", "new"), ids(SidebarArchiveFilter.All))
        assertEquals(listOf("archived"), ids(SidebarArchiveFilter.Only))
    }

    @Test fun workspaceGroupsIncludeEmptyRegisteredWorkspacesAndFoldOrphanSessionsTogether() {
        val workspaces = listOf(json("id" to "empty"), json("id" to "known"))
        val sessions = listOf(json("id" to "a", "workspaceId" to "known"),
            json("id" to "b", "workspaceId" to "deleted"), json("id" to "c"),
            json("id" to "archived", "workspaceId" to "known", "archived" to true))
        val defaults = sidebarEntries(sessions, workspaces, SidebarOptions.parse(json()), setOf("ungrouped"))
        assertEquals(listOf("group:empty", "group:known", "session:a", "group:ungrouped"), defaults.map { it.id })
        assertTrue((defaults.last() as SidebarEntry.Group).collapsed)
        assertEquals(listOf("group:known", "session:archived"), sidebarEntries(sessions, workspaces,
            SidebarOptions(archive = SidebarArchiveFilter.Only)).map { it.id })
        val unfolded = sidebarEntries(sessions, workspaces, SidebarOptions())
        assertEquals(listOf("session:b", "session:c"), unfolded.takeLast(2).map { it.id })
    }
}
