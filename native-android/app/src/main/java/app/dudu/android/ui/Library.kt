@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.delay
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

@Composable
fun SessionsScreen(state: UiState, model: DuduViewModel) {
    val actions = rememberActions()
    var sessions by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var workspaces by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var hits by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var query by rememberSaveable { mutableStateOf("") }
    var archive by rememberSaveable { mutableStateOf(state.preferences.optBoolean("sessions.archive")) }
    var grouped by rememberSaveable { mutableStateOf(state.preferences.optBoolean("sessions.grouped", true)) }
    val folded = remember { mutableStateMapOf<String, Boolean>() }
    var editing by remember { mutableStateOf<JSONObject?>(null) }
    var editWorkspace by remember { mutableStateOf(false) }
    var title by remember { mutableStateOf("") }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(actions.revision) { actions.run {
        sessions = (model.value("session.list") as JSONArray).objects()
        workspaces = (model.value("workspace.list") as JSONArray).objects()
    } }
    LaunchedEffect(query) {
        hits = emptyList()
        if (query.isNotBlank()) {
            delay(250)
            runCatching { model.request("session.search", json("query" to query.trim())).rows("items") }
                .onSuccess { hits = it }
                .onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
        }
    }
    fun act(method: String, params: JSONObject) = actions.run { model.value(method, params); actions.refresh() }
    val rows = if (query.isNotBlank()) {
        val local = sessions.filter { it.optString("title").contains(query, true) }
        (local + hits.map { it.getJSONObject("session") }).distinctBy { it.getString("id") }
    } else sessions
    val visible = rows.filter { archive || !it.optBoolean("archived") }
        .sortedWith(compareByDescending<JSONObject> { it.optBoolean("pinned") }.thenByDescending { it.optLong("updatedAt") })
    val groups = if (grouped) visible.groupBy { it.optString("workspaceId") } else mapOf("" to visible)
    Page(w("会话"), model::backRoute, actions, top = {
        var menu by remember { mutableStateOf(false) }
        Box {
            IconButton(onClick = { menu = true }) { Glyph(R.drawable.ic_ellipsis, stringResource(R.string.more)) }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text(w("全部对话（显示已归档）")) }, onClick = { archive = !archive; model.preference("sessions.archive", archive); menu = false },
                    trailingIcon = { if (archive) Glyph(R.drawable.ic_check, size = 18) })
                DropdownMenuItem(text = { Text(w("工作区")) }, onClick = { grouped = !grouped; model.preference("sessions.grouped", grouped); menu = false },
                    trailingIcon = { if (grouped) Glyph(R.drawable.ic_check, size = 18) })
                DropdownMenuItem(text = { Text(w("刷新")) }, onClick = { actions.refresh(); menu = false })
            }
        }
        IconButton(onClick = { model.navigate(Route("session-new")) }, enabled = !actions.busy) { Glyph(R.drawable.ic_plus, w("新建会话")) }
    }) {
        Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            SearchField(query, w("搜索会话"), tag = "session-search") { query = it }
        }
        LazyColumn(Modifier.fillMaxSize()) {
            groups.forEach { (id, entries) ->
                val group = workspaces.find { it.optString("id") == id }
                if (grouped && group != null) item {
                    Line(group.getString("name"), detail = "${entries.size}", icon = R.drawable.ic_folder,
                        action = { folded[id] = folded[id] != true },
                        trailing = {
                            var expanded by remember { mutableStateOf(false) }
                            Box {
                                IconButton(onClick = { expanded = true }) { Glyph(R.drawable.ic_ellipsis, size = 20) }
                                DropdownMenu(expanded, { expanded = false }) {
                                    DropdownMenuItem(text = { Text(w("重命名")) }, onClick = {
                                        editing = group; editWorkspace = true; title = group.getString("name"); expanded = false
                                    })
                                    DropdownMenuItem(text = { Text(stringResource(R.string.delete), color = MaterialTheme.colorScheme.error) },
                                        onClick = { deleting = group; expanded = false })
                                }
                            }
                        })
                }
                if (folded[id] != true) items(entries, key = { it.getString("id") }) { row ->
                    val sid = row.getString("id")
                    ListItem(
                        headlineContent = { Text(row.optString("title").ifEmpty { sid }, maxLines = 2) },
                        supportingContent = hits.find { it.optJSONObject("session")?.optString("id") == sid }
                            ?.nullableString("snippet")?.let { { Text(it, maxLines = 2) } },
                        leadingContent = { AgentLogo(row.nullableString("agent") ?: row.nullableString("providerId"), 22) },
                        trailingContent = {
                            var expanded by remember { mutableStateOf(false) }
                            Box {
                                IconButton(onClick = { expanded = true }) { Glyph(R.drawable.ic_ellipsis, size = 20) }
                                DropdownMenu(expanded, { expanded = false }) {
                                    DropdownMenuItem(text = { Text(w("重命名")) }, onClick = {
                                        editing = row; editWorkspace = false; title = row.optString("title"); expanded = false
                                    })
                                    DropdownMenuItem(text = { Text(stringResource(if (row.optBoolean("pinned")) R.string.unpin else R.string.pin)) },
                                        onClick = { expanded = false; act("session.pin", json("id" to sid, "pinned" to !row.optBoolean("pinned"))) })
                                    DropdownMenuItem(text = { Text(if (row.optBoolean("archived")) w("恢复") else w("归档")) },
                                        onClick = { expanded = false; act(if (row.optBoolean("archived")) "session.unarchive" else "session.archive", json("id" to sid)) })
                                }
                            }
                        }, modifier = Modifier.testTag("session-$sid").combinedClickable(onClick = {
                            model.openSession(sid, row.optString("title"))
                        }))
                }
            }
        }
    }
    editing?.let { row -> AlertDialog(onDismissRequest = { editing = null }, title = { Text(w("重命名")) },
        text = { Field(w("名称"), title) { title = it } },
        confirmButton = { TextButton(onClick = {
            actions.run {
                model.request(if (editWorkspace) "workspace.rename" else "session.rename",
                    json("id" to row.getString("id"), "title" to title.trim()))
                editing = null; actions.refresh()
            }
        }, enabled = title.isNotBlank() && !actions.busy) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = { editing = null }) { Text(stringResource(R.string.cancel)) } }) }
    deleting?.let { group -> Confirm(w("删除工作区"), group.optString("name"), actions,
        { deleting = null }, { actions.run {
            model.request("workspace.delete", json("id" to group.getString("id"))); deleting = null; actions.refresh()
        } }) }
}

/**
 * The inbox (收件箱), in a sheet of the Dudu chat (`onHeight` reports how high the sheet has to be) or as a page of its own. In a sheet its bar has 选择 before the ✕; choosing shows 取消 / 已选 {0} 条 / 全选
 * and no ✕, and a labelled bar of what can be done to the chosen rows (owner, 2026-11-18, the inbox redesign; the drawings are `.local/designs/inbox-forward-android-2026-11-18/`). 转发 replaces the two
 * shares: it goes to a conversation, one at a time (`ForwardPicker`).
 */
@Composable
fun CollectorScreen(model: DuduViewModel, back: () -> Unit = model::backRoute,
    onHeight: ((Int) -> Unit)? = null, open: (Route) -> Unit = { model.navigate(it) }, refreshKey: Int = 0, active: Boolean = true) {
    val actions = rememberActions()
    val sheet = onHeight != null
    var tab by rememberSaveable { mutableStateOf("todo") }
    var filter by rememberSaveable { mutableStateOf("") }
    var items by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var names by remember { mutableStateOf(json()) }
    var next by remember { mutableStateOf<String?>(null) }
    var selecting by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<Set<Long>>(emptySet()) }
    var forwarding by remember { mutableStateOf<List<JSONObject>?>(null) }
    var deleting by remember { mutableStateOf(false) }
    var revealed by remember { mutableStateOf<Long?>(null) }
    var rowMenu by remember { mutableStateOf<JSONObject?>(null) }
    var total by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val rowHeights = remember { mutableStateMapOf<Long, Int>() }
    var tabsHeight by remember { mutableIntStateOf(44) }
    /** A handled record that went to an issue is the issue's: nothing to choose it for. */
    fun canChoose(record: JSONObject) = tab != "done" || record.optJSONObject("issue") == null
    fun load(more: Boolean = false) = actions.run {
        val params = json("tab" to tab).apply {
            if (more) next?.let { put("cursor", it) }
            if (filter.isNotBlank()) put("connector", JSONArray(listOf(filter)))
        }
        val result = model.request("inbox.list", params)
        items = (if (more) items + result.rows("items") else result.rows("items")).distinctBy { it.getLong("id") }
        names = result.optJSONObject("names") ?: json(); next = result.nullableString("nextCursor")
        total = result.optInt("total", items.size)
        selected = selected.filter { id -> items.any { it.getLong("id") == id } }.toSet()
    }
    LaunchedEffect(tab, filter) { selecting = false; selected = emptySet(); revealed = null }
    LaunchedEffect(tab, filter, actions.revision, refreshKey, active) { if (active) load() }
    if (onHeight != null) {
        // The sheet is as high as its content (the bar, the tabs, the rows as drawn, the labelled bar while choosing), up to what the sheet allows.
        val height = 54 + tabsHeight + items.sumOf { rowHeights[it.getLong("id")] ?: 76 } + (if (items.isEmpty()) 120 else 0) + 24 + (if (selecting) 78 else 0)
        LaunchedEffect(height) { onHeight(height) }
    }
    fun stopChoosing() { selecting = false; selected = emptySet() }
    fun mark(action: String) = actions.run {
        model.request("inbox.mark", json("action" to action, "ids" to JSONArray(selected.toList())))
        deleting = false; stopChoosing(); actions.refresh()
    }
    fun markOne(action: String, record: JSONObject) = actions.run {
        model.request("inbox.mark", json("action" to action, "ids" to JSONArray(listOf(record.getLong("id")))))
        revealed = null; actions.refresh()
    }
    val choosableCount = items.count(::canChoose)
    Page(if (selecting) w("已选 {0} 条").replace("{0}", selected.size.toString()) else w("收件箱"),
        { if (selecting) stopChoosing() else back() }, actions, cancels = selecting && sheet,
        count = total.takeIf { sheet && !selecting }, top = {
        if (selecting) TextButton(onClick = { selected = items.filter(::canChoose).map { it.getLong("id") }.toSet() },
            enabled = !actions.busy && selected.size < choosableCount) { Text(w("全选")) }
        else {
            if (names.length() > 1 || filter.isNotBlank()) Box {
                var choosing by remember { mutableStateOf(false) }
                IconButton(onClick = { choosing = true }, enabled = !actions.busy) {
                    Glyph(R.drawable.ic_sliders_horizontal, w("收集器"), 22)
                }
                DropdownMenu(choosing, { choosing = false }) {
                    (listOf("" to w("全部")) + names.keys().asSequence().map { it to names.optString(it) }.toList()).forEach { (id, title) ->
                        DropdownMenuItem(text = { Text(title) }, onClick = { filter = id; choosing = false },
                            trailingIcon = { if (filter == id) Glyph(R.drawable.ic_check, size = 18) })
                    }
                }
            }
            if (sheet && choosableCount > 0) TextButton(onClick = { selecting = true }, enabled = !actions.busy,
                modifier = Modifier.testTag("collector-select")) { Text(w("选择")) }
        }
    }) {
        Box(Modifier.onSizeChanged { tabsHeight = (it.height / density.density).roundToInt() }) {
            FilterTabs(tab, listOf("todo" to w("待处理"), "done" to w("已处理"))) { tab = it }
        }
        LazyColumn(Modifier.weight(1f).testTag("collector-list"), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (items.isEmpty() && !actions.busy && actions.error == null) item {
                Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                    Text(w("没有信息"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            itemsIndexed(items, key = { _, record -> record.getLong("id") }) { index, record ->
                val id = record.getLong("id")
                val choosable = canChoose(record)
                val swipe = if (selecting || !choosable) emptyList() else buildList {
                    if (tab == "todo") add(RowSwipeAction(w("已处理"), R.drawable.ic_check, Color(0xFF18191B)) { markOne("done", record) })
                    else add(RowSwipeAction(w("恢复"), R.drawable.ic_rotate_ccw, DuduStyle.blue) { markOne("restore", record) })
                    add(RowSwipeAction(w("删除"), R.drawable.ic_trash2, Color(0xFFE14848)) { markOne("delete", record) })
                }
                Box(Modifier.onSizeChanged { rowHeights[id] = (it.height / density.density).roundToInt() }) {
                LibraryRowGroup(index == 0, index == items.lastIndex, grouped = sheet, inset = 16,
                    dividerStart = if (selecting) 104 else 70, dividerEnd = 14) {
                SwipeMenuRow(swipe, enabled = !actions.busy, revealed = revealed == id,
                    onReveal = { revealed = if (it) id else null }) { closeSwipe ->
                Box {
                Surface(color = if (sheet) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.background) {
                Box(Modifier.fillMaxWidth().testTag("record-$id").combinedClickable(
                    onClick = {
                        if (revealed != null) { revealed = null; closeSwipe() }
                        else if (selecting) { if (choosable) selected = if (id in selected) selected - id else selected + id }
                        else open(Route("record", record.optString("title"), id.toString()))
                    }, onLongClick = { if (!selecting) rowMenu = record })) {
                    CollectorSummary(record, tab, selecting, id in selected, horizontalPadding = if (sheet) 14 else 10)
                }
                }
                DropdownMenu(rowMenu?.optLong("id") == id, { rowMenu = null }) {
                    if (choosable) DropdownMenuItem(text = { Text(w("选择")) }, onClick = { selecting = true; selected = setOf(id); rowMenu = null })
                    record.optJSONObject("issue")?.let { issue ->
                        DropdownMenuItem(text = { Text(w("打开事项")) }, onClick = { rowMenu = null
                            model.navigate(Route("issue", issue.optString("title"), issue.getLong("id").toString())) })
                    } ?: run {
                        if (tab != "done") {
                            DropdownMenuItem(text = { Text(w("转发")) }, enabled = !actions.busy,
                                leadingIcon = { Glyph(R.drawable.ic_forward, size = 18) }, onClick = { rowMenu = null; forwarding = listOf(record) })
                            DropdownMenuItem(text = { Text(w("新建事项")) }, onClick = { rowMenu = null; actions.run {
                                val result = model.request("inbox.get", json("id" to id))
                                val draft = result.optJSONObject("draft")
                                val full = result.getJSONObject("record")
                                model.editDraft(IssueDraft(title = draft?.optString("title") ?: full.optString("title"),
                                    description = draft?.optString("brief") ?: full.optString("text"), record = id)); model.show(Panel.Create)
                            } })
                        }
                    }
                    DropdownMenuItem(text = { Text(w("补全上下文")) }, enabled = !actions.busy && !record.optBoolean("completing"),
                        onClick = { rowMenu = null; actions.run { model.request("inbox.complete", json("id" to id)); actions.refresh() } })
                    if (record.optJSONObject("issue") == null) {
                        if (tab == "todo") DropdownMenuItem(text = { Text(w("已处理")) }, onClick = { rowMenu = null; markOne("done", record) })
                        else DropdownMenuItem(text = { Text(w("恢复")) }, onClick = { rowMenu = null; markOne("restore", record) })
                        DropdownMenuItem(text = { Text(w("删除"), color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { Glyph(R.drawable.ic_trash2, size = 18, tint = MaterialTheme.colorScheme.error) },
                            onClick = { rowMenu = null; markOne("delete", record) })
                    }
                }
                }
                }
                }
                }
            }
            if (next != null) item { TextButton(onClick = { load(true) }, enabled = !actions.busy,
                modifier = Modifier.fillMaxWidth()) { Text(w("加载更多")) } }
        }
        if (selecting) {
            // What can be done to all the chosen rows at once, with the words under the icons: forward them, mark them handled, delete them (red).
            val ready = selected.isNotEmpty() && !actions.busy
            ActionBar(listOf(
                BarItem(w("转发"), R.drawable.ic_forward, "bulk-forward", enabled = ready) { forwarding = items.filter { it.getLong("id") in selected } },
                BarItem(w("已处理"), R.drawable.ic_check, "bulk-done", enabled = ready) { mark("done") },
                BarItem(w("删除"), R.drawable.ic_trash2, "bulk-delete", danger = true, enabled = ready) { deleting = true },
            ))
        }
    }
    if (deleting) Confirm(w("将要删除"), "${selected.size}", actions, { deleting = false }, { mark("delete") })
    forwarding?.let { records ->
        ForwardPicker(model, records, dismiss = { forwarding = null }, forwarded = { stopChoosing(); actions.refresh() })
    }
}

/**
 * One record in full, pushed over the list (‹ and ✕) or on its own (✕): the header is only the frame (owner, 2026-11-18, the inbox redesign: no ↗ and no ⋯), the words are one white card
 * (`RecordCard`), and what can be done is the labelled bar at the bottom: 转发 and 新建事项, the mark that is done with the record (已处理, or 恢复 on a handled one), and 更多, a menu of
 * filling in the context and deleting it (in red). A record an issue holds has 打开事项 and 补全上下文 and no 更多.
 */
@Composable
fun RecordScreen(route: Route, model: DuduViewModel, back: () -> Unit = model::backRoute, close: (() -> Unit)? = null) {
    val actions = rememberActions()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var record by remember { mutableStateOf<JSONObject?>(null) }
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    var forwarding by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val id = route.target!!.toLong()
    PreventSheetDismiss(actions.busy)
    LaunchedEffect(actions.revision) { actions.run {
        val result = model.request("inbox.get", json("id" to id))
        record = result.getJSONObject("record"); draft = result.optJSONObject("draft")
    } }
    LaunchedEffect(record?.optBoolean("completing"), lifecycle) {
        if (record?.optBoolean("completing") == true) {
            lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (true) { delay(2500); if (!actions.busy) actions.refresh() }
            }
        }
    }
    fun mark(action: String) = actions.run {
        model.request("inbox.mark", json("ids" to JSONArray(listOf(id)), "action" to action))
        back()
    }
    fun complete() = actions.run {
        model.request("inbox.complete", json("id" to id)); actions.refresh()
    }
    fun create() {
        val item = record ?: return
        model.editDraft(IssueDraft(title = draft?.optString("title") ?: item.optString("title"),
            description = draft?.optString("brief") ?: item.optString("text"), record = id))
        model.show(Panel.Create)
    }
    Page(w("收件箱"), { if (!actions.busy) back() }, actions, nested = close != null,
        close = close?.let { action -> { if (!actions.busy) action() } }) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp)) {
            record?.let { RecordContent(it) }
        }
        record?.let { item ->
            val tab = recordTab(item)
            val linked = item.optJSONObject("issue")
            val ready = !actions.busy
            val completing = item.optBoolean("completing")
            val fillIn = BarItem(w("补全上下文"), R.drawable.ic_refresh_cw, "record-complete", enabled = ready && !completing, busy = completing) { complete() }
            val more = BarItem(w("更多"), R.drawable.ic_ellipsis, "record-more", enabled = ready, busy = completing, menu = { closeMenu ->
                DropdownMenuItem(text = { Text(w("补全上下文")) }, leadingIcon = { Glyph(R.drawable.ic_refresh_cw, size = 20) },
                    enabled = ready && !completing, onClick = { closeMenu(); complete() })
                if (linked == null) DropdownMenuItem(text = { Text(w("删除"), color = MaterialTheme.colorScheme.error) },
                    leadingIcon = { Glyph(R.drawable.ic_trash2, size = 20, tint = MaterialTheme.colorScheme.error) },
                    enabled = ready, onClick = { closeMenu(); deleting = true })
            })
            ActionBar(if (tab == "done") {
                if (linked != null) listOf(
                    BarItem(w("打开事项"), R.drawable.ic_arrow_up_right, "record-open-issue", enabled = ready) {
                        model.navigate(Route("issue", linked.optString("title"), linked.getLong("id").toString()))
                    }, fillIn)
                else listOf(BarItem(w("恢复"), R.drawable.ic_rotate_ccw, "record-restore", enabled = ready) { mark("restore") }, more)
            } else listOf(
                BarItem(w("转发"), R.drawable.ic_forward, "record-forward", enabled = ready) { forwarding = true },
                BarItem(w("新建事项"), R.drawable.ic_plus, "record-create", enabled = ready) { create() },
                BarItem(w("已处理"), R.drawable.ic_check, "record-done", enabled = ready) { mark("done") },
                more))
        }
    }
    if (forwarding) record?.let { item ->
        ForwardPicker(model, listOf(item), dismiss = { forwarding = false }, forwarded = { back() })
    }
    if (deleting) Confirm(w("将要删除"), record?.optString("title"), actions, { deleting = false }, { mark("delete") })
}

/** The record's title, who it is from and when, what became of it, the card of its words, and the context that was read around it. */
@Composable
private fun RecordContent(item: JSONObject) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val issue = item.optJSONObject("issue")
    Column(Modifier.padding(horizontal = 4.dp)) {
        Text(item.optString("title"), fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold)
        Text(listOfNotNull(item.nullableString("ref"), item.nullableString("from"), item.nullableString("connectorName"),
            item.optLong("at").takeIf { it > 0 }?.let { relativeTime(it) }).joinToString(" · "),
            Modifier.padding(top = 8.dp), fontSize = 13.sp, lineHeight = 18.sp, color = muted)
        issue?.let { Text((if (item.optString("verdict") == "issue") w("已新建 ") else w("已转发到 ")) + (it.nullableString("ref") ?: "#${it.optLong("id")}"),
            Modifier.padding(top = 6.dp), fontSize = 13.sp, lineHeight = 18.sp, color = muted) }
    }
    RecordCard(item, Modifier.padding(top = 10.dp))
    val context = item.rows("context")
    if (context.isNotEmpty()) Text(w("上下文"), Modifier.padding(start = 4.dp, top = 24.dp), fontSize = 12.sp, color = muted)
    context.forEach { entry ->
        Row(Modifier.padding(start = 4.dp, top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            entry.nullableString("from")?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
            entry.optLong("at").takeIf { it > 0 }?.let { Text(relativeTime(it), fontSize = 12.sp, color = muted) }
        }
        Text(entry.optString("text"), Modifier.padding(start = 4.dp), fontSize = 13.sp, color = muted)
    }
    if (item.optBoolean("completing")) LinearProgressIndicator(Modifier.fillMaxWidth().padding(top = 16.dp))
    item.nullableString("completeError")?.let { Text(it, Modifier.padding(start = 4.dp, top = 12.dp), color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
}
