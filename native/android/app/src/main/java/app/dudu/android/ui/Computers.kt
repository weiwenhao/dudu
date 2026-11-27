@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.data.*

private data class AddressDraft(val kind: String, val value: String)

/** The address of a computer without its scheme (the iPhone's `shortAddress`): what the computer rows and 已连接 · {0} say. */
private fun shortAddress(origin: String?) = origin.orEmpty().replace(Regex("^https?://"), "")

/** The settings' own row of a card: the glyph in a 28 dp column, the 15 medium title, what the row ends with (the iPhone's settings rows, 58 dp at least). */
@Composable
internal fun SettingsCardRow(glyph: Int, title: String, glyphSize: Int = 22, enabled: Boolean = true, tag: String = "",
    titleColor: Color = MaterialTheme.colorScheme.onSurface, leading: (@Composable () -> Unit)? = null,
    trailing: @Composable RowScope.() -> Unit = {}, action: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).testTag(tag)
        .then(if (action != null) Modifier.clickable(enabled = enabled, onClick = action) else Modifier)
        .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) { if (leading != null) leading() else Glyph(glyph, size = glyphSize) }
        Text(title, Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = titleColor, maxLines = 1,
            overflow = TextOverflow.Ellipsis)
        trailing()
    }
}

/**
 * The saved computers, the iPhone's `ComputerListView`: a card of rows (the computer, its name, its address or 已连接 · {address}, a check for the one in use, its connection details), a
 * left swipe deletes one, and under the card 重新连接 for the computer in use. A tap on another computer switches to it; on the one in use it only closes the list.
 */
@Composable
fun ComputerList(state: UiState, model: DuduViewModel, selected: () -> Unit = model::dismissPanel) {
    var revealed by remember { mutableStateOf<String?>(null) }
    InsetCard {
        state.computers.forEachIndexed { index, computer ->
            val endpoint = remember(computer.link) { runCatching { Endpoint.parse(computer.link) }.getOrNull() }
            SwipeMenuRow(listOf(RowSwipeAction(w("删除"), DuduGlyphs.trash, SwipeColors.delete) {
                revealed = null
                DuduLog.record("computer.remove")
                model.forgetComputer(computer.id)
            }), enabled = !state.connectionInFlight, revealed = revealed == computer.id,
                onReveal = { revealed = if (it) computer.id else null }) { closeSwipe ->
            Surface(color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().heightIn(min = 66.dp).testTag("computer-row-${computer.id}")
                .clickable(enabled = !state.connectionInFlight) {
                    if (!closeSwipe()) {
                        if (state.computerId != computer.id) { DuduLog.record("computer.switch"); model.selectComputer(computer.id) }
                        selected()
                    }
                }
                .padding(start = 20.dp, end = 8.dp, top = 12.dp, bottom = 12.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) { Glyph(DuduGlyphs.computer, size = 22) }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(computer.name, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val address = shortAddress(endpoint?.origin)
                    Text(if (state.computerId == computer.id && state.connected) w("已连接 · {0}").replace("{0}", address) else address,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.MiddleEllipsis)
                }
                if (state.computerId == computer.id) Glyph(DuduGlyphs.check, size = 20)
                Box(Modifier.size(44.dp).clickable(enabled = !state.connectionInFlight) {
                    revealed = null; model.navigate(Route("computer", computer.name, computer.id))
                }.testTag("computer-menu-${computer.id}"), contentAlignment = Alignment.Center) {
                    Glyph(DuduGlyphs.info, w("{0} 的连接详情").replace("{0}", computer.name), 20)
                }
            }
            }
            }
            if (index < state.computers.lastIndex) HorizontalDivider(Modifier.padding(start = 64.dp), thickness = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
    if (state.computerId.isNotEmpty()) {
        Spacer(Modifier.height(14.dp))
        InsetCard {
            ReconnectRow(state.connectionInFlight, tag = "computers-reconnect") { model.reconnect("computers") }
        }
    }
}

/** 重新连接 on a card of its own: the circular arrow, the words (正在连接… while it connects, with a spinner and no chevron), disabled until the attempt ends. */
@Composable
private fun ReconnectRow(connecting: Boolean, tag: String, enabled: Boolean = true, action: () -> Unit) {
    SettingsCardRow(DuduGlyphs.reconnect, if (connecting) w("正在连接…") else w("重新连接"), enabled = enabled && !connecting, tag = tag,
        leading = if (connecting) { {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } } else null, action = action)
}

@Composable
internal fun AddComputerButton(model: DuduViewModel, enabled: Boolean = true) {
    IconButton(onClick = { model.navigate(Route("connect")) }, enabled = enabled,
        modifier = Modifier.size(44.dp).duduGlass(CircleShape, glass()).testTag("computers-add")) {
        Glyph(DuduGlyphs.plus, w("添加电脑"), 22)
    }
}

/** 电脑连接, a page pushed over the settings (the bottom bar hidden): the list, and + to add a computer. */
@Composable
fun ComputersScreen(state: UiState, model: DuduViewModel) {
    Page(w("电脑连接"), model::backRoute, nested = true, background = settingsCanvas(), top = {
        AddComputerButton(model, enabled = !state.connectionInFlight)
    }) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 28.dp)) {
            ComputerList(state, model, model::backRoute)
        }
    }
}

/**
 * A computer's connection, the iPhone's `ComputerConnectionView`: 连接状态 (a dot, 已连接 · {address}, 正在连接… or 未连接), its addresses (内网地址 / 公网地址, 使用中 by the one in use, the
 * address itself in monospace). The checkmark saves edits made directly in the address rows.
 */
@Composable
fun ComputerScreen(route: Route, state: UiState, model: DuduViewModel) {
    val saved = state.computers.find { it.id == route.target }
    val endpoint = remember(saved?.link) { saved?.let { runCatching { Endpoint.parse(it.link) }.getOrNull() } }
    val canEdit = endpoint?.deviceId != null
    val original = remember(endpoint, canEdit) {
        endpoint?.addresses.orEmpty().map { AddressDraft(it.kind, it.origin) }.toMutableList().apply {
            if (canEdit && none { it.kind == "lan" }) add(0, AddressDraft("lan", ""))
            if (canEdit && none { it.kind == "public" }) add(AddressDraft("public", ""))
        }
    }
    var drafts by remember(saved?.id) { mutableStateOf<List<AddressDraft>?>(null) }
    val fields = drafts ?: original
    val active = state.computerId == saved?.id
    val connecting = active && state.connectionInFlight
    val connected = active && state.connected
    val actions = rememberActions()
    val focus = LocalFocusManager.current
    PreventSheetDismiss(actions.busy)
    LaunchedEffect(actions.error) {
        actions.error?.let(model::failureToast)
        actions.error = null
    }
    Page(saved?.name ?: route.title, { if (!actions.busy) model.backRoute() }, nested = true, background = settingsCanvas(), top = {
        IconButton(onClick = {
            if (saved != null && drafts != null) {
                focus.clearFocus()
                actions.run {
                    val addresses = try {
                        fields.filter { it.value.isNotBlank() }.map { ConnectionAddress.parse(it.value, it.kind) }
                    } catch (_: Exception) { throw ApiFailure("INVALID_LINK") }
                    DuduLog.record("computer.addresses.save", counts = mapOf(
                        "lanAddressCount" to addresses.count { it.kind == "lan" }.toLong(),
                        "publicAddressCount" to addresses.count { it.kind == "public" }.toLong()))
                    model.updateConnectionAddresses(saved.id, addresses)
                    drafts = null
                }
            }
        }, enabled = canEdit && drafts != null && !actions.busy && !connecting,
            modifier = Modifier.size(44.dp).duduGlass(CircleShape, glass()).testTag("save-addresses")) {
            if (actions.busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            else Glyph(DuduGlyphs.check, w("保存"), 20)
        }
    }) {
        if (saved != null) Column(Modifier.fillMaxSize().imePadding().verticalScroll(rememberScrollState())
            .padding(start = 18.dp, end = 18.dp, top = 16.dp, bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            InsetCard {
                Row(Modifier.fillMaxWidth().padding(16.dp).testTag("computer-connection-state"), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(w("连接状态"), Modifier.weight(1f), fontSize = 15.sp)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (!connecting) Box(Modifier.size(6.dp).background(if (connected) Color(0xFF34C759) else MaterialTheme.colorScheme.onSurfaceVariant, CircleShape))
                        Text(when {
                            connected -> w("已连接 · {0}").replace("{0}", shortAddress(endpoint?.origin))
                            connecting -> w("正在连接…")
                            else -> w("未连接")
                        }, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(w("连接地址"), Modifier.padding(start = 16.dp), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                InsetCard {
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        fields.forEachIndexed { index, address ->
                            if (index > 0) HorizontalDivider(thickness = .5.dp, color = MaterialTheme.colorScheme.outlineVariant)
                            Column(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                val title = if (address.kind == "lan") w("内网地址") else w("公网地址")
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(title, Modifier.weight(1f), fontSize = 15.sp)
                                    if (connected && address.value == endpoint?.origin)
                                        Text(w("使用中"), Modifier.testTag("computer-address-in-use"), fontSize = 12.sp)
                                }
                                if (canEdit) {
                                    var focused by remember(index) { mutableStateOf(false) }
                                    val style = MaterialTheme.typography.bodyLarge.copy(fontSize = 11.sp, lineHeight = 15.sp,
                                        fontFamily = FontFamily.Monospace)
                                    BasicTextField(address.value, { value ->
                                        val updated = fields.toMutableList()
                                        updated[index] = address.copy(value = value)
                                        drafts = updated.takeUnless { it == original }
                                    }, Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused }
                                        .semantics { contentDescription = title }.testTag("address-${address.kind}-$index"),
                                        enabled = !actions.busy && !connecting, singleLine = true,
                                        textStyle = style.copy(color = if (focused) MaterialTheme.colorScheme.onSurface
                                            else MaterialTheme.colorScheme.onSurfaceVariant),
                                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                                        cursorBrush = SolidColor(DuduStyle.blue),
                                        decorationBox = { inner ->
                                            Box {
                                                if (address.value.isEmpty()) Text(w("选填"), style = style,
                                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                                inner()
                                            }
                                        })
                                } else SelectionContainer {
                                    Text(address.value, fontSize = 11.sp, fontFamily = FontFamily.Monospace,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
            }
            InsetCard {
                ReconnectRow(connecting, tag = "computer-reconnect", enabled = !actions.busy && drafts == null) {
                    focus.clearFocus()
                    if (active) model.reconnect("computer")
                    else { DuduLog.record("computer.switch"); model.selectComputer(saved.id) }
                }
            }
        }
    }
}
