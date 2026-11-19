package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

private data class SidebarInventory(val sessions: List<JSONObject>, val workspaces: List<JSONObject>)

@Composable
fun DuduSidebar(state: UiState, model: DuduViewModel, opened: Boolean, close: () -> Unit) {
    var inventory by remember(state.computerId) { mutableStateOf(SidebarInventory(emptyList(), emptyList())) }
    var moreExpanded by remember(state.computerId) { mutableStateOf(false) }
    var viewOptionsOpen by remember(opened) { mutableStateOf(false) }
    var archivedChoice by remember(state.computerId) { mutableStateOf<JSONObject?>(null) }
    val actions = rememberActions()
    val options = remember(state.preferences) { SidebarOptions.parse(state.preferences) }
    val collapsed = remember(state.preferences) {
        state.preferences.optJSONArray("sidebar.collapsed")?.strings()?.toSet().orEmpty()
    }
    LaunchedEffect(opened, state.computerId, state.connected) {
        if (!opened || !state.connected) return@LaunchedEffect
        do {
            runCatching {
                val sessions = (model.value("session.list") as JSONArray).objects()
                val workspaces = (model.value("workspace.list") as JSONArray).objects()
                inventory = SidebarInventory(sessions, workspaces)
            }.onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
            delay(5000)
        } while (true)
    }
    fun route(value: Route) { close(); model.navigate(value) }
    fun chooseOption(key: String, value: String) {
        model.preference(key, value)
        DuduLog.record(key, state = value)
        viewOptionsOpen = false
    }
    // Freeze the interval structure before LazyColumn starts measuring its items.
    val entries = remember(inventory, options, collapsed) {
        sidebarEntries(inventory.sessions, inventory.workspaces, options, collapsed)
    }
    val navigation = remember(state.navigation) { sidebarNavigation(state.navigation) }
    val conversationOpen = state.conversationTitle != null
    val page = pageRoute(state.route, model.routesBehindCurrent(), conversationOpen)
    val width = (LocalConfiguration.current.screenWidthDp * .79f).coerceAtMost(360f).dp
    ModalDrawerSheet(Modifier.width(width), drawerContainerColor = MaterialTheme.colorScheme.background,
        drawerShape = RoundedCornerShape(topEnd = 28.dp, bottomEnd = 28.dp)) {
        Row(Modifier.fillMaxWidth().padding(start = 26.dp, end = 16.dp, top = 8.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Text("Dudu", Modifier.weight(1f), fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
            IconButton(onClick = { route(Route("session-new")) }) {
                Glyph(R.drawable.ic_plus, w("新建会话"), 22)
            }
        }
        Surface(onClick = { route(Route("session-search", params = json("sessions" to JSONArray(inventory.sessions)))) }, Modifier.padding(horizontal = 16.dp),
            shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Glyph(R.drawable.ic_search, size = 18, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(w("搜索对话内容…"), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        LazyColumn(Modifier.weight(1f).padding(top = 12.dp)) {
            if (navigation.primary.isNotEmpty()) items(navigation.primary, key = { "nav:${it.optString("id")}" }) { item ->
                SidebarDestination(item, sidebarItemSelected(item, page, conversationOpen)) { close(); model.navigateItem(item) }
            } else {
                item { SidebarLink(w("看板"), { close(); model.navigate(null) }, chosen = page == null && !conversationOpen) {
                    Glyph(R.drawable.ic_circle_dot, size = 21)
                } }
                item { SidebarLink(w("收件箱"), { route(Route("collector")) }, "nav-collector", chosen = page?.name == "collector") {
                    Glyph(R.drawable.ic_inbox, size = 21)
                } }
                item { SidebarLink(w("定时任务"), { route(Route("tasks")) }, "nav-tasks", chosen = page?.name == "tasks") {
                    Glyph(R.drawable.ic_clock, size = 21)
                } }
            }
            if (navigation.additional.isNotEmpty()) {
                item("more") {
                    Row(Modifier.fillMaxWidth().testTag("sidebar-more").clickable { moreExpanded = !moreExpanded }
                        .heightIn(min = 44.dp).padding(horizontal = 26.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Glyph(R.drawable.ic_ellipsis, size = 21)
                        Text(w("查看更多"), Modifier.weight(1f), fontSize = 16.sp, fontWeight = FontWeight.Medium)
                        Glyph(if (moreExpanded) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down,
                            size = 14, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                if (moreExpanded) items(navigation.additional, key = { "nav:${it.optString("id")}" }) { item ->
                    SidebarDestination(item, sidebarItemSelected(item, page, conversationOpen)) { close(); model.navigateItem(item) }
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(start = 26.dp, end = 16.dp, top = 18.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(if (options.grouping == SidebarGrouping.Flat) w("会话") else w("工作区"),
                        Modifier.weight(1f), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Box {
                        IconButton(onClick = { viewOptionsOpen = true; DuduLog.record("sidebar.options.open") },
                            modifier = Modifier.size(40.dp).testTag("sidebar-view-options")) {
                            Glyph(R.drawable.ic_sliders_horizontal, w("会话视图选项"), 18, MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        DropdownMenu(viewOptionsOpen, { viewOptionsOpen = false }) {
                            SidebarMenuHeading(w("分组方式"))
                            SidebarMenuOption(w("按工作区"), options.grouping == SidebarGrouping.Workspace) {
                                chooseOption("sidebar.grouping", SidebarGrouping.Workspace.wire)
                            }
                            SidebarMenuOption(w("单列表"), options.grouping == SidebarGrouping.Flat) {
                                chooseOption("sidebar.grouping", SidebarGrouping.Flat.wire)
                            }
                            HorizontalDivider()
                            SidebarMenuHeading(w("筛选会话"))
                            SidebarMenuOption(w("隐藏已归档"), options.archive == SidebarArchiveFilter.Hide) {
                                chooseOption("sidebar.archive", SidebarArchiveFilter.Hide.wire)
                            }
                            SidebarMenuOption(w("全部对话（显示已归档）"), options.archive == SidebarArchiveFilter.All) {
                                chooseOption("sidebar.archive", SidebarArchiveFilter.All.wire)
                            }
                            SidebarMenuOption(w("仅显示已归档"), options.archive == SidebarArchiveFilter.Only) {
                                chooseOption("sidebar.archive", SidebarArchiveFilter.Only.wire)
                            }
                        }
                    }
                }
            }
            items(entries, key = { it.id }) { entry ->
                when (entry) {
                    is SidebarEntry.Group -> TextButton(onClick = {
                        val next = if (entry.collapsed) collapsed - entry.workspaceId else collapsed + entry.workspaceId
                        model.preference("sidebar.collapsed", JSONArray(next.sorted()))
                    },
                        contentPadding = PaddingValues(horizontal = 26.dp, vertical = 6.dp)) {
                        Text(entry.workspace?.optString("name") ?: w("未分组"), fontSize = 14.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (entry.collapsed) Glyph(R.drawable.ic_chevron_right, size = 12, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    is SidebarEntry.Session -> {
                        val session = entry.value
                        Row(Modifier.fillMaxWidth().height(46.dp).combinedClickable(onClick = {
                            if (session.optBoolean("archived")) { actions.error = null; archivedChoice = session }
                            else { close(); model.openSession(session.getString("id"), session.optString("title")) }
                        }).padding(start = 26.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            AgentLogo(session.nullableString("agent") ?: session.nullableString("providerId"), 18)
                            Text(session.optString("title"), Modifier.weight(1f), maxLines = 1, fontSize = 15.sp,
                                overflow = TextOverflow.Ellipsis)
                            if (session.optBoolean("archived")) Glyph(R.drawable.ic_archive, size = 14, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            else if (session.optBoolean("pinned")) Glyph(R.drawable.ic_pin, size = 14, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            else Text(receivedTime(session.optLong("updatedAt")), fontSize = 10.sp,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            if (entries.isEmpty()) item {
                Text(if (options.archive == SidebarArchiveFilter.Only) w("暂无已归档会话") else w("暂无会话"),
                    Modifier.padding(horizontal = 26.dp, vertical = 8.dp),
                    fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            FilledTonalButton(onClick = { close(); model.show(Panel.Computers) }, modifier = Modifier.weight(1f),
                colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface)) {
                Glyph(R.drawable.ic_monitor, size = 19, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(8.dp))
                Text(state.computer.ifBlank { w("电脑连接") }, modifier = Modifier.weight(1f, fill = false),
                    maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                Spacer(Modifier.width(6.dp))
                Glyph(R.drawable.ic_chevron_down, size = 12, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.width(8.dp))
            IconButton(onClick = { route(Route("preferences")) }, modifier = Modifier.testTag("nav-settings")) {
                Glyph(R.drawable.ic_settings, w("设置"), 22)
            }
        }
    }
    archivedChoice?.let { session ->
        AlertDialog(onDismissRequest = { if (!actions.busy) archivedChoice = null },
            title = { Text(w("已归档的会话")) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(w("取消归档后才能打开。"))
                actions.error?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error) }
            } },
            confirmButton = { TextButton(onClick = { actions.run {
                model.value("session.unarchive", json("id" to session.getString("id")))
                inventory = inventory.copy(sessions = inventory.sessions.map {
                    if (it.optString("id") == session.getString("id")) it.copyJson().put("archived", false) else it
                })
                archivedChoice = null
            } }, enabled = !actions.busy) { Text(w("取消归档")) } },
            dismissButton = { TextButton(onClick = { archivedChoice = null }, enabled = !actions.busy) { Text(w("取消")) } })
    }
}

@Composable
private fun SidebarMenuHeading(title: String) {
    Text(title, Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun SidebarMenuOption(title: String, chosen: Boolean, select: () -> Unit) {
    DropdownMenuItem(text = { Text(title) }, onClick = select,
        modifier = Modifier.semantics { selected = chosen; role = Role.RadioButton },
        trailingIcon = { if (chosen) Glyph(R.drawable.ic_check, size = 18) })
}

@Composable
private fun SidebarDestination(item: JSONObject, chosen: Boolean, action: () -> Unit) {
    SidebarLink(item.optString("title"), action, chosen = chosen) {
        if (item.has("icon")) NavigationGlyph(item.optJSONObject("icon"))
        else Glyph(when (item.optJSONObject("open")?.optString("native")) {
            "board" -> R.drawable.ic_circle_dot
            "collector" -> R.drawable.ic_inbox
            "schedule" -> R.drawable.ic_clock
            else -> R.drawable.ic_panels_top_left
        }, size = 21)
    }
}

@Composable
private fun SidebarLink(title: String, action: () -> Unit, tag: String = "", chosen: Boolean = false, icon: @Composable () -> Unit) {
    val selectedColor = if (isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHighest else DuduStyle.selected
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(12.dp))
        .background(if (chosen) selectedColor else Color.Transparent).testTag(tag)
        .selectable(chosen, role = Role.Button, onClick = action)
        .heightIn(min = 44.dp).padding(horizontal = 10.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        icon()
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
