@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import android.animation.ValueAnimator
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.layoutId
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.dudu.android.DuduViewModel
import app.dudu.android.data.CommandMessage
import app.dudu.android.data.ToastKind
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.cos

/**
 * The iPhone's `ComposerLayout` (`ComposerTextView.swift`): +, the text and the trailing buttons in one 44 dp row; when the text would run past one line beside them, or something is attached (not
 * in voice mode), the same text box takes the whole width (14 dp at its sides) and +, voice and send move to a row under it, their centres on the centres of the box's 28 dp corners (6 dp in).
 * The box is only placed elsewhere, never given another parent, so it keeps its focus, its caret and what is being composed. `wraps` says whether the text needs more than one line in a width (px).
 */
@Composable
internal fun ComposerRow(hasAttachments: Boolean, voice: Boolean, wraps: (Int) -> Boolean, modifier: Modifier = Modifier,
    plus: @Composable () -> Unit, text: @Composable () -> Unit, trailing: @Composable () -> Unit) {
    Layout(content = {
        Box(Modifier.layoutId(ComposerPart.Plus)) { plus() }
        Box(Modifier.layoutId(ComposerPart.Text), propagateMinConstraints = true) { text() }
        Box(Modifier.layoutId(ComposerPart.Trailing)) { trailing() }
    }, modifier) { measurables, constraints ->
        val action = 44.dp.roundToPx()
        val textInset = 14.dp.roundToPx()
        // max(0, corner radius 28 − half the 44 dp action)
        val actionInset = 6.dp.roundToPx()
        val width = constraints.maxWidth
        fun part(id: ComposerPart) = measurables.first { it.layoutId == id }
        val trailing = part(ComposerPart.Trailing).measure(Constraints(maxWidth = width, minHeight = action, maxHeight = action))
        val compact = (width - action - trailing.width).coerceAtLeast(1)
        val expanded = !voice && (hasAttachments || wraps(compact))
        val textWidth = if (expanded) (width - textInset * 2).coerceAtLeast(1) else compact
        val field = part(ComposerPart.Text).measure(Constraints(minWidth = textWidth, maxWidth = textWidth, minHeight = action))
        val plus = part(ComposerPart.Plus).measure(Constraints.fixed(action, action))
        val height = if (expanded) field.height + action + actionInset else maxOf(action, field.height)
        layout(width, height) {
            val inset = if (expanded) actionInset else 0
            val actionY = if (expanded) height - action - inset else 0
            plus.place(inset, actionY)
            field.place(if (expanded) textInset else action, 0)
            trailing.place(width - trailing.width - inset, actionY)
        }
    }
}

private enum class ComposerPart { Plus, Text, Trailing }

/**
 * DSH's task list of the conversation above the box, the iPhone's `TaskPanel`: folded to one 44 dp line (checklist, 任务, what is done · going on · waiting, ⋯) until it is opened, then the items
 * with a mark each (a green dot, a turning ring, a grey dot), at most 232 dp before it scrolls. It opens upward over the history, as the iPhone's does.
 */
@Composable
internal fun TaskPanel(todos: List<JSONObject>) {
    var expanded by remember { mutableStateOf(false) }
    val done = todos.count { it.optString("status") == "completed" }
    val active = todos.count { it.optString("status") == "in_progress" }
    val pending = todos.size - done - active
    val progress = listOfNotNull(
        if (done > 0) w("{0} 已完成").replace("{0}", done.toString()) else null,
        if (active > 0) w("{0} 进行中").replace("{0}", active.toString()) else null,
        if (pending > 0) w("{0} 待处理").replace("{0}", pending.toString()) else null,
    ).joinToString(" · ")
    val label = w("任务，{0}").replace("{0}", progress)
    val hint = if (expanded) w("点按收起") else w("点按展开")
    val states = Triple(w("已完成"), w("进行中"), w("待处理"))
    val pair = w("{0}，{1}")
    UpwardPanel(expanded, { expanded = false }, Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Surface(Modifier.fillMaxWidth().testTag("tasks-panel"), shape = RoundedCornerShape(16.dp), color = chatPanel(),
            border = BorderStroke(.5.dp, chatBorder())) {
            Column {
                Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(role = Role.Button, onClickLabel = hint) { expanded = !expanded }
                    .semantics(mergeDescendants = true) { contentDescription = label }
                    .padding(horizontal = 14.dp).testTag("tasks-toggle"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ChecklistGlyph(16, chatSecondary())
                    Text(w("任务"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = chatInk())
                    Text(progress, Modifier.weight(1f), fontSize = 13.sp, color = chatTertiary(), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Glyph(DuduGlyphs.options, size = 20, tint = chatTertiary())
                }
                if (expanded) Column(Modifier.heightIn(max = 232.dp).verticalScroll(rememberScrollState()).padding(bottom = 8.dp)) {
                    todos.forEach { item ->
                        val status = item.optString("status")
                        val content = item.optString("content")
                        val word = when (status) { "completed" -> states.first; "in_progress" -> states.second; else -> states.third }
                        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 5.dp)
                            .semantics(mergeDescendants = true) { contentDescription = pair.replace("{0}", content).replace("{1}", word) },
                            horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                            Box(Modifier.size(width = 16.dp, height = 22.dp), contentAlignment = Alignment.Center) { TaskStateMark(status) }
                            Text(content, Modifier.weight(1f), fontSize = 14.sp, lineHeight = 19.sp, color = chatSecondary())
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskStateMark(status: String) {
    when (status) {
        "completed" -> Box(Modifier.size(6.dp).background(Color(0xFF22C55E), CircleShape))
        "in_progress" -> TaskActivityRing()
        else -> Box(Modifier.size(6.dp).background(Color(0xFFD4D4D4), CircleShape))
    }
}

/** The iPhone's `TaskActivityRing`: a 14 dp ring whose arc breathes between 12 and 24 of its 24-unit drawing's 59.7 while it turns once every 1.5 s; still when motion is off or the app is behind. */
@Composable
private fun TaskActivityRing() {
    val tint = chatTertiary()
    val phase = if (motionOn()) rememberInfiniteTransition(label = "task-ring").animateFloat(0f, 1f,
        infiniteRepeatable(tween(1500, easing = LinearEasing)), label = "task-ring-phase") else null
    Canvas(Modifier.size(14.dp)) {
        val p = phase?.value ?: 0f
        val breath = if (phase == null) .5 else (1 - cos(p * 2 * PI)) / 2
        val circumference = 2 * PI * 9.5
        val unit = size.width / 14f
        val inset = 14f * 2.5f / 24f * unit
        val line = 14f / 12f * unit
        val diameter = size.width - inset * 2
        drawCircle(tint.copy(alpha = tint.alpha * .25f), diameter / 2, style = Stroke(line))
        rotate((p * 360 - 6 * breath / circumference * 360).toFloat()) {
            drawArc(tint, 0f, ((12 + 12 * breath) / circumference * 360).toFloat(), false, Offset(inset, inset),
                Size(diameter, diameter), style = Stroke(line, cap = StrokeCap.Round))
        }
    }
}

/**
 * The sheet that edits one text (the iPhone's `GoalEditorSheet` and `QueuedMessageEditor`): 取消, 编辑 in the middle and 保存 (a spinner while it saves) in the bar, the text in 16 sp on a 16 dp
 * rounded field with 12 dp inside, 20 dp around, and under it what went wrong in 13 sp red. It cannot be put away while it saves. `key` is what it edits: a new one starts from `initial` again.
 */
@Composable
internal fun TextEditSheet(key: Any, initial: String, saving: Boolean, error: String?, label: String? = null, focus: Boolean = false,
    tag: String = "", save: (String) -> Unit, close: () -> Unit) {
    var text by remember(key) { mutableStateOf(initial) }
    val requester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val page = MaterialTheme.colorScheme.background
    DuduSheet(close, containerColor = page, canDismiss = !saving) {
        CenterAlignedTopAppBar(
            title = { Text(w("编辑"), maxLines = 1, fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
            expandedHeight = 52.dp,
            windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.topAppBarColors(containerColor = page),
            navigationIcon = {
                TextButton(onClick = close, enabled = !saving, modifier = Modifier.testTag("$tag-cancel")) { Text(w("取消")) }
            },
            actions = {
                if (saving) Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = chatSecondary())
                } else TextButton(onClick = { save(text) }, enabled = text.isNotBlank(), modifier = Modifier.testTag("$tag-save")) {
                    Text(w("保存"))
                }
            },
        )
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            BasicTextField(text, { text = it }, enabled = !saving,
                modifier = Modifier.fillMaxWidth().heightIn(min = 200.dp).focusRequester(requester)
                    .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(16.dp)).padding(12.dp)
                    .semantics { label?.let { contentDescription = it } }.testTag("$tag-text"),
                textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 16.sp, color = chatInk()),
                cursorBrush = SolidColor(DuduStyle.blue))
            error?.let { Text(it, Modifier.fillMaxWidth().testTag("$tag-error"), fontSize = 13.sp, color = chatError()) }
        }
    }
    if (focus) LaunchedEffect(key) {
        withFrameNanos { }
        if (runCatching { requester.requestFocus() }.isSuccess) keyboard?.show()
    }
}

/**
 * A failure of what this page asked for, said in a toast at the top (the iPhone's `ChatFeedbackOverlay`, which shows `store.error` there) and then forgotten, so that the same failure again is said
 * again.
 */
@Composable
internal fun FailureToast(code: String?, model: DuduViewModel, clear: () -> Unit) {
    val text = code?.let { problemText(it) }
    val forget by rememberUpdatedState(clear)
    LaunchedEffect(code) {
        if (code == null || text == null) return@LaunchedEffect
        model.toast(text, ToastKind.Error, literal = true)
        forget()
    }
}

/** A command's words (`CommandText`) in the app's language. */
@Composable
internal fun CommandMessage.say(): String {
    var said = if (literal) text else w(text)
    args.forEachIndexed { index, value -> said = said.replace("{$index}", value) }
    return said
}

/** What went wrong in an editing sheet: the plugin's failure code, or a command's own words. */
internal sealed interface SheetError {
    data class Code(val code: String) : SheetError
    data class Words(val message: CommandMessage) : SheetError
}

@Composable
internal fun SheetError.say(): String = when (this) {
    is SheetError.Code -> problemText(code)
    is SheetError.Words -> message.say()
}
