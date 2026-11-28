package app.dudu.android.ui

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.dudu.android.DuduViewModel
import app.dudu.android.R
import app.dudu.android.data.*
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

private val secondary = Color(0xFF61666B)

/** What the card shows after its first button: the one thing the connection waits for, or why it did not work. */
private sealed interface Phase {
    data object Intro : Phase
    data object Working : Phase
    data class Code(val code: String, val url: String) : Phase
    data class Command(val missing: Boolean, val command: String, val line: String?) : Phase
    data class Failed(val reason: String) : Phase
}

/**
 * Muse's card (owner, 2026-11-23; the iPhone's `ConnectorSheet`): what connecting means in three points and one button; then the one thing the connection waits for (the sign-in
 * page, opened here on the phone; a code; a command to run on the computer) until it is connected (the card closes and says so) or did not work (it says why, with 重试). Closing it
 * gives up a first connection: the plugin keeps nothing of it. `offer` is a row's `connect` (`SettingsPages`): id, name, icon, line, how, reconnect.
 */
@Composable
internal fun ConnectorSheet(offer: JSONObject, model: DuduViewModel, onChanged: () -> Unit, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val itemID = offer.optString("id")
    val name = offer.optString("name")
    val how = offer.optString("how", "oauth")
    val signsIn = how in setOf("oauth", "open", "device")
    var phase by remember { mutableStateOf<Phase>(Phase.Intro) }
    var busy by remember { mutableStateOf(false) }
    var connectorID by remember { mutableStateOf<String?>(null) }
    var signInPage by remember { mutableStateOf<String?>(null) }
    var known by remember { mutableStateOf(emptySet<String>()) }
    var finished by remember { mutableStateOf(false) }
    var watching by remember { mutableStateOf(0) }
    val connected = w("已连接 {0}")
    val failedAuth = w("连接失败：授权未完成")
    val failedWith = w("连接失败：{0}")

    suspend fun act(act: String, args: JSONObject): JSONObject =
        model.request("settings.act", json("section" to "connectors", "name" to act, "args" to args), timeoutSeconds = 45)
    suspend fun list(): JSONObject? = runCatching {
        model.request("settings.data", json("section" to "connectors")).optJSONObject("data")?.optJSONObject("connectors/list")
    }.getOrNull()
    fun attemptKeys(list: JSONObject?) = list?.rows("attempts").orEmpty().map { "${it.optString("id")}@${it.opt("at")}" }.toSet()
    fun fail(message: String? = null) {
        busy = false; watching = 0
        phase = Phase.Failed(if (signsIn || message.isNullOrEmpty()) failedAuth else failedWith.replace("{0}", message))
    }
    fun done() {
        finished = true; busy = false; watching = 0
        model.toast(connected.replace("{0}", name), ToastKind.Success, literal = true)
        onChanged(); close()
    }
    fun start() = scope.launch {
        busy = true
        known = attemptKeys(list())
        try {
            if (signsIn) {
                val answer = act("signin", json("id" to (connectorID ?: itemID)))
                val signin = answer.optJSONObject("signin")
                signin?.nullableString("id")?.let { connectorID = it }
                if (answer.optString("outcome") != "success") return@launch fail()
                val page = signin?.nullableString("url")
                val code = signin?.nullableString("code")
                when {
                    page != null && code != null -> { phase = Phase.Code(code, page); busy = false; watching++ }
                    page != null -> { phase = Phase.Working; signInPage = page }
                    signin?.nullableString("status") == "connected" -> done()
                    else -> fail(signin?.nullableString("message"))
                }
            } else {
                val answer = act("connect", json("id" to itemID))
                if (answer.optString("outcome") != "success") return@launch fail(answer.nullableString("message"))
                phase = Phase.Working; watching++
            }
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            fail()
        }
    }
    fun finishSignIn(callback: String) = scope.launch {
        val id = connectorID ?: return@launch fail()
        busy = true
        try {
            val answer = act("signin-finish", json("id" to id, "url" to callback))
            val status = answer.optJSONObject("signin")?.nullableString("status")
            when {
                answer.optString("outcome") == "success" && status == "connected" -> done()
                status == "waiting" -> watching++
                else -> fail(answer.optJSONObject("signin")?.nullableString("message"))
            }
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            fail()
        }
    }
    fun recheck() = scope.launch {
        busy = true
        runCatching { act("verb", json("id" to (connectorID ?: itemID), "verb" to "retry")) }
        watching++
    }
    fun giveUp() {
        if (finished) return
        val id = connectorID ?: if (how == "cli") itemID else null
        // The card is gone with the screen: the plugin's cancel goes on in the model's own scope.
        if (id != null) model.viewModelScope.launch { runCatching { act("verb", json("id" to id, "verb" to "cancel")) }; onChanged() }
    }

    // Reads the connectors again every 1.5 s until this one is connected, waits for something of the owner, or did not work.
    LaunchedEffect(watching) {
        if (watching == 0) return@LaunchedEffect
        while (true) {
            delay(1_500)
            val read = list() ?: continue
            val mine = read.rows("connectors").firstOrNull {
                val id = it.optString("id")
                id == connectorID || id == itemID || it.nullableString("from") == itemID
            }
            if (mine != null) {
                connectorID = mine.optString("id")
                val state = mine.optJSONObject("state")
                val status = state?.nullableString("status")
                if (!mine.optBoolean("fresh") && status == null) return@LaunchedEffect done()
                val command = state?.nullableString("command")
                if ((status == "needs-login" || status == "missing") && command != null) {
                    val missing = status == "missing"
                    phase = Phase.Command(missing, command, state.nullableString(if (missing) "install" else "login")); busy = false
                } else if (status == "waiting" && state?.nullableString("code") != null && state.nullableString("url") != null) {
                    phase = Phase.Code(state.getString("code"), state.getString("url")); busy = false
                }
            } else {
                val attempt = read.rows("attempts").firstOrNull {
                    "${it.optString("id")}@${it.opt("at")}" !in known && (it.nullableString("from") == itemID || it.optString("id") == connectorID)
                }
                if (attempt != null) return@LaunchedEffect fail(attempt.nullableString("message"))
            }
        }
    }
    LaunchedEffect(Unit) { if (how == "cli" || offer.optBoolean("reconnect")) start() }
    DisposableEffect(Unit) { onDispose { giveUp() } }

    DuduSheet(dismiss = close, containerColor = Color.White) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 26.dp).padding(bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(14.dp))
            ConnectorAvatar(offer.nullableString("icon"), name, 60)
            Text(name, Modifier.padding(top = 12.dp), fontSize = 22.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
            offer.nullableString("line")?.takeIf { it.isNotEmpty() }?.let {
                Text(it, Modifier.padding(top = 4.dp), fontSize = 15.sp, color = secondary, textAlign = TextAlign.Center, maxLines = 2)
            }
            Spacer(Modifier.height(22.dp))
            when (val shown = phase) {
                is Phase.Code -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(shown.code, fontSize = 34.sp, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace, letterSpacing = 4.sp)
                    Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = secondary)
                        Text(w("请在 {0} 输入此验证码").replace("{0}", name), Modifier.padding(start = 6.dp), fontSize = 14.sp, color = secondary)
                    }
                }
                is Phase.Command -> Column(Modifier.fillMaxWidth()) {
                    Text((if (shown.missing) w("未找到 {0}") else w("{0} 未登录")).replace("{0}", shown.command), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    shown.line?.let { line ->
                        Text(if (shown.missing) w("请在电脑终端中运行以下命令安装") else w("请在电脑终端中运行以下命令登录"), Modifier.padding(top = 4.dp), fontSize = 14.sp, color = secondary)
                        CommandBox(line, context)
                    }
                }
                else -> if (how == "cli") CircularProgressIndicator(Modifier.padding(vertical = 12.dp).size(24.dp), strokeWidth = 2.dp)
                else Points(name, signsIn)
            }
            (phase as? Phase.Failed)?.let {
                Text(it.reason, Modifier.padding(top = 18.dp), fontSize = 14.sp, color = SwipeColors.delete, textAlign = TextAlign.Center)
            }
            val primary = when (phase) {
                Phase.Intro -> if (how == "cli") null else w("连接")
                Phase.Working -> w("连接")
                is Phase.Failed -> w("重试")
                is Phase.Code -> w("复制并打开")
                is Phase.Command -> w("重新检查")
            }
            primary?.let { title ->
                Surface(onClick = {
                    when (val shown = phase) {
                        is Phase.Code -> {
                            copy(context, shown.code)
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(shown.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        }
                        is Phase.Command -> recheck()
                        else -> start()
                    }
                }, enabled = !busy, shape = CircleShape, color = DuduStyle.blue.copy(alpha = if (busy) .6f else 1f),
                    modifier = Modifier.padding(top = 24.dp).fillMaxWidth().height(52.dp).testTag("connector-sheet-primary")) {
                    Box(contentAlignment = Alignment.Center) {
                        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White)
                        else Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    }
                }
            }
            Text(w("取消"), Modifier.padding(top = 8.dp).heightIn(min = 44.dp).clickable(role = Role.Button) { close() }.wrapContentHeight(),
                fontSize = 16.sp, color = DuduStyle.blue)
        }
    }
    signInPage?.let { page ->
        SignInBrowser(page, onCallback = { callback -> signInPage = null; finishSignIn(callback) }) { signInPage = null; close() }
    }
}

@Composable
private fun Points(name: String, signsIn: Boolean) {
    val points = listOf(
        if (signsIn) Triple(R.drawable.ic_log_in, w("登录 {0}").replace("{0}", name), w("在手机上打开 {0} 登录页，授权后自动返回").replace("{0}", name))
        else Triple(R.drawable.ic_square_terminal, w("在这台电脑上运行"), w("嘟嘟将在电脑上启动 {0} 并读取其工具").replace("{0}", name)),
        Triple(R.drawable.ic_sparkles, w("嘟嘟和智能体可用"), w("连接后，嘟嘟、收集器和会话中的智能体均可使用 {0} 的工具").replace("{0}", name)),
        Triple(R.drawable.ic_unplug, w("可随时断开"), w("在连接器中打开 {0} 即可断开").replace("{0}", name)),
    )
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        points.forEach { (icon, title, text) ->
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Glyph(icon, null, 22, MaterialTheme.colorScheme.onSurface)
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Text(text, fontSize = 14.sp, lineHeight = 20.sp, color = secondary)
                }
            }
        }
    }
}

@Composable
private fun CommandBox(line: String, context: Context) {
    Row(Modifier.padding(top = 14.dp).fillMaxWidth().background(Color(0xFFF4F5F7), RoundedCornerShape(14.dp)).padding(horizontal = 14.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Glyph(R.drawable.ic_square_terminal, null, 18, secondary)
        Text(line, Modifier.weight(1f), fontSize = 14.sp, fontFamily = FontFamily.Monospace)
        Row(Modifier.clickable(role = Role.Button) { copy(context, line) }, verticalAlignment = Alignment.CenterVertically) {
            Glyph(R.drawable.ic_copy, null, 15, DuduStyle.blue)
            Text(w("复制"), Modifier.padding(start = 4.dp), fontSize = 15.sp, color = DuduStyle.blue)
        }
    }
}

private fun copy(context: Context, text: String) {
    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("", text))
}

/**
 * The service's sign-in page in a browser view of the app (owner, 2026-11-23: 「在手机上点，就在手机上连接吧」). The plugin registered its redirect as the computer's own address
 * (`http://127.0.0.1:<port>/oauth/callback`, which the phone cannot reach): the view stops at it instead of loading it and hands the whole address over; the plugin checks it and
 * finishes the sign-in. ✕ closes it and gives up.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun SignInBrowser(page: String, onCallback: (String) -> Unit, onClose: () -> Unit) {
    var loading by remember { mutableStateOf(true) }
    Dialog(onDismissRequest = onClose, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false)) {
        Column(Modifier.fillMaxSize().background(Color.White).systemBarsPadding()) {
            Box(Modifier.fillMaxWidth().height(50.dp)) {
                Box(Modifier.align(Alignment.CenterStart).padding(start = 8.dp).size(44.dp).clickable(role = Role.Button, onClick = onClose), contentAlignment = Alignment.Center) {
                    BarGlyph(DuduGlyphs.close, w("取消"))
                }
                Text(Uri.parse(page).host.orEmpty(), Modifier.align(Alignment.Center).padding(horizontal = 56.dp), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp), color = DuduStyle.blue) else HorizontalDivider()
            AndroidView(modifier = Modifier.fillMaxSize(), factory = { context ->
                CookieManager.getInstance().removeAllCookies(null)
                WebView(context).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = true
                    var delivered = false
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                            val url = request.url
                            val callback = url.scheme == "http" && url.host in setOf("127.0.0.1", "localhost") && url.path == "/oauth/callback"
                            if (callback && !delivered) { delivered = true; onCallback(url.toString()) }
                            return callback
                        }
                        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) { loading = true }
                        override fun onPageFinished(view: WebView, url: String?) { loading = false }
                    }
                    loadUrl(page)
                }
            })
        }
    }
}
