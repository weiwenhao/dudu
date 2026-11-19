package app.dudu.android.data

import org.json.JSONException
import org.json.JSONObject

/**
 * The app's diagnostics, as the iPhone keeps its own (`DSBotLog`; owner, 2026-11-19: "各种日志都需要加上，不然我都没法排查问题"): one JSON line for a thing that happened, written to
 * a file on the phone and to logcat by the app's sink (`Diagnostics`). A line has an event name and only the fields below, each checked against a pattern or a list. Nothing of a
 * conversation, an address, a link, a token or an identity goes in: a request is named by its method, a route by its kind (`lan` / `public`), a failure by its code and the class of
 * what was thrown, never by its message. `requestId` is the app's own random id of one request or one sent message.
 */
object DuduLog {
    /** Where a line goes; set once when the app starts. Null in unit tests, where nothing is recorded. */
    @Volatile var sink: ((line: String, level: String) -> Unit)? = null

    private val event = Regex("^[A-Za-z0-9._-]{1,48}$")
    private val word = Regex("^[A-Za-z0-9._:$-]{1,64}$")
    private val codeWord = Regex("^[A-Za-z0-9_-]{1,48}$")
    private val method = Regex("^[a-z][A-Za-z.]{1,47}$")
    private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    private val counted = setOf("payloadBytes", "httpStatus", "rowCount", "eventCount", "attachmentCount", "messageCount",
        "pendingCount", "lanAddressCount", "publicAddressCount", "idleMs", "attempt", "sdk")

    fun record(name: String, level: String = "info", method: String? = null, requestId: String? = null, elapsedMs: Long? = null,
        counts: Map<String, Long>? = null, state: String? = null, code: String? = null, detail: String? = null, at: String? = null) {
        val out = sink ?: return
        if (!event.matches(name)) return
        val grade = if (level in setOf("debug", "info", "warn", "error")) level else "info"
        val line = JSONObject()
        line.put("source", "native-android").put("timestamp", System.currentTimeMillis()).put("level", grade).put("event", name)
        if (method != null && this.method.matches(method)) line.put("method", method)
        if (requestId != null && uuid.matches(requestId)) line.put("requestId", requestId)
        if (elapsedMs != null && elapsedMs >= 0) line.put("elapsedMs", minOf(elapsedMs, 86_400_000L))
        counts?.filter { it.key in counted && it.value >= 0 }?.takeIf { it.isNotEmpty() }?.let { safe ->
            line.put("counts", JSONObject().apply { safe.forEach { (key, value) -> put(key, value) } })
        }
        if (state != null && word.matches(state)) line.put("state", state)
        if (code != null && codeWord.matches(code)) line.put("code", code.uppercase())
        if (detail != null && word.matches(detail)) line.put("detail", detail)
        if (at != null && word.matches(at)) line.put("at", at)
        runCatching { out(line.toString(), grade) }
    }

    /** A thing that failed: the plugin's code when it answered with one, and otherwise what was thrown (`describe`) and where in the app (`place`). */
    fun failure(name: String, error: Throwable, method: String? = null, requestId: String? = null, elapsedMs: Long? = null,
        counts: Map<String, Long>? = null, state: String? = null) {
        val answered = error as? ApiFailure
        record(name, "warn", method, requestId, elapsedMs, counts, state, code = answered?.code ?: "CONNECTION_FAILED",
            detail = if (answered != null) null else describe(error), at = if (answered != null) null else place(error))
    }

    /**
     * What kind of thing was thrown, in words from a fixed list: its class, and for the usual network and JSON failures what its message says (a timeout, a connection the other end
     * had closed, a missing key and its name). The message itself is never kept: it may carry an address or a piece of a conversation.
     */
    fun describe(error: Throwable): String {
        val name = error.javaClass.simpleName.filter { it.isLetterOrDigit() }.take(36).ifEmpty { "Throwable" }
        val text = error.message.orEmpty()
        val kind = when {
            error is JSONException -> Regex("No value for ([A-Za-z0-9_]{1,24})").find(text)?.let { "missing.${it.groupValues[1]}" }
                ?: Regex(" at ([A-Za-z0-9_]{1,24}) of type").find(text)?.let { "type.${it.groupValues[1]}" } ?: "json"
            error is java.net.SocketTimeoutException || text.contains("timeout", ignoreCase = true) -> "timeout"
            text.contains("unexpected end of stream") || text.contains("not found: limit") -> "end_of_stream"
            text.contains("Connection reset") -> "reset"
            text.contains("Broken pipe") -> "broken_pipe"
            text.contains("ECONNREFUSED") || text.contains("Connection refused") -> "refused"
            text.contains("ENETUNREACH") || text.contains("EHOSTUNREACH") || text.contains("No route to host") -> "unreachable"
            text.contains("Software caused connection abort") -> "abort"
            text.contains("Canceled") || text.contains("Socket closed") || text.contains("Socket is closed") -> "closed"
            error is java.net.UnknownHostException -> "dns"
            error is javax.net.ssl.SSLException -> "tls"
            else -> null
        }
        return if (kind == null) name else "$name.$kind"
    }

    /** The first line of the app's own code in the trace, as `File.kt:123`: where a parse or a state error came from. */
    fun place(error: Throwable): String? = error.stackTrace.firstOrNull { it.className.startsWith("app.dudu.android") && it.fileName != null }
        ?.let { "${it.fileName}:${it.lineNumber}" }
}
