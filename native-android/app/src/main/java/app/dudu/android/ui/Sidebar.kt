package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
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
private data class SidebarGroup(val id: String, val workspace: JSONObject?, val sessions: List<JSONObject>,
    val collapsed: Boolean)

@Composable
fun DuduSidebar(state: UiState, model: DuduViewModel, opened: Boolean, close: () -> Unit) {
    var inventory by remember(state.computerId) { mutableStateOf(SidebarInventory(emptyList(), emptyList())) }
    var moreExpanded by remember(state.computerId) { mutableStateOf(false) }
    val folded = remember { mutableStateMapOf<String, Boolean>() }
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
    // Freeze the interval structure before LazyColumn starts measuring its items.
    val groups = inventory.sessions.filterNot { it.optBoolean("archived") }
        .groupBy { it.optString("workspaceId") }.map { (id, entries) ->
            SidebarGroup(id, inventory.workspaces.find { it.optString("id") == id }, entries, folded[id] == true)
        }
    val navigation = remember(state.navigation) { sidebarNavigation(state.navigation) }
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
                SidebarDestination(item) { close(); model.navigateItem(item) }
            } else {
                item { SidebarLink(w("看板"), { close(); model.navigate(null) }) { Glyph(R.drawable.ic_circle_dot, size = 21) } }
                item { SidebarLink(w("收件箱"), { route(Route("collector")) }, "nav-collector") { Glyph(R.drawable.ic_inbox, size = 21) } }
                item { SidebarLink(w("定时任务"), { route(Route("tasks")) }, "nav-tasks") { Glyph(R.drawable.ic_clock, size = 21) } }
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
                    SidebarDestination(item) { close(); model.navigateItem(item) }
                }
            }
            item {
                Row(Modifier.fillMaxWidth().padding(start = 26.dp, end = 16.dp, top = 18.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(w("工作区"), Modifier.weight(1f), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    IconButton(onClick = { route(Route("sessions")) }, modifier = Modifier.size(40.dp).testTag("nav-sessions")) {
                        Glyph(R.drawable.ic_sliders_horizontal, w("会话"), 18, MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            groups.forEach { group ->
                group.workspace?.let { workspace -> item {
                    TextButton(onClick = { folded[group.id] = !group.collapsed },
                        contentPadding = PaddingValues(horizontal = 26.dp, vertical = 6.dp)) {
                        Text(workspace.optString("name"), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (group.collapsed) Glyph(R.drawable.ic_chevron_right, size = 12, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                } }
                if (!group.collapsed) items(group.sessions, key = { it.getString("id") }) { session ->
                    Row(Modifier.fillMaxWidth().height(46.dp).combinedClickable(onClick = {
                        close(); model.openSession(session.getString("id"), session.optString("title"))
                    }).padding(start = 26.dp, end = 20.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        AgentLogo(session.nullableString("agent") ?: session.nullableString("providerId"), 18)
                        Text(session.optString("title"), Modifier.weight(1f), maxLines = 1, fontSize = 15.sp,
                            overflow = TextOverflow.Ellipsis)
                        if (session.optBoolean("pinned")) Glyph(R.drawable.ic_pin, size = 14, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        else Text(receivedTime(session.optLong("updatedAt")), fontSize = 10.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
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
}

@Composable
private fun SidebarDestination(item: JSONObject, action: () -> Unit) {
    SidebarLink(item.optString("title"), action) {
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
private fun SidebarLink(title: String, action: () -> Unit, tag: String = "", icon: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().testTag(tag).clickable(onClick = action)
        .heightIn(min = 44.dp).padding(horizontal = 26.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        icon()
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
