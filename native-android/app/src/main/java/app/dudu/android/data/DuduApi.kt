package app.dudu.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Connection
import okhttp3.EventListener
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.RequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Response
import org.json.JSONObject
import org.json.JSONArray
import java.io.IOException
import java.util.Locale
import java.util.UUID
import java.util.concurrent.TimeUnit
import java.util.Base64
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiFailure(val code: String) : IOException(code)

class DuduApi(endpoint: Endpoint, private val expectedComputer: String? = endpoint.computerId,
    val preserveAddresses: Boolean = false) {
    @Volatile var endpoint: Endpoint = endpoint
        private set
    var language: String = ""
    private val connecting = Mutex()
    @Volatile private var retired = false
    fun retire() { retired = true; client.dispatcher.cancelAll() }

    /** What one request met on its way, for the diagnostics: a connection made for it or one taken from the pool, and how long that one had lain idle. */
    private class Trace { @Volatile var fresh = false; @Volatile var idleMs: Long? = null }
    private val released = java.util.Collections.synchronizedMap(java.util.WeakHashMap<Connection, Long>())
    private val tracing = object : EventListener() {
        override fun connectStart(call: Call, inetSocketAddress: java.net.InetSocketAddress, proxy: java.net.Proxy) {
            call.request().tag(Trace::class.java)?.fresh = true
        }
        override fun connectionAcquired(call: Call, connection: Connection) {
            val trace = call.request().tag(Trace::class.java) ?: return
            if (!trace.fresh) released[connection]?.let { trace.idleMs = (System.nanoTime() - it) / 1_000_000 }
        }
        override fun connectionReleased(call: Call, connection: Connection) { released[connection] = System.nanoTime() }
    }
    private val client = OkHttpClient.Builder()
        .followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .connectTimeout(12, TimeUnit.SECONDS).readTimeout(35, TimeUnit.SECONDS)
        .eventListener(tracing)
        .build()

    suspend fun connect(): JSONObject = connecting.withLock {
        if (endpoint.deviceId == null) {
            // Legacy links can authenticate only at their original origin. Upgrade their
            // identity before any alternative address is allowed to receive credentials.
            val computer = connectAt(endpoint)
            if (endpoint.deviceId == null || ConnectionAddress.parse(endpoint.origin).kind == "lan" ||
                endpoint.addresses.none { it.kind == "lan" }) return@withLock computer
        }
        establish()
    }

    private suspend fun establish(): JSONObject {
        var failure: Exception = ApiFailure("CONNECTION_FAILED")
        for (kind in listOf("lan", "public")) {
            val remaining = endpoint.addresses.filter { it.kind == kind }.toMutableList()
            while (remaining.isNotEmpty()) {
                val address = try { firstVerified(remaining) }
                catch (e: Exception) {
                    if (e is CancellationException) throw e
                    failure = e; break
                }
                remaining.remove(address)
                try {
                    return connectAt(endpoint.selecting(address)).also {
                        DuduLog.record("connection.route", state = kind, counts = mapOf(
                            "lanAddressCount" to endpoint.addresses.count { it.kind == "lan" }.toLong(),
                            "publicAddressCount" to endpoint.addresses.count { it.kind == "public" }.toLong()))
                    }
                }
                catch (e: Exception) {
                    if (e is CancellationException || e is ApiFailure && e.code in
                        listOf("AUTH_FAILED", "UNAUTHORIZED", "IDENTITY_MISMATCH", "PROTOCOL_ERROR")) throw e
                    failure = e
                }
            }
        }
        throw failure
    }

    suspend fun verifyAddresses(): Endpoint {
        var failure: Exception = ApiFailure("CONNECTION_FAILED")
        for (kind in listOf("lan", "public")) {
            val routes = endpoint.addresses.filter { it.kind == kind }
            if (routes.isEmpty()) continue
            try { return endpoint.selecting(firstVerified(routes)) }
            catch (e: Exception) {
                if (e is CancellationException) throw e
                failure = e
            }
        }
        throw failure
    }

    private suspend fun connectAt(candidate: Endpoint): JSONObject {
        val ready = postAt("/dsbot/api/v1/connect", JSONObject(), origin = candidate.origin, timeoutSeconds = 12)
        if (retired) throw CancellationException("Computer switched")
        if (ready.optString("type") != "ready" || ready.optInt("protocol") != 1)
            throw ApiFailure("PROTOCOL_ERROR")
        val computer = ready.getJSONObject("computer")
        val expected = expectedComputer ?: endpoint.computerId
        if (expected != null && computer.getString("id") != expected ||
            candidate.deviceId != null && ready.optString("deviceId") != candidate.deviceId)
            throw ApiFailure("IDENTITY_MISMATCH")
        endpoint = try {
            require(computer.getString("name").isNotBlank())
            val routes = if (!preserveAddresses && computer.has("addresses")) computer.getJSONArray("addresses").objects().map {
                ConnectionAddress.parse(it.getString("url"), it.getString("kind"))
            } else null
            candidate.identified(computer.getString("id"), ready.nullableString("deviceId"), routes)
        } catch (_: Exception) { throw ApiFailure("PROTOCOL_ERROR") }
        return computer
    }

    private suspend fun firstVerified(routes: List<ConnectionAddress>): ConnectionAddress = coroutineScope {
        val results = Channel<Pair<ConnectionAddress, Exception?>>(Channel.UNLIMITED)
        val jobs = routes.map { address -> launch {
            val failure = try { probe(address); null } catch (e: Exception) {
                if (e is CancellationException) throw e
                e
            }
            results.send(address to failure)
        } }
        try {
            var failure: Exception = ApiFailure("CONNECTION_FAILED")
            repeat(routes.size) {
                val (address, error) = results.receive()
                if (error == null) return@coroutineScope address
                if (failure !is ApiFailure || error is ApiFailure) failure = error
            }
            throw failure
        } finally { jobs.forEach { it.cancel() } }
    }

    private suspend fun probe(address: ConnectionAddress) {
        val expected = endpoint
        val computer = expected.computerId ?: throw ApiFailure("IDENTITY_MISMATCH")
        val device = expected.deviceId ?: throw ApiFailure("IDENTITY_MISMATCH")
        val nonce = UUID.randomUUID().toString().replace("-", "")
        val reply = postAt("/dsbot/api/v1/probe", json("nonce" to nonce, "deviceId" to device),
            origin = address.origin, authenticated = false, maxBytes = 4096,
            timeoutSeconds = if (address.kind == "lan") 2 else 5)
        if (reply.optInt("protocol") != 1 || reply.optString("computerId") != computer ||
            reply.optString("deviceId") != device) throw ApiFailure("IDENTITY_MISMATCH")
        val signature = reply.optString("deviceProof")
        if (!signature.matches(Regex("[A-Za-z0-9_-]{43}"))) throw ApiFailure("IDENTITY_MISMATCH")
        val key = MessageDigest.getInstance("SHA-256").digest(expected.token.toByteArray(Charsets.UTF_8))
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(key, "HmacSHA256")) }
        val proof = mac.doFinal("dsbot-route:v1:$nonce:$computer:$device".toByteArray(Charsets.UTF_8))
        if (!MessageDigest.isEqual(proof, Base64.getUrlDecoder().decode(signature))) throw ApiFailure("IDENTITY_MISMATCH")
    }

    suspend fun requestValue(method: String, params: JSONObject = JSONObject()): Any {
        val id = UUID.randomUUID().toString()
        val body = json("id" to id, "method" to method, "params" to params)
        val envelope = try { post("request", body) }
        catch (error: IOException) {
            // A server may close an idle pooled socket just as a read starts.
            // Only these side-effect-free reads may reconnect; never replay a mutation.
            if (error is ApiFailure || method !in repeatableReads) throw error
            DuduLog.record("http.request.retry", method = method, requestId = id, detail = DuduLog.describe(error))
            post("request", body)
        }
        if (retired) throw CancellationException("Computer switched")
        // The plugin answered, and said no: the request itself was delivered (`http.request.complete` is its line).
        fun refused(code: String): ApiFailure {
            DuduLog.record("request.refused", "warn", method = method, requestId = id, code = code)
            return ApiFailure(code)
        }
        if (envelope.optString("id") != id) throw refused("PROTOCOL_ERROR")
        if (!envelope.optBoolean("ok")) throw refused(envelope.optJSONObject("error")?.optString("code") ?: "UPSTREAM_ERROR")
        val result = envelope.opt("result") ?: throw refused("PROTOCOL_ERROR")
        if (result is JSONObject && result.has("outcome") && result.optString("outcome") !in listOf("success", "no_op"))
            throw refused(result.optString("code", "UPSTREAM_ERROR"))
        return result
    }

    private val repeatableReads = setOf(
        "board.list", "catalog.get", "navigation.get", "plugins.list", "quota.get",
        "workspace.list", "session.list", "session.search", "session.page", "session.tool",
        "session.team", "session.jobs", "session.job.output", "session.changes", "session.diff",
        "files.list", "files.read", "issue.get", "issue.options", "issue.parents", "issue.pick",
        "inbox.list", "inbox.get", "tasks.list", "tasks.get", "tasks.options", "tasks.history",
        "settings.page", "assistant.todos", "assistant.reply.read",
    )

    suspend fun request(method: String, params: JSONObject = JSONObject()): JSONObject =
        requestValue(method, params) as? JSONObject ?: throw ApiFailure("PROTOCOL_ERROR")

    suspend fun array(method: String, params: JSONObject = JSONObject()): JSONArray =
        requestValue(method, params) as? JSONArray ?: throw ApiFailure("PROTOCOL_ERROR")

    suspend fun home(): Pair<Home, String> {
        val result = request("board.list", json("tab" to Scope.All.wire, "layout" to "chat", "filterData" to true))
        return withContext(Dispatchers.Default) { Home.parse(result, Scope.All) to result.toString() }
    }

    suspend fun options(): Options {
        val result = request("issue.options")
        val available = request("catalog.get")
        val providers = available.optJSONArray("providers")?.objects() ?: emptyList()
        return Options(
            result.getJSONArray("statuses").objects().map(Status::parse),
            result.getJSONArray("projects").objects().map { Project(it.getString("name"), it.nullableString("path")) },
            result.getJSONArray("labels").objects().map(Label::parse),
            providers.map { it.getString("id") }.distinct(),
            attachments = result.optBoolean("attachments"),
        )
    }

    suspend fun events(cursor: Long): JSONObject =
        post("events", json("cursor" to cursor, "waitMs" to 25000))

    suspend fun disconnect() {
        postAt("/dsbot/api/v1/disconnect", JSONObject(), timeoutSeconds = 2, allowRetired = true)
    }

    suspend fun upload(id: String, name: String, length: Long?, open: () -> java.io.InputStream): JSONObject = withContext(Dispatchers.IO) {
        if (retired) throw CancellationException("Computer switched")
        val requestId = UUID.randomUUID().toString()
        val body = object : RequestBody() {
            override fun contentType() = "application/octet-stream".toMediaType()
            override fun contentLength() = length ?: -1
            override fun isOneShot() = true
            override fun writeTo(sink: okio.BufferedSink) {
                open().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        if (retired) throw IOException("Computer switched")
                        val count = input.read(buffer)
                        if (count < 0) break
                        sink.write(buffer, 0, count)
                    }
                }
            }
        }
        val url = "${endpoint.origin}/dsbot/api/v1/file/upload".toHttpUrl().newBuilder()
            .addQueryParameter("id", id).addQueryParameter("name", name).build()
        val request = Request.Builder().url(url).header("Authorization", "Bearer ${endpoint.token}")
            .header("X-Dudu-Request-ID", requestId).header("X-Dudu-Client", "android")
            .header("Accept-Language", language.ifBlank { Locale.getDefault().toLanguageTag() })
            .post(body).build()
        val started = System.nanoTime()
        val response = try { client.newCall(request).await() } catch (error: Exception) {
            if (error !is CancellationException) DuduLog.failure("file.upload.fail", error, requestId = requestId,
                elapsedMs = (System.nanoTime() - started) / 1_000_000)
            throw error
        }
        response.use {
            DuduLog.record("file.upload.answer", requestId = requestId, elapsedMs = (System.nanoTime() - started) / 1_000_000,
                counts = mapOf("httpStatus" to it.code.toLong()))
            val text = it.body?.source()?.let { source ->
                val buffer = okio.Buffer()
                while (true) { val count = source.read(buffer, 8192); if (count < 0) break; if (buffer.size > 65536) throw ApiFailure("PROTOCOL_ERROR") }
                buffer.readUtf8()
            } ?: throw ApiFailure("PROTOCOL_ERROR")
            val result = JSONObject(text)
            if (!it.isSuccessful || !result.optBoolean("ok")) throw ApiFailure(result.optJSONObject("error")?.optString("code") ?: "UPSTREAM_ERROR")
            if (result.optString("id") != requestId || retired) throw ApiFailure("PROTOCOL_ERROR")
            result.getJSONObject("result")
        }
    }

    suspend fun video(params: JSONObject, open: () -> java.io.OutputStream): String = withContext(Dispatchers.IO) {
        if (retired) throw CancellationException("Computer switched")
        val request = Request.Builder().url("${endpoint.origin}/dsbot/api/v1/file/video")
            .header("Authorization", "Bearer ${endpoint.token}").header("X-Dudu-Request-ID", UUID.randomUUID().toString())
            .header("X-Dudu-Client", "android")
            .header("Accept", "video/*").post(params.toString().toRequestBody("application/json".toMediaType())).build()
        client.newCall(request).await().use { response ->
            if (!response.isSuccessful) throw ApiFailure("UPSTREAM_ERROR")
            val type = response.header("Content-Type").orEmpty().substringBefore(';')
            if (type !in listOf("video/mp4", "video/x-m4v", "video/quicktime")) throw ApiFailure("PROTOCOL_ERROR")
            val expected = response.header("X-Dudu-File-Bytes")?.toLongOrNull()?.takeIf { it > 0 } ?: throw ApiFailure("PROTOCOL_ERROR")
            val stream = response.body?.byteStream() ?: throw ApiFailure("PROTOCOL_ERROR")
            open().use { output ->
                val buffer = ByteArray(64 * 1024)
                var received = 0L
                while (true) {
                    if (retired) throw CancellationException("Computer switched")
                    val count = stream.read(buffer)
                    if (count < 0) break
                    received += count
                    if (received > expected) throw ApiFailure("PROTOCOL_ERROR")
                    output.write(buffer, 0, count)
                }
                if (received != expected) throw ApiFailure("PROTOCOL_ERROR")
            }
            type
        }
    }

    suspend fun openPage(page: String, target: String?, sessionId: String?, computerId: String): OpenPage {
        val value = postAt("/dsbot/web/open", json("page" to page).apply {
            target?.let { put("target", it) }; sessionId?.let { put("sessionId", it) }
        })
        return OpenPage.parse(value, endpoint.origin, computerId)
    }

    suspend fun closePage(page: OpenPage) = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(page.url + "rpc")
            .header("Cookie", "dsbot_ui=${page.cookie}").header("X-DSBot-Page", "1")
            .post(json("method" to "web.close", "params" to json()).toString()
                .toRequestBody("application/json".toMediaType())).build()
        runCatching {
            val call = client.newCall(request)
            call.timeout().timeout(3, TimeUnit.SECONDS)
            call.await().close()
        }
        Unit
    }

    private suspend fun post(route: String, body: JSONObject): JSONObject =
        postAt("/dsbot/api/v1/$route", body)

    private suspend fun postAt(path: String, body: JSONObject, origin: String = endpoint.origin,
        authenticated: Boolean = true, maxBytes: Long = 24 * 1024 * 1024,
        timeoutSeconds: Long? = null, allowRetired: Boolean = false): JSONObject = withContext(Dispatchers.IO) {
        if (retired && !allowRetired) throw CancellationException("Computer switched")
        val trace = Trace()
        val builder = Request.Builder().url("$origin$path")
            .header("X-Dudu-Client", "android")
            .header("Accept-Language", language.ifBlank { Locale.getDefault().toLanguageTag() })
            .header("Cache-Control", "no-store")
            .tag(Trace::class.java, trace)
        if (authenticated) builder.header("Authorization", "Bearer ${endpoint.token}")
        builder.post(body.toString().toRequestBody("application/json; charset=utf-8".toMediaType()))
        val call = client.newCall(builder.build())
        timeoutSeconds?.let { call.timeout().timeout(it, TimeUnit.SECONDS) }
        // The diagnostics name a request by its route and method, the address by its kind, never by the address itself.
        val route = path.substringAfterLast('/')
        val method = if (route == "request") body.optString("method") else null
        val requestId = if (route == "request") body.optString("id") else null
        val started = System.nanoTime()
        var status = 0L
        var size = 0L
        fun elapsed() = (System.nanoTime() - started) / 1_000_000
        fun met() = "$route.${if (trace.fresh) "fresh" else "pooled"}.${runCatching { ConnectionAddress.parse(origin).kind }.getOrDefault("unknown")}"
        fun measured() = buildMap {
            if (status > 0) put("httpStatus", status)
            if (size > 0) put("payloadBytes", size)
            trace.idleMs?.let { put("idleMs", it) }
        }
        try {
            val response = call.await()
            response.use {
                status = it.code.toLong()
                val source = it.body?.source() ?: throw ApiFailure("PROTOCOL_ERROR")
                // Bound decompressed bytes, including a response without Content-Length.
                val buffer = okio.Buffer()
                while (true) {
                    val count = source.read(buffer, 8192)
                    if (count == -1L) break
                    size += count
                    if (size > maxBytes) throw ApiFailure("LIMIT_EXCEEDED")
                }
                val data = try { JSONObject(buffer.readUtf8()) } catch (_: Exception) { throw ApiFailure("PROTOCOL_ERROR") }
                if (!it.isSuccessful) throw ApiFailure(data.optJSONObject("error")?.optString("code") ?: "UPSTREAM_ERROR")
                // A long poll that came back is counted by the one who polls (`events.batch`, `events.idle`): a line each would fill the file.
                if (route != "events") DuduLog.record("http.request.complete", method = method, requestId = requestId,
                    elapsedMs = elapsed(), counts = measured(), state = met())
                data
            }
        } catch (error: Exception) {
            if (error !is CancellationException) DuduLog.record("http.request.fail", "warn", method = method, requestId = requestId,
                elapsedMs = elapsed(), counts = measured(), state = met(), code = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED",
                detail = if (error is ApiFailure) null else DuduLog.describe(error))
            throw error
        }
    }
}

private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
    continuation.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) {
            if (continuation.isActive) continuation.resumeWithException(e)
        }
        override fun onResponse(call: Call, response: Response) {
            continuation.resume(response) { _, resource, _ -> resource.close() }
        }
    })
}
