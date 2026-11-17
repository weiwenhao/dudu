package app.dudu.android

import app.dudu.android.data.*
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.RecordedRequest
import okio.Buffer
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.atomic.AtomicBoolean
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class ApiContractTest {
    private val token = "a".repeat(43)

    @Test fun aClosedReadSocketCanRecoverWithoutReplayingAMutation() = runBlocking {
        val server = MockWebServer()
        var calls = 0
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                calls++
                if (calls != 2) return MockResponse().setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.DISCONNECT_AFTER_REQUEST)
                val id = JSONObject(request.body.readUtf8()).getString("id")
                return MockResponse().setBody(json("id" to id, "ok" to true,
                    "result" to json("items" to JSONArray())).toString())
            }
        }
        server.start()
        val address = server.url("/dsbot").newBuilder().host("127.0.0.1").build()
        val client = DuduApi(Endpoint.parse("$address?pair=$token"))
        try {
            assertEquals(0, client.request("inbox.list").getJSONArray("items").length())
            assertEquals(2, calls)
            try { client.request("session.send", json("text" to "Do not duplicate")); fail("Lost reply must be reconciled by input ID") }
            catch (_: java.io.IOException) { }
            assertEquals(3, calls)
        } finally { client.retire(); server.shutdown() }
    }

    @Test fun routeFailoverRequiresANonceBoundProofBeforeSendingCredentials() = runBlocking {
        val wrong = MockWebServer()
        val good = MockWebServer()
        val leaked = AtomicBoolean(false)
        wrong.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.getHeader("Authorization") != null) leaked.set(true)
                return MockResponse().setBody(json("protocol" to 1, "computerId" to "mac",
                    "deviceId" to "phone", "deviceProof" to "b".repeat(43)).toString())
            }
        }
        good.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.path == "/dsbot/api/v1/probe") {
                    if (request.getHeader("Authorization") != null || request.path!!.contains(token)) leaked.set(true)
                    val body = JSONObject(request.body.readUtf8())
                    val key = MessageDigest.getInstance("SHA-256").digest(token.toByteArray())
                    val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
                    val proof = mac.doFinal("dsbot-route:v1:${body.getString("nonce")}:mac:${body.getString("deviceId")}".toByteArray())
                    return MockResponse().setBody(json("protocol" to 1, "computerId" to "mac", "deviceId" to "phone",
                        "deviceProof" to Base64.getUrlEncoder().withoutPadding().encodeToString(proof)).toString())
                }
                if (request.getHeader("Authorization") != "Bearer $token") return MockResponse().setResponseCode(401)
                return MockResponse().setBody(json("type" to "ready", "protocol" to 1, "deviceId" to "phone",
                    "computer" to json("id" to "mac", "name" to "Host")).toString())
            }
        }
        wrong.start(); good.start()
        val origin = wrong.url("/").toString().trimEnd('/')
        val alternate = good.url("/").toString().trimEnd('/')
        val client = DuduApi(Endpoint.parse("$origin/dsbot?pair=$token&computer=mac&device=phone" +
            "&lan=${URLEncoder.encode(origin, "UTF-8")}&public=${URLEncoder.encode(alternate, "UTF-8")}"))
        try {
            repeat(2) { assertEquals("mac", client.connect().getString("id")) }
            assertEquals(alternate, client.endpoint.origin)
            assertEquals(2, wrong.requestCount)
            assertEquals(4, good.requestCount)
            assertFalse("A pairing token reached an unverified address", leaked.get())
            assertEquals("phone", Endpoint.parse(client.endpoint.storedLink()).deviceId)
        } finally { client.retire(); wrong.shutdown(); good.shutdown() }
    }

    @Test fun scalarAndArrayResponsesPreserveTheAuthenticatedContract() = runBlocking {
        val server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.path == "/dsbot/api/v1/disconnect") return MockResponse().setBody("{}")
                val body = JSONObject(request.body.readUtf8())
                val result = if (body.getString("method") == "question.answer") true else JSONArray("""[{"id":"session"}]""")
                return MockResponse().setBody(json("id" to body.getString("id"), "ok" to true, "result" to result).toString())
            }
        }
        server.start()
        val client = DuduApi(Endpoint.parse("${server.url("/dsbot")}?pair=$token"))
        client.language = "en"
        try {
            assertEquals(true, client.requestValue("question.answer"))
            assertEquals("session", client.array("session.list").getJSONObject(0).getString("id"))
            repeat(2) {
                val request = server.takeRequest()
                assertEquals("Bearer $token", request.getHeader("Authorization"))
                assertEquals("android", request.getHeader("X-Dudu-Client"))
                assertEquals("en", request.getHeader("Accept-Language"))
            }
            client.retire()
            client.disconnect()
            assertEquals("/dsbot/api/v1/disconnect", server.takeRequest().path)
        } finally { client.retire(); server.shutdown() }
    }

    @Test fun binaryTransfersStreamBytesAndRejectTruncatedVideo() = runBlocking {
        val server = MockWebServer()
        val bytes = ByteArray(160_000) { (it % 251).toByte() }
        var uploaded = byteArrayOf()
        val truncate = AtomicBoolean(false)
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.path?.startsWith("/dsbot/api/v1/file/upload") == true) {
                    uploaded = request.body.readByteArray()
                    return MockResponse().setBody(json("id" to request.getHeader("X-Dudu-Request-ID"), "ok" to true,
                        "result" to json("receiptId" to "receipt", "name" to "fixture.bin")).toString())
                }
                return MockResponse().setHeader("Content-Type", "video/mp4")
                    .setHeader("X-Dudu-File-Bytes", bytes.size + if (truncate.get()) 1 else 0)
                    .setBody(Buffer().write(bytes))
            }
        }
        server.start()
        val client = DuduApi(Endpoint.parse("${server.url("/dsbot")}?pair=$token"))
        try {
            val upload = client.upload("s", "fixture.bin", bytes.size.toLong()) { ByteArrayInputStream(bytes) }
            assertEquals("receipt", upload.getString("receiptId"))
            assertArrayEquals(bytes, uploaded)
            assertEquals("Bearer $token", server.takeRequest().getHeader("Authorization"))
            val output = ByteArrayOutputStream()
            assertEquals("video/mp4", client.video(json()) { output })
            assertArrayEquals(bytes, output.toByteArray())
            truncate.set(true)
            try { client.video(json()) { ByteArrayOutputStream() }; fail("Truncated video must fail") }
            catch (failure: ApiFailure) { assertEquals("PROTOCOL_ERROR", failure.code) }
        } finally { client.retire(); server.shutdown() }
    }
}
