@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.dudu.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
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
            val weekdays = java.text.DateFormatSymbols.getInstance(appLocale()).shortWeekdays
            android.icu.text.ListFormatter.getInstance(appLocale()).format((0 until days.length()).map { weekdays[days.getInt(it) + 1] })
        }.orEmpty() else "", schedule.optString("time")).filter(String::isNotBlank).joinToString(" ")
}

@Composable
fun TasksScreen(model: DuduViewModel, back: () -> Unit = model::backRoute,
    onCount: ((Int) -> Unit)? = null, sessionId: String? = null,
    open: (Route) -> Unit = { model.navigate(it) }, refreshKey: Int = 0, active: Boolean = true) {
    val actions = rememberActions()
    var tasks by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var filter by rememberSaveable { mutableStateOf("") }
    var finishedOpen by remember { mutableStateOf<Boolean?>(null) }
    var deleting by remember { mutableStateOf<JSONObject?>(null) }
    var revealed by remember { mutableStateOf<String?>(null) }
    var detail by remember { mutableStateOf<Route?>(null) }
    fun openTask(route: Route) { if (sessionId != null) detail = route else open(route) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(actions.revision, sessionId, refreshKey, lifecycle, active, detail) {
        if (!active || detail != null) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                actions.run { tasks = model.request("tasks.list").rows("tasks") }
                delay(if (sessionId == null) 30000 else 5000)
            }
        }
    }
    LaunchedEffect(filter) { revealed = null }
    val mine = tasks.filter { task -> sessionId == null || taskBelongsToSession(task, sessionId) }
    val current = mine.filter { it.optString("status") == "active" } + mine.filter { it.optString("status") == "paused" }
    val finished = mine.filter { it.optString("status") == "ended" }
    val finishedIsOpen = finishedOpen ?: current.isEmpty()
    val visible = if (sessionId == null) mine.filter { filter.isEmpty() || it.optString("status") == filter }
        else current + if (finishedIsOpen) finished else emptyList()
    val resize = LocalSheetHeight.current
    LaunchedEffect(visible.size, finished.size, current.size, detail) {
        if (sessionId != null) resize(if (detail != null) 600 else (96 + current.size * 58 + if (finished.isEmpty()) 0 else
            (if (current.isEmpty()) 52 else 66) + if (finishedIsOpen) 10 + finished.size * 58 else 0).coerceIn(260, 600))
    }
    LaunchedEffect(visible.size) { onCount?.invoke(visible.size) }
    fun act(name: String, task: JSONObject) = actions.run {
        model.request("tasks.$name", json("id" to task.getString("id"), "revision" to task.getInt("revision")))
        revealed = null; actions.refresh()
    }
    fun LazyListScope.taskRows(rows: List<JSONObject>) {
        items(rows, key = { it.getString("id") }) { task ->
            var menu by remember { mutableStateOf(false) }
            val id = task.getString("id")
            val status = task.optString("status")
            val swipe = buildList {
                if (status == "active") {
                    add(RowSwipeAction(w("暂停任务"), R.drawable.ic_pause, androidx.compose.ui.graphics.Color(0xFF96989D)) { act("pause", task) })
                    add(RowSwipeAction(w("立即执行"), R.drawable.ic_zap, DuduStyle.blue) { act("run", task) })
                } else if (status == "paused") add(RowSwipeAction(w("恢复任务"), R.drawable.ic_play, DuduStyle.blue) { act("resume", task) })
                add(RowSwipeAction(w("删除任务"), R.drawable.ic_trash2, androidx.compose.ui.graphics.Color(0xFFE14848)) { deleting = task })
            }
            LibraryRowGroup(task === rows.first(), task === rows.last(), grouped = sessionId != null || onCount != null) {
                SwipeMenuRow(swipe, enabled = !actions.busy, revealed = revealed == id,
                    onReveal = { revealed = if (it) id else null }) { closeSwipe ->
                    Box {
                        Surface(color = if (sessionId != null || onCount != null) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.background) {
                            Box(Modifier.fillMaxWidth().testTag("task-$id").combinedClickable(onClick = {
                                if (revealed != null) { revealed = null; closeSwipe() }
                                else openTask(Route("task", task.getString("title"), id))
                            }, onLongClick = { menu = true })) {
                                TaskSummary(task, sessionId != null, horizontalPadding = if (sessionId != null || onCount != null) 16 else 10)
                            }
                        }
                        DropdownMenu(menu, { menu = false }) {
                            if (status in listOf("active", "paused")) DropdownMenuItem(
                                text = { Text(if (status == "active") w("暂停任务") else w("恢复任务")) },
                                leadingIcon = { Glyph(if (status == "active") R.drawable.ic_pause else R.drawable.ic_play, size = 18) },
                                enabled = !actions.busy, onClick = { menu = false; act(if (status == "active") "pause" else "resume", task) })
                            DropdownMenuItem(text = { Text(w("立即执行")) }, leadingIcon = { Glyph(R.drawable.ic_zap, size = 18) },
                                enabled = !actions.busy, onClick = { menu = false; act("run", task) })
                            DropdownMenuItem(text = { Text(w("复制任务")) }, leadingIcon = { Glyph(R.drawable.ic_copy, size = 18) },
                                enabled = !actions.busy, onClick = { menu = false; act("duplicate", task) })
                            DropdownMenuItem(text = { Text(w("编辑")) }, leadingIcon = { Glyph(R.drawable.ic_pencil_line, size = 18) },
                                enabled = !actions.busy, onClick = { menu = false; openTask(Route("task", task.getString("title"), id, json("edit" to true))) })
                            DropdownMenuItem(text = { Text(w("删除任务"), color = MaterialTheme.colorScheme.error) },
                                leadingIcon = { Glyph(R.drawable.ic_trash2, size = 18, tint = MaterialTheme.colorScheme.error) },
                                enabled = !actions.busy, onClick = { menu = false; deleting = task })
                        }
                    }
                }
            }
        }
    }
    Box(Modifier.fillMaxSize()) {
    Box(Modifier.fillMaxSize().alpha(if (detail == null) 1f else 0f).then(
        if (detail == null) Modifier else Modifier.clearAndSetSemantics {})) {
    Page(if (onCount != null) w("任务") else w("定时任务"), back, actions,
        centersSheetTitle = sessionId != null, count = visible.size.takeIf { onCount != null }, top = {
            if (sessionId == null) IconButton(onClick = { openTask(Route("task", target = "new")) }, modifier = Modifier.testTag("new-task")) {
                Glyph(R.drawable.ic_plus, w("新建任务"))
            }
        }) {
        if (sessionId == null) FilterTabs(filter, listOf("" to w("全部"), "active" to taskStatus("active"),
            "paused" to taskStatus("paused"), "ended" to taskStatus("ended"))) { filter = it }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (visible.isEmpty() && !actions.busy && actions.error == null) item {
                Box(Modifier.fillMaxWidth().heightIn(min = 160.dp), contentAlignment = Alignment.Center) {
                    Text(if (sessionId == null) w("没有任务") else w("暂无定时任务"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            taskRows(if (sessionId == null) visible else current)
            if (sessionId != null && finished.isNotEmpty()) item {
                InsetCard(Modifier.padding(start = 18.dp, end = 18.dp, top = if (current.isEmpty()) 0.dp else 14.dp)) {
                    Line(w("已结束"), leading = { Glyph(R.drawable.ic_check, size = 18, tint = MaterialTheme.colorScheme.onSurfaceVariant) },
                        minHeight = 52, action = { finishedOpen = !finishedIsOpen }, trailing = {
                            Text(finished.size.toString(), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Glyph(if (finishedIsOpen) R.drawable.ic_chevron_down else R.drawable.ic_chevron_right, size = 16)
                        })
                }
            }
            if (sessionId != null && finishedIsOpen && finished.isNotEmpty()) {
                item { Spacer(Modifier.height(10.dp)) }
                taskRows(finished)
            }
        }
    }
    }
    detail?.let { route -> key(route) {
        val state by model.state.collectAsState()
        TaskScreen(route, state, model, back = { detail = null; actions.refresh() }, close = back)
    } }
    }
    deleting?.let { task -> Confirm(w("删除任务"), task.optString("title"), actions, { deleting = null }, { actions.run {
        model.request("tasks.delete", json("id" to task.getString("id"), "revision" to task.getInt("revision")))
        deleting = null; actions.refresh()
    } }) }
}

@Composable
fun TaskScreen(route: Route, state: UiState, model: DuduViewModel,
    back: () -> Unit = model::backRoute, close: (() -> Unit)? = null) {
    val actions = rememberActions()
    val locale = appLocale()
    val isNew = route.target == "new"
    var task by remember { mutableStateOf<JSONObject?>(null) }
    var options by remember { mutableStateOf(json()) }
    var editing by remember { mutableStateOf(isNew || route.params.optBoolean("edit")) }
    var title by rememberSaveable { mutableStateOf("") }
    var prompt by rememberSaveable { mutableStateOf("") }
    var agent by rememberSaveable { mutableStateOf("dudu") }
    var selectedModel by rememberSaveable { mutableStateOf("") }
    var projectId by rememberSaveable { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf("reuse") }
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
    var deleting by remember { mutableStateOf(false) }
    var seeded by remember { mutableStateOf(false) }
    var editRevision by remember { mutableIntStateOf(0) }
    var choosingTime by remember { mutableStateOf(false) }
    var choosingDate by remember { mutableStateOf(false) }
    var picker by remember { mutableStateOf<TaskPicker?>(null) }
    var original by remember { mutableStateOf<List<String>?>(null) }
    var confirmingDiscard by remember { mutableStateOf(false) }
    val titleFocus = remember { FocusRequester() }
    val focus = LocalFocusManager.current
    var initialFocus by remember { mutableStateOf(isNew) }
    LaunchedEffect(editing, picker) {
        if (editing && picker == null && initialFocus) { titleFocus.requestFocus(); initialFocus = false }
    }
    fun draftValues() = listOf(title, prompt, agent, selectedModel, projectId, mode, sessionId,
        kind, time, zone, date, interval, day, cron, weekdays.sorted().joinToString(","))
    fun choose(p: TaskPicker) { focus.clearFocus(); picker = p }
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
        options = model.request("tasks.options", json("includeSessions" to true))
        if (!seeded && isNew) {
            zone = options.optString("timezone", zone)
            agent = options.rows("providers").firstOrNull { it.optBoolean("available") }?.optString("id") ?: "deepseek"
            mode = if (agent == "dudu") "new" else "reuse"
            projectId = if (agent == "dudu") "" else options.rows("projects").firstOrNull()?.optString("path").orEmpty()
            original = draftValues()
            seeded = true
        }
        if (!isNew) {
            val result = model.request("tasks.get", json("id" to route.target)).getJSONObject("task")
            task = result
            if (!seeded) { seed(result); seeded = true }
            val history = model.request("tasks.history", json("id" to route.target))
            runs = history.rows("runs"); cursor = if (history.isNull("nextCursor")) null else history.getLong("nextCursor")
        }
    } }
    fun action(name: String) = actions.run {
        val current = task ?: return@run
        model.request("tasks.$name", json("id" to current.getString("id"), "revision" to current.getInt("revision")))
        deleting = false
        if (name == "delete") back() else actions.refresh()
    }
    val dirty = original?.let { it != draftValues() } ?: (title.isNotBlank() || prompt.isNotBlank())
    PreventSheetDismiss(actions.busy || editing && dirty)
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
        if (!valid || !isNew && !dirty) return
        actions.run {
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
        if (isNew) {
            model.request("tasks.create", json("fields" to fields)); back()
        } else {
            if (task == null) return@run
            model.request("tasks.update", json("id" to route.target, "revision" to editRevision, "patch" to fields))
            original = draftValues(); editing = false; actions.refresh()
        }
        confirmingDiscard = false
        }
    }
    fun discard() { if (isNew || !editing) back() else { task?.let(::seed); editing = false } }
    val cancel: () -> Unit = { if (!actions.busy) { if (editing && dirty) confirmingDiscard = true else discard() } }
    val page = picker
    if (page != null && editing) {
        val providers = options.rows("providers")
        val knownModels = providers.find { it.optString("id") == agent }?.optJSONArray("models")?.strings().orEmpty()
        val projects = options.rows("projects")
        val project = projects.find { it.optString("path") == projectId }
        val choices = when (page) {
            TaskPicker.Provider -> providers.map { TaskChoice(it.getString("id"), it.getString("name"),
                agent = it.getString("id"), enabled = it.optBoolean("available")) }
            TaskPicker.Model -> listOf(TaskChoice("", w("默认模型"))) +
                (listOf(selectedModel).filter { it.isNotBlank() && it !in knownModels } + knownModels).map { TaskChoice(it, it) }
            TaskPicker.Workspace -> projects.map { TaskChoice(it.getString("path"), it.getString("name"), it.getString("path"), icon = R.drawable.ic_folder) }
            TaskPicker.Target -> (listOf("reuse", "new") + if (agent == "dudu") emptyList() else listOf("existing"))
                .map { TaskChoice(it, taskTargetName(it), icon = R.drawable.ic_message_circle) }
            TaskPicker.Session -> options.rows("sessions").filter {
                it.nullableString("workspaceId") == (project?.nullableString("workspaceId") ?: project?.nullableString("id"))
            }.map { TaskChoice(it.getString("id"), it.getString("title"), icon = R.drawable.ic_queue) }
            TaskPicker.Timezone -> (listOf(zone, options.optString("timezone")) + TimeZone.getAvailableIDs())
                .filter(String::isNotBlank).distinct().sorted().map { TaskChoice(it, taskTimezone(it)) }
        }
        TaskChoicePage(page, choices, when (page) {
            TaskPicker.Provider -> agent; TaskPicker.Model -> selectedModel; TaskPicker.Workspace -> projectId
            TaskPicker.Target -> mode; TaskPicker.Session -> sessionId; TaskPicker.Timezone -> zone
        }, emptyText = when (page) {
            TaskPicker.Workspace -> w("没有可用的工作区")
            TaskPicker.Session -> w("没有可用的会话")
            else -> null
        }, back = { picker = null }) { value ->
            when (page) {
                TaskPicker.Provider -> {
                    val wasDudu = agent == "dudu"
                    agent = value; selectedModel = ""; sessionId = ""
                    if (value == "dudu") { mode = "new"; projectId = "" }
                    else if (wasDudu) { mode = "reuse"; projectId = projects.firstOrNull()?.optString("path").orEmpty() }
                }
                TaskPicker.Model -> selectedModel = value
                TaskPicker.Workspace -> { if (projectId != value) sessionId = ""; projectId = value }
                TaskPicker.Target -> { if (mode != value) sessionId = ""; mode = value }
                TaskPicker.Session -> sessionId = value
                TaskPicker.Timezone -> zone = value
            }
            picker = null
        }
        return
    }
    Page(if (editing) { if (isNew) w("新建任务") else w("编辑") } else w("任务"), cancel, actions,
        centersSheetTitle = editing || close != null, cancels = editing, nested = close != null && !editing,
        background = if (editing) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.surfaceContainer,
        close = close?.takeUnless { editing }?.let { action -> { if (!actions.busy) action() } }, top = {
        if (editing) TextButton(onClick = { save() }, enabled = valid && !actions.busy && (isNew || dirty), modifier = Modifier.testTag("save-task")) { Text(stringResource(R.string.save)) }
        else IconButton(onClick = { task?.let(::seed); editing = true }, enabled = task != null && !actions.busy,
            modifier = Modifier.testTag("edit-task")) { Glyph(R.drawable.ic_pencil, w("编辑")) }
    }) {
        if (editing) Form {
            DraftInput(title, w("自动化任务名称"), seeded && !actions.busy, tag = "task-title", modifier = Modifier.focusRequester(titleFocus)) { title = it }
            DraftInput(prompt, w("自动化任务内容"), seeded && !actions.busy, multi = true, tag = "task-prompt") { prompt = it }
            val providers = options.rows("providers")
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            IssueChip(providers.find { it.optString("id") == agent }?.optString("name") ?: w("嘟嘟"),
                !actions.busy && state.connected, "task-provider", icon = { AgentLogo(agent, 16) }) { choose(TaskPicker.Provider) }
            IssueChip(selectedModel.ifBlank { w("默认模型") }, !actions.busy && state.connected, "task-model",
                icon = { Glyph(R.drawable.ic_bot, size = 16) }) { choose(TaskPicker.Model) }
            if (agent != "dudu") IssueChip(options.rows("projects").find { it.optString("path") == projectId }?.optString("name")
                ?: w("关联工作区"), !actions.busy && state.connected, icon = { Glyph(R.drawable.ic_folder, size = 16) }) { choose(TaskPicker.Workspace) }
            IssueChip(taskTargetName(mode), !actions.busy && state.connected,
                icon = { Glyph(R.drawable.ic_message_circle, size = 16) }) { choose(TaskPicker.Target) }
            if (mode == "existing") {
                val sessions = options.rows("sessions")
                IssueChip(sessions.find { it.optString("id") == sessionId }?.optString("title") ?: w("关联会话"),
                    !actions.busy && state.connected, icon = { Glyph(R.drawable.ic_queue, size = 16) }) { choose(TaskPicker.Session) }
            }
            }
            Text(w("运行时间"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            InsetCard {
            Choice(w("规则"), scheduleKind(kind), listOf("daily", "workdays", "weekly", "monthly", "interval", "once", "cron")
                .map { it to scheduleKind(it) }, !actions.busy, prominentLabel = true) { kind = it }
            TaskRuleDivider()
            when (kind) {
                "cron" -> TaskRuleInput("Cron", cron, !actions.busy) { cron = it }
                "interval" -> TaskRuleInput(w("分"), interval, !actions.busy) { interval = it }
                else -> {
                    TaskRuleButton(w("运行时间"), time, "task-time", !actions.busy) { choosingTime = true }
                    if (kind == "once") { TaskRuleDivider(); TaskRuleButton(w("仅一次"), date, "task-date", !actions.busy) { choosingDate = true } }
                    if (kind == "monthly") { TaskRuleDivider(); TaskRuleInput(w("日期"), day, !actions.busy) { day = it } }
                    if (kind == "weekly") FlowRow(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(1, 2, 3, 4, 5, 6, 0).forEach { index ->
                            FilterChip(index in weekdays, enabled = !actions.busy, onClick = { weekdays = if (index in weekdays) weekdays - index else weekdays + index },
                                label = { Text(java.text.DateFormatSymbols.getInstance(locale).shortWeekdays[index + 1]) })
                        }
                    }
                }
            }
            TaskRuleDivider()
            Line(w("时区"), enabled = !actions.busy && state.connected, action = { choose(TaskPicker.Timezone) }, trailing = {
                Text(taskTimezone(zone), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Glyph(R.drawable.ic_chevron_right, size = 16, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            })
            }
        } else {
        LazyColumn(Modifier.weight(1f).testTag("task-detail-list"), contentPadding = PaddingValues(bottom = 20.dp)) {
            task?.let { task ->
                item {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 26.dp, vertical = 20.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        AgentLogo(task.optString("agent"), 26)
                        Text(task.getString("title"), Modifier.weight(1f), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                        Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surfaceContainer) {
                            Text(taskStatus(task.optString("status")), Modifier.padding(horizontal = 10.dp, vertical = 5.dp), fontSize = 12.sp,
                                color = if (task.optString("status") == "active") androidx.compose.ui.graphics.Color(0xFF177A3C)
                                    else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                item { Section(w("规则")) }
                item {
                    val schedule = task.getJSONObject("schedule")
                    val values = listOf(w("运行时间") to scheduleLine(schedule), w("时区") to schedule.optString("timezone"),
                        w("下次运行") to if (task.optString("status") != "active" || task.isNull("nextRunAt")) "—" else
                            DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale).apply {
                                timeZone = TimeZone.getTimeZone(schedule.optString("timezone")) }.format(Date(task.getLong("nextRunAt"))),
                        w("执行位置") to taskTargetName(task.getJSONObject("target").optString("mode"))) +
                        listOfNotNull(task.optJSONObject("project")?.let { w("关联工作区") to it.optString("name") }) +
                        listOf(w("供应商") to (options.rows("providers").find { it.optString("id") == task.optString("agent") }?.optString("name") ?: task.optString("agent")),
                            w("模型") to (task.nullableString("model") ?: w("默认模型")))
                    InsetCard(Modifier.padding(horizontal = 18.dp)) {
                        values.forEachIndexed { index, (name, value) ->
                            if (index > 0) TaskRuleDivider()
                            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 15.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(name, fontSize = 15.sp); Spacer(Modifier.width(12.dp))
                                Text(value, Modifier.weight(1f), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    textAlign = androidx.compose.ui.text.style.TextAlign.End)
                            }
                        }
                    }
                }
                item { Section(w("自动化任务内容")) }
                item { InsetCard(Modifier.padding(horizontal = 18.dp)) { Box(Modifier.padding(16.dp)) { Markdown(task.optString("prompt")) } } }
                val linked = task.optJSONObject("target")?.nullableString("sessionId") ?: task.nullableString("sessionId")
                linked?.let { id -> item { Line(w("关联会话"), icon = R.drawable.ic_message_circle,
                    action = { model.openSession(id, task.getString("title")) }) } }
                if (runs.isNotEmpty()) item { Section(w("任务运行记录")) }
                cardItems(runs, key = { it.getString("id") }) { run ->
                    Line(DateFormat.getDateTimeInstance(DateFormat.DEFAULT, DateFormat.DEFAULT, locale).format(Date(run.getLong("at"))), taskStatus(run.optString("status")),
                        action = run.nullableString("sessionId")?.let { id -> ({ model.openSession(id, task.getString("title")) }) })
                }
                if (cursor != null) item { TextButton(onClick = { actions.run {
                    val next = model.request("tasks.history", json("id" to route.target, "before" to cursor))
                    runs = (runs + next.rows("runs")).distinctBy { it.getString("id") }
                    cursor = if (next.isNull("nextCursor")) null else next.getLong("nextCursor")
                } }, enabled = !actions.busy, modifier = Modifier.fillMaxWidth()) { Text(w("加载更多")) } }
            }
        }
        Surface(Modifier.padding(horizontal = 24.dp, vertical = 12.dp).fillMaxWidth(), shape = RoundedCornerShape(50),
            color = MaterialTheme.colorScheme.surface, border = androidx.compose.foundation.BorderStroke(.5.dp, MaterialTheme.colorScheme.outlineVariant)) {
            Row(Modifier.fillMaxWidth().height(48.dp), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                val status = task?.optString("status")
                if (status == "active" || status == "paused") IconButton(onClick = { action(if (status == "active") "pause" else "resume") }, enabled = !actions.busy) {
                    Glyph(if (status == "active") R.drawable.ic_pause else R.drawable.ic_play, if (status == "active") w("暂停任务") else w("恢复任务"), 22)
                }
                IconButton(onClick = { action("run") }, enabled = task != null && !actions.busy) { Glyph(R.drawable.ic_zap, w("立即执行"), 22) }
                IconButton(onClick = { action("duplicate") }, enabled = task != null && !actions.busy) { Glyph(R.drawable.ic_copy, w("复制任务"), 22) }
                IconButton(onClick = { deleting = true }, enabled = task != null && !actions.busy) { Glyph(R.drawable.ic_trash2, w("删除任务"), 22, MaterialTheme.colorScheme.error) }
            }
        }
        }
    }
    if (confirmingDiscard) AlertDialog(onDismissRequest = { if (!actions.busy) confirmingDiscard = false },
        title = { Text(w("有未保存的修改")) },
        confirmButton = { TextButton(onClick = { save() }, enabled = valid && !actions.busy) { Text(w("保存修改")) } },
        dismissButton = {
            Row {
                TextButton(onClick = { confirmingDiscard = false }, enabled = !actions.busy) { Text(w("取消")) }
                TextButton(onClick = { confirmingDiscard = false; discard() }, enabled = !actions.busy) {
                    Text(w("放弃"), color = MaterialTheme.colorScheme.error)
                }
            }
        }, text = actions.error?.let { code -> { Text(problemText(code), color = MaterialTheme.colorScheme.error) } })
    if (deleting) Confirm(w("删除任务"), task?.optString("title"), actions, { deleting = false }, { action("delete") })
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
