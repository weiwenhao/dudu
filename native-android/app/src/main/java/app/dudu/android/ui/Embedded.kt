package app.dudu.android.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.*
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import java.io.ByteArrayInputStream
import java.io.FilterInputStream
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

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
                .header("Cookie", "dsbot_ui=${page.cookie}")
                .header("Cache-Control", "no-store")
                .header("Accept-Language", language.ifBlank { java.util.Locale.getDefault().toLanguageTag() })
            for (key in listOf("Accept", "Range", "Last-Event-ID", "X-DSBot-Page")) {
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

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun EmbeddedScreen(route: Route, state: UiState, model: DuduViewModel) {
    val actions = rememberActions()
    val context = LocalContext.current
    var opened by remember { mutableStateOf<OpenPage?>(null) }
    var loading by remember { mutableStateOf(true) }
    var webView by remember { mutableStateOf<WebView?>(null) }
    var leaving by remember { mutableStateOf(false) }
    LaunchedEffect(actions.revision) {
        actions.run {
            opened?.let { model.closePage(it) }
            opened = model.openPage(route.params.optString("page", "plugins"), route.target,
                route.params.nullableString("sessionId") ?: state.session?.id)
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            opened?.let { page ->
                if (!leaving) model.releasePage(page)
                CookieManager.getInstance().setCookie(page.url, "dsbot_ui=; Path=${page.path}; Max-Age=0; HttpOnly")
            }
        }
    }
    Page(route.title, {
        if (webView?.canGoBack() == true) webView?.goBack()
        else {
            if (!leaving) { leaving = true; opened?.let(model::releasePage) }
            model.backRoute()
        }
    }, actions, top = {
        IconButton(onClick = { if (webView != null && actions.error == null) webView?.reload() else actions.refresh() }) {
            Glyph(R.drawable.ic_refresh_cw, w("刷新"))
        }
    }) {
        if (loading && opened != null) LinearProgressIndicator(Modifier.fillMaxWidth())
        opened?.let { page ->
            key(page.id) {
                val loader = remember(page.id) { ScopedPageLoader(page, state.language) }
                var failed by remember { mutableStateOf(false) }
                DisposableEffect(loader) {
                    val workers = ServiceWorkerController.getInstance()
                    workers.serviceWorkerWebSettings.apply {
                        allowContentAccess = false; allowFileAccess = false; cacheMode = WebSettings.LOAD_NO_CACHE
                    }
                    workers.setServiceWorkerClient(object : ServiceWorkerClient() {
                        override fun shouldInterceptRequest(request: WebResourceRequest) = loader.read(request)
                    })
                    onDispose {
                        workers.setServiceWorkerClient(object : ServiceWorkerClient() {
                            override fun shouldInterceptRequest(request: WebResourceRequest) = ScopedPageLoader.denied()
                        })
                        loader.close()
                    }
                }
                if (!failed) AndroidView(modifier = Modifier.fillMaxSize(), onRelease = { view ->
                    if (webView === view) webView = null
                    if (!failed) { view.stopLoading(); view.loadUrl("about:blank"); view.clearHistory(); view.destroy() }
                }, factory = {
                    WebView(context).apply {
                        webView = this
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
                                (view.parent as? android.view.ViewGroup)?.removeView(view)
                                view.destroy(); webView = null; failed = true; loading = false
                                actions.error = "UPSTREAM_UNAVAILABLE"
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
                            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                                return loader.read(request)
                            }
                            override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) { loading = true }
                            override fun onPageFinished(view: WebView, url: String?) { loading = false }
                            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                                if (request.isForMainFrame) { loading = false; actions.error = "CONNECTION_FAILED" }
                            }
                            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                                if (request.isForMainFrame && response.statusCode >= 400) {
                                    loading = false; actions.error = "CONNECTION_FAILED"
                                }
                            }
                        }
                        val cookie = "dsbot_ui=${page.cookie}; Path=${page.path}; HttpOnly; SameSite=Strict" +
                            if (page.origin.startsWith("https:")) "; Secure" else ""
                        CookieManager.getInstance().setCookie(page.url, cookie) { accepted ->
                            if (accepted) loadUrl(page.url) else { loading = false; actions.error = "AUTH_FAILED" }
                        }
                    }
                })
            }
        }
    }
}
