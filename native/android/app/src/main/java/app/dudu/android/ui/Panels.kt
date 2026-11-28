@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
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
    var optionsFailed by remember(state.panel == Panel.Create) { mutableStateOf(false) }
    var optionsRetry by remember { mutableIntStateOf(0) }
    var createFailed by remember(state.panel == Panel.Create) { mutableStateOf(false) }
    val createLabel = stringResource(R.string.create)
    when (val panel = state.panel) {
        null -> Unit
        Panel.Quota -> QuotaSheet(state, model::dismissPanel)
        is Panel.Actions -> IssueContextMenu(panel, state, model)
        is Panel.EditIssue -> key(panel.issue.id, panel.property) { IssuePropertySheet(panel, state, model) }
        is Panel.Rename -> RenameIssue(panel, state, model)
        is Panel.Delete -> DuduConfirmation(
            stringResource(R.string.delete_title, panel.issue.ref ?: "#${panel.issue.id}", panel.issue.title),
            stringResource(R.string.delete_body), !state.busy,
            model::dismissPanel, model::confirmDelete, error = state.problem?.let { problemText(it) },
            tag = "confirm-delete")
        else -> {
            if (panel == Panel.Create) LaunchedEffect(state.computerId, state.connected, optionsRetry) {
                // The form's choices (statuses, projects, labels), read without holding the form: only a failure says so, under the values (the iPhone's `loadOptions`).
                if (!state.connected) return@LaunchedEffect
                optionsFailed = false
                try { model.receiveIssueOptions(model.issueOptions()) }
                catch (error: Exception) {
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    DuduLog.failure("issue.options.fail", error)
                    optionsFailed = true
                }
            }
            DuduSheet(model::dismissPanel, canDismiss = !state.busy && !pickerBusy, showsConnectionToast = panel == Panel.Computers,
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
                        val canCreate = state.draft.valid && state.draft.status != null && state.options != null && state.connected && !state.busy
                        FormSheetBar(stringResource(R.string.new_issue), model::dismissPanel, cancelEnabled = !state.busy,
                            action = DuduGlyphs.check, actionLabel = createLabel, actionEnabled = canCreate, busy = state.busy, actionTag = "create-issue") {
                            createFailed = false; model.createIssue { createFailed = true }
                        }
                    } else SheetHeader(when (panel) {
                        Panel.Computers -> stringResource(R.string.computers)
                        Panel.Quota -> stringResource(R.string.quota)
                        else -> ""
                    }, model::dismissPanel, !state.busy && !state.connectionInFlight, action = if (panel == Panel.Computers) { {
                        AddComputerButton(model, enabled = !state.connectionInFlight)
                    } } else null)
                    Column(Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        when (panel) {
                            Panel.Computers -> ComputerList(state, model)
                            Panel.Create -> IssueForm(state, model, optionsFailed, { optionsFailed = false; optionsRetry++ }, createFailed) { creationPicker = it }
                            else -> Unit
                        }
                        Spacer(Modifier.height(12.dp))
                    }
                    }
                }
            }
        }
    }
}

/**
 * The new-issue form, the iPhone's `NewIssueSheet`: the parent (when there is one) as a chip with its reference and an ×, the title (focused at once) and the description, the pictures,
 * then the values as the composer's pills. `optionsFailed` says 事项没能加载 with 重试 (`retryOptions`) under them; `createFailed` says 事项没能创建.
 */
@Composable
private fun IssueForm(state: UiState, model: DuduViewModel, optionsFailed: Boolean, retryOptions: () -> Unit, createFailed: Boolean,
    choose: (IssuePicker) -> Unit) {
    val draft = state.draft
    val options = state.options
    val context = LocalContext.current
    val photos = rememberActions()
    var photoComputer by remember { mutableStateOf("") }
    var parentIssue by remember(draft.parent) { mutableStateOf<Issue?>(null) }
    LaunchedEffect(draft.parent) {
        val parent = draft.parent ?: return@LaunchedEffect
        runCatching { model.request("issue.get", json("id" to parent)).getJSONObject("issue") }.getOrNull()?.let {
            val issue = Issue.parse(it)
            parentIssue = issue
            if (model.state.value.draft.project?.path.isNullOrBlank()) {
                val project = issue.project
                if (project != null) model.editDraft(model.state.value.draft.copy(project = project))
            }
        }
    }
    // The system photo picker, as the iPhone's photo library (`photosPicker`, as many as the issue still takes).
    val picker = rememberPhotoLibrary(PHOTO_LIMIT - draft.photos.size) { uris ->
        photos.run {
            if (model.state.value.computerId != photoComputer || model.state.value.panel != Panel.Create) return@run
            model.editDraft(model.state.value.draft.copy(preparingPhotos = true))
            try {
            var added = 0
            for (uri in uris) {
                val current = model.state.value
                if (current.computerId != photoComputer || current.panel != Panel.Create) return@run
                if (current.draft.photos.size >= 9) break
                // A picture that cannot be read is skipped; the rest are added (the iPhone's 部分照片未添加).
                val file = try {
                    withContext(Dispatchers.IO) {
                        json("name" to "${java.util.UUID.randomUUID()}.jpg", "mimeType" to "image/jpeg",
                            "dataBase64" to android.util.Base64.encodeToString(
                                preparePhoto(context.contentResolver, uri), android.util.Base64.NO_WRAP))
                    }
                } catch (error: Exception) {
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    DuduLog.failure("newissue.photo.fail", error)
                    continue
                }
                val latest = model.state.value
                if (latest.computerId != photoComputer || latest.panel != Panel.Create) return@run
                model.editDraft(latest.draft.copy(photos = latest.draft.photos + file))
                added++
            }
            if (added < uris.size) model.toast(word("部分照片未添加"), ToastKind.Warning)
            } finally {
                val latest = model.state.value
                if (latest.computerId == photoComputer && latest.panel == Panel.Create)
                    model.editDraft(latest.draft.copy(preparingPhotos = false))
            }
        }
    }
    if (draft.parent != null) ParentChip(parentIssue, !state.busy, open = { choose(IssuePicker.Parent) }) {
        model.editDraft(draft.copy(parent = null))
    }
    val titleFocus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { titleFocus.requestFocus() } }
    NewIssueField(draft.title, stringResource(R.string.issue_title), !state.busy, title = true,
        modifier = Modifier.focusRequester(titleFocus).testTag("issue-title")) {
        model.editDraft(draft.copy(title = it.take(300)))
    }
    NewIssueField(draft.description, stringResource(R.string.description), !state.busy, title = false) {
        model.editDraft(draft.copy(description = it.take(20000)))
    }
    if (draft.photos.isNotEmpty()) AttachmentTiles(draft.photos, !state.busy,
        add = if (draft.photos.size < PHOTO_LIMIT) ({ photoComputer = state.computerId; picker() }) else null) { index ->
        model.editDraft(draft.copy(photos = draft.photos.filterIndexed { i, _ -> i != index }))
    }
    if (photos.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    photos.error?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error) }
    // The buttons are buttons while the computer's choices load (owner, 2026-11-17: "按钮不就是按钮吗"); only the ones that list them wait for them.
    val usable = !state.busy && state.connected
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        val status = options?.statuses?.find { it.id == draft.status }
        IssueChip(status?.let { statusTitle(it) } ?: stringResource(R.string.status), usable && options != null, "status-picker",
            { IssueStatusMark(status ?: Status("", null, "todo", false)) }) { choose(IssuePicker.Status) }
        IssueChip(if (draft.priority == "none") stringResource(R.string.priority) else priorityTitle(draft.priority),
            usable, "priority-picker", { IssuePriorityMark(draft.priority) }) { choose(IssuePicker.Priority) }
        IssueChip(draft.project?.name ?: stringResource(R.string.project), usable && options != null, "project-picker",
            { Glyph(DuduGlyphs.issueProject, size = 16, tint = LocalContentColor.current) }) { choose(IssuePicker.Project) }
        if (!draft.project?.path.isNullOrBlank()) IssueChip(draft.agent?.let(::agentName) ?: stringResource(R.string.agent),
            usable, "agent-picker", { if (draft.agent == null) Glyph(DuduGlyphs.stateUnassigned, size = 16, tint = LocalContentColor.current)
                else AgentLogo(draft.agent, 16) }) { choose(IssuePicker.Agent) }
        IssueChip(options?.labels.orEmpty().filter { it.id in draft.labels }.joinToString { it.name }.ifEmpty { w("标签") },
            usable && options != null, "labels-picker", { Glyph(DuduGlyphs.issueLabel, size = 16, tint = LocalContentColor.current) }) { choose(IssuePicker.Labels) }
        if (draft.dueAt != null) IssueChip(monthDay(draft.dueAt), usable, "due-picker",
            { Glyph(DuduGlyphs.dueDate, size = 16, tint = LocalContentColor.current) }) { choose(IssuePicker.Due) }
        var more by remember { mutableStateOf(false) }
        Box {
            IssueChip(stringResource(R.string.more), usable, "more-picker",
                { Glyph(DuduGlyphs.options, stringResource(R.string.more), 16, LocalContentColor.current) }, iconOnly = true) { more = true }
            DropdownMenu(more, { more = false }) {
                DropdownMenuItem(text = { Text(w("截止日期")) }, leadingIcon = { MenuInkGlyph(DuduGlyphs.dueDate) },
                    onClick = { more = false; choose(IssuePicker.Due) })
                DropdownMenuItem(text = { Text(w("设置父事项…")) }, leadingIcon = { MenuInkGlyph(DuduGlyphs.open) },
                    onClick = { more = false; choose(IssuePicker.Parent) })
                if (options?.attachments == true) DropdownMenuItem(text = { Text(w("添加图片")) },
                    leadingIcon = { MenuInkGlyph(DuduGlyphs.plus) }, enabled = draft.photos.size < 9 && !photos.busy,
                    onClick = { more = false; photoComputer = state.computerId; picker() })
            }
        }
    }
    if (optionsFailed) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(w("事项没能加载"), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(stringResource(R.string.retry), Modifier.clickable(onClick = retryOptions).padding(vertical = 8.dp),
            fontSize = 14.sp, color = DuduStyle.blue)
    }
    if (createFailed) Text(w("事项没能创建"), Modifier.testTag("panel-error"), fontSize = 13.sp, color = Color(0xFFEC1313))
}

/** An issue's parent at the top of the form (the iPhone's `parentChip`): the arrow, its reference in grey and its title, which open the parent picker, and an × that takes it away. */
@Composable
private fun ParentChip(parent: Issue?, enabled: Boolean, open: () -> Unit, remove: () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    CompositionLocalProvider(LocalContentColor provides chatSecondary()) {
        Row(Modifier.clip(shape).background(chatPanel(), shape).border(.5.dp, chatBorder(), shape),
            verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f, fill = false).heightIn(min = 44.dp).clickable(enabled = enabled, onClick = open).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Glyph(DuduGlyphs.open, size = 16, tint = LocalContentColor.current)
                parent?.ref?.let { Text(it, fontSize = 14.sp, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text(parent?.title.orEmpty(), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box(Modifier.size(44.dp).clickable(enabled = enabled, onClick = remove), contentAlignment = Alignment.Center) {
                Glyph(DuduGlyphs.close, w("移除父事项"), 16, LocalContentColor.current)
            }
        }
    }
}

/**
 * The bar of a form that is a sheet, the iPhone's: ✕ on the left (named 取消), the title in the middle, and a round button on the right that turns into a spinner while the form goes (owner,
 * 2026-11-21: ✕ / ✓ instead of repeating 创建事项). It is blue with a white glyph when `actionEnabled`, grey otherwise.
 */
@Composable
private fun FormSheetBar(title: String, cancel: () -> Unit, cancelEnabled: Boolean, action: Int, actionLabel: String, actionEnabled: Boolean,
    busy: Boolean, actionTag: String, perform: () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = cancel, enabled = cancelEnabled, modifier = Modifier.testTag("close-sheet")) {
            BarGlyph(DuduGlyphs.close, stringResource(R.string.cancel))
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        }
        Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
            if (busy) RowSpinner(18)
            else Box(Modifier.size(32.dp).clip(CircleShape)
                .background(if (actionEnabled) DuduStyle.blue else MaterialTheme.colorScheme.surfaceContainerHigh)
                .clickable(enabled = actionEnabled, onClick = perform)
                .semantics { contentDescription = actionLabel; role = Role.Button }.testTag(actionTag),
                contentAlignment = Alignment.Center) {
                Glyph(action, null, 16, if (actionEnabled) Color.White else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** The title and description fields use the same text sizes and line limits as the iPhone. */
@Composable
private fun NewIssueField(value: String, placeholder: String, enabled: Boolean, title: Boolean, modifier: Modifier = Modifier,
    changed: (String) -> Unit) {
    val style = MaterialTheme.typography.bodyLarge.copy(fontSize = if (title) 17.sp else 16.sp,
        fontWeight = if (title) FontWeight.SemiBold else FontWeight.Normal)
    BasicTextField(value, changed, modifier.fillMaxWidth(), enabled = enabled,
        textStyle = style.copy(color = MaterialTheme.colorScheme.onSurface),
        minLines = if (title) 1 else 4, maxLines = if (title) 4 else 8, cursorBrush = SolidColor(DuduStyle.blue),
        decorationBox = { inner ->
            Box(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(16.dp))
                .padding(horizontal = 16.dp, vertical = if (title) 12.dp else 16.dp)) {
                if (value.isEmpty()) Text(placeholder, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
                inner()
            }
        })
}

/** A date as month and day, the iPhone's `.dateTime.month().day()` (the year is not shown). */
@Composable
internal fun monthDay(at: Long): String {
    val locale = appLocale()
    return java.text.SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMd"), locale).format(java.util.Date(at))
}

/**
 * A value of a form as the composer's pill, the iPhone's `ContextChipLabel`: 32 dp high (in a 44 dp place to tap), filled with the chat's panel grey under a hairline, its icon and its
 * words (14 sp medium, at most 220 dp) in the chat's secondary grey; `iconOnly` keeps only the icon. The new-issue form and the task form use it, as the iPhone's do.
 */
@Composable
internal fun IssueChip(title: String, enabled: Boolean, tag: String = "", icon: @Composable () -> Unit, iconOnly: Boolean = false,
    click: () -> Unit) {
    val shape = RoundedCornerShape(50)
    Box(Modifier.heightIn(min = 44.dp).alpha(if (enabled) 1f else .45f)
        .clickable(enabled = enabled, interactionSource = remember { MutableInteractionSource() }, indication = null, role = Role.Button, onClick = click)
        .semantics { if (iconOnly) contentDescription = title }.testTag(tag), contentAlignment = Alignment.Center) {
        CompositionLocalProvider(LocalContentColor provides chatSecondary()) {
            Row(Modifier.height(32.dp).clip(shape).background(chatPanel(), shape).border(.5.dp, chatBorder(), shape)
                .padding(horizontal = if (iconOnly) 8.dp else 11.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                icon()
                if (!iconOnly) Text(title, Modifier.widthIn(max = 220.dp), fontSize = 14.sp, fontWeight = FontWeight.Medium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
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
                Glyph(DuduGlyphs.down, size = 14,
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
                leadingIcon = if (agentIcons && (id == "dudu" || id in agentMarks)) { { AgentLogo(id, 20) } } else null)
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
        } }, confirmButton = {
            // The dialog closes at once, as the iPhone's alert does; a refusal says 更改没能保存 in a toast (`DuduViewModel.rename`).
            TextButton(onClick = { model.rename(panel.issue, title) },
                enabled = title.isNotBlank() && state.connected && !state.busy) { Text(stringResource(R.string.save)) }
        }, dismissButton = {
            TextButton(onClick = model::dismissPanel, enabled = !state.busy) { Text(stringResource(R.string.cancel)) }
        })
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
