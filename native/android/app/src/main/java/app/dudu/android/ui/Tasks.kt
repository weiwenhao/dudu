@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.dudu.android.ui

import androidx.compose.foundation.layout.*
import kotlinx.coroutines.launch
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.border
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.time.LocalDate
import java.util.Date
import java.util.TimeZone
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

@Composable
fun taskStatus(value: String): String = when (value) {
    "active" -> w("已开启"); "paused" -> w("已暂停"); "ended" -> w("已结束")
    "delivering" -> w("正在投递"); "delivered" -> w("已投递"); "failed" -> w("投递失败")
    else -> w("待确认")
}

@Composable
fun scheduleKind(kind: String) = when (kind) {
    "daily" -> w("每天"); "workdays" -> w("周一至周五"); "weekly" -> w("每周")
    "monthly" -> w("每月"); "interval" -> w("间隔"); "once" -> w("仅一次"); else -> "Cron"
}

@Composable
fun scheduleLine(schedule: JSONObject): String = when (schedule.optString("kind")) {
    "cron" -> schedule.optString("expression")
    "interval" -> w("{0} {1}分").replace("{0}", scheduleKind("interval")).replace("{1}", schedule.optString("minutes"))
    else -> listOf(scheduleKind(schedule.optString("kind")), schedule.optString("date"),
        if (schedule.optString("kind") == "monthly") schedule.optString("day") else "",
        if (schedule.optString("kind") == "weekly") schedule.optJSONArray("weekdays")?.let { days ->
            // 周一和周三: the iPhone's names of the days, joined as `Intl.ListFormat` joins them for the desktop.
            val names = (0 until days.length()).map { days.getInt(it) }
            android.icu.text.ListFormatter.getInstance(appLocale()).format(names.map { weekdayName(it) })
        }.orEmpty() else "", schedule.optString("time")).filter(String::isNotBlank).joinToString(" ")
}

/**
 * The scheduled tasks: a sheet of the Dudu chat (`onHeight` reports how high the sheet has to be), the list of a conversation (`sessionId`), or a page of its own. The sheet's bar is the frame (the
 * centred 任务 with its count and the ✕: no "+"), the way to make a task is 新建任务 across the sheet under the list, and its rows are the roomy ones (owner, 2026-11-18, the inbox redesign; the drawings are
 * `.local/designs/inbox-forward-android-2026-11-18/`). The page of its own keeps its chrome. The reading and the actions are the iPhone's `TasksModel`: the first reading shows a spinner and a failed one
 * 任务没能加载 with 重试, a task with a request on its way shows a spinner and waits, 立即执行 says 正在投递, a delete 已删除任务, a failure 更改没能保存 (pausing and resuming say nothing: the switch shows it).
 * `memory` is the quick sheet's (its tab and its list), `leave` goes from the sheet to a conversation so that the sheet comes back with 嘟嘟's chat.
 */
@Composable
fun TasksScreen(model: DuduViewModel, back: () -> Unit = model::backRoute,
    onHeight: ((Int) -> Unit)? = null, sessionId: String? = null,
    open: (Route) -> Unit = { model.navigate(it) }, refreshKey: Int = 0, active: Boolean = true,
    memory: QuickSheetMemory? = null, leave: ((() -> Unit) -> Unit)? = null) {
    val state by model.state.collectAsState()
    val scope = rememberCoroutineScope()
    val quick = onHeight != null
    var tasks by remember(state.computerId) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var load by remember(state.computerId) { mutableStateOf(ListLoad.Loading) }
    var reading by remember { mutableStateOf(false) }
    var pulling by remember { mutableStateOf(false) }
    // The tasks with a request on their way: their rows show it and wait.
    var busy by remember(state.computerId) { mutableStateOf<Set<String>>(emptySet()) }
    var filter by rememberSaveable { mutableStateOf(memory?.tab ?: "") }
    var finishedOpen by remember { mutableStateOf<Boolean?>(null) }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    var revealed by remember { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<Route?>(null) }
    var pendingToggle by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    val density = LocalDensity.current
    var tabsHeight by remember { mutableIntStateOf(64) }
    val list = memory?.list ?: rememberLazyListState()
    fun openTask(route: Route) { if (sessionId != null) detail = route else open(route) }
    /** Read the list again, keeping what is shown meanwhile; a task this phone has a newer revision of stays as it is. */
    suspend fun refresh() {
        if (reading) return
        reading = true
        if (tasks.isEmpty() && load != ListLoad.Loaded) load = ListLoad.Loading
        try {
            val fresh = model.request("tasks.list").rows("tasks")
            val current = tasks.associateBy { it.optString("id") }
            tasks = fresh.map { task -> current[task.optString("id")]?.takeIf { it.optInt("revision") > task.optInt("revision") } ?: task }
            load = ListLoad.Loaded
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            DuduLog.failure("tasks.list.fail", error)
            if (tasks.isEmpty()) load = ListLoad.Failed
        } finally { reading = false }
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Read when the list is shown and when the computer connects; the next runs move on by themselves, so again while it stays (every 30 s, a conversation's list every 5 s).
    LaunchedEffect(sessionId, refreshKey, lifecycle, active, detail, state.connected) {
        if (!active || detail != null || !state.connected) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                refresh()
                delay(if (sessionId == null) 30000 else 5000)
            }
        }
    }
    LaunchedEffect(filter) { revealed = null; memory?.tab = filter }
    val mine = tasks.filter { task -> sessionId == null || taskBelongsToSession(task, sessionId) }
    val current = mine.filter { it.optString("status") == "active" } + mine.filter { it.optString("status") == "paused" }
    val finished = mine.filter { it.optString("status") == "ended" }
    val finishedIsOpen = finishedOpen ?: current.isEmpty()
    val visible = if (sessionId == null) mine.filter { filter.isEmpty() || it.optString("status") == filter }
        else current + if (finishedIsOpen) finished else emptyList()
    memory?.RestoreScroll(visible.isNotEmpty())
    val resize = LocalSheetHeight.current
    LaunchedEffect(visible.size, finished.size, current.size, detail) {
        if (sessionId != null) resize(if (detail != null) 600 else (84 + current.size * 58 + if (finished.isEmpty()) 0 else
            (if (current.isEmpty()) 52 else 66) + if (finishedIsOpen) 10 + finished.size * 58 else 0).coerceIn(260, 600))
    }
    if (onHeight != null) {
        // The sheet is as high as its content: the bar, the tabs, the rows (64 dp, a hairline between them), and 新建任务 under them.
        val rows = if (visible.isEmpty()) 82 else visible.size * 64 + (visible.size - 1) / 2
        LaunchedEffect(rows, tabsHeight) { onHeight(54 + tabsHeight + rows + 16 + 52 + 12) }
    }
    /** Pause, resume, run now or delete one task (`tasks.<action>` with its revision), the iPhone's `TasksModel.act`. */
    fun act(name: String, task: JSONObject, toggle: Boolean? = null) {
        val id = task.getString("id")
        if (id in busy) return
        busy = busy + id
        if (toggle != null) pendingToggle = id to toggle
        revealed = null
        scope.launch {
            try {
                val result = model.request("tasks.$name", json("id" to id, "revision" to task.getInt("revision")))
                result.optJSONObject("task")?.let { updated -> tasks = tasks.map { if (it.optString("id") == id) updated else it } }
                when (name) {
                    "run" -> model.toast(word("正在投递"), ToastKind.Success)
                    "delete" -> { tasks = tasks.filter { it.optString("id") != id }; model.toast(word("已删除任务"), ToastKind.Success) }
                }
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("tasks.$name.fail", error)
                if (name == "delete" && (error as? ApiFailure)?.code == "not_found") tasks = tasks.filter { it.optString("id") != id }
                model.toast(word("更改没能保存"), ToastKind.Error)
            } finally {
                busy = busy - id
                if (pendingToggle?.first == id) pendingToggle = null
            }
            refresh()
        }
    }
    fun LazyListScope.taskRows(rows: List<JSONObject>) {
        items(rows, key = { it.getString("id") }) { task ->
            var menu by remember { mutableStateOf(false) }
            val id = task.getString("id")
            val status = task.optString("status")
            val working = id in busy
            val swipe = if (working) emptyList() else buildList {
                if (status == "active") {
                    add(RowSwipeAction(w("暂停任务"), DuduGlyphs.pause, androidx.compose.ui.graphics.Color(0xFF96989D)) { act("pause", task) })
                    add(RowSwipeAction(w("立即执行"), DuduGlyphs.zap, DuduStyle.blue) { act("run", task) })
                } else if (status == "paused") add(RowSwipeAction(w("恢复任务"), DuduGlyphs.play, DuduStyle.blue) { act("resume", task) })
                add(RowSwipeAction(w("删除任务"), DuduGlyphs.trash, SwipeColors.delete) { revealed = null; deleting = task })
            }
            LibraryRowGroup(task === rows.first(), task === rows.last(), grouped = sessionId != null || quick,
                inset = if (quick) 16 else 20, dividerStart = if (quick) 56 else 16, dividerEnd = if (quick) 14 else 0) {
                SwipeMenuRow(swipe, enabled = !working, revealed = revealed == id,
                    onReveal = { revealed = if (it) id else null }) { closeSwipe ->
                    val press = remember { PressPoint() }
                    Box(Modifier.notePress(press)) {
                        Surface(color = if (sessionId != null || quick) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.background) {
                            Box(Modifier.fillMaxWidth().testTag("task-$id").combinedClickable(onClick = {
                                if (revealed != null) { revealed = null; closeSwipe() }
                                else openTask(Route("task", task.getString("title"), id))
                            }, onLongClick = { menu = true })) {
                                TaskSummary(task, sessionId != null, busy = working,
                                    horizontalPadding = if (quick) 14 else if (sessionId != null) 16 else 10, roomy = quick,
                                    onToggle = if (status in listOf("active", "paused")) { next ->
                                        act(if (next) "resume" else "pause", task, next)
                                    } else null, toggleEnabled = state.connected && !working,
                                    pendingToggle = pendingToggle?.takeIf { it.first == id }?.second)
                            }
                        }
                        DropdownMenu(menu, { menu = false }, offset = press.menuOffset()) {
                            if (status in listOf("active", "paused")) DropdownMenuItem(
                                text = { Text(if (status == "active") w("暂停任务") else w("恢复任务")) },
                                leadingIcon = { Glyph(if (status == "active") DuduGlyphs.pause else DuduGlyphs.play, size = 18) },
                                enabled = !working, onClick = { menu = false; act(if (status == "active") "pause" else "resume", task) })
                            DropdownMenuItem(text = { Text(w("立即执行")) }, leadingIcon = { Glyph(DuduGlyphs.zap, size = 18) },
                                enabled = !working, onClick = { menu = false; act("run", task) })
                            DropdownMenuItem(text = { Text(w("编辑")) }, leadingIcon = { Glyph(DuduGlyphs.editLine, size = 18) },
                                onClick = { menu = false; openTask(Route("task", task.getString("title"), id, json("edit" to true))) })
                            DropdownMenuItem(text = { Text(w("删除任务"), color = MaterialTheme.colorScheme.error) },
                                leadingIcon = { Glyph(DuduGlyphs.trash, size = 18, tint = MaterialTheme.colorScheme.error) },
                                enabled = !working, onClick = { menu = false; deleting = task })
                        }
                    }
                }
            }
        }
    }
    Box(Modifier.fillMaxSize()) {
    Box(Modifier.fillMaxSize().alpha(if (detail == null) 1f else 0f).then(
        if (detail == null) Modifier else Modifier.clearAndSetSemantics {})) {
    Page(if (quick) w("任务") else w("定时任务"), back,
        count = visible.size.takeIf { quick && load == ListLoad.Loaded }, top = {
            if (sessionId == null && !quick) IconButton(onClick = { openTask(Route("task", target = "new")) }, modifier = Modifier.testTag("new-task")) {
                Glyph(DuduGlyphs.plus, w("新建任务"))
            }
        }) {
        if (sessionId == null) Box(Modifier.onSizeChanged { tabsHeight = (it.height / density.density).roundToInt() }) {
            GlassTabs(filter, listOf("" to w("全部"), "active" to taskStatus("active"),
                "paused" to taskStatus("paused"), "ended" to taskStatus("ended")), top = if (quick) 0 else 10,
                bottom = if (quick) 20 else 6) { filter = it }
        }
        // The page of its own reads again when it is pulled down (the iPhone's `refreshable`); the sheets do not.
        PullRefresh(!quick && sessionId == null, pulling, { scope.launch { pulling = true; refresh(); pulling = false } },
            if (quick) Modifier.weight(1f).fillMaxWidth() else Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), state = list, contentPadding = PaddingValues(bottom = if (quick) 0.dp else 24.dp)) {
            if (visible.isEmpty()) item {
                Box(Modifier.fillParentMaxWidth().then(if (quick) Modifier.heightIn(min = 82.dp)
                    else if (sessionId != null) Modifier.heightIn(min = 160.dp) else Modifier.fillParentMaxHeight()),
                    contentAlignment = Alignment.Center) {
                    when {
                        load == ListLoad.Loading -> ListLoading()
                        load == ListLoad.Failed -> ListFailure(w("任务没能加载")) { scope.launch { refresh() } }
                        // A conversation with no task: the clock over the words, as the iPhone's.
                        sessionId != null -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
                            Glyph(DuduGlyphs.schedule, size = 26, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(w("暂无定时任务"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        else -> Text(w("没有任务"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            taskRows(if (sessionId == null) visible else current)
            if (sessionId != null && finished.isNotEmpty()) item {
                InsetCard(Modifier.padding(start = 18.dp, end = 18.dp, top = if (current.isEmpty()) 0.dp else 14.dp)) {
                    Line(w("已结束"), leading = { Glyph(DuduGlyphs.check, size = 18, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                        minHeight = 52, action = { finishedOpen = !finishedIsOpen }, trailing = {
                            Text(finished.size.toString(), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Glyph(if (finishedIsOpen) DuduGlyphs.down else DuduGlyphs.right, size = 16)
                        })
                }
            }
            if (sessionId != null && finishedIsOpen && finished.isNotEmpty()) {
                item { Spacer(Modifier.height(10.dp)) }
                taskRows(finished)
            }
        }
        }
        if (quick) Button(onClick = { openTask(Route("task", target = "new")) },
            modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 12.dp).height(52.dp).testTag("new-task"),
            shape = RoundedCornerShape(26.dp), colors = ButtonDefaults.buttonColors(
                containerColor = MaterialTheme.colorScheme.onSurface.copy(alpha = .08f), contentColor = MaterialTheme.colorScheme.onSurface)) {
            Glyph(DuduGlyphs.plus, size = 20)
            Spacer(Modifier.width(8.dp))
            Text(w("新建任务"), fontSize = 16.sp, fontWeight = FontWeight.Medium)
        }
    }
    }
    detail?.let { route -> key(route) {
        TaskScreen(route, state, model, back = { detail = null; scope.launch { refresh() } }, close = back, leave = leave)
    } }
    }
    deleting?.let { task -> DuduConfirmation(w("删除任务"), task.optString("title"), enabled = true,
        dismiss = { deleting = null }, confirm = { deleting = null; act("delete", task) }) }
}

@Composable
fun TaskScreen(route: Route, state: UiState, model: DuduViewModel,
    back: () -> Unit = model::backRoute, close: (() -> Unit)? = null, leave: ((() -> Unit) -> Unit)? = null) {
    val actions = rememberActions()
    val scope = rememberCoroutineScope()
    val isNew = route.target == "new"
    var task by remember { mutableStateOf<JSONObject?>(null) }
    var options by remember { mutableStateOf(json()) }
    var editing by remember { mutableStateOf(isNew || route.params.optBoolean("edit")) }
    var title by rememberSaveable { mutableStateOf("") }
    var prompt by rememberSaveable { mutableStateOf("") }
    var agent by rememberSaveable { mutableStateOf("dudu") }
    var selectedModel by rememberSaveable { mutableStateOf("") }
    var projectId by rememberSaveable { mutableStateOf("") }
    // A new task starts as 嘟嘟's does (the iPhone's `TaskDraft(options: nil)`), until what the computer offers is read.
    var mode by rememberSaveable { mutableStateOf(if (isNew) "new" else "reuse") }
    var sessionId by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("daily") }
    var time by rememberSaveable { mutableStateOf("09:00") }
    var zone by rememberSaveable { mutableStateOf(TimeZone.getDefault().id) }
    var date by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    var interval by rememberSaveable { mutableStateOf("60") }
    var day by rememberSaveable { mutableStateOf("1") }
    var cron by rememberSaveable { mutableStateOf("0 9 * * *") }
    var weekdays by remember { mutableStateOf(setOf(1)) }
    var runs by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var cursor by remember { mutableStateOf<Long?>(null) }
    var historyFailed by remember { mutableStateOf(false) }
    var loadingMore by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var seeded by remember { mutableStateOf(false) }
    var editRevision by remember { mutableIntStateOf(0) }
    var choosingTime by remember { mutableStateOf(false) }
    var choosingDate by remember { mutableStateOf(false) }
    var picker by remember { mutableStateOf<TaskPicker?>(null) }
    var original by remember { mutableStateOf<List<String>?>(null) }
    var confirmingDiscard by remember { mutableStateOf(false) }
    // The bar's action on its way (pause, resume, run, delete): its item shows a spinner and the others wait.
    var activeAction by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }
    // The computer's choices (`tasks.options`) are being read: the editor itself is the app's and is already there (owner, 2026-11-24).
    var loadingOptions by remember { mutableStateOf(false) }
    var sessionsFailed by remember { mutableStateOf(false) }
    // A save that did not go: 更改没能保存 in the editor, and the plugin's code under it when it gave one (the iPhone's editor).
    var saveFailure by remember { mutableStateOf<String?>(null) }
    val titleFocus = remember { FocusRequester() }
    val focus = LocalFocusManager.current
    var initialFocus by remember { mutableStateOf(isNew) }
    LaunchedEffect(editing, picker) {
        if (editing && picker == null && initialFocus) { titleFocus.requestFocus(); initialFocus = false }
    }
    fun draftValues() = listOf(title, prompt, agent, selectedModel, projectId, mode, sessionId,
        kind, time, zone, date, interval, day, cron, weekdays.sorted().joinToString(","))
    /** The conversations a task can go into are read when they are wanted (a task that goes into one; 关联会话 opened), never for an ordinary editor (the iPhone's `loadSessions`). */
    suspend fun loadSessions() {
        if (options.has("sessions")) return
        sessionsFailed = false
        try {
            val fresh = model.request("tasks.options", json("includeSessions" to true))
            options = JSONObject(options.toString()).put("sessions", fresh.optJSONArray("sessions") ?: JSONArray())
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            DuduLog.failure("tasks.options.fail", error)
            sessionsFailed = true
        }
    }
    fun choose(p: TaskPicker) {
        focus.clearFocus(); picker = p
        if (p == TaskPicker.Session) scope.launch { loadSessions() }
    }
    fun seed(t: JSONObject) {
        editRevision = t.getInt("revision")
        title = t.optString("title"); prompt = t.optString("prompt"); agent = t.optString("agent")
        selectedModel = t.nullableString("model").orEmpty(); projectId = t.optJSONObject("project")?.optString("path").orEmpty()
        val target = t.getJSONObject("target"); mode = target.getString("mode"); sessionId = target.optString("sessionId")
        val schedule = t.getJSONObject("schedule"); kind = schedule.getString("kind")
        zone = schedule.optString("timezone", zone); time = schedule.optString("time", "09:00")
        date = schedule.optString("date", date); interval = schedule.optString("minutes", "60")
        day = schedule.optString("day", "1"); cron = schedule.optString("expression", "0 9 * * *")
        weekdays = schedule.optJSONArray("weekdays")?.let { array -> (0 until array.length()).map(array::getInt).toSet() } ?: setOf(1)
        original = draftValues()
    }
    LaunchedEffect(actions.revision) { actions.run {
        loadingOptions = true
        try { options = model.request("tasks.options", json("includeSessions" to false)) } finally { loadingOptions = false }
        if (!seeded && isNew) {
            // What the computer offers replaces the start the editor had; what was typed and the rule as it was set stay, and a time zone nobody chose (this phone's) becomes the computer's.
            if (zone == TimeZone.getDefault().id) zone = options.optString("timezone", zone)
            agent = options.rows("providers").firstOrNull { it.optBoolean("available") }?.optString("id") ?: "deepseek"
            mode = if (agent == "dudu") "new" else "reuse"
            projectId = if (agent == "dudu") "" else options.rows("projects").firstOrNull()?.optString("path").orEmpty()
            original = listOf("", "", agent, selectedModel, projectId, mode, sessionId, "daily", "09:00", zone, LocalDate.now().toString(), "60", "1", "0 9 * * *", "1")
            seeded = true
        }
        if (!isNew) {
            val result = model.request("tasks.get", json("id" to route.target)).getJSONObject("task")
            task = result
            if (!seeded) { seed(result); seeded = true }
            if (result.optJSONObject("target")?.optString("mode") == "existing") loadSessions()
            try {
                val history = model.request("tasks.history", json("id" to route.target))
                runs = history.rows("runs"); cursor = if (history.isNull("nextCursor")) null else history.getLong("nextCursor")
                historyFailed = false
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("tasks.history.fail", error)
                if (runs.isEmpty()) historyFailed = true
            }
        }
    } }
    /** Pause, resume, run now or delete the task, the iPhone's `TaskSheet.act`: 正在投递 for a run, 已删除任务 for a delete (and back to the list), 更改没能保存 for a failure. */
    fun action(name: String) {
        val current = task ?: return
        if (activeAction != null) return
        activeAction = name
        scope.launch {
            try {
                model.request("tasks.$name", json("id" to current.getString("id"), "revision" to current.getInt("revision")))
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("tasks.$name.fail", error)
                model.toast(word("更改没能保存"), ToastKind.Error)
                activeAction = null
                actions.refresh()
                return@launch
            }
            when (name) {
                "run" -> model.toast(word("正在投递"), ToastKind.Success)
                "delete" -> model.toast(word("已删除任务"), ToastKind.Success)
            }
            activeAction = null
            if (name == "delete") back() else actions.refresh()
        }
    }
    val dirty = original?.let { it != draftValues() } ?: (title.isNotBlank() || prompt.isNotBlank())
    PreventSheetDismiss(actions.busy || saving || activeAction != null || editing && dirty)
    val valid = state.connected && options.rows("providers").any { it.optString("id") == agent && it.optBoolean("available") } &&
        title.isNotBlank() && prompt.isNotBlank() && (agent == "dudu" || projectId.isNotBlank()) &&
        (mode != "existing" || sessionId.isNotBlank()) && zone in TimeZone.getAvailableIDs() && when (kind) {
            "cron" -> cron.isNotBlank()
            "interval" -> (interval.toDoubleOrNull() ?: 0.0) >= 1
            else -> time.matches(Regex("([01]\\d|2[0-3]):[0-5]\\d")) &&
                (kind != "weekly" || weekdays.isNotEmpty()) &&
                (kind != "monthly" || day.toIntOrNull() in 1..31) &&
                (kind != "once" || runCatching { LocalDate.parse(date) }.isSuccess)
        }
    fun save() {
        if (!valid || !isNew && !dirty || saving || actions.busy) return
        if (!isNew && task == null) return
        val schedule = json("kind" to kind, "timezone" to zone).apply {
            when (kind) {
                "cron" -> put("expression", cron)
                "interval" -> put("minutes", interval.toDouble())
                else -> {
                    put("time", time)
                    if (kind == "once") put("date", date)
                    if (kind == "weekly") put("weekdays", JSONArray(weekdays.sorted()))
                    if (kind == "monthly") put("day", day.toInt())
                }
            }
        }
        val fields = json("title" to title, "prompt" to prompt, "agent" to agent,
            "model" to selectedModel.ifBlank { null },
            "project" to if (agent == "dudu") null else options.rows("projects").find { it.optString("path") == projectId },
            "target" to json("mode" to mode).apply { if (mode == "existing") put("sessionId", sessionId) }, "schedule" to schedule)
        saving = true; saveFailure = null
        scope.launch {
            try {
                if (isNew) model.request("tasks.create", json("fields" to fields))
                else model.request("tasks.update", json("id" to route.target, "revision" to editRevision, "patch" to fields))
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure(if (isNew) "tasks.create.fail" else "tasks.update.fail", error)
                saving = false
                saveFailure = (error as? ApiFailure)?.code.orEmpty()
                // Another end changed the task first: what is there now is read again.
                if ((error as? ApiFailure)?.code == "conflict") actions.refresh()
                return@launch
            }
            saving = false
            confirmingDiscard = false
            model.toast(if (isNew) word("已创建任务") else word("已更新任务"), ToastKind.Success)
            if (isNew) back() else { original = draftValues(); editing = false; actions.refresh() }
        }
    }
    fun discard() { if (isNew || !editing) back() else { task?.let(::seed); editing = false; saveFailure = null } }
    val cancel: () -> Unit = { if (!actions.busy && !saving) { if (editing && dirty) confirmingDiscard = true else discard() } }
    val page = picker
    if (page != null && editing) {
        val projects = options.rows("projects")
        if (page == TaskPicker.Session) {
            TaskSessionPage(options.rows("sessions"), projects, sessionId,
                if (!options.has("sessions")) (if (sessionsFailed) w("任务没能加载") else "") else w("没有可用的会话"), back = { picker = null }) { session ->
                sessionId = session.getString("id")
                projects.find { it.nullableString("workspaceId") == session.nullableString("workspaceId") }
                    ?.let { projectId = it.getString("path") }
                session.nullableString("agent")?.takeIf(String::isNotBlank)?.let { agent = it }
                selectedModel = session.nullableString("model").orEmpty()
                picker = null
            }
            return
        }
        val providers = options.rows("providers")
        val knownModels = providers.find { it.optString("id") == agent }?.optJSONArray("models")?.strings().orEmpty()
        val choices = when (page) {
            TaskPicker.Provider -> providers.map { TaskChoice(it.getString("id"), it.getString("name"),
                agent = it.getString("id"), enabled = it.optBoolean("available")) }
            TaskPicker.Model -> listOf(TaskChoice("", w("默认模型"))) +
                (listOf(selectedModel).filter { it.isNotBlank() && it !in knownModels } + knownModels).map { TaskChoice(it, it) }
            TaskPicker.Workspace -> projects.map { TaskChoice(it.getString("path"), it.getString("name"), it.getString("path"), icon = DuduGlyphs.workspace) }
            // 嘟嘟 makes a conversation of its own for a run and has none that is named: two, the one it starts from first (the iPhone's `TaskTarget.choices`).
            TaskPicker.Target -> (if (agent == "dudu") listOf("new", "reuse") else listOf("reuse", "new", "existing"))
                .map { TaskChoice(it, taskTargetName(it)) }
            TaskPicker.Session -> error("关联会话 renders TaskSessionPage, above")
            TaskPicker.Timezone -> (listOf(zone, options.optString("timezone")) + TimeZone.getAvailableIDs())
                .filter(String::isNotBlank).distinct().sorted().map { TaskChoice(it, taskTimezone(it)) }
        }
        TaskChoicePage(page, choices, when (page) {
            TaskPicker.Provider -> agent; TaskPicker.Model -> selectedModel; TaskPicker.Workspace -> projectId
            TaskPicker.Target -> mode; TaskPicker.Session -> sessionId; TaskPicker.Timezone -> zone
        }, emptyText = when (page) {
            TaskPicker.Workspace -> w("没有可用的工作区")
            else -> null
        }, back = { picker = null }) { value ->
            when (page) {
                TaskPicker.Provider -> if (value != agent) {
                    // The iPhone's `TaskDraft.choose(agent:)`: the model belongs to the agent and is cleared; only a change between 嘟嘟 and an agent starts the new one's own way (嘟嘟: no
                    // workspace, a new conversation each run; an agent: the first workspace, one conversation reused), so a named conversation stays when one agent replaces another.
                    val wasDudu = agent == "dudu"
                    agent = value; selectedModel = ""
                    if (wasDudu != (value == "dudu")) {
                        sessionId = ""
                        if (value == "dudu") { mode = "new"; projectId = "" }
                        else { mode = "reuse"; projectId = projects.firstOrNull()?.optString("path").orEmpty() }
                    }
                }
                TaskPicker.Model -> selectedModel = value
                TaskPicker.Workspace -> { if (projectId != value) sessionId = ""; projectId = value }
                TaskPicker.Target -> { if (mode != value) sessionId = ""; mode = value }
                TaskPicker.Session -> error("关联会话 renders TaskSessionPage, above")
                TaskPicker.Timezone -> zone = value
            }
            picker = null
        }
        return
    }
    // The header of the task in full is only the frame (owner, 2026-11-18, the inbox redesign): ‹ when it is pushed over the list, the centred 任务, ✕; no pencil and no status chip. What can be done
    // is the labelled bar at the bottom, and the status is the first row of the rule.
    Page(if (editing) { if (isNew) w("新建任务") else w("编辑") } else w("任务"), cancel, actions,
        cancels = editing, nested = close != null && !editing,
        background = if (editing) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.surfaceContainer,
        close = close?.takeUnless { editing }?.let { action -> { if (!actions.busy && activeAction == null) action() } }, top = {
        if (editing) TextButton(onClick = { save() }, enabled = valid && !actions.busy && !saving && (isNew || dirty), modifier = Modifier.testTag("save-task")) {
            if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text(stringResource(R.string.save))
        }
    }) {
        if (editing) Form {
            DraftInput(title, w("自动化任务名称"), (seeded || isNew) && !saving, tag = "task-title", modifier = Modifier.focusRequester(titleFocus)) { title = it }
            DraftInput(prompt, w("自动化任务内容"), (seeded || isNew) && !saving, multi = true, tag = "task-prompt") { prompt = it }
            val providers = options.rows("providers")
            val ready = !actions.busy && !saving && state.connected
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            IssueChip(providers.find { it.optString("id") == agent }?.optString("name") ?: w("嘟嘟"),
                ready, "task-provider", icon = { AgentLogo(agent, 16) }) { choose(TaskPicker.Provider) }
            IssueChip(selectedModel.ifBlank { w("默认模型") }, ready, "task-model",
                icon = { Glyph(DuduGlyphs.model, size = 16) }) { choose(TaskPicker.Model) }
            if (agent != "dudu") IssueChip(options.rows("projects").find { it.optString("path") == projectId }?.optString("name")
                ?: w("关联工作区"), ready, icon = { Glyph(DuduGlyphs.workspace, size = 16) }) { choose(TaskPicker.Workspace) }
            IssueChip(taskTargetName(mode), ready,
                icon = { Glyph(DuduGlyphs.message, size = 16) }) { choose(TaskPicker.Target) }
            if (mode == "existing") {
                val sessions = options.rows("sessions")
                IssueChip(sessions.find { it.optString("id") == sessionId }?.optString("title") ?: w("关联会话"),
                    ready, icon = { Glyph(DuduGlyphs.queue, size = 16) }) { choose(TaskPicker.Session) }
            }
            }
            Text(w("运行时间"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            // The rule in one card, the iPhone's order: the kind, the time (not for an interval or an expression), the date, the day of the month, the days of the week, the minutes, the expression,
            // and the time zone.
            InsetCard {
            // The rule is the app's own values: it can be set while the computer's choices are still being read (a new task).
            val free = !saving && (!actions.busy || isNew && loadingOptions)
            Choice(w("规则"), scheduleKind(kind), listOf("daily", "workdays", "weekly", "monthly", "interval", "once", "cron")
                .map { it to scheduleKind(it) }, free, prominentLabel = true) { kind = it }
            if (kind !in listOf("interval", "cron")) { TaskRuleDivider(); TaskRuleButton(w("运行时间"), time, "task-time", free) { choosingTime = true } }
            if (kind == "once") { TaskRuleDivider(); TaskRuleButton(w("仅一次"), date, "task-date", free) { choosingDate = true } }
            if (kind == "monthly") {
                TaskRuleDivider()
                Choice(w("每月"), day, (1..31).map { "$it" to "$it" }, free, tag = "task-day", prominentLabel = true) { day = it }
            }
            if (kind == "weekly") { TaskRuleDivider(); TaskWeekdays(weekdays, free) { weekdays = it } }
            if (kind == "interval") { TaskRuleDivider(); TaskMinutes(interval, free) { interval = it } }
            if (kind == "cron") { TaskRuleDivider(); TaskRuleInput("Cron", cron, free) { cron = it } }
            TaskRuleDivider()
            Line(w("时区"), enabled = free && state.connected, action = { choose(TaskPicker.Timezone) }, trailing = {
                Text(taskTimezone(zone), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Glyph(DuduGlyphs.right, size = 16, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            })
            }
            saveFailure?.let { code ->
                Column(Modifier.testTag("task-save-error"), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(w("更改没能保存"), fontSize = 13.sp, color = Color(0xFFEC1313))
                    if (code.isNotEmpty()) Text(code, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        } else {
        TaskDetail(task, runs, historyFailed, cursor != null, loadingMore, options, Modifier.weight(1f), loadMore = {
            val before = cursor ?: return@TaskDetail
            if (loadingMore) return@TaskDetail
            loadingMore = true
            scope.launch {
                try {
                    val next = model.request("tasks.history", json("id" to route.target, "before" to before))
                    runs = (runs + next.rows("runs")).distinctBy { it.getString("id") }
                    cursor = if (next.isNull("nextCursor")) null else next.getLong("nextCursor")
                } catch (error: Exception) {
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    DuduLog.failure("tasks.history.fail", error)
                    historyFailed = true
                } finally { loadingMore = false }
            }
        }) { id, title ->
            // From the quick sheet: leave it, so that it comes back with 嘟嘟's chat. Elsewhere the sheet over the conversation goes first, and the conversation that is open already stays (the
            // iPhone's `SessionTasksSheet.openSession`).
            if (leave != null) leave { model.openSession(id, title) }
            else { close?.invoke(); if (id != state.session?.id) model.openSession(id, title) }
        }
        // What can be done with the task, with the words under the icons: pause or resume it (not one that is over), run it now, edit it, delete it (red, asks first). One at a time: the one on
        // its way shows a spinner and the others wait.
        val phase = task?.optString("status")
        val waiting = task == null || actions.busy || activeAction != null
        fun item(slot: String, item: BarItem) = if (!waiting) item else
            BarItem(item.title, item.icon, item.tag, item.danger, enabled = false, busy = activeAction == slot, action = item.action)
        ActionBar(buildList {
            if (phase == "active") add(item("pause", BarItem(w("暂停任务"), DuduGlyphs.pause, "task-toggle") { action("pause") }))
            else if (phase == "paused") add(item("resume", BarItem(w("恢复任务"), DuduGlyphs.play, "task-toggle") { action("resume") }))
            add(item("run", BarItem(w("立即执行"), DuduGlyphs.zap, "task-run") { action("run") }))
            add(item("edit", BarItem(w("编辑"), DuduGlyphs.editLine, "edit-task") { task?.let(::seed); editing = true }))
            add(item("delete", BarItem(w("删除任务"), DuduGlyphs.trash, "task-delete", danger = true) { deleting = true }))
        })
        }
    }
    if (confirmingDiscard) AlertDialog(onDismissRequest = { if (!saving) confirmingDiscard = false },
        title = { Text(w("有未保存的修改")) },
        confirmButton = { TextButton(onClick = { save() }, enabled = valid && !saving) { Text(w("保存修改")) } },
        dismissButton = {
            Row {
                TextButton(onClick = { confirmingDiscard = false }, enabled = !saving) { Text(w("取消")) }
                TextButton(onClick = { confirmingDiscard = false; discard() }, enabled = !saving) {
                    Text(w("放弃"), color = MaterialTheme.colorScheme.error)
                }
            }
        })
    if (deleting) DuduConfirmation(w("删除任务"), task?.optString("title"), enabled = true,
        dismiss = { deleting = false }, confirm = { deleting = false; action("delete") })
    if (choosingDate) DueDateDialog(runCatching { LocalDate.parse(date).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli() }.getOrNull(),
        { choosingDate = false }) { value ->
        value?.let { date = java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneId.systemDefault()).toLocalDate().toString() }
        choosingDate = false
    }
    if (choosingTime) {
        val clock = rememberTimePickerState(initialHour = time.substringBefore(":").toIntOrNull() ?: 9,
            initialMinute = time.substringAfter(":").toIntOrNull() ?: 0, is24Hour = true)
        AlertDialog(onDismissRequest = { choosingTime = false }, title = { Text(w("运行时间")) },
            text = { TimePicker(clock) },
            confirmButton = { TextButton(onClick = { time = "%02d:%02d".format(java.util.Locale.ROOT, clock.hour, clock.minute); choosingTime = false }) { Text(stringResource(R.string.save)) } },
            dismissButton = { TextButton(onClick = { choosingTime = false }) { Text(stringResource(R.string.cancel)) } })
    }
}

/**
 * The task in full, the iPhone's `TaskSheet.sections`: the agent's 26 dp logo and the title (20 sp), then blocks of a small title over a white card, 22 dp apart: 规则 (the status first, the rule, the time
 * zone as `Asia/Shanghai · UTC+8`, the next run as `11月10日 18:00` in the task's zone, where a run goes, the workspace, the provider, the model), 自动化任务内容 (the text as it is), 任务运行记录 (each
 * delivery: its mark, when, its state at the right, and a chevron only when its conversation is known, which it then opens) and 关联会话 (the conversation the runs go to, when it is known).
 * `openSession` opens a conversation by its id and title.
 */
@Composable
private fun TaskDetail(task: JSONObject?, runs: List<JSONObject>, historyFailed: Boolean, hasMore: Boolean, loadingMore: Boolean,
    options: JSONObject, modifier: Modifier, loadMore: () -> Unit, openSession: (String, String) -> Unit) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val sessions = options.rows("sessions")
    LazyColumn(modifier.fillMaxWidth().testTag("task-detail-list"), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(22.dp)) {
        if (task == null) return@LazyColumn
        val schedule = task.optJSONObject("schedule") ?: json()
        val zone = schedule.nullableString("timezone")
        val active = task.optString("status") == "active"
        item("title") {
            Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                task.nullableString("agent")?.let { AgentLogo(it, 26) }
                Text(task.optString("title"), Modifier.weight(1f), fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        item("rules") {
            val next = if (!active || task.isNull("nextRunAt")) "—" else taskStamp(task.getLong("nextRunAt"), zone)
            val values = listOf(w("状态") to taskStatus(task.optString("status")), w("运行时间") to scheduleLine(schedule),
                w("时区") to (zone?.let(::taskTimezone) ?: "—"), w("下次运行") to next,
                w("执行位置") to taskTargetName(task.optJSONObject("target")?.optString("mode").orEmpty())) +
                listOfNotNull(task.optJSONObject("project")?.let { w("关联工作区") to it.optString("name") }) +
                listOf(w("供应商") to (options.rows("providers").find { it.optString("id") == task.optString("agent") }?.optString("name") ?: task.optString("agent")),
                    w("模型") to (task.nullableString("model") ?: w("默认模型")))
            TaskSection(w("规则")) {
                values.forEachIndexed { index, (name, value) ->
                    if (index > 0) TaskRuleDivider()
                    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(name, fontSize = 15.sp, lineHeight = 21.sp); Spacer(Modifier.width(12.dp))
                        Text(value, Modifier.weight(1f), fontSize = 15.sp, lineHeight = 21.sp, textAlign = androidx.compose.ui.text.style.TextAlign.End,
                            color = if (index == 0 && active) Color(0xFF177A3C) else muted)
                    }
                }
            }
        }
        item("prompt") {
            TaskSection(w("自动化任务内容")) {
                androidx.compose.foundation.text.selection.SelectionContainer {
                    Text(task.optString("prompt"), Modifier.fillMaxWidth().padding(16.dp), fontSize = 15.sp, lineHeight = 22.sp)
                }
            }
        }
        if (runs.isNotEmpty() || historyFailed) item("runs") {
            TaskSection(w("任务运行记录")) {
                runs.forEachIndexed { index, run ->
                    if (index > 0) HorizontalDivider(Modifier.padding(start = 52.dp), thickness = .5.dp, color = MaterialTheme.colorScheme.outlineVariant)
                    val session = run.nullableString("sessionId")?.let { id -> sessions.find { it.optString("id") == id } }
                    TaskRunRow(run, zone, session != null) { session?.let { openSession(it.getString("id"), it.optString("title")) } }
                }
                if (historyFailed) Text(w("任务没能加载"), Modifier.fillMaxWidth().padding(16.dp), fontSize = 14.sp, color = muted,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                if (hasMore) {
                    HorizontalDivider(thickness = .5.dp, color = MaterialTheme.colorScheme.outlineVariant)
                    Box(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(enabled = !loadingMore, onClick = loadMore), contentAlignment = Alignment.Center) {
                        if (loadingMore) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = muted)
                        else Text(w("加载更多"), fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
        // The conversation the runs go to: the one it names, or the one it made and reuses; only one this phone knows.
        val linkedId = task.optJSONObject("target")?.let { target -> if (target.optString("mode") == "existing") target.nullableString("sessionId") else null }
            ?: task.nullableString("sessionId")
        val linked = linkedId?.let { id -> sessions.find { it.optString("id") == id } }
        if (linked != null) item("session") {
            TaskSection(w("关联会话")) {
                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).clickable { openSession(linked.getString("id"), linked.optString("title")) }
                    .padding(horizontal = 16.dp).testTag("task-session"), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(linked.optString("title"), Modifier.weight(1f), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Glyph(DuduGlyphs.right, size = 16, tint = muted)
                }
            }
        }
    }
}

/** A block of the task in full: its small title (13 sp medium, 16 dp in) over a white card with 22 dp corners, 8 dp apart. */
@Composable
private fun TaskSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, Modifier.padding(start = 16.dp), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = chatSecondary())
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(MaterialTheme.colorScheme.surface), content = content)
    }
}

/** One delivery: its mark (delivered green, failed red, the others muted) in 24 dp, when it was (15 sp, the task's zone), its state at the right (14 sp, muted), and › when it opens its conversation. */
@Composable
private fun TaskRunRow(run: JSONObject, zone: String?, opens: Boolean, open: () -> Unit) {
    val status = run.optString("status")
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).then(if (opens) Modifier.clickable(onClick = open) else Modifier)
        .padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.width(24.dp), contentAlignment = Alignment.Center) {
            Glyph(when (status) {
                "delivered" -> MenuGlyphs.runDelivered
                "failed" -> MenuGlyphs.runFailed
                "delivering" -> MenuGlyphs.runDelivering
                else -> MenuGlyphs.runUnknown
            }, size = 18, tint = when (status) {
                "delivered" -> Color(0xFF177A3C)
                "failed" -> Color(0xFFEC1313)
                else -> muted
            })
        }
        Text(taskStamp(run.optLong("at"), zone), Modifier.weight(1f), fontSize = 15.sp, maxLines = 1)
        Text(taskStatus(status), fontSize = 14.sp, color = muted, maxLines = 1)
        if (opens) Glyph(DuduGlyphs.right, size = 16, tint = muted)
    }
}

/** `11月10日 18:00`, the iPhone's `TaskSchedule.stamp`: the month, day, hour and minute in the app's language, in the task's own time zone. */
@Composable
internal fun taskStamp(at: Long, zone: String?): String {
    val locale = appLocale()
    val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMdHHmm")
    return java.text.SimpleDateFormat(pattern, locale).apply {
        timeZone = zone?.takeIf { it in TimeZone.getAvailableIDs() }?.let(TimeZone::getTimeZone) ?: TimeZone.getDefault()
    }.format(Date(at))
}

/** 周日 … 周六 by the plugin's numbers (Sunday is 0), the iPhone's words. */
@Composable
internal fun weekdayName(day: Int): String = listOf(w("周日"), w("周一"), w("周二"), w("周三"), w("周四"), w("周五"), w("周六"))[((day % 7) + 7) % 7]

/** 每周 and the seven days from Monday, the iPhone's: equal buttons 36 dp high, 6 dp apart, 10 dp corners; a chosen day on the light grey in ink (13 sp medium), the others with a hairline, muted. */
@Composable
private fun TaskWeekdays(chosen: Set<Int>, enabled: Boolean, changed: (Set<Int>) -> Unit) {
    val selected = if (androidx.compose.foundation.isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHighest else DuduStyle.selected
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(w("每周"), fontSize = 15.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(1, 2, 3, 4, 5, 6, 0).forEach { day ->
                val on = day in chosen
                val shape = RoundedCornerShape(10.dp)
                Box(Modifier.weight(1f).height(36.dp).clip(shape).background(if (on) selected else Color.Transparent, shape)
                    .border(if (on) 0.dp else 1.dp, if (on) Color.Transparent else MaterialTheme.colorScheme.outlineVariant, shape)
                    .selectable(on, enabled = enabled, role = Role.Checkbox) { changed(if (on) chosen - day else chosen + day) }
                    .testTag("task-weekday-$day"), contentAlignment = Alignment.Center) {
                    Text(weekdayName(day), fontSize = 13.sp, fontWeight = if (on) FontWeight.Medium else FontWeight.Normal,
                        color = if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
        }
    }
}

/** 间隔: the minutes typed at the right (80 dp, digits) and 分 after them, muted, 15 sp (the iPhone's `minutesRow`). */
@Composable
private fun TaskMinutes(value: String, enabled: Boolean, changed: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(w("间隔"), Modifier.weight(1f), fontSize = 15.sp)
        BasicTextField(value, { typed -> changed(typed.filter(Char::isDigit)) }, Modifier.width(80.dp).testTag("task-minutes"),
            enabled = enabled, singleLine = true,
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
            textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface,
                textAlign = androidx.compose.ui.text.style.TextAlign.End),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(DuduStyle.blue))
        Spacer(Modifier.width(6.dp))
        Text(w("分"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * 关联会话 (owner, 2026-11-22): the generic choice list this used to share with 时区/供应商 drew every conversation the same
 * as a plain setting, and hid every conversation outside today's 关联工作区 with no explanation. This reuses 转发's own row
 * (`ForwardRow`: a tile in the title's colour, the title, the agent's logo) and lists every conversation, searchable;
 * picking one sets the task's 关联工作区/供应商/模型 to match it, as the desktop's picker already does.
 */
@Composable
private fun TaskSessionPage(sessions: List<JSONObject>, projects: List<JSONObject>, selected: String,
    emptyText: String?, back: () -> Unit, choose: (JSONObject) -> Unit) {
    var query by remember { mutableStateOf("") }
    val sorted = sessions.sortedByDescending { it.optLong("updatedAt") }
    val words = query.trim()
    val shown = sorted.filter { it.getString("title").contains(words, true) }
    Page(w("关联会话"), back, nested = true, background = MaterialTheme.colorScheme.background) {
        Box(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) { SearchField(query, w("关联会话")) { query = it } }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 12.dp, bottom = 24.dp)) {
            itemsIndexed(shown, key = { _, session -> session.getString("id") }) { index, session ->
                val projectName = projects.find { it.nullableString("workspaceId") == session.nullableString("workspaceId") }
                    ?.optString("name")?.takeIf(String::isNotBlank)
                GroupRow(index == 0, index == shown.lastIndex, inset = 16, dividerStart = 74, dividerEnd = 14) {
                    TaskSessionRow(session, projectName, session.getString("id") == selected) { choose(session) }
                }
            }
            if (shown.isEmpty() && emptyText != null) item {
                Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                    Text(emptyText, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

/** A conversation as 转发's row draws it (`ForwardRow`): its tile, title, the agent's logo; here also when it was last touched, and a checkmark on the one chosen. */
@Composable
private fun TaskSessionRow(session: JSONObject, projectName: String?, selected: Boolean, choose: () -> Unit) {
    val updatedAt = session.optLong("updatedAt").takeIf { it > 0 }
    val subtitle = listOfNotNull(projectName, updatedAt?.let { relativeTime(it) }).takeIf { it.isNotEmpty() }?.joinToString(" · ")
    Row(Modifier.fillMaxWidth().height(66.dp).testTag("task-session-option-${session.getString("id")}")
        .clickable(onClick = choose).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        TitleTile(session.getString("title"), 48)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(session.getString("title"), fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            subtitle?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        Spacer(Modifier.width(12.dp))
        AgentLogo(session.nullableString("agent"), 16)
        if (selected) { Spacer(Modifier.width(8.dp)); Glyph(DuduGlyphs.check, size = 18) }
    }
}

@Composable
private fun taskTargetName(mode: String): String = when (mode) {
    "new" -> w("每次新建对话"); "existing" -> w("已有会话"); else -> w("新建对话并复用")
}

@Composable
private fun TaskRuleDivider() = HorizontalDivider(Modifier.padding(start = 16.dp), thickness = .5.dp,
    color = MaterialTheme.colorScheme.outlineVariant)

@Composable
private fun TaskRuleInput(label: String, value: String, enabled: Boolean, changed: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontSize = 15.sp)
        BasicTextField(value, changed, enabled = enabled, singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface,
                textAlign = androidx.compose.ui.text.style.TextAlign.End),
            modifier = Modifier.widthIn(min = 72.dp, max = 210.dp), decorationBox = { inner ->
                Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surfaceContainer) {
                    Box(Modifier.padding(horizontal = 12.dp, vertical = 7.dp)) { inner() }
                }
            })
    }
}

@Composable
private fun TaskRuleButton(label: String, value: String, tag: String, enabled: Boolean, action: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontSize = 15.sp)
        TextButton(onClick = action, enabled = enabled, modifier = Modifier.testTag(tag), shape = RoundedCornerShape(50),
            colors = ButtonDefaults.textButtonColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
            Text(value, fontSize = 16.sp)
        }
    }
}

private fun taskTimezone(id: String): String {
    val minutes = TimeZone.getTimeZone(id).getOffset(System.currentTimeMillis()) / 60000
    return "$id · UTC${if (minutes < 0) "-" else "+"}${kotlin.math.abs(minutes) / 60}" +
        if (minutes % 60 == 0) "" else ":%02d".format(java.util.Locale.ROOT, kotlin.math.abs(minutes) % 60)
}
