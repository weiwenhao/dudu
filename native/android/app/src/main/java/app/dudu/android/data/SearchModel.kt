package app.dudu.android.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import kotlin.coroutines.CoroutineContext

/** The words, range and filter selections that identify one request. */
data class SearchKey(
    val phrase: String,
    val range: SearchRange?,
    val state: String? = null,
    val sources: Set<String> = emptySet(),
    val filters: Map<String, Set<String?>> = emptyMap(),
) {
    /**
     * Whether the computer is asked. Words always are. 收件箱 and 任务 are as soon as they are picked, with no words and no choice, because what their pills offer (来源, the tasks' 智能体) is
     * in the answer (the page shows no rows for it until there is a word or a choice). 会话 never is without words: its rows are the board's own, which the phone has.
     */
    val asks: Boolean get() = phrase.isNotEmpty() || range == SearchRange.Inbox || range == SearchRange.Tasks

    /** All three places answer with a few rows each (the page shows three of each); one place alone, as many as the computer sends. */
    fun params(): JSONObject = json("q" to phrase, "limit" to if (range == null) 20 else 100).apply {
        range?.let { put("scope", it.wire) }
        if (range == SearchRange.Inbox) {
            state?.let { put("state", it) }
            if (sources.isNotEmpty()) put("connector", JSONArray(sources.sorted()))
        }
        if (range == SearchRange.Sessions || range == SearchRange.Tasks) {
            put("filters", JSONObject(filters.mapValues { (_, keys) -> JSONArray(keys.map { it ?: JSONObject.NULL }) }))
        }
    }
}

/**
 * What the page shows. `answer` is what the computer last said, to the request `answered` (null before the first); `loading` is a request for the present words and choices on its way;
 * `failure` is the code of why the last one could not be read.
 */
data class SearchUi(
    val query: String = "",
    val range: SearchRange? = null,
    val filters: SearchFilters = SearchFilters(),
    val answer: SearchAnswer? = null,
    val answered: SearchKey? = null,
    val loading: Boolean = false,
    val failure: String? = null,
) {
    val key: SearchKey
        get() = SearchKey(query.trim(), range, if (range == SearchRange.Inbox) filters.inboxState else null,
            if (range == SearchRange.Inbox) filters.sources else emptySet(), filters.forRequest(range))

    /** Choices from the previous scope answer stay available while new filter selections are on their way. */
    val answerForPhrase: SearchAnswer?
        get() = answer.takeIf { answered?.phrase == key.phrase }

    /**
     * The answer that goes with what is asked now: the one to the same request, or, for a range picked after the words were typed, the answer of all three places to those words, which
     * has that place's first rows already (the range's own, longer one comes after it). Nothing when the last answer was to other words.
     */
    val shown: SearchAnswer?
        get() {
            val was = answered ?: return null
            val now = key
            return if (was == now || was.phrase == now.phrase && was.range == null && now.range != null
                && now.state == null && now.sources.isEmpty() && now.filters.isEmpty()) answer else null
        }
}

/**
 * The search page's model (the iPhone's search page asks the same): it holds what was typed and chosen, so that the page is as it was left when a conversation opened from it is closed, and
 * asks the computer for the rows, the latest request winning. The words are asked for 250 ms after the last key; a range or a choice, at once. While the conversations' words are still being
 * indexed the page asks again every two seconds, so that their rows come as they are found.
 */
class SearchModel(
    private val scope: CoroutineScope,
    private val connection: () -> Int,
    /** Where an answer is read (off the main thread; a test passes its own). */
    private val parsing: CoroutineContext = Dispatchers.Default,
    private val ask: suspend (JSONObject) -> JSONObject,
) {
    private val flow = MutableStateFlow(SearchUi())
    val state = flow.asStateFlow()
    private var job: Job? = null
    private var revision = 0

    fun type(text: String) {
        val before = flow.value.key
        flow.update { it.copy(query = text.take(MAX_QUERY)) }
        // A space typed or deleted at the end of the words asks for nothing new.
        if (flow.value.key != before) restart(debounce = true)
    }

    /** A range's pill (or, null, the cross on it): its own choices start empty. */
    fun pick(range: SearchRange?) {
        flow.update { it.copy(range = range, filters = SearchFilters()) }
        restart(debounce = false)
    }

    /** A choice on a range page is sent immediately when it changes the request. */
    fun change(update: (SearchFilters) -> SearchFilters) {
        val before = flow.value.key
        flow.update { it.copy(filters = update(it.filters)) }
        if (flow.value.key != before) restart(debounce = false)
    }

    fun retry() = restart(debounce = false)

    /**
     * The page is in front again after a conversation was closed (the rows may have changed: a red dot, a time): the same words are asked again without a sign of it. There is no spinner and
     * what is on the page stays until the answer is here; an answer that could not be read, or a failure, leaves the page as it was. Nothing is asked when there is no answer to these words yet,
     * or one is on its way.
     */
    fun refresh() {
        val ui = flow.value
        if (!ui.key.asks || ui.answered != ui.key || ui.loading || job?.isActive == true) return
        restart(debounce = false, quiet = true)
    }

    /** Back to the empty page, nothing asked. */
    fun reset() {
        job?.cancel()
        revision++
        flow.value = SearchUi()
    }

    private fun restart(debounce: Boolean, quiet: Boolean = false) {
        job?.cancel()
        val mine = ++revision
        val ui = flow.value
        val key = ui.key
        if (!key.asks) {
            flow.update { it.copy(loading = false, failure = null) }
            return
        }
        val computer = connection()
        if (!quiet) flow.update { it.copy(loading = true, failure = null) }
        job = scope.launch {
            if (debounce) delay(DEBOUNCE_MS)
            val began = System.nanoTime()
            try {
                while (true) {
                    val raw = ask(key.params())
                    // The computer refused the request (its own `outcome` and `code`): that is the page's failure, not an answer without rows.
                    if (raw.optString("outcome", "success") != "success") throw ApiFailure(raw.optString("code").ifEmpty { "PROTOCOL_ERROR" })
                    val answer = withContext(parsing) { SearchAnswer.parse(raw) }
                    if (mine != revision || computer != connection()) return@launch
                    // A silent read that finds nothing readable keeps what the page has.
                    if (!(quiet && answer.failedEverywhere)) flow.update { it.copy(answer = answer, answered = key, loading = false, failure = if (answer.failedEverywhere) "UPSTREAM_UNAVAILABLE" else null) }
                    DuduLog.record("search.answer", method = "search.query", elapsedMs = (System.nanoTime() - began) / 1_000_000,
                        state = if (answer.failedEverywhere) "failed" else if (answer.indexing) "indexing" else "ready",
                        counts = mapOf("rowCount" to ((answer.sessions?.items?.size ?: 0) + (answer.inbox?.items?.size ?: 0) + (answer.tasks?.items?.size ?: 0)).toLong()))
                    if (!answer.indexing) break
                    delay(INDEXING_MS)
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("search.fail", error, method = "search.query", elapsedMs = (System.nanoTime() - began) / 1_000_000)
                if (mine == revision && !quiet) flow.update { it.copy(loading = false, failure = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED") }
            }
        }
    }

    private companion object {
        const val MAX_QUERY = 200
        const val DEBOUNCE_MS = 250L
        const val INDEXING_MS = 2000L
    }
}
