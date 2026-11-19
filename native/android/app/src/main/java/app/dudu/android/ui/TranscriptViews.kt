package app.dudu.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject
import java.util.Locale

@Composable
internal fun TranscriptTurn(
    row: TranscriptRow.Turn,
    session: Session,
    connected: Boolean,
    openTool: (JSONObject) -> Unit,
    openChanges: (Long) -> Unit,
    files: @Composable (List<JSONObject>) -> Unit,
    message: @Composable (Message) -> Unit,
) {
    var processOpen by remember(row.id) { mutableStateOf(false) }
    val tertiary = chatTertiary()
    Column(Modifier.fillMaxWidth().testTag("chat-turn-${row.id}"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        if (row.segments.isNotEmpty()) {
            val hasHeader = row.finalFragment && !row.running
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (hasHeader) {
                    val title = when (row.outcome) {
                        "failed", "interrupted" -> w("处理失败")
                        "stopped" -> w("已停止")
                        else -> {
                            val start = row.timing?.takeUnless { it.isNull("start") }?.optLong("start")
                            val end = row.timing?.takeUnless { it.isNull("end") }?.optLong("end")
                            if (start != null && end != null && end >= start)
                                w("已完成，用时 {0}").replace("{0}", transcriptDuration(end - start))
                            else w("已完成")
                        }
                    }
                    Column {
                        Row(Modifier.fillMaxWidth().height(33.dp)
                            .clickable(enabled = !row.staysOpen, role = Role.Button) { processOpen = !processOpen },
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(title, fontSize = 15.sp, color = tertiary, maxLines = 1)
                            if (!row.staysOpen) Glyph(if (processOpen) R.drawable.ic_chevron_up else R.drawable.ic_chevron_down,
                                size = 14, tint = tertiary)
                        }
                        Spacer(Modifier.height(8.dp))
                        HorizontalDivider(thickness = .5.dp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = .1f))
                    }
                }
                if (!hasHeader || row.staysOpen || processOpen) {
                    row.segments.forEach { segment ->
                        key(segment.id) {
                            when (segment) {
                                is ProcessSegment.Reply -> message(segment.message)
                                is ProcessSegment.Group -> ProcessGroup(segment,
                                    startsOpen = row.finalFragment && !row.running, session, openTool)
                            }
                        }
                    }
                }
            }
        }
        row.answer?.let { message(it) }
        if (row.finalFragment) {
            row.timing?.rows("notices")?.forEach { notice ->
                Text(notice.optString("message"), fontSize = 13.sp, lineHeight = 19.sp,
                    color = if (notice.optString("kind") == "error") MaterialTheme.colorScheme.error else tertiary)
            }
            row.timing?.takeUnless { it.isNull("changesSeq") }?.let { timing ->
                TurnChangesCard(timing.getLong("changesSeq"), timing.optJSONObject("changesSummary"),
                    enabled = connected && !session.cached, open = openChanges)
            }
            files(row.timing?.rows("files").orEmpty())
        }
        if (row.running) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            RunningMark(14)
            Text(w("正在分析请求"), fontSize = 14.sp, color = tertiary)
        }
    }
}

/** The existing iPhone file card. Its summary comes with the transcript; only a tap reads the comparison. */
@Composable
private fun TurnChangesCard(seq: Long, summary: JSONObject?, enabled: Boolean, open: (Long) -> Unit) {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    Surface(onClick = { open(seq) }, enabled = enabled,
        modifier = Modifier.fillMaxWidth().testTag("changes-toggle"),
        shape = RoundedCornerShape(16.dp),
        color = if (dark) MaterialTheme.colorScheme.surfaceContainer else Color(0xFFF9FAFB),
        border = BorderStroke(.5.dp, if (dark) MaterialTheme.colorScheme.outlineVariant else Color.Black.copy(alpha = .04f))) {
        Row(Modifier.heightIn(min = 56.dp).padding(14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Image(painterResource(R.drawable.changed_files), null, Modifier.size(24.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(summary?.let { wp("已编辑 %lld 个文件", it.getInt("total")) } ?: w("已编辑文件"),
                    fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, maxLines = 1,
                    color = MaterialTheme.colorScheme.onSurface, overflow = TextOverflow.Ellipsis)
                // Reserve this line even when the host no longer retains the comparison.
                Row(Modifier.alpha(if (summary == null) 0f else 1f)
                    .then(if (summary == null) Modifier.clearAndSetSemantics {} else Modifier),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FileChangeCounts(summary?.optInt("added") ?: 0, summary?.optInt("deleted") ?: 0)
                }
            }
            Glyph(R.drawable.ic_chevron_right, size = 14, tint = chatTertiary())
        }
    }
}

@Composable
internal fun FileChangeCounts(added: Int, deleted: Int) {
    Text("+$added", fontSize = 12.sp, lineHeight = 16.sp, fontFamily = FontFamily.Monospace,
        color = Color(0xFF1A8E47))
    Text("−$deleted", fontSize = 12.sp, lineHeight = 16.sp, fontFamily = FontFamily.Monospace,
        color = MaterialTheme.colorScheme.error)
}

@Composable
private fun ProcessGroup(group: ProcessSegment.Group, startsOpen: Boolean, session: Session, openTool: (JSONObject) -> Unit) {
    var expanded by remember(group.id) { mutableStateOf<Boolean?>(null) }
    val open = expanded ?: startsOpen
    val counts = group.members.filterIsInstance<ProcessMember.Call>().groupingBy { activity(it.call) }.eachCount()
        .entries.sortedByDescending { it.value }.map { it.key }
    val latestCall = group.members.filterIsInstance<ProcessMember.Call>().lastOrNull { member ->
        val status = session.transcript?.optJSONObject("tools")?.optJSONObject(member.call.optString("id"))
            ?.nullableString("status") ?: member.call.nullableString("status")
        status == null || status == "running"
    }?.call
    val kind = if (group.running) latestCall?.let(::activity) ?: "thinking" else counts.firstOrNull() ?: "thinking"
    val title = if (group.running) {
        val label = activityTitle(kind, running = true)
        latestCall?.nullableString("detail")?.let { "$label · $it" } ?: label
    } else groupTitle(counts)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 24.dp).testTag("chat-process-group")
            .clickable(role = Role.Button) { expanded = !open },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Glyph(if (open) R.drawable.ic_chevron_up else activityIcon(kind), size = 14, tint = chatTertiary())
            Text(title, fontSize = 15.sp, lineHeight = 21.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = chatTertiary())
        }
        if (open) Column(Modifier.padding(start = 2.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            group.members.forEach { member ->
                key(member.id) {
                    when (member) {
                        is ProcessMember.Thought -> ThoughtRow(member.message)
                        is ProcessMember.Call -> ToolCallRow(member.call, session, openTool)
                    }
                }
            }
        }
    }
}

@Composable
private fun ThoughtRow(message: Message) {
    var expanded by remember(message.id) { mutableStateOf(false) }
    val summary = message.reasoning.lineSequence().firstOrNull { it.isNotBlank() }.orEmpty().replace("**", "").trim()
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 24.dp).clickable(role = Role.Button) { expanded = !expanded },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Glyph(R.drawable.ic_brain, size = 16, tint = chatTertiary())
            Text(w("思考"), fontSize = 15.sp, color = chatTertiary())
            if (!expanded && summary.isNotEmpty()) {
                ProcessSeparator()
                Text(summary, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = chatTertiary())
            }
        }
        if (expanded) SelectionContainer {
            Text(message.reasoning, Modifier.padding(start = 22.dp, top = 2.dp, bottom = 2.dp),
                fontSize = 14.sp, lineHeight = 21.sp, color = chatSecondary())
        }
    }
}

@Composable
internal fun ToolCallRow(call: JSONObject, session: Session, open: (JSONObject) -> Unit) {
    val reference = session.transcript?.optJSONObject("tools")?.optJSONObject(call.optString("id"))
    val status = reference?.nullableString("status") ?: call.nullableString("status")
    val color = if (status == "error") MaterialTheme.colorScheme.error else chatTertiary()
    val seq = reference?.optLong("seq", -1) ?: call.optLong("seq", -1)
    Row(Modifier.fillMaxWidth().heightIn(min = 24.dp).testTag("chat-process-call")
        .clickable(enabled = seq >= 0 && !session.cached, role = Role.Button) { open(call) },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Glyph(activityIcon(activity(call)), size = 14, tint = color)
        Text(toolTitle(call.optString("name")), fontSize = 15.sp, lineHeight = 21.sp, color = color, maxLines = 1)
        call.nullableString("detail")?.let { detail ->
            ProcessSeparator()
            Text(detail, Modifier.weight(1f), fontSize = 13.sp, lineHeight = 19.sp, maxLines = 1,
                overflow = TextOverflow.Ellipsis, color = color)
        }
    }
}

@Composable
private fun ProcessSeparator() {
    Box(Modifier.padding(horizontal = 2.dp).size(2.dp).background(chatTertiary().copy(alpha = .6f), CircleShape))
}

@Composable
internal fun chatTertiary() = if (androidx.compose.foundation.isSystemInDarkTheme())
    MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFF81858C)

@Composable
private fun chatSecondary() = if (androidx.compose.foundation.isSystemInDarkTheme())
    MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFF61666B)

private fun normalizedTool(name: String) = name.substringAfterLast('.').lowercase(Locale.ROOT)

private fun activity(call: JSONObject): String = call.nullableString("activity") ?: when (normalizedTool(call.optString("name"))) {
    "bash", "shell", "pwsh", "exec_command", "write_stdin" -> "commands"
    "edit", "apply_patch" -> "edit"
    "read", "read_file" -> "read"
    "write", "write_file" -> "write"
    "grep", "glob" -> "search"
    "web_search" -> "webSearch"
    "web_fetch" -> "webFetch"
    else -> "tools"
}

private fun activityIcon(kind: String): Int = when (kind) {
    "thinking" -> R.drawable.ic_brain
    "read", "readImage", "webFetch" -> R.drawable.ic_file
    "search" -> R.drawable.ic_search
    "edit", "write" -> R.drawable.ic_pencil
    "commands", "code" -> R.drawable.ic_terminal
    "webSearch" -> R.drawable.ic_globe
    "subagents" -> R.drawable.ic_users_round
    "plan" -> R.drawable.ic_clipboard_list
    "questions" -> R.drawable.ic_circle_help
    else -> R.drawable.ic_bot
}

@Composable
private fun toolTitle(name: String): String = when (val key = normalizedTool(name)) {
    "bash", "shell", "pwsh", "exec_command", "write_stdin" -> w("运行命令")
    "read", "read_file" -> w("读取")
    "read_image" -> w("读取图片")
    "write", "write_file" -> w("写入")
    "edit", "apply_patch" -> w("编辑")
    "run_code" -> w("代码")
    "grep" -> w("搜索文件内容")
    "glob" -> w("查找文件")
    "web_search" -> w("网页搜索")
    "web_fetch" -> w("网页获取")
    "ask_user_question", "request_user_input" -> w("提问")
    "todo_write" -> w("更新待办清单")
    "create_goal" -> w("创建目标")
    "get_goal" -> w("查看目标")
    "update_goal" -> w("更新目标")
    else -> when {
        key.startsWith("terminal_") -> w("运行命令")
        key.startsWith("subagent") -> w("子智能体")
        else -> w("工具调用")
    }
}

@Composable
private fun activityTitle(kind: String, running: Boolean): String = if (running) when (kind) {
    "read" -> w("正在读取文件")
    "readImage" -> w("正在读取图片")
    "write" -> w("正在写入文件")
    "search" -> w("正在搜索代码")
    "edit" -> w("正在编辑文件")
    "commands" -> w("正在运行命令")
    "code" -> w("正在运行代码")
    "webSearch" -> w("正在搜索网页")
    "webFetch" -> w("正在访问网页")
    "subagents" -> w("正在协调子智能体")
    "plan" -> w("正在更新计划")
    "questions" -> w("等待你的操作")
    "tools" -> w("正在调用工具")
    else -> w("正在分析请求")
} else when (kind) {
    "read" -> w("已读取文件")
    "readImage" -> w("已读取图片")
    "write" -> w("已写入文件")
    "search" -> w("已搜索代码")
    "edit" -> w("修改了文件")
    "commands" -> w("执行了命令")
    "code" -> w("运行了代码")
    "webSearch" -> w("已搜索网页")
    "webFetch" -> w("已访问网页")
    "subagents" -> w("已协调子智能体")
    "plan" -> w("更新了计划")
    "questions" -> w("向用户提出了问题")
    "tools" -> w("已调用工具")
    else -> w("已完成分析")
}

@Composable
private fun groupTitle(kinds: List<String>): String {
    val labels = kinds.take(3).map { activityTitle(it, running = false) }
    if (labels.isEmpty()) return w("已完成分析")
    if (labels.size == 1) return labels.single()
    if (labels.size == 2) {
        val first = labels[0]
        val second = if (first.startsWith("已")) labels[1].removePrefix("已") else labels[1]
        return w("{0}并{1}").replace("{0}", first).replace("{1}", second)
    }
    val title = labels.joinToString(if (appLocale().language == "zh") "，" else ", ")
    return if (kinds.size > 3) w("{0}等").replace("{0}", title) else title
}

@Composable
private fun transcriptDuration(milliseconds: Long): String {
    val total = (milliseconds / 1000).coerceAtLeast(0)
    val hours = total / 3600
    val minutes = total / 60 % 60
    val seconds = total % 60
    return (if (hours > 0) w("{0}小时").replace("{0}", hours.toString()) else "") +
        (if (total >= 60) w("{0}分").replace("{0}", minutes.toString()) else "") +
        w("{0}秒").replace("{0}", seconds.toString())
}
