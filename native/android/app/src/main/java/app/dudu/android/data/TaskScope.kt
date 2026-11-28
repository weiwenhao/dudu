package app.dudu.android.data

import org.json.JSONObject

/**
 * The 任务 list is not for the tasks a conversation made for itself with its cron tools (owner, 2026-11-26): the plugin records where a task was made from (`origin`), and those are in that conversation's own list,
 * which reads all of them. A task made before the plugin recorded an origin has none, and is listed.
 */
fun taskIsListed(task: JSONObject): Boolean = task.optString("origin") != "session"

fun taskBelongsToSession(task: JSONObject, sessionId: String): Boolean =
    when (task.optJSONObject("target")?.optString("mode")) {
        "existing" -> task.optJSONObject("target")?.optString("sessionId") == sessionId
        "reuse" -> task.optString("sessionId") == sessionId
        else -> false
    }
