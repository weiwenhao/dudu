package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject

@Composable
fun SessionSearchScreen(route: Route, state: UiState, model: DuduViewModel) {
    SessionSearchPage(route.params.rows("sessions"), state, model, back = model::backRoute)
}

/**
 * The search of conversations, the iPhone's `ConversationSearchView`. The drawer opens it over itself and ‹ goes back to the drawer (`back`); opening a result also closes the drawer
 * (`opened`). `sessions` are the drawer's conversations, matched by title at once while the computer searches their words.
 */
@Composable
fun SessionSearchPage(sessions: List<JSONObject>, state: UiState, model: DuduViewModel, back: () -> Unit, opened: () -> Unit = {}) {
    var query by rememberSaveable { mutableStateOf("") }
    var hits by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var busy by remember { mutableStateOf(false) }
    var problem by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableIntStateOf(0) }
    val focus = LocalFocusManager.current
    val phrase = query.trim()
    val local = remember(phrase, sessions) { sessions.filter {
        !it.optBoolean("blank") && phrase.isNotEmpty() &&
            "${it.optString("title")} ${it.optString("workspaceName")}".contains(phrase, true)
    }.map { json("session" to it, "snippet" to "") } }
    LaunchedEffect(phrase, retry, state.connected) {
        hits = emptyList(); problem = null; busy = phrase.isNotEmpty()
        if (phrase.isNotEmpty()) try {
            delay(200)
            do {
                val page = model.request("session.search", json("query" to phrase))
                hits = page.rows("items")
                if (!page.optBoolean("indexing")) break
                delay(800)
            } while (true)
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            problem = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
        } finally { busy = false }
    }
    val rows = (local + hits).filter { !it.getJSONObject("session").optBoolean("blank") }
        .associateBy { it.getJSONObject("session").getString("id") }.values
        .sortedWith(compareByDescending<JSONObject> { it.getJSONObject("session").optLong("updatedAt") }
            .thenBy { it.getJSONObject("session").getString("id") })
    BackHandler { focus.clearFocus(); back() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.statusBarsPadding().navigationBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 8.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                IconButton(onClick = { focus.clearFocus(); back() }) { Glyph(DuduGlyphs.back, w("返回"), 22) }
                Box(Modifier.weight(1f)) { SearchField(query, w("搜索对话内容…"), "session-search", autoFocus = true, capsule = true) { query = it } }
            }
            LazyColumn(Modifier.fillMaxSize()) {
                problem?.let { code -> item { Row(Modifier.padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(problemText(code), Modifier.weight(1f), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    IconButton(onClick = { retry++ }) { Glyph(DuduGlyphs.completeContext, w("重试"), 16) }
                } } }
                items(rows, key = { it.getJSONObject("session").getString("id") }) { hit ->
                    val session = hit.getJSONObject("session")
                    Surface(onClick = {
                        focus.clearFocus(); opened(); model.openSession(session.getString("id"), session.optString("title"))
                    }, color = MaterialTheme.colorScheme.surface) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 24.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            AgentAvatar(session.nullableString("agent"), session.optString("sessionState", "idle"), 20)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(highlightSearch(session.optString("title"), phrase), Modifier.weight(1f),
                                        fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(receivedTime(session.optLong("updatedAt")), Modifier.padding(start = 12.dp),
                                        fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                if (hit.optString("snippet").isNotBlank()) Text(highlightSearch(hit.getString("snippet"), phrase),
                                    fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
                if (busy) item { Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
                } }
                else if (phrase.isNotEmpty() && rows.isEmpty() && problem == null) item {
                    Text(w("没有匹配的会话"), Modifier.padding(24.dp), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

private fun highlightSearch(text: String, phrase: String) = buildAnnotatedString {
    if (phrase.isEmpty()) { append(text); return@buildAnnotatedString }
    var start = 0
    while (start < text.length) {
        val index = text.indexOf(phrase, start, ignoreCase = true)
        if (index < 0) { append(text.substring(start)); break }
        append(text.substring(start, index))
        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(text.substring(index, index + phrase.length)) }
        start = index + phrase.length
    }
}
