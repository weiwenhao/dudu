@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.time.*
import java.util.Date

enum class IssuePicker { Priority, Agent, Status, Due, Labels, Project, Parent, NewProject, LabelColor }

@Composable
fun IssuePropertySheet(panel: Panel.EditIssue, state: UiState, model: DuduViewModel) {
    val actions = rememberActions()
    var issue by remember(panel.issue.id) { mutableStateOf<Issue?>(null) }
    var options by remember { mutableStateOf<Options?>(null) }
    var pickerBusy by remember { mutableStateOf(false) }
    LaunchedEffect(actions.revision) {
        actions.run {
            val full = Issue.parse(model.request("issue.get", json("id" to panel.issue.id)).getJSONObject("issue"))
            val choices = model.issueOptions()
            issue = full; options = choices
        }
    }
    DuduSheet(model::dismissPanel, canDismiss = !state.busy && !pickerBusy) {
        Column(Modifier.fillMaxWidth().height(680.dp).testTag("bottom-sheet")) {
            val full = issue
            if (full == null || options == null) {
                SheetHeader(issuePropertyTitle(panel.property), model::dismissPanel)
                if (actions.busy) Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                } else {
                    Text(w("事项没能加载"), Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    TextButton(onClick = actions::refresh) { Text(stringResource(R.string.retry)) }
                }
            } else {
                val allowed = full.agent == null || panel.property !in listOf(IssueProperty.Agent, IssueProperty.Project)
                IssuePickerFlow(IssuePicker.valueOf(panel.property.name),
                    IssueDraft(title = full.title, project = full.project, agent = full.agent, status = full.status,
                        priority = full.priority, labels = full.labelIds, dueAt = full.dueAt),
                    options, model, { options = it }, onSelect = { draft ->
                        when (panel.property) {
                            IssueProperty.Agent -> draft.project?.let { project ->
                                draft.agent?.let { model.assign(full, project, it) }
                            }
                            else -> model.updateIssue(full, when (panel.property) {
                                IssueProperty.Status -> json("status" to draft.status)
                                IssueProperty.Priority -> json("priority" to draft.priority)
                                IssueProperty.Project -> json("project" to draft.project?.json())
                                IssueProperty.Due -> json("dueAt" to draft.dueAt)
                                IssueProperty.Labels -> json("labels" to JSONArray(draft.labels.sorted()))
                                IssueProperty.Agent -> error("Agent assignment uses issue.assign")
                            })
                        }
                    }, dismiss = model::dismissPanel, nestedRoot = false,
                    saving = state.busy, enabled = allowed && state.connected,
                    busyChanged = { pickerBusy = it })
                // A save that failed leaves the sheet open and says so at its foot, as the iPhone's `IssueActionsSheet`.
                if (state.problem == "conflict" && !state.busy) Text(w("更改没能保存"), Modifier.fillMaxWidth().padding(16.dp)
                    .testTag("panel-error"), fontSize = 13.sp, color = androidx.compose.ui.graphics.Color(0xFFEC1313),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
}

/** Creation and existing properties share the same choice pages and preserve failed edits. */
@Composable
fun IssuePickerFlow(root: IssuePicker, draft: IssueDraft, options: Options?, model: DuduViewModel,
    optionsChanged: (Options) -> Unit, onSelect: (IssueDraft) -> Unit, dismiss: () -> Unit,
    nestedRoot: Boolean = true, saving: Boolean = false, enabled: Boolean = true, problem: String? = null,
    busyChanged: (Boolean) -> Unit = {}) {
    val actions = rememberActions()
    var pages by remember(root) { mutableStateOf(listOf(if (root == IssuePicker.Agent && draft.project?.path.isNullOrBlank())
        IssuePicker.Project else root)) }
    var assignmentProject by remember(root) { mutableStateOf(draft.project) }
    var selectedLabels by remember(root) { mutableStateOf(draft.labels) }
    var query by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var folder by remember { mutableStateOf("") }
    var createDirectory by remember { mutableStateOf(false) }
    var newLabel by remember { mutableStateOf("") }
    var parents by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var parentProblem by remember { mutableStateOf<String?>(null) }
    var parentsLoading by remember { mutableStateOf(false) }
    var parentRetry by remember { mutableIntStateOf(0) }
    val page = pages.last()
    val busy = saving || actions.busy
    val editable = enabled && !busy
    SideEffect { busyChanged(busy) }
    fun back() {
        if (busy) return
        if (pages.size > 1) { pages = pages.dropLast(1); query = ""; actions.error = null }
        else dismiss()
    }
    fun projectChosen(project: Project?) {
        if (root == IssuePicker.Agent) {
            assignmentProject = project
            if (!project?.path.isNullOrBlank()) {
                pages = pages.filter { it != IssuePicker.NewProject } + IssuePicker.Agent
                query = ""
            }
        } else onSelect(draft.copy(project = project,
            agent = if (project?.path == draft.project?.path && !project?.path.isNullOrBlank()) draft.agent else null))
    }
    BackHandler { back() }
    LaunchedEffect(page, query, parentRetry) {
        if (page == IssuePicker.Parent) {
            parentsLoading = true; parentProblem = null
            if (query.isNotEmpty()) kotlinx.coroutines.delay(200)
            try { parents = model.request("issue.parents", json("q" to query.take(300))).rows("items") }
            catch (error: Exception) {
                if (error is CancellationException) throw error
                parentProblem = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
            } finally { parentsLoading = false }
        }
    }
    val zone = ZoneId.systemDefault()
    val date = rememberDatePickerState(initialSelectedDateMillis =
        (draft.dueAt?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() } ?: LocalDate.now())
            .atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
    fun saveDate() = onSelect(draft.copy(dueAt = date.selectedDateMillis?.let {
        Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().atTime(12, 0).atZone(zone).toInstant().toEpochMilli()
    }))
    val title = when (page) {
        IssuePicker.Parent -> w("父事项")
        IssuePicker.NewProject -> w("新建项目")
        IssuePicker.LabelColor -> w("选择标签颜色")
        else -> issuePropertyTitle(IssueProperty.valueOf(page.name))
    }
    Column(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 8.dp)) {
            Text(title, Modifier.align(Alignment.Center), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            val confirms = page in listOf(IssuePicker.Due, IssuePicker.Labels)
            if (nestedRoot || pages.size > 1) IconButton(onClick = ::back, enabled = !busy,
                modifier = Modifier.align(Alignment.CenterStart).testTag("picker-back")) {
                BarGlyph(DuduGlyphs.back, stringResource(R.string.back))
            } else if (confirms) TextButton(onClick = ::back, enabled = !busy, modifier = Modifier.align(Alignment.CenterStart)) {
                Text(stringResource(R.string.cancel))
            }
            when {
                confirms -> TextButton(onClick = {
                    if (page == IssuePicker.Due) saveDate() else onSelect(draft.copy(labels = selectedLabels))
                }, enabled = editable && options != null, modifier = Modifier.align(Alignment.CenterEnd)) {
                    Text(stringResource(R.string.save), color = MaterialTheme.colorScheme.secondary)
                }
                page == IssuePicker.NewProject -> TextButton(onClick = { actions.run {
                    val result = model.request("issue.project.create", json("name" to name.trim(), "path" to folder.trim(),
                        "createDirectory" to createDirectory)).getJSONObject("project")
                    val project = Project(result.getString("name"), result.nullableString("path"))
                    options?.let { optionsChanged(it.copy(projects = (it.projects + project).distinctBy { p -> p.path to p.name })) }
                    if (root != IssuePicker.Agent && pages.size > 1) pages = pages.dropLast(1)
                    projectChosen(project)
                } }, enabled = editable && folder.isNotBlank(), modifier = Modifier.align(Alignment.CenterEnd)) {
                    Text(w("新建项目"), color = MaterialTheme.colorScheme.secondary)
                }
                !nestedRoot && pages.size == 1 -> IconButton(onClick = ::back, enabled = !busy,
                    modifier = Modifier.align(Alignment.CenterEnd).testTag("close-sheet")) {
                    BarGlyph(DuduGlyphs.close, stringResource(R.string.close))
                }
            }
        }
        if (page in listOf(IssuePicker.Project, IssuePicker.Labels, IssuePicker.Parent)) {
            Box(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) {
                SearchField(query, when (page) {
                    IssuePicker.Project -> w("选择项目")
                    IssuePicker.Labels -> w("修改或添加标签…")
                    else -> w("搜索事项…")
                }) { query = it }
            }
        }
        if (busy || options == null && page != IssuePicker.Parent) LinearProgressIndicator(Modifier.fillMaxWidth())
        (problem ?: actions.error)?.let { code ->
            Text(problemText(code), Modifier.padding(horizontal = 20.dp, vertical = 8.dp).testTag("panel-error"),
                color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
        }
        if (options == null && problem != null && !busy) TextButton(onClick = { actions.run {
            optionsChanged(model.issueOptions())
        } }) { Text(stringResource(R.string.retry)) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 12.dp)) {
            InsetCard {
                when (page) {
                    IssuePicker.Status -> options?.statuses.orEmpty().forEach { status ->
                        IssueChoiceRow(statusTitle(status), selected = status.id == draft.status, enabled = editable,
                            tag = "status-picker-option-${status.id}", icon = { IssueStatusMark(status) }) {
                            onSelect(draft.copy(status = status.id))
                        }
                    }
                    IssuePicker.Priority -> listOf("none", "urgent", "high", "medium", "low").forEach { priority ->
                        IssueChoiceRow(priorityTitle(priority), selected = priority == draft.priority, enabled = editable,
                            tag = "priority-picker-option-$priority", icon = { IssuePriorityMark(priority) }) {
                            onSelect(draft.copy(priority = priority))
                        }
                    }
                    IssuePicker.Project -> {
                        IssueChoiceRow(stringResource(R.string.no_project), selected = assignmentProject == null,
                            enabled = editable, icon = { Glyph(DuduGlyphs.issueProject, size = 18) }) { projectChosen(null) }
                        val projects = (listOfNotNull(assignmentProject) + options?.projects.orEmpty()).distinctBy { it.path to it.name }
                        projects.filter { "${it.name} ${it.path.orEmpty()}".contains(query.trim(), ignoreCase = true) }.forEach { project ->
                            IssueChoiceRow(project.name, project.path, selected = project == assignmentProject, enabled = editable,
                                icon = { Glyph(DuduGlyphs.issueProject, size = 18) }) { projectChosen(project) }
                        }
                        if (projects.isEmpty() && options != null) PickerEmpty(w("还没有项目"))
                        PickerDivider()
                        IssueChoiceRow(w("新建项目"), enabled = editable, icon = { Glyph(DuduGlyphs.plus, size = 18) }) {
                            pages = pages + IssuePicker.NewProject; query = ""
                        }
                    }
                    IssuePicker.Agent -> {
                        if (root != IssuePicker.Agent || nestedRoot) IssueChoiceRow(stringResource(R.string.unassigned),
                            selected = draft.agent == null, enabled = editable, icon = { Glyph(DuduGlyphs.stateUnassigned, size = 18) }) {
                            onSelect(draft.copy(agent = null))
                        }
                        options?.agents.orEmpty().forEach { agent ->
                            IssueChoiceRow(agentName(agent), selected = draft.agent == agent, enabled = editable,
                                icon = { AgentLogo(agent, 20) }) { onSelect(draft.copy(project = assignmentProject, agent = agent)) }
                        }
                    }
                    IssuePicker.Labels -> {
                        val labels = options?.labels.orEmpty()
                        labels.filter { it.name.contains(query.trim(), ignoreCase = true) }.forEach { label ->
                            IssueChoiceRow(label.name, selected = label.id in selectedLabels, enabled = editable,
                                icon = { Box(Modifier.size(10.dp).background(labelColor(label.color), CircleShape)) }) {
                                selectedLabels = if (label.id in selectedLabels) selectedLabels - label.id else selectedLabels + label.id
                            }
                        }
                        if (labels.isEmpty() && query.isBlank() && options != null) PickerEmpty(w("还没有标签"))
                        if (query.isNotBlank() && labels.none { it.name.equals(query.trim(), ignoreCase = true) }) {
                            IssueChoiceRow(w("新建标签：“{0}”").replace("{0}", query.trim()), enabled = editable,
                                icon = { Glyph(DuduGlyphs.plus, size = 18) }) {
                                newLabel = query.trim(); pages = pages + IssuePicker.LabelColor
                            }
                        }
                    }
                    IssuePicker.LabelColor -> labelPalette.forEach { (id, _) ->
                        IssueChoiceRow(labelColorTitle(id), enabled = editable,
                            icon = { Box(Modifier.size(10.dp).background(labelColor(id), CircleShape)) }) {
                            actions.run {
                                val raw = model.request("issue.label.create", json("name" to newLabel, "color" to id)).getJSONObject("label")
                                val label = Label(raw.getLong("id"), raw.getString("name"), raw.nullableString("color"))
                                options?.let { optionsChanged(it.copy(labels = (it.labels + label).sortedBy { value -> value.name })) }
                                selectedLabels = selectedLabels + label.id
                                pages = pages.dropLast(1); query = ""
                            }
                        }
                    }
                    IssuePicker.Due -> {
                        val today = LocalDate.now()
                        val friday = (DayOfWeek.FRIDAY.value - today.dayOfWeek.value + 7) % 7
                        listOf(w("明天") to today.plusDays(1), w("本周结束") to today.plusDays(friday.toLong()),
                            w("一周后") to today.plusDays(7)).forEach { (label, day) ->
                            IssueChoiceRow(label, monthDay(day.atTime(12, 0).atZone(zone).toInstant().toEpochMilli()), enabled = editable,
                                icon = { Glyph(DuduGlyphs.dueDate, size = 18) }) {
                                onSelect(draft.copy(dueAt = day.atTime(12, 0).atZone(zone).toInstant().toEpochMilli()))
                            }
                        }
                        PickerDivider()
                        // Freeze the calendar while its selected value is being saved.
                        Box {
                            DatePicker(date, modifier = Modifier.fillMaxWidth(), title = null, headline = null, showModeToggle = false)
                            if (!editable) Box(Modifier.matchParentSize().clickable(
                                interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                                indication = null) {})
                        }
                        if (draft.dueAt != null) {
                            PickerDivider()
                            IssueChoiceRow(w("移除截止日期"), enabled = editable, icon = { Glyph(DuduGlyphs.remove, size = 18) }) {
                                onSelect(draft.copy(dueAt = null))
                            }
                        }
                    }
                    // The iPhone's `IssueParentPicker`: each issue with its status and reference; the form's chip takes a parent away (its ×).
                    IssuePicker.Parent -> when {
                        parentsLoading -> Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) { RowSpinner(20) }
                        parentProblem != null -> Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(w("事项没能加载"), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(stringResource(R.string.retry), Modifier.clickable { parentRetry++ }.padding(vertical = 8.dp),
                                fontSize = 14.sp, color = DuduStyle.blue)
                        }
                        parents.isEmpty() -> PickerEmpty(w("没有找到事项"))
                        else -> parents.forEach { parent ->
                            val status = Status(parent.optString("status"), null, parent.optString("statusType", parent.optString("status")), false)
                            IssueChoiceRow(parent.getString("title"), parent.nullableString("ref"), enabled = editable,
                                icon = { IssueStatusMark(status) }) {
                                onSelect(draft.copy(parent = parent.getLong("id")))
                            }
                        }
                    }
                    IssuePicker.NewProject -> Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        IssuePlainField(w("项目名称"), name, editable) { name = it }
                        HorizontalDivider(thickness = .5.dp)
                        IssuePlainField(w("项目文件夹"), folder, editable) { folder = it }
                        HorizontalDivider(thickness = .5.dp)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(w("文件夹不存在时创建"), Modifier.weight(1f), fontSize = 15.sp)
                            Switch(createDirectory, { createDirectory = it }, modifier = Modifier.scale(0.8f), enabled = editable)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun labelColorTitle(id: String) = when (id) {
    "grey" -> w("灰色"); "darkGrey" -> w("深灰"); "purple" -> w("紫色"); "teal" -> w("青色")
    "green" -> w("绿色"); "yellow" -> w("黄色"); "orange" -> w("橙色"); "pink" -> w("粉色"); else -> w("红色")
}

@Composable
private fun PickerEmpty(words: String) {
    Text(words, Modifier.padding(20.dp), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable
private fun PickerDivider() {
    HorizontalDivider(Modifier.padding(horizontal = 16.dp), thickness = .5.dp, color = MaterialTheme.colorScheme.outlineVariant)
}

@Composable
fun IssueChoiceRow(title: String, subtitle: String? = null, selected: Boolean = false,
    enabled: Boolean = true, tag: String = "", icon: @Composable () -> Unit, action: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = enabled, onClick = action)
        .testTag(tag).semantics { this.selected = selected }.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) { icon() }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else .4f))
            subtitle?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (selected) Glyph(DuduGlyphs.check, size = 18)
    }
}

@Composable
private fun IssuePlainField(label: String, value: String, enabled: Boolean, changed: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        BasicTextField(value, changed, Modifier.fillMaxWidth(), enabled = enabled, singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(DuduStyle.blue))
    }
}
