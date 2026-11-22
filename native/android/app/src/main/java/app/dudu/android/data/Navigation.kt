package app.dudu.android.data

import app.dudu.android.Route
import org.json.JSONObject

data class SidebarNavigation(val primary: List<JSONObject>, val additional: List<JSONObject>)

enum class HomeTab(val routeName: String?) {
    Board(null), Inbox("collector"), Tasks("tasks"), Settings("preferences");

    companion object {
        fun forRoute(route: Route) = entries.firstOrNull { it.routeName == route.name }
    }
}

/** The registry owns the destinations; the same primary/group contract as the iPhone owns their disclosure. */
/** The destinations the bottom bar has (看板, 收件箱, 任务): the drawer leaves them out (owner, 2026-11-21: "很多按键的地方都重复了"). */
fun isBarDestination(item: JSONObject): Boolean {
    val open = item.optJSONObject("open")
    return open?.optString("native") in listOf("board", "collector", "assistant") ||
        open?.optString("native") == "schedule" && (item.optString("id") == "dudu.tasks" || open.optString("target") == "dudu-tasks")
}

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
        // A page this app cannot show (the iPhone's `EmbeddedDSHPage` has no such case): the drawer says so instead (`DuduViewModel.navigateItem`).
        if (web.optString("page") !in embeddedPages) return null
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

/**
 * Whether a route covers its page as a sheet. The settings' own pages (嘟嘟's seven and their pages, 电脑连接, a computer, 关于) are full pages pushed over the 设置 tab with the bottom bar
 * hidden, as on the iPhone (owner, 2026-11-22); the pairing form is a sheet when the guide or a pairing link opens it (`sheet`), a page when 电脑连接's + does.
 */
fun Route.isSheet(conversationOpen: Boolean): Boolean =
    name in setOf("preferences", "subissues", "task", "issue", "record") ||
        name == "pair" && params.optBoolean("sheet") ||
        name == "files" && params.optBoolean("file") ||
        conversationOpen && name in setOf("activity", "session-tasks", "delivered-files", "tool", "changes", "diff")

/** The pages of DSH (and of the plugin) the phone shows embedded, the iPhone's `EmbeddedDSHPage`. */
val embeddedPages = setOf("plugins", "trace", "context", "team", "tools", "settings", "panel", "view", "dudu")

/** The pages of one conversation (the iPhone's `needsSession`): they open on the conversation on screen, and need one. */
fun embeddedPageNeedsSession(page: String) = page in setOf("trace", "context", "team", "tools", "view")

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
