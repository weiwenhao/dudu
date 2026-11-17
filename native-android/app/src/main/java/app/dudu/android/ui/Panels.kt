@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalContext
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
fun Panels(state: UiState, model: DuduViewModel) {
    var creationPicker by remember(state.panel) { mutableStateOf<IssuePicker?>(null) }
    var pickerBusy by remember(creationPicker) { mutableStateOf(false) }
    when (val panel = state.panel) {
        null -> Unit
        is Panel.Actions -> IssueContextMenu(panel, state, model)
        is Panel.EditIssue -> key(panel.issue.id, panel.property) { IssuePropertySheet(panel, state, model) }
        is Panel.Rename -> RenameIssue(panel, state, model)
        is Panel.Delete -> DuduConfirmation(
            stringResource(R.string.delete_title, panel.issue.ref ?: "#${panel.issue.id}", panel.issue.title),
            stringResource(R.string.delete_body), !state.busy,
            model::dismissPanel, model::confirmDelete, error = state.problem?.let { problemText(it) },
            tag = "confirm-delete")
        else -> {
            DuduSheet(model::dismissPanel, canDismiss = !state.busy && !pickerBusy,
                containerColor = if (panel == Panel.Create) MaterialTheme.colorScheme.background else MaterialTheme.colorScheme.surfaceContainer) {
                val picker = creationPicker
                if (panel == Panel.Create && picker != null) {
                    Box(Modifier.fillMaxWidth().height(680.dp)) {
                        IssuePickerFlow(picker, state.draft, state.options, model, model::receiveIssueOptions,
                            onSelect = { model.editDraft(it); creationPicker = null },
                            dismiss = { creationPicker = null }, saving = state.busy, problem = state.problem,
                            busyChanged = { pickerBusy = it })
                    }
                } else {
                Column(Modifier.fillMaxWidth().testTag("bottom-sheet")) {
                    if (panel == Panel.Create) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 8.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            TextButton(onClick = model::dismissPanel, enabled = !state.busy) {
                                Text(stringResource(R.string.cancel))
                            }
                            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                                Text(stringResource(R.string.new_issue), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            }
                            TextButton(onClick = model::createIssue,
                                enabled = state.draft.valid && state.options != null && !state.busy,
                                modifier = Modifier.testTag("create-issue")) {
                                Text(stringResource(R.string.create), color = if (state.draft.valid && state.options != null)
                                    MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    } else SheetHeader(when (panel) {
                        Panel.Computers -> stringResource(R.string.computers)
                        Panel.Quota -> stringResource(R.string.quota)
                        else -> ""
                    }, model::dismissPanel, !state.busy && !state.connecting, action = if (panel == Panel.Computers) { {
                        IconButton(onClick = { model.navigate(Route("pair")) }, enabled = !state.connecting) {
                            Glyph(R.drawable.ic_plus, w("添加电脑"), 22)
                        }
                    } } else null)
                    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        when (panel) {
                            Panel.Computers -> ComputerList(state, model)
                            Panel.Create -> IssueForm(state, model) { creationPicker = it }
                            Panel.Quota -> Quota(state)
                            else -> Unit
                        }
                        if (state.problem != null) Text(problemText(state.problem),
                            color = MaterialTheme.colorScheme.error, fontSize = 14.sp,
                            modifier = Modifier.testTag("panel-error"))
                        Spacer(Modifier.height(12.dp))
                    }
                    if (state.busy || state.connecting) LinearProgressIndicator(Modifier.fillMaxWidth(),
                        color = MaterialTheme.colorScheme.secondary)
                    }
                }
            }
        }
    }
}

@Composable
private fun IssueForm(state: UiState, model: DuduViewModel, choose: (IssuePicker) -> Unit) {
    val draft = state.draft
    val options = state.options
    val context = LocalContext.current
    val photos = rememberActions()
    var photoComputer by remember { mutableStateOf("") }
    var parentTitle by remember(draft.parent) { mutableStateOf<String?>(null) }
    LaunchedEffect(draft.parent) {
        val parent = draft.parent ?: return@LaunchedEffect
        runCatching { model.request("issue.get", json("id" to parent)).getJSONObject("issue") }.getOrNull()?.let {
            parentTitle = it.getString("title")
            if (model.state.value.draft.project?.path.isNullOrBlank()) {
                val project = Issue.parse(it).project
                if (project != null) model.editDraft(model.state.value.draft.copy(project = project))
            }
        }
    }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        photos.run {
            if (model.state.value.computerId != photoComputer || model.state.value.panel != Panel.Create) return@run
            model.editDraft(model.state.value.draft.copy(preparingPhotos = true))
            try {
            for (uri in uris) {
                val current = model.state.value
                if (current.computerId != photoComputer || current.panel != Panel.Create) return@run
                if (current.draft.photos.size >= 9) break
                val file = withContext(Dispatchers.IO) {
                    json("name" to "${java.util.UUID.randomUUID()}.jpg", "mimeType" to "image/jpeg",
                        "dataBase64" to android.util.Base64.encodeToString(
                            preparePhoto(context.contentResolver, uri), android.util.Base64.NO_WRAP))
                }
                val latest = model.state.value
                if (latest.computerId != photoComputer || latest.panel != Panel.Create) return@run
                model.editDraft(latest.draft.copy(photos = latest.draft.photos + file))
            }
            } finally {
                val latest = model.state.value
                if (latest.computerId == photoComputer && latest.panel == Panel.Create)
                    model.editDraft(latest.draft.copy(preparingPhotos = false))
            }
        }
    }
    if (draft.parent != null) Row(verticalAlignment = Alignment.CenterVertically) {
        TextButton(onClick = { choose(IssuePicker.Parent) }, enabled = !state.busy, modifier = Modifier.weight(1f)) {
            Glyph(R.drawable.ic_corner_down_right, size = 16)
            Spacer(Modifier.width(8.dp))
            Text(parentTitle ?: w("子事项"), maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        IconButton(onClick = { model.editDraft(draft.copy(parent = null)) }, enabled = !state.busy) {
            Glyph(R.drawable.ic_x, w("移除父事项"), 16)
        }
    }
    DraftInput(draft.title, stringResource(R.string.issue_title), !state.busy, "issue-title") {
        model.editDraft(draft.copy(title = it.take(300)))
    }
    DraftInput(draft.description, stringResource(R.string.description), !state.busy, multi = true) {
        model.editDraft(draft.copy(description = it.take(20000)))
    }
    if (draft.photos.isNotEmpty()) AttachmentTiles(draft.photos, !state.busy) { index ->
        model.editDraft(draft.copy(photos = draft.photos.filterIndexed { i, _ -> i != index }))
    }
    if (photos.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    photos.error?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        val status = options?.statuses?.find { it.id == draft.status }
        IssueChip(status?.let { statusTitle(it) } ?: stringResource(R.string.status), !state.busy, "status-picker",
            { IssueStatusMark(status ?: Status("", null, "todo", false)) }) { choose(IssuePicker.Status) }
        IssueChip(if (draft.priority == "none") stringResource(R.string.priority) else priorityTitle(draft.priority),
            !state.busy, "priority-picker", { IssuePriorityMark(draft.priority) }) { choose(IssuePicker.Priority) }
        IssueChip(draft.project?.name ?: stringResource(R.string.project), !state.busy, "project-picker",
            { Glyph(R.drawable.ic_folder, size = 16) }) { choose(IssuePicker.Project) }
        if (!draft.project?.path.isNullOrBlank()) IssueChip(draft.agent?.let(::agentName) ?: stringResource(R.string.agent),
            !state.busy, "agent-picker", { AgentLogo(draft.agent, 16) }) { choose(IssuePicker.Agent) }
        IssueChip(options?.labels.orEmpty().filter { it.id in draft.labels }.joinToString { it.name }.ifEmpty { w("标签") },
            !state.busy, "labels-picker", { Glyph(R.drawable.ic_tag, size = 16) }) { choose(IssuePicker.Labels) }
        if (draft.dueAt != null) IssueChip(java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM, appLocale())
            .format(java.util.Date(draft.dueAt)), !state.busy, "due-picker",
            { Glyph(R.drawable.ic_calendar, size = 16) }) { choose(IssuePicker.Due) }
        var more by remember { mutableStateOf(false) }
        Box {
            OutlinedButton(onClick = { more = true }, enabled = !state.busy,
                shape = RoundedCornerShape(50), border = androidx.compose.foundation.BorderStroke(.5.dp, MaterialTheme.colorScheme.outlineVariant),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
                contentPadding = PaddingValues(8.dp), modifier = Modifier.widthIn(min = 36.dp).heightIn(min = 44.dp)) {
                Glyph(R.drawable.ic_ellipsis, stringResource(R.string.more), 16)
            }
            DropdownMenu(more, { more = false }) {
                DropdownMenuItem(text = { Text(w("截止日期")) }, leadingIcon = { Glyph(R.drawable.ic_calendar, size = 18) },
                    onClick = { more = false; choose(IssuePicker.Due) })
                DropdownMenuItem(text = { Text(w("设置父事项…")) }, leadingIcon = { Glyph(R.drawable.ic_corner_down_right, size = 18) },
                    onClick = { more = false; choose(IssuePicker.Parent) })
                if (options?.attachments == true) DropdownMenuItem(text = { Text(w("添加图片")) },
                    leadingIcon = { Glyph(R.drawable.ic_plus, size = 18) }, enabled = draft.photos.size < 9 && !photos.busy,
                    onClick = { more = false; photoComputer = state.computerId; picker.launch(arrayOf("image/*")) })
            }
        }
    }
}

@Composable
internal fun IssueChip(title: String, enabled: Boolean, tag: String = "", icon: @Composable () -> Unit, click: () -> Unit) {
    OutlinedButton(onClick = click, enabled = enabled, modifier = Modifier.testTag(tag),
        shape = RoundedCornerShape(50), border = androidx.compose.foundation.BorderStroke(.5.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp)) {
        icon()
        Spacer(Modifier.width(6.dp))
        Text(title, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
internal fun DraftInput(value: String, placeholder: String, enabled: Boolean, tag: String = "",
    multi: Boolean = false, modifier: Modifier = Modifier, changed: (String) -> Unit) {
    BasicTextField(value, changed, enabled = enabled, modifier = modifier.fillMaxWidth().testTag(tag),
        textStyle = MaterialTheme.typography.bodyLarge.copy(
            color = MaterialTheme.colorScheme.onSurface,
            fontWeight = if (multi) FontWeight.Normal else FontWeight.SemiBold),
        minLines = if (multi) 4 else 1, maxLines = if (multi) 8 else 4,
        decorationBox = { inner ->
            Box(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(16.dp))
                .padding(16.dp)) {
                if (value.isEmpty()) Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    fontSize = 16.sp, fontWeight = if (multi) FontWeight.Normal else FontWeight.SemiBold)
                inner()
            }
        })
}

@Composable
fun Choice(label: String, value: String, options: List<Pair<String, String>>, enabled: Boolean,
    modifier: Modifier = Modifier, tag: String = "", logo: String? = null,
    agentIcons: Boolean = logo != null, prominentLabel: Boolean = false, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        Surface(onClick = { expanded = true }, enabled = enabled,
            modifier = Modifier.fillMaxWidth().testTag(tag), shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.heightIn(min = 50.dp).padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(label, Modifier.weight(.8f), fontSize = if (prominentLabel) 15.sp else 13.sp,
                    color = if (prominentLabel) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (logo != null) AgentLogo(logo, 18)
                Text(value, Modifier.weight(1.2f), fontSize = 15.sp, maxLines = 1,
                    textAlign = androidx.compose.ui.text.style.TextAlign.End,
                    overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else .4f))
                Glyph(R.drawable.ic_chevron_down, size = 14,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = if (enabled) 1f else .4f))
            }
        }
        ChoiceMenu(expanded, { expanded = false }, options, tag, agentIcons) { expanded = false; onSelect(it) }
    }
}

@Composable
private fun ChoiceMenu(expanded: Boolean, dismiss: () -> Unit, options: List<Pair<String, String>>,
    tag: String, agentIcons: Boolean, select: (String) -> Unit) {
    DropdownMenu(expanded = expanded, onDismissRequest = dismiss) {
        options.forEach { (id, title) ->
            DropdownMenuItem(text = { Text(title) }, onClick = { select(id) },
                modifier = Modifier.testTag("$tag-option-$id"),
                leadingIcon = if (agentIcons && id in listOf("claude", "codex", "deepseek", "pi", "dudu")) { { AgentLogo(id, 20) } } else null)
        }
    }
}

@Composable
private fun RenameIssue(panel: Panel.Rename, state: UiState, model: DuduViewModel) {
    var title by remember(panel.issue.id) { mutableStateOf(panel.issue.title) }
    AlertDialog(onDismissRequest = model::dismissPanel,
        title = { Text(w("重命名"), fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            DraftInput(title, stringResource(R.string.issue_title), !state.busy) { title = it.take(300) }
            state.problem?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
        } }, confirmButton = {
            TextButton(onClick = { model.updateIssue(panel.issue, json("title" to title.trim())) },
                enabled = title.isNotBlank() && !state.busy) { Text(stringResource(R.string.save)) }
        }, dismissButton = {
            TextButton(onClick = model::dismissPanel, enabled = !state.busy) { Text(stringResource(R.string.cancel)) }
        })
}

@Composable
private fun Quota(state: UiState) {
    val providers = state.quota?.optJSONArray("providers")?.objects().orEmpty()
    if (providers.isEmpty() && !state.busy) Text(stringResource(R.string.empty_quota))
    providers.forEach { provider ->
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AgentLogo(provider.nullableString("agent"))
            Text(provider.getString("name"), style = MaterialTheme.typography.titleMedium)
            provider.nullableString("plan")?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        provider.optJSONArray("windows")?.objects()?.forEach { window ->
            val used = window.getDouble("used").toFloat().coerceIn(0f, 1f)
            Row {
                Text(window.getString("label"), Modifier.weight(1f))
                Text("${(used * 100).toInt()}%")
            }
            LinearProgressIndicator(progress = { used }, modifier = Modifier.fillMaxWidth(),
                color = if (used >= .9) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
        }
        provider.optJSONArray("balance")?.objects()?.forEach { amount -> Text(amount.getString("text")) }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
fun priorityTitle(value: String) = stringResource(when (value) {
    "urgent" -> R.string.urgent
    "high" -> R.string.high
    "medium" -> R.string.medium
    "low" -> R.string.low
    else -> R.string.none
})

@Composable
fun statusTitle(value: Status): String = value.name ?: stringResource(when (value.type) {
    "backlog" -> R.string.workflow_backlog
    "todo" -> R.string.workflow_todo
    "in_progress" -> R.string.workflow_in_progress
    "in_review" -> R.string.workflow_in_review
    "done" -> R.string.workflow_done
    else -> R.string.workflow_canceled
})
