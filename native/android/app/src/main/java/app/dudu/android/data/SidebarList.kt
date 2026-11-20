package app.dudu.android.data

import org.json.JSONObject

enum class SidebarGrouping(val wire: String) { Workspace("workspace"), Flat("flat") }
enum class SidebarArchiveFilter(val wire: String) { Hide("hide"), All("all"), Only("only") }

data class SidebarOptions(
    val grouping: SidebarGrouping = SidebarGrouping.Workspace,
    val archive: SidebarArchiveFilter = SidebarArchiveFilter.Hide,
) {
    companion object {
        fun parse(preferences: JSONObject) = SidebarOptions(
            SidebarGrouping.entries.find { it.wire == preferences.optString("sidebar.grouping") } ?: SidebarGrouping.Workspace,
            SidebarArchiveFilter.entries.find { it.wire == preferences.optString("sidebar.archive") } ?: SidebarArchiveFilter.Hide,
        )
    }
}

sealed interface SidebarEntry {
    val id: String

    data class Group(val workspaceId: String, val workspace: JSONObject?, val collapsed: Boolean) : SidebarEntry {
        override val id = "group:$workspaceId"
    }
    data class Session(val value: JSONObject) : SidebarEntry {
        override val id = "session:${value.getString("id")}"
    }
}

/** The iPhone's SidebarList: blank conversations stay hidden; pins lead each group; unknown workspaces go last. */
fun sidebarEntries(
    sessions: List<JSONObject>,
    workspaces: List<JSONObject>,
    options: SidebarOptions,
    collapsed: Set<String> = emptySet(),
): List<SidebarEntry> {
    val shown = sessions.filter { !it.optBoolean("blank") && when (options.archive) {
        SidebarArchiveFilter.Hide -> !it.optBoolean("archived")
        SidebarArchiveFilter.All -> true
        SidebarArchiveFilter.Only -> it.optBoolean("archived")
    } }
    fun ordered(rows: List<JSONObject>) = rows.filter { it.optBoolean("pinned") }.sortedBy { it.optDouble("pinRank", 0.0) } +
        rows.filterNot { it.optBoolean("pinned") }.sortedByDescending { it.optLong("updatedAt") }
    if (options.grouping == SidebarGrouping.Flat) return ordered(shown).map(SidebarEntry::Session)

    val known = workspaces.mapTo(mutableSetOf()) { it.getString("id") }
    val byWorkspace = shown.groupBy { it.optString("workspaceId").takeIf(known::contains) ?: "ungrouped" }
    return buildList {
        fun group(id: String, workspace: JSONObject?, rows: List<JSONObject>) {
            val folded = id in collapsed
            add(SidebarEntry.Group(id, workspace, folded))
            if (!folded) addAll(ordered(rows).map(SidebarEntry::Session))
        }
        for (workspace in workspaces) {
            val id = workspace.getString("id")
            val rows = byWorkspace[id].orEmpty()
            if (options.archive != SidebarArchiveFilter.Only || rows.isNotEmpty()) group(id, workspace, rows)
        }
        byWorkspace["ungrouped"]?.takeIf { it.isNotEmpty() }?.let { group("ungrouped", null, it) }
    }
}
