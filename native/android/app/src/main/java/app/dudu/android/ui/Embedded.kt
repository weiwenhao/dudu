package app.dudu.android.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.ViewGroup
import android.webkit.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import app.dudu.android.*
import app.dudu.android.data.*
import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit
import org.json.JSONObject

internal class ScopedPageLoader(private val page: OpenPage, private val language: String) {
    private val client = OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .retryOnConnectionFailure(false).readTimeout(40, TimeUnit.SECONDS).build()
    fun close() { client.dispatcher.cancelAll(); client.connectionPool.evictAll() }
    fun read(request: WebResourceRequest): WebResourceResponse? {
        if (!page.allows(request.url.toString())) return denied()
        // Android does not expose POST bodies here. Scoped RPC posts remain in WebView;
        // intercepted GETs cannot follow a redirect outside their page scope.
        if (request.method != "GET") return null
        return runCatching {
            val builder = Request.Builder().url(request.url.toString())
                .header("Cookie", "dudu_ui=${page.cookie}")
                .header("Cache-Control", "no-store")
                .header("Accept-Language", language.ifBlank { java.util.Locale.getDefault().toLanguageTag() })
            for (key in listOf("Accept", "Range", "Last-Event-ID", "X-Dudu-Page")) {
                request.requestHeaders.entries.find { it.key.equals(key, true) }?.value?.let { builder.header(key, it) }
            }
            val response = client.newCall(builder.build()).execute()
            if (response.code in 300..399) { response.close(); denied() }
            else {
                val body = response.body ?: run { response.close(); return@runCatching denied() }
                val media = body.contentType()
                val stream = object : FilterInputStream(body.byteStream()) {
                    override fun close() { super.close(); response.close() }
                }
                WebResourceResponse(media?.let { "${it.type}/${it.subtype}" } ?: "application/octet-stream",
                    media?.charset()?.name() ?: "utf-8", response.code, response.message.ifEmpty { "Response" },
                    response.headers.toMap().filterKeys { !it.equals("Set-Cookie", true) }, stream)
            }
        }.getOrElse { denied() }
    }
    companion object {
        fun denied() = WebResourceResponse("text/plain", "utf-8", 403, "Forbidden",
            mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(byteArrayOf()))
    }
}

/** One page of DSH that is open: its page session on the computer, what reads its files, its web view, and whether it has loaded or failed. */
internal class PooledPage(
    val key: String, val connection: String, val kind: String, val page: OpenPage, val loader: ScopedPageLoader,
    val target: String? = null, val sessionId: String? = null,
) {
    var view: WebView? = null
    var loading by mutableStateOf(true)
    var failed by mutableStateOf(false)
    /** The page got the iPhone's bridge (`PageBridge`): a DSH page then says itself when it is ready, instead of when its document has loaded. */
    internal var bridged = false

    fun ready() {
        if (discarded) return
        if (loading) DuduLog.record("web.page.ready", elapsedMs = SystemClock.elapsedRealtime() - openedAt, state = kind)
        loading = false; failed = false
    }

    fun fail(state: String) {
        if (discarded) return
        DuduLog.record("web.bootstrap.fail", "warn", state = state)
        loading = false; failed = true
    }

    /** What the iPhone's page bridge sends to `window.__DUDU_PAGE__` (`EmbeddedPageConfiguration`). */
    fun bridgeConfig(): JSONObject = JSONObject()
        .put("id", page.id).put("kind", kind).put("transport", "http").put("basePath", page.path)
        .apply { sessionId?.let { put("sessionId", it) }; target?.let { put("target", it) } }

    /**
     * The iPhone's answers to what a page asks (`EmbeddedPageView`'s message handler), in http transport: null for what it may not ask. DSH's settings list comes from the plugin's
     * navigation, and the catalog is read again whenever DSH's settings are left, so the settings page's own list and its changes need nothing more here.
     */
    fun answer(method: String, params: JSONObject?): String? {
        if (discarded) return null
        val only = { key: String -> params?.takeIf { it.length() == 1 }?.optString(key)?.takeIf { it.isNotEmpty() } }
        return when (method) {
            "ready" -> { ready(); "true" }
            "interaction" -> only("action")?.takeIf { it in INTERACTIONS }?.let { DuduLog.record("web.interaction", state = "$kind.$it"); "true" }
            "error" -> { fail("page"); "true" }
            "bootstrap.failure" -> only("kind")?.takeIf { it in BOOT_FAILURES }?.let { fail(it); "true" }
            "rpc.failure" -> only("endpoint")?.let { DuduLog.record("web.rpc.fail", "warn", state = kind); "true" }
            "settings.categories" -> if (kind == "settings" && params != null) "true" else null
            "settings.mutated" -> if (kind == "settings" && (params == null || params.length() == 0)) "true" else null
            else -> null
        }
    }

    private companion object {
        val INTERACTIONS = setOf("search", "expand", "collapse", "detail", "back", "tab", "change")
        val BOOT_FAILURES = setOf("page", "script", "resource")
    }
    val openedAt = SystemClock.elapsedRealtime()
    internal var leftAt: Long? = null
    internal var expiry: Job? = null
    /** The connection changed while the page was on screen: it is closed once it is left. */
    internal var outdated = false
    internal var discarded = false

    /** The web view goes once it is no longer on screen (a view still in the window is let go by its screen). */
    fun destroyView() {
        val shown = view ?: return
        if (shown.parent != null) return
        view = null
        shown.stopLoading(); shown.loadUrl("about:blank"); shown.clearHistory(); shown.destroy()
        DuduLog.record("web.view.unmount")
    }
}

/**
 * DSH's pages stay loaded for five minutes after they are left, three at most (the iPhone's `EmbeddedPagePool`): coming back shows the page at once instead of booting DSH's frontend
 * again. A page opened on an older connection is closed (one still on screen once it is left), and a page that failed is never kept. The app going to the background closes the
 * pages it kept.
 */
internal class EmbeddedPagePool(private val scope: CoroutineScope, private val release: (OpenPage) -> Unit) {
    private val pages = mutableMapOf<String, PooledPage>()
    private var connection = ""
    /** What the service workers of the open pages may read, kept apart from `pages` for the web view's own threads. */
    @Volatile private var loaders: List<PooledPage> = emptyList()

    fun start() {
        runCatching {
            val workers = ServiceWorkerController.getInstance()
            workers.serviceWorkerWebSettings.apply {
                allowContentAccess = false; allowFileAccess = false; cacheMode = WebSettings.LOAD_NO_CACHE
            }
            workers.setServiceWorkerClient(object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest): WebResourceResponse? {
                    val url = request.url.toString()
                    return loaders.firstOrNull { it.page.allows(url) }?.loader?.read(request) ?: ScopedPageLoader.denied()
                }
            })
        }
    }

    fun connectionChanged(next: String) {
        if (next == connection) return
        connection = next
        pages.values.toList().forEach { if (it.leftAt != null) discard(it) else it.outdated = true }
    }

    /** The page kept for `key` on this connection, in use again; null when there is none. */
    fun take(key: String): PooledPage? {
        val kept = pages[key] ?: return null
        if (kept.connection != connection || kept.failed || kept.outdated) { discard(kept); return null }
        kept.expiry?.cancel(); kept.expiry = null; kept.leftAt = null
        return kept
    }

    fun adopt(entry: PooledPage) {
        pages[entry.key]?.takeIf { it !== entry }?.let(::discard)
        pages[entry.key] = entry
        loaders = pages.values.toList()
    }

    /** The screen left the page: kept for five minutes, unless it failed or belongs to an older connection. */
    fun leave(entry: PooledPage) {
        if (pages[entry.key] !== entry || entry.outdated || entry.failed || entry.connection != connection) { discard(entry); return }
        entry.leftAt = SystemClock.elapsedRealtime()
        entry.expiry?.cancel()
        entry.expiry = scope.launch { delay(300_000); discard(entry) }
        pages.values.filter { it.leftAt != null }.sortedBy { it.leftAt }.dropLast(3).forEach(::discard)
    }

    fun discardReleased() = pages.values.filter { it.leftAt != null }.toList().forEach(::discard)

    fun discard(entry: PooledPage) {
        if (entry.discarded) return
        entry.discarded = true
        if (pages[entry.key] === entry) pages.remove(entry.key)
        loaders = pages.values.toList()
        entry.expiry?.cancel()
        entry.destroyView()
        entry.loader.close()
        CookieManager.getInstance().setCookie(entry.page.url, "dudu_ui=; Path=${entry.page.path}; Max-Age=0; HttpOnly")
        release(entry.page)
        DuduLog.record("web.page.close", state = entry.kind)
    }

    fun clear() {
        pages.values.toList().forEach(::discard)
        runCatching {
            ServiceWorkerController.getInstance().setServiceWorkerClient(object : ServiceWorkerClient() {
                override fun shouldInterceptRequest(request: WebResourceRequest) = ScopedPageLoader.denied()
            })
        }
    }
}

/** The app's page pool, provided by `MainActivity` for every screen. */
internal val LocalPagePool = staticCompositionLocalOf<EmbeddedPagePool?> { null }

/**
 * A page of DSH (or of the plugin) in the app, the iPhone's `EmbeddedPageView`: white with a spinner in the middle until it has loaded, its failure in the middle with 重试, and no other
 * control of its own (the 刷新 the Android page had is gone: owner, 2026-11-22). Pages are kept for a while after they are left (`EmbeddedPagePool`).
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EmbeddedScreen(route: Route, state: UiState, model: DuduViewModel) {
    val provided = LocalPagePool.current
    val fallbackScope = rememberCoroutineScope()
    val pool = provided ?: remember { EmbeddedPagePool(fallbackScope, model::releasePage).also { it.start() } }
    if (provided == null) DisposableEffect(pool) { onDispose { pool.clear() } }
    val kind = route.params.optString("page", "plugins")
    // Only a conversation's own pages are opened on a conversation (the iPhone's `needsSession`).
    val sessionId = if (embeddedPageNeedsSession(kind)) route.params.nullableString("sessionId") ?: state.session?.id else null
    val key = "$kind/${route.target.orEmpty()}/${sessionId.orEmpty()}"
    val connection = "${state.computerId}/${model.connectionRevision}"
    var entry by remember { mutableStateOf<PooledPage?>(null) }
    var openFailure by remember { mutableStateOf<String?>(null) }
    var attempt by remember { mutableIntStateOf(0) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    LaunchedEffect(attempt, connection, state.connected) {
        pool.connectionChanged(connection)
        if (entry?.let { it.connection == connection && !it.failed && !it.discarded } == true) return@LaunchedEffect
        entry = null
        openFailure = null
        pool.take(key)?.let { entry = it; return@LaunchedEffect }
        if (!state.connected) return@LaunchedEffect
        DuduLog.record("web.page.open", state = kind)
        try {
            val opened = model.openPage(kind, route.target, sessionId)
            DuduLog.record("web.page.handle", state = kind)
            PooledPage(key, connection, kind, opened, ScopedPageLoader(opened, state.language), route.target, sessionId)
                .also { pool.adopt(it); entry = it }
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            DuduLog.failure("web.page.fail", error, state = kind)
            openFailure = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
        }
    }
    // The first visit downloads DSH's frontend: a page that has not loaded in 60 s has failed (the iPhone's `readyTimeout`).
    val loading = entry?.loading == true
    LaunchedEffect(entry, loading) {
        val shown = entry ?: return@LaunchedEffect
        if (!shown.loading) return@LaunchedEffect
        delay((60_000 - (SystemClock.elapsedRealtime() - shown.openedAt)).coerceAtLeast(0))
        if (shown.loading) { shown.loading = false; shown.failed = true; DuduLog.record("web.page.fail", "warn", state = "$kind.timeout") }
    }
    DisposableEffect(Unit) {
        onDispose {
            entry?.let(pool::leave)
            // DSH's own settings may have changed the models or the permissions (the iPhone reads its catalog again after a settings change).
            if (kind == "settings") model.refreshCatalog()
        }
    }
    val surface = MaterialTheme.colorScheme.surface
    Page(route.title, {
        if (webView?.canGoBack() == true) webView?.goBack() else model.backRoute()
    }, background = surface) {
        Box(Modifier.fillMaxSize().background(surface).testTag("embedded-$kind")) {
            val shown = entry
            if (shown != null) key(shown) {
                AndroidView(modifier = Modifier.fillMaxSize().alpha(if (shown.loading || shown.failed) 0f else 1f), onRelease = { view ->
                    if (webView === view) webView = null
                    (view.parent as? ViewGroup)?.removeView(view)
                    if (shown.discarded) shown.destroyView()
                }, factory = { context ->
                    val view = shown.view ?: createPageView(context, shown).also { shown.view = it }
                    (view.parent as? ViewGroup)?.removeView(view)
                    webView = view
                    view
                })
            }
            val failure = openFailure?.let { problemText(it) } ?: if (shown?.failed == true) w("页面未能打开") else null
            if (failure != null) Box(Modifier.fillMaxSize().background(surface), contentAlignment = Alignment.Center) {
                Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(failure, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                    TextButton(onClick = {
                        shown?.let(pool::discard)
                        entry = null
                        attempt++
                    }, modifier = Modifier.heightIn(min = 44.dp).testTag("embedded-retry")) {
                        Text(w("重试"), fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurface)
                    }
                }
            } else if (shown == null || shown.loading) Box(Modifier.fillMaxSize().background(surface).testTag("embedded-loading"),
                contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.5.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** The web view of one page: the page's scope only, its files read with the page's session, a link outside it opened in the browser when it was tapped. */
@SuppressLint("SetJavaScriptEnabled")
private fun createPageView(context: Context, entry: PooledPage): WebView = WebView(context).apply {
    val page = entry.page
    DuduLog.record("web.view.mount")
    // A web view whose height is WRAP_CONTENT (what Compose gives a view without layout params) lays its page out 0 high so that it can measure it: DSH's shell is
    // `height: 100%` from html down, so its page was there but clipped away, and the screen stayed white (2026-11-22, seen on the emulator: `100dvh` was 0).
    layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    settings.javaScriptEnabled = true
    settings.domStorageEnabled = true
    settings.allowFileAccess = false
    settings.allowContentAccess = false
    settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
    settings.setSupportMultipleWindows(false)
    settings.cacheMode = WebSettings.LOAD_NO_CACHE
    settings.safeBrowsingEnabled = true
    CookieManager.getInstance().setAcceptThirdPartyCookies(this, false)
    webViewClient = object : WebViewClient() {
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            DuduLog.record("web.bootstrap.fail", "warn", state = "process")
            (view.parent as? ViewGroup)?.removeView(view)
            if (entry.view === view) entry.view = null
            view.destroy()
            entry.loading = false; entry.failed = true
            return true
        }
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (page.allows(url)) return false
            if (request.isForMainFrame && request.hasGesture() &&
                request.url.scheme in listOf("http", "https")) {
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, request.url)) }
            }
            return true
        }
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = entry.loader.read(request)
        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            DuduLog.record("web.navigation.start", state = entry.kind)
        }
        override fun onPageFinished(view: WebView, url: String?) {
            if (entry.failed || url == "about:blank") return
            // The document and its files have loaded (the iPhone's line of the same name): what comes after it until `web.page.ready` is DSH starting up.
            if (entry.loading) DuduLog.record("web.navigation.finish", elapsedMs = SystemClock.elapsedRealtime() - entry.openedAt, state = entry.kind)
            // A bridged DSH page boots its frontend after the document has loaded and says when it is ready (the plugin's own pages do not).
            if (entry.bridged && entry.kind != "dudu") return
            entry.ready()
        }
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) {
                DuduLog.record("web.bootstrap.fail", "warn", state = "navigation")
                entry.loading = false; entry.failed = true
            }
        }
        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame && response.statusCode >= 400) {
                DuduLog.record("web.bootstrap.fail", "warn", state = "navigation", counts = mapOf("httpStatus" to response.statusCode.toLong()))
                entry.loading = false; entry.failed = true
            }
        }
    }
    entry.bridged = runCatching { PageBridge.install(this, entry.bridgeConfig(), page.origin) { method, params -> entry.answer(method, params) } }
        .onFailure { DuduLog.failure("web.bridge.fail", it, state = entry.kind) }
        .getOrDefault(false)
    DuduLog.record("web.bridge", state = if (entry.bridged) "installed" else "unsupported")
    val cookie = "dudu_ui=${page.cookie}; Path=${page.path}; HttpOnly; SameSite=Strict" +
        if (page.origin.startsWith("https:")) "; Secure" else ""
    CookieManager.getInstance().setCookie(page.url, cookie) { accepted ->
        if (accepted && !entry.discarded) loadUrl(page.url) else { entry.loading = false; entry.failed = true }
    }
}
