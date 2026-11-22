@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.launch
import org.json.JSONArray
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectTapGestures
import org.json.JSONObject

/** The + sheet. `canAddPhotos` / `canAddFiles` and `planEnabled` are the iPhone's `canAddPhotos`, `canAddVideos`/`canAddFiles` and `!isChangingPlanMode`. */
@Composable
fun ComposerMenu(session: Session, state: UiState, model: DuduViewModel, dismiss: () -> Unit, pick: (AttachmentKind) -> Unit,
    goal: () -> Unit, plan: () -> Unit, compact: () -> Unit, stop: () -> Unit,
    canAddPhotos: Boolean = true, canAddFiles: Boolean = true, planEnabled: Boolean = true) {
    var page by remember { mutableStateOf("root") }
    var configuring by remember { mutableStateOf(false) }
    val models = conversationModels(state.catalog, session.raw.optJSONObject("session")?.nullableString("agent"), state.isAssistant)
    val current = models
        .find { it.optString("id") == session.raw.optString("modelId") }
    val efforts = current?.rows("efforts").orEmpty()
    DuduSheet(dismiss, containerColor = androidx.compose.ui.graphics.Color(0xFFF4F4F4), canDismiss = !configuring) {
        BackHandler(page != "root") { if (!configuring) page = "root" }
        when (page) {
            "permissions" -> PermissionControls(session, state, model, dismiss, embedded = true, back = { page = "root" }, onBusyChange = { configuring = it })
            "models", "efforts" -> ModelControls(session, state, model, dismiss, embedded = true,
                combined = false, effortsOnly = page == "efforts", back = { page = "root" }, onBusyChange = { configuring = it })
            else -> {
        ComposerSheetHeader(w("添加"))
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(bottom = 8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(Triple(DuduGlyphs.image, w("照片"), AttachmentKind.Photos),
                    Triple(DuduGlyphs.video, w("发送视频"), AttachmentKind.Video),
                    Triple(DuduGlyphs.attach, w("文件"), AttachmentKind.File)).forEach { (icon, label, kind) ->
                    val enabled = !state.sending && if (kind == AttachmentKind.Photos) canAddPhotos else canAddFiles
                    Surface(onClick = { pick(kind) }, enabled = enabled,
                        shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface) {
                        Box(Modifier.size(80.dp), contentAlignment = Alignment.Center) {
                            Glyph(icon, label, size = 24, tint = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            if (!state.isAssistant) {
                Spacer(Modifier.height(30.5.dp))
                InsetCard(radius = 27) {
                    ComposerCommand(w("目标"), DuduGlyphs.goal, chevron = false, action = goal)
                    ComposerDivider()
                    ComposerCommand(if (session.raw.optBoolean("planMode")) w("退出计划模式") else w("计划"),
                        DuduGlyphs.plan, chevron = false, selected = session.raw.optBoolean("planMode"), enabled = planEnabled, action = plan)
                }
            }
            Text(w("指令"), Modifier.padding(start = 24.dp, top = 20.dp, bottom = 8.dp),
                fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            InsetCard(radius = 27) {
                ComposerCommand(w("压缩"), DuduGlyphs.compact, chevron = false, enabled = !session.processing, action = compact)
                ComposerDivider()
                ComposerCommand(w("权限"), DuduGlyphs.permission,
                    state.catalog.rows("permissions").find { it.optString("id") == session.raw.optString("permissionId") }
                        ?.let { permissionName(it.optString("id"), it.optString("name")) },
                    enabled = state.catalog.rows("permissions").isNotEmpty(), tag = "permission-controls") { page = "permissions" }
                ComposerDivider()
                ComposerCommand(w("模型"), DuduGlyphs.model, current?.optString("name"), enabled = models.isNotEmpty(),
                    tag = "model-controls") { page = "models" }
                if (efforts.isNotEmpty()) {
                    ComposerDivider()
                    ComposerCommand(w("推理等级"), DuduGlyphs.think, efforts.find {
                        it.optString("id") == session.raw.optString("reasoningEffort", current?.optString("defaultEffort").orEmpty())
                    }?.optString("name")) { page = "efforts" }
                }
                if (session.processing) {
                    ComposerDivider()
                    ComposerCommand(w("停止任务"), DuduGlyphs.stop, chevron = false, action = stop)
                }
            }
        }
            }
        }
    }
}

@Composable
private fun ComposerSheetHeader(title: String, back: (() -> Unit)? = null, enabled: Boolean = true) {
    Row(Modifier.fillMaxWidth().height(59.dp).padding(start = if (back == null) 40.dp else 24.dp),
        verticalAlignment = Alignment.CenterVertically) {
        if (back != null) TextButton(onClick = back, enabled = enabled) {
            Glyph(DuduGlyphs.back, w("返回"), 18, MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.width(6.dp))
            Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ComposerDivider() = HorizontalDivider(Modifier.padding(start = 51.dp, end = 17.dp), thickness = .5.dp)

@Composable
private fun ComposerCommand(title: String, icon: Int, value: String? = null, chevron: Boolean = true,
    selected: Boolean = false, enabled: Boolean = true, tag: String = "", action: () -> Unit) {
    Surface(onClick = action, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag(tag), color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.height(60.dp).padding(start = 15.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Glyph(icon, size = 24, tint = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            Text(title, Modifier.padding(start = 13.dp).weight(1f), fontSize = 17.sp,
                color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
            value?.let { Text(it, Modifier.widthIn(max = 130.dp), fontSize = 15.sp, maxLines = 1,
                overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (selected || chevron) {
                Spacer(Modifier.width(6.dp))
                Glyph(if (selected) DuduGlyphs.check else DuduGlyphs.right, size = if (selected) 20 else 16,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
fun PermissionControls(session: Session, state: UiState, model: DuduViewModel, dismiss: () -> Unit,
    embedded: Boolean = false, back: (() -> Unit)? = null, onBusyChange: (Boolean) -> Unit = {}) {
    val actions = rememberActions()
    DisposableEffect(actions.busy) { onBusyChange(actions.busy); onDispose { onBusyChange(false) } }
    var pending by remember { mutableStateOf<String?>(null) }
    fun configure(id: String) = actions.run {
        model.request("session.configure", json("id" to session.id, "permissionId" to id))
        dismiss()
    }
    val content: @Composable () -> Unit = {
        ComposerSheetHeader(w("权限"), back, enabled = !actions.busy)
        Form {
            InsetCard {
                state.catalog.rows("permissions").forEachIndexed { index, permission ->
                    Line(permissionName(permission.getString("id"), permission.getString("name")), enabled = !actions.busy, action = {
                        val id = permission.getString("id")
                        if (id != session.raw.optString("permissionId") && id in listOf("danger-full-access", "auto"))
                            pending = id
                        else configure(id)
                    }, trailing = {
                        if (permission.getString("id") == session.raw.optString("permissionId"))
                            Glyph(DuduGlyphs.check, size = 18)
                    })
                    if (index < state.catalog.rows("permissions").lastIndex)
                        HorizontalDivider(Modifier.padding(start = 16.dp), thickness = .5.dp)
                }
            }
            actions.error?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error) }
        }
    }
    if (embedded) content() else DuduSheet(dismiss, containerColor = androidx.compose.ui.graphics.Color(0xFFF4F4F4), canDismiss = !actions.busy) { content() }
    pending?.let { id ->
        val full = id == "danger-full-access"
        AlertDialog(onDismissRequest = { if (!actions.busy) pending = null },
            title = { Text(if (full) w("确认启用完全权限？") else w("确认启用自动审查（实验）？")) },
            text = { Text(if (full)
                w("启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。")
                else w("自动审查不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型进行审查；审查拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。")) },
            confirmButton = { TextButton(onClick = { configure(id) }, enabled = !actions.busy) {
                Text(if (full) w("启用完全权限") else w("启用自动审查"))
            } },
            dismissButton = { TextButton(onClick = { pending = null }, enabled = !actions.busy) { Text(w("取消")) } })
    }
}

@Composable
fun ModelControls(session: Session, state: UiState, model: DuduViewModel, dismiss: () -> Unit,
    embedded: Boolean = false, combined: Boolean = true, effortsOnly: Boolean = false, back: (() -> Unit)? = null,
    onBusyChange: (Boolean) -> Unit = {}) {
    val actions = rememberActions()
    DisposableEffect(actions.busy) { onBusyChange(actions.busy); onDispose { onBusyChange(false) } }
    var catalog by remember { mutableStateOf(state.catalog) }
    LaunchedEffect(actions.revision) { actions.run { catalog = model.request("catalog.get") } }
    val raw = session.raw
    val agent = raw.optJSONObject("session")?.nullableString("agent")
    val models = conversationModels(catalog, agent, state.isAssistant)
    val selected = raw.optString("modelId")
    val current = models.find { it.optString("id") == selected }
    fun configure(key: String, value: String) = actions.run {
        model.request("session.configure", json("id" to session.id, key to value))
        if (!combined) dismiss()
    }
    val content: @Composable () -> Unit = {
        ComposerSheetHeader(if (effortsOnly) w("推理等级") else w("模型"), back, enabled = !actions.busy)
        Form {
            if (!effortsOnly) {
            models.groupBy { it.optString("sourceName") }.forEach { (providerName, entries) ->
                if (models.groupBy { it.optString("sourceName") }.size > 1) Section(providerName)
                InsetCard {
                    entries.forEachIndexed { index, entry ->
                        Line(entry.getString("name"), enabled = !actions.busy,
                            tag = "conversation-model-option-${entry.getString("id")}",
                            action = { configure("modelId", entry.getString("id")) }, trailing = {
                                if (entry.getString("id") == selected) Glyph(DuduGlyphs.check, size = 18)
                            })
                        if (index < entries.lastIndex) HorizontalDivider(Modifier.padding(start = 16.dp), thickness = .5.dp)
                    }
                }
            }
            }
            val efforts = current?.rows("efforts").orEmpty()
            if ((combined || effortsOnly) && efforts.isNotEmpty()) {
                if (!effortsOnly) Section(w("推理等级"))
                InsetCard {
                    efforts.forEachIndexed { index, effort ->
                        Line(effort.getString("name"), enabled = !actions.busy,
                            action = { configure("reasoningEffort", effort.getString("id")) }, trailing = {
                                if (effort.getString("id") == raw.optString("reasoningEffort", current!!.optString("defaultEffort")))
                                    Glyph(DuduGlyphs.check, size = 18)
                            })
                        if (index < efforts.lastIndex) HorizontalDivider(Modifier.padding(start = 16.dp), thickness = .5.dp)
                    }
                }
            }
            if (actions.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            actions.error?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error) }
            Spacer(Modifier.height(20.dp))
        }
    }
    if (embedded) content() else DuduSheet(dismiss, containerColor = androidx.compose.ui.graphics.Color(0xFFF4F4F4), canDismiss = !actions.busy) { content() }
}

/**
 * The model's plan waiting for the owner, the iPhone's `PlanReviewCard` (`PlanReview.swift`): an amber band (a dot, or a spinner while it answers; 计划待审; 查看全文 › when there is a plan
 * to read), the title in 17 sp semibold and the plan as plain text in three lines at most, then 要求修改 and 同意执行. 要求修改 declines and puts the caret in the box for what to change; a failure
 * is said in a toast.
 */
@Composable
fun Approval(approval: JSONObject, sessionId: String, model: DuduViewModel, openFull: () -> Unit, revise: () -> Unit) {
    var responding by remember { mutableStateOf(false) }
    var complete by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    val coroutine = rememberCoroutineScope()
    FailureToast(failure, model) { failure = null }
    if (complete) return
    val warning = Color(0xFFF59E0B)
    val divider = chatDivider()
    val ink = chatInk()
    val detail = approval.nullableString("detail")
    val summary = remember(detail) { planSummary(detail) }
    fun respond(allow: Boolean) {
        if (responding) return
        responding = true
        DuduLog.record(if (allow) "approval.allow" else "approval.deny")
        coroutine.launch {
            try {
                val accepted = model.value("approval.respond", json("sessionId" to sessionId, "id" to approval.getString("id"),
                    "decision" to if (allow) "allow" else "deny"))
                if (accepted != true) throw ApiFailure("STALE_APPROVAL")
                complete = true
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("approval.respond.fail", error, state = if (allow) "allow" else "deny")
                failure = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
            } finally { responding = false }
            // The iPhone asks for the change whatever the answer was: the box is where it is written.
            if (!allow) revise()
        }
    }
    val card = RoundedCornerShape(20.dp)
    val button = RoundedCornerShape(14.dp)
    Column(Modifier.fillMaxWidth().alpha(if (responding) .7f else 1f).clip(card).background(MaterialTheme.colorScheme.surface)
        .border(.5.dp, divider, card).testTag("plan-review")) {
        Row(Modifier.fillMaxWidth().background(warning.copy(alpha = .11f)).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (responding) CircularProgressIndicator(Modifier.size(10.dp), strokeWidth = 1.5.dp, color = chatSecondary())
            else Box(Modifier.size(8.dp).background(warning, CircleShape))
            Text(w("计划待审"), Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = warning)
            if (!detail.isNullOrEmpty()) Row(Modifier.heightIn(min = 32.dp).clickable(role = Role.Button, onClick = openFull).testTag("plan-full"),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(w("查看全文"), fontSize = 15.sp, color = chatSecondary())
                Glyph(DuduGlyphs.right, size = 14, tint = chatSecondary())
            }
        }
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(approval.optString("title"), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = ink)
            if (summary.isNotEmpty()) Text(summary, fontSize = 15.sp, lineHeight = 21.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
                color = chatTertiary())
        }
        Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End)) {
            Box(Modifier.height(44.dp).clip(button).border(1.dp, divider, button)
                .clickable(enabled = !responding, role = Role.Button) { respond(false) }.padding(horizontal = 20.dp).testTag("plan-revise"),
                contentAlignment = Alignment.Center) {
                Text(w("要求修改"), fontSize = 16.sp, fontWeight = FontWeight.Medium, color = ink)
            }
            Box(Modifier.height(44.dp).clip(button).background(ink)
                .clickable(enabled = !responding, role = Role.Button) { respond(true) }.padding(horizontal = 22.dp).testTag("plan-approve"),
                contentAlignment = Alignment.Center) {
                Text(w("同意执行"), fontSize = 16.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.surface)
            }
        }
    }
}

/** The plan's body as two plain lines for the card: its lines without the markdown marks (#, **, `), joined (the iPhone's `PlanReviewCard.summary`). */
private fun planSummary(detail: String?): String = detail.orEmpty().lines()
    .map { it.trim().trimStart('#').replace("**", "").replace("`", "").trim() }
    .filter { it.isNotEmpty() }.joinToString(" ")

/** The whole plan, opened from 查看全文 (the iPhone's `PlanFullSheet`): 计划 in grey on the left and 完成 on the right of a 64 dp bar, then the title in 20 sp and the plan as Markdown. */
@Composable
fun PlanFullSheet(approval: JSONObject, close: () -> Unit) {
    DuduSheet(close, containerColor = Color(0xFFF4F4F4)) {
        Row(Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 28.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(w("计划"), Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF666666))
            Box(Modifier.heightIn(min = 44.dp).clickable(role = Role.Button, onClick = close).testTag("plan-full-close"),
                contentAlignment = Alignment.Center) {
                Text(w("完成"), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
            }
        }
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 24.dp, end = 24.dp, bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(approval.optString("title"), fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = chatInk())
            approval.nullableString("detail")?.let { Markdown(it) }
        }
    }
}

/**
 * A card of 嘟嘟's thread (待办, 收件箱, 任务), the iPhone's `QuickCardView`. In 嘟嘟's conversation a press and hold opens the menu of the thread at the finger (`seq`: the card's line), which for a card
 * is 删除 alone (it has no words to copy and no issue to answer), also over its todo rows, whose own taps open them; 删除 hides the line, as on the iPhone.
 */
@Composable
fun QuickCard(card: JSONObject, state: UiState, model: DuduViewModel, actions: Actions? = null, seq: Long? = null) {
    val kind = card.optString("kind")
    val title = when (kind) { "todo" -> w("待办"); "info" -> w("收件箱"); "task" -> w("任务"); else -> w("额度") }
    var expanded by remember { mutableStateOf<Long?>(null) }
    val rows = card.rows("rows")
    val sessionId = state.session?.id
    val hides = state.isAssistant && seq != null && sessionId != null && actions != null
    var menu by remember { mutableStateOf(false) }
    val press = remember { PressPoint() }
    val onLongClick: (() -> Unit)? = if (hides) { { menu = true } } else null
    Box(Modifier.notePress(press)) {
    if (hides) DropdownMenu(menu, { menu = false }, offset = press.menuOffset()) {
        val danger = MaterialTheme.colorScheme.error
        DropdownMenuItem(text = { Text(w("删除"), color = danger) }, leadingIcon = { InboxGlyph(DuduGlyphs.trash, 18, danger) },
            modifier = Modifier.testTag("quick-card-delete"), onClick = { menu = false; actions?.run {
                model.request("assistant.hide", json("sessionId" to sessionId, "seqs" to JSONArray(listOf(seq))))
            } })
    }
    Surface(Modifier.fillMaxWidth().then(if (onLongClick == null) Modifier else
        Modifier.pointerInput(Unit) { detectTapGestures(onLongPress = { onLongClick() }) }),
        shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(.75.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = .08f))) {
        Column {
        Row(Modifier.fillMaxWidth().height(46.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Glyph(when (kind) { "todo" -> DuduGlyphs.listTodo; "info" -> DuduGlyphs.inbox; "task" -> DuduGlyphs.schedule; else -> DuduGlyphs.quota },
                size = 18, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            if (rows.isNotEmpty()) Text(card.optInt("total", rows.size).toString(), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            else {
                Spacer(Modifier.weight(1f))
                Text(when (kind) { "todo" -> w("没有事项"); "info" -> w("没有信息"); "task" -> w("没有任务"); else -> "—" },
                    fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (rows.isNotEmpty()) HorizontalDivider(thickness = .5.dp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = .06f))
        Column((if (kind in listOf("info", "task")) Modifier.heightIn(max = 349.dp).verticalScroll(rememberScrollState()) else Modifier)
            .padding(bottom = if (rows.isEmpty()) 0.dp else 4.dp)) {
        rows.forEachIndexed { index, row ->
            if (kind == "todo") {
                val id = row.getLong("id")
                // A hairline between the todo rows, 14 dp from both sides (the iPhone's `QuickTodoSeparator`).
                if (index > 0) HorizontalDivider(Modifier.padding(horizontal = 14.dp), thickness = .5.dp,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = .06f))
                QuickTodoIssueRow(row, state, model, expanded == id, { expanded = if (expanded == id) null else id }, onLongClick = onLongClick)
            } else if (kind == "info") CollectorSummary(row)
            else if (kind == "task") TaskSummary(row)
            else if (kind == "quota") {
                Line(row.optString("name"), row.nullableString("plan"), trailing = { AgentLogo(row.nullableString("agent")) })
                row.rows("windows").forEach { window ->
                    Text("${window.optString("label")}  ${(window.optDouble("used") * 100).toInt()}%", Modifier.padding(horizontal = 16.dp))
                }
            }
        }
        }
        }
    }
    }
}

