package app.dudu.android.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * The search page's logic (owner, 2026-11-27: Lark's search on the iPhone, Android and Desktop; the drawings are `.local/designs/phone-search-2026-11-27/`), with nothing of the screen in it.
 * The computer answers one request, `search.query` (`host/assistant/home/search.mjs`): the conversations, the records of the inbox and the scheduled tasks that hold the words, each in the
 * rows of its own page. What is here reads that answer, remembers what was searched for and opened, finds the words to colour, and narrows the rows a range page shows.
 */

/** The three places the page looks, as the computer names them (`scope`). */
enum class SearchRange(val wire: String) { Sessions("sessions"), Inbox("inbox"), Tasks("tasks") }

/**
 * What the page remembers on this phone, for one computer (the conversations are its own): the words searched for, newest first, and when each conversation was opened, which is how 常用 is
 * ordered. Kept in the vault as `search-<computer id>`, like the board's filter.
 */
data class SearchMemory(val history: List<String> = emptyList(), val opened: Map<String, Long> = emptyMap()) {
    /** The words were searched for (the keyboard's search key, or a result was opened from them): first in the history, once, at most twelve kept. */
    fun searched(words: String): SearchMemory {
        val phrase = words.trim().replace(Regex("\\s+"), " ").take(MAX_WORDS)
        if (phrase.isEmpty()) return this
        return copy(history = (listOf(phrase) + history.filterNot { it.equals(phrase, ignoreCase = true) }).take(HISTORY))
    }

    fun withoutHistory() = copy(history = emptyList())

    /** The conversation was opened now. Only the two hundred opened last are kept. */
    fun open(id: String, at: Long): SearchMemory {
        val next = opened + (id to at)
        return copy(opened = if (next.size <= OPENED) next else next.entries.sortedByDescending { it.value }.take(OPENED).associate { it.key to it.value })
    }

    /**
     * 常用: every conversation of the board (not only the ones in progress), the one opened last first, and the ones never opened after them in the list's own order; the first `limit`.
     */
    fun frequent(rows: List<Conversation>, limit: Int = FREQUENT): List<Conversation> =
        rows.withIndex().sortedWith(compareByDescending<IndexedValue<Conversation>> { opened[it.value.id] ?: Long.MIN_VALUE }.thenBy { it.index })
            .take(limit).map { it.value }

    fun saved(): String = JSONObject().put("history", JSONArray(history)).put("opened", JSONObject(opened.mapValues { it.value })).toString()

    companion object {
        const val HISTORY = 12
        const val FREQUENT = 6
        private const val OPENED = 200
        private const val MAX_WORDS = 200

        /** What was kept, read back; anything unreadable is nothing remembered. */
        fun parse(text: String): SearchMemory = runCatching {
            val saved = JSONObject(text)
            val words = saved.optJSONArray("history")?.let { list -> (0 until minOf(list.length(), HISTORY)).map(list::optString) }.orEmpty()
                .filter { it.isNotBlank() }.distinctBy { it.lowercase() }
            val times = saved.optJSONObject("opened")?.let { map -> map.keys().asSequence().mapNotNull { key -> map.optLong(key, -1).takeIf { it >= 0 }?.let { key to it } }.toMap() }.orEmpty()
            SearchMemory(words, times)
        }.getOrDefault(SearchMemory())
    }
}

/** The words of what was typed that a result colours: split at the spaces, the longest first so that a short one never cuts a long one in two. */
fun searchTerms(phrase: String): List<String> =
    phrase.trim().split(Regex("\\s+")).filter(String::isNotEmpty).distinct().sortedByDescending(String::length)

/** Where the words are in a text, ignoring case: the stretches to colour, in order, none touching or overlapping another. */
fun matchRanges(text: String, terms: List<String>): List<IntRange> {
    if (text.isEmpty() || terms.isEmpty()) return emptyList()
    val found = mutableListOf<IntRange>()
    for (term in terms) {
        var from = 0
        while (from <= text.length - term.length) {
            val at = text.indexOf(term, from, ignoreCase = true)
            if (at < 0) break
            found += at until at + term.length
            from = at + term.length
        }
    }
    val merged = mutableListOf<IntRange>()
    for (range in found.sortedBy { it.first }) {
        val last = merged.lastOrNull()
        if (last != null && range.first <= last.last + 1) merged[merged.lastIndex] = last.first..maxOf(last.last, range.last)
        else merged += range
    }
    return merged
}

/** A conversation the search found, with the line of its text that matched when the words are in the text and not in the title. */
data class SessionHit(val row: Conversation, val snippet: String?)

/** One place's answer: how many matched in all, the rows it sent (at most the limit asked for), and `failed` when the computer could not look there (the other places are still answered). */
data class SearchGroup<T>(val total: Int, val items: List<T>, val failed: Boolean = false)

/**
 * The answer of `search.query`. A place that was not asked for is null. `indexing` says the conversations' text is still being indexed (the page asks again until it is done), `sources`
 * is every collector's name by id (what the 来源 choice offers).
 */
class SearchAnswer(
    val sessions: SearchGroup<SessionHit>?, val inbox: SearchGroup<JSONObject>?, val tasks: SearchGroup<JSONObject>?,
    val indexing: Boolean, val sources: Map<String, String>,
) {
    private val asked get() = listOfNotNull(sessions, inbox, tasks)

    /** Every place that was asked could not be read: the page says so, with 重试. One that did is shown whatever the others did. */
    val failedEverywhere: Boolean get() = asked.isNotEmpty() && asked.all { it.failed }

    companion object {
        fun parse(o: JSONObject): SearchAnswer {
            fun <T> group(key: String, item: (JSONObject) -> T?): SearchGroup<T>? {
                val place = o.optJSONObject(key) ?: return null
                // A row this build cannot read is left out; the others are shown.
                val items = place.optJSONArray("items")?.let { list -> (0 until list.length()).mapNotNull { index -> list.optJSONObject(index)?.let { runCatching { item(it) }.getOrNull() } } }.orEmpty()
                return SearchGroup(place.optInt("total", items.size), items, place.optBoolean("failed"))
            }
            val sessions = group("sessions") { SessionHit(Conversation.parse(it), it.nullableString("snippet")) }
            val inbox = group("inbox") { it.also { card -> card.getLong("id") } }
            val tasks = group("tasks") { it.also { task -> task.getString("id") } }
            val sources = o.optJSONObject("inbox")?.optJSONObject("names")?.let { names ->
                names.keys().asSequence().associateWith { names.optString(it) }.filterValues(String::isNotEmpty)
            }.orEmpty()
            return SearchAnswer(sessions, inbox, tasks, o.optJSONObject("sessions")?.optBoolean("indexing") == true, sources)
        }
    }
}

/**
 * What a range page narrows its rows by. The conversations' choices are the board's own (`BoardFilters`: 智能体, 项目 and 更新时间 are the ones the page offers), applied here to the rows that
 * came; the records' (状态, 来源) go to the computer with the request; the tasks' (状态, 智能体) are applied here to the tasks that came.
 */
data class SearchFilters(
    val sessions: BoardFilters = BoardFilters(),
    /** `todo` (待处理) or `done` (已处理); null is both. */
    val inboxState: String? = null,
    /** The collectors' ids. */
    val sources: Set<String> = emptySet(),
    val taskStatuses: Set<String> = emptySet(),
    val taskAgents: Set<String?> = emptySet(),
) {
    fun any(range: SearchRange): Boolean = when (range) {
        SearchRange.Sessions -> !sessions.isEmpty
        SearchRange.Inbox -> inboxState != null || sources.isNotEmpty()
        SearchRange.Tasks -> taskStatuses.isNotEmpty() || taskAgents.isNotEmpty()
    }
}

/**
 * What a results page shows when it has no rows to show. Never nothing (owner, 2026-11-27, on the iPhone's blank page): after words or a choice the page is its rows, or 没有匹配的内容, or a
 * spinner while the answer is on its way; a failure is the line with 重试 (above whatever else there is). `answered` is whether the page has an answer to what it is asked now (an old answer to
 * other words is not one: the spinner stays until the new one is here), `rows` how many it would draw, the first words typed included, before any request has gone out.
 */
enum class SearchGap { None, Loading, Nothing, Failure }

fun searchGap(rows: Int, answered: Boolean, failure: String?): SearchGap = when {
    rows > 0 -> SearchGap.None
    failure != null -> SearchGap.Failure
    !answered -> SearchGap.Loading
    else -> SearchGap.Nothing
}

/** The conversations of a range page narrowed by the board's own filter, in the order they came. */
fun narrowSessions(hits: List<SessionHit>, filters: BoardFilters): List<SessionHit> {
    if (filters.isEmpty) return hits
    val kept = filters.matching(hits.map { it.row }).map(Conversation::id).toSet()
    return hits.filter { it.row.id in kept }
}

/** The tasks of the range page narrowed by the choices of 状态 and 智能体. */
fun narrowTasks(tasks: List<JSONObject>, filters: SearchFilters): List<JSONObject> = tasks.filter { task ->
    (filters.taskStatuses.isEmpty() || task.optString("status") in filters.taskStatuses) &&
        (filters.taskAgents.isEmpty() || task.nullableString("agent") in filters.taskAgents)
}
