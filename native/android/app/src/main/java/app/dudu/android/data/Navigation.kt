package app.dudu.android.data

import app.dudu.android.Route
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

/** The same registry contract opens a destination and identifies its selected sidebar row. */
fun navigationRoute(item: JSONObject, sessionId: String? = null): Route? {
    val open = item.optJSONObject("open") ?: return null
    val title = item.optString("title")
    fun webRoute(): Route? {
        val web = open.optJSONObject("web") ?: return null
        return if (web.optString("page") == "dudu")
            Route("settings", title, web.nullableString("target") ?: "general")
        else Route("web", title, web.nullableString("target"),
            json("page" to web.getString("page"), "sessionId" to sessionId))
    }
    return when (open.optString("native")) {
        "board", "assistant" -> null
        "chat" -> Route("sessions", title)
        "collector" -> Route("collector", title)
        "dudu-settings" -> Route("settings", title, open.optString("target", "general"))
        "dsh-settings" -> Route("navigation", title, "settings")
        "schedule" -> if (item.optString("id") == "dudu.tasks" || open.optString("target") == "dudu-tasks")
            Route("tasks", title) else webRoute()
        "files" -> Route("files", title)
        else -> webRoute()
    }
}

fun Route.isSheet(conversationOpen: Boolean): Boolean =
    name in setOf("preferences", "settings", "about", "computers", "computer", "subissues", "task", "issue", "record") ||
        name == "files" && params.optBoolean("file") ||
        conversationOpen && name in setOf("activity", "session-tasks", "delivered-files", "tool", "changes", "diff")

/** A sheet covers its page without changing which destination the drawer selects. */
fun pageRoute(current: Route?, history: List<Route>, conversationOpen: Boolean): Route? =
    if (current?.isSheet(conversationOpen) == true) history.lastOrNull { !it.isSheet(conversationOpen) } else current

fun sidebarItemSelected(item: JSONObject, page: Route?, conversationOpen: Boolean): Boolean {
    if (item.optJSONObject("open")?.optString("native") == "board") return page == null && !conversationOpen
    val expected = navigationRoute(item) ?: return false
    if (page == null || page.name != expected.name) return false
    return when (expected.name) {
        "web" -> page.target == expected.target && page.params.optString("page") == expected.params.optString("page")
        "settings", "navigation" -> page.target == expected.target
        else -> true
    }
}
