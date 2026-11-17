package app.dudu.android.data

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

enum class Scope(val wire: String) { Active("active"), Backlog("backlog"), All("all") }

data class Project(val name: String, val path: String?) {
    fun json() = json("name" to name, "path" to path)
}
data class Status(val id: String, val name: String?, val type: String, val isDefault: Boolean,
    val color: String? = null, val iconProgress: Float? = null)
data class Label(val id: Long, val name: String, val color: String? = null)
data class Options(val statuses: List<Status>, val projects: List<Project>, val labels: List<Label>,
    val agents: List<String>, val attachments: Boolean = false)
data class Issue(
    val id: Long, val ref: String?, val title: String, val agent: String?, val status: String,
    val statusType: String, val priority: String, val project: Project?, val description: String,
    val parent: String?, val subTotal: Int, val subDone: Int,
    val dueAt: Long? = null, val labelIds: Set<Long> = emptySet(),
) {
    companion object {
        fun parse(o: JSONObject): Issue {
            val p = o.optJSONObject("projectInfo")
            return Issue(o.getLong("id"), o.nullableString("ref"), o.getString("title"),
                o.nullableString("agent"), o.getString("status"), o.optString("statusType"),
                o.optString("priority", "none"), p?.let { Project(it.getString("name"), it.nullableString("path")) }
                    ?: o.nullableString("project")?.let { Project(it, null) },
                o.optString("description"), o.optJSONObject("parent")?.optString("title"),
                o.optJSONObject("subIssues")?.optInt("total") ?: 0,
                o.optJSONObject("subIssues")?.optInt("done") ?: 0,
                if (o.isNull("dueAt")) null else o.getLong("dueAt"),
                o.optJSONArray("labels")?.objects()?.map { it.getLong("id") }?.toSet().orEmpty())
        }
    }
}
data class Conversation(
    val id: String, val title: String, val sessionId: String?, val issue: Issue?, val preview: String,
    val receivedAt: Long, val sessionState: String, val unread: Boolean, val readSeq: Long, val pinned: Boolean,
) {
    companion object {
        fun parse(o: JSONObject) = Conversation(
            o.getString("id"), o.getString("title"), o.nullableString("sessionId"),
            o.optJSONObject("issue")?.let(Issue::parse), plainPreview(o.optString("preview")),
            o.getLong("receivedAt"), o.getString("sessionState"), o.getBoolean("unread"),
            o.getLong("readSeq"), o.getBoolean("pinned"),
        )
    }
}
data class Home(val rows: List<Conversation>, val pins: List<String>, val unreadCount: Int) {
    companion object {
        fun parse(o: JSONObject, scope: Scope): Home {
            require(o.getString("outcome") == "success" && o.getString("tab") == scope.wire)
            val rows = o.getJSONArray("conversations").objects().map(Conversation::parse)
                .filter { scope != Scope.Backlog || it.id != "assistant" }
            require(rows.map { it.id }.distinct().size == rows.size)
            val pins = o.getJSONArray("pins")
            return Home(rows, (0 until pins.length()).map(pins::getString), o.getInt("unreadCount"))
        }
    }
}
data class Message(val id: String, val role: String, val text: String, val streaming: Boolean,
    val requestId: String? = null, val reasoning: String = "", val attachments: List<JSONObject> = emptyList(),
    val raw: JSONObject = json(), val pending: Boolean = false)
data class Session(
    val id: String, val watchId: String, val messages: List<Message>, val queue: List<Message>,
    val readPosition: JSONObject?, val state: String, val canceledRequestIds: Set<String> = emptySet(),
    val raw: JSONObject = json(), val cached: Boolean = false,
) {
    val transcript get() = raw.optJSONObject("transcript")
    val processing get() = state in listOf("running", "processing") ||
        raw.optJSONObject("session")?.optString("status") == "running"
    fun observed(requestId: String) = requestId in canceledRequestIds ||
        (messages + queue).any { it.id == requestId || it.requestId == requestId }

    fun visibleMessages(pending: Message?): List<Message> {
        return visibleMessages(listOfNotNull(pending))
    }

    fun visibleMessages(pending: List<Message>): List<Message> {
        val seen = mutableSetOf<String>()
        val waiting = (queue + pending).filter {
            it.id !in canceledRequestIds && it.requestId !in canceledRequestIds
        }
        return (messages + waiting).filter { seen.add(it.requestId ?: it.id) }
    }

    companion object {
        fun parse(o: JSONObject, watchId: String, previous: Session? = null, cached: Boolean = false): Session {
            val raw = o.copyJson()
            raw.optJSONObject("transcript")?.let {
                raw.put("transcript", mergeTranscript(previous?.takeIf { it.id == o.getJSONObject("session").getString("id") }?.transcript, it))
            }
            fun messages(array: JSONArray?) = array?.objects()?.map {
                Message(it.getString("id"), it.optString("role", "user"), it.optString("text"),
                    it.optString("status") == "streaming", it.nullableString("requestId"),
                    it.optString("reasoning"), it.rows("attachments"), it)
            } ?: emptyList()
            val transcript = raw.optJSONObject("transcript")
            val entries = transcript?.rows("entries")?.map {
                Message(it.getString("id"), it.optString("type"), it.optString("text"), false,
                    it.nullableString("requestId"), it.optString("reasoning"), it.rows("attachments"), it)
            }
            val live = transcript?.optJSONObject("live")?.let {
                Message(it.getString("id"), "assistant", it.optString("text"), true,
                    reasoning = it.optString("reasoning"), raw = it)
            }
            return Session(o.getJSONObject("session").getString("id"), watchId,
                entries?.plus(listOfNotNull(live)) ?: messages(o.optJSONArray("messages")),
                messages(o.optJSONArray("queuedMessages")) + messages(transcript?.optJSONArray("pendingInputs")),
                o.optJSONObject("readPosition"), o.getJSONObject("session").optString("state",
                    o.getJSONObject("session").optString("status")),
                o.optJSONArray("canceledRequestIds")?.let { array ->
                    (0 until array.length()).map(array::getString).toSet()
                } ?: emptySet(), raw, cached)
        }
    }
}

fun json(vararg entries: Pair<String, Any?>) = JSONObject().apply {
    entries.forEach { (key, value) -> put(key, value ?: JSONObject.NULL) }
}
fun JSONObject.nullableString(key: String) =
    if (isNull(key)) null else optString(key).takeIf(String::isNotEmpty)
fun JSONArray.objects() = (0 until length()).map(::getJSONObject)

fun initials(title: String): String {
    val value = title.trim()
    Regex("^[A-Za-z0-9]+").find(value)?.value?.let {
        return (if (it.length <= 3) it else it.take(2)).uppercase(Locale.ROOT)
    }
    Regex("^\\p{IsHan}{1,2}").find(value)?.let { return it.value }
    return String(value.codePoints().limit(2).toArray(), 0, minOf(value.codePointCount(0, value.length), 2))
}

fun avatarTone(title: String): Int {
    var hash = 0L
    title.codePoints().forEach { hash = (hash * 31 + it) and 0xffffffffL }
    return (hash % 7).toInt()
}

fun plainPreview(value: String): String = value
    .replace(Regex("!\\[[^]]*]\\([^)]*\\)"), "［图片］")
    .replace(Regex("\\[([^]]+)]\\([^)]*\\)"), "$1")
    .replace(Regex("```[\\s\\S]*?```")) { it.value.removePrefix("```").removeSuffix("```") }
    .replace(Regex("[*`#>_~]"), "")
    .replace(Regex("\\s+"), " ").trim()
