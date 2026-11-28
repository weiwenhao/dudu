package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*

/** The red of a connection's failure on the guide and a computer's page (the iPhone's 0.67, 0.29, 0.27). */
internal val ConnectionFailureRed = Color(0xFFAB4A45)

/** The red of the mark at the end of a computer's row that could not be reached (the iPhone's `chatError`, the error toast's). */
private val ConnectionFailureMark = Color(0xFFEC1313)

/**
 * The connection guide, the iPhone's `ConnectionGuideView`: the logo, 连接嘟嘟, and, for a phone with no computer (the first page after the install) or one whose pairing has to be made again, the steps
 * to take on the computer (`ConnectionSteps`; owner, 2026-11-27, proposal 1 of `.local/designs/phone-first-run-2026-11-27/`); then the main button (重新连接 for a saved computer, else 扫描配对码 / 重新扫码配对)
 * and 粘贴配对链接, which opens the pairing form; nothing is read from the clipboard by itself (owner, 2026-11-22). A phone that has a computer keeps its card with that computer (it opens 电脑连接 when
 * there is more than one), what the connection is doing and the buttons; one without has only the buttons, on the page under the steps. A computer that could not be reached is marked on its own row
 * (its name and address in red, a CircleX at the end); the words of it are the short message at the top, and the line under the card is the phone's own network and address (owner, 2026-11-27).
 */
@Composable
fun PairingScreen(state: UiState, model: DuduViewModel) {
    LaunchedEffect(Unit) { DuduLog.record("connection.guide.open") }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            ConnectionGuideBody(state, model, adding = false, minimum = maxHeight)
        }
    }
}

/**
 * The page that 电脑连接's + pushes for a phone that has a computer already (owner, 2026-11-27: 「再次添加的时候也跳到连接指南那个窗口吧，只是这一次它能返回」, then 「选 A」 of
 * `.local/designs/connection-entry-2026-11-27/boards/add.png`; the iPhone's `ConnectionGuideView(mode: .adding)`): the same guide, with ‹ in the bar and on the sheet's colour. A link that could not be
 * reached is marked on its own card, 重新连接 tries it again; the page holds nothing of it once it is left.
 */
@Composable
fun ConnectGuideScreen(state: UiState, model: DuduViewModel) {
    LaunchedEffect(Unit) { DuduLog.record("connection.guide.add") }
    DisposableEffect(Unit) {
        model.clearPairingAttempt()
        onDispose { model.clearPairingAttempt() }
    }
    Page("", model::backRoute, background = MaterialTheme.colorScheme.surfaceContainer) {
        BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
            ConnectionGuideBody(state, model, adding = true, minimum = maxHeight)
        }
    }
}

@Composable
private fun ConnectionGuideBody(state: UiState, model: DuduViewModel, adding: Boolean, minimum: Dp) {
    val context = LocalContext.current
    val busy = state.connectionInFlight
    val attempt = state.pairingAttempt
    val savedComputer = if (adding) null else state.computers.firstOrNull { it.id == state.computerId } ?: state.computers.firstOrNull()
    val needsNewPairing = !adding && (state.pairingRequired || requiresNewPairing(state.connectionFailure))
    val showsRetry = if (adding) attempt != null else !needsNewPairing && (state.computers.isNotEmpty() || state.connectionFailure != null)
    // The steps were the line under the title in the same two cases: no computer yet, or a pairing that has to be made again. A link that was tried and could not be reached folds them away.
    val showsSteps = if (adding) attempt == null else (state.computers.isEmpty() && attempt == null) || needsNewPairing
    // The card: the saved computer, or the one a pairing tried and could not reach (nothing is saved then).
    val card = if (adding) attempt?.let { it.name to it.address }
        else savedComputer?.let { it.name to shortAddress(it.link).orEmpty() } ?: attempt?.let { it.name to it.address }
    val failure = if (adding) attempt?.problem else attempt?.problem ?: state.connectionFailure
    val failed = card != null && !busy && failure != null
    // The link to try again: the one that failed, when the phone has no saved computer to reach again.
    val retryLink = attempt?.takeIf { adding || savedComputer == null }
    var network by remember { mutableStateOf<PhoneNetwork?>(null) }
    LaunchedEffect(failed) { if (failed) network = PhoneNetwork.current(context) }
    Column(
        Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
            .heightIn(min = minimum).padding(start = 22.dp, end = 22.dp, top = 48.dp, bottom = 96.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Image(painterResource(R.drawable.dudu), null, Modifier.size(64.dp))
        Spacer(Modifier.height(14.dp))
        Text(w("连接嘟嘟"), fontSize = 29.sp, lineHeight = 36.sp, letterSpacing = (-0.7).sp,
            fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
        Spacer(Modifier.height(28.dp))
        Column(Modifier.widthIn(max = 380.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            if (showsSteps) GuideCard { ConnectionSteps() }
            if (card == null) {
                PairingButtons(busy, showsRetry, needsNewPairing, retryLink, model)
            } else {
                GuideCard {
                    GuideComputerRow(card.first, card.second, failed, selectable = savedComputer != null) {
                        DuduLog.record("computers.open"); model.show(Panel.Computers)
                    }
                    PairingButtons(busy, showsRetry, needsNewPairing, retryLink, model)
                }
                if (failed) network?.let {
                    Text(it.footnote(w("本机"), w("蜂窝网络")), Modifier.fillMaxWidth().offset(y = (-4).dp).testTag("pairing-network"),
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                }
            }
        }
    }
}

/**
 * The computer of the card: its icon, the name (15 medium) and the address (12), and, when it could not be reached, both in the red of a failure with a CircleX at the end. Only a phone that has
 * a saved computer can open the list, including a single computer whose connection needs attention.
 */
@Composable
private fun GuideComputerRow(name: String, address: String, failed: Boolean, selectable: Boolean, open: () -> Unit) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth().heightIn(min = 54.dp).testTag(if (selectable) "connection-computers" else "connection-computer")
        .then(if (selectable) Modifier.clickable(onClick = open) else Modifier),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Glyph(DuduGlyphs.computer, size = 22)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(name, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = if (failed) ConnectionFailureRed else Color.Unspecified)
            if (address.isNotEmpty()) Text(address, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.MiddleEllipsis,
                color = if (failed) ConnectionFailureRed else muted)
        }
        Spacer(Modifier.width(4.dp))
        if (failed) Glyph(DuduGlyphs.connectionFailed, null, 20, ConnectionFailureMark)
        if (selectable) Glyph(DuduGlyphs.select, w("选择电脑，当前为{0}").replace("{0}", name), 17, muted)
    }
}

/** The page's card: the same white card with a hairline and 26 dp corners for the steps and for the computer. */
@Composable
private fun GuideCard(content: @Composable ColumnScope.() -> Unit) {
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(26.dp),
        color = MaterialTheme.colorScheme.surface, shadowElevation = 4.dp,
        border = BorderStroke(.5.dp, MaterialTheme.colorScheme.outline)) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp), content = content)
    }
}

/** The main button (重新连接 for a saved computer, else 扫描配对码 / 重新扫码配对) and 粘贴配对链接, which opens the pairing form. */
@Composable
private fun PairingButtons(busy: Boolean, showsRetry: Boolean, needsNewPairing: Boolean, retryLink: PairingAttempt?, model: DuduViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Button(onClick = {
            if (showsRetry) {
                DuduLog.record("connection.guide.retry")
                if (retryLink != null) model.pair(retryLink.link) else model.reconnect("guide")
            } else { DuduLog.record("pairing.scan"); model.navigate(Route("scan")) }
        }, enabled = !busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).alpha(if (busy) .5f else 1f)
                .testTag("pairing-scan"),
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(containerColor = DuduStyle.blue, contentColor = Color.White,
                disabledContainerColor = DuduStyle.blue, disabledContentColor = Color.White)) {
            if (busy) Box(Modifier.size(21.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp, color = Color.White)
            } else Glyph(if (showsRetry) DuduGlyphs.reconnect else DuduGlyphs.scan, size = 21, tint = Color.White)
            Spacer(Modifier.width(10.dp))
            Text(when {
                busy -> w("正在连接…")
                showsRetry -> w("重新连接")
                needsNewPairing -> w("重新扫码配对")
                else -> w("扫描配对码")
            },
                fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        Surface(onClick = {
            DuduLog.record("pairing.manual")
            model.clearProblem()
            model.showPairing()
        }, enabled = !busy, shape = CircleShape, color = DuduStyle.selected.copy(alpha = .65f),
            modifier = Modifier.fillMaxWidth().testTag("pairing-manual")) {
            Box(Modifier.heightIn(min = 52.dp), contentAlignment = Alignment.Center) {
                Text(w("粘贴配对链接"), fontSize = 15.sp, fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

/**
 * 添加电脑, the iPhone's `PairingView`: 扫描配对码, and under it the form for a pasted link. A `dudu://connect` link fills it in. Owner,
 * 2026-11-27: no 电脑名称 (the name is the link's own, as when scanning), the button is 「连接」, and the empty field is one line high with a bare paste icon at its end (「类似复制一样的小按钮，
 * 不需要颜色，不需要文案描述」, picked as B, then 「它还有灰色的背景圆框」: no background); a failure is the short message at the top (the model says it), not a red line in the form.
 */
@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun AddComputerScreen(route: Route, state: UiState, model: DuduViewModel) {
    val initialLink = route.params.nullableString("link")
    var link by rememberSaveable(initialLink) { mutableStateOf(initialLink.orEmpty()) }
    val busy = state.connectionInFlight
    BackHandler(enabled = busy) {}
    PreventSheetDismiss(busy)
    CenterAlignedTopAppBar(
        title = { Text(w("添加电脑"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
        expandedHeight = 52.dp,
        windowInsets = WindowInsets(0),
        colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Color.Transparent),
        navigationIcon = {
            IconButton(onClick = model::backRoute, enabled = !busy, modifier = Modifier.testTag("close-sheet")) {
                BarGlyph(DuduGlyphs.close, w("取消"))
            }
        },
    )
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().imePadding().verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = { DuduLog.record("pairing.scan"); model.navigate(Route("scan")) }, enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("pairing-scan"), shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = DuduStyle.blue, contentColor = Color.White)) {
                Glyph(DuduGlyphs.scan, size = 21, tint = Color.White)
                Spacer(Modifier.width(10.dp))
                Text(w("扫描配对码"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
            Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface, RoundedCornerShape(20.dp)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(15.dp)) {
                PairingField(w("配对链接"), link, w("粘贴电脑生成的完整链接"), !busy, tag = "pairing-link",
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    trailing = if (link.isEmpty()) ({ PasteIcon(!busy) { link = it } }) else null) { link = it }
                Button(onClick = { DuduLog.record("pairing.connect"); model.pair(link.trim()) },
                    enabled = !busy && link.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).testTag("connect"), shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(containerColor = DuduStyle.blue, contentColor = Color.White)) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                        Spacer(Modifier.width(9.dp))
                    }
                    Text(w("连接"), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

/**
 * The paste icon at the end of the empty link field: only the clipboard glyph (no word, no colour, no background), dimmed while the clipboard holds no text, and a tap puts the text in the field. It
 * reads the clipboard only on that tap (owner, 2026-11-22: nothing is read by itself).
 */
@Composable
private fun PasteIcon(enabled: Boolean, paste: (String) -> Unit) {
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    var hasText by remember { mutableStateOf(clipboardHasText(context)) }
    DisposableEffect(Unit) {
        val manager = context.getSystemService(ClipboardManager::class.java)
        val listener = ClipboardManager.OnPrimaryClipChangedListener { hasText = clipboardHasText(context) }
        manager?.addPrimaryClipChangedListener(listener)
        onDispose { manager?.removePrimaryClipChangedListener(listener) }
    }
    IconButton(onClick = {
        DuduLog.record("pairing.paste")
        clipboard.getText()?.text?.trim()?.takeIf(String::isNotEmpty)?.let(paste)
    }, enabled = enabled && hasText, modifier = Modifier.size(36.dp).testTag("pairing-paste")) {
        Glyph(MenuGlyphs.pasteLink, w("粘贴配对链接"), 18, MaterialTheme.colorScheme.onSurface.copy(alpha = if (hasText) 1f else .35f))
    }
}

/** Whether the clipboard holds text; the description does not show the person's clipboard to the system's "pasted" notice, a read does. */
private fun clipboardHasText(context: Context): Boolean =
    context.getSystemService(ClipboardManager::class.java)?.primaryClipDescription?.hasMimeType("text/*") == true

/**
 * The link field of the pairing form: its name over it (13 medium), a white box with a hairline and 13 dp corners, the placeholder in grey; one line high while it is empty (and then `trailing`, the
 * paste icon, at its end), growing to four lines with what is pasted or typed.
 */
@Composable
private fun PairingField(label: String, value: String, placeholder: String, enabled: Boolean,
    tag: String = "", keyboard: KeyboardOptions = KeyboardOptions.Default, trailing: (@Composable () -> Unit)? = null, changed: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        val style = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp, lineHeight = 21.sp)
        BasicTextField(value, changed, Modifier.fillMaxWidth().testTag(tag), enabled = enabled,
            textStyle = style.copy(color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else .45f)),
            keyboardOptions = keyboard, singleLine = false, minLines = 1, maxLines = 4,
            cursorBrush = SolidColor(DuduStyle.blue),
            decorationBox = { inner ->
                Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface, RoundedCornerShape(13.dp))
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(13.dp))
                    .padding(start = 13.dp, end = if (trailing != null) 6.dp else 13.dp, top = if (trailing != null) 7.dp else 15.dp, bottom = if (trailing != null) 7.dp else 15.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty()) Text(placeholder, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        inner()
                    }
                    trailing?.invoke()
                }
            })
    }
}
