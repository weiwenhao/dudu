@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.dudu.android.ui

import android.Manifest
import android.content.ClipData
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.interaction.DragInteraction
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.IntOffset
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.text.font.FontWeight
import kotlin.math.roundToInt
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import app.dudu.android.media.AndroidSpeechCapture
import app.dudu.android.media.VoiceProblem
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

/** Further than any row is tall: `scrollToItem(last, END)` lands on the very end of the history, not on the top of its last row. */
private const val END = 1_000_000

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
    var queueEditing by remember { mutableStateOf<Message?>(null) }
    // The edit sheet's failure, a key of the app's words (`word`).
    var queueEditorError by remember { mutableStateOf<String?>(null) }
    // The one change of the queue on its way: the message and `edit`, `remove` or `steer` (the iPhone's `QueueUpdate`).
    var queueUpdate by remember { mutableStateOf<Pair<String, String>?>(null) }
    var goalWorking by remember { mutableStateOf(false) }
    // + → 目标 without a goal: the box takes the goal's words and keeps the draft (the iPhone's `ComposerIntent.goal`); the blue /目标 before them goes back to a message.
    var goalIntent by remember { mutableStateOf(false) }
    var goalEditor by remember { mutableStateOf<JSONObject?>(null) }
    var goalEditorError by remember { mutableStateOf<SheetError?>(null) }
    var planChanging by remember { mutableStateOf(false) }
    var compacting by remember { mutableStateOf(false) }
    var stopping by remember { mutableStateOf(false) }
    var planPreview by remember { mutableStateOf<JSONObject?>(null) }
    // A failure of what this page asked for (a command, stopping): said in a toast, then forgotten.
    var failure by remember { mutableStateOf<String?>(null) }
    // The box of 嘟嘟's conversation, as the iPhone's (`AssistantCompletions`, `ComposerTextView`): an `@` at its start lists the issues to write to and a `/` the skills, by where the caret is;
    // Chinese being composed is left alone. The box keeps its own value (text, caret, composition) and hands the text to the model as ever.
    var field by remember { mutableStateOf(TextFieldValue(state.message, TextRange(state.message.length))) }
    var completionQuery by remember { mutableStateOf<GroupChat.Query?>(null) }
    var completions by remember { mutableStateOf<List<Completion>>(emptyList()) }
    var completionStatus by remember { mutableStateOf(CompletionStatus.Ready) }
    var skillList by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var skillsLoaded by remember { mutableStateOf(false) }
    // After 回复: the draft it wrote and the issue's title, drawn in grey after the `@ID ` until the draft changes.
    var replyGhost by remember { mutableStateOf<Pair<String, String>?>(null) }
    var fieldLayout by remember { mutableStateOf<TextLayoutResult?>(null) }
    // Where the box starts in the bottom controls: the fade behind them is solid from there down.
    var composerTop by remember { mutableFloatStateOf(0f) }
    var quickSheet by remember { mutableStateOf<String?>(null) }
    var questionSheetId by remember { mutableStateOf<String?>(null) }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val locale = appLocale()
    val picker = rememberAttachmentPicker(state, model, actions)
    val voiceTarget = session?.let { VoiceTarget(state.computerId, it.id) }
    val capture = remember(voiceTarget) { AndroidSpeechCapture(context.applicationContext) }
    var isVoiceMode by remember(voiceTarget) { mutableStateOf(false) }
    var permissionTarget by remember { mutableStateOf<VoiceTarget?>(null) }
    val voiceTouch = remember { VoiceTouch() }
    val microphone = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted && permissionTarget == voiceTarget) capture.microphoneDenied()
        permissionTarget = null
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    val inputFocus = remember { FocusRequester() }
    DisposableEffect(capture, lifecycle) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) capture.cancel() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer); capture.cancel() }
    }
    LaunchedEffect(capture, state.route, state.panel, state.readOnly, attachmentMenu, quickSheet, questionSheetId, controls, permissions) {
        if (state.route != null || state.panel != null || state.readOnly ||
            attachmentMenu || quickSheet != null || questionSheetId != null || controls || permissions) capture.cancel()
    }
    LaunchedEffect(capture.result, state.sending, state.route, state.panel, attachmentMenu, quickSheet, questionSheetId, controls, permissions) {
        capture.result?.let { result ->
            if (state.route != null || state.panel != null || attachmentMenu || quickSheet != null || questionSheetId != null || controls || permissions) {
                capture.cancel()
                return@LaunchedEffect
            }
            if (model.acceptVoice(result)) {
                capture.consumeResult()
                if (!result.isFinal) isVoiceMode = false
            }
        }
    }
    val canSend = state.message.isNotBlank() || state.attachments.isNotEmpty()
    // The iPhone's `isProcessingMessage` / `showsInputModeToggle`: while the agent runs, a message is on its way or the history is being compacted, the box has voice beside stop or send.
    val processing = session?.processing == true || state.sending || compacting
    val showsModeToggle = processing || isVoiceMode || !canSend
    val history = session?.displayRows.orEmpty()
    // The history, then what the computer has taken for the agent's next step, then what this phone is still sending.
    val all = remember(session, state.outbox) {
        val taken = history.mapTo(HashSet()) { it.id }
        val steering = session?.pendingInputs.orEmpty().filter { taken.add(it.id) }
        // A message sent while the agent ran waits in the queue's panel from the start (below), not here.
        val waiting = state.outbox.filterNot { it.failed || it.queued || session?.observed(it.requestId) == true }
            .map { it.message() }.filter { taken.add(it.id) }
        history + (steering + waiting).map(TranscriptRow::Entry)
    }
    // What waits for the agent's turn to end: the computer's own queue, then what this phone sent into it and the computer has not listed yet (the iPhone's `displayedQueuedMessages`).
    val queueRows = remember(session, state.outbox) {
        session?.queue.orEmpty() + state.outbox.filter { it.queued && !it.failed && session?.observed(it.requestId) != true }.map { it.queuedMessage() }
    }
    val hasOlder = session?.transcript?.optBoolean("hasMore") == true
    val prompts = if (session != null && !session.cached && !state.readOnly)
        session.raw.rows("questions").size + session.raw.rows("approvals").size else 0
    // The iPhone's `hasConversationContent`: without it the page shows 探索未至之境 (or the wait while it is being read) and no row at all.
    val hasContent = all.isNotEmpty() || (session != null && !session.cached && !state.readOnly && session.raw.rows("questions").isNotEmpty())
    // A page of earlier history that could not be read is said at the top of the history, with 重试 (the iPhone's `ConversationHistoryItem.controls`).
    val controlsRow = if (session != null && state.pageFailure != null && hasContent) 1 else 0
    // The running line is the history's last row, after what was sent, the questions and the approvals, and it is there before the turn has begun (the iPhone's `ConversationHistoryItem.running`).
    val showsRunning = session != null && session.transcript != null && session.processing && hasContent
    val runningStart = if (showsRunning) history.lastOrNull { it is TranscriptRow.Turn && it.running }?.let { (it as TranscriptRow.Turn).startedAt } else null
    val separators = remember(history) { timeSeparators(history) }
    val lastIndex = controlsRow + all.size + prompts + (if (showsRunning) 1 else 0) - 1
    val density = LocalDensity.current
    // The page is keyed by the conversation, so this lives as long as the conversation is open. (It was keyed by the session's id,
    // which arrives after the page: the collector below then wrote into the first copy and the button never showed.)
    var following by remember { mutableStateOf(true) }
    var landed by remember { mutableStateOf(false) }
    var dragging by remember { mutableStateOf(false) }
    val end by rememberUpdatedState(lastIndex)
    // The iPhone's rule (`ChatScrollPosition.isAwayFromEnd`): a tenth of the viewport above the end, and never less than 120 dp.
    val awayFromEnd by remember { derivedStateOf {
        val info = list.layoutInfo
        val last = info.visibleItemsInfo.lastOrNull()
        if (info.totalItemsCount == 0 || last == null) false
        else if (last.index != info.totalItemsCount - 1) true
        else last.offset + last.size + info.afterContentPadding - info.viewportEndOffset >
            maxOf(with(density) { 120.dp.roundToPx() }, info.viewportSize.height / 10)
    } }
    LaunchedEffect(list) {
        launch { list.interactionSource.interactions.collect { if (it is DragInteraction.Start) dragging = true } }
        launch { snapshotFlow { list.isScrollInProgress }.collect { if (!it) dragging = false } }
        // A finger that moves the history away from its end stops the following at once; one that brings it to the very end resumes it.
        launch { snapshotFlow { Triple(dragging, list.isScrollInProgress, list.canScrollForward) }
            .collect { (byHand, moving, more) -> if (byHand && moving) following = !more } }
        // While following, the history stays at its very end whatever grows: a new row, a reply being written, a picture, the keyboard.
        // A streaming reply keeps `canScrollForward` continuously true, so this reads it fresh every frame rather than waiting for a
        // snapshotFlow transition that a value stuck at `true` would never re-emit.
        while (true) {
            withFrameNanos { }
            if (following && !dragging && !list.isScrollInProgress && list.canScrollForward && end >= 0) list.scrollToItem(end, END)
        }
    }
    LaunchedEffect(lastIndex >= 0) {
        if (lastIndex < 0) return@LaunchedEffect
        list.scrollToItem(lastIndex, END)
        landed = true
    }
    // Reaching the first loaded row brings the page before it, as on the iPhone (owner, 2026-11-19: "拉到了顶部没有自动加载更早").
    // Once for that row: a page that failed is asked for again by leaving the top and coming back. The row the reader is on keeps its
    // place by its key, which is why the wait is drawn over the list and is not a row of it.
    val wantsOlder by rememberUpdatedState(hasOlder && !state.pageLoading && session?.cached == false)
    val firstRow by rememberUpdatedState(all.firstOrNull()?.id)
    LaunchedEffect(list) {
        var asked: String? = null
        snapshotFlow { Triple(landed && list.firstVisibleItemIndex == 0, wantsOlder, firstRow) }.collect { (atStart, wanted, first) ->
            if (!atStart) asked = null
            else if (wanted && first != null && first != asked) { asked = first; model.older() }
        }
    }
    // What went wrong is said in a toast at the top, as on the iPhone (`ChatFeedbackOverlay`): the conversation's own problem (not the connection's, which the board says), what this page asked for.
    // A panel or a page over the conversation says its own problem (`Panels`, the pairing form, the quota): only the conversation's, while it is in front.
    FailureToast(state.problem?.takeUnless { isConnectionProblem(it) || state.panel != null || state.route != null }, model) { model.clearProblem() }
    FailureToast(actions.error, model) { actions.error = null }
    FailureToast(failure, model) { failure = null }
    // Voice's problems too (the iPhone's `capture.notice`); the speech service's own missing permission stays a line to tap, under the queue.
    LaunchedEffect(capture.problem) {
        when (capture.problem) {
            VoiceProblem.Microphone -> model.toast(word("请允许麦克风权限。"), ToastKind.Error)
            VoiceProblem.Unavailable -> model.toast(word("语音识别暂不可用。"), ToastKind.Error)
            else -> Unit
        }
    }
    // A goal that changed or went closes its edit sheet; a waiting message that left the queue closes its own (the iPhone's `onChange(of: store.goal?.id)`, `onChange(of: store.queuedMessages)`).
    LaunchedEffect(session?.raw?.optJSONObject("goal")?.optString("id")) { goalEditor = null }
    LaunchedEffect(queueRows.map { it.id }) {
        queueEditing?.let { editing -> if (queueRows.none { it.id == editing.id }) queueEditing = null }
    }
    val historyEnd by rememberUpdatedState(controlsRow + history.lastIndex)
    LaunchedEffect(session?.watchId, session?.readPosition?.toString(), state.panel, state.route, quickSheet, questionSheetId, controls, permissions, attachmentMenu, capture.active) {
        if (session == null || history.isEmpty() || state.panel != null || state.route != null || session.cached ||
            quickSheet != null || questionSheetId != null || controls || permissions || attachmentMenu || capture.active) return@LaunchedEffect
        snapshotFlow {
            // The history's rows come after the failure row at the top, when there is one.
            val last = list.layoutInfo.visibleItemsInfo.find { it.index == historyEnd }
            last != null && last.offset + last.size <= list.layoutInfo.viewportEndOffset
        }.filter { it }.distinctUntilChanged().collect { model.acknowledge(session) }
    }
    // The box follows the draft when something else writes it (a restored draft, a sent message, a retry); the caret then goes to its end.
    LaunchedEffect(state.message) {
        if (field.text != state.message) field = TextFieldValue(state.message, TextRange(state.message.length))
    }
    fun clearCompletion() {
        completionQuery = null; completions = emptyList(); completionStatus = CompletionStatus.Ready
        // The names stay for the blue of a `/skill`; the list is read again the next time a `/` is written.
        skillsLoaded = false
    }
    fun inspect(next: TextFieldValue, deleting: Boolean) {
        if (!state.isAssistant || session == null || state.readOnly || goalIntent) { clearCompletion(); return }
        val query = GroupChat.query(next.text, next.selection.start, next.selection.end, next.composition != null, deleting, completionQuery)
        if (query == null) { clearCompletion(); return }
        if (query == completionQuery) return
        if (!query.continues(completionQuery)) completions = emptyList()
        completionQuery = query
    }
    LaunchedEffect(completionQuery, session?.id) {
        val query = completionQuery ?: return@LaunchedEffect
        val id = session?.id ?: return@LaunchedEffect
        if (query.kind == GroupChat.Kind.Skill && skillsLoaded) {
            completions = GroupChat.rank(skillList, query.text).map(Completion::Skill)
            completionStatus = CompletionStatus.Ready
            return@LaunchedEffect
        }
        completionStatus = CompletionStatus.Loading
        try {
            completions = if (query.kind == GroupChat.Kind.Issue)
                model.request("assistant.recipients", json("sessionId" to id, "q" to query.text)).rows("items").map(Completion::Issue)
            else {
                val values = model.request("assistant.skills", json("sessionId" to id)).rows("skills")
                skillList = values; skillsLoaded = true
                GroupChat.rank(values, query.text).map(Completion::Skill)
            }
            completionStatus = CompletionStatus.Ready
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            completions = emptyList(); completionStatus = CompletionStatus.Failed
        }
    }
    fun focusBox() { coroutine.launch { withFrameNanos { }; inputFocus.requestFocus(); keyboard?.show() } }
    fun choose(item: Completion) {
        val query = completionQuery ?: return
        val (text, caret) = GroupChat.insert(item.token, query, field.text) ?: return
        if (item is Completion.Issue) model.assistantRecipient = item.recipient
        clearCompletion()
        field = TextFieldValue(text, TextRange(caret))
        model.editMessage(text)
        focusBox()
    }
    // 回复 (a pull to the right or the long-press menu): the issue's @ in front of the draft or in place of the one that starts it, the caret behind it, the issue's title in grey after it.
    val replyTo: (JSONObject) -> Unit = { issue ->
        val next = GroupChat.replyDraft(model.state.value.message, GroupChat.name(issue))
        if (isVoiceMode) { capture.cancel(); isVoiceMode = false }
        field = TextFieldValue(next, TextRange(next.length))
        model.editMessage(next)
        replyGhost = issue.optString("title").takeIf { it.isNotEmpty() }?.let { next to it }
        focusBox()
    }
    // A quick sheet that 打开会话 / 打开事项 / 关联会话 left comes back with 嘟嘟's chat, as it was (the iPhone's `returningQuickSheet`; `AssistantQuickSheet` takes it).
    LaunchedEffect(state.isAssistant, session?.id, state.route, state.computerId) {
        if (quickSheet == null && state.route == null) model.returningQuickSheet(state.computerId, session?.id, state.isAssistant)?.let { quickSheet = it }
    }
    LaunchedEffect(state.replyRequest, quickSheet) {
        val issue = state.replyRequest ?: return@LaunchedEffect
        if (quickSheet != null) return@LaunchedEffect
        model.replied()
        replyTo(issue)
    }
    val skillNames = remember(skillList) { skillList.mapTo(HashSet()) { it.optString("name") } }
    val tokenColour = DuduStyle.blue
    val tokens = remember(skillNames, state.isAssistant) {
        if (!state.isAssistant) VisualTransformation.None else VisualTransformation { text ->
            TransformedText(AnnotatedString(text.text, spanStyles = GroupChat.highlights(text.text, skillNames)
                .map { AnnotatedString.Range(SpanStyle(color = tokenColour), it.first, it.last + 1) }), OffsetMapping.Identity)
        }
    }
    // What DSH answered to a command, in a toast in the app's words (the iPhone's `reportCommand`).
    fun report(name: String, outcome: CommandOutcome) {
        val said = CommandText.message(name, outcome)
        model.toast(said.text, if (outcome.isError) ToastKind.Error else ToastKind.Success, said.literal, said.args)
    }
    // DSH's commands (the iPhone's `DuduStore.runCommand`): one of a kind at a time, and only for the conversation that asked. A request that fails says why in a toast, or where `failed` puts it.
    fun runCommand(name: String, argument: String? = null, failed: ((String) -> Unit)? = null, done: (CommandOutcome) -> Unit) {
        val id = session?.id ?: return
        val computer = state.computerId
        when (name) {
            "goal" -> { if (goalWorking) return; goalWorking = true }
            "plan" -> { if (planChanging) return; planChanging = true }
            "compact" -> { if (compacting) return; compacting = true }
        }
        coroutine.launch {
            fun current() = model.state.value.let { it.computerId == computer && it.session?.id == id }
            try {
                val result = model.request("session.command", json("id" to id, "command" to name).apply {
                    argument?.takeIf { it.isNotEmpty() }?.let { put("argument", it) }
                })
                if (result.optString("kind") !in listOf("success", "error") || !result.has("text") || result.isNull("text"))
                    throw ApiFailure("PROTOCOL_ERROR")
                DuduLog.record("session.command", state = name)
                if (current()) done(CommandOutcome(result.optString("kind") == "error", result.optString("text")))
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("session.command.fail", error, state = name)
                if (current()) {
                    val code = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
                    if (failed != null) failed(code) else failure = code
                }
            } finally {
                when (name) {
                    "goal" -> goalWorking = false
                    "plan" -> planChanging = false
                    "compact" -> compacting = false
                }
            }
        }
    }
    // The goal is edited in its sheet (the iPhone's `presentGoalEditor`); voice goes and the keyboard with it.
    fun editGoal(goal: JSONObject) {
        if (goalWorking) return
        if (isVoiceMode) { capture.cancel(); isVoiceMode = false }
        focus.clearFocus()
        goalEditorError = null
        goalEditor = goal
    }
    // + → 目标 (the iPhone's `enterGoalMode`): the goal there is edited in its sheet; without one the box takes the goal's words, the draft kept.
    fun enterGoal() {
        session?.raw?.optJSONObject("goal")?.let { editGoal(it); return }
        if (isVoiceMode) { capture.cancel(); isVoiceMode = false }
        clearCompletion()
        goalIntent = true
        focusBox()
    }
    // The box's words as the goal (the iPhone's `sendGoal`): once set, the box is a message's again, empty if nothing was written meanwhile.
    fun sendGoal() {
        val submitted = state.message
        val text = submitted.trim()
        if (text.isEmpty() || goalWorking) return
        runCommand("goal", text) { outcome ->
            report("goal", outcome)
            if (!outcome.isError) {
                if (model.state.value.message == submitted) model.editMessage("")
                goalIntent = false
                focus.clearFocus()
            }
        }
    }
    // 保存 of the goal's sheet (the iPhone's `saveEditedGoal`): what DSH refuses stays in the sheet, what it took closes it with a toast.
    fun saveGoal(objective: String) {
        val goal = goalEditor ?: return
        val text = objective.trim()
        if (text.isEmpty() || goalWorking) return
        goalEditorError = null
        runCommand("goal", "edit $text", failed = { code -> if (goalEditor === goal) goalEditorError = SheetError.Code(code) }) { outcome ->
            if (goalEditor !== goal) return@runCommand
            if (outcome.isError) goalEditorError = SheetError.Words(CommandText.message("goal", outcome))
            else { goalEditor = null; report("goal", outcome) }
        }
    }
    // Plan mode on says nothing (the history shows it), a refusal does (the iPhone's `runPlanCommand`).
    fun togglePlan() {
        runCommand("plan", if (session?.raw?.optBoolean("planMode") == true) "off" else null) { if (it.isError) report("plan", it) }
    }
    // A compaction the history shows needs no word; nothing to compact, a refusal or an older computer does (the iPhone's `compactConversation`).
    fun compact() {
        if (session?.processing == true) return
        runCommand("compact") { outcome ->
            if (!outcome.isError && outcome.text.startsWith("Compacted ") && model.state.value.session?.transcript != null) return@runCommand
            report("compact", outcome)
        }
    }
    // /compact, /plan or /goal … written in the box runs as from the + sheet; the box empties when it worked and still holds what was written.
    fun typedCommand(name: String, argument: String, submitted: String) {
        runCommand(name, argument) { outcome ->
            when (name) {
                "plan" -> if (outcome.isError) report(name, outcome)
                "compact" -> if (outcome.isError || !outcome.text.startsWith("Compacted ") || model.state.value.session?.transcript == null) report(name, outcome)
                else -> report(name, outcome)
            }
            if (!outcome.isError && model.state.value.message == submitted) model.editMessage("")
        }
    }
    fun submit() {
        if (goalIntent) { sendGoal(); return }
        val match = Regex("^/(compact|plan|goal)(?:\\s+([\\s\\S]+))?$").matchEntire(state.message.trim())
        if (match != null && state.attachments.isEmpty()) typedCommand(match.groupValues[1], match.groupValues[2], state.message)
        else model.send()
    }
    fun stop() {
        val id = session?.id ?: return
        if (stopping) return
        stopping = true
        DuduLog.record("session.stop")
        coroutine.launch {
            try { model.value("session.stop", json("id" to id)) }
            catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("session.stop.fail", error)
                if (model.state.value.session?.id == id) failure = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
            } finally { stopping = false }
        }
    }
    // A change to a waiting message, one at a time (the iPhone's `updateQueue`): what could not be done is said in the iPhone's words, in the edit sheet when it is open for that message.
    fun updateQueue(message: Message, action: String, text: String? = null) {
        val id = session?.id ?: return
        if (queueUpdate != null) return
        val update = message.id to action
        queueUpdate = update
        queueEditorError = null
        coroutine.launch {
            try {
                model.value("session.queue.update", json("id" to id, "itemId" to message.id, "action" to action).apply { text?.let { put("text", it) } })
                if (model.state.value.session?.id == id && action == "edit") queueEditing = null
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("queue.update.fail", error, state = action)
                if (model.state.value.session?.id != id) return@launch
                val words = when (action) {
                    "edit" -> word("编辑失败：这条消息可能已经开始发送。")
                    "remove" -> word("删除失败：这条消息可能已经开始发送。")
                    else -> word("插话发送失败，请重试。")
                }
                if (action == "edit" && queueEditing?.id == message.id) queueEditorError = words
                else model.toast(words, ToastKind.Error)
            } finally { if (queueUpdate == update) queueUpdate = null }
        }
    }
    val boxStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface, lineHeight = 20.sp)
    val goalToken = w("/目标")
    val tokenStyle = boxStyle.copy(fontWeight = FontWeight.Medium, color = DuduStyle.blue)
    val measurer = rememberTextMeasurer()
    // Whether the words need more than one line beside +, voice and send: then they take the whole width and the buttons go under them (the iPhone's `ComposerLayout`).
    val wraps: (Int) -> Boolean = { width ->
        val text = field.text
        text.isNotEmpty() && run {
            val token = if (goalIntent) measurer.measure(goalToken, tokenStyle).size.width + with(density) { 6.dp.roundToPx() } else 0
            val available = (width - with(density) { 1.dp.roundToPx() } - token).coerceAtLeast(1)
            measurer.measure(text, boxStyle, constraints = Constraints(maxWidth = available)).lineCount > 1
        }
    }
    Box(Modifier.fillMaxSize()) {
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
                        Glyph(DuduGlyphs.back, stringResource(R.string.back))
                    }
                }, actions = {
                    Box {
                        IconButton(onClick = { menu = true }, enabled = session != null) { Glyph(DuduGlyphs.options, stringResource(R.string.more)) }
                        DropdownMenu(menu, { menu = false }) {
                            DropdownMenuItem(text = { Text(w("智能体团队")) }, leadingIcon = { Glyph(DuduGlyphs.team, size = 18) },
                                onClick = { menu = false; model.navigate(Route("activity", target = "team")) })
                            DropdownMenuItem(text = { Text(w("后台任务")) }, leadingIcon = { Glyph(DuduGlyphs.stateWorking, size = 18) },
                                onClick = { menu = false; model.navigate(Route("activity", target = "jobs")) })
                            DropdownMenuItem(text = { Text(w("定时任务")) }, leadingIcon = { Glyph(DuduGlyphs.schedule, size = 18) },
                                onClick = { menu = false; model.navigate(Route("session-tasks")) })
                        }
                    }
                },
            )
        },
        bottomBar = {
            // The history goes on under the controls, as on the iPhone; it fades out towards the box instead of stopping at a white band (owner, 2026-11-22: 「一个大白条全部挡住了…好吵」).
            val page = MaterialTheme.colorScheme.background
            Column(Modifier.fillMaxWidth().drawBehind {
                val solid = (composerTop + 8.dp.toPx()).coerceIn(1f, size.height)
                drawRect(Brush.verticalGradient(0f to page.copy(alpha = 0f), solid / size.height to page, 1f to page))
            }.navigationBarsPadding().padding(horizontal = 24.dp).padding(top = 8.dp, bottom = 12.dp)) {
                if (session != null) {
                    // Over the box in the iPhone's order (`bottomChrome`): DSH's task list, the goal, the waiting messages.
                    if (session.raw.rows("todos").isNotEmpty()) TaskPanel(session.raw.rows("todos"))
                    session.raw.optJSONObject("goal")?.let { goal ->
                        GoalBanner(goal, goalWorking, state.connected,
                            toggle = { runCommand("goal", if (goal.optString("phase") in listOf("paused", "blocked")) "resume" else "pause") { report("goal", it) } },
                            edit = { editGoal(goal) },
                            clear = { runCommand("goal", "clear") { report("goal", it) } })
                    }
                    if (queueRows.isNotEmpty()) QueuedMessagesPanel(queueRows, session.id, model, running = session.processing,
                        enabled = state.connected, pending = queueUpdate,
                        edit = { focus.clearFocus(); queueEditorError = null; queueEditing = it },
                        remove = { updateQueue(it, "remove") },
                        steer = { updateQueue(it, "steer") })
                }
                completionQuery?.takeIf { !isVoiceMode && !state.readOnly }?.let { query ->
                    Box(Modifier.padding(bottom = 8.dp)) { AssistantSuggestions(completions, completionStatus, query.kind, 0, ::choose) }
                }
                // This app may use the microphone but the phone's speech service may not: say whose permission is missing, and a tap opens that service's own page (owner,
                // 2026-11-21: "我已经给了权限，还是提示没有权限"). The other voice problems are toasts.
                val service = capture.failedService
                if (capture.problem == VoiceProblem.Service && service != null) Text(w("请允许{0}使用麦克风，点这里打开设置。").replace("{0}", service.label),
                    color = MaterialTheme.colorScheme.error, fontSize = 14.sp,
                    modifier = Modifier.padding(bottom = 8.dp).combinedClickable(onClick = {
                        try { context.startActivity(service.settings) } catch (_: android.content.ActivityNotFoundException) { }
                    }))
                if (!state.readOnly) {
                    // The quick buttons give way to the list of candidates while it is open (the iPhone's `showsQuickChips`).
                    // They stay while something is typed and give way to whatever else stands in their place: a queued message, the goal bar, the task list, a picture or file waiting in
                    // the box, the list of candidates, voice, a goal being written (the iPhone's `showsQuickChips` / `bottomChromeIsOccupied`).
                    val occupied = queueRows.isNotEmpty() || session?.raw?.optJSONObject("goal") != null ||
                        session?.raw?.rows("todos")?.isNotEmpty() == true || state.attachments.isNotEmpty()
                    AnimatedVisibility(state.isAssistant && completionQuery == null && !isVoiceMode && !goalIntent && !occupied,
                        enter = fadeIn(), exit = fadeOut()) {
                        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("todo", "info", "task").forEach { kind ->
                                QuickChip(when (kind) { "todo" -> DuduGlyphs.listTodo; "info" -> DuduGlyphs.inbox; else -> DuduGlyphs.schedule },
                                    when (kind) { "todo" -> w("待办"); "info" -> w("收件箱"); else -> w("任务") }, "quick-$kind") { quickSheet = kind }
                            }
                        }
                    }
                    Surface(Modifier.fillMaxWidth().alpha(if (capture.active) 0f else 1f).onGloballyPositioned { composerTop = it.positionInParent().y },
                        shape = RoundedCornerShape(28.dp),
                        color = MaterialTheme.colorScheme.surface, shadowElevation = 3.dp,
                        border = BorderStroke(.75.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Column {
                            if (state.attachments.isNotEmpty()) Box(Modifier.padding(12.dp)) { StagedAttachments(state, model) }
                            // The iPhone's 44 dp box: +, the words and voice / send in a row; words past one line, or something attached, take the whole width over a row of the buttons.
                            ComposerRow(hasAttachments = state.attachments.isNotEmpty(), voice = isVoiceMode, wraps = wraps, plus = {
                                IconButton(onClick = { focus.clearFocus(); DuduLog.record("composer.plus"); attachmentMenu = true },
                                    modifier = Modifier.size(44.dp).testTag("composer-plus"),
                                    enabled = session != null && !state.sending && !actions.busy) {
                                    Glyph(DuduGlyphs.plus, w("添加"), 24)
                                }
                            }, text = {
                                if (isVoiceMode) HoldToTalkBar(capture, voiceTouch, enabled = session != null && !state.sending && !actions.busy,
                                    modifier = Modifier.fillMaxWidth()) {
                                    val target = voiceTarget
                                    if (target == null || state.sending || actions.busy) false
                                    else if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                                        // A problem said before is said again if the answer is the same.
                                        if (capture.problem != null) capture.cancel()
                                        permissionTarget = target
                                        microphone.launch(Manifest.permission.RECORD_AUDIO)
                                        false
                                    } else {
                                        capture.begin(target, locale.toLanguageTag())
                                        capture.active
                                    }
                                } else Row(Modifier.fillMaxWidth().padding(start = 1.dp), verticalAlignment = Alignment.Top) {
                                    val muted = MaterialTheme.colorScheme.onSurfaceVariant
                                    // The iPhone's placeholder: a goal's, plan mode's (描述你的任务以生成计划), or 发消息.
                                    val placeholder = if (goalIntent) w("输入目标，智能体将持续执行")
                                        else if (session?.raw?.optBoolean("planMode") == true) w("描述你的任务以生成计划") else stringResource(R.string.message)
                                    if (goalIntent) {
                                        val tokenLabel = w("目标指令，点按取消")
                                        Text(goalToken, Modifier.padding(top = 12.dp, end = 6.dp)
                                            .clickable(interactionSource = null, indication = null, role = Role.Button) { goalIntent = false }
                                            .semantics { contentDescription = tokenLabel }.testTag("composer-goal-token"), style = tokenStyle)
                                    }
                                    BasicTextField(value = field, onValueChange = { next ->
                                            val deleting = next.text.length < field.text.length
                                            field = next
                                            if (next.text != model.state.value.message) model.editMessage(next.text)
                                            inspect(next, deleting)
                                        }, modifier = Modifier.weight(1f).testTag("message-input").focusRequester(inputFocus).padding(vertical = 12.dp),
                                        textStyle = boxStyle,
                                        cursorBrush = SolidColor(DuduStyle.blue), maxLines = 5, enabled = session != null && !state.sending,
                                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
                                        visualTransformation = tokens, onTextLayout = { fieldLayout = it },
                                        decorationBox = { inner ->
                                            BoxWithConstraints {
                                                if (field.text.isEmpty()) Text(placeholder, style = boxStyle.copy(color = muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                inner()
                                                // The issue's title in grey 5 dp after the caret at the end, until the draft changes (the iPhone's `ComposerTextView.ghost`).
                                                val ghost = replyGhost?.takeIf { it.first == field.text && field.text.isNotEmpty() && field.composition == null }?.second
                                                val layout = fieldLayout
                                                if (ghost != null && layout != null && layout.layoutInput.text.length == field.text.length) {
                                                    val caret = layout.getCursorRect(field.text.length)
                                                    val x = caret.right + with(density) { 5.dp.toPx() }
                                                    Text(ghost, Modifier.offset { IntOffset(x.roundToInt(), caret.top.roundToInt()) }
                                                        .widthIn(max = (maxWidth - with(density) { x.toDp() }).coerceAtLeast(0.dp)),
                                                        style = boxStyle.copy(color = muted), maxLines = 1, overflow = TextOverflow.Ellipsis)
                                                }
                                            }
                                        })
                                }
                            }, trailing = {
                                Row {
                                    if (showsModeToggle)
                                        IconButton(onClick = {
                                            capture.cancel()
                                            isVoiceMode = !isVoiceMode
                                            if (isVoiceMode) { goalIntent = false; clearCompletion(); focus.clearFocus(); keyboard?.hide() }
                                            else coroutine.launch {
                                                withFrameNanos { }
                                                val current = model.state.value
                                                if (!isVoiceMode && !current.readOnly &&
                                                    current.computerId == voiceTarget?.computer && current.session?.id == voiceTarget?.session) {
                                                    inputFocus.requestFocus()
                                                    keyboard?.show()
                                                }
                                            }
                                        }, enabled = session != null, modifier = Modifier.size(44.dp)
                                            .testTag(if (isVoiceMode) "composer-keyboard" else "composer-voice")) {
                                            ComposerModeGlyph(isVoiceMode, if (isVoiceMode) w("切换到键盘") else w("语音输入"))
                                        }
                                    // Nothing to send while something runs: stop (a spinner while it stops); something to send: send (a spinner while it goes, or while a goal is set).
                                    if (!canSend && processing) IconButton(onClick = ::stop, modifier = Modifier.size(44.dp).testTag("composer-stop"),
                                        enabled = session != null && !stopping && !state.sending && state.connected) {
                                        val label = w("停止任务")
                                        Box(Modifier.size(34.dp).background(Color(0xFFB8DBFD), CircleShape).semantics { contentDescription = label },
                                            contentAlignment = Alignment.Center) {
                                            if (stopping || state.sending) CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 1.5.dp, color = Color(0xFF17181B))
                                            else Box(Modifier.size(14.dp).background(Color(0xFF17181B), RoundedCornerShape(3.dp)))
                                        }
                                    } else if (canSend) IconButton(onClick = ::submit, modifier = Modifier.size(44.dp).testTag("send"),
                                        enabled = session != null && !state.sending && !goalWorking && !actions.busy) {
                                        Box(Modifier.size(34.dp).background(Color(0xFFB8DBFD), CircleShape), contentAlignment = Alignment.Center) {
                                            if (state.sending || goalWorking) CircularProgressIndicator(Modifier.size(17.dp), strokeWidth = 1.5.dp, color = Color(0xFF17181B))
                                            else Glyph(DuduGlyphs.send, stringResource(R.string.send), size = 20, tint = Color(0xFF17181B))
                                        }
                                    }
                                }
                            })
                        }
                    }
                }
            }
        },
    ) { insets ->
        // Only the top bar takes room away: the bottom controls float over the end of the history, which leaves their height empty after its last row.
        val underBar = insets.calculateBottomPadding()
        Box(Modifier.fillMaxSize().padding(top = insets.calculateTopPadding())) {
            if (session == null) Box(Modifier.align(Alignment.Center).padding(bottom = underBar)) { DeliveryLoadingMark(22) }
            // Nothing in the conversation yet: the iPhone's `ConversationEmptyState` once it has been read from the computer, its wait until then.
            else if (!hasContent && prompts == 0) Box(Modifier.align(Alignment.Center).padding(bottom = underBar)) {
                if (state.connected && !session.cached) ConversationEmptyState() else DeliveryLoadingMark(22)
            }
            else LazyColumn(Modifier.fillMaxSize().testTag("message-list"), state = list,
                contentPadding = PaddingValues(start = 24.dp, end = 24.dp, top = 16.dp, bottom = 16.dp + underBar),
                verticalArrangement = Arrangement.spacedBy(20.dp)) {
                if (controlsRow == 1) item(key = "history.controls", contentType = "controls") {
                    HistoryFailure(state.pageFailure.orEmpty(), retry = model::older)
                }
                items(all, key = { it.id }, contentType = { if (it is TranscriptRow.Turn) "turn" else "entry" }) { row ->
                    TimeSeparated(separators[row.id]) {
                        when (row) {
                            is TranscriptRow.Entry -> {
                                val raw = row.message.raw
                                when {
                                    // A line of 嘟嘟's group chat (the owner's @ line, an issue's answer, its dots, a task's result) is drawn as the group's own row.
                                    row.message.role == "command" && raw.has("group") -> GroupLineRow(row.message, session.id, model, actions, replyTo)
                                    // A card of 嘟嘟's chat (a quick button's) is the card alone, not a command line (the iPhone's `CommandRowView`).
                                    row.message.role == "command" && raw.optJSONObject("card") != null && raw.optString("outcome") != "error" ->
                                        Box(Modifier.padding(vertical = 4.dp)) { QuickCard(raw.getJSONObject("card"), state, model, actions,
                                            seq = if (raw.has("seq")) raw.getLong("seq") else null) }
                                    row.message.role == "command" || row.message.role == "compaction" -> CommandRow(row.message)
                                    row.message.role == "trigger" -> TriggerRow(row.message)
                                    else -> MessageView(row.message, state, model, actions)
                                }
                            }
                            is TranscriptRow.Turn -> TranscriptTurn(row, session, connected = state.connected,
                                openTool = { openTool(it, session, model) },
                                openChanges = { model.navigate(Route("changes", params = json("id" to session.id, "seq" to it))) },
                                files = { DeliveredFilesCard(it, session.id, model, connected = state.connected && !session.cached) },
                                // 删除 of a turn's answer in 嘟嘟's conversation hides every message of the turn, as the iPhone's `lineSequences`.
                                message = { MessageView(it, state, model, actions, showsProcess = false,
                                    hideSeqs = if (it === row.answer) row.seqs else null) })
                        }
                    }
                }
                if (!session.cached && !state.readOnly) {
                    items(session.raw.rows("questions"), key = { "question:${it.getString("id")}" }) { batch ->
                        Questions(batch, session.id, state.connected, model,
                            autoOpen = state.route == null && state.panel == null && !attachmentMenu && quickSheet == null && !controls && !permissions && questionSheetId == null &&
                                planPreview == null && goalEditor == null && queueEditing == null) { open ->
                            if (open) questionSheetId = batch.getString("id")
                            else if (questionSheetId == batch.getString("id")) questionSheetId = null
                        }
                    }
                    items(session.raw.rows("approvals"), key = { "approval:${it.getString("id")}" }) { approval ->
                        Approval(approval, session.id, model, openFull = { planPreview = approval },
                            revise = { goalIntent = false; if (!isVoiceMode) focusBox() })
                    }
                }
                if (showsRunning) item(key = "running", contentType = "running") {
                    Box(Modifier.padding(top = 2.dp)) { RunningStatus(runningStart) }
                }
            }
            if (state.pageLoading) {
                val earlier = w("加载更早")
                CircularProgressIndicator(Modifier.align(Alignment.TopCenter).padding(top = 8.dp).size(18.dp)
                    .semantics { contentDescription = earlier }.testTag("chat-history-loading"),
                    strokeWidth = 2.dp, color = chatTertiary())
            }
            // The iPhone's button: a 44 dp circle in the middle over the composer, for a reader who has left the end. It fades in 200 ms
            // and lands on the very end of the history; the surface is the composer's own (colour, edge, shadow).
            val showsLatest = awayFromEnd && !following
            val latest by animateFloatAsState(if (showsLatest) 1f else 0f, tween(200), label = "latest")
            if (latest > 0f) Surface(onClick = {
                coroutine.launch {
                    val info = list.layoutInfo
                    val last = info.visibleItemsInfo.lastOrNull()
                    if (last != null && last.index == info.totalItemsCount - 1)
                        list.animateScrollBy((last.offset + last.size + info.afterContentPadding - info.viewportEndOffset).toFloat())
                    following = true
                    if (list.canScrollForward && lastIndex >= 0) list.scrollToItem(lastIndex, END)
                }
            }, enabled = showsLatest, modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = underBar + 10.dp).size(44.dp)
                .graphicsLayer { alpha = latest; scaleX = .85f + .15f * latest; scaleY = .85f + .15f * latest }.testTag("chat-latest"),
                shape = CircleShape, color = MaterialTheme.colorScheme.surface, shadowElevation = 3.dp,
                border = BorderStroke(.75.dp, MaterialTheme.colorScheme.outlineVariant)) {
                Box(contentAlignment = Alignment.Center) { Glyph(DuduGlyphs.down, w("回到最新消息"), 20) }
            }
        }
    }
    VoiceCaptureOverlay(capture, voiceTouch, Modifier.align(Alignment.BottomCenter).fillMaxWidth()
        .height(minOf(LocalConfiguration.current.screenHeightDp * .4f, 320f).dp))
    }
    if (controls && session != null) ModelControls(session, state, model, dismiss = { controls = false })
    if (permissions && session != null) PermissionControls(session, state, model, dismiss = { permissions = false })
    if (attachmentMenu && session != null) ComposerMenu(session, state, model, dismiss = { attachmentMenu = false },
        pick = { kind -> attachmentMenu = false; picker(kind) },
        goal = { attachmentMenu = false; enterGoal() },
        plan = { attachmentMenu = false; togglePlan() },
        compact = { attachmentMenu = false; compact() },
        stop = { attachmentMenu = false; stop() },
        canAddPhotos = state.attachments.count { it.has("dataBase64") } < PHOTO_LIMIT,
        canAddFiles = state.attachments.count { it.has("receiptId") } < FILE_LIMIT && !actions.busy,
        planEnabled = !planChanging)
    quickSheet?.let { AssistantQuickSheet(it, state, model) { quickSheet = null } }
    // A waiting message and the goal are edited in a sheet of their own (the iPhone's `QueuedMessageEditor`, `GoalEditorSheet`), which keeps what went wrong until it is put away.
    queueEditing?.let { queued ->
        TextEditSheet(queued.id, queued.text, saving = queueUpdate == (queued.id to "edit"), error = queueEditorError?.let { w(it) },
            tag = "queue-editor", save = { updateQueue(queued, "edit", it) }, close = { queueEditing = null })
    }
    goalEditor?.let { goal ->
        TextEditSheet(goal, goal.optString("objective"), saving = goalWorking, error = goalEditorError?.say(), label = w("目标"),
            focus = true, tag = "goal-editor", save = ::saveGoal, close = { goalEditor = null })
    }
    planPreview?.let { PlanFullSheet(it) { planPreview = null } }
}

@Composable
private fun MessageView(message: Message, state: UiState, model: DuduViewModel, actions: Actions, showsProcess: Boolean = true,
    hideSeqs: List<Long>? = null) {
    val own = message.role == "user"
    val session = state.session ?: return
    val clipboard = LocalClipboard.current
    val coroutine = rememberCoroutineScope()
    val raw = message.raw
    var messageMenu by remember { mutableStateOf(false) }
    var selecting by remember { mutableStateOf(false) }
    val press = remember { PressPoint() }
    val seq = if (raw.has("seq")) raw.optLong("seq") else null
    Row(Modifier.fillMaxWidth(),
        horizontalArrangement = if (own) Arrangement.End else Arrangement.Start) {
        Box {
        Column((if (own) Modifier.fillMaxWidth() else Modifier.widthIn(max = 800.dp))
            .notePress(press)
            .combinedClickable(enabled = !message.pending && !message.streaming && message.text.isNotBlank(),
                onClick = {}, onLongClick = { messageMenu = true }),
            horizontalAlignment = if (own) Alignment.End else Alignment.Start,
            verticalArrangement = Arrangement.spacedBy(if (own) 6.dp else 8.dp)) {
            // The owner's message as the iPhone's `UserBubbleRow` lays it out: the pictures, the videos, the words, then the other files as small chips; with no words, the sending mark
            // stands on the last file, else the last video, else the last picture.
            fun kind(file: JSONObject) = file.optString("kind")
            val images = if (own) message.attachments.filter { kind(it) == "image" } else emptyList()
            val videos = if (own) message.attachments.filter { kind(it) == "video" } else emptyList()
            val others = if (own) message.attachments.filter { kind(it) != "image" && kind(it) != "video" } else emptyList()
            val pendingTail = own && message.pending && message.text.isBlank()
            images.forEachIndexed { index, attachment ->
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                    PendingMessage(pendingTail && others.isEmpty() && videos.isEmpty() && index == images.lastIndex) {
                        Attachment(session.id, attachment, seq, model, AttachmentImageStyle.Message)
                    }
                }
            }
            videos.forEachIndexed { index, attachment ->
                key(attachment.optString("id", index.toString())) {
                    ConversationVideoThumbnail(attachment, state.computerId, session.id, seq, state.connected && !session.cached, model,
                        pending = pendingTail && others.isEmpty() && index == videos.lastIndex)
                }
            }
            if (showsProcess && message.reasoning.isNotBlank()) {
                var expanded by remember(message.id) { mutableStateOf(false) }
                TextButton(onClick = { expanded = !expanded }, contentPadding = PaddingValues(0.dp)) {
                    Text(w("思考过程"), style = MaterialTheme.typography.labelMedium)
                    Glyph(if (expanded) DuduGlyphs.up else DuduGlyphs.down, size = 14)
                }
                if (expanded) Markdown(message.reasoning, compact = true)
            }
            if (message.text.isNotBlank()) {
                if (own) PendingMessage(message.pending) {
                    Text(message.text, Modifier.widthIn(max = 320.dp)
                        .background(if (androidx.compose.foundation.isSystemInDarkTheme())
                            MaterialTheme.colorScheme.secondaryContainer else DuduStyle.bubble,
                            RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp, bottomEnd = 4.dp, bottomStart = 24.dp))
                        .padding(horizontal = 16.dp, vertical = 12.dp), fontSize = 17.sp, lineHeight = 26.sp)
                }
                // A picture in the answer stands where it is written, read by the message's own event (the iPhone's `MessageImageProvider`).
                else Markdown(message.text, selectable = false, picture = if (raw.has("seq")) { words, source ->
                    Attachment(session.id, json("kind" to "image", "name" to words, "source" to source), raw.getLong("seq"), model, AttachmentImageStyle.Message)
                } else null)
            }
            if (others.isNotEmpty()) PendingMessage(pendingTail) { FileChips(others) }
            if (!own) message.attachments.forEach { attachment -> Attachment(session.id, attachment, seq, model) }
            if (showsProcess) raw.rows("calls").forEach { call ->
                ToolCallRow(call, session) { openTool(it, session, model) }
            }
            if (showsProcess && message.streaming) Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(12.dp), strokeWidth = 1.5.dp)
                if (message.text.isBlank()) Text(w("深度求索中 ···"), Modifier.padding(start = 8.dp), style = MaterialTheme.typography.bodySmall)
            }
            // The iPhone's message menu: 复制 and 选择 (a page where part of the words can be chosen); in 嘟嘟's conversation, a group chat, 复制 and 删除, which hides the lines (all of a
            // turn's for its answer).
            val hidden = hideSeqs ?: listOfNotNull(seq)
            DropdownMenu(messageMenu, { messageMenu = false }, offset = press.menuOffset()) {
                DropdownMenuItem(text = { Text(w("复制")) }, leadingIcon = { InboxGlyph(DuduGlyphs.copy, 18) },
                    onClick = { messageMenu = false; coroutine.launch {
                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("message", message.text)))
                        DuduLog.record("message.copy")
                    } })
                if (!state.isAssistant) DropdownMenuItem(text = { Text(w("选择")) }, leadingIcon = { InboxGlyph(DuduGlyphs.selectRows, 18) },
                    onClick = { messageMenu = false; selecting = true })
                if (state.isAssistant && hidden.isNotEmpty()) DropdownMenuItem(
                    text = { Text(w("删除"), color = MaterialTheme.colorScheme.error) },
                    leadingIcon = { InboxGlyph(DuduGlyphs.trash, 18, MaterialTheme.colorScheme.error) },
                    onClick = { messageMenu = false; actions.run {
                        model.request("assistant.hide", json("sessionId" to session.id, "seqs" to JSONArray(hidden)))
                    } })
            }
        }
        }
    }
    if (selecting) MessageSelectionSheet(message.text) { selecting = false }
}

/** The owner's files that are neither a picture nor a video (the iPhone's chips): a 13 dp paperclip, the name in 12 sp at most 120 dp wide, on the panel's grey with a hairline, 6 dp apart. */
@Composable
private fun FileChips(files: List<JSONObject>) {
    val secondary = chatSecondary()
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        files.forEach { file ->
            Row(Modifier.background(chatPanel(), CircleShape).border(.5.dp, chatDivider(), CircleShape)
                .padding(horizontal = 9.dp, vertical = 5.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Glyph(if (file.optString("kind") == "image") DuduGlyphs.image else DuduGlyphs.attach, size = 13, tint = secondary)
                Text(file.optString("name"), Modifier.widthIn(max = 120.dp), fontSize = 12.sp, lineHeight = 16.sp, color = secondary,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Keep the sending mark attached to the final bubble or tile, as on iPhone. */
@Composable
private fun PendingMessage(pending: Boolean, content: @Composable () -> Unit) {
    Box {
        content()
        if (pending) Box(Modifier.align(Alignment.BottomStart).offset(x = (-25).dp, y = (-6).dp)) {
            DeliveryLoadingMark(15, Color(0xFFA6CFE7))
        }
    }
}

private fun openTool(call: JSONObject, session: Session, model: DuduViewModel) {
    val reference = session.transcript?.optJSONObject("tools")?.optJSONObject(call.optString("id"))
    val seq = reference?.optLong("seq", -1) ?: call.optLong("seq", -1)
    val resultSeq = reference?.optLong("resultSeq", -1) ?: call.optLong("resultSeq", -1)
    model.navigate(Route("tool", call.optString("name"), params = json("seq" to seq, "callId" to call.getString("id")).apply {
        if (resultSeq >= 0) put("resultSeq", resultSeq)
    }))
}

/**
 * A quick button of 嘟嘟's chat (待办, 收件箱, 任务), the iPhone's `QuickChipLabel`: 32 dp high, 6 dp corners, 11 dp at the sides, a 15 dp glyph and 14 sp medium words, 8 dp apart. Where the iPhone has
 * its glass, a light surface with a hairline and a faint shadow (owner, 2026-11-22: buttons need not have the glass).
 */
@Composable
private fun QuickChip(glyph: Int, title: String, tag: String, open: () -> Unit) {
    val shape = RoundedCornerShape(6.dp)
    val ink = MaterialTheme.colorScheme.onSurface
    val surface = if (androidx.compose.foundation.isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHigh else Color.White.copy(alpha = .94f)
    Row(Modifier.height(32.dp).shadow(2.dp, shape, ambientColor = Color.Black.copy(alpha = .06f), spotColor = Color.Black.copy(alpha = .06f))
        .background(surface, shape).border(.5.dp, ink.copy(alpha = .08f), shape).clip(shape).clickable(onClick = open)
        .padding(horizontal = 11.dp).testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
        Glyph(glyph, size = 15, tint = ink)
        Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = ink, maxLines = 1)
    }
}
