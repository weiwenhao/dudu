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
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import androidx.compose.foundation.lazy.rememberLazyListState
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
            IconButton(onClick = { menu = true }) { Glyph(DuduGlyphs.options, stringResource(R.string.more)) }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text(w("全部对话（显示已归档）")) }, onClick = { archive = !archive; model.preference("sessions.archive", archive); menu = false },
                    trailingIcon = { if (archive) Glyph(DuduGlyphs.check, size = 18) })
                DropdownMenuItem(text = { Text(w("工作区")) }, onClick = { grouped = !grouped; model.preference("sessions.grouped", grouped); menu = false },
                    trailingIcon = { if (grouped) Glyph(DuduGlyphs.check, size = 18) })
                DropdownMenuItem(text = { Text(w("刷新")) }, onClick = { actions.refresh(); menu = false })
            }
        }
        IconButton(onClick = { model.navigate(Route("session-new")) }, enabled = !actions.busy) { Glyph(DuduGlyphs.plus, w("新建会话")) }
    }) {
        Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
            SearchField(query, w("搜索会话"), tag = "session-search") { query = it }
        }
        LazyColumn(Modifier.fillMaxSize()) {
            groups.forEach { (id, entries) ->
                val group = workspaces.find { it.optString("id") == id }
                if (grouped && group != null) item {
                    Line(group.getString("name"), detail = "${entries.size}", icon = DuduGlyphs.folder,
                        action = { folded[id] = folded[id] != true },
                        trailing = {
                            var expanded by remember { mutableStateOf(false) }
                            Box {
                                IconButton(onClick = { expanded = true }) { Glyph(DuduGlyphs.options, size = 20) }
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
                                IconButton(onClick = { expanded = true }) { Glyph(DuduGlyphs.options, size = 20) }
                                DropdownMenu(expanded, { expanded = false }) {
                                    DropdownMenuItem(text = { Text(w("重命名")) }, leadingIcon = { Glyph(DuduGlyphs.editLine, size = 18) }, onClick = {
                                        editing = row; editWorkspace = false; title = row.optString("title"); expanded = false
                                    })
                                    DropdownMenuItem(text = { Text(stringResource(if (row.optBoolean("pinned")) R.string.unpin else R.string.pin)) },
                                        leadingIcon = { Glyph(R.drawable.dudu_pin, size = 18) },
                                        onClick = { expanded = false; act("session.pin", json("id" to sid, "pinned" to !row.optBoolean("pinned"))) })
                                    DropdownMenuItem(text = { Text(if (row.optBoolean("archived")) w("恢复") else w("归档")) },
                                        leadingIcon = { Glyph(if (row.optBoolean("archived")) DuduGlyphs.archiveRestore else DuduGlyphs.archive, size = 18) },
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
 * shares: it goes to a conversation, one at a time (`ForwardPicker`). The reading and the marks are the iPhone's `CollectorModel`: each tab keeps what it read while it reads again, the first reading
 * shows a spinner and a failed one 信息没能加载 with 重试, the next page comes by itself at the end of the list, a mark that went says 已删除 / 已恢复 and one that did not 更改没能保存. `memory` is the quick
 * sheet's (its tab and its list), `leave` goes from the sheet to a conversation so that the sheet comes back with 嘟嘟's chat.
 */
@Composable
fun CollectorScreen(model: DuduViewModel, back: () -> Unit = model::backRoute,
    onHeight: ((Int) -> Unit)? = null, open: (Route) -> Unit = { model.navigate(it) }, refreshKey: Int = 0, active: Boolean = true,
    memory: QuickSheetMemory? = null, leave: ((() -> Unit) -> Unit)? = null) {
    val sheet = onHeight != null
    val scope = rememberCoroutineScope()
    // Only the computer and whether it is reached matter here, not every change of the app's state.
    val link by produceState("" to false, model) {
        model.state.map { it.computerId to it.connected }.distinctUntilChanged().collect { value = it }
    }
    val (computer, connected) = link
    var tab by rememberSaveable { mutableStateOf(memory?.tab ?: "todo") }
    val itemsByTab = remember(computer) { mutableStateMapOf<String, List<JSONObject>>() }
    val totals = remember(computer) { mutableStateMapOf<String, Int>() }
    val cursors = remember(computer) { mutableStateMapOf<String, String?>() }
    val loads = remember(computer) { mutableStateMapOf<String, ListLoad>() }
    val refreshing = remember(computer) { mutableSetOf<String>() }
    var loadingMore by remember(computer) { mutableStateOf(false) }
    // The records with a mark or a forward on their way: their swipe waits, and they cannot be marked again meanwhile.
    var changing by remember(computer) { mutableStateOf<Set<Long>>(emptySet()) }
    val completing by model.inboxCompletions.completing.collectAsState()
    var selecting by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<Set<Long>>(emptySet()) }
    var forwarding by remember { mutableStateOf<List<JSONObject>?>(null) }
    // A delete asks first, for one record and for the chosen ones (owner, 2026-11-21).
    var deleting by remember { mutableStateOf<List<JSONObject>?>(null) }
    var revealed by remember { mutableStateOf<Long?>(null) }
    var rowMenu by remember { mutableStateOf<JSONObject?>(null) }
    val density = LocalDensity.current
    val rowHeights = remember { mutableStateMapOf<Long, Int>() }
    var tabsHeight by remember { mutableIntStateOf(64) }
    val items = itemsByTab[tab].orEmpty()
    val load = loads[tab] ?: ListLoad.Loading
    val next = cursors[tab]
    val list = memory?.list ?: rememberLazyListState()
    /** A handled record that went to an issue is the issue's: nothing to choose it for. */
    fun canChoose(record: JSONObject) = tab != "done" || record.optJSONObject("issue") == null
    /** Read the first page of a tab again, keeping what is shown meanwhile. */
    suspend fun refresh(target: String = tab) {
        if (target in refreshing) return
        refreshing += target
        if (itemsByTab[target] == null) loads[target] = ListLoad.Loading
        try {
            val result = model.inboxList(json("tab" to target))
            val fresh = result.rows("items")
            itemsByTab[target] = fresh
            totals[target] = result.optInt("total", fresh.size)
            cursors[target] = result.nullableString("nextCursor")
            loads[target] = ListLoad.Loaded
            if (target == tab) selected = selected.filter { id -> fresh.any { it.getLong("id") == id } }.toSet()
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            DuduLog.failure("inbox.load.fail", error)
            if (itemsByTab[target] == null) loads[target] = ListLoad.Failed
        } finally { refreshing -= target }
    }
    suspend fun loadMore() {
        val wanted = tab
        val cursor = cursors[wanted] ?: return
        if (loadingMore) return
        loadingMore = true
        try {
            val result = model.inboxList(json("tab" to wanted, "cursor" to cursor))
            val known = itemsByTab[wanted].orEmpty().map { it.getLong("id") }.toSet()
            itemsByTab[wanted] = itemsByTab[wanted].orEmpty() + result.rows("items").filter { it.getLong("id") !in known }
            cursors[wanted] = result.nullableString("nextCursor")
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            DuduLog.failure("inbox.more.fail", error)
        } finally { loadingMore = false }
    }
    LaunchedEffect(tab) { selecting = false; selected = emptySet(); revealed = null; memory?.tab = tab }
    // Read when the tab is shown and when the computer connects (a read before that would leave the list empty until it was pulled).
    LaunchedEffect(tab, refreshKey, active, computer, connected) { if (active && connected) refresh() }
    // 待处理 as the app reads it every 5 s (`HomeRoots`, the read that keeps the badge): a new record shows by itself, as on the iPhone, so the list has no pull to refresh
    // (owner, 2026-11-23: a swipe on a row also pulled the list down; 「如果会自动更新，你把下拉刷新去掉就好了」).
    val latestTodo by model.inboxTodo.collectAsState()
    var adoptedTodo by remember(computer) { mutableStateOf("") }
    LaunchedEffect(latestTodo, computer) {
        val (from, result) = latestTodo ?: return@LaunchedEffect
        val rows = result.optJSONArray("items")?.toString().orEmpty()
        if (from != computer || "todo" in refreshing || rows == adoptedTodo) return@LaunchedEffect
        adoptedTodo = rows
        val fresh = result.rows("items")
        itemsByTab["todo"] = fresh
        totals["todo"] = result.optInt("total", fresh.size)
        cursors["todo"] = result.nullableString("nextCursor")
        loads["todo"] = ListLoad.Loaded
        if (tab == "todo") selected = selected.filter { id -> fresh.any { it.getLong("id") == id } }.toSet()
    }
    // An issue made of a record: it has left the to-do tab.
    val inboxChanges by model.inboxChanges.collectAsState()
    LaunchedEffect(inboxChanges) { if (inboxChanges.first > 0 && active) refresh() }
    memory?.RestoreScroll(items.isNotEmpty())
    if (onHeight != null) {
        // The sheet is as high as its content (the bar, the tabs, the rows as drawn, the spinner of the next page, the labelled bar while choosing), up to what the sheet allows.
        val height = 54 + tabsHeight + items.sumOf { rowHeights[it.getLong("id")] ?: 76 } + (if (items.isEmpty()) 82 else 0) +
            (if (next != null && items.isNotEmpty()) 44 else 0) + 24 + (if (selecting) 78 else 0)
        LaunchedEffect(height) { onHeight(height) }
    }
    fun stopChoosing() { selecting = false; selected = emptySet() }
    /** A mark on one or several records (`inbox.mark`): they leave the list at once, and the list is read again; no undo (a restore is the way back, owner, 2026-11-12). */
    fun mark(action: String, records: List<JSONObject>) {
        val ids = records.map { it.getLong("id") }.toSet()
        if (ids.isEmpty() || ids.any { it in changing }) return
        changing = changing + ids
        val from = tab
        revealed = null
        scope.launch {
            try {
                model.request("inbox.mark", json("action" to action, "ids" to JSONArray(ids.toList())))
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("inbox.mark.fail", error, state = action)
                model.toast(word("更改没能保存"), ToastKind.Error)
                changing = changing - ids
                return@launch
            }
            itemsByTab[from] = itemsByTab[from].orEmpty().filter { it.getLong("id") !in ids }
            stopChoosing()
            when (action) {
                "delete" -> model.toast(word("已删除"), ToastKind.Success)
                "restore" -> model.toast(word("已恢复"), ToastKind.Success)
            }
            refresh(from)
            model.refreshInboxCount()
            changing = changing - ids
        }
    }
    /** A new issue that starts with the record's title and text (the record in full has them). */
    fun makeIssue(record: JSONObject) {
        val id = record.getLong("id")
        scope.launch {
            val result = try { model.request("inbox.get", json("id" to id)) } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("inbox.get.fail", error)
                null
            }
            val draft = result?.optJSONObject("draft")
            model.editDraft(IssueDraft(title = draft?.optString("title") ?: record.optString("title"),
                description = draft?.optString("brief") ?: result?.optJSONObject("record")?.optString("text").orEmpty(), record = id))
            model.show(Panel.Create)
        }
    }
    /** 打开事项: the issue's conversation, as the iPhone's `openIssueConversation(id:)`; an issue that has none opens nothing. */
    fun openIssue(issue: JSONObject) {
        val id = issue.getLong("id")
        scope.launch {
            val session = model.issueSession(id) ?: return@launch
            (leave ?: { go -> go() }) { model.openSession(session, issue.optString("title"), id) }
        }
    }
    val choosableCount = items.count(::canChoose)
    Page(if (selecting) w("已选 {0} 条").replace("{0}", selected.size.toString()) else w("收件箱"),
        { if (selecting) stopChoosing() else back() }, cancels = selecting,
        count = totals[tab].takeIf { sheet && !selecting && load == ListLoad.Loaded }, top = {
        if (selecting) TextButton(onClick = { selected = items.filter(::canChoose).map { it.getLong("id") }.toSet() },
            enabled = selected.size < choosableCount) { Text(w("全选")) }
        else {
            // No filter by connector: the iPhone's inbox has none (owner, 2026-11-22: 「顶部有一个奇怪的筛选菜单」); 选择 stands before the ✕.
            if (sheet && load == ListLoad.Loaded && choosableCount > 0) TextButton(onClick = { selecting = true },
                modifier = Modifier.testTag("collector-select")) { Text(w("选择")) }
        }
    }) {
        Box(Modifier.onSizeChanged { tabsHeight = (it.height / density.density).roundToInt() }) {
            GlassTabs(tab, listOf("todo" to w("待处理"), "done" to w("已处理")), top = if (sheet) 0 else 10,
                bottom = if (sheet) 20 else 6) { tab = it }
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
        LazyColumn(Modifier.fillMaxSize().testTag("collector-list"), state = list, contentPadding = PaddingValues(bottom = 24.dp)) {
            if (items.isEmpty()) item {
                val homeFailure = !sheet && load == ListLoad.Failed
                Box(Modifier.fillParentMaxWidth().then(when {
                    sheet -> Modifier.heightIn(min = 82.dp)
                    homeFailure -> Modifier.padding(top = 68.dp)
                    else -> Modifier.fillParentMaxHeight()
                }), contentAlignment = Alignment.Center) {
                    when (load) {
                        ListLoad.Loading -> ListLoading()
                        ListLoad.Failed -> ListFailure(w("信息没能加载")) { scope.launch { refresh() } }
                        ListLoad.Loaded -> Text(w("没有信息"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            itemsIndexed(items, key = { _, record -> record.getLong("id") }) { index, record ->
                val id = record.getLong("id")
                val choosable = canChoose(record)
                // The board list's swipe (owner, 2026-11-19: "右滑已处理，左滑点击转发，参考看板列表"; 删除 was in the swipe and stays): on the to-do list the right is 已处理, the left 转发
                // and 删除; on 已处理 the left is 恢复 and 删除 and the right nothing. Not while rows are being chosen, and not on a record an issue holds.
                val swipes = !selecting && choosable
                val handle = if (swipes && tab == "todo") RevealAction(w("已处理"), R.drawable.home_swipe_complete, SwipeColors.complete) { mark("done", listOf(record)) } else null
                val swipe = if (!swipes) emptyList() else buildList {
                    if (tab != "todo") add(RevealAction(w("恢复"), DuduGlyphs.restore, SwipeColors.blue) { mark("restore", listOf(record)) })
                    else if (record.optJSONObject("issue") == null) add(RevealAction(w("转发"), DuduGlyphs.forward, SwipeColors.blue) { forwarding = listOf(record) })
                    add(RevealAction(w("删除"), DuduGlyphs.trash, SwipeColors.delete) { revealed = null; deleting = listOf(record) })
                }
                Box(Modifier.onSizeChanged { rowHeights[id] = (it.height / density.density).roundToInt() }) {
                LibraryRowGroup(index == 0, index == items.lastIndex, grouped = sheet, inset = 16,
                    dividerStart = if (selecting) 104 else 70, dividerEnd = 14) {
                SwipeRevealRow(handle, swipe, enabled = !selecting && id !in changing, revealed = revealed == id,
                    onReveal = { revealed = if (it) id else null }) { closeSwipe ->
                val press = remember { PressPoint() }
                Box(Modifier.notePress(press)) {
                Surface(color = if (sheet) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.background) {
                Box(Modifier.fillMaxWidth().testTag("record-$id").combinedClickable(
                    onClick = {
                        if (revealed != null) { revealed = null; closeSwipe() }
                        else if (selecting) { if (choosable) selected = if (id in selected) selected - id else selected + id }
                        else open(Route("record", record.optString("title"), id.toString(), json("record" to record, "tab" to tab)))
                    }, onLongClick = { if (!selecting) rowMenu = record })) {
                    CollectorSummary(record, tab, selecting, id in selected, horizontalPadding = if (sheet) 14 else 10,
                        completing = id in completing || record.optBoolean("completing") || sheet && id in changing)
                }
                }
                DropdownMenu(rowMenu?.optLong("id") == id, { rowMenu = null }, offset = press.menuOffset()) {
                    if (choosable) DropdownMenuItem(text = { Text(w("选择")) },
                        leadingIcon = { InboxGlyph(DuduGlyphs.selectRows, 18) },
                        onClick = { selecting = true; selected = setOf(id); rowMenu = null })
                    val issue = record.optJSONObject("issue")
                    if (issue != null) DropdownMenuItem(text = { Text(w("打开事项")) },
                        leadingIcon = { InboxGlyph(DuduGlyphs.open, 18) }, onClick = { rowMenu = null; openIssue(issue) })
                    else if (tab != "done") {
                        DropdownMenuItem(text = { Text(w("转发")) },
                            leadingIcon = { InboxGlyph(DuduGlyphs.forward, 18) }, onClick = { rowMenu = null; forwarding = listOf(record) })
                        DropdownMenuItem(text = { Text(w("新建事项")) },
                            leadingIcon = { InboxGlyph(DuduGlyphs.plus, 18) }, onClick = { rowMenu = null; makeIssue(record) })
                    }
                    // Filling in the context: the row shows a spinner at once and it cannot be asked again until it is over; a failure is said by a toast (`InboxCompletions`).
                    DropdownMenuItem(text = { Text(w("补全上下文")) }, enabled = id !in completing,
                        leadingIcon = { InboxGlyph(DuduGlyphs.completeContext, 18) },
                        onClick = { rowMenu = null; model.inboxCompletions.complete(id) })
                    if (issue == null) {
                        if (tab == "todo") DropdownMenuItem(text = { Text(w("已处理")) },
                            leadingIcon = { InboxGlyph(DuduGlyphs.check, 18) }, onClick = { rowMenu = null; mark("done", listOf(record)) })
                        else DropdownMenuItem(text = { Text(w("恢复")) },
                            leadingIcon = { InboxGlyph(DuduGlyphs.restore, 18) }, onClick = { rowMenu = null; mark("restore", listOf(record)) })
                        DropdownMenuItem(text = { Text(w("删除"), color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { InboxGlyph(DuduGlyphs.trash, 18, MaterialTheme.colorScheme.error) },
                            onClick = { rowMenu = null; deleting = listOf(record) })
                    }
                }
                }
                }
                }
                }
            }
            // The next page comes by itself when the end of the list is reached (the iPhone's spinner row).
            if (next != null && items.isNotEmpty()) item(key = "more-$next") {
                LaunchedEffect(next) { loadMore() }
                ListLoading(Modifier.height(44.dp))
            }
        }
        }
        if (selecting) {
            // What can be done to all the chosen rows at once, with the words under the icons: forward them, mark them handled, delete them (red).
            val chosen = items.filter { it.getLong("id") in selected }
            val ready = chosen.isNotEmpty()
            ActionBar(listOf(
                BarItem(w("转发"), DuduGlyphs.forward, "bulk-forward", enabled = ready) { forwarding = chosen },
                BarItem(w("已处理"), DuduGlyphs.check, "bulk-done", enabled = ready) { mark("done", chosen) },
                BarItem(w("删除"), DuduGlyphs.trash, "bulk-delete", danger = true, enabled = ready) { deleting = chosen },
            ))
        }
    }
    deleting?.let { records ->
        DuduConfirmation(w("删除"), if (records.size == 1) records[0].optString("title") else w("已选 {0} 条").replace("{0}", records.size.toString()),
            enabled = true, dismiss = { deleting = null }, confirm = { deleting = null; mark("delete", records) })
    }
    forwarding?.let { records ->
        ForwardPicker(model, records, dismiss = { forwarding = null }, forwarded = {
            stopChoosing()
            scope.launch { refresh(); model.refreshInboxCount() }
        })
    }
}

/** Where the first reading of a list is: under way (a spinner), done, or failed (what did not load, with 重试), the iPhone's `LoadState`. */
enum class ListLoad { Loading, Loaded, Failed }

/**
 * One record in full, pushed over the list (‹ and ✕) or on its own (✕): the header is only the frame (owner, 2026-11-18, the inbox redesign: no ↗ and no ⋯), the words are one white card
 * (`RecordCard`), and what can be done is the labelled bar at the bottom: 转发 and 新建事项, the mark that is done with the record (已处理, or 恢复 on a handled one), and 更多, a menu of
 * filling in the context and deleting it (in red). A record an issue holds has 打开事项 and 补全上下文 and no 更多. As the iPhone's `CollectorRecordSheet`: the list's row is shown until the record
 * in full has come, one action at a time with a spinner in its place, a mark that went goes back to the list (a failure is the toast 更改没能保存), and a completion of the context is followed
 * until it is over (`InboxCompletions`), its failure said under the title.
 */
@Composable
fun RecordScreen(route: Route, model: DuduViewModel, back: () -> Unit = model::backRoute, close: (() -> Unit)? = null,
    leave: ((() -> Unit) -> Unit)? = null) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    val id = route.target!!.toLong()
    val listed = route.params.optJSONObject("record")
    var record by remember { mutableStateOf<JSONObject?>(null) }
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    var failed by remember { mutableStateOf(false) }
    var forwarding by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    // The bar's action on its way ("done", "restore", "more"): its item shows a spinner and the others wait.
    var activeAction by remember { mutableStateOf<String?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    val completing = id in model.inboxCompletions.completing.collectAsState().value
    val problem = model.inboxCompletions.problems.collectAsState().value[id]
    val inboxChanges by model.inboxChanges.collectAsState()
    val startChanges = remember { inboxChanges }
    PreventSheetDismiss(activeAction != null)
    DisposableEffect(id) {
        model.inboxCompletions.shown(id, true)
        onDispose { model.inboxCompletions.shown(id, false) }
    }
    LaunchedEffect(revision) {
        try {
            val result = model.request("inbox.get", json("id" to id))
            record = result.getJSONObject("record"); draft = result.optJSONObject("draft"); failed = false
            // One that was running when the record was opened is waited for as well.
            if (revision == 0 && record?.optBoolean("completing") == true) model.inboxCompletions.follow(id)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            DuduLog.failure("inbox.get.fail", error)
            if (record == null) failed = true
        }
    }
    // A completion has come to its end: the record is read again for the lines it added.
    var wasCompleting by remember { mutableStateOf(completing) }
    LaunchedEffect(completing) {
        if (wasCompleting && !completing) revision++
        wasCompleting = completing
    }
    LaunchedEffect(record?.optLong("revision"), lifecycle) {
        val shown = record ?: return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            try { model.acknowledgeInboxRecord(shown) }
            catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("inbox.read.fail", error)
            }
        }
    }
    // An issue was made of this record: it has left the list it was opened from.
    LaunchedEffect(inboxChanges) { if (inboxChanges != startChanges && inboxChanges.second == id) back() }
    fun mark(action: String, slot: String = action) {
        if (activeAction != null) return
        activeAction = slot
        scope.launch {
            try {
                model.request("inbox.mark", json("ids" to JSONArray(listOf(id)), "action" to action))
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("inbox.mark.fail", error, state = action)
                model.toast(word("更改没能保存"), ToastKind.Error)
                activeAction = null
                return@launch
            }
            when (action) {
                "delete" -> model.toast(word("已删除"), ToastKind.Success)
                "restore" -> model.toast(word("已恢复"), ToastKind.Success)
            }
            model.refreshInboxCount()
            activeAction = null
            back()
        }
    }
    fun complete() { if (!completing) model.inboxCompletions.complete(id) }
    fun create() {
        val item = record ?: listed ?: return
        model.editDraft(IssueDraft(title = draft?.optString("title") ?: item.optString("title"),
            description = draft?.optString("brief") ?: record?.optString("text").orEmpty(), record = id))
        model.show(Panel.Create)
    }
    Page(w("收件箱"), { if (activeAction == null) back() }, nested = close != null,
        close = close?.let { action -> { if (activeAction == null) action() } }) {
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())
            .padding(start = 16.dp, end = 16.dp, top = 4.dp, bottom = 16.dp)) {
            val shown = record ?: listed
            // Why the last completion failed (none while one runs): what this phone waited for, or what the computer kept of an earlier one when the record was opened.
            val failure = if (completing) null else problem?.ifEmpty { w("更改没能保存") }
                ?: record?.nullableString("completeError")?.takeIf { revision == 0 && it.isNotEmpty() }
            if (shown != null) RecordContent(shown, full = record != null, failed = failed, problem = failure)
            else if (failed) Column(Modifier.padding(horizontal = 4.dp)) {
                Text(route.title, fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold)
                Text(w("信息没能加载"), Modifier.padding(top = 20.dp), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        (record ?: listed)?.let { item ->
            // The tab of the list it was opened from, as the iPhone's; on its own, the record's own.
            val tab = route.params.nullableString("tab") ?: recordTab(item)
            val linked = item.optJSONObject("issue")
            fun BarItem.waiting(slot: String) = if (activeAction == null) this else
                BarItem(title, icon, tag, danger, enabled = false, busy = busy || activeAction == slot, menu = null, action = action)
            val fillIn = BarItem(w("补全上下文"), DuduGlyphs.completeContext, "record-complete", busy = completing) { complete() }
            // 更多: the spinner of a completion in the place of its icon (the menu stays open to the other actions).
            val more = BarItem(w("更多"), DuduGlyphs.options, "record-more", busy = completing || activeAction == "more", menu = { closeMenu ->
                DropdownMenuItem(text = { Text(w("补全上下文")) }, leadingIcon = { InboxGlyph(DuduGlyphs.completeContext, 20) },
                    enabled = !completing, onClick = { closeMenu(); complete() })
                if (linked == null) DropdownMenuItem(text = { Text(w("删除"), color = MaterialTheme.colorScheme.error) },
                    leadingIcon = { InboxGlyph(DuduGlyphs.trash, 20, MaterialTheme.colorScheme.error) },
                    enabled = activeAction == null, onClick = { closeMenu(); deleting = true })
            })
            ActionBar(if (tab == "done") {
                if (linked != null) listOf(
                    BarItem(w("打开事项"), DuduGlyphs.open, "record-open-issue") {
                        val issueId = linked.getLong("id")
                        scope.launch {
                            val session = model.issueSession(issueId) ?: return@launch
                            (leave ?: { go -> go() }) { model.openSession(session, linked.optString("title"), issueId) }
                        }
                    }.waiting("issue"), fillIn.waiting("complete"))
                else listOf(BarItem(w("恢复"), DuduGlyphs.restore, "record-restore") { mark("restore") }.waiting("restore"), more.waiting("more"))
            } else listOf(
                BarItem(w("转发"), DuduGlyphs.forward, "record-forward") { forwarding = true }.waiting("forward"),
                BarItem(w("新建事项"), DuduGlyphs.plus, "record-create") { create() }.waiting("new"),
                BarItem(w("已处理"), DuduGlyphs.check, "record-done") { mark("done") }.waiting("done"),
                more.waiting("more")))
        }
    }
    if (forwarding) (record ?: listed)?.let { item ->
        ForwardPicker(model, listOf(item), dismiss = { forwarding = false }, forwarded = { back() })
    }
    if (deleting) DuduConfirmation(w("删除"), (record ?: listed)?.optString("title"), enabled = true,
        dismiss = { deleting = false }, confirm = { deleting = false; mark("delete", "more") })
}

/** The record's title, who it is from and when, what became of it, why its completion failed, the card of its words, and the context that was read around it (the iPhone's `recordContent`). */
@Composable
private fun RecordContent(item: JSONObject, full: Boolean, failed: Boolean, problem: String?) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val issue = item.optJSONObject("issue")
    Column(Modifier.padding(horizontal = 4.dp)) {
        Text(item.optString("title"), fontSize = 19.sp, lineHeight = 25.sp, fontWeight = FontWeight.SemiBold)
        Text(listOfNotNull(item.nullableString("ref"), item.nullableString("from"), item.nullableString("connectorName"),
            item.optLong("at").takeIf { it > 0 }?.let { relativeTime(it) }).joinToString(" · "),
            Modifier.padding(top = 10.dp), fontSize = 13.sp, lineHeight = 18.sp, color = muted)
        issue?.let { Text((if (item.optString("verdict") == "issue") w("已新建 ") else w("已转发到 ")) + (it.nullableString("ref") ?: "#${it.optLong("id")}"),
            Modifier.padding(top = 6.dp), fontSize = 13.sp, lineHeight = 18.sp, color = chatSecondary()) }
        if (failed) Text(w("信息没能加载"), Modifier.padding(top = 20.dp), fontSize = 15.sp, color = muted)
        problem?.let { Text(it, Modifier.padding(top = 20.dp).testTag("record-complete-error"), fontSize = 13.sp, color = Color(0xFFEC1313)) }
    }
    if (full) RecordCard(item, Modifier.padding(top = 14.dp))
    val context = if (full) item.rows("context") else emptyList()
    if (context.isNotEmpty()) Text(w("上下文"), Modifier.padding(start = 4.dp, top = 24.dp), fontSize = 12.sp, color = muted)
    context.forEach { entry ->
        Row(Modifier.padding(start = 4.dp, top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            entry.nullableString("from")?.let { Text(it, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
            entry.optLong("at").takeIf { it > 0 }?.let { Text(relativeTime(it), fontSize = 12.sp, color = muted) }
        }
        Text(entry.optString("text"), Modifier.padding(start = 4.dp), fontSize = 13.sp, color = chatSecondary())
    }
}
