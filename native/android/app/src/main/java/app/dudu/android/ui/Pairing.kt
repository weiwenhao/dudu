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
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*

/** The red of a connection's failure on the guide and a computer's page (the iPhone's 0.67, 0.29, 0.27). */
internal val ConnectionFailureRed = Color(0xFFAB4A45)

/**
 * The connection guide, the iPhone's `ConnectionGuideView`: the logo, 连接嘟嘟, and, for a phone with no computer (the first page after the install) or one whose pairing has to be made again, the steps
 * to take on the computer (`ConnectionSteps`; owner, 2026-11-27, proposal 1 of `.local/designs/phone-first-run-2026-11-27/`); then the main button (重新连接 for a saved computer, else 扫描配对码 / 重新扫码配对)
 * and 粘贴配对链接, which opens the pairing form; nothing is read from the clipboard (owner, 2026-11-22). A phone that has a computer keeps its card with that computer (it opens 电脑连接), what the
 * connection is doing and the buttons; one without has only the buttons, on the page under the steps, and a line above them when there is something to say.
 */
@Composable
fun PairingScreen(state: UiState, model: DuduViewModel) {
    val busy = state.connectionInFlight
    val savedComputer = state.computers.firstOrNull { it.id == state.computerId } ?: state.computers.firstOrNull()
    val savedOrigin = remember(savedComputer?.link) {
        savedComputer?.let { runCatching { Endpoint.parse(it.link).origin }.getOrNull() }
    }
    val needsNewPairing = state.pairingRequired || requiresNewPairing(state.connectionFailure)
    val showsRetry = !needsNewPairing && (state.computers.isNotEmpty() || state.connectionFailure != null)
    val failure = state.problem ?: state.connectionFailure
    // The steps were the line under the title in the same two cases: no computer yet, or a pairing that has to be made again.
    val showsSteps = state.computers.isEmpty() || needsNewPairing
    LaunchedEffect(Unit) { DuduLog.record("connection.guide.open") }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            val minimum = maxHeight
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                    .heightIn(min = minimum).padding(horizontal = 22.dp, vertical = 24.dp),
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
                    if (savedComputer == null) {
                        if (busy || failure != null) Box(Modifier.fillMaxWidth()) { PairingStatus(busy, failure) }
                        PairingButtons(busy, showsRetry, needsNewPairing, model)
                    } else GuideCard {
                        Row(Modifier.fillMaxWidth().heightIn(min = 54.dp).testTag("connection-computers")
                            .clickable { DuduLog.record("computers.open"); model.show(Panel.Computers) },
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Glyph(DuduGlyphs.computer, size = 22)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(savedComputer.name, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                                savedOrigin?.let {
                                    Text(it, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.MiddleEllipsis,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            Spacer(Modifier.width(4.dp))
                            Glyph(DuduGlyphs.select, w("选择电脑，当前为{0}").replace("{0}", savedComputer.name), 17,
                                MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Box(Modifier.fillMaxWidth().heightIn(min = 20.dp), contentAlignment = Alignment.CenterStart) {
                            PairingStatus(busy, failure)
                        }
                        PairingButtons(busy, showsRetry, needsNewPairing, model)
                    }
                }
            }
        }
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

/** What the connection is doing (the mark and 正在连接…) or why it failed, nothing when there is neither. */
@Composable
private fun PairingStatus(busy: Boolean, failure: String?) {
    if (busy) Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(9.dp)) {
        CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 1.5.dp,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(w("正在连接…"), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else if (failure != null) {
        // A pairing that was refused says only 配对已失效 here; the button under it says what to do.
        Text(if (failure == "AUTH_FAILED" || failure == "UNAUTHORIZED") w("配对已失效") else problemText(failure),
            color = ConnectionFailureRed, fontSize = 14.sp, modifier = Modifier.testTag("pairing-error"))
    }
}

/** The main button (重新连接 for a saved computer, else 扫描配对码 / 重新扫码配对) and 粘贴配对链接, which opens the pairing form. */
@Composable
private fun PairingButtons(busy: Boolean, showsRetry: Boolean, needsNewPairing: Boolean, model: DuduViewModel) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Button(onClick = {
            if (showsRetry) { DuduLog.record("connection.guide.retry"); model.reconnect("guide") }
            else { DuduLog.record("pairing.scan"); model.navigate(Route("scan")) }
        }, enabled = !busy,
            modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp).alpha(if (showsRetry && busy) .5f else 1f)
                .testTag("pairing-scan"),
            shape = CircleShape,
            colors = ButtonDefaults.buttonColors(containerColor = DuduStyle.blue, contentColor = Color.White,
                disabledContainerColor = DuduStyle.blue, disabledContentColor = Color.White)) {
            Glyph(if (showsRetry) DuduGlyphs.reconnect else DuduGlyphs.scan, size = 21, tint = Color.White)
            Spacer(Modifier.width(10.dp))
            Text(if (showsRetry) w("重新连接") else if (needsNewPairing) w("重新扫码配对") else w("扫描配对码"),
                fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
        }
        Surface(onClick = {
            DuduLog.record("pairing.manual")
            model.clearProblem()
            model.showPairing()
        }, enabled = !busy, shape = CircleShape, color = DuduStyle.selected.copy(alpha = .65f),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("pairing-manual")) {
            Box(Modifier.heightIn(min = 48.dp), contentAlignment = Alignment.Center) {
                Text(w("粘贴配对链接"), fontSize = 15.sp, fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface)
            }
        }
    }
}

/**
 * 添加电脑, the iPhone's `PairingView` in the settings: 扫描配对码, and under it 粘贴配对链接, which opens the form (a multi-line 配对链接 field, 电脑名称 选填, 添加并连接). A sheet (the guide's
 * 粘贴配对链接, a `dudu://connect` link, which fills the form in) has 取消 and opens on the form; the page 电脑连接's + pushes goes back with ‹.
 */
@Composable
fun AddComputerScreen(route: Route, state: UiState, model: DuduViewModel) {
    val sheet = route.params.optBoolean("sheet")
    val initialLink = route.params.nullableString("link")
    var manual by rememberSaveable { mutableStateOf(sheet || initialLink != null) }
    var link by rememberSaveable { mutableStateOf(initialLink.orEmpty()) }
    var name by rememberSaveable { mutableStateOf(initialLink?.let(::pairingLinkName).orEmpty()) }
    // The error under the form answers what was typed here: the one a saved computer that could not be reached left behind is not (owner, 2026-11-21).
    var attempted by rememberSaveable { mutableStateOf(false) }
    var empty by rememberSaveable { mutableStateOf(false) }
    val busy = state.connectionInFlight
    LaunchedEffect(Unit) { if (!sheet) DuduLog.record("pairing.add.open") }
    BackHandler(enabled = busy) {}
    PreventSheetDismiss(busy)
    fun pair() {
        val trimmed = link.trim()
        if (trimmed.isEmpty()) { empty = true; return }
        empty = false
        attempted = true
        DuduLog.record("pairing.connect")
        model.connect(trimmed, name.trim())
    }
    Page(w("添加电脑"), { if (!busy) model.backRoute() }, cancels = sheet, background = MaterialTheme.colorScheme.surfaceContainer) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding()
            .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 30.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Button(onClick = { DuduLog.record("pairing.scan"); model.navigate(Route("scan")) }, enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp).testTag("pairing-scan"), shape = CircleShape,
                colors = ButtonDefaults.buttonColors(containerColor = DuduStyle.blue, contentColor = Color.White)) {
                Glyph(DuduGlyphs.scan, size = 21, tint = Color.White)
                Spacer(Modifier.width(10.dp))
                Text(w("扫描配对码"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
            if (manual) Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface, RoundedCornerShape(20.dp)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(15.dp)) {
                PairingField(w("配对链接"), link, w("粘贴电脑生成的完整链接"), !busy, multiline = true, tag = "pairing-link",
                    keyboard = KeyboardOptions(keyboardType = KeyboardType.Uri)) { link = it; empty = false }
                PairingField(w("电脑名称"), name, w("选填"), !busy) { name = it }
                val error = if (empty) w("请输入配对链接") else if (attempted && !busy) state.problem?.let { problemText(it) } else null
                error?.let { Text(it, fontSize = 13.sp, color = Color(0xFFB54F4A), modifier = Modifier.testTag("pairing-error")) }
                Button(onClick = ::pair, enabled = !busy && link.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("connect"), shape = CircleShape,
                    colors = ButtonDefaults.buttonColors(containerColor = DuduStyle.blue, contentColor = Color.White)) {
                    if (busy) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                        Spacer(Modifier.width(9.dp))
                    }
                    Text(w("添加并连接"), fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            } else Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).testTag("pairing-manual")
                .clickable { manual = true; model.clearProblem(); DuduLog.record("pairing.manual") }, contentAlignment = Alignment.Center) {
                Text(w("粘贴配对链接"), fontSize = 14.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
}

/** A field of the pairing form: its name over it (13 medium), a white box with a hairline and 13 dp corners, the placeholder in grey. */
@Composable
private fun PairingField(label: String, value: String, placeholder: String, enabled: Boolean, multiline: Boolean = false,
    tag: String = "", keyboard: KeyboardOptions = KeyboardOptions.Default, changed: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium)
        val style = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp, lineHeight = 21.sp)
        BasicTextField(value, changed, Modifier.fillMaxWidth().testTag(tag), enabled = enabled,
            textStyle = style.copy(color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else .45f)),
            keyboardOptions = keyboard, singleLine = !multiline, minLines = if (multiline) 2 else 1, maxLines = if (multiline) 4 else 1,
            cursorBrush = SolidColor(DuduStyle.blue),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface, RoundedCornerShape(13.dp))
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(13.dp)).padding(13.dp)) {
                    if (value.isEmpty()) Text(placeholder, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    inner()
                }
            })
    }
}
