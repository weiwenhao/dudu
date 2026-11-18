package app.dudu.android.data

import org.json.JSONObject

/** One message of a conversation record with what its place in the talk needs: whether its day starts here, whether the sender is named before it. */
data class TalkLine(val day: String, val time: String, val from: String?, val text: String,
    val startsDay: Boolean, val showsName: Boolean)

/**
 * The messages of a conversation record (`record.messages` of the plugin's `inbox.get`: `[{ at: "MM-DD HH:mm", from, text }]`, only for a record that is a conversation) as the lines of a talk
 * (owner, 2026-11-18, the inbox redesign): the day is written where it changes, the sender where it changes (and first on a day).
 */
fun talkLines(messages: List<JSONObject>): List<TalkLine> {
    var previous: TalkLine? = null
    return messages.map { message ->
        val before = previous
        val at = message.optString("at")
        val from = message.nullableString("from")
        val day = at.take(5)
        val startsDay = before == null || before.day != day
        TalkLine(day, at.drop(6), from, message.optString("text"), startsDay,
            from != null && (before == null || startsDay || before.from != from)).also { previous = it }
    }
}

/**
 * The tab a record is in, from the record itself (the plugin's own rule, `inbox/store.mjs`): one an issue holds, or that the owner marked handled, is "done", and the rest wait ("todo").
 * The record in full has no `status`.
 */
fun recordTab(record: JSONObject): String =
    if (record.optJSONObject("issue") != null || record.optBoolean("done")) "done" else "todo"
