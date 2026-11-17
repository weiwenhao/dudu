@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
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

@Composable
fun CollectorScreen(model: DuduViewModel, back: () -> Unit = model::backRoute,
    onCount: ((Int) -> Unit)? = null, open: (Route) -> Unit = { model.navigate(it) }, refreshKey: Int = 0, active: Boolean = true) {
    val actions = rememberActions()
    var tab by rememberSaveable { mutableStateOf("todo") }
    var filter by rememberSaveable { mutableStateOf("") }
    var items by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var names by remember { mutableStateOf(json()) }
    var next by remember { mutableStateOf<String?>(null) }
    var selected by remember { mutableStateOf<Set<Long>>(emptySet()) }
    var share by remember { mutableStateOf<String?>(null) }
    var sharingIds by remember { mutableStateOf<Set<Long>>(emptySet()) }
    var deleting by remember { mutableStateOf(false) }
    var revealed by remember { mutableStateOf<Long?>(null) }
    var rowMenu by remember { mutableStateOf<JSONObject?>(null) }
    var total by remember { mutableIntStateOf(0) }
    fun load(more: Boolean = false) = actions.run {
        val params = json("tab" to tab).apply {
            if (more) next?.let { put("cursor", it) }
            if (filter.isNotBlank()) put("connector", JSONArray(listOf(filter)))
        }
        val result = model.request("inbox.list", params)
        items = (if (more) items + result.rows("items") else result.rows("items")).distinctBy { it.getLong("id") }
        names = result.optJSONObject("names") ?: json(); next = result.nullableString("nextCursor")
        total = result.optInt("total", items.size)
    }
    LaunchedEffect(tab, filter) { selected = emptySet(); revealed = null }
    LaunchedEffect(tab, filter, actions.revision, refreshKey, active) { if (active) load() }
    LaunchedEffect(items.size) { onCount?.invoke(items.size) }
    fun mark(action: String) = actions.run {
        model.request("inbox.mark", json("action" to action, "ids" to JSONArray(selected.toList())))
        deleting = false; selected = emptySet(); actions.refresh()
    }
    fun markOne(action: String, record: JSONObject) = actions.run {
        model.request("inbox.mark", json("action" to action, "ids" to JSONArray(listOf(record.getLong("id")))))
        revealed = null; actions.refresh()
    }
    fun chooseShare(target: String, ids: Set<Long>) { sharingIds = ids; share = target }
    Page(if (selected.isEmpty()) w("收件箱") else w("已选 {0} 条").replace("{0}", selected.size.toString()),
        { if (selected.isNotEmpty()) selected = emptySet() else back() }, actions,
        count = total.takeIf { onCount != null && selected.isEmpty() }, top = {
        if (selected.isNotEmpty()) TextButton(onClick = { selected = items.filter { tab != "done" || it.optJSONObject("issue") == null }.map { it.getLong("id") }.toSet() },
            enabled = !actions.busy) { Text(w("全选")) }
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
    }) {
        FilterTabs(tab, listOf("todo" to w("待处理"), "done" to w("已处理"), "ignored" to w("已忽略"))) { tab = it }
        LazyColumn(Modifier.weight(1f).testTag("collector-list"), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (items.isEmpty() && !actions.busy && actions.error == null) item {
                Box(Modifier.fillParentMaxSize(), contentAlignment = Alignment.Center) {
                    Text(w("没有信息"), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            itemsIndexed(items, key = { _, record -> record.getLong("id") }) { index, record ->
                LibraryRowGroup(index == 0, index == items.lastIndex, grouped = onCount != null) {
                val id = record.getLong("id")
                val choosable = tab != "done" || record.optJSONObject("issue") == null
                val swipe = if (selected.isNotEmpty() || !choosable) emptyList() else buildList {
                    if (tab != "todo") add(RowSwipeAction(w("恢复"), R.drawable.ic_rotate_ccw, DuduStyle.blue) { markOne("restore", record) })
                    if (tab in listOf("todo", "ignored")) add(RowSwipeAction(w("已处理"), R.drawable.ic_check, Color(0xFF18191B)) { markOne("done", record) })
                    if (tab == "todo") add(RowSwipeAction(w("忽略"), R.drawable.ic_eye_off, Color(0xFF96989D)) { markOne("ignore", record) })
                    add(RowSwipeAction(w("删除"), R.drawable.ic_trash2, Color(0xFFE14848)) { markOne("delete", record) })
                }
                SwipeMenuRow(swipe, enabled = !actions.busy, revealed = revealed == id,
                    onReveal = { revealed = if (it) id else null }) { closeSwipe ->
                Box {
                Surface(color = if (id in selected) MaterialTheme.colorScheme.secondaryContainer else if (onCount != null)
                    MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.background) {
                Box(Modifier.fillMaxWidth().testTag("record-$id").combinedClickable(
                    onClick = {
                        if (revealed != null) { revealed = null; closeSwipe() }
                        else if (selected.isNotEmpty()) { if (choosable) selected = if (id in selected) selected - id else selected + id }
                        else open(Route("record", record.optString("title"), id.toString()))
                    }, onLongClick = { if (selected.isEmpty()) rowMenu = record })) {
                    CollectorSummary(record, tab, selected.isNotEmpty(), id in selected, horizontalPadding = if (onCount != null) 14 else 10)
                }
                }
                DropdownMenu(rowMenu?.optLong("id") == id, { rowMenu = null }) {
                    if (choosable) DropdownMenuItem(text = { Text(w("选择")) }, onClick = { selected = setOf(id); rowMenu = null })
                    record.optJSONObject("issue")?.let { issue ->
                        DropdownMenuItem(text = { Text(w("打开事项")) }, onClick = { rowMenu = null
                            model.navigate(Route("issue", issue.optString("title"), issue.getLong("id").toString())) })
                    } ?: run {
                        if (tab != "done") {
                            DropdownMenuItem(text = { Text(w("分享到事项")) }, enabled = !actions.busy,
                                leadingIcon = { Glyph(R.drawable.ic_list_plus, size = 18) }, onClick = { rowMenu = null; chooseShare("issue", setOf(id)) })
                            DropdownMenuItem(text = { Text(w("分享到会话")) }, enabled = !actions.busy,
                                leadingIcon = { Glyph(R.drawable.ic_message_square_plus, size = 18) }, onClick = { rowMenu = null; chooseShare("session", setOf(id)) })
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
                        if (tab != "todo") DropdownMenuItem(text = { Text(w("恢复")) }, onClick = { rowMenu = null; markOne("restore", record) })
                        if (tab in listOf("todo", "ignored")) DropdownMenuItem(text = { Text(w("已处理")) }, onClick = { rowMenu = null; markOne("done", record) })
                        if (tab == "todo") DropdownMenuItem(text = { Text(w("忽略")) }, onClick = { rowMenu = null; markOne("ignore", record) })
                        DropdownMenuItem(text = { Text(w("删除"), color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { Glyph(R.drawable.ic_trash2, size = 18, tint = MaterialTheme.colorScheme.error) },
                            onClick = { rowMenu = null; markOne("delete", record) })
                    }
                }
                }
                }
                }
            }
            if (next != null) item { TextButton(onClick = { load(true) }, enabled = !actions.busy,
                modifier = Modifier.fillMaxWidth()) { Text(w("加载更多")) } }
        }
        if (selected.isNotEmpty()) Surface(Modifier.padding(horizontal = 24.dp, vertical = 12.dp).fillMaxWidth(),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(50), color = MaterialTheme.colorScheme.surface,
            border = androidx.compose.foundation.BorderStroke(.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
            Row(Modifier.fillMaxWidth().height(48.dp), horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { chooseShare("issue", selected) }, enabled = !actions.busy) { Glyph(R.drawable.ic_list_plus, w("分享到事项"), 22) }
                IconButton(onClick = { chooseShare("session", selected) }, enabled = !actions.busy) { Glyph(R.drawable.ic_message_square_plus, w("分享到会话"), 22) }
                IconButton(onClick = { mark("done") }, enabled = !actions.busy) { Glyph(R.drawable.ic_check, w("已处理"), 22) }
                IconButton(onClick = { mark(if (tab == "ignored") "restore" else "ignore") }, enabled = !actions.busy) {
                    Glyph(if (tab == "ignored") R.drawable.ic_rotate_ccw else R.drawable.ic_eye_off,
                        if (tab == "ignored") w("恢复") else w("忽略"), 22)
                }
                IconButton(onClick = { deleting = true }, enabled = !actions.busy) { Glyph(R.drawable.ic_trash2, w("删除"), 22,
                    MaterialTheme.colorScheme.error) }
            }
        }
    }
    if (deleting) Confirm(w("将要删除"), "${selected.size}", actions, { deleting = false }, { mark("delete") })
    share?.let { target -> IssuePicker(model, target == "session", dismiss = { share = null }, busy = actions.busy, error = actions.error) { issue ->
        actions.run {
            model.request("inbox.share", json("ids" to JSONArray(sharingIds.toList()), "issue" to issue.getLong("id"), "to" to target))
            selected = emptySet(); share = null; actions.refresh()
        }
    } }
}

@Composable
fun RecordScreen(route: Route, model: DuduViewModel, back: () -> Unit = model::backRoute, close: (() -> Unit)? = null) {
    val actions = rememberActions()
    val context = LocalContext.current
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var record by remember { mutableStateOf<JSONObject?>(null) }
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    var sharing by remember { mutableStateOf<String?>(null) }
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
    Page(w("收件箱"), { if (!actions.busy) back() }, actions, centersSheetTitle = close != null,
        nested = close != null, close = close?.let { action -> { if (!actions.busy) action() } }, top = {
        var menu by remember { mutableStateOf(false) }
        record?.nullableString("url")?.let { url ->
            val uri = runCatching { android.net.Uri.parse(url) }.getOrNull()
            if (uri?.scheme?.lowercase() in listOf("http", "https")) IconButton(onClick = {
                runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, uri)) }
            }) { Glyph(R.drawable.ic_external_link, w("打开来源"), 20) }
        }
        Box {
            IconButton(onClick = { menu = true }) { Glyph(R.drawable.ic_ellipsis, stringResource(R.string.more)) }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text(w("补全上下文")) }, leadingIcon = { Glyph(R.drawable.ic_refresh_cw, size = 18) },
                    enabled = record != null && !actions.busy && record?.optBoolean("completing") != true,
                    onClick = { menu = false; complete() })
                if (record != null && record?.optJSONObject("issue") == null) {
                    val status = record!!.optString("status")
                    if (status == "todo") DropdownMenuItem(text = { Text(w("忽略")) }, leadingIcon = { Glyph(R.drawable.ic_eye_off, size = 18) },
                        enabled = !actions.busy, onClick = { menu = false; mark("ignore") })
                    if (status == "ignored") DropdownMenuItem(text = { Text(w("已处理")) }, leadingIcon = { Glyph(R.drawable.ic_check, size = 18) },
                        enabled = !actions.busy, onClick = { menu = false; mark("done") })
                    DropdownMenuItem(text = { Text(w("删除"), color = MaterialTheme.colorScheme.error) },
                        leadingIcon = { Glyph(R.drawable.ic_trash2, size = 18, tint = MaterialTheme.colorScheme.error) },
                        enabled = !actions.busy, onClick = { menu = false; deleting = true })
                }
            }
        }
    }) {
        Box(Modifier.weight(1f).fillMaxWidth()) { Form {
            record?.let { item ->
                Column(Modifier.padding(horizontal = 4.dp, vertical = 2.dp)) {
                Text(item.optString("title"), fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
                Text(listOf(item.optString("ref"), item.optString("from"), item.optString("connectorName"),
                    item.optLong("at").takeIf { it > 0 }?.let { relativeTime(it) }.orEmpty())
                    .filter(String::isNotBlank).joinToString(" · "), Modifier.padding(top = 10.dp), fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                item.optJSONObject("issue")?.let { issue -> Text(
                    (if (item.optString("verdict") == "issue") w("已新建 ") else w("已分享到 ")) + (issue.nullableString("ref") ?: "#${issue.optLong("id")}"),
                    Modifier.padding(top = 6.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                androidx.compose.foundation.text.selection.SelectionContainer {
                    Text(item.optString("text"), Modifier.padding(top = 20.dp), fontSize = 16.sp, lineHeight = 24.sp)
                }
                if (item.rows("context").isNotEmpty()) Text(w("上下文"), Modifier.padding(top = 24.dp), fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                item.rows("context").forEach { entry ->
                    Row(Modifier.padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (entry.optString("from").isNotBlank()) Text(entry.getString("from"), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                        entry.optLong("at").takeIf { it > 0 }?.let { Text(relativeTime(it), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                    Text(entry.optString("text"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (item.optBoolean("completing")) LinearProgressIndicator(Modifier.fillMaxWidth())
                item.nullableString("completeError")?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            }
        } }
        record?.let { item ->
            Surface(Modifier.padding(horizontal = 24.dp, vertical = 12.dp).fillMaxWidth(),
                shape = androidx.compose.foundation.shape.RoundedCornerShape(50),
                color = MaterialTheme.colorScheme.surface,
                border = androidx.compose.foundation.BorderStroke(.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Row(Modifier.fillMaxWidth().height(48.dp), horizontalArrangement = Arrangement.SpaceEvenly,
                    verticalAlignment = Alignment.CenterVertically) {
                    val done = item.optString("status") == "done"
                    val linked = item.optJSONObject("issue")
                    if (!done && linked == null) {
                        IconButton(onClick = { sharing = "issue" }, enabled = !actions.busy) {
                            Glyph(R.drawable.ic_list_plus, w("分享到事项"), 22)
                        }
                        IconButton(onClick = { sharing = "session" }, enabled = !actions.busy) {
                            Glyph(R.drawable.ic_message_square_plus, w("分享到会话"), 22)
                        }
                        IconButton(onClick = { create() }, enabled = !actions.busy, modifier = Modifier.testTag("record-create")) {
                            Glyph(R.drawable.ic_plus, stringResource(R.string.new_issue), 22)
                        }
                    } else if (linked != null) {
                        IconButton(onClick = { model.navigate(Route("issue", linked.optString("title"), linked.getLong("id").toString())) },
                            enabled = !actions.busy) { Glyph(R.drawable.ic_arrow_up_right, w("打开事项"), 22) }
                    }
                    IconButton(onClick = { complete() }, enabled = !actions.busy && !item.optBoolean("completing")) {
                        if (item.optBoolean("completing")) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 1.5.dp)
                        else Glyph(R.drawable.ic_refresh_cw, w("补全上下文"), 22)
                    }
                    if (!done || linked == null) {
                        val restore = item.optString("status") != "todo"
                        IconButton(onClick = { mark(if (restore) "restore" else "done") }, enabled = !actions.busy) {
                            Glyph(if (restore) R.drawable.ic_rotate_ccw else R.drawable.ic_check,
                                if (restore) w("恢复") else w("已处理"), 22)
                        }
                    }
                }
            }
        }
    }
    sharing?.let { target -> IssuePicker(model, target == "session", { sharing = null }, busy = actions.busy, error = actions.error) { issue ->
        actions.run {
            model.request("inbox.share", json("ids" to JSONArray(listOf(id)), "issue" to issue.getLong("id"), "to" to target))
            sharing = null; back()
        }
    } }
    if (deleting) Confirm(w("将要删除"), record?.optString("title"), actions, { deleting = false }, { mark("delete") })
}

@Composable
fun IssuePicker(model: DuduViewModel, withSession: Boolean, dismiss: () -> Unit,
    busy: Boolean = false, error: String? = null, selected: (JSONObject) -> Unit) {
    val actions = rememberActions()
    var items by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var query by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { actions.run { items = model.request("issue.pick", json("withSession" to withSession)).rows("items") } }
    DuduSheet(dismiss, canDismiss = !busy) {
        SheetHeader(w("事项"), dismiss, enabled = !busy)
        Box(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) { SearchField(query, w("搜索事项")) { query = it } }
        if (actions.busy || busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        (error ?: actions.error)?.let { Text(problemText(it), Modifier.padding(20.dp), color = MaterialTheme.colorScheme.error) }
        LazyColumn(Modifier.heightIn(max = 500.dp).navigationBarsPadding()) {
            items(items.filter { it.optString("title").contains(query, true) || it.optString("ref").contains(query, true) }) { issue ->
                Line(issue.optString("title"), issue.nullableString("ref"), enabled = !busy && !actions.busy, action = { selected(issue) })
            }
        }
    }
}
