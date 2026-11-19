package app.dudu.android

import app.dudu.android.data.ApiFailure
import app.dudu.android.data.DuduLog
import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.IOException

/** The diagnostics keep words and numbers only: nothing a person wrote, no address, no link. */
class DuduLogTest {
    private fun lines(block: () -> Unit): List<JSONObject> {
        val seen = mutableListOf<JSONObject>()
        DuduLog.sink = { line, _ -> seen.add(JSONObject(line)) }
        try { block() } finally { DuduLog.sink = null }
        return seen
    }

    @Test fun aLineDropsWhatIsNotAWordOrAListedCount() {
        val line = lines {
            DuduLog.record("board.load.fail", method = "board.list", requestId = "not an id", state = "http://192.168.1.2:3170",
                code = "bad code!", detail = "你好 world", at = "a@b.cn", counts = mapOf("payloadBytes" to 12L, "token" to 5L))
        }.single()
        assertEquals("board.list", line.getString("method"))
        assertEquals(12L, line.getJSONObject("counts").getLong("payloadBytes"))
        assertFalse(line.getJSONObject("counts").has("token"))
        listOf("requestId", "state", "code", "detail", "at").forEach { assertFalse(it, line.has(it)) }
    }

    @Test fun aFailureIsToldByItsKindNotItsMessage() {
        val failed = lines { DuduLog.failure("events.fail", IOException("unexpected end of stream on http://192.168.1.2:3170/?token=abc")) }.single()
        assertEquals("CONNECTION_FAILED", failed.getString("code"))
        assertEquals("IOException.end_of_stream", failed.getString("detail"))
        assertFalse(failed.toString().contains("192.168"))
        val unread = lines { DuduLog.failure("board.load.fail", JSONException("No value for receivedAt")) }.single()
        assertEquals("JSONException.missing.receivedAt", unread.getString("detail"))
        val refused = lines { DuduLog.failure("operation.fail", ApiFailure("NOT_FOUND")) }.single()
        assertEquals("NOT_FOUND", refused.getString("code"))
        assertFalse(refused.has("detail"))
    }
}
