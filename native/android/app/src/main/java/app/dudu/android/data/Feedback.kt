package app.dudu.android.data

import android.content.Context
import android.os.Build
import app.dudu.android.Diagnostics
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * The feedback of the settings page (owner, 2026-11-27: 「我觉得需要增加一个反馈功能，可以把最近的日志，用户机型，和用户反馈内容一起发过来」, 「只需要让用户填一个回信邮箱，其他的都不需要」). The sheet is
 * `ui/Feedback.kt`; what is sent, and where, is `FeedbackChannel`. This file holds the rules the sheet and the report share: what a reply address is, the phone's line, and how much of the
 * diagnostics goes with it.
 */

/** How much of the diagnostics goes with a feedback, in bytes of UTF-8 (150 KB, counted as 150,000 so that it is within it however a kilobyte is counted). */
const val FEEDBACK_LOG_LIMIT = 150_000

/** The first line of a log that was cut at the front: lines older than the ones sent were left out. */
const val FEEDBACK_LOG_CUT = "(earlier lines left out)"

/**
 * A reply address the sheet accepts (the send button waits for one): no space in it, one @ with something before it, and a dot inside what follows it, neither first nor last. The spaces
 * round it do not count (a keyboard's suggestion adds one), and are not sent.
 */
fun isFeedbackEmail(value: String): Boolean {
    val email = value.trim()
    if (email.isEmpty() || email.any(Char::isWhitespace)) return false
    val at = email.indexOf('@')
    if (at < 1 || email.indexOf('@', at + 1) >= 0) return false
    val domain = email.substring(at + 1)
    val dot = domain.lastIndexOf('.')
    return dot > 0 && dot < domain.length - 1
}

/** The phone as the report says it: its make and model, and its Android with the API level (`samsung SM-S918B · Android 14 (SDK 34)`). */
fun feedbackDevice(manufacturer: String, model: String, release: String, sdk: Int) = "$manufacturer $model · Android $release (SDK $sdk)"

/**
 * The newest part of the diagnostics that fits in `limit` bytes of UTF-8, cut at whole lines and in the order they were written (oldest first). When lines were left out, `FEEDBACK_LOG_CUT` is the
 * first line, and it counts in the limit. `lines` are in the order they were written; `older` says that lines older than these exist and were not passed. A line that does not fit ends the
 * search (the lines sent are always the newest ones, one after the other).
 */
fun recentLog(lines: List<String>, older: Boolean = false, limit: Int = FEEDBACK_LOG_LIMIT): String {
    val written = lines.filter { it.isNotBlank() }
    fun cost(line: String) = line.toByteArray(Charsets.UTF_8).size + 1
    if (!older && written.sumOf(::cost) <= limit) return written.joinToString("\n")
    val markerCost = cost(FEEDBACK_LOG_CUT)
    if (markerCost > limit) return ""
    var room = limit - markerCost
    var first = written.size
    while (first > 0 && cost(written[first - 1]) <= room) {
        room -= cost(written[first - 1])
        first--
    }
    return (listOf(FEEDBACK_LOG_CUT) + written.subList(first, written.size)).joinToString("\n")
}

/**
 * What the sheet calls: the report (the app's version, this phone, `language`, the tag of the language the app is shown in, and the newest of the diagnostics) with the person's text and reply
 * address, sent through `FeedbackChannel`. True when it was sent. Off the main thread. A log that cannot be read does not stop the feedback; it goes without.
 */
suspend fun sendFeedback(context: Context, email: String, message: String, language: String): Boolean = withContext(Dispatchers.IO) {
    val logs = try {
        Diagnostics.recent(context)
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        DuduLog.failure("feedback.logs.fail", error)
        ""
    }
    FeedbackChannel.send(FeedbackChannel.request(email, message, AppDeclaration.version, AppDeclaration.build,
        feedbackDevice(Build.MANUFACTURER, Build.MODEL, Build.VERSION.RELEASE, Build.VERSION.SDK_INT), language, logs))
}
