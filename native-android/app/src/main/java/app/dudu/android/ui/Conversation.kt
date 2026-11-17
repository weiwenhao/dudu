@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.dudu.android.ui

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

@Composable
fun ConversationPage(state: UiState, model: DuduViewModel) {
    val list = rememberLazyListState()
    val coroutine = rememberCoroutineScope()
    val session = state.session
    val actions = rememberActions()
    var menu by remember { mutableStateOf(false) }
    var controls by remember { mutableStateOf(false) }
    var permissions by remember { mutableStateOf(false) }
    var attachmentMenu by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var queueEditing by remember { mutableStateOf<Message?>(null) }
    var queueText by remember { mutableStateOf("") }
    var recipients by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var skills by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var showTodos by remember { mutableStateOf(false) }
    var quickSheet by remember { mutableStateOf<String?>(null) }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val locale = appLocale()
    val picker = rememberAttachmentPicker(state, model, actions)
    var voiceTarget by remember { mutableStateOf<Pair<String, String>?>(null) }
    val voice = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (voiceTarget == (state.computerId to state.session?.id) && result.resultCode == Activity.RESULT_OK) result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()?.let { model.editMessage((state.message + " " + it).trim()) }
        voiceTarget = null
    }
    val messages = session?.messages.orEmpty()
    val waiting = state.outbox.filterNot { it.failed || session?.observed(it.requestId) == true }.map { it.message() }
    val all = (messages + waiting).distinctBy { it.requestId ?: it.id }
    val hasOlder = session?.transcript?.optBoolean("hasMore") == true
    var following by remember(session?.id) { mutableStateOf(true) }
    val olderOffset = if (hasOlder) 1 else 0
    LaunchedEffect(list) {
        snapshotFlow {
            val info = list.layoutInfo
            val atBottom = info.totalItemsCount == 0 || (info.visibleItemsInfo.lastOrNull()?.let {
                it.index == info.totalItemsCount - 1 && it.offset + it.size <= info.viewportEndOffset
            } == true)
            list.isScrollInProgress to atBottom
        }.distinctUntilChanged().collect { (moving, atBottom) -> if (moving || atBottom) following = atBottom }
    }
    LaunchedEffect(session?.id, all.lastOrNull()?.id, all.lastOrNull()?.text) {
        if (following && all.isNotEmpty()) list.scrollToItem(all.lastIndex + olderOffset)
    }
    LaunchedEffect(session?.watchId, session?.readPosition?.toString(), state.panel, state.route, quickSheet, controls, permissions, attachmentMenu) {
        if (session == null || messages.isEmpty() || state.panel != null || state.route != null || session.cached ||
            quickSheet != null || controls || permissions || attachmentMenu) return@LaunchedEffect
        snapshotFlow {
            val last = list.layoutInfo.visibleItemsInfo.find { it.index == messages.lastIndex + olderOffset }
            last != null && last.offset + last.size <= list.layoutInfo.viewportEndOffset
        }.filter { it }.distinctUntilChanged().collect { model.acknowledge(session) }
    }
    LaunchedEffect(state.message, session?.id) {
        recipients = emptyList(); skills = emptyList()
        if (!state.isAssistant || session == null) return@LaunchedEffect
        val query = state.message
        if (query.startsWith("@") && !query.contains(' ') && query.length < 100) {
            delay(180)
            runCatching { model.request("assistant.recipients", json("sessionId" to session.id, "q" to query.drop(1))) }
                .onSuccess { recipients = it.rows("items") }
                .onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
        } else if (query.startsWith("/") && !query.contains(' ')) {
            runCatching { model.request("assistant.skills", json("sessionId" to session.id)) }.onSuccess {
                skills = it.rows("skills").filter { skill -> skill.optString("name").contains(query.drop(1), true) }
            }.onFailure { if (it is kotlinx.coroutines.CancellationException) throw it }
        }
    }
    fun perform(method: String, params: JSONObject = json()) = actions.run {
        val id = session?.id ?: return@run
        params.put("id", id)
        model.value(method, params)
    }
    fun runCommand(name: String, arg: String? = null, submitted: String? = null) = actions.run {
        val result = model.request("session.command", json("id" to session?.id, "command" to name).apply {
            arg?.takeIf { it.isNotBlank() }?.let { put("argument", it) }
        })
        notice = result.nullableString("text")
        if (result.optString("kind") == "error") actions.error = "UPSTREAM_ERROR"
        else {
            if (submitted != null && model.state.value.session?.watchId == session?.watchId &&
                model.state.value.message == submitted) model.editMessage("")
        }
    }
    Scaffold(
        modifier = Modifier.imePadding(),
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(state.conversationTitle ?: "", maxLines = 1, fontSize = 17.sp,
                    overflow = TextOverflow.Ellipsis, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                navigationIcon = {
                    IconButton(onClick = model::leaveConversation, modifier = Modifier.testTag("conversation-back")) {
                        Glyph(R.drawable.ic_arrow_left, stringResource(R.string.back))
                    }
                }, actions = {
                    Box {
                        IconButton(onClick = { menu = true }, enabled = session != null) { Glyph(R.drawable.ic_ellipsis, stringResource(R.string.more)) }
                        DropdownMenu(menu, { menu = false }) {
                            DropdownMenuItem(text = { Text(w("智能体团队")) }, leadingIcon = { Glyph(R.drawable.ic_users_round, size = 18) },
                                onClick = { menu = false; model.navigate(Route("activity", target = "team")) })
                            DropdownMenuItem(text = { Text(w("后台任务")) }, leadingIcon = { Glyph(R.drawable.ic_terminal, size = 18) },
                                onClick = { menu = false; model.navigate(Route("activity", target = "jobs")) })
                            DropdownMenuItem(text = { Text(w("定时任务")) }, leadingIcon = { Glyph(R.drawable.ic_clock, size = 18) },
                                onClick = { menu = false; model.navigate(Route("session-tasks")) })
                        }
                    }
                },
            )
        },
        bottomBar = {
            Column(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 24.dp).padding(top = 8.dp, bottom = 12.dp)) {
                if (session != null) {
                    session.raw.optJSONObject("goal")?.let { goal ->
                        var expanded by remember(goal.optString("id")) { mutableStateOf(false) }
                        Line(goal.optString("objective"), goal.nullableString("blocked"), icon = R.drawable.ic_list_todo,
                            action = { expanded = !expanded })
                        if (expanded) Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            TextButton(onClick = { runCommand("goal", if (goal.optString("phase") == "paused") "resume" else "pause") },
                                enabled = !actions.busy) { Text(if (goal.optString("phase") == "paused") w("继续执行目标") else w("暂停目标")) }
                            TextButton(onClick = { model.editMessage("/goal edit ${goal.optString("objective")}") }) { Text(w("更新目标")) }
                            TextButton(onClick = { runCommand("goal", "clear") }, enabled = !actions.busy) { Text(w("清除目标")) }
                        }
                    }
                    if (session.raw.rows("todos").isNotEmpty()) {
                        TextButton(onClick = { showTodos = !showTodos }) { Text("${w("任务")} ${session.raw.rows("todos").count { it.optString("status") == "completed" }}/${session.raw.rows("todos").size}") }
                        if (showTodos) Column(Modifier.heightIn(max = 130.dp)) {
                            session.raw.rows("todos").forEach { todo -> Row(verticalAlignment = Alignment.CenterVertically) {
                                Glyph(if (todo.optString("status") == "completed") R.drawable.ic_check else R.drawable.ic_clock, size = 14)
                                Text(todo.optString("content"), Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodySmall, maxLines = 2)
                            } }
                        }
                    }
                    if (session.queue.isNotEmpty()) LazyColumn(Modifier.heightIn(max = 170.dp)) {
                        items(session.queue, key = { it.id }) { queued ->
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                if (queued.attachments.isNotEmpty()) Glyph(R.drawable.ic_paperclip, size = 16)
                                Text(queued.text, Modifier.weight(1f).padding(horizontal = 8.dp), maxLines = 2, style = MaterialTheme.typography.bodySmall)
                                if (queued.raw.optBoolean("editable")) {
                                    IconButton(onClick = { queueEditing = queued; queueText = queued.text }) { Glyph(R.drawable.ic_pencil, w("编辑"), 18) }
                                    IconButton(onClick = { perform("session.queue.update", json("itemId" to queued.id, "action" to "remove")) },
                                        enabled = !actions.busy) { Glyph(R.drawable.ic_trash2, stringResource(R.string.delete), 18, MaterialTheme.colorScheme.error) }
                                }
                                IconButton(onClick = { perform("session.queue.update", json("itemId" to queued.id, "action" to "steer")) },
                                    enabled = !actions.busy) { Glyph(R.drawable.ic_corner_up_left, w("插话发送"), 18) }
                            }
                        }
                    }
                }
                if (recipients.isNotEmpty() || skills.isNotEmpty()) LazyColumn(Modifier.heightIn(max = 180.dp)) {
                    items(recipients, key = { "recipient:${it.getLong("id")}" }) { recipient ->
                        Line(recipient.optString("title"), recipient.nullableString("ref"), action = {
                            model.editMessage("@${recipient.nullableString("ref") ?: recipient.getLong("id")} ")
                        }, trailing = { AgentLogo(recipient.nullableString("agent"), 18) })
                    }
                    items(skills, key = { "skill:${it.getString("name")}" }) { skill ->
                        Line(skill.getString("name"), skill.nullableString("description"), action = { model.editMessage("/${skill.getString("name")} ") })
                    }
                }
                notice?.let { value ->
                    LaunchedEffect(value) { delay(10000); if (notice == value) notice = null }
                    TextButton(onClick = { notice = null }) { Text(value, maxLines = 3) }
                }
                if (state.problem != null || actions.error != null) Text(problemText(state.problem ?: actions.error!!),
                    color = MaterialTheme.colorScheme.error, fontSize = 14.sp,
                    modifier = Modifier.padding(bottom = 8.dp).testTag("send-error"))
                if (actions.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (state.outbox.any { it.failed }) LazyColumn(Modifier.heightIn(max = 120.dp)) {
                    items(state.outbox.filter { it.failed }, key = { it.requestId }) { failed ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(failed.text.ifBlank { w("文件") }, Modifier.weight(1f), maxLines = 2, style = MaterialTheme.typography.bodySmall)
                            IconButton(onClick = { model.retry(failed) }, enabled = !state.sending) { Glyph(R.drawable.ic_refresh_cw, w("重试"), 18) }
                            IconButton(onClick = { model.discard(failed) }, enabled = !state.sending) { Glyph(R.drawable.ic_x, stringResource(R.string.delete), 18) }
                        }
                    }
                }
                if (!state.readOnly) {
                    if (state.isAssistant) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("todo", "info", "task").forEach { kind ->
                            TextButton(onClick = { quickSheet = kind }, modifier = Modifier.testTag("quick-$kind")) {
                                Glyph(when (kind) { "todo" -> R.drawable.ic_list_todo; "info" -> R.drawable.ic_inbox; else -> R.drawable.ic_clock }, size = 16)
                                Spacer(Modifier.width(6.dp)); Text(when (kind) { "todo" -> w("待办"); "info" -> w("收件箱"); else -> w("任务") })
                            }
                        }
                    }
                    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(28.dp),
                        color = MaterialTheme.colorScheme.surface, shadowElevation = 3.dp,
                        border = BorderStroke(.75.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Column {
                            if (state.attachments.isNotEmpty()) Box(Modifier.padding(12.dp)) { StagedAttachments(state, model) }
                            Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.Bottom) {
                                IconButton(onClick = { attachmentMenu = true }, modifier = Modifier.size(44.dp).testTag("composer-plus"),
                                    enabled = session != null && !state.sending && !actions.busy) {
                                    Glyph(R.drawable.ic_plus, w("添加"), 24)
                                }
                                val goalInput = state.message.startsWith("/goal ")
                                if (goalInput) TextButton(onClick = { model.editMessage(state.message.removePrefix("/goal ")) },
                                    contentPadding = PaddingValues(horizontal = 2.dp)) {
                                    Text("/${w("目标")}", color = DuduStyle.blue, fontSize = 16.sp)
                                }
                                BasicTextField(value = if (goalInput) state.message.removePrefix("/goal ") else state.message,
                                    onValueChange = { model.editMessage(if (goalInput) "/goal $it" else it) },
                                    modifier = Modifier.weight(1f).heightIn(min = 44.dp).testTag("message-input")
                                        .padding(vertical = 11.dp, horizontal = 2.dp),
                                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                                    cursorBrush = SolidColor(DuduStyle.blue), maxLines = 6,
                                    enabled = session != null && !state.sending,
                                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                                    decorationBox = { inner ->
                                        if (state.message.isEmpty() || goalInput && state.message == "/goal ")
                                            Text(if (goalInput) w("输入目标，智能体将持续执行") else stringResource(R.string.message), fontSize = 16.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        inner()
                                    })
                                if (state.voiceEnabled && context.packageManager.resolveActivity(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH), 0) != null)
                                    IconButton(onClick = {
                                        voiceTarget = state.computerId to session!!.id
                                        voice.launch(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                                            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                                            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale.toLanguageTag()))
                                    }, enabled = session != null && !state.sending, modifier = Modifier.size(44.dp)) {
                                        Glyph(R.drawable.ic_mic, w("语音输入"), 22)
                                    }
                                val canSend = (if (goalInput) state.message.removePrefix("/goal ").isNotBlank() else state.message.isNotBlank()) ||
                                    state.attachments.isNotEmpty()
                                if (canSend || session?.processing == true || state.sending) IconButton(onClick = {
                                    val match = Regex("^/(compact|plan|goal)(?:\\s+([\\s\\S]+))?$").matchEntire(state.message.trim())
                                    if (canSend && match != null && state.attachments.isEmpty())
                                        runCommand(match.groupValues[1], match.groupValues[2], state.message)
                                    else if (canSend) model.send()
                                    else if (session?.processing == true) perform("session.stop")
                                }, modifier = Modifier.size(44.dp).testTag("send"),
                                    enabled = session != null && !state.sending && !actions.busy) {
                                    Box(Modifier.size(34.dp).background(Color(0xFFB8DBFD), CircleShape), contentAlignment = Alignment.Center) {
                                        if (state.sending) CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 1.5.dp, color = Color(0xFF17181B))
                                        else Glyph(if (!canSend && session?.processing == true) R.drawable.ic_square else R.drawable.ic_arrow_up,
                                            if (!canSend && session?.processing == true) w("停止") else stringResource(R.string.send),
                                            size = 20, tint = Color(0xFF17181B))
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
    ) { insets ->
        Box(Modifier.fillMaxSize().padding(insets)) {
            if (state.opening && session == null) CircularProgressIndicator(Modifier.align(Alignment.Center).size(28.dp), strokeWidth = 2.dp)
            else LazyColumn(Modifier.fillMaxSize().testTag("message-list"), state = list,
                contentPadding = PaddingValues(horizontal = 24.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp)) {
                if (hasOlder) item("older") { TextButton(onClick = model::older, enabled = !state.pageLoading,
                    modifier = Modifier.fillMaxWidth()) { Text(w("加载更早")) } }
                items(all, key = { it.id }) { message ->
                    MessageView(message, state, model, actions)
                }
                if (session != null && !session.cached && !state.readOnly) {
                    items(session.raw.rows("questions"), key = { "question:${it.getString("id")}" }) { batch ->
                        Questions(batch, session.id, model)
                    }
                    items(session.raw.rows("approvals"), key = { "approval:${it.getString("id")}" }) { approval ->
                        Approval(approval, session.id, model)
                    }
                }
            }
            if (!following && all.isNotEmpty()) SmallFloatingActionButton(
                onClick = { following = true; coroutine.launch { list.animateScrollToItem(all.lastIndex + olderOffset) } },
                modifier = Modifier.align(Alignment.BottomEnd).padding(12.dp)) { Glyph(R.drawable.ic_arrow_down, w("回到底部"), 20) }
        }
    }
    if (controls && session != null) ModelControls(session, state, model, dismiss = { controls = false })
    if (permissions && session != null) PermissionControls(session, state, model, dismiss = { permissions = false })
    if (attachmentMenu && session != null) ComposerMenu(session, state, model, dismiss = { attachmentMenu = false },
        pick = { types -> attachmentMenu = false; picker(types) },
        goal = { attachmentMenu = false; model.editMessage("/goal ") },
        plan = { attachmentMenu = false; runCommand("plan", if (session.raw.optBoolean("planMode")) "off" else "on") },
        compact = { attachmentMenu = false; runCommand("compact") },
        stop = { attachmentMenu = false; perform("session.stop") })
    quickSheet?.let { AssistantQuickSheet(it, state, model) { quickSheet = null } }
    queueEditing?.let { queued -> AlertDialog(onDismissRequest = { queueEditing = null }, title = { Text(w("编辑")) },
        text = { Field(stringResource(R.string.message), queueText, multi = true) { queueText = it } },
        confirmButton = { TextButton(onClick = { perform("session.queue.update", json("itemId" to queued.id, "action" to "edit", "text" to queueText)); queueEditing = null },
            enabled = queueText.isNotBlank() && !actions.busy) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = { queueEditing = null }) { Text(stringResource(R.string.cancel)) } }) }
}

@Composable
private fun MessageView(message: Message, state: UiState, model: DuduViewModel, actions: Actions) {
    val own = message.role == "user"
    val session = state.session ?: return
    val clipboard = LocalClipboard.current
    val coroutine = rememberCoroutineScope()
    val raw = message.raw
    var messageMenu by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().alpha(if (message.pending) .65f else 1f),
        horizontalArrangement = if (own) Arrangement.End else Arrangement.Start) {
        Column(Modifier.widthIn(max = if (own) 320.dp else 800.dp)
            .combinedClickable(enabled = !message.pending && !message.streaming && message.text.isNotBlank(),
                onClick = {}, onLongClick = { messageMenu = true }).then(if (own)
            Modifier.background(if (androidx.compose.foundation.isSystemInDarkTheme()) MaterialTheme.colorScheme.secondaryContainer else DuduStyle.bubble,
                RoundedCornerShape(20.dp))
                .padding(horizontal = 14.dp, vertical = 10.dp) else Modifier), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (message.reasoning.isNotBlank()) {
                var expanded by remember(message.id) { mutableStateOf(false) }
                TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(0.dp)) {
                    Text(w("思考过程"), style = MaterialTheme.typography.labelMedium)
                    Glyph(if (expanded) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down, size = 14)
                }
                if (expanded) Markdown(message.reasoning, compact = true)
            }
            if (message.text.isNotBlank()) {
                if (own) Text(message.text, fontSize = 16.sp, lineHeight = 25.sp)
                else Markdown(message.text, selectable = false)
            }
            message.attachments.forEach { attachment -> Attachment(session.id, attachment,
                if (raw.has("seq")) raw.optLong("seq") else null, model) }
            Regex("!\\[([^]]*)]\\(([^)]+)\\)").findAll(message.text).forEach { image ->
                if (raw.has("seq")) Attachment(session.id, json("kind" to "image", "name" to image.groupValues[1],
                    "source" to image.groupValues[2]), raw.getLong("seq"), model)
            }
            raw.rows("calls").forEach { call ->
                val reference = session.transcript?.optJSONObject("tools")?.optJSONObject(call.optString("id"))
                val seq = reference?.optLong("seq", -1) ?: call.optLong("seq", -1)
                val resultSeq = reference?.optLong("resultSeq", -1) ?: call.optLong("resultSeq", -1)
                OutlinedButton(onClick = { model.navigate(Route("tool", call.optString("name"), params = json("seq" to seq, "callId" to call.getString("id")).apply {
                    if (resultSeq >= 0) put("resultSeq", resultSeq)
                })) }, enabled = seq >= 0) {
                    Glyph(R.drawable.ic_terminal, size = 16); Spacer(Modifier.width(8.dp))
                    Text(call.optString("name"), maxLines = 1)
                    if ((reference?.optString("status") ?: call.optString("status")) == "running")
                        CircularProgressIndicator(Modifier.padding(start = 8.dp).size(12.dp), strokeWidth = 1.5.dp)
                }
                call.nullableString("detail")?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2,
                    color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (message.role == "compaction") {
                Text(w("已压缩"), style = MaterialTheme.typography.labelMedium)
                raw.nullableString("summary")?.let { Markdown(it, compact = true) }
                raw.optJSONObject("compaction")?.nullableString("summary")?.let { Markdown(it, compact = true) }
            }
            if (message.role == "command") {
                val group = raw.optJSONObject("group")
                val card = raw.optJSONObject("card")
                if (group != null) GroupMessage(group, state, model, actions)
                else if (card != null) QuickCard(card, state, model)
                else if (raw.optString("name").isNotBlank()) Text("/${raw.optString("name")}",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelMedium)
                raw.nullableString("summary")?.let { Markdown(it, compact = true) }
            }
            if (message.streaming) Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
                if (message.text.isBlank()) Text(w("正在分析请求"), Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodySmall)
            }
            DropdownMenu(messageMenu, { messageMenu = false }) {
                DropdownMenuItem(text = { Text(w("复制")) }, leadingIcon = { Glyph(R.drawable.ic_copy, size = 18) },
                    onClick = { messageMenu = false; coroutine.launch {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("message", message.text)))
                    } })
                if (raw.has("seq") && message.role in listOf("assistant", "user")) DropdownMenuItem(
                    text = { Text(w("在新对话中分支")) }, leadingIcon = { Glyph(R.drawable.ic_git_fork, size = 18) },
                    onClick = { messageMenu = false; actions.run {
                        val result = model.request("session.fork", json("id" to session.id, "seq" to raw.getLong("seq")))
                        val id = result.nullableString("sessionId") ?: result.nullableString("id")
                        id?.let { model.openSession(it, state.conversationTitle.orEmpty()) }
                    } })
                if (state.isAssistant && raw.has("seq")) DropdownMenuItem(
                    text = { Text(w("删除"), color = MaterialTheme.colorScheme.error) },
                    leadingIcon = { Glyph(R.drawable.ic_trash2, size = 18, tint = MaterialTheme.colorScheme.error) },
                    onClick = { messageMenu = false; actions.run {
                        model.request("assistant.hide", json("sessionId" to session.id, "seqs" to JSONArray(listOf(raw.getLong("seq")))))
                    } })
            }
            val turnNumber = raw.optInt("turn", -1)
            val isLast = turnNumber >= 0 && session.messages.lastOrNull { it.raw.optInt("turn", -2) == turnNumber }?.id == message.id
            val turn = if (isLast) session.transcript?.rows("turns")?.find { it.optInt("turn", -1) == turnNumber } else null
            turn?.rows("notices")?.forEach { notice -> Text(notice.optString("message"), style = MaterialTheme.typography.bodySmall,
                color = if (notice.optString("kind") == "error") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant) }
            turn?.let { DeliveredFilesCard(it.rows("files"), session.id, model) }
            if (turn?.has("changesSeq") == true) TextButton(onClick = { model.navigate(Route("changes", params = json("seq" to turn.getLong("changesSeq")))) }) {
                Glyph(R.drawable.ic_file_diff, size = 16); Spacer(Modifier.width(6.dp)); Text(w("已编辑文件"))
            }
        }
    }
}
