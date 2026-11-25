package app.dudu.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.res.imageResource
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
import kotlinx.coroutines.delay
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
            // Folding hides the thinking and tool groups only; every reply stays, as DSH's default 「全部回复」 (owner, 2026-11-22).
            // A turn whose process is only replies keeps its title and has no fold.
            val foldable = !row.staysOpen && row.segments.any { it is ProcessSegment.Group }
            val open = !hasHeader || row.staysOpen || processOpen
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
                            .clickable(enabled = foldable, role = Role.Button) { processOpen = !processOpen },
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(title, fontSize = 15.sp, color = tertiary, maxLines = 1)
                            if (foldable) Glyph(if (processOpen) DuduGlyphs.up else DuduGlyphs.down,
                                size = 14, tint = tertiary)
                        }
                        Spacer(Modifier.height(8.dp))
                        HorizontalDivider(thickness = .5.dp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = .1f))
                    }
                }
                row.segments.forEach { segment ->
                    if (open || segment is ProcessSegment.Reply) key(segment.id) {
                        when (segment) {
                            is ProcessSegment.Reply -> message(segment.message)
                            is ProcessSegment.Group -> ProcessGroup(segment, if (segment.running) row.live else null,
                                startsOpen = row.finalFragment && !row.running, session, openTool)
                        }
                    }
                }
            }
        }
        row.answer?.let { message(it) }
        if (row.finalFragment) {
            turnNotices(row.timing).forEach { notice -> key(notice.optString("id")) { TurnNotice(notice) } }
            row.timing?.takeUnless { it.isNull("changesSeq") }?.let { timing ->
                TurnChangesCard(timing.getLong("changesSeq"), timing.optJSONObject("changesSummary"),
                    enabled = connected && !session.cached, open = openChanges)
            }
            files(row.timing?.rows("files").orEmpty())
        }
        // The running line is not drawn here: it is the conversation's last row, after what was sent, the questions and the approvals (the iPhone's `ConversationHistoryItem.running`).
    }
}

/**
 * The line at the end of a running conversation, as the iPhone's `RunningStatusView` draws it (owner, 2026-11-21: "和 iOS 完全不一样"; the first version had only its words): a hairline, then
 * DSH's whale tail, 16 dp, which moves, beside "深度求索中，用时 5分13秒 ···" in 14 sp blue with a highlight that sweeps over the words (owner, 2026-11-23: 「鲸鱼尾巴会晃动，并且有一个光效。
 * 手机端也按照这个实现吧，图标也换成和 dsh 一样的鲸鱼尾巴」); "深度求索中 ···" until the turn's start is known.
 * It is the history's last row, after the messages on their way, the questions and the approvals, and it is there before the turn has begun (owner's audit, 2026-11-22, A3).
 */
@Composable
internal fun RunningStatus(startedAt: Long?) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        HorizontalDivider(thickness = .5.dp, color = MaterialTheme.colorScheme.onSurface.copy(alpha = .1f))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            WhaleTailMark(chatRunning())
            ShimmerText(if (startedAt == null) w("深度求索中 ···")
                else w("深度求索中，用时 {0} ···").replace("{0}", transcriptDuration(maxOf(1000L, now - startedAt))),
                chatRunning(), chatRunningHighlight())
        }
    }
}

/**
 * DSH's whale tail in the colour of the words: 60 pictures in one strip (`whale_tail_strip`, as high as one picture is wide, made four times as large from the 28 × 28 of the animation DSH uses, which DSH shows as a mask
 * over the text colour, so only its transparency counts), 20 a second, 3 seconds for the round; it stands still on the first picture when motion is off (`motionOn()`).
 */
@Composable
private fun WhaleTailMark(color: Color) {
    val strip = ImageBitmap.imageResource(R.drawable.whale_tail_strip)
    val side = strip.height
    val frames = strip.width / side
    val moving = motionOn()
    var frame by remember { mutableIntStateOf(0) }
    LaunchedEffect(moving) {
        if (!moving) { frame = 0; return@LaunchedEffect }
        while (true) { frame = ((System.currentTimeMillis() / 50) % frames).toInt(); delay(50) }
    }
    androidx.compose.foundation.Canvas(Modifier.size(16.dp).clearAndSetSemantics { }) {
        drawImage(strip, srcOffset = androidx.compose.ui.unit.IntOffset(frame * side, 0), srcSize = androidx.compose.ui.unit.IntSize(side, side),
            dstSize = androidx.compose.ui.unit.IntSize(size.width.toInt(), size.height.toInt()),
            colorFilter = androidx.compose.ui.graphics.ColorFilter.tint(color, androidx.compose.ui.graphics.BlendMode.SrcIn),
            filterQuality = androidx.compose.ui.graphics.FilterQuality.High)
    }
}

/**
 * The words with DSH's highlight (its `TextShimmer`): a copy of the words in the highlight colour whose colour fades in and out across a soft band (CSS `linear-gradient(105deg, transparent 0%,
 * black 40% 60%, transparent 100%)` over a box as wide as the words) that crosses them from left to right in 1 s, rests for 0.5 s and starts again, in 48 steps; the first sweep begins 0.3 s after
 * the line appears. Still when motion is off.
 */
@Composable
private fun ShimmerText(text: String, color: Color, highlight: Color) {
    var box by remember { mutableStateOf(androidx.compose.ui.unit.IntSize.Zero) }
    var progress by remember { mutableFloatStateOf(0f) }
    val moving = motionOn()
    LaunchedEffect(moving) {
        if (!moving) { progress = 0f; return@LaunchedEffect }
        val began = androidx.compose.runtime.withFrameNanos { it }
        while (true) {
            val elapsed = (androidx.compose.runtime.withFrameNanos { it } - began) / 1e9 - 0.3
            progress = if (elapsed < 0) 0f else (kotlin.math.floor(minOf(1.0, (elapsed % 1.5) / 1.0) * 48) / 48).toFloat()
        }
    }
    Box {
        // DSH sets the words in tabular figures, so the clock does not shift the line every second.
        Text(text, Modifier.onSizeChanged { box = it }, fontSize = 14.sp, color = color, style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"))
        if (moving && box.width > 0) {
            val width = box.width.toFloat()
            val height = box.height.toFloat()
            val angle = Math.toRadians(105.0)
            val dx = kotlin.math.sin(angle).toFloat()
            val dy = -kotlin.math.cos(angle).toFloat()
            val length = kotlin.math.abs(width * dx) + kotlin.math.abs(height * dy)
            val shift = (progress * 2 - 1) * width
            val band = androidx.compose.ui.graphics.Brush.linearGradient(
                0f to Color.Transparent, .4f to highlight, .6f to highlight, 1f to Color.Transparent,
                start = androidx.compose.ui.geometry.Offset(width / 2 - dx * length / 2 + shift, height / 2 - dy * length / 2),
                end = androidx.compose.ui.geometry.Offset(width / 2 + dx * length / 2 + shift, height / 2 + dy * length / 2))
            Text(text, Modifier.clearAndSetSemantics { }, fontSize = 14.sp, style = LocalTextStyle.current.copy(brush = band, fontFeatureSettings = "tnum"))
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
            if (summary?.optInt("total") == 1) FileTypeIcon(summary.nullableString("fileName"))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(summary?.nullableString("fileName") ?: summary?.let { wp("已编辑 %lld 个文件", it.getInt("total")) } ?: w("已编辑文件"),
                    fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, maxLines = 1,
                    color = MaterialTheme.colorScheme.onSurface, overflow = TextOverflow.Ellipsis)
                // Reserve this line even when the host no longer retains the comparison.
                Row(Modifier.alpha(if (summary == null) 0f else 1f)
                    .then(if (summary == null) Modifier.clearAndSetSemantics {} else Modifier),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FileChangeCounts(summary?.optInt("added") ?: 0, summary?.optInt("deleted") ?: 0)
                }
            }
            Glyph(DuduGlyphs.right, size = 14, tint = chatTertiary())
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

/**
 * A group of thinking and tool calls (the iPhone's `ProcessGroupView`). While it runs its title is what the turn is doing now, 「正在分析请求 · <the newest paragraph's first line>」 or
 * 「正在运行命令 · <the call's detail>」, pulsing as the iPhone's `PulsingText` does (`0.68 + 0.32 × (0.5 + 0.5 sin 3.2 t)`, 20 times a second); closed, it names its three commonest kinds.
 */
@Composable
private fun ProcessGroup(group: ProcessSegment.Group, live: LiveStatus?, startsOpen: Boolean, session: Session, openTool: (JSONObject) -> Unit) {
    var expanded by remember(group.id) { mutableStateOf<Boolean?>(null) }
    val open = expanded ?: startsOpen
    val counts = group.members.filterIsInstance<ProcessMember.Call>().groupingBy { activity(it.call) }.eachCount()
        .entries.sortedByDescending { it.value }.map { it.key }
    val liveKind = live?.activity?.let { if (it in activityKinds) it else "tools" }
    val running = group.running && live != null
    val kind = if (running && liveKind != null) liveKind else counts.firstOrNull() ?: "thinking"
    val title = if (running && live != null) {
        val label = activityTitle(kind, running = true)
        if (live.detail.isEmpty()) label else "$label · ${live.detail}"
    } else groupTitle(counts)
    var pulse by remember { mutableFloatStateOf(1f) }
    if (running) LaunchedEffect(Unit) {
        while (true) {
            pulse = (0.68 + 0.32 * (0.5 + 0.5 * kotlin.math.sin(System.nanoTime() / 1e9 * 3.2))).toFloat()
            delay(50)
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 24.dp).testTag("chat-process-group")
            .clickable(role = Role.Button) { expanded = !open },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) {
                Glyph(if (open) DuduGlyphs.up else activityIcon(kind), size = if (!open && kind == "thinking") 16 else 14, tint = chatTertiary())
            }
            // Read in the drawing layer: the pulse moves 20 times a second without composing the row again.
            Text(title, Modifier.graphicsLayer { alpha = if (running) pulse else 1f }, fontSize = 15.sp, lineHeight = 21.sp, maxLines = 1,
                overflow = TextOverflow.Ellipsis, color = chatTertiary())
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
            Glyph(DuduGlyphs.think, size = 16, tint = chatTertiary())
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

/**
 * The time over a row of the history (the iPhone's `TranscriptRowView.timeSeparator`): 13 sp, the tertiary grey, in the middle, 10 dp above it and 4 below, 18 dp over the row. Today it is the
 * time alone, this year the month and day too, and the year before that (`TranscriptTitles.clock`).
 */
@Composable
internal fun TimeSeparated(time: Long?, content: @Composable () -> Unit) {
    if (time == null) { content(); return }
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text(transcriptClock(time, appLocale()), Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 4.dp),
            fontSize = 13.sp, color = chatTertiary(), textAlign = TextAlign.Center)
        content()
    }
}

internal fun transcriptClock(time: Long, locale: Locale, now: Long = System.currentTimeMillis()): String {
    val calendar = java.util.Calendar.getInstance()
    calendar.timeInMillis = now
    val year = calendar.get(java.util.Calendar.YEAR)
    val day = calendar.get(java.util.Calendar.DAY_OF_YEAR)
    calendar.timeInMillis = time
    val skeleton = when {
        calendar.get(java.util.Calendar.YEAR) != year -> "yMMMdjmm"
        calendar.get(java.util.Calendar.DAY_OF_YEAR) != day -> "MMMdjmm"
        else -> "jmm"
    }
    return java.text.SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(locale, skeleton), locale)
        .format(java.util.Date(time))
}

/**
 * A notice at the end of a turn (the iPhone's `TurnNoticeView`), 13 sp in the secondary grey: a retry of the model's request, one line that opens on its delay and reason and counts down while it
 * waits; the output-token limit; or the turn's failure, its reason in the app's words for the codes it knows, and the code.
 */
@Composable
internal fun TurnNotice(notice: JSONObject) {
    val code = notice.nullableString("code")
    val failure = when (code) {
        "AUTH" -> w("API 密钥无效")
        "ACCOUNT_SIGNED_OUT" -> w("任务已因退出 DeepSeek 登录而停止。")
        "INTERRUPTED" -> w("DSH 进程在本轮完成前退出（例如被强制结束、崩溃或关闭超时），重新启动后本轮已中止。未完成的工具调用结果未知。")
        "ACCOUNT_SIGN_IN_REQUIRED" -> w("请先登录 DeepSeek，并确认请求地址支持账号认证。")
        "QUOTA", "ACCOUNT_QUOTA" -> w("当前请求的额度已用尽")
        else -> notice.optString("message")
    }
    fun normalized(text: String) = text.replace("_", " ").split(Regex("\\s+")).filter(String::isNotEmpty)
        .joinToString(" ").lowercase(Locale.ROOT)
    val failureCode = code?.takeIf { it.isNotEmpty() && it != "INTERRUPTED" && normalized(it) != normalized(failure) }
    val secondary = chatSecondary()
    val mono = TextStyle(fontSize = 12.sp, fontFamily = FontFamily.Monospace, color = secondary)
    CompositionLocalProvider(LocalTextStyle provides TextStyle(fontSize = 13.sp, lineHeight = 18.sp, color = secondary)) {
        when (notice.optString("kind")) {
            "retry" -> {
                var expanded by remember(notice.optString("id")) { mutableStateOf(false) }
                val scheduled = notice.optString("state") == "scheduled"
                var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
                if (scheduled) LaunchedEffect(Unit) { while (true) { delay(1000); now = System.currentTimeMillis() } }
                val title = when (notice.optString("state")) {
                    "cancelled" -> w("模型请求重试已取消")
                    "started" -> w("已重试模型请求")
                    else -> w("正在重试模型请求")
                }
                val attempt = w("{0}（{1}/{2}）").replace("{0}", title)
                    .replace("{1}", notice.optInt("retry", 1).toString())
                    .replace("{2}", if (notice.has("maximum") && !notice.isNull("maximum")) notice.optInt("maximum").toString() else "∞")
                val delayMs = notice.optDouble("delayMs", 0.0).takeIf { it.isFinite() } ?: 0.0
                val label = if (!scheduled) attempt else {
                    val start = if (notice.has("time") && !notice.isNull("time")) notice.optDouble("time") else now.toDouble()
                    "$attempt · ${maxOf(0, kotlin.math.ceil((start + delayMs - now) / 1000).toInt())}s"
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 28.dp).clickable(role = Role.Button) { expanded = !expanded },
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(label, Modifier.weight(1f))
                        Box(Modifier.rotate(if (expanded) 180f else 0f)) { Glyph(DuduGlyphs.down, size = 14, tint = secondary) }
                    }
                    if (expanded) Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(w("重试延迟：{0} ms").replace("{0}", delayMs.toLong().toString()))
                        SelectionContainer { Text(w("失败原因：{0}").replace("{0}", failure)) }
                        failureCode?.let { Text(it, style = mono) }
                    }
                }
            }
            "max-tokens" -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(w("已达到输出 token 上限"), color = Color(0xFFFF9500))
                Text(w("回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。"))
            }
            else -> Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Text(if (code == "INTERRUPTED" || code == "ACCOUNT_SIGNED_OUT") w("任务已停止") else w("本轮运行失败"), color = chatError())
                SelectionContainer { Text(failure) }
                failureCode?.let { SelectionContainer { Text(it, style = mono) } }
            }
        }
    }
}

/**
 * What started a turn that nobody typed (the iPhone's `TriggerRowView`): a grey card, 20 dp corners and a hairline, the goal glyph and the trigger's name (继续执行目标, 收到团队消息, 自动化任务…);
 * its text opens under it, 12 sp, at most 240 dp high and scrolling.
 */
@Composable
internal fun TriggerRow(message: Message) {
    var open by remember(message.id) { mutableStateOf(false) }
    val canExpand = message.text.isNotBlank()
    val shape = RoundedCornerShape(20.dp)
    val tertiary = chatTertiary()
    Column(Modifier.fillMaxWidth().clip(shape).background(chatPanel(), shape).border(.5.dp, chatBorder(), shape)
        .testTag("chat-trigger-${message.id}")) {
        Row(Modifier.fillMaxWidth().clickable(enabled = canExpand, role = Role.Button) { open = !open }
            .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Glyph(DuduGlyphs.goal, size = 16, tint = tertiary)
            Text(triggerTitle(message.raw.optString("source")), Modifier.weight(1f), fontSize = 15.sp, color = tertiary)
            if (canExpand) Box(Modifier.rotate(if (open) 180f else 0f)) { Glyph(DuduGlyphs.down, size = 14, tint = tertiary) }
        }
        if (open && canExpand) Box(Modifier.heightIn(max = 240.dp).padding(start = 42.dp, end = 16.dp, bottom = 12.dp)
            .verticalScroll(rememberScrollState())) {
            SelectionContainer { Text(message.text, Modifier.fillMaxWidth(), fontSize = 12.sp, color = chatInk()) }
        }
    }
}

@Composable
private fun triggerTitle(source: String): String = when (source) {
    "goal" -> w("继续执行目标")
    "agent-message" -> w("收到任务消息")
    "team-message" -> w("收到团队消息")
    "subagent-settled" -> w("子任务状态更新")
    "github" -> w("收到 GitHub 事件")
    "webhook" -> w("收到外部事件")
    "schedule" -> w("自动化任务")
    "tool-jobs" -> w("后台任务状态更新")
    "cordis-host-runner" -> w("插件状态更新")
    else -> w("收到执行请求")
}

/**
 * A command of the conversation, or the history it folded (the iPhone's `CommandRowView`): the blue compaction or terminal glyph and name, a dot, the first line of its result (red when it
 * failed); a compaction's summary opens under it as quiet Markdown, 22 dp in. A command that is still running is drawn at 80 %.
 */
@Composable
internal fun CommandRow(message: Message) {
    val raw = message.raw
    val compaction = message.role == "compaction"
    val name = raw.optString("name")
    val error = !compaction && raw.optString("outcome") == "error"
    val running = !compaction && (!raw.has("outcome") || raw.isNull("outcome"))
    val isCompact = compaction || name == "compact"
    val summary = when {
        compaction -> if (raw.has("items") && !raw.isNull("items")) w("已压缩 {0} 条历史记录（约 {1} tokens）")
            .replace("{0}", raw.optInt("items").toString()).replace("{1}", raw.optInt("tokens", 0).toString()) else ""
        name == "compact" && running -> w("正在压缩…")
        name == "compact" -> raw.optJSONObject("compaction")?.takeIf { !error && it.has("items") && !it.isNull("items") }?.let {
            w("已压缩 {0} 条历史记录（约 {1} tokens）").replace("{0}", it.optInt("items").toString()).replace("{1}", it.optInt("tokens", 0).toString())
        } ?: compactCommandText(raw.optString("summary"), error)
        else -> raw.optString("summary").lineSequence().firstOrNull { it.isNotEmpty() }.orEmpty()
    }
    val detail = (if (compaction) raw.optString("summary") else if (name == "compact" && !error)
        raw.optJSONObject("compaction")?.optString("summary").orEmpty() else "").trim().takeIf { it.isNotEmpty() }
    var open by remember(message.id) { mutableStateOf(false) }
    val tertiary = chatTertiary()
    Column(Modifier.fillMaxWidth().testTag("chat-command-${message.id}"), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 24.dp).alpha(if (running) .8f else 1f)
            .clickable(enabled = detail != null, role = Role.Button) { open = !open },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Glyph(if (isCompact) DuduGlyphs.compact else DuduGlyphs.terminal, size = 14, tint = DuduStyle.blue)
            Text(if (compaction) w("上下文已压缩") else name, fontSize = 15.sp, color = DuduStyle.blue, maxLines = 1)
            if (summary.isNotEmpty()) {
                ProcessSeparator()
                Text(summary, Modifier.weight(1f), fontSize = 13.sp, lineHeight = 18.sp, maxLines = if (detail != null) 1 else 2,
                    overflow = TextOverflow.Ellipsis, color = if (error) chatError() else tertiary)
            } else Spacer(Modifier.weight(1f))
            if (detail != null) Box(Modifier.rotate(if (open) 90f else 0f)) { Glyph(DuduGlyphs.right, size = 14, tint = tertiary) }
        }
        if (open && detail != null) Box(Modifier.padding(start = 22.dp, top = 4.dp, bottom = 4.dp)) { Markdown(detail, compact = true) }
    }
}

/** The iPhone's `CommandText.message(for: .compact, …)`: DSH answers a compaction in English, and the replies it knows are said in the app's words. */
@Composable
private fun compactCommandText(summary: String, error: Boolean): String {
    val text = summary.trim()
    val numbers = Regex("\\d+").findAll(text).map { it.value }.toList()
    return when {
        text.startsWith("Compacted ") && numbers.size >= 2 ->
            w("已压缩 {0} 条历史（约 {1} tokens）").replace("{0}", numbers[0]).replace("{1}", numbers[1])
        text.startsWith("No compactable history") -> w("暂无可压缩的历史")
        text == "Compaction cancelled." -> w("压缩已取消")
        text.startsWith("Compaction is unavailable") -> w("当前无法压缩，请等会话空闲后再试")
        text.startsWith("The history selected for compaction changed") -> w("压缩期间历史发生了变化，请重试")
        text.startsWith("Compaction could not produce") -> w("未能生成有效摘要，请稍后重试")
        text.startsWith("Compaction did not finish cleanly") -> w("压缩未能完整完成，请检查会话状态")
        text.startsWith("Compaction finished, but") -> w("压缩已完成，但会话保存失败")
        text.isEmpty() -> if (error) w("压缩失败") else w("已压缩")
        else -> text
    }
}

/** A conversation with nothing in it yet (the iPhone's `ConversationEmptyState`): Dudu's logo, 44 dp, and 「探索未至之境」 in 26 sp medium, 10 dp apart, 24 dp from the sides. */
@Composable
internal fun ConversationEmptyState() {
    Row(Modifier.padding(horizontal = 24.dp).testTag("chat-empty"), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Image(painterResource(R.drawable.dudu), null, Modifier.size(44.dp))
        Text(w("探索未至之境"), fontSize = 26.sp, fontWeight = FontWeight.Medium, color = chatInk(), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A page of earlier history that could not be read, at the top of the history (the iPhone's `ConversationFailureView` in its controls row): the reason in red, 14 sp, and 重试 under it. */
@Composable
internal fun HistoryFailure(code: String, retry: () -> Unit) {
    Column(Modifier.fillMaxWidth().testTag("chat-history-failure"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        SelectionContainer { Text(problemText(code), fontSize = 14.sp, color = chatError()) }
        Text(w("重试"), Modifier.clickable(role = Role.Button, onClick = retry), fontSize = 14.sp, color = chatInk())
    }
}

/**
 * 选择 of the message menu (the iPhone's `MessageSelectionSheet`): the message's words on a white sheet, where part of them can be chosen and copied, under the title 选择 with 完成 on the right;
 * 20 dp from the edges, 32 dp under the last line.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MessageSelectionSheet(text: String, dismiss: () -> Unit) {
    DuduSheet(dismiss, containerColor = if (androidx.compose.foundation.isSystemInDarkTheme()) MaterialTheme.colorScheme.surface else Color.White) {
        CenterAlignedTopAppBar(
            title = { Text(w("选择"), maxLines = 1, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            expandedHeight = 52.dp, windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = Color.Transparent),
            actions = { TextButton(onClick = dismiss, modifier = Modifier.testTag("message-selection-close")) { Text(w("完成"), color = MaterialTheme.colorScheme.onSurface, fontWeight = FontWeight.SemiBold) } },
        )
        SelectionContainer(Modifier.weight(1f, fill = false)) {
            Text(text, Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 32.dp)
                .testTag("message-selection-text"), fontSize = 17.sp, lineHeight = 22.sp, color = chatInk())
        }
    }
}

/** The iPhone's `DuduStyle.chatInk`. */
@Composable
internal fun chatInk() = if (androidx.compose.foundation.isSystemInDarkTheme())
    MaterialTheme.colorScheme.onSurface else Color(0xFF0F1115)

/** The iPhone's `DuduStyle.chatError`. */
@Composable
internal fun chatError() = if (androidx.compose.foundation.isSystemInDarkTheme())
    MaterialTheme.colorScheme.error else Color(0xFFEC1313)

/** The iPhone's `DuduStyle.chatDivider`: black at 10 %. */
@Composable
internal fun chatDivider() = if (androidx.compose.foundation.isSystemInDarkTheme())
    MaterialTheme.colorScheme.outlineVariant else Color.Black.copy(alpha = .10f)

@Composable
internal fun chatTertiary() = if (androidx.compose.foundation.isSystemInDarkTheme())
    MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFF81858C)

@Composable
internal fun chatSecondary() = if (androidx.compose.foundation.isSystemInDarkTheme())
    MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFF61666B)

/** The blue of the running line: DSH's `--dsw-alias-label-deep-diving` (light `#4176e6` 70% with `#172554`; dark `#5686fe` 55% with `#adb2b8`), the iPhone's `DuduStyle.chatRunning` (owner, 2026-11-23: exactly as DSH draws it). */
@Composable
internal fun chatRunning() = if (androidx.compose.foundation.isSystemInDarkTheme()) Color(0xFF7D9ADF) else Color(0xFF345EBA)

/** DSH's `--dsw-alias-label-deep-diving-shimmer`: the colour of the highlight that crosses the running line (light `#4176e6` 30% with `#172554`; dark `#93c5fd` 65% with `#7aaaff`). */
@Composable
internal fun chatRunningHighlight() = if (androidx.compose.foundation.isSystemInDarkTheme()) Color(0xFF8ABCFE) else Color(0xFF243D80)

@Composable
internal fun chatPanel() = if (androidx.compose.foundation.isSystemInDarkTheme())
    MaterialTheme.colorScheme.surfaceContainer else Color(0xFFF9FAFB)

@Composable
internal fun chatBorder() = if (androidx.compose.foundation.isSystemInDarkTheme())
    MaterialTheme.colorScheme.outlineVariant else Color.Black.copy(alpha = .04f)

private fun normalizedTool(name: String) = name.substringAfterLast('.').lowercase(Locale.ROOT)

/** The iPhone's `ActivityKind`: a kind it does not know is `tools`. */
private val activityKinds = setOf("thinking", "read", "readImage", "search", "edit", "write", "commands", "code",
    "webSearch", "webFetch", "subagents", "plan", "questions", "tools")

private fun activity(call: JSONObject): String = call.nullableString("activity")?.let { if (it in activityKinds) it else "tools" } ?: when (normalizedTool(call.optString("name"))) {
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
    "thinking" -> DuduGlyphs.think
    "read", "readImage", "webFetch" -> DuduGlyphs.browse
    "search" -> DuduGlyphs.search
    "edit", "write" -> DuduGlyphs.compose
    "commands" -> DuduGlyphs.terminal
    "code" -> DuduGlyphs.code
    "webSearch" -> DuduGlyphs.globe
    "subagents" -> DuduGlyphs.model
    "plan" -> DuduGlyphs.plan
    "questions" -> DuduGlyphs.question
    else -> DuduGlyphs.skills
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
