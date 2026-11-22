package app.dudu.android.ui

import android.content.ClipData
import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChange
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.DuduViewModel
import app.dudu.android.data.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToInt

// 嘟嘟's conversation as a group chat, drawn as the iPhone draws it (`Views/GroupChatViews.swift`; owner, 2026-11-22: "做到和 ios 完全一致"). The owner's @ line is a bubble on the right
// (with the pictures sent with it above its words); the answer of an issue's agent is a white bubble on the left under the agent's logo, the issue's ID, the time and its title; while an answer is
// on its way the issue has three dots in its place; the result of a scheduled task is 嘟嘟's own words under a clock. Pulling an answer to the right answers it; a long press has 回复, 复制, 删除.

private val chatInk = Color(0xFF0F1115)
private val hairline = Color.Black.copy(alpha = .08f)
private val replyShape = RoundedCornerShape(topStart = 4.dp, topEnd = 18.dp, bottomEnd = 18.dp, bottomStart = 18.dp)
private val ownShape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp, bottomEnd = 4.dp, bottomStart = 24.dp)

/** How a picture written in a line's Markdown is drawn where it stands: a tile as wide as a picture sent alone, read by the line's own event; without that event, its words. */
private fun groupPicture(sessionId: String, seq: Long?, model: DuduViewModel): (@Composable (String, String) -> Unit)? = seq?.let { line ->
    { words, source -> Attachment(sessionId, json("kind" to "image", "name" to words, "source" to source), line, model, AttachmentImageStyle.Message) }
}

/** One line of the group (a command's entry with a `group`, or the dots/live answer `GroupChat.placingTyping` put in). `reply` puts the issue's @ into the box. */
@Composable
internal fun GroupLineRow(message: Message, sessionId: String, model: DuduViewModel, actions: Actions, reply: (JSONObject) -> Unit) {
    val raw = message.raw
    val line = raw.optJSONObject("group") ?: return
    val seq = if (raw.has("seq") && !raw.isNull("seq")) raw.optLong("seq") else null
    Box(Modifier.fillMaxWidth().padding(vertical = 2.dp).testTag("chat-group-${message.id}")) {
        when {
            raw.optBoolean("typing") -> GroupTypingBubble(line.optJSONObject("issue"))
            line.optString("kind") == "at" -> GroupAtBubble(line, seq, sessionId, model, actions, reply)
            line.optString("kind") == "task" -> GroupTaskLine(line, seq, sessionId, model, actions)
            else -> GroupGuestBubble(line, seq, raw.optBoolean("running"), sessionId, model, actions, reply)
        }
    }
}

@Composable
private fun ownBubble() = if (androidx.compose.foundation.isSystemInDarkTheme()) MaterialTheme.colorScheme.secondaryContainer else DuduStyle.bubble

@Composable
private fun ink() = if (androidx.compose.foundation.isSystemInDarkTheme()) MaterialTheme.colorScheme.onSurface else chatInk

@Composable
private fun replySurface() = if (androidx.compose.foundation.isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainer else Color.White

/** The owner's @ line: their bubble with the issue's `@ID` in blue, no tick and no notice (owner, 2026-11-11). Pictures sent with it stand in the bubble above the words (owner, 2026-11-22, 方案一). */
@Composable
private fun GroupAtBubble(line: JSONObject, seq: Long?, sessionId: String, model: DuduViewModel, actions: Actions, reply: (JSONObject) -> Unit) {
    val name = GroupChat.name(line.optJSONObject("issue"))
    val words = line.optString("text")
    val blue = DuduStyle.blue
    val ink = ink()
    val text = remember(name, words, ink) {
        buildAnnotatedString {
            withStyle(SpanStyle(color = blue)) { append("@$name") }
            withStyle(SpanStyle(color = ink)) { append(" $words") }
        }
    }
    val pictures = line.rows("pictures").filter { it.has("id") }
    val screen = LocalConfiguration.current.screenWidthDp
    var menu by remember { mutableStateOf(false) }
    val press = remember { PressPoint() }
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Box {
            val bubble = Modifier.notePress(press).clip(ownShape).background(ownBubble(), ownShape)
                .combinedClickable(onClick = {}, onLongClick = { menu = true })
            if (pictures.isEmpty()) Text(text, Modifier.widthIn(max = (screen * .82f).dp).then(bubble).padding(horizontal = 16.dp, vertical = 12.dp),
                fontSize = 17.sp, lineHeight = 26.sp)
            else Column(Modifier.width((minOf(screen * .56f, 260f) + 16f).dp).then(bubble)) {
                Column(Modifier.padding(start = 8.dp, end = 8.dp, top = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    pictures.forEachIndexed { index, picture ->
                        Attachment(sessionId, picture, if (picture.has("seq")) picture.getLong("seq") else seq, model,
                            if (index == 0) AttachmentImageStyle.BubbleFirst else AttachmentImageStyle.Bubble)
                    }
                }
                Text(text, Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 12.dp), fontSize = 17.sp, lineHeight = 26.sp)
            }
            GroupLineMenu(menu, { menu = false }, press, "@$name $words", line, seq, sessionId, model, actions, reply)
        }
    }
}

/**
 * The answer of an issue's agent: its logo (a tap opens the issue's conversation), its ID, the time and its title; the bubble is white with a hairline edge. Only answers longer than 1,000 characters
 * fold (owner, 2026-11-13), at eight lines under a fade with the white capsule 展开; it opens in place and has no 收起. A run that has not ended keeps its dots under the words.
 */
@Composable
private fun GroupGuestBubble(line: JSONObject, seq: Long?, running: Boolean, sessionId: String, model: DuduViewModel, actions: Actions, reply: (JSONObject) -> Unit) {
    val issue = line.optJSONObject("issue")
    val text = line.optString("text")
    val long = remember(text) { text.codePointCount(0, text.length) > 1000 }
    var expanded by remember { mutableStateOf(false) }
    val closed = long && !expanded
    var menu by remember { mutableStateOf(false) }
    val press = remember { PressPoint() }
    val surface = replySurface()
    val issueId = issue?.takeIf { it.has("id") && !it.isNull("id") }?.getLong("id")
    SwipeToReply(enabled = GroupChat.isAnswerable(line), onReply = { issue?.let(reply) }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(26.dp).clickable(enabled = issueId != null, onClickLabel = w("打开会话")) {
                if (issueId != null) model.openSession(null, issue?.optString("title").orEmpty(), issueId)
            }, contentAlignment = Alignment.Center) { AgentLogo(issue?.nullableString("agent"), 26) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                GroupSignature(issue, if (line.has("at")) line.optDouble("at") else null)
                Box {
                    Column(Modifier.fillMaxWidth().notePress(press).clip(replyShape).background(surface, replyShape).border(.75.dp, hairline, replyShape)
                        .combinedClickable(onClick = {}, onLongClick = { menu = true }).padding(horizontal = 14.dp, vertical = 10.dp)) {
                        Box(Modifier.fillMaxWidth().then(if (closed) Modifier.heightIn(max = 184.dp).clipToBounds() else Modifier)) {
                            Column(Modifier.fillMaxWidth().wrapContentHeight(Alignment.Top, unbounded = closed)) {
                                // A picture in the answer stands where it is written, read by the line's own event (the plugin's `session.attachment` names the line that grants it).
                                Markdown(text, selectable = false, picture = groupPicture(sessionId, seq, model))
                            }
                            if (closed) {
                                Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(76.dp)
                                    .background(Brush.verticalGradient(listOf(surface.copy(alpha = 0f), surface))))
                                FoldCapsule(Modifier.align(Alignment.BottomCenter).offset(y = 2.dp)) { expanded = true }
                            }
                        }
                        if (running) ReplyDots(Modifier.padding(top = 8.dp).height(14.dp))
                    }
                    GroupLineMenu(menu, { menu = false }, press, text, line, seq, sessionId, model, actions, reply)
                }
            }
        }
    }
}

/** The ID is the name, then the time, then the title as the signature (owner, 2026-11-10: "签名放在时间的后面"). */
@Composable
private fun GroupSignature(issue: JSONObject?, at: Double?) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val locale = appLocale()
    Row(Modifier.height(26.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(GroupChat.name(issue), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = chatSecondary(), maxLines = 1, softWrap = false)
        if (at != null) Text(groupClock(at, locale), fontSize = 12.sp, color = muted, maxLines = 1, softWrap = false)
        Text(issue?.optString("title").orEmpty(), fontSize = 13.sp, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** The time of a line: the hour today, the day and hour this year, the full date before (the iPhone's `TranscriptTitles.clock`). */
internal fun groupClock(at: Double, locale: Locale, now: Long = System.currentTimeMillis()): String {
    val date = Calendar.getInstance().apply { timeInMillis = at.toLong() }
    val today = Calendar.getInstance().apply { timeInMillis = now }
    val sameYear = date.get(Calendar.YEAR) == today.get(Calendar.YEAR)
    val skeleton = if (sameYear && date.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR)) "jmm" else if (sameYear) "MMMdjmm" else "yMMMdjmm"
    return SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(locale, skeleton), locale).format(Date(at.toLong()))
}

/** The owner's existing white capsule, 36 dp with 16 sp words and a 52 dp touch area (2026-11-13). */
@Composable
private fun FoldCapsule(modifier: Modifier, open: () -> Unit) {
    Box(modifier.clickable(remember { MutableInteractionSource() }, indication = null, onClick = open).padding(8.dp).testTag("chat-group-fold")) {
        Box(Modifier.height(36.dp).shadow(4.dp, CircleShape, ambientColor = Color.Black.copy(alpha = .08f), spotColor = Color.Black.copy(alpha = .08f))
            .background(Color.White, CircleShape).border(.75.dp, hairline, CircleShape).padding(horizontal = 20.dp), contentAlignment = Alignment.Center) {
            Text(w("展开"), fontSize = 16.sp, color = chatInk)
        }
    }
}

/** The dots of an issue that has been written to and has not answered yet, in the place of its answer. */
@Composable
private fun GroupTypingBubble(issue: JSONObject?) {
    val surface = replySurface()
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.Top) {
        Box(Modifier.size(26.dp), contentAlignment = Alignment.Center) { AgentLogo(issue?.nullableString("agent"), 26) }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.height(26.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(GroupChat.name(issue), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = chatSecondary(), maxLines = 1, softWrap = false)
                Text(issue?.optString("title").orEmpty(), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Box(Modifier.height(34.dp).clip(replyShape).background(surface, replyShape).border(.75.dp, hairline, replyShape)
                .padding(horizontal = 14.dp), contentAlignment = Alignment.Center) { ReplyDots() }
        }
    }
}

/** Three 6 dp dots, each fading in and out over 0.6 s a fifth of a second after the one before; still when animations are off. */
@Composable
private fun ReplyDots(modifier: Modifier = Modifier) {
    val animates = motionOn()
    val transition = rememberInfiniteTransition(label = "dots")
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        repeat(3) { index ->
            val alpha = if (animates) transition.animateFloat(.35f, 1f, infiniteRepeatable(tween(600, easing = FastOutSlowInEasing),
                RepeatMode.Reverse, StartOffset(index * 200)), label = "dot$index").value else .7f
            Box(Modifier.size(6.dp).graphicsLayer { this.alpha = alpha }.background(MaterialTheme.colorScheme.onSurfaceVariant, CircleShape))
        }
    }
}

/**
 * The result of a scheduled task that 嘟嘟 did itself: 嘟嘟's own words, no bubble and no picture, under a clock, the task's name and the time. A run that failed says 运行失败 and the reason.
 * Nothing to answer: the long press has 复制 and 删除, and a pull does nothing.
 */
@Composable
private fun GroupTaskLine(line: JSONObject, seq: Long?, sessionId: String, model: DuduViewModel, actions: Actions) {
    val failed = w("运行失败")
    val joined = w("{0}：{1}")
    val text = GroupChat.taskText(line, failed) { a, b -> joined.replace("{0}", a).replace("{1}", b) }
    var menu by remember { mutableStateOf(false) }
    val press = remember { PressPoint() }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val locale = appLocale()
    Box {
        Column(Modifier.fillMaxWidth().notePress(press).combinedClickable(onClick = {}, onLongClick = { menu = true }),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.height(20.dp), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Glyph(DuduGlyphs.schedule, size = 13, tint = muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(line.optJSONObject("task")?.optString("title").orEmpty(), fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
                        color = chatSecondary(), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (line.has("at")) Text(groupClock(line.optDouble("at"), locale), fontSize = 12.sp, color = muted, maxLines = 1, softWrap = false)
                }
            }
            if (text.isNotEmpty()) Markdown(text, selectable = false, picture = groupPicture(sessionId, seq, model))
        }
        GroupLineMenu(menu, { menu = false }, press, text, null, seq, sessionId, model, actions) {}
    }
}

/** The long-press menu of a line of the group: 回复 (only on an issue's line), 复制, 删除 (hides the line from this view only: DSH's log and 嘟嘟's memory keep it). */
@Composable
private fun GroupLineMenu(open: Boolean, dismiss: () -> Unit, press: PressPoint, copied: String, line: JSONObject?, seq: Long?, sessionId: String,
    model: DuduViewModel, actions: Actions, reply: (JSONObject) -> Unit) {
    val clipboard = LocalClipboard.current
    val coroutine = rememberCoroutineScope()
    val danger = MaterialTheme.colorScheme.error
    DropdownMenu(open, dismiss, offset = press.menuOffset()) {
        if (line != null && GroupChat.isAnswerable(line)) DropdownMenuItem(text = { Text(w("回复")) }, leadingIcon = { InboxGlyph(DuduGlyphs.reply, 18) },
            onClick = { dismiss(); reply(line.getJSONObject("issue")) })
        DropdownMenuItem(text = { Text(w("复制")) }, leadingIcon = { InboxGlyph(DuduGlyphs.copy, 18) },
            onClick = { dismiss(); coroutine.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("message", copied))) } })
        if (seq != null) DropdownMenuItem(text = { Text(w("删除"), color = danger) }, leadingIcon = { InboxGlyph(DuduGlyphs.trash, 18, danger) },
            onClick = { dismiss(); actions.run {
                model.request("assistant.hide", json("sessionId" to sessionId, "seqs" to JSONArray(listOf(seq))))
            } })
    }
}

/**
 * Pulling a message to the right shows the circle with the reply arrow and, past the threshold, answers it (the iPhone's `SwipeToReply`, measured from the owner's own recording of a chat app): the row
 * follows the finger one to one up to 88 dp; the circle is 32 dp, centred where the picture of the row is, white with a hairline until 76 dp and then flat grey, popping to 37 dp and back with a ring
 * that spreads to 63 dp; on release the circle fades and the row is back in about 0.2 s, with no bounce. Only a drag that goes right more than one and a half times as much as it goes up or down is
 * taken; anything else is the history's to scroll, and a drag that began inside something scrolling sideways (a code block, a table) stays there.
 */
@Composable
internal fun SwipeToReply(enabled: Boolean, onReply: () -> Unit, content: @Composable () -> Unit) {
    if (!enabled) { content(); return }
    val density = LocalDensity.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val maxPull = with(density) { 88.dp.toPx() }
    val threshold = with(density) { 76.dp.toPx() }
    val start = with(density) { 14.dp.toPx() }
    val span = with(density) { 46.dp.toPx() }
    val pull = remember { Animatable(0f) }
    val pop = remember { Animatable(1f) }
    val ripple = remember { Animatable(0f) }
    val fade = remember { Animatable(1f) }
    var active by remember { mutableStateOf(false) }
    val reply by rememberUpdatedState(onReply)
    fun update(distance: Float) {
        val value = distance.coerceIn(0f, maxPull)
        scope.launch { fade.snapTo(1f); pull.snapTo(value) }
        if (value >= threshold && !active) {
            active = true
            haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            scope.launch {
                pop.animateTo(37f / 32f, spring(dampingRatio = .55f, stiffness = 1542f))
                delay(80)
                pop.animateTo(1f, spring(dampingRatio = .8f, stiffness = 987f))
            }
            // The ring spreads from the circle's own size after the circle has taken its grey.
            scope.launch { delay(16); ripple.snapTo(0f); ripple.animateTo(1f, tween(150, easing = LinearOutSlowInEasing)) }
        } else if (value < threshold && active) {
            active = false
            scope.launch { ripple.snapTo(0f); pop.snapTo(1f) }
        }
    }
    fun finish(completed: Boolean) {
        val answered = completed && active
        active = false
        scope.launch { fade.animateTo(0f, tween(100)) }
        scope.launch { pull.animateTo(0f, spring(dampingRatio = 1f, stiffness = 987f)) }
        scope.launch { ripple.snapTo(0f); pop.snapTo(1f) }
        if (answered) reply()
    }
    DisposableEffect(Unit) { onDispose { active = false } }
    Box(Modifier.fillMaxWidth().pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            var total = Offset.Zero
            var dragging = false
            var completed = false
            while (true) {
                val event = awaitPointerEvent()
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                if (!change.pressed) { completed = true; break }
                if (!dragging) {
                    if (change.isConsumed) break
                    total += change.positionChange()
                    if (total.getDistance() < viewConfiguration.touchSlop) continue
                    if (total.x > 0 && abs(total.x) > abs(total.y) * 1.5f) dragging = true else break
                } else total += change.positionChange()
                change.consume()
                update(total.x)
            }
            if (dragging) finish(completed)
        }
    }) {
        val shown = ((pull.value - start) / span).coerceIn(0f, 1f)
        val circle = Modifier.size(32.dp)
        Box(Modifier.align(Alignment.CenterStart).offset { IntOffset(with(density) { (-3.dp.toPx() - (1 - shown) * start).roundToInt() }, 0) }
            .then(circle).graphicsLayer { alpha = fade.value * shown }, contentAlignment = Alignment.Center) {
            Box(circle.graphicsLayer {
                val scale = 1f + ripple.value * (63f / 32f - 1f)
                scaleX = scale; scaleY = scale
                alpha = if (active) (1f - ripple.value) * .5f else 0f
            }.border(1.dp, Color.Black.copy(alpha = .12f), CircleShape))
            Box(circle.graphicsLayer { scaleX = pop.value; scaleY = pop.value }
                .background(if (active) Color(0xFFE4E4E4) else Color.White, CircleShape)
                .border(1.dp, Color.Black.copy(alpha = if (active) 0f else .08f), CircleShape), contentAlignment = Alignment.Center) {
                Glyph(DuduGlyphs.reply, size = 18, tint = Color(0xFF595E67))
            }
        }
        Box(Modifier.offset { IntOffset(pull.value.roundToInt(), 0) }) { content() }
    }
}
