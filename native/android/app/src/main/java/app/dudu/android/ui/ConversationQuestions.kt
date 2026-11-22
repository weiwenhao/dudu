package app.dudu.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.DuduViewModel
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

/**
 * The questions whose sheet has already opened by itself (owner, 2026-11-21: 「提问框没有默认弹出来啊，还要我自己去点开」), as on the iPhone: a question opens its sheet once, the first time the chat shows it and
 * nothing is in the way; closing the sheet hides it for good and the 「回答问题」 line opens it again.
 */
internal object QuestionAutoOpen {
    private val opened = ArrayDeque<String>()

    /** True once for each question. */
    fun claim(id: String): Boolean {
        if (id in opened) return false
        opened.addLast(id)
        while (opened.size > 100) opened.removeFirst()
        return true
    }
}

@Composable
fun Questions(batch: JSONObject, sessionId: String, connected: Boolean, model: DuduViewModel, autoOpen: Boolean = false,
    onPresentationChange: (Boolean) -> Unit) {
    val questions = batch.rows("questions")
    if (questions.isEmpty()) return
    val batchId = batch.getString("id")
    val specs = questions.map { QuestionSpec(it.getString("id"),
        it.rows("options").map { option -> option.getString("label") }, it.optBoolean("multiSelect")) }
    // The sheet may be removed on close/back/outside tap. Neither its drafts nor its send scope live there.
    val actions = rememberActions()
    var draft by remember(sessionId, batchId) { mutableStateOf(QuestionDraft()) }
    var presented by remember(sessionId, batchId) { mutableStateOf(false) }
    var submitted by remember(sessionId, batchId) { mutableStateOf(false) }
    var problem by remember(sessionId, batchId) { mutableStateOf<QuestionProblem?>(null) }
    DisposableEffect(presented) {
        onPresentationChange(presented)
        onDispose { if (presented) onPresentationChange(false) }
    }
    // The chat is in front and nothing else is open (`autoOpen`): the question's sheet opens by itself, once.
    LaunchedEffect(batchId, autoOpen, connected, submitted) {
        if (autoOpen && connected && !submitted && !presented && QuestionAutoOpen.claim(batchId)) {
            presented = true
            DuduLog.record("question.sheet.open")
        }
    }
    if (submitted) return

    fun dismiss() {
        presented = false
        DuduLog.record("question.sheet.close")
    }
    fun advance(skipping: Boolean) {
        if (actions.busy || !connected) return
        val result = draft.advance(specs, skipping)
        draft = result.draft
        problem = result.problem
        actions.error = null
        val answers = result.answers ?: return
        actions.run {
            DuduLog.record("question.answer.begin", counts = mapOf("rowCount" to answers.size.toLong()))
            try {
                val accepted = model.value("question.answer", json("id" to sessionId, "callId" to batchId,
                    "answers" to JSONArray(answers.map { reply ->
                        json("id" to reply.id, "selected" to JSONArray(reply.selected)).apply {
                            reply.custom?.let { text -> put("custom", text) }
                        }
                    })))
                if (accepted != true) throw ApiFailure("STALE_APPROVAL")
                submitted = true
                presented = false
                DuduLog.record("question.answer.complete")
            } catch (error: Exception) {
                if (error !is CancellationException) DuduLog.failure("question.answer.fail", error, method = "question.answer")
                throw error
            }
        }
    }

    TextButton(onClick = {
        presented = true
        DuduLog.record("question.sheet.open")
    }, contentPadding = PaddingValues(0.dp), colors = ButtonDefaults.textButtonColors(contentColor = DuduStyle.blue),
        modifier = Modifier.heightIn(min = 48.dp).testTag("chat.questions.$batchId")) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Text(w("回答问题"), fontSize = 15.sp, fontWeight = FontWeight.Medium)
            QuestionProgress(draft.index, questions.size, 12)
            Glyph(DuduGlyphs.right, size = 14, tint = DuduStyle.blue)
        }
    }
    if (presented) DuduSheet(::dismiss) {
        QuestionSheet(
            question = questions[draft.index], spec = specs[draft.index], draft = draft,
            count = questions.size, continued = batch.optString("state") == "continued",
            busy = actions.busy, connected = connected, problem = problem, error = actions.error,
            dismiss = ::dismiss,
            toggle = { draft = draft.toggle(specs[draft.index], it); problem = null; actions.error = null },
            edit = { draft = draft.edit(specs[draft.index], it); problem = null; actions.error = null },
            previous = { draft = draft.previous(); problem = null; actions.error = null },
            advance = ::advance,
        )
    }
}

@Composable
private fun QuestionProgress(index: Int, count: Int, size: Int) {
    Text("${index + 1} / $count", color = MaterialTheme.colorScheme.onSurfaceVariant,
        style = MaterialTheme.typography.bodySmall.copy(fontSize = size.sp, fontFeatureSettings = "tnum"))
}

@Composable
private fun QuestionSheet(
    question: JSONObject, spec: QuestionSpec, draft: QuestionDraft, count: Int, continued: Boolean,
    busy: Boolean, connected: Boolean, problem: QuestionProblem?, error: String?,
    dismiss: () -> Unit, toggle: (String) -> Unit, edit: (String) -> Unit,
    previous: () -> Unit, advance: (Boolean) -> Unit,
) {
    val focus = LocalFocusManager.current
    val textMeasurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val titleStyle = MaterialTheme.typography.titleMedium
    val title = question.optString("question")
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val titleWidth = with(density) { (maxWidth - 112.dp).roundToPx().coerceAtLeast(1) }
        val shortTitle = !title.contains('\n') && !textMeasurer.measure(AnnotatedString(title), titleStyle,
            maxLines = 1, constraints = Constraints(maxWidth = titleWidth)).hasVisualOverflow
        Column(Modifier.fillMaxWidth().testTag("question.sheet")) {
            SheetHeader(if (shortTitle) title else question.nullableString("header") ?: w("回答问题"), dismiss)
            key(spec.id) {
                Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp).padding(top = 8.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (!shortTitle) Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                    question.nullableString("detail")?.takeIf(String::isNotBlank)?.let { Markdown(it, compact = true) }
                    if (continued) Text(w("已继续工作，仍可回答"), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    QuestionAnswerGroup(question, spec, draft, busy, toggle = {
                        focus.clearFocus(); toggle(it)
                    }, edit = edit)
                    if (problem != null) Text(
                        when (problem) {
                            QuestionProblem.AnswerRequired -> w("请选择一个选项或填写自定义答案。")
                            QuestionProblem.Incomplete -> w("请先完成这道问题。")
                        }, color = MaterialTheme.colorScheme.error, fontSize = 14.sp)
                    error?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error, fontSize = 14.sp) }
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 16.dp),
                verticalAlignment = Alignment.CenterVertically) {
                if (draft.index > 0) {
                    OutlinedButton(onClick = { focus.clearFocus(); previous() }, enabled = !busy && connected,
                        shape = CircleShape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        colors = ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.surface),
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        modifier = Modifier.widthIn(min = 84.dp).heightIn(min = 48.dp).testTag("question.previous")) {
                        Text(w("上一题"), fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    }
                    Spacer(Modifier.width(20.dp))
                }
                QuestionProgress(draft.index, count, 13)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { focus.clearFocus(); advance(true) }, enabled = !busy && connected,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
                    contentPadding = PaddingValues(horizontal = 8.dp),
                    modifier = Modifier.widthIn(min = 48.dp).heightIn(min = 48.dp)) {
                    Text(w("跳过"), fontSize = 15.sp, fontWeight = FontWeight.Medium)
                }
                Spacer(Modifier.width(12.dp))
                Button(onClick = { focus.clearFocus(); advance(false) }, enabled = !busy && connected, shape = CircleShape,
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    modifier = Modifier.widthIn(min = 104.dp).heightIn(min = 48.dp).testTag("question.submit"),
                    colors = ButtonDefaults.buttonColors(disabledContainerColor = MaterialTheme.colorScheme.primary,
                        disabledContentColor = MaterialTheme.colorScheme.onPrimary)) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(if (draft.index == count - 1) w("提交") else w("下一题"),
                            fontSize = 15.sp, fontWeight = FontWeight.Medium,
                            modifier = Modifier.alpha(if (busy) 0f else 1f))
                        if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 1.8.dp,
                            color = MaterialTheme.colorScheme.onPrimary)
                    }
                }
            }
        }
    }
}

@Composable
private fun QuestionAnswerGroup(
    question: JSONObject, spec: QuestionSpec, draft: QuestionDraft, busy: Boolean,
    toggle: (String) -> Unit, edit: (String) -> Unit,
) {
    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
        Column {
            question.rows("options").forEach { option ->
                val label = option.getString("label")
                val selected = label in draft.selected[spec.id].orEmpty()
                Row(Modifier.fillMaxWidth().selectable(selected, enabled = !busy,
                    role = if (spec.multiSelect) Role.Checkbox else Role.RadioButton, onClick = { toggle(label) })
                    .heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 12.dp)
                    .testTag("question.option.${spec.id}.$label"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(label, fontSize = 16.sp)
                        option.nullableString("description")?.takeIf(String::isNotBlank)?.let {
                            Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (spec.multiSelect) Checkbox(selected, onCheckedChange = null, modifier = Modifier.size(20.dp),
                        colors = CheckboxDefaults.colors(uncheckedColor = MaterialTheme.colorScheme.onSurfaceVariant))
                    else RadioButton(selected, onClick = null, modifier = Modifier.size(20.dp),
                        colors = RadioButtonDefaults.colors(unselectedColor = MaterialTheme.colorScheme.onSurfaceVariant))
                }
            }
            val value = draft.custom[spec.id].orEmpty()
            BasicTextField(value, edit, enabled = !busy,
                modifier = Modifier.fillMaxWidth().testTag("question.custom.${spec.id}"),
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                minLines = if (spec.options.isEmpty()) 3 else 1, maxLines = 8,
                cursorBrush = SolidColor(DuduStyle.blue),
                decorationBox = { inner ->
                    Box(Modifier.fillMaxWidth().heightIn(min = if (spec.options.isEmpty()) 112.dp else 52.dp).padding(16.dp)) {
                        if (value.isEmpty()) Text(w("输入你的答案"), style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        inner()
                    }
                })
        }
    }
}
