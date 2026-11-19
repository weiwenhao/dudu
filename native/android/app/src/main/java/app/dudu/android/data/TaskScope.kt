package app.dudu.android.data

import org.json.JSONObject

fun taskBelongsToSession(task: JSONObject, sessionId: String): Boolean =
    when (task.optJSONObject("target")?.optString("mode")) {
        "existing" -> task.optJSONObject("target")?.optString("sessionId") == sessionId
        "reuse" -> task.optString("sessionId") == sessionId
        else -> false
    }
