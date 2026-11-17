package app.dudu.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.clickable
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import java.util.UUID

private data class AddressDraft(val kind: String, val value: String, val id: String = UUID.randomUUID().toString())

@Composable
fun ComputerList(state: UiState, model: DuduViewModel, selected: () -> Unit = model::dismissPanel) {
    var revealed by remember { mutableStateOf<String?>(null) }
    InsetCard {
        state.computers.forEachIndexed { index, computer ->
            val endpoint = remember(computer.link) { runCatching { Endpoint.parse(computer.link) }.getOrNull() }
            SwipeMenuRow(listOf(RowSwipeAction(w("删除"), R.drawable.ic_trash2, androidx.compose.ui.graphics.Color(0xFFE14848)) {
                model.forgetComputer(computer.id)
            }), enabled = !state.connecting, revealed = revealed == computer.id,
                onReveal = { revealed = if (it) computer.id else null }) { closeSwipe ->
            Surface(color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.fillMaxWidth().heightIn(min = 66.dp)
                .clickable(enabled = !state.connecting) {
                    if (!closeSwipe()) {
                        if (state.computerId != computer.id) model.selectComputer(computer.id)
                        selected()
                    }
                }
                .padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Glyph(R.drawable.ic_monitor, size = 22)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(computer.name, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(if (state.computerId == computer.id && state.connected) w("已连接 · {0}").replace("{0}", endpoint?.origin.orEmpty())
                        else endpoint?.origin.orEmpty(), color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontSize = 11.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (state.computerId == computer.id) Glyph(R.drawable.ic_check, size = 18)
                    IconButton(onClick = {
                        revealed = null; model.navigate(Route("computer", computer.name, computer.id))
                    }, enabled = !state.connecting,
                        modifier = Modifier.testTag("computer-menu-${computer.id}")) {
                        Glyph(R.drawable.ic_info, w("{0} 的连接详情").replace("{0}", computer.name), 20)
                    }
            }
            }
            }
            if (index < state.computers.lastIndex) HorizontalDivider(Modifier.padding(start = 52.dp), thickness = .5.dp)
        }
    }
    if (state.computerId.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        InsetCard {
            Line(if (state.connecting) w("正在连接…") else w("重新连接"), icon = R.drawable.ic_refresh_cw,
                enabled = !state.connecting, action = { model.selectComputer(state.computerId) })
        }
    }
}

@Composable
fun ComputersScreen(state: UiState, model: DuduViewModel) {
    Page(w("电脑连接"), model::backRoute, centersSheetTitle = true, nested = true, top = {
        IconButton(onClick = { model.navigate(Route("pair")) }, enabled = !state.connecting) {
            Glyph(R.drawable.ic_plus, w("添加电脑"), 22)
        }
    }) {
        Form { ComputerList(state, model, model::backRoute) }
    }
}

@Composable
fun ComputerScreen(route: Route, state: UiState, model: DuduViewModel) {
    val actions = rememberActions()
    val saved = state.computers.find { it.id == route.target }
    val endpoint = remember(saved?.link) { saved?.let { runCatching { Endpoint.parse(it.link) }.getOrNull() } }
    var editing by remember { mutableStateOf(false) }
    var adding by remember { mutableStateOf(false) }
    var drafts by remember(endpoint) { mutableStateOf(endpoint?.addresses.orEmpty().map { AddressDraft(it.kind, it.origin) }) }
    fun edit() {
        drafts = endpoint?.addresses.orEmpty().map { AddressDraft(it.kind, it.origin) }.toMutableList().apply {
            if (none { it.kind == "lan" }) add(0, AddressDraft("lan", ""))
            if (none { it.kind == "public" }) add(AddressDraft("public", ""))
        }
        editing = true
    }
    val active = state.computerId == saved?.id
    PreventSheetDismiss(actions.busy)
    Page(saved?.name ?: route.title, { if (!actions.busy) { if (editing) editing = false else model.backRoute() } }, actions,
        centersSheetTitle = true, nested = true, top = {
        if (editing) {
            Box {
                IconButton(onClick = { adding = true }, enabled = !actions.busy && drafts.size < 32) { Glyph(R.drawable.ic_plus, w("添加")) }
                DropdownMenu(adding, { adding = false }) {
                    listOf("lan", "public").forEach { kind -> DropdownMenuItem(text = { Text(if (kind == "lan") w("内网地址") else w("公网地址")) },
                        onClick = { drafts = drafts + AddressDraft(kind, ""); adding = false }) }
                }
            }
            TextButton(onClick = { actions.run {
                val addresses = try { drafts.filter { it.value.isNotBlank() }.map { ConnectionAddress.parse(it.value, it.kind) } }
                    catch (_: Exception) { throw ApiFailure("INVALID_PARAMS") }
                model.updateConnectionAddresses(saved!!.id, addresses)
                editing = false
            } }, enabled = !actions.busy && drafts.any { it.value.isNotBlank() }, modifier = Modifier.testTag("save-addresses")) {
                Text(stringResource(R.string.save))
            }
        } else IconButton(onClick = ::edit, enabled = endpoint?.deviceId != null && !state.connecting,
            modifier = Modifier.testTag("edit-addresses")) { Glyph(R.drawable.ic_pencil, w("编辑")) }
    }) {
        if (editing) Form {
            drafts.forEachIndexed { index, draft ->
                key(draft.id) { Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) {
                        Field(if (draft.kind == "lan") w("内网地址") else w("公网地址"), draft.value,
                            enabled = !actions.busy, tag = "address-${draft.kind}-$index",
                            keyboard = KeyboardOptions(keyboardType = KeyboardType.Uri)) { value ->
                            drafts = drafts.toMutableList().apply { set(index, draft.copy(value = value)) }
                        }
                    }
                    IconButton(onClick = { drafts = drafts.filterNot { it.id == draft.id } }, enabled = !actions.busy) {
                        Glyph(R.drawable.ic_trash2, stringResource(R.string.delete), 20, MaterialTheme.colorScheme.error)
                    }
                } }
            }
            TextButton(onClick = { editing = false }, enabled = !actions.busy) { Text(stringResource(R.string.cancel)) }
        } else {
            Line(w("连接状态"), when {
                active && state.connecting -> w("正在连接…")
                active && state.connected -> w("已连接")
                else -> w("未连接")
            })
            Section(w("连接地址"))
            endpoint?.addresses?.forEach { address ->
                Line(if (address.kind == "lan") w("内网地址") else w("公网地址"), address.origin)
            }
            Line(w("重新连接"), icon = R.drawable.ic_refresh_cw, enabled = !state.connecting,
                action = { saved?.let { model.selectComputer(it.id) } })
        }
    }
}
