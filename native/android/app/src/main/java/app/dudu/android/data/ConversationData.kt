package app.dudu.android.data

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.security.MessageDigest
import java.util.UUID

fun storageKey(prefix: String, computer: String, id: String) = prefix + "-" +
    MessageDigest.getInstance("SHA-256").digest("$computer:$id".toByteArray())
        .joinToString("") { "%02x".format(it) }
fun JSONObject.rows(key: String) = optJSONArray(key)?.objects().orEmpty()
fun JSONObject.copyJson() = JSONObject(toString())

data class SavedComputer(val id: String, val name: String, val link: String, val addressesEdited: Boolean = false) {
    fun json() = json("id" to id, "name" to name, "link" to link, "addressesEdited" to addressesEdited)
    companion object {
        fun parse(o: JSONObject) = SavedComputer(o.getString("id"), o.getString("name"), o.getString("link"), o.optBoolean("addressesEdited"))
    }
}

internal fun List<SavedComputer>.updating(computer: SavedComputer): List<SavedComputer> {
    val index = indexOfFirst { it.id == computer.id }
    if (index < 0) return this + computer
    return filterNot { it.id == computer.id }.toMutableList().apply { add(index, computer) }
}

data class Outgoing(
    val requestId: String, val text: String, val attachments: List<JSONObject>,
    val accepted: Boolean = false, val failed: Boolean = false,
    /**
     * Sent while the agent was running: it waits in the queue's panel from the moment of sending, as the iPhone places it (`AcceptedSubmission.Placement.queued`), and not as a message of the
     * history that moves into the panel when the computer's answer arrives (owner, 2026-11-21: "排队消息会先出现在屏幕上，然后再回到排队消息，有个闪动的过程").
     */
    val queued: Boolean = false,
) {
    fun json() = json("requestId" to requestId, "text" to text,
        "attachments" to JSONArray(attachments), "accepted" to accepted, "failed" to failed, "queued" to queued)
    fun message() = Message(requestId, "user", text, false, requestId,
        attachments = attachments.mapIndexed { index, file ->
            // A staged video is a video on its way, named by its receipt: the phone kept it under that id (the iPhone's `AcceptedSubmission.attachments`).
            val video = !file.has("dataBase64") && file.has("receiptId") &&
                app.dudu.android.media.VideoPreviewStorage.isVideo(file.optString("name"))
            json("kind" to if (file.has("dataBase64")) "image" else if (video) "video" else "file",
                "name" to file.optString("name"), "id" to if (video) file.getString("receiptId") else "$requestId:$index",
                "dataBase64" to file.nullableString("dataBase64"))
        }, pending = true)
    /** The row the panel shows until the computer's own queue names this input: no actions, as it has no item of the computer's to act on yet. */
    fun queuedMessage() = message().copy(id = "submission:$requestId", raw = json("editable" to false, "optimistic" to true))
    companion object {
        fun parse(o: JSONObject) = Outgoing(o.getString("requestId"), o.optString("text"),
            o.rows("attachments"), o.optBoolean("accepted"), o.optBoolean("failed"), o.optBoolean("queued"))
    }
}

/** A cached tail never contains actionable prompts or proof that its content was read. */
fun cachedSession(raw: JSONObject): JSONObject = raw.copyJson().apply {
    remove("questions"); remove("approvals"); remove("readPosition"); remove("queuedMessages")
    optJSONObject("session")?.put("state", "idle")?.put("status", "idle")
    optJSONObject("transcript")?.apply { remove("live"); remove("pendingInputs") }
}

/** Keep older loaded pages; replace the authoritative tail and resolve references by ID. */
fun mergeTranscript(old: JSONObject?, fresh: JSONObject): JSONObject {
    if (old == null) return fresh
    if (fresh.optLong("throughSeq", Long.MAX_VALUE) < old.optLong("throughSeq", Long.MIN_VALUE))
        return mergeTranscript(fresh, old)
    val result = fresh.copyJson()
    val boundary = fresh.optLong("beforeSeq",
        fresh.rows("entries").map { it.optLong("seq", Long.MAX_VALUE) }.minOrNull() ?: 0)
    val prefix = old.rows("entries").filter { it.optLong("seq", boundary) < boundary }
    fun hidden(o: JSONObject) = o.optJSONArray("hidden")?.let { a -> (0 until a.length()).map { a.get(it).toString() } }.orEmpty()
    val hidden = (hidden(old) + hidden(fresh)).toSet()
    result.put("entries", JSONArray((prefix + fresh.rows("entries")).distinctBy { it.optString("id") }
        .filter { it.optString("id") !in hidden && it.optLong("seq", -1).toString() !in hidden }))
    val tools = old.optJSONObject("tools")?.copyJson() ?: json()
    fresh.optJSONObject("tools")?.let { next -> next.keys().forEach { tools.put(it, next.get(it)) } }
    result.put("tools", tools)
    val turns = linkedMapOf<Int, JSONObject>()
    (old.rows("turns") + fresh.rows("turns")).forEach { turn ->
        val key = turn.optInt("turn")
        val merged = turns[key]?.copyJson() ?: json()
        // Counts belong to this exact comparison. Keep them if it expires, never
        // attach an older turn snapshot's counts to a newer changesSeq.
        if (!turn.isNull("changesSeq") && turn.optLong("changesSeq") != merged.optLong("changesSeq", -1))
            merged.remove("changesSummary")
        turn.keys().forEach { field ->
            if (field in listOf("files", "notices")) {
                merged.put(field, JSONArray((merged.rows(field) + turn.rows(field))
                    .associateBy { it.optString("id") }.values.toList()))
            } else if (!turn.isNull(field)) merged.put(field, turn.get(field))
        }
        turns[key] = merged
    }
    result.put("turns", JSONArray(turns.toSortedMap().values.toList()))
    result.put("hidden", JSONArray(hidden.toList()))
    if (old.optLong("beforeSeq", boundary) < boundary) {
        result.put("beforeSeq", old.get("beforeSeq"))
        result.put("hasMore", old.optBoolean("hasMore"))
    }
    return result
}

fun JSONArray.strings() = (0 until length()).map(::getString)

data class OpenPage(val id: String, val origin: String, val path: String, val cookie: String) {
    val url get() = origin + path
    fun allows(url: String): Boolean = runCatching {
        val parsed = URI(url)
        val base = URI(origin)
        parsed.scheme == base.scheme && parsed.host == base.host && parsed.port == base.port &&
            parsed.rawUserInfo == null && parsed.rawPath.startsWith(path) &&
            !Regex("(?i)%2e|%2f|%5c|\\\\").containsMatchIn(parsed.rawPath) &&
            parsed.normalize().rawPath == parsed.rawPath
    }.getOrDefault(false)
    companion object {
        fun parse(o: JSONObject, origin: String, computer: String): OpenPage {
            val id = o.getString("id")
            require(UUID.fromString(id).toString() == id.lowercase())
            require(o.getString("computerId") == computer)
            val cookie = o.getString("cookie")
            require(cookie.matches(Regex("[A-Za-z0-9_-]{43}")))
            val path = "/ui/$id/"
            require(o.getString("path") == path)
            return OpenPage(id, origin, path, cookie)
        }
    }
}
