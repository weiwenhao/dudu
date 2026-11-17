@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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

@Composable
fun AssistantQuickSheet(kind: String, state: UiState, model: DuduViewModel, dismiss: () -> Unit) {
    var count by remember(kind) { mutableIntStateOf(2) }
    var todoHeight by remember(kind) { mutableIntStateOf(188) }
    var detail by remember(kind) { mutableStateOf<Route?>(null) }
    var revision by remember(kind) { mutableIntStateOf(0) }
    val height = if (detail != null) 760.dp else if (kind == "todo") todoHeight.dp else (152 + count * 58).coerceIn(188, 660).dp
    val resize: (Int) -> Unit = { count = it }
    LaunchedEffect(state.route) { if (state.route != null) dismiss() }
    fun open(route: Route) { if (route.name in listOf("record", "task")) detail = route else model.navigate(route) }
    fun back() { detail = null; revision++ }
    DuduSheet(dismiss) {
        Box(Modifier.fillMaxWidth().height(height)) {
            Box(Modifier.fillMaxSize().alpha(if (detail == null) 1f else 0f).then(
                if (detail == null) Modifier else Modifier.clearAndSetSemantics {})) {
            when (kind) {
                "info" -> CollectorScreen(model, back = dismiss, onCount = resize, open = ::open, refreshKey = revision, active = detail == null)
                "task" -> TasksScreen(model, back = dismiss, onCount = resize, open = ::open, refreshKey = revision, active = detail == null)
                else -> AssistantTodos(state, model, back = dismiss, onCount = resize, onHeight = { todoHeight = it })
            }
            }
            detail?.let { route -> key(route) {
                when (route.name) {
                    "record" -> RecordScreen(route, model, back = ::back, close = dismiss)
                    "task" -> TaskScreen(route, state, model, back = ::back, close = dismiss)
                }
            } }
        }
    }
}

@Composable
fun AssistantTodos(state: UiState, model: DuduViewModel, back: () -> Unit = model::backRoute,
    onCount: ((Int) -> Unit)? = null, onHeight: ((Int) -> Unit)? = null) {
    val actions = rememberActions()
    var rows by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var expanded by remember { mutableStateOf<Long?>(null) }
    var total by remember { mutableIntStateOf(0) }
    val heights = remember { mutableStateMapOf<Long, Int>() }
    val density = LocalDensity.current
    val sessionId = state.session?.id ?: return
    fun read(more: Boolean = false) = actions.run {
        val params = json("sessionId" to sessionId)
        if (more) cursor?.let { params.put("cursor", it) }
        val result = model.request("assistant.todos", params)
        rows = (if (more) rows + result.rows("rows") else result.rows("rows")).distinctBy { it.getLong("id") }
        total = result.optInt("total", rows.size)
        cursor = result.nullableString("nextCursor")
    }
    LaunchedEffect(actions.revision) { read() }
    LaunchedEffect(rows.size) { onCount?.invoke(rows.size) }
    val height = 88 + rows.sumOf { issue -> heights[issue.getLong("id")]?.let { with(density) { it.toDp().value.toInt() } }
        ?: if (issue.optJSONObject("latest") != null) 104 else 56 }
    LaunchedEffect(height) { onHeight?.invoke(height.coerceIn(188, 660)) }
    Page(w("待办"), back, actions, count = total.takeIf { onCount != null }, top = {
        if (onCount == null) IconButton(onClick = { actions.refresh() }) { Glyph(R.drawable.ic_refresh_cw, w("刷新")) }
    }) {
        LazyColumn(Modifier.fillMaxSize().testTag("assistant-todos"), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (rows.isEmpty() && !actions.busy && actions.error == null) item {
                Box(Modifier.fillMaxWidth().height(82.dp), contentAlignment = Alignment.Center) {
                    Text(w("没有事项"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            cardItems(rows, key = { it.getLong("id") }, inset = 20) { issue ->
                val id = issue.getLong("id")
                Box(Modifier.onSizeChanged { heights[id] = it.height }) {
                    QuickTodoIssueRow(issue, state, model, expanded == id, { expanded = if (expanded == id) null else id }, back)
                }
            }
            if (cursor != null) item { TextButton(onClick = { read(true) }, enabled = !actions.busy,
                modifier = Modifier.fillMaxWidth()) { Text(w("加载更多")) } }
        }
    }
}
