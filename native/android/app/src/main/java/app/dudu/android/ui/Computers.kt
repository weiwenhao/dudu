@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.data.*
import java.util.UUID

private data class AddressDraft(val kind: String, val value: String, val id: String = UUID.randomUUID().toString())

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
private fun ReconnectRow(connecting: Boolean, tag: String, action: () -> Unit) {
    SettingsCardRow(DuduGlyphs.reconnect, if (connecting) w("正在连接…") else w("重新连接"), enabled = !connecting, tag = tag,
        trailing = {
            if (connecting) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }, action = action)
}

/** 电脑连接, a page pushed over the settings (the bottom bar hidden): the list, and + to add a computer. */
@Composable
fun ComputersScreen(state: UiState, model: DuduViewModel) {
    Page(w("电脑连接"), model::backRoute, nested = true, background = settingsCanvas(), top = {
        IconButton(onClick = { model.navigate(Route("pair")) }, modifier = Modifier.testTag("computers-add")) {
            Glyph(DuduGlyphs.plus, w("添加电脑"), 22)
        }
    }) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 28.dp)) {
            ComputerList(state, model, model::backRoute)
        }
    }
}

/**
 * A computer's connection, the iPhone's `ComputerConnectionView`: 连接状态 (a dot, 已连接 · {address}, 正在连接… or 未连接), its addresses (内网地址 / 公网地址, 使用中 by the one in use, the
 * address itself in monospace), why it is not connected, and 重新连接. 编辑 opens the address form in a sheet.
 */
@Composable
fun ComputerScreen(route: Route, state: UiState, model: DuduViewModel) {
    val saved = state.computers.find { it.id == route.target }
    val endpoint = remember(saved?.link) { saved?.let { runCatching { Endpoint.parse(it.link) }.getOrNull() } }
    var editing by remember { mutableStateOf(false) }
    val active = state.computerId == saved?.id
    val connecting = active && state.connectionInFlight
    val connected = active && state.connected
    Page(saved?.name ?: route.title, model::backRoute, nested = true, background = settingsCanvas(), top = {
        TextButton(onClick = { editing = true }, enabled = saved != null && endpoint?.deviceId != null && !connecting,
            modifier = Modifier.testTag("edit-addresses")) { Text(w("编辑"), fontSize = 15.sp) }
    }) {
        if (saved != null) Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())
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
                        endpoint?.addresses.orEmpty().forEachIndexed { index, address ->
                            if (index > 0) HorizontalDivider(thickness = .5.dp, color = MaterialTheme.colorScheme.outlineVariant)
                            Column(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(if (address.kind == "lan") w("内网地址") else w("公网地址"), Modifier.weight(1f), fontSize = 15.sp)
                                    if (connected && address.origin == endpoint?.origin)
                                        Text(w("使用中"), Modifier.testTag("computer-address-in-use"), fontSize = 12.sp)
                                }
                                SelectionContainer {
                                    Text(address.origin, fontSize = 11.sp, fontFamily = FontFamily.Monospace,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                }
            }
            if (active && !state.connected && !state.connectionInFlight) state.connectionFailure?.let {
                Text(problemText(it), Modifier.padding(horizontal = 16.dp).testTag("computer-connection-failure"), fontSize = 13.sp,
                    color = ConnectionFailureRed)
            }
            InsetCard {
                SettingsCardRow(DuduGlyphs.reconnect, if (connecting) w("正在连接…") else w("重新连接"), enabled = !connecting,
                    tag = "computer-reconnect", trailing = {
                        if (connecting) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }) { if (active) model.reconnect("computer") else { DuduLog.record("computer.switch"); model.selectComputer(saved.id) } }
            }
        }
    }
    if (editing && saved != null && endpoint != null) AddressEditor(saved, endpoint, model) { editing = false }
}

/** The addresses of a computer in a sheet (the iPhone's `ConnectionAddressEditor`): 取消, 编辑, 保存; a 内网地址 and a 公网地址 field at least, each 选填; checked against the computer before they are kept. */
@Composable
private fun AddressEditor(saved: SavedComputer, endpoint: Endpoint, model: DuduViewModel, close: () -> Unit) {
    val actions = rememberActions()
    val drafts = remember {
        endpoint.addresses.map { AddressDraft(it.kind, it.origin) }.toMutableList().apply {
            if (none { it.kind == "lan" }) add(0, AddressDraft("lan", ""))
            if (none { it.kind == "public" }) add(AddressDraft("public", ""))
        }.toMutableStateList()
    }
    BackHandler(enabled = actions.busy) {}
    DuduSheet({ if (!actions.busy) close() }, containerColor = settingsCanvas(), canDismiss = !actions.busy) {
        CenterAlignedTopAppBar(
            title = { Text(w("编辑"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            expandedHeight = 52.dp, windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Color.Transparent),
            navigationIcon = { TextButton(onClick = close, enabled = !actions.busy) { Text(w("取消")) } },
            actions = {
                if (actions.busy) Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else TextButton(onClick = {
                    actions.run {
                        val addresses = try { drafts.filter { it.value.isNotBlank() }.map { ConnectionAddress.parse(it.value, it.kind) } }
                            catch (_: Exception) { throw ApiFailure("INVALID_PARAMS") }
                        DuduLog.record("computer.addresses.save", counts = mapOf(
                            "lanAddressCount" to addresses.count { it.kind == "lan" }.toLong(),
                            "publicAddressCount" to addresses.count { it.kind == "public" }.toLong()))
                        model.updateConnectionAddresses(saved.id, addresses)
                        close()
                    }
                }, modifier = Modifier.testTag("save-addresses")) { Text(w("保存")) }
            },
        )
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            InsetCard {
                Column(Modifier.padding(horizontal = 16.dp)) {
                    drafts.forEachIndexed { index, draft ->
                        key(draft.id) {
                            Column(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(if (draft.kind == "lan") w("内网地址") else w("公网地址"), fontSize = 13.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                val style = MaterialTheme.typography.bodyLarge.copy(fontSize = 16.sp)
                                BasicTextField(draft.value, { value -> drafts[index] = draft.copy(value = value) },
                                    Modifier.fillMaxWidth().testTag("address-${draft.kind}-$index"), enabled = !actions.busy, singleLine = true,
                                    textStyle = style.copy(color = MaterialTheme.colorScheme.onSurface),
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                                    cursorBrush = SolidColor(DuduStyle.blue), decorationBox = { inner ->
                                        Box {
                                            if (draft.value.isEmpty()) Text(w("选填"), style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                            inner()
                                        }
                                    })
                            }
                        }
                        if (index < drafts.lastIndex) HorizontalDivider(thickness = .5.dp, color = MaterialTheme.colorScheme.outlineVariant)
                    }
                }
            }
            actions.error?.let { Text(problemText(it), fontSize = 13.sp, color = ConnectionFailureRed, modifier = Modifier.testTag("computer-edit-failure")) }
            Spacer(Modifier.height(12.dp))
        }
    }
}
