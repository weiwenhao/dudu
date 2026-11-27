package app.dudu.android

import app.dudu.android.data.*
import kotlinx.coroutines.test.runTest
import okhttp3.Request
import okio.Buffer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** The pure parts of the feedback (`data/Feedback.kt`, `data/FeedbackChannel.kt`): the address the send button waits for, how much of the log goes, the request and what counts as sent. */
class FeedbackTest {
    @Test fun aReplyAddressHasNoSpaceOneAtAndADotInsideWhatFollowsIt() {
        for (good in listOf("a@b.co", "first.last+tag@mail.example.com", "  a@b.co  ", "名字@例子.中国"))
            assertTrue(good, isFeedbackEmail(good))
        for (bad in listOf("", "   ", "a", "a@b", "@b.co", "a@@b.co", "a@b@c.de", "a@b.", "a@.co", "ab.co", "a b@c.de", "a@b c.de", "a@b.co x", "a@b.c o"))
            assertFalse(bad, isFeedbackEmail(bad))
    }

    private fun size(text: String) = text.toByteArray(Charsets.UTF_8).size

    @Test fun theLogSentIsTheNewestWholeLinesOldestFirstAndSaysWhenItWasCut() {
        // Four lines of 39 bytes, 40 each with its newline; the mark costs 25.
        val a = "a".repeat(39); val b = "b".repeat(39); val c = "c".repeat(39); val d = "d".repeat(39)
        val lines = listOf(a, b, c, d)
        val markCost = size(FEEDBACK_LOG_CUT) + 1
        // All of it fits: as written, no mark.
        assertEquals("$a\n$b\n$c\n$d", recentLog(lines, limit = 160))
        // Cut: the newest lines that fit, in their order, after the mark; the mark counts in the limit.
        val cut = recentLog(lines, limit = markCost + 80)
        assertEquals("$FEEDBACK_LOG_CUT\n$c\n$d", cut)
        assertTrue(size(cut) <= markCost + 80)
        assertEquals("$FEEDBACK_LOG_CUT\n$b\n$c\n$d", recentLog(lines, limit = 159))
        // A line is never cut in two: a byte short of two lines, one is left; short of one, none.
        assertEquals("$FEEDBACK_LOG_CUT\n$d", recentLog(lines, limit = markCost + 79))
        assertEquals(FEEDBACK_LOG_CUT, recentLog(lines, limit = markCost + 39))
        assertEquals("the cut note itself cannot exceed the byte limit", "", recentLog(lines, limit = markCost - 1))
        // Lines older than the ones passed were left out: the mark is there although everything passed fits.
        assertEquals("$FEEDBACK_LOG_CUT\n$a\n$b", recentLog(listOf(a, b), older = true, limit = 1000))
        // Blank lines are not lines; nothing is nothing.
        assertEquals("$a\n$b", recentLog(listOf(a, "", "  ", b), limit = 1000))
        assertEquals("", recentLog(emptyList()))
    }

    @Test fun theLimitIsInBytesOfUtf8AndKeepsTheNewestLinesWhateverTheirSize() {
        val line = "中文行"
        assertEquals(9, size(line))
        val markCost = size(FEEDBACK_LOG_CUT) + 1
        // Two such lines cost 20 with their newlines; room for 19 holds only one.
        assertEquals("$FEEDBACK_LOG_CUT\n$line\n$line", recentLog(List(5) { line }, limit = markCost + 20))
        assertEquals("$FEEDBACK_LOG_CUT\n$line", recentLog(List(5) { line }, limit = markCost + 19))
        // Five thousand event lines against the real limit (about 1,160 fit): never over it, the newest line is last, and what is kept is the run of the newest lines in order.
        val events = (1..5000).map { """{"source":"native/android","timestamp":$it,"level":"info","event":"http.request.complete","method":"board.list","elapsedMs":${it % 90}}""" }
        val text = recentLog(events)
        assertTrue(size(text) <= FEEDBACK_LOG_LIMIT)
        val kept = text.lines()
        assertEquals(FEEDBACK_LOG_CUT, kept.first())
        assertEquals(events.last(), kept.last())
        assertEquals(events.takeLast(kept.size - 1), kept.drop(1))
        assertEquals(1163, kept.size - 1)
    }

    private fun bodyOf(request: Request): JSONObject {
        val buffer = Buffer()
        request.body!!.writeTo(buffer)
        return JSONObject(buffer.readUtf8())
    }

    @Test fun theRequestCarriesTheNineFieldsOfTheAgreementAndNoRequestIsMadeWithoutAKey() {
        val device = feedbackDevice("samsung", "SM-S918B", "14", 34)
        assertEquals("samsung SM-S918B · Android 14 (SDK 34)", device)
        fun make(key: String) = FeedbackChannel.request("  me@example.org ", "\n It does not open.  \n", "0.3.0", "7", device, "zh-CN", "line1\nline2", accessKey = key)
        // No key, no request: nothing leaves the phone.
        assertNull(make(""))
        assertNull(make("   "))
        val request = make("public-key")!!
        assertEquals("POST", request.method)
        assertEquals(FeedbackChannel.ENDPOINT, request.url.toString())
        assertEquals("https://api.web3forms.com/submit", request.url.toString())
        assertEquals("application/json", request.header("Accept"))
        assertEquals("application/json", request.body!!.contentType().toString())
        val body = bodyOf(request)
        assertEquals(setOf("access_key", "subject", "from_name", "email", "message", "app", "device", "language", "logs"), body.keys().asSequence().toSet())
        assertEquals("public-key", body.getString("access_key"))
        assertEquals("Dudu 反馈 · Android 0.3.0 (7)", body.getString("subject"))
        assertEquals("Dudu Android", body.getString("from_name"))
        assertEquals("me@example.org", body.getString("email"))
        assertEquals("It does not open.", body.getString("message"))
        assertEquals("Dudu Android 0.3.0 (7)", body.getString("app"))
        assertEquals(device, body.getString("device"))
        assertEquals("zh-CN", body.getString("language"))
        assertEquals("line1\nline2", body.getString("logs"))
    }

    @Test fun onlyHttp200WithSuccessTrueCountsAsSent() = runTest {
        assertTrue(FeedbackChannel.accepted(200, """{"success":true,"message":"Email sent successfully!"}"""))
        assertFalse(FeedbackChannel.accepted(200, """{"success":false,"message":"Invalid access key"}"""))
        assertFalse(FeedbackChannel.accepted(400, """{"success":true}"""))
        assertFalse(FeedbackChannel.accepted(201, """{"success":true}"""))
        assertFalse(FeedbackChannel.accepted(200, """{"success":"true"}"""))
        assertFalse(FeedbackChannel.accepted(200, """{"message":"no flag"}"""))
        assertFalse(FeedbackChannel.accepted(200, "<html>not json</html>"))
        assertFalse(FeedbackChannel.accepted(200, ""))
        // A request that was never made (no key) is a failure and touches no network.
        assertFalse(FeedbackChannel.send(null))
    }
}
