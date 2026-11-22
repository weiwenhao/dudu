package app.dudu.android.ui

import android.content.Context
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * The iPhone's page bridge for DSH's pages in the app (owner, 2026-11-22: a DSH page stayed white on Android, 「很影响用户使用，必须修复」). Before the page's own scripts run, the page is told what
 * it is (`window.__DUDU_PAGE__`: its id, kind, target, session, `transport: "http"`, its base path) and gets the iPhone's own `EmbeddedTransport.js` (copied from the iPhone's resources at build
 * time, `pageBridge` in build.gradle.kts): it gives DSH's frontend `window.__DSH_TRANSPORT__`, so that the page talks to DSH through the plugin's page session (`/ui/<id>/rpc`) instead of the
 * connection it would open to DSH itself, and lets the plugin's mobile adapter lay the page out for a phone. What the page tells the app (ready, failed, a settings change) comes over an
 * origin-scoped message channel, as the iPhone's script message handler.
 */
internal object PageBridge {
    @Volatile private var transport: String? = null

    private fun transport(context: Context): String =
        transport ?: context.assets.open("EmbeddedTransport.js").bufferedReader().use { it.readText() }.also { transport = it }

    /**
     * The iPhone's bridge asks `window.webkit.messageHandlers.dudu.postMessage(text)` and waits for its answer; here that is the `duduNative` object `addWebMessageListener` gives the page,
     * one request and its answer paired by a number.
     */
    private val shim = """
        (() => {
          'use strict';
          if (window.webkit) return;
          let next = 0;
          const waiting = new Map();
          let listening = false;
          const channel = () => {
            const bridge = window.duduNative;
            if (bridge && !listening) {
              listening = true;
              bridge.onmessage = (event) => {
                let reply;
                try { reply = JSON.parse(event.data); } catch { return; }
                const entry = waiting.get(reply && reply.id);
                if (!entry) return;
                waiting.delete(reply.id);
                if (typeof reply.error === 'string') entry.reject(new Error(reply.error));
                else entry.resolve(reply.value);
              };
            }
            return bridge;
          };
          const dudu = Object.freeze({
            postMessage(body) {
              return new Promise((resolve, reject) => {
                const bridge = channel();
                if (!bridge) { reject(new Error('PAGE_CLOSED')); return; }
                const id = ++next;
                waiting.set(id, { resolve, reject });
                try { bridge.postMessage(JSON.stringify({ id, body: String(body) })); }
                catch (error) { waiting.delete(id); reject(error); }
              });
            },
          });
          Object.defineProperty(window, 'webkit', { value: Object.freeze({ messageHandlers: Object.freeze({ dudu }) }), configurable: false });
          channel();
        })();
    """.trimIndent()

    fun supported() = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) &&
        WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)

    /**
     * Gives `view` the bridge for `page` before it is loaded; false when this phone's web view cannot run a script before the page's own or listen to it (the page then loads as before).
     * `handle` answers what the page asks (`method`, `params`) with the iPhone's answer (`"true"`), or null for what the page may not ask.
     */
    fun install(view: WebView, config: JSONObject, origin: String, handle: (String, JSONObject?) -> String?): Boolean {
        if (!supported()) return false
        val origins = setOf(origin)
        WebViewCompat.addWebMessageListener(view, "duduNative", origins) { _, message, _, isMainFrame, reply ->
            val request = message.data?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return@addWebMessageListener
            val answer = JSONObject().put("id", request.opt("id"))
            val call = runCatching { JSONObject(request.getString("body")) }.getOrNull()
            val result = if (!isMainFrame || call == null) null else handle(call.optString("method"), call.optJSONObject("params"))
            reply.postMessage((if (result != null) answer.put("value", result) else answer.put("error", "UNSUPPORTED")).toString())
        }
        WebViewCompat.addDocumentStartJavaScript(view, "window.__DUDU_PAGE__=$config;\n$shim\n${transport(view.context)}", origins)
        return true
    }
}
