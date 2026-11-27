package app.dudu.android.data

import app.dudu.android.Route
import org.json.JSONObject

/** What was on screen when a conversation was opened over it: the conversation (when it was one) or, when it was a page, that page's route and the routes behind it; where the back of the new one goes. */
internal data class ConversationReturn(val id: String?, val title: String?, val issue: Long?,
    val assistant: Boolean, val subagent: JSONObject?, val route: Route?, val routes: List<Route>)

/**
 * Where the back of the conversation on screen goes (the model's `conversationBack`). A conversation opened from the board leaves nothing here (the board is where back goes); one opened from a page
 * (the search page, a list) leaves that page's route, which `leaveConversation` puts back as the current one; one opened from inside a conversation leaves that conversation, and back goes to it first.
 */
internal class ConversationTrail {
    private val entries = mutableListOf<ConversationReturn>()

    fun push(entry: ConversationReturn) { entries.add(entry) }
    fun pop(): ConversationReturn? = entries.removeLastOrNull()
    fun clear() = entries.clear()

    /** The page the conversation on screen started from, null when it started from the board: the search page stays composed under it, and is what back ends on. */
    val origin: Route? get() = entries.firstOrNull()?.takeIf { it.title == null }?.route

    /** Back goes to another conversation (this one was opened from inside it), not yet to `origin`. */
    val returnsToConversation: Boolean get() = entries.lastOrNull()?.title != null
}
