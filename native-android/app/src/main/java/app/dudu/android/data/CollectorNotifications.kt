package app.dudu.android.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

data class CollectorNotificationChoice(val on: Boolean, val saving: Boolean, val revision: Long)

/** Immediate bell feedback, independent of a settings page's loading and navigation. */
class CollectorNotifications(
    private val scope: CoroutineScope,
    private val connection: () -> Int,
    private val save: suspend (JSONObject) -> Unit,
) {
    private val mutable = MutableStateFlow<Map<String, CollectorNotificationChoice>>(emptyMap())
    val state = mutable.asStateFlow()
    private var generation = connection()
    private var revision = 0L

    fun checkpoint(): Long {
        if (generation != connection()) {
            generation = connection()
            revision++
            mutable.value = emptyMap()
        }
        return revision
    }

    /** Only a read started after a completed save can replace its local confirmation. */
    fun receive(readRevision: Long) {
        checkpoint()
        mutable.value = mutable.value.filterValues { it.saving || it.revision > readRevision }
    }

    fun set(id: String, original: Boolean, on: Boolean, body: JSONObject, failed: (String) -> Unit) {
        checkpoint()
        val previous = mutable.value[id]
        mutable.value = mutable.value + (id to CollectorNotificationChoice(on, true, ++revision))
        if (previous?.saving == true) return
        val current = generation
        scope.launch {
            var confirmed = previous?.on ?: original
            try {
                while (current == connection()) {
                    val desired = mutable.value[id]?.on ?: return@launch
                    try {
                        save(JSONObject(body.toString()).put("value", desired.toString()))
                        if (current != connection()) return@launch
                        confirmed = desired
                        if (mutable.value[id]?.on == desired) return@launch
                    } catch (error: Exception) {
                        if (error is CancellationException) throw error
                        if (current != connection()) return@launch
                        if (mutable.value[id]?.on != desired) continue
                        failed((error as? ApiFailure)?.code ?: "CONNECTION_FAILED")
                        return@launch
                    }
                }
            } finally {
                if (current == generation && current == connection()) {
                    mutable.value = mutable.value +
                        (id to CollectorNotificationChoice(confirmed, false, ++revision))
                }
            }
        }
    }
}
