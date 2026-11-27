package app.dudu.android.data

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Where the feedback goes (owner, 2026-11-27): a form on Web3Forms, which mails it on. This file is the only one that knows that service, so that moving to another one (its address, its key, its
 * fields, what it answers) is a change here and nowhere else: `request` builds the POST, `send` makes it, `accepted` reads the answer.
 */
object FeedbackChannel {
    /**
     * The form's access key. The service makes it public by design (it only names the form, and every phone sends it), so it is a constant in this file: not an environment variable and not in
     * `BuildConfig`. It is empty until the owner gives it, and while it is empty nothing is sent and a send counts as failed.
     */
    const val ACCESS_KEY = ""
    const val ENDPOINT = "https://api.web3forms.com/submit"
    const val TIMEOUT_SECONDS = 20L

    /** How much of the answer is read: the service's JSON is a few hundred bytes. */
    private const val ANSWER_BYTES = 16L * 1024

    // A client of its own: this request goes to the internet, not to the paired computer, and is never repeated by the client's own retry.
    private val client by lazy {
        OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
            .callTimeout(TIMEOUT_SECONDS, TimeUnit.SECONDS).build()
    }

    /**
     * The POST for one feedback: JSON with the key, the subject and sender the mail will carry, the person's reply address and text, and what the owner needs to read it (the app, the phone, the
     * language, the newest diagnostics). `email` and `message` are sent as the person wrote them, without the spaces round them. Null, and so nothing to send, while there is no key.
     */
    fun request(email: String, message: String, version: String, build: String, device: String, language: String, logs: String,
        accessKey: String = ACCESS_KEY, endpoint: String = ENDPOINT): Request? {
        if (accessKey.isBlank()) return null
        val app = "Android $version ($build)"
        val body = JSONObject()
            .put("access_key", accessKey)
            .put("subject", "Dudu 反馈 · $app")
            .put("from_name", "Dudu Android")
            .put("email", email.trim())
            .put("message", message.trim())
            .put("app", "Dudu $app")
            .put("device", device)
            .put("language", language)
            .put("logs", logs)
        return Request.Builder().url(endpoint).header("Accept", "application/json")
            .post(body.toString().toByteArray(Charsets.UTF_8).toRequestBody("application/json".toMediaType())).build()
    }

    /** Makes the request (20 s at most, off the main thread): true when the service accepted it, false for everything else, a request that is null (no key) included. Nothing of the text goes in the diagnostics. */
    suspend fun send(request: Request?): Boolean {
        if (request == null) {
            DuduLog.record("feedback.send.skip", "warn", state = "no_key")
            return false
        }
        val began = System.nanoTime()
        fun elapsed() = (System.nanoTime() - began) / 1_000_000
        return withContext(Dispatchers.IO) {
            try {
                client.newCall(request).await().use { response ->
                    val ok = accepted(response.code, response.peekBody(ANSWER_BYTES).string())
                    DuduLog.record(if (ok) "feedback.send.done" else "feedback.send.fail", if (ok) "info" else "warn", elapsedMs = elapsed(),
                        counts = mapOf("httpStatus" to response.code.toLong()))
                    ok
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("feedback.send.fail", error, elapsedMs = elapsed())
                false
            }
        }
    }

    /** The service said yes: HTTP 200 and `success` true in its JSON. Anything else (another status, no JSON, `success` false or not a boolean) is a no. */
    fun accepted(status: Int, text: String): Boolean =
        status == 200 && runCatching { JSONObject(text).opt("success") == true }.getOrDefault(false)
}
