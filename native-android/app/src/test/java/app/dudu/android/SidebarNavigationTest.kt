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
}
