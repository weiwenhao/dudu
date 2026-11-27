@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.dudu.android.ui

import android.icu.text.ListFormatter
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import java.text.Collator
import org.json.JSONObject

/**
 * Whether the page is the one in front. The search page stays composed under the conversation that was opened from it (so that its words, rows and place are there when that is closed, and the
 * back gesture shows it under the conversation); then it is not in front, takes no back and asks nothing.
 */
internal val LocalPageActive = staticCompositionLocalOf { true }

/** The words that were typed, coloured wherever a result shows them: the app's blue, a little heavier (the drawings' matched words). */
internal fun highlighted(text: String, phrase: String): AnnotatedString {
    val ranges = matchRanges(text, searchTerms(phrase))
    if (ranges.isEmpty()) return AnnotatedString(text)
    return buildAnnotatedString {
        var at = 0
        for (range in ranges) {
            append(text.substring(at, range.first))
            withStyle(SpanStyle(color = DuduStyle.blue, fontWeight = FontWeight.Medium)) { append(text.substring(range.first, range.last + 1)) }
            at = range.last + 1
        }
        append(text.substring(at))
    }
}

/** The pickers of the range pages: the board's own sheet on one of its fields, or a short list of the page's own choices. */
private sealed interface SearchSheet {
    data class Board(val field: BoardFilterField) : SearchSheet
    data object InboxState : SearchSheet
    data object Sources : SearchSheet
    data object TaskStatus : SearchSheet
    data object TaskAgent : SearchSheet
}

private data class SearchChoice(val key: String?, val title: String, val leading: (@Composable () -> Unit)? = null)

/**
 * The search page (owner, 2026-11-27: Lark's, drawn in `.local/designs/phone-search-2026-11-27/`): a capsule field with 取消, the three places as pills, and under them the empty page (the
 * words searched for and 常用), the answer of all three places in groups of three rows with 更多, or one place alone with the choices that narrow it, in one row after its pill. Each place
 * is in the rows of its own page, the words typed coloured in them. The words, the place and the choices are the model's (`SearchModel`), so that the page is as it was left when a conversation
 * opened from it is closed. Not seen on a device yet.
 */
@Composable
fun SearchScreen(state: UiState, model: DuduViewModel) {
    val ui by model.search.state.collectAsState()
    val focus = LocalFocusManager.current
    val phrase = ui.query.trim()
    val range = ui.range
    val rows = state.home?.rows.orEmpty()
    val answer = ui.shown
    val openRow = rememberOpenRow(model)
    var sheet by remember { mutableStateOf<SearchSheet?>(null) }
    // The keyboard comes up on a page that was just opened, not on one that is back from a conversation with its words.
    val fresh = remember { ui.query.isEmpty() && ui.range == null }
    val active = LocalPageActive.current
    val leave = { focus.clearFocus(); model.leaveSearch() }
    BackHandler(enabled = active, onBack = leave)
    // In front again after a conversation was closed: the rows may have changed (a red dot, a time), so the same words are asked again without a sign of it.
    LaunchedEffect(active) { if (active) model.search.refresh() }
    // The collectors' names by id, which 来源 offers and its pill says: the latest answer's (it has every collector's; they do not change with the words or the choices, so a choice that is being
    // asked for again leaves the list as it was), and the sender of what was found.
    val sources = remember(ui.answer, ui.filters.sources) {
        val listed = ui.answer?.sources.orEmpty()
        val found = ui.answer?.inbox?.items.orEmpty().associate { it.optString("connector") to it.optString("connectorName") }
        (found + listed).filter { it.key.isNotEmpty() && it.value.isNotEmpty() } +
            ui.filters.sources.filterNot { id -> id in listed || id in found }.associateWith { it }
    }
    /** What a tap on a result does first: the words are remembered (they led to something). */
    fun used() { if (phrase.isNotEmpty()) model.rememberSearch(phrase); focus.clearFocus() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.statusBarsPadding().navigationBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Box(Modifier.weight(1f)) {
                    SearchField(ui.query, w("搜索"), "search-field", autoFocus = fresh, capsule = true, fontSize = 16,
                        onSearch = { used() }) { model.search.type(it) }
                }
                Box(Modifier.heightIn(min = 48.dp).clickable(role = Role.Button, onClick = leave).testTag("search-cancel"), contentAlignment = Alignment.Center) {
                    Text(stringResource(R.string.cancel), fontSize = 17.sp, maxLines = 1, color = DuduStyle.blue)
                }
            }
            Spacer(Modifier.height(16.dp))
            SearchPills(ui, sources, model.search) { sheet = it }
            Spacer(Modifier.height(6.dp))
            Box(Modifier.weight(1f).fillMaxWidth()) {
                if (phrase.isEmpty() && range == null) {
                    SearchIdle(state.searchMemory, rows, again = { words -> model.rememberSearch(words); model.search.type(words) },
                        clear = model::clearSearchHistory, open = { row -> used(); openRow(row) })
                } else {
                    SearchBody(ui, answer, rows, model, openRow = { row -> used(); openRow(row) }, openRecord = { card ->
                        used()
                        model.navigate(Route("record", card.optString("title"), card.getLong("id").toString(), json("record" to card, "tab" to recordTab(card))))
                    }, openTask = { task ->
                        used()
                        model.navigate(Route("task", task.optString("title"), task.getString("id")))
                    })
                }
            }
        }
    }
    when (val open = sheet) {
        null -> Unit
        is SearchSheet.Board -> {
            val base = remember(ui.query, answer, rows) { sessionBase(ui, rows).map(SessionHit::row) }
            BoardFilterSheet(state.home, base, ui.filters.sessions, close = { sheet = null }, reset = {},
                toggle = { field, key -> model.search.change { it.copy(sessions = it.sessions.toggle(field, key)) } }, only = open.field)
        }
        SearchSheet.InboxState -> SearchChoiceSheet(stringResource(R.string.status),
            listOf(SearchChoice("todo", w("待处理")), SearchChoice("done", w("已处理"))), setOfNotNull(ui.filters.inboxState),
            close = { sheet = null }) { key -> model.search.change { it.copy(inboxState = if (it.inboxState == key) null else key) } }
        SearchSheet.Sources -> {
            val collator = Collator.getInstance(appLocale())
            SearchChoiceSheet(w("来源"), sources.entries.sortedWith { a, b -> collator.compare(a.value, b.value) }.map { SearchChoice(it.key, it.value) },
                ui.filters.sources, close = { sheet = null }) { key ->
                if (key != null) model.search.change { it.copy(sources = if (key in it.sources) it.sources - key else it.sources + key) }
            }
        }
        SearchSheet.TaskStatus -> SearchChoiceSheet(stringResource(R.string.status),
            listOf("active", "paused", "ended").map { SearchChoice(it, taskStatus(it)) }, ui.filters.taskStatuses,
            close = { sheet = null }) { key ->
            if (key != null) model.search.change { it.copy(taskStatuses = if (key in it.taskStatuses) it.taskStatuses - key else it.taskStatuses + key) }
        }
        SearchSheet.TaskAgent -> {
            val collator = Collator.getInstance(appLocale())
            val agents = (ui.answer?.tasks?.items.orEmpty().map { it.nullableString("agent") } + ui.filters.taskAgents).distinct()
                .sortedWith { a, b -> collator.compare(agentName(a), agentName(b)) }
            SearchChoiceSheet(stringResource(R.string.agent),
                agents.map { agent -> SearchChoice(agent, if (agent == null) stringResource(R.string.unassigned) else agentName(agent)) { if (agent != null) AgentLogo(agent, 16) } },
                ui.filters.taskAgents, close = { sheet = null }) { key ->
                model.search.change { it.copy(taskAgents = if (key in it.taskAgents) it.taskAgents - key else it.taskAgents + key) }
            }
        }
    }
}

/** The conversations a range page narrows: the ones that matched the words, or, with none typed, every conversation of the board. */
private fun sessionBase(ui: SearchUi, rows: List<Conversation>): List<SessionHit> =
    if (ui.query.isBlank()) rows.map { SessionHit(it, null) } else ui.shown?.sessions?.items.orEmpty()

/** The pills under the field: the three places, or the place that was picked (its pill has a cross) followed by its own choices in the same row, which goes sideways when it is wider than the page. */
@Composable
private fun SearchPills(ui: SearchUi, sources: Map<String, String>, search: SearchModel, pick: (SearchSheet) -> Unit) {
    val range = ui.range
    val filters = ui.filters
    val locale = appLocale()
    val format = remember(locale) { ListFormatter.getInstance(locale) }
    fun joined(titles: List<String>) = titles.takeIf { it.isNotEmpty() }?.sorted()?.let(format::format)
    // 来源 and the tasks' 智能体 offer what the computer's answer holds: until it is here (or when it could not be read), they are grey and do nothing. 状态 and the conversations' choices need no answer.
    val answer = ui.shown
    val sourcesReady = answer?.inbox?.let { !it.failed } == true
    val agentsReady = answer?.tasks?.let { !it.failed } == true
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (range == null) for (place in SearchRange.entries) SearchPill(rangeTitle(place), "search-range-${place.wire}") { search.pick(place) }
        else {
            ChosenPill(rangeTitle(range), "search-range-${range.wire}") { search.pick(null) }
            when (range) {
                SearchRange.Sessions -> {
                    val none = emptyMap<String, Status>() to emptyMap<String, Label>()
                    for (field in listOf(BoardFilterField.Agent, BoardFilterField.Project, BoardFilterField.Updated)) {
                        FilterPill(field.title(), joined(filters.sessions.selected(field).map { field.title(it, none.first, none.second) }), "search-filter-${field.wire}") { pick(SearchSheet.Board(field)) }
                    }
                }
                SearchRange.Inbox -> {
                    FilterPill(stringResource(R.string.status), filters.inboxState?.let { if (it == "done") w("已处理") else w("待处理") }, "search-filter-state") { pick(SearchSheet.InboxState) }
                    FilterPill(w("来源"), joined(filters.sources.map { sources[it] ?: it }), "search-filter-source", enabled = sourcesReady) { pick(SearchSheet.Sources) }
                }
                SearchRange.Tasks -> {
                    FilterPill(stringResource(R.string.status), joined(filters.taskStatuses.map { taskStatus(it) }), "search-filter-state") { pick(SearchSheet.TaskStatus) }
                    FilterPill(stringResource(R.string.agent), joined(filters.taskAgents.map { if (it == null) stringResource(R.string.unassigned) else agentName(it) }), "search-filter-agent", enabled = agentsReady) { pick(SearchSheet.TaskAgent) }
                }
            }
        }
    }
}

@Composable
private fun rangeTitle(range: SearchRange) = when (range) {
    SearchRange.Sessions -> w("会话")
    SearchRange.Inbox -> w("收件箱")
    SearchRange.Tasks -> w("任务")
}

/** A place not picked yet: 36 dp high, 16 dp inside, 15 sp, on the grey of the field. */
@Composable
private fun SearchPill(title: String, tag: String, onClick: () -> Unit) {
    Box(Modifier.height(36.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceContainer)
        .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 16.dp).testTag(tag), contentAlignment = Alignment.Center) {
        Text(title, fontSize = 15.sp, maxLines = 1)
    }
}

/** The place that was picked: the app's blue on its faint fill, with a cross that takes it off. */
@Composable
private fun ChosenPill(title: String, tag: String, close: () -> Unit) {
    Row(Modifier.height(36.dp).clip(CircleShape).background(DuduStyle.blue.copy(alpha = .12f))
        .clickable(role = Role.Button, onClick = close).padding(start = 14.dp, end = 10.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontSize = 15.sp, maxLines = 1, color = DuduStyle.blue)
        Glyph(DuduGlyphs.close, stringResource(R.string.close), 14, DuduStyle.blue)
    }
}

/** A choice of the picked place: its name and a chevron, or, once something is chosen, what was chosen, in blue; grey and without a tap while what it offers has not come (`enabled` false). */
@Composable
private fun FilterPill(title: String, value: String?, tag: String, enabled: Boolean = true, open: () -> Unit) {
    val chosen = value != null
    Row(Modifier.alpha(if (enabled) 1f else .38f).height(36.dp).clip(CircleShape)
        .background(if (chosen) DuduStyle.blue.copy(alpha = .12f) else MaterialTheme.colorScheme.surfaceContainer)
        .clickable(enabled = enabled, role = Role.Button, onClick = open).padding(start = 14.dp, end = 10.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(value ?: title, Modifier.widthIn(max = 160.dp), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            color = if (chosen) DuduStyle.blue else MaterialTheme.colorScheme.onSurface)
        Glyph(DuduGlyphs.down, size = 14, tint = if (chosen) DuduStyle.blue else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * The page before anything is typed or picked, on Lark's light grey: the words searched for as white chips with a trash can that clears them, and under them 常用, a white card with a list of
 * conversations, all of the board's (the first six, the one opened last first).
 */
@Composable
private fun SearchIdle(memory: SearchMemory, rows: List<Conversation>, again: (String) -> Unit, clear: () -> Unit, open: (Conversation) -> Unit) {
    val colors = MaterialTheme.colorScheme
    val dark = isSystemInDarkTheme()
    val card = if (dark) colors.surfaceContainerHigh else Color.White
    val frequent = remember(memory, rows) { memory.frequent(rows) }
    Column(Modifier.fillMaxSize().background(if (dark) colors.surfaceContainerLow else DuduStyle.searchBody).verticalScroll(rememberScrollState())
        .padding(top = 14.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        if (memory.history.isNotEmpty()) Column(Modifier.padding(horizontal = 16.dp).testTag("search-history")) {
            Row(Modifier.fillMaxWidth().heightIn(min = 30.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(w("搜索历史"), Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                IconButton(onClick = clear, modifier = Modifier.size(40.dp).testTag("search-history-clear")) {
                    Glyph(DuduGlyphs.trash, stringResource(R.string.delete), 20, colors.onSurfaceVariant)
                }
            }
            Spacer(Modifier.height(2.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                for (words in memory.history) Box(Modifier.height(32.dp).clip(CircleShape).background(card)
                    .clickable(role = Role.Button) { again(words) }.padding(horizontal = 13.dp), contentAlignment = Alignment.Center) {
                    Text(words, Modifier.widthIn(max = 280.dp), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        if (frequent.isNotEmpty()) Column(Modifier.padding(horizontal = 8.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(card)
            .padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 8.dp).testTag("search-frequent")) {
            Text(w("常用"), Modifier.height(28.dp), fontSize = 17.sp, fontWeight = FontWeight.Medium)
            Spacer(Modifier.height(4.dp))
            for (row in frequent) Row(Modifier.fillMaxWidth().height(62.dp).clickable(role = Role.Button) { open(row) }.testTag("search-frequent-${row.id}"),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                TitleAvatar(row, 48)
                Text(if (row.id == "assistant") stringResource(R.string.dudu) else row.title, Modifier.weight(1f), fontSize = 17.sp, lineHeight = 22.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Under the pills once there is something to look for: the answer of the three places in groups, or of the one that was picked. */
@Composable
private fun SearchBody(ui: SearchUi, answer: SearchAnswer?, rows: List<Conversation>, model: DuduViewModel, openRow: (Conversation) -> Unit,
    openRecord: (JSONObject) -> Unit, openTask: (JSONObject) -> Unit) {
    val phrase = ui.query.trim()
    val range = ui.range
    val filters = ui.filters
    // A picked place with nothing typed and nothing chosen shows only the line saying what to do. 收件箱 and 任务 are asked for their rows all the same (what the pills offer is in the answer),
    // but the rows wait for a word or a choice; the conversations, with a choice made, are the board's own rows and need no answer.
    val local = range == SearchRange.Sessions && phrase.isEmpty()
    if (phrase.isEmpty() && range != null && !filters.any(range)) {
        Column(Modifier.fillMaxSize()) {
            ui.failure?.let { code -> SearchFailure(code, model.search::retry) }
            SearchEmpty(when (range) {
                SearchRange.Inbox -> w("输入关键词或使用筛选查找信息")
                SearchRange.Tasks -> w("输入关键词或使用筛选查找任务")
                SearchRange.Sessions -> w("输入关键词或使用筛选查找会话")
            })
        }
        return
    }
    val sessionHits = if (range == null || range == SearchRange.Sessions) sessionBase(ui, rows) else emptyList()
    val sessionRows = if (range == SearchRange.Sessions) narrowSessions(sessionHits, filters.sessions) else sessionHits
    val cards = answer?.inbox?.items.orEmpty()
    val tasks = if (range == SearchRange.Tasks) narrowTasks(answer?.tasks?.items.orEmpty(), filters) else answer?.tasks?.items.orEmpty()
    val shownRows = when (range) {
        null -> sessionRows.size + cards.size + tasks.size
        SearchRange.Sessions -> sessionRows.size
        SearchRange.Inbox -> cards.size
        SearchRange.Tasks -> tasks.size
    }
    // Never a blank page: rows, or 没有匹配的内容, or a spinner while the answer to these words is on its way (an old answer to other words is not one), or the failure.
    val gap = searchGap(shownRows, answered = local || answer != null, failure = ui.failure)
    val grouped = range == null
    LazyColumn(Modifier.fillMaxSize().testTag("search-results"), contentPadding = PaddingValues(bottom = 24.dp)) {
        ui.failure?.let { code -> item("failure") { SearchFailure(code, model.search::retry) } }
        when (gap) {
            SearchGap.Loading -> item("loading") { ListLoading(Modifier.padding(24.dp)) }
            SearchGap.Nothing -> item("nothing") { SearchEmpty(w("没有匹配的内容")) }
            SearchGap.None, SearchGap.Failure -> Unit
        }
        if (grouped) {
            if (sessionRows.isNotEmpty()) {
                item("sessions-title") { GroupHeader(w("会话"), answer?.sessions?.total ?: sessionRows.size, "search-more-sessions") { model.search.pick(SearchRange.Sessions) } }
                items(sessionRows.take(3), key = { "s:${it.row.id}" }) { SessionResult(it, phrase, openRow, model) }
            }
            if (cards.isNotEmpty()) {
                item("inbox-title") { GroupHeader(w("收件箱"), answer?.inbox?.total ?: cards.size, "search-more-inbox") { model.search.pick(SearchRange.Inbox) } }
                items(cards.take(3), key = { "i:${it.optLong("id")}" }) { InboxResult(it, phrase, openRecord) }
            }
            if (tasks.isNotEmpty()) {
                item("tasks-title") { GroupHeader(w("任务"), answer?.tasks?.total ?: tasks.size, "search-more-tasks") { model.search.pick(SearchRange.Tasks) } }
                items(tasks.take(3), key = { "t:${it.optString("id")}" }) { TaskResult(it, phrase, openTask) }
            }
        } else when (range) {
            SearchRange.Sessions -> items(sessionRows, key = { "s:${it.row.id}" }) { SessionResult(it, phrase, openRow, model) }
            SearchRange.Inbox -> items(cards, key = { "i:${it.optLong("id")}" }) { InboxResult(it, phrase, openRecord) }
            SearchRange.Tasks -> items(tasks, key = { "t:${it.optString("id")}" }) { TaskResult(it, phrase, openTask) }
        }
    }
}

/** The search page's own way to say a failure: a line and 重试 (the drawer's search has the same). */
@Composable
private fun SearchFailure(code: String, retry: () -> Unit) {
    Row(Modifier.padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically) {
        // A computer whose plugin does not know `search.query` says so as the drawer's search does (the iPhone's page says the same line).
        val text = if (code in listOf("UNSUPPORTED", "METHOD_NOT_ALLOWED")) w("请更新电脑端的 Dudu 插件") else problemText(code)
        Text(text, Modifier.weight(1f), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        IconButton(onClick = retry, modifier = Modifier.testTag("search-retry")) {
            Glyph(DuduGlyphs.completeContext, w("重试"), 16)
        }
    }
}

@Composable
private fun SessionResult(hit: SessionHit, phrase: String, open: (Conversation) -> Unit, model: DuduViewModel) {
    ConversationRow(hit.row, busy = false, onClick = { open(hit.row) }, onLongClick = null, highlight = phrase, snippet = hit.snippet,
        onChildren = { model.navigate(Route("subissues", target = hit.row.issue?.id?.toString())) })
}

@Composable
private fun InboxResult(card: JSONObject, phrase: String, open: (JSONObject) -> Unit) {
    Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { open(card) }.testTag("search-record-${card.optLong("id")}")) {
        CollectorSummary(card, recordTab(card), horizontalPadding = 16, highlight = phrase, snippet = card.nullableString("snippet"))
    }
}

@Composable
private fun TaskResult(task: JSONObject, phrase: String, open: (JSONObject) -> Unit) {
    Box(Modifier.fillMaxWidth().clickable(role = Role.Button) { open(task) }.testTag("search-task-${task.optString("id")}")) {
        TaskSummary(task, horizontalPadding = 16, highlight = phrase)
    }
}

/** A place's name, how many it found, and 更多 which goes to that place alone. */
@Composable
private fun GroupHeader(title: String, total: Int, tag: String, more: () -> Unit) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth().height(34.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        Text(total.toString(), Modifier.padding(start = 6.dp), fontSize = 14.sp, color = muted)
        Spacer(Modifier.weight(1f))
        Row(Modifier.fillMaxHeight().clickable(role = Role.Button, onClick = more).testTag(tag), verticalAlignment = Alignment.CenterVertically) {
            Text(w("更多"), fontSize = 14.sp, color = muted)
            Glyph(DuduGlyphs.right, size = 15, tint = muted)
        }
    }
}

/** Nothing to show, in one way for every case: a thin grey magnifier over one grey line (what to do, or that nothing matched), no mark of the app's. */
@Composable
private fun SearchEmpty(text: String) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.fillMaxWidth().padding(top = 136.dp).testTag("search-empty"), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Magnifier(44.dp, if (isSystemInDarkTheme()) muted.copy(alpha = .5f) else Color(0xFFC9CBD0))
        Text(text, fontSize = 15.sp, color = muted)
    }
}

/** Lucide's search drawn at its size with a line 1.3 of 24 thick, as in the drawing (the app's glyph is a bitmap with a line twice as thick). */
@Composable
private fun Magnifier(size: Dp, color: Color) {
    Canvas(Modifier.size(size)) {
        val unit = this.size.minDimension / 24f
        val line = Stroke(width = 1.3f * unit, cap = StrokeCap.Round)
        drawCircle(color, radius = 8f * unit, center = Offset(11f * unit, 11f * unit), style = line)
        drawLine(color, Offset(21f * unit, 21f * unit), Offset(16.7f * unit, 16.7f * unit), strokeWidth = 1.3f * unit, cap = StrokeCap.Round)
    }
}

/** The page's own choices (状态, 来源, an agent) in the board filter's sheet: its bar and its white card of rows with a checkbox each. */
@Composable
private fun SearchChoiceSheet(title: String, choices: List<SearchChoice>, selected: Set<String?>, close: () -> Unit, toggle: (String?) -> Unit) {
    DuduSheet(close) {
        CenterAlignedTopAppBar(
            title = { Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            expandedHeight = 52.dp,
            windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
            actions = {
                IconButton(onClick = close, modifier = Modifier.testTag("close-sheet")) {
                    Glyph(DuduGlyphs.close, stringResource(R.string.close), 20)
                }
            },
        )
        LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false), contentPadding = PaddingValues(top = 6.dp, bottom = 20.dp)) {
            itemsIndexed(choices, key = { _, choice -> choice.key ?: "" }) { index, choice ->
                FilterCardRow(index, choices.lastIndex) {
                    ChoiceLine(choice.title, choice.key in selected, toggle = { toggle(choice.key) }, leading = { choice.leading?.invoke() })
                }
            }
        }
    }
}
