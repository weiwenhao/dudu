package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
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

/** `search` opens the drawer's search over it (the iPhone's `ConversationSearchView`), with the conversations listed here for the titles it matches at once. */
@Composable
fun DuduSidebar(state: UiState, model: DuduViewModel, opened: Boolean, search: (List<JSONObject>) -> Unit = {}, close: () -> Unit) {
    var inventory by remember(state.computerId) { mutableStateOf(SidebarInventory(emptyList(), emptyList())) }
    var viewOptionsOpen by remember(opened) { mutableStateOf(false) }
    var archivedChoice by remember(state.computerId) { mutableStateOf<JSONObject?>(null) }
    var renaming by remember(state.computerId) { mutableStateOf<JSONObject?>(null) }
    // The list as the iPhone's sidebar reads it: 正在加载会话 while nothing is known yet, and the failure with 重试 until a read succeeds.
    var loading by remember(state.computerId) { mutableStateOf(false) }
    var loadProblem by remember(state.computerId) { mutableStateOf<String?>(null) }
    var reload by remember(state.computerId) { mutableIntStateOf(0) }
    var changeProblem by remember { mutableStateOf<String?>(null) }
    val actions = rememberActions()
    val options = remember(state.preferences) { SidebarOptions.parse(state.preferences) }
    val collapsed = remember(state.preferences) {
        state.preferences.optJSONArray("sidebar.collapsed")?.strings()?.toSet().orEmpty()
    }
    LaunchedEffect(opened, state.computerId, state.connected, reload) {
        if (!opened || !state.connected) return@LaunchedEffect
        var quiet = inventory.sessions.isNotEmpty() || inventory.workspaces.isNotEmpty()
        do {
            if (!quiet) { loading = true; loadProblem = null }
            try {
                val sessions = (model.value("session.list") as JSONArray).objects()
                val workspaces = (model.value("workspace.list") as JSONArray).objects()
                inventory = SidebarInventory(sessions, workspaces)
                loadProblem = null
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("sidebar.sessions.fail", error)
                loadProblem = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
            } finally { loading = false }
            quiet = true
            delay(5000)
        } while (true)
    }
    // A change of a conversation (rename, pin, archive) runs on the computer, and the list is read again; a failure is said in a toast, as the iPhone's `store.error`.
    fun change(method: String, params: JSONObject) {
        DuduLog.record("sidebar.session.change", method = method)
        actions.run {
            try {
                model.value(method, params)
                reload++
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("sidebar.session.change.fail", error, method = method)
                changeProblem = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
            }
        }
    }
    changeProblem?.let { code ->
        val text = if (code in listOf("UNSUPPORTED", "METHOD_NOT_ALLOWED")) w("请更新电脑端的 Dudu 插件") else problemText(code)
        LaunchedEffect(code, text) { model.toast(text, ToastKind.Error, literal = true); changeProblem = null }
    }
    fun route(value: Route) {
        close()
        val tab = HomeTab.forRoute(value)
        if (tab != null) model.selectHomeTab(tab) else model.navigate(value)
    }
    fun chooseOption(key: String, value: String) {
        model.preference(key, value)
        DuduLog.record(key, state = value)
        viewOptionsOpen = false
    }
    // Freeze the interval structure before LazyColumn starts measuring its items.
    val entries = remember(inventory, options, collapsed) {
        sidebarEntries(inventory.sessions, inventory.workspaces, options, collapsed)
    }
    // What DSH lists, all of it (no 查看更多), without what the bottom bar has.
    val destinations = remember(state.navigation) {
        sidebarNavigation(state.navigation).let { it.primary + it.additional }.filterNot(::isBarDestination)
    }
    val conversationOpen = state.conversationTitle != null
    val page = pageRoute(state.route, model.routesBehindCurrent(), conversationOpen)
        ?: state.homeTab.routeName?.takeIf { !conversationOpen }?.let { Route(it) }
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
        Surface(onClick = { DuduLog.record("sidebar.search.open"); search(inventory.sessions) }, Modifier.padding(horizontal = 16.dp),
            shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.fillMaxWidth().height(44.dp).padding(horizontal = 14.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Glyph(R.drawable.ic_search, size = 18, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(w("搜索对话内容…"), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        // Why DSH's entries are missing, instead of a guess at them (the iPhone's `navigationHint`).
        val hint = when {
            state.navigation.rows("sidebar").isNotEmpty() -> null
            state.navigationUnsupported -> w("电脑上的 Dudu 插件需要更新后，这里才会显示 DSH 的入口。")
            state.navigation.has("available") && !state.navigation.optBoolean("available") -> w("打开一次电脑上的 DSH 窗口后，这里会显示 DSH 的入口。")
            else -> null
        }
        LazyColumn(Modifier.weight(1f).padding(top = 12.dp)) {
            items(destinations, key = { "nav:${it.optString("id")}" }) { item ->
                SidebarDestination(item, sidebarItemSelected(item, page, conversationOpen)) { close(); model.navigateItem(item) }
            }
            if (hint != null) item("nav-hint") {
                Text(hint, Modifier.fillMaxWidth().padding(horizontal = 26.dp, vertical = 6.dp).testTag("sidebar-navigation-hint"),
                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            item {
                Row(Modifier.fillMaxWidth().padding(start = 26.dp, end = 16.dp, top = 18.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(if (options.grouping == SidebarGrouping.Flat) w("会话") else w("工作区"),
                        Modifier.weight(1f), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Box {
                        IconButton(onClick = { viewOptionsOpen = true; DuduLog.record("sidebar.options.open") },
                            modifier = Modifier.size(40.dp).testTag("sidebar-view-options")) {
                            // The iPhone's own glyph (`DuduChecklistGlyph`), not Lucide's sliders (owner, 2026-11-21: 「安卓工作区右侧的图标不对呀，应该和 ios 保持一致」).
                            val optionsLabel = w("会话视图选项")
                            Box(Modifier.semantics { contentDescription = optionsLabel }) { ChecklistGlyph(20) }
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
            if (loading && entries.isEmpty()) item("sessions-loading") {
                Row(Modifier.padding(horizontal = 26.dp, vertical = 6.dp).testTag("sidebar-sessions-loading"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    RowSpinner(16)
                    Text(w("正在加载会话"), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            loadProblem?.let { code -> item("sessions-error") {
                Row(Modifier.fillMaxWidth().padding(horizontal = 26.dp, vertical = 6.dp).testTag("sidebar-sessions-error"),
                    verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(problemText(code), Modifier.weight(1f), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(w("重试"), Modifier.clickable { reload++ }.testTag("sidebar-sessions-retry"),
                        fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
            } }
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
                        val selected = conversationOpen && state.session?.id == session.optString("id")
                        SidebarSessionRow(session, selected, open = {
                            if (session.optBoolean("archived")) { actions.error = null; archivedChoice = session }
                            else { close(); model.openSession(session.getString("id"), session.optString("title")) }
                        }, rename = { renaming = session },
                            pin = { change("session.pin", json("id" to session.getString("id"), "pinned" to !session.optBoolean("pinned"))) },
                            archive = { change("session.archive", json("id" to session.getString("id"))) },
                            unarchive = { change("session.unarchive", json("id" to session.getString("id"))) })
                    }
                }
            }
            if (entries.isEmpty() && loadProblem == null && !loading) item {
                Text(if (options.archive == SidebarArchiveFilter.Only) w("暂无已归档会话") else w("暂无会话"),
                    Modifier.padding(horizontal = 26.dp, vertical = 8.dp),
                    fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically) {
            val computersLabel = w("电脑连接")
            FilledTonalButton(onClick = { close(); model.show(Panel.Computers) },
                modifier = Modifier.weight(1f).semantics(mergeDescendants = true) { contentDescription = computersLabel },
                colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface)) {
                Glyph(R.drawable.ic_monitor, size = 19, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(8.dp))
                Text(state.computer.ifBlank { w("选择电脑") }, modifier = Modifier.weight(1f, fill = false),
                    maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp)
                Spacer(Modifier.width(6.dp))
                Glyph(R.drawable.ic_chevron_down, size = 12, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.width(8.dp))
            // DSH's own settings (owner, 2026-11-21); 嘟嘟's are the bottom bar's 设置.
            val dshSettings = Route("navigation", w("DSH 设置"), "settings")
            IconButton(onClick = { route(dshSettings) }, modifier = Modifier.testTag("nav-settings")) {
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
    renaming?.let { session ->
        // The iPhone's 重命名会话 alert: the name in a field, 取消 and 重命名.
        var title by remember(session.optString("id")) { mutableStateOf(session.optString("title")) }
        AlertDialog(onDismissRequest = { renaming = null },
            title = { Text(w("重命名会话")) },
            text = { OutlinedTextField(title, { title = it }, placeholder = { Text(w("会话名称")) }, singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("session-rename")) },
            confirmButton = { TextButton(onClick = {
                renaming = null
                val name = title.trim()
                if (name.isNotEmpty()) change("session.rename", json("id" to session.getString("id"), "title" to name))
            }) { Text(w("重命名")) } },
            dismissButton = { TextButton(onClick = { renaming = null }) { Text(w("取消")) } })
    }
}

/**
 * A conversation of the drawer, the iPhone's `SidebarSessionRow`: its agent's 20 dp avatar with the working ring or the unread dot, a blue dot before a running conversation that has no agent,
 * the title (新会话 when it has none), and the pin or the time (刚刚, N分钟, N小时, 昨天, the date) in a 44 dp column. The open conversation is highlighted; an archived one is greyed out.
 * A long press opens its menu at the finger: 重命名, 置顶 or 取消置顶, 归档; an archived one has 取消归档 (DSH never deletes a conversation).
 */
@Composable
private fun SidebarSessionRow(session: JSONObject, selected: Boolean, open: () -> Unit, rename: () -> Unit, pin: () -> Unit,
    archive: () -> Unit, unarchive: () -> Unit) {
    val archived = session.optBoolean("archived")
    val pinned = session.optBoolean("pinned") && !archived
    val agent = session.nullableString("agent")
    var menu by remember { mutableStateOf(false) }
    val press = remember { PressPoint() }
    val selectedColor = if (isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHighest else DuduStyle.selected
    Box(Modifier.padding(horizontal = 16.dp).notePress(press)) {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp)).background(if (selected) selectedColor else Color.Transparent)
            .combinedClickable(onClick = open, onLongClick = { menu = true; DuduLog.record("sidebar.session.menu") })
            .heightIn(min = 46.dp).padding(start = 10.dp, end = 4.dp).alpha(if (archived) .45f else 1f)
            .testTag("session-${session.optString("id")}"), verticalAlignment = Alignment.CenterVertically) {
            if (agent != null) {
                AgentAvatar(agent, session.optString("sessionState", "idle"), 20)
                Spacer(Modifier.width(10.dp))
            }
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterStart) {
                if (agent == null && session.optString("status") == "running") Box(Modifier
                    .offset(x = (-8.5).dp).size(5.dp).background(DuduStyle.blue, CircleShape))
                Text(session.optString("title").ifEmpty { w("新会话") }, maxLines = 1, fontSize = 15.sp, overflow = TextOverflow.Ellipsis)
            }
            Box(Modifier.width(44.dp), contentAlignment = Alignment.Center) {
                if (pinned) Glyph(R.drawable.dudu_pin, w("已置顶"), 16, MaterialTheme.colorScheme.onSurfaceVariant)
                else Text(drawerTime(session.optLong("updatedAt")), fontSize = 10.sp, maxLines = 1,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        DropdownMenu(menu, { menu = false }, offset = press.menuOffset()) {
            if (archived) DropdownMenuItem(text = { Text(w("取消归档")) }, leadingIcon = { MenuInkGlyph(DuduGlyphs.archiveRestore) },
                onClick = { menu = false; unarchive() })
            else {
                DropdownMenuItem(text = { Text(w("重命名")) }, leadingIcon = { MenuInkGlyph(DuduGlyphs.editLine) },
                    onClick = { menu = false; rename() })
                DropdownMenuItem(text = { Text(if (session.optBoolean("pinned")) w("取消置顶") else w("置顶")) },
                    leadingIcon = { MenuInkGlyph(R.drawable.dudu_pin) }, onClick = { menu = false; pin() })
                DropdownMenuItem(text = { Text(w("归档")) }, leadingIcon = { MenuInkGlyph(DuduGlyphs.archive) },
                    onClick = { menu = false; archive() })
            }
        }
    }
}

/** When a conversation was last touched, the iPhone's `relativeTime`: 刚刚, N分钟, N小时, 昨天 (up to two days), then the month and day. */
@Composable
private fun drawerTime(at: Long): String {
    if (at <= 0) return ""
    val seconds = maxOf(0L, (System.currentTimeMillis() - at) / 1000)
    return when {
        seconds < 60 -> w("刚刚")
        seconds < 3_600 -> w("{0}分钟").replace("{0}", (seconds / 60).toString())
        seconds < 86_400 -> w("{0}小时").replace("{0}", (seconds / 3_600).toString())
        seconds < 172_800 -> w("昨天")
        else -> monthDay(at)
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
