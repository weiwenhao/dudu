package app.dudu.android.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Filling in a record's context (`inbox.complete`), the iPhone's `CollectorModel.complete` / `follow`: the record is marked at once, before the request goes; the collector's session does the work on the
 * computer in the background (ten seconds to a few minutes), so the record is read again every three seconds until the computer says it is over, for four minutes at most (the desktop's
 * `ui/collector/completion.js` does the same). What it came to is in the record; a failure is kept in `problems` (the plugin's own words, or "" when it gave none) for the record in full to say, or for
 * the list's toast when that record is not open. A new connection forgets them: the completions ran on the other computer.
 */
class InboxCompletions(
    private val scope: CoroutineScope,
    private val connection: () -> Int,
    private val request: suspend (String, JSONObject) -> JSONObject,
    /** Says a failure of a record that is not open (the iPhone's list toast): the plugin's words, or "" for the app's own. */
    private val report: (String) -> Unit,
) {
    private val completingFlow = MutableStateFlow<Set<Long>>(emptySet())
    /** The records whose context is being filled in and which this phone waits for: their rows and buttons show it, and cannot ask again. */
    val completing = completingFlow.asStateFlow()
    private val problemsFlow = MutableStateFlow<Map<Long, String>>(emptyMap())
    /** Why a completion failed: the plugin's words, or "" (the app then says 更改没能保存). */
    val problems = problemsFlow.asStateFlow()
    private val followers = mutableMapOf<Long, Job>()
    private var generation = connection()
    /** The records shown in full now (a sheet and a page may both show one): they say their failure themselves. */
    private val shown = mutableMapOf<Long, Int>()

    /** A record in full appears (`true`) or goes: while it is there its failure is kept for it, and once it goes the failure it said is forgotten. */
    fun shown(id: Long, visible: Boolean) {
        val count = (shown[id] ?: 0) + if (visible) 1 else -1
        if (count > 0) shown[id] = count else { shown.remove(id); clearProblem(id) }
    }

    /** Ask for the context of the record and wait for the end. */
    fun complete(id: Long) = follow(id, asking = true)

    /** A record the computer says is being completed already (one opened in the middle of it): wait for its end in the same way, without asking again. */
    fun follow(id: Long) = follow(id, asking = false)

    /** A failure that has been said (by the record in full, or by the list's toast) is not said again. */
    fun clearProblem(id: Long) {
        if (id in problemsFlow.value) problemsFlow.value = problemsFlow.value - id
    }

    private fun checkpoint() {
        if (generation == connection()) return
        generation = connection()
        followers.values.forEach { it.cancel() }
        followers.clear()
        completingFlow.value = emptySet()
        problemsFlow.value = emptyMap()
    }

    private fun follow(id: Long, asking: Boolean) {
        checkpoint()
        if (id in completingFlow.value) return
        completingFlow.value = completingFlow.value + id
        problemsFlow.value = problemsFlow.value - id
        val current = generation
        DuduLog.record("inbox.complete.begin", state = if (asking) "ask" else "follow")
        followers[id] = scope.launch {
            val problem = waitForEnd(id, asking, current)
            if (current != connection() || current != generation) return@launch
            followers.remove(id)
            // The failure is in before the mark goes, so that the record in full sees both at once; a record that is not open says it by the toast.
            if (problem != null) {
                if (id in shown) problemsFlow.value = problemsFlow.value + (id to problem) else report(problem)
            }
            completingFlow.value = completingFlow.value - id
            DuduLog.record("inbox.complete.end", state = if (problem == null) "done" else "failed")
        }
    }

    /** Nil when it went well or the waiting stopped; otherwise why it failed ("" when nothing was said, as a wait still not over after four minutes). */
    private suspend fun waitForEnd(id: Long, asking: Boolean, current: Int): String? {
        if (asking) {
            var started = false
            try { started = request("inbox.complete", json("id" to id)).optBoolean("started") }
            catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("inbox.complete.fail", error)
            }
            // Not started (the plugin is busy, or its answer did not come): one may be running all the same, begun on the desktop say. The record tells.
            if (!started && detail(id)?.optBoolean("completing") != true) return ""
        }
        val since = System.nanoTime()
        while (true) {
            delay(3_000)
            if (current != connection()) return null
            // A reading that says it is over is believed even when it comes late.
            detail(id)?.let { record ->
                if (!record.optBoolean("completing")) return record.nullableString("completeError")?.takeIf(String::isNotEmpty)
            }
            if (System.nanoTime() - since >= 240_000_000_000L) return ""
        }
    }

    private suspend fun detail(id: Long): JSONObject? = try {
        request("inbox.get", json("id" to id)).optJSONObject("record")
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        DuduLog.failure("inbox.get.fail", error)
        null
    }
}
