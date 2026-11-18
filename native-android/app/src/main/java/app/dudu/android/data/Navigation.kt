package app.dudu.android.data

import org.json.JSONObject

data class SidebarNavigation(val primary: List<JSONObject>, val additional: List<JSONObject>)

/** The registry owns the destinations; the same primary/group contract as the iPhone owns their disclosure. */
fun sidebarNavigation(navigation: JSONObject): SidebarNavigation {
    val items = navigation.rows("sidebar").filterNot {
        it.optJSONObject("open")?.optString("native") == "assistant"
    }
    val (primary, additional) = items.partition {
        val open = it.optJSONObject("open")
        it.optString("group") == "primary" || open?.optString("native") in listOf("board", "collector") ||
            open?.optString("native") == "schedule" &&
            (it.optString("id") == "dudu.tasks" || open.optString("target") == "dudu-tasks")
    }
    return SidebarNavigation(primary, additional)
}
