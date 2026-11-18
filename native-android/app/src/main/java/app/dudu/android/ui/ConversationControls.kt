@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
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
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun ComposerMenu(session: Session, state: UiState, model: DuduViewModel, dismiss: () -> Unit, pick: (Array<String>) -> Unit,
    goal: () -> Unit, plan: () -> Unit, compact: () -> Unit, stop: () -> Unit) {
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
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).padding(top = 8.dp, bottom = 8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(Triple(R.drawable.ic_image, w("照片"), "image/*"),
                    Triple(R.drawable.ic_film, w("发送视频"), "video/*"),
                    Triple(R.drawable.ic_paperclip, w("文件"), "*/*")).forEach { (icon, label, type) ->
                    Surface(onClick = { pick(arrayOf(type)) }, enabled = !state.sending,
                        shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surface) {
                        Box(Modifier.size(80.dp), contentAlignment = Alignment.Center) { Glyph(icon, label, size = 24) }
                    }
                }
            }
            if (!state.isAssistant) {
                Spacer(Modifier.height(30.5.dp))
                InsetCard(radius = 27) {
                    ComposerCommand(w("目标"), R.drawable.ic_goal, chevron = false, action = goal)
                    ComposerDivider()
                    ComposerCommand(if (session.raw.optBoolean("planMode")) w("退出计划模式") else w("计划"),
                        R.drawable.ic_clipboard_list, chevron = false, selected = session.raw.optBoolean("planMode"), action = plan)
                }
            }
            Text(w("指令"), Modifier.padding(start = 24.dp, top = 20.dp, bottom = 8.dp),
                fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            InsetCard(radius = 27) {
                ComposerCommand(w("压缩"), R.drawable.ic_fold_vertical, chevron = false, enabled = !session.processing, action = compact)
                ComposerDivider()
                ComposerCommand(w("权限"), R.drawable.ic_shield_check,
                    state.catalog.rows("permissions").find { it.optString("id") == session.raw.optString("permissionId") }?.optString("name"),
                    enabled = state.catalog.rows("permissions").isNotEmpty(), tag = "permission-controls") { page = "permissions" }
                ComposerDivider()
                ComposerCommand(w("模型"), R.drawable.ic_bot, current?.optString("name"), enabled = models.isNotEmpty(),
                    tag = "model-controls") { page = "models" }
                if (efforts.isNotEmpty()) {
                    ComposerDivider()
                    ComposerCommand(w("推理等级"), R.drawable.ic_brain, efforts.find {
                        it.optString("id") == session.raw.optString("reasoningEffort", current?.optString("defaultEffort").orEmpty())
                    }?.optString("name")) { page = "efforts" }
                }
                if (session.processing) {
                    ComposerDivider()
                    ComposerCommand(w("停止任务"), R.drawable.ic_circle_stop, chevron = false, action = stop)
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
            Glyph(R.drawable.ic_arrow_left, w("返回"), 18, MaterialTheme.colorScheme.onSurfaceVariant)
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
                Glyph(if (selected) R.drawable.ic_check else R.drawable.ic_chevron_right, size = if (selected) 20 else 16,
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
                    Line(permission.getString("name"), enabled = !actions.busy, action = {
                        val id = permission.getString("id")
                        if (id != session.raw.optString("permissionId") && id in listOf("danger-full-access", "auto"))
                            pending = id
                        else configure(id)
                    }, trailing = {
                        if (permission.getString("id") == session.raw.optString("permissionId"))
                            Glyph(R.drawable.ic_check, size = 18)
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
                                if (entry.getString("id") == selected) Glyph(R.drawable.ic_check, size = 18)
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
                                    Glyph(R.drawable.ic_check, size = 18)
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

@Composable
fun Questions(batch: JSONObject, sessionId: String, model: DuduViewModel) {
    val actions = rememberActions()
    val selected = remember(batch.getString("id")) { mutableStateMapOf<String, Set<String>>() }
    val custom = remember(batch.getString("id")) { mutableStateMapOf<String, String>() }
    var expanded by remember { mutableStateOf(true) }
    var completed by remember { mutableStateOf(false) }
    if (completed) return
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(0.dp)) {
                Glyph(R.drawable.ic_circle_help, size = 18); Spacer(Modifier.width(8.dp))
                Text(w("等待你的操作")); Spacer(Modifier.weight(1f))
                Glyph(if (expanded) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down, size = 16)
            }
            if (expanded) {
                batch.rows("questions").forEach { question ->
                    val id = question.getString("id")
                    Text(question.optString("question"), style = MaterialTheme.typography.titleMedium)
                    question.nullableString("detail")?.let { Markdown(it, compact = true) }
                    question.rows("options").forEach { option ->
                        val label = option.getString("label")
                        Surface(onClick = {
                            val old = selected[id].orEmpty()
                            selected[id] = if (label in old) old - label else if (question.optBoolean("multiSelect")) old + label else setOf(label)
                            if (!question.optBoolean("multiSelect")) custom[id] = ""
                        }, enabled = !actions.busy, shape = MaterialTheme.shapes.medium,
                            color = if (label in selected[id].orEmpty()) MaterialTheme.colorScheme.secondaryContainer
                                else MaterialTheme.colorScheme.surfaceContainer) {
                            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                if (question.optBoolean("multiSelect")) Checkbox(label in selected[id].orEmpty(), null)
                                else RadioButton(label in selected[id].orEmpty(), null)
                                Column(Modifier.padding(start = 8.dp)) {
                                    Text(label); option.nullableString("description")?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                                }
                            }
                        }
                    }
                    Field(w("输入你的答案"), custom[id].orEmpty(), !actions.busy, multi = true) {
                        custom[id] = it; if (!question.optBoolean("multiSelect")) selected[id] = emptySet()
                    }
                }
                actions.error?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error) }
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    TextButton(onClick = { actions.run {
                        val accepted = model.value("question.answer", json("id" to sessionId, "callId" to batch.getString("id"),
                            "answers" to JSONArray(batch.rows("questions").map { json("id" to it.getString("id"), "selected" to JSONArray()) })))
                        if (accepted != true) throw ApiFailure("STALE_APPROVAL")
                        completed = true
                    } }, enabled = !actions.busy) { Text(w("跳过")) }
                    Button(onClick = { actions.run {
                        val accepted = model.value("question.answer", json("id" to sessionId, "callId" to batch.getString("id"),
                            "answers" to JSONArray(batch.rows("questions").map { question ->
                                val id = question.getString("id")
                                json("id" to id, "selected" to JSONArray(question.rows("options").map { it.getString("label") }
                                    .filter { it in selected[id].orEmpty() })).apply {
                                    custom[id]?.trim()?.takeIf(String::isNotEmpty)?.let { put("custom", it) }
                                }
                            })))
                        if (accepted != true) throw ApiFailure("STALE_APPROVAL")
                        completed = true
                    } }, enabled = !actions.busy && batch.rows("questions").all {
                        selected[it.getString("id")].orEmpty().isNotEmpty() || custom[it.getString("id")].orEmpty().isNotBlank()
                    }) { Text(w("提交")) }
                }
            }
        }
    }
}

@Composable
fun Approval(approval: JSONObject, sessionId: String, model: DuduViewModel) {
    val actions = rememberActions()
    var complete by remember { mutableStateOf(false) }
    if (complete) return
    OutlinedCard {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(approval.optString("title"), style = MaterialTheme.typography.titleMedium)
            approval.nullableString("detail")?.let { Markdown(it) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                listOf("deny", "allow").forEach { decision ->
                    TextButton(onClick = { actions.run {
                        val accepted = model.value("approval.respond", json("sessionId" to sessionId, "id" to approval.getString("id"), "decision" to decision))
                        if (accepted != true) throw ApiFailure("STALE_APPROVAL")
                        complete = true
                    } }, enabled = !actions.busy) { Text(if (decision == "allow") w("允许") else w("拒绝")) }
                }
            }
            actions.error?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error) }
        }
    }
}

@Composable
fun QuickCard(card: JSONObject, state: UiState, model: DuduViewModel) {
    val kind = card.optString("kind")
    val title = when (kind) { "todo" -> w("待办"); "info" -> w("收件箱"); "task" -> w("任务"); else -> w("额度") }
    var expanded by remember { mutableStateOf<Long?>(null) }
    val rows = card.rows("rows")
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface,
        border = androidx.compose.foundation.BorderStroke(.75.dp, MaterialTheme.colorScheme.onSurface.copy(alpha = .08f))) {
        Column {
        Row(Modifier.fillMaxWidth().height(46.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Glyph(when (kind) { "todo" -> R.drawable.ic_list_todo; "info" -> R.drawable.ic_inbox; "task" -> R.drawable.ic_clock; else -> R.drawable.ic_gauge },
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
        rows.forEach { row ->
            if (kind == "todo") {
                val id = row.getLong("id")
                QuickTodoIssueRow(row, state, model, expanded == id, { expanded = if (expanded == id) null else id })
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

@Composable
fun GroupMessage(group: JSONObject, state: UiState, model: DuduViewModel, actions: Actions) {
    if (group.optString("kind") == "end") return
    val issue = group.optJSONObject("issue")
    val task = group.optJSONObject("task")
    issue?.let {
        TextButton(onClick = { model.navigate(Route("issue", it.optString("title"), it.getLong("id").toString())) }) {
            AgentLogo(it.nullableString("agent"), 18); Spacer(Modifier.width(8.dp))
            Text("${it.nullableString("ref") ?: "#${it.optLong("id")}"} · ${it.optString("title")}")
        }
    }
    task?.let { Line(it.optString("title"), action = { model.navigate(Route("task", it.optString("title"), it.getString("id"))) }) }
    Markdown(group.optString("text"))
    group.optJSONObject("liveReply")?.let { Markdown(it.optString("text")) }
    if (issue != null) TextButton(onClick = {
        model.editMessage("@${issue.nullableString("ref") ?: issue.getLong("id")} ")
    }) { Text(w("回复")) }
}
