@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject

/**
 * What a quick sheet shows, the iPhone's `AssistantQuickSheetState`: the tab of its list, where the list is scrolled to, the row that is open (待办) and the record or task open over it. It lives as long
 * as the sheet; when 打开会话 / 打开事项 / 关联会话 leaves the sheet it is kept by the model (`QuickSheetReturn`) and handed back when 嘟嘟's chat is shown again.
 */
@Stable
class QuickSheetMemory(start: QuickSheetReturn?) {
    var tab by mutableStateOf(start?.tab)
    var expanded by mutableStateOf(start?.expanded)
    var detail by mutableStateOf(start?.detail)
    val list = LazyListState()
    /** Where the list was when the sheet was left: it goes there once its rows have come again. */
    var pendingScroll: Pair<Int, Int>? = start?.let { it.scrollIndex to it.scrollOffset }?.takeIf { it.first > 0 || it.second > 0 }

    fun snapshot(kind: String, computerId: String, sessionId: String) = QuickSheetReturn(kind, computerId, sessionId, tab,
        list.firstVisibleItemIndex, list.firstVisibleItemScrollOffset, expanded, detail)
}

/** Scrolls the list back to where it was once `ready` (its rows have come). */
@Composable
fun QuickSheetMemory.RestoreScroll(ready: Boolean) {
    LaunchedEffect(ready) {
        if (!ready) return@LaunchedEffect
        val (index, offset) = pendingScroll ?: return@LaunchedEffect
        pendingScroll = null
        list.scrollToItem(index, offset)
    }
}

/**
 * 待办 / 收件箱 / 任务 of 嘟嘟's chat. 打开会话 / 打开事项 / 关联会话 leave it for a conversation or an issue, and going back to 嘟嘟 opens it again with its tab, its scroll and the record or task that was
 * open (the iPhone's `leaveQuickSheet` / `restoreQuickSheet`); a 回复 does not come back to it.
 */
@Composable
fun AssistantQuickSheet(kind: String, state: UiState, model: DuduViewModel, dismiss: () -> Unit) {
    val memory = remember(kind) { QuickSheetMemory(model.takeQuickSheetReturn(kind, state.computerId, state.session?.id)) }
    var todoHeight by remember(kind) { mutableIntStateOf(188) }
    // The inbox and the tasks tell how high their content is (the bar, the tabs, the rows as drawn, what stands under them); the sheet is that high, up to 660 dp.
    var listHeight by remember(kind) { mutableIntStateOf(0) }
    var revision by remember(kind) { mutableIntStateOf(0) }
    val detail = memory.detail
    val height = if (detail != null) 760.dp else if (kind == "todo") todoHeight.dp else listHeight.coerceIn(188, 660).dp
    LaunchedEffect(state.route) { if (state.route != null) dismiss() }
    fun open(route: Route) { if (route.name in listOf("record", "task")) memory.detail = route else model.navigate(route) }
    fun back() { memory.detail = null; revision++ }
    /** Leave the sheet for a conversation (`go`): it is kept, so that it comes back with 嘟嘟's chat. */
    fun leave(go: () -> Unit) {
        state.session?.id?.let { session -> model.leaveQuickSheet(memory.snapshot(kind, state.computerId, session)) }
        dismiss()
        go()
    }
    DuduSheet(dismiss) {
        Box(Modifier.fillMaxWidth().height(height)) {
            Box(Modifier.fillMaxSize().alpha(if (detail == null) 1f else 0f).then(
                if (detail == null) Modifier else Modifier.clearAndSetSemantics {})) {
            when (kind) {
                "info" -> CollectorScreen(model, back = dismiss, onHeight = { listHeight = it }, open = ::open, refreshKey = revision,
                    active = detail == null, memory = memory, leave = ::leave)
                "task" -> TasksScreen(model, back = dismiss, onHeight = { listHeight = it }, open = ::open, refreshKey = revision,
                    active = detail == null, memory = memory, leave = ::leave)
                else -> AssistantTodos(state, model, back = dismiss, onCount = {}, onHeight = { todoHeight = it }, memory = memory, leave = ::leave)
            }
            }
            detail?.let { route -> key(route) {
                when (route.name) {
                    "record" -> RecordScreen(route, model, back = ::back, close = dismiss, leave = ::leave)
                    "task" -> TaskScreen(route, state, model, back = ::back, close = dismiss, leave = ::leave)
                }
            } }
        }
    }
}

/**
 * 待办: the issues waiting for the owner, in one white card with a hairline between them (the iPhone's `AssistantTodoSheet`). Read when it opens, when the computer connects again and when the app comes
 * back to the front; the first reading shows a spinner, the next page comes by itself at the end, and a failure is said under the list in red. `leave` is the quick sheet's way to a conversation.
 */
@Composable
fun AssistantTodos(state: UiState, model: DuduViewModel, back: () -> Unit = model::backRoute,
    onCount: ((Int) -> Unit)? = null, onHeight: ((Int) -> Unit)? = null, memory: QuickSheetMemory? = null,
    leave: ((() -> Unit) -> Unit)? = null) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var reading by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<String?>(null) }
    var revision by remember { mutableIntStateOf(0) }
    var expanded by remember { mutableStateOf(memory?.expanded) }
    var total by remember { mutableIntStateOf(0) }
    val heights = remember { mutableStateMapOf<Long, Int>() }
    val density = LocalDensity.current
    val list = memory?.list ?: rememberLazyListState()
    val sessionId = state.session?.id ?: return
    /** The first page again (`more`: the next one), as the iPhone's `AssistantTodoModel.refresh`. */
    suspend fun read(more: Boolean = false) {
        if (reading || more && cursor == null) return
        if (!state.connected) { loading = false; failure = "CONNECTION_FAILED"; return }
        reading = true
        if (!more) loading = rows.isEmpty()
        failure = null
        try {
            val params = json("sessionId" to sessionId)
            if (more) cursor?.let { params.put("cursor", it) }
            val result = model.request("assistant.todos", params)
            rows = (if (more) rows + result.rows("rows") else result.rows("rows")).distinctBy { it.getLong("id") }
            total = result.optInt("total", rows.size)
            cursor = result.nullableString("nextCursor")
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            DuduLog.failure("assistant.todos.fail", error)
            failure = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
        } finally { reading = false; loading = false }
    }
    // Read when the sheet opens, when the computer connects again and each time the app comes back to the front.
    LaunchedEffect(revision, state.connected, state.computerId, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) { read() }
    }
    LaunchedEffect(expanded) { memory?.expanded = expanded }
    LaunchedEffect(rows.size) { onCount?.invoke(rows.size) }
    memory?.RestoreScroll(rows.isNotEmpty())
    val height = 76 + (if (rows.isEmpty()) 82 else rows.sumOf { issue -> heights[issue.getLong("id")]?.let { with(density) { it.toDp().value.toInt() } }
        ?: if (issue.optJSONObject("latest") != null) 104 else 56 }) + (if (cursor != null && rows.isNotEmpty()) 44 else 0) + (if (failure != null) 48 else 0)
    LaunchedEffect(height) { onHeight?.invoke(height.coerceIn(188, 660)) }
    Page(w("待办"), back, count = total.takeIf { onCount != null && !loading }, top = {
        if (onCount == null) IconButton(onClick = { revision++ }) { Glyph(DuduGlyphs.completeContext, w("刷新")) }
    }) {
        LazyColumn(Modifier.fillMaxSize().testTag("assistant-todos"), state = list, contentPadding = PaddingValues(bottom = 24.dp)) {
            if (loading) item { ListLoading(Modifier.height(82.dp)) }
            else if (rows.isEmpty() && failure == null) item {
                Box(Modifier.fillMaxWidth().height(82.dp), contentAlignment = Alignment.Center) {
                    Text(w("没有事项"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            if (!loading) itemsIndexed(rows, key = { _, issue -> issue.getLong("id") }) { index, issue ->
                val id = issue.getLong("id")
                GroupRow(index == 0, index == rows.lastIndex, inset = 20, dividerStart = 14, dividerEnd = 14) {
                    Box(Modifier.onSizeChanged { heights[id] = it.height }) {
                        QuickTodoIssueRow(issue, state, model, expanded == id, { expanded = if (expanded == id) null else id }, back, leave = leave)
                    }
                }
            }
            // The next page comes by itself when the end of the list is reached.
            if (!loading && cursor != null && rows.isNotEmpty()) item(key = "more-$cursor") {
                LaunchedEffect(cursor) { read(more = true) }
                ListLoading(Modifier.height(44.dp))
            }
            failure?.let { code -> item {
                Text(problemText(code), Modifier.fillMaxWidth().padding(horizontal = 34.dp, vertical = 14.dp), fontSize = 14.sp,
                    color = Color(0xFFEC1313))
            } }
        }
    }
}
