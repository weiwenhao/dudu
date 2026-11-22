package app.dudu.android

import app.dudu.android.data.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class SidebarNavigationTest {
    @Test fun registryFeaturesStayAdditionalWhileOwnedAndOlderNativeEntriesStayPrimary() {
        fun entry(id: String, native: String? = null, group: String? = null) =
            json("id" to id, "group" to group, "open" to json("native" to native))
        val navigation = sidebarNavigation(json("sidebar" to JSONArray(listOf(
            entry("dudu.board", "board"), entry("dudu.collector", "collector"), entry("dudu.tasks", "schedule"),
            entry("assistant", "assistant", "primary"), entry("plugins"), entry("schedules", "schedule"),
            entry("insight"), entry("extension", group = "primary"),
        ))))
        assertEquals(listOf("dudu.board", "dudu.collector", "dudu.tasks", "extension"), navigation.primary.map { it.getString("id") })
        assertEquals(listOf("plugins", "schedules", "insight"), navigation.additional.map { it.getString("id") })
    }

    @Test fun selectedDestinationFollowsThePageUnderSheetsAndDoesNotMistakeAConversationForBoard() {
        val board = json("open" to json("native" to "board"))
        val inbox = json("open" to json("native" to "collector"))
        val tasks = json("id" to "dudu.tasks", "open" to json("native" to "schedule"))
        assertTrue(sidebarItemSelected(board, null, false))
        assertFalse(sidebarItemSelected(board, null, true))
        // The settings' pages are pages of their own now (2026-11-22); an issue's sheet still covers the page under it.
        val page = pageRoute(Route("issue", target = "5"), listOf(Route("collector"), Route("record", target = "17")), false)
        assertTrue(sidebarItemSelected(inbox, page, false))
        assertFalse(sidebarItemSelected(board, page, false))
        assertFalse(sidebarItemSelected(tasks, page, false))
        assertTrue(sidebarItemSelected(tasks, pageRoute(Route("task", target = "23"), listOf(Route("tasks")), true), true))
    }

    @Test fun registryOpeningAndSelectionDistinguishNativeAndEmbeddedPages() {
        val tasks = json("id" to "dudu.tasks", "open" to json("native" to "schedule",
            "web" to json("page" to "schedule")))
        // DSH's own schedule list has no page on the phone (the iPhone says 手机端暂不支持); a page the phone has stands in for it here.
        val schedules = json("id" to "schedule", "open" to json("native" to "schedule",
            "web" to json("page" to "plugins")))
        val insight = json("id" to "insight", "open" to json("web" to json("page" to "insight")))
        assertNull(navigationRoute(insight))
        val schedulePage = navigationRoute(schedules, "session")!!
        assertEquals("tasks", navigationRoute(tasks)?.name)
        assertEquals("session", schedulePage.params.getString("sessionId"))
        assertTrue(sidebarItemSelected(schedules, schedulePage, false))
        assertFalse(sidebarItemSelected(insight, schedulePage, false))
        assertFalse(sidebarItemSelected(tasks, schedulePage, false))
    }
}
