@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import android.icu.text.ListFormatter
import androidx.annotation.DrawableRes
import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateIntAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.dropShadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.shadow.Shadow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.data.*
import java.text.Collator
import kotlin.math.roundToInt

@Composable
internal fun BoardFilterBar(scope: Scope, active: Boolean, open: () -> Unit, select: (Scope) -> Unit) {
    val colors = MaterialTheme.colorScheme
    val dark = isSystemInDarkTheme()
    val track = if (dark) colors.surfaceContainerHighest else DuduStyle.scopeTrack
    Row(Modifier.fillMaxWidth().heightIn(min = 50.dp).padding(start = 8.dp, end = 16.dp),
        verticalAlignment = Alignment.CenterVertically) {
        IconButton(open, Modifier.size(48.dp).testTag("board-filter").semantics { selected = active }) {
            Box(Modifier.size(32.dp).background(
                if (active) colors.secondaryContainer else if (dark) colors.surfaceContainerHigh else track, CircleShape),
                contentAlignment = Alignment.Center) {
                Glyph(DuduGlyphs.listFilter, w("筛选"), 18, tint = if (active) colors.onSecondaryContainer
                    else if (dark) colors.onSurfaceVariant else DuduStyle.scopeInk)
            }
        }
        // The tabs use the owner's approved #EFF0F2 track and softly shadowed white pill (2026-11-20), its words the grey of the others ("就用灰色吧"), that slides to the tab that is chosen, as Lark's message filter row does (owner, 2026-11-18:
        // "胶囊会移动到下一个选项"). The pill is one box that is moved, not one in each tab: each tab says where it is, and the first place is taken without moving.
        val density = LocalDensity.current
        val places = remember { mutableStateMapOf<Scope, Pair<Int, Int>>() }
        val place = places[scope]
        var placed by remember { mutableStateOf(false) }
        val move: AnimationSpec<Int> = if (placed) tween(300, easing = FastOutSlowInEasing) else snap()
        val pillX by animateIntAsState(place?.first ?: 0, move, label = "scope-pill-x")
        val pillWidth by animateIntAsState(place?.second ?: 0, move, label = "scope-pill-width")
        val pillInset = with(density) { 2.dp.roundToPx() }
        LaunchedEffect(place) { if (place != null) placed = true }
        Row(Modifier.horizontalScroll(rememberScrollState()).selectableGroup()) {
            Box {
                // Clip the shadow to the track independently of the full-height selectable tabs.
                Box(Modifier.matchParentSize().padding(vertical = 8.dp).clip(CircleShape).background(track)) {
                    if (place != null) Box(Modifier.align(Alignment.CenterStart).offset { IntOffset(pillX + pillInset, 0) }
                        .width(with(density) { pillWidth.toDp() }).height(28.dp)
                        .then(if (dark) Modifier.border(1.dp, colors.outline, CircleShape) else Modifier.dropShadow(
                            CircleShape, Shadow(radius = 20.dp, color = Color.Black.copy(alpha = .1f), offset = DpOffset(3.dp, 0.dp))))
                        .background(colors.surface, CircleShape))
                }
                Box(Modifier.padding(horizontal = 2.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        for (option in Scope.entries) {
                            val selected = option == scope
                            Box(Modifier.widthIn(min = if (option == Scope.All) 78.dp else 65.dp).heightIn(min = 48.dp)
                                .testTag("scope-${option.wire}")
                                .onGloballyPositioned { places[option] = it.positionInParent().x.roundToInt() to it.size.width }
                                .clip(CircleShape)
                                .selectable(selected, interactionSource = remember(option) { MutableInteractionSource() },
                                    indication = null, role = Role.Tab, onClick = { select(option) }),
                                contentAlignment = Alignment.Center) {
                                Text(scopeTitle(option), Modifier.padding(horizontal = 13.dp, vertical = 8.dp),
                                    fontSize = 13.sp, maxLines = 1,
                                    color = if (dark) colors.onSurfaceVariant else DuduStyle.scopeInk,
                                    fontWeight = FontWeight.Normal)
                            }
                        }
                    }
                }
            }
        }
    }
}

private enum class FilterCategory(val fields: List<BoardFilterField>, @param:DrawableRes val icon: Int? = null) {
    Status(listOf(BoardFilterField.Status), DuduGlyphs.filterStatus),
    Agent(listOf(BoardFilterField.Agent), DuduGlyphs.model),
    Session(listOf(BoardFilterField.SessionState), DuduGlyphs.trace),
    Priority(listOf(BoardFilterField.Priority)),
    Dates(listOf(BoardFilterField.Due, BoardFilterField.Created, BoardFilterField.Updated), DuduGlyphs.filterDates),
    Project(listOf(BoardFilterField.Project), DuduGlyphs.issueProject),
    Label(listOf(BoardFilterField.Label), DuduGlyphs.issueLabel),
    Source(listOf(BoardFilterField.Source), DuduGlyphs.issueSource);

    @Composable fun title() = if (this == Dates) w("日期") else fields.first().title()

    companion object {
        val groups = listOf(listOf(Status, Agent, Session, Priority, Dates), listOf(Project, Label), listOf(Source))
    }
}

private data class CategoryRow(val category: FilterCategory, val title: String, val summary: String)
private data class ChoiceRow(val option: BoardFilterOption, val title: String)

/**
 * The board's filter sheet: the categories, and a category's choices with their counts. `only` is the search page's use of it: the choices of that one field are all it shows (the
 * page's pills are the categories), with the title of the field and no 重置 or ‹.
 */
@Composable
internal fun BoardFilterSheet(
    home: Home?,
    scoped: List<Conversation>,
    filters: BoardFilters,
    close: () -> Unit,
    reset: () -> Unit,
    toggle: (BoardFilterField, String?) -> Unit,
    only: BoardFilterField? = null,
) {
    var category by remember { mutableStateOf<FilterCategory?>(null) }
    var search by remember { mutableStateOf("") }
    val section = category
    val choosing = only != null || section != null
    val colors = MaterialTheme.colorScheme
    val locale = appLocale()
    val format = remember(locale) { ListFormatter.getInstance(locale) }
    val collator = remember(locale) { Collator.getInstance(locale) }
    val countFormat = remember(locale) { java.text.NumberFormat.getIntegerInstance(locale) }
    val labels = remember(home) {
        home?.rows.orEmpty().flatMap { it.issue?.labels.orEmpty() }.associateBy { it.id.toString() }
    }
    val statuses = remember(home) {
        val observed = home?.rows.orEmpty().mapNotNull(Conversation::issue)
            .map { Status(it.status, name = null, type = it.statusType, isDefault = false) }
        val configured = home?.statuses.orEmpty().ifEmpty {
            listOf("backlog", "todo", "in_progress", "in_review", "done", "canceled")
                .map { Status(it, name = null, type = it, isDefault = false) }
        }
        (configured + observed).distinctBy(Status::id)
    }
    val statusById = remember(statuses) { statuses.associateBy(Status::id) }
    val query = search.trim()
    fun matches(title: String) = title.contains(query, ignoreCase = true)

    val groups = if (choosing) emptyList() else FilterCategory.groups.map { group ->
        group.mapNotNull { item ->
            val title = item.title()
            if (!matches(title)) return@mapNotNull null
            val selected = item.fields.flatMap { field ->
                filters.selected(field).map { field.title(it, statusById, labels) }
            }.sortedWith(collator)
            CategoryRow(item, title, if (selected.isEmpty()) "" else format.format(selected))
        }
    }.filter { it.isNotEmpty() }

    val fields = if (only != null) listOf(only) else section?.fields.orEmpty()
    val options = remember(filters, fields, scoped, statuses) {
        fields.associateWith { filters.options(it, scoped, statuses) }
    }
    val choices = fields.mapNotNull { field ->
        val rows = options.getValue(field).mapNotNull { option ->
            val title = field.title(option.key, statusById, labels)
            if (matches(title)) ChoiceRow(option, title) else null
        }
        if (rows.isEmpty()) return@mapNotNull null
        val ordered = if (field.choices != null || field == BoardFilterField.Status) rows else
            rows.sortedWith(compareBy<ChoiceRow> { it.option.key == null }.thenBy(collator) { it.title })
        field to ordered
    }
    val headings = if (fields.size <= 1) emptyMap() else choices.associate { it.first to it.first.title() }
    DuduSheet(close) {
        val focus = LocalFocusManager.current
        fun show(next: FilterCategory?) {
            focus.clearFocus()
            search = ""
            category = next
        }
        CenterAlignedTopAppBar(
            title = { Text(only?.title() ?: section?.title() ?: w("筛选"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                maxLines = 1, overflow = TextOverflow.Ellipsis) },
            expandedHeight = 52.dp,
            windowInsets = WindowInsets(0),
            colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.surfaceContainer),
            navigationIcon = {
                if (only != null) Unit
                else if (section != null) {
                    IconButton(onClick = { show(null) }, modifier = Modifier.padding(start = 10.dp)) {
                        Glyph(DuduGlyphs.back, stringResource(R.string.back), 22)
                    }
                } else {
                    FilledTonalButton(reset, Modifier.padding(start = 16.dp).minimumInteractiveComponentSize()
                        .height(36.dp).widthIn(min = 64.dp).testTag("board-filter-reset"), enabled = !filters.isEmpty,
                        colors = ButtonDefaults.filledTonalButtonColors(containerColor = colors.surfaceContainerHighest,
                            contentColor = colors.onSurface), contentPadding = PaddingValues(horizontal = 12.dp)) {
                        Text(w("重置"), fontSize = 16.sp)
                    }
                }
            },
            actions = {
                IconButton(onClick = close, modifier = Modifier.testTag("close-sheet")) {
                    Glyph(DuduGlyphs.close, stringResource(R.string.close), 20)
                }
            },
        )
        Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 8.dp)) {
            SearchField(search, if (!choosing) w("添加筛选…") else w("筛选…"), tag = "board-filter-search",
                prominent = true, containerColor = colors.surfaceContainerHighest, iconSize = 16, fontSize = 15) { search = it }
        }
        key(section) {
            LazyColumn(Modifier.fillMaxWidth().weight(1f, fill = false),
                contentPadding = PaddingValues(bottom = 20.dp)) {
                groups.forEachIndexed { group, rows ->
                    if (group > 0) item { Spacer(Modifier.height(8.dp)) }
                    itemsIndexed(rows, key = { _, row -> row.category.name }) { index, row ->
                        FilterCardRow(index, rows.lastIndex) { FilterCategoryRow(row) { show(row.category) } }
                    }
                }
                choices.forEachIndexed { group, (field, rows) ->
                    if (group > 0) item { Spacer(Modifier.height(8.dp)) }
                    headings[field]?.let { title -> item {
                        Text(title, Modifier.padding(start = 25.dp, bottom = 5.dp), fontSize = 13.sp, color = filterSecondary())
                    } }
                    itemsIndexed(rows, key = { _, row -> field.name to row.option.key }) { index, row ->
                        FilterCardRow(index, rows.lastIndex) {
                            FilterChoiceRow(
                                row, field, row.option.key in filters.selected(field), statusById, labels,
                                row.option.count?.let { countFormat.format(it) },
                            ) { toggle(field, row.option.key) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun FilterCardRow(index: Int, last: Int, content: @Composable () -> Unit) {
    GroupRow(index == 0, index == last, inset = 16, dividerStart = 15, dividerEnd = 15, radius = 16, content = content)
}

@Composable
private fun FilterCategoryRow(row: CategoryRow, open: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = open)
        .heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(18.dp), contentAlignment = Alignment.Center) {
            row.category.icon?.let { Glyph(it, size = 18, tint = filterSecondary()) } ?: IssuePriorityMark("high")
        }
        Text(row.title, fontSize = 16.sp, maxLines = 1)
        Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
            if (row.summary.isNotEmpty()) Text(row.summary, fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSecondaryContainer, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Glyph(DuduGlyphs.right, size = 14, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun FilterChoiceRow(
    row: ChoiceRow, field: BoardFilterField, selected: Boolean, statuses: Map<String, Status>, labels: Map<String, Label>,
    count: String?, toggle: () -> Unit,
) {
    val id = row.option.key
    ChoiceLine(row.title, selected, count, toggle) {
        when (field) {
            BoardFilterField.Agent -> if (id != null) AgentLogo(id, 16)
            BoardFilterField.Priority -> if (id != null) IssuePriorityMark(id)
            BoardFilterField.Status -> statuses[id]?.let { IssueStatusMark(it) }
            BoardFilterField.Label -> labels[id]?.let { label ->
                Box(Modifier.size(9.dp).background(labelColor(label.color), CircleShape))
            }
            else -> Unit
        }
    }
}

/** One choice of a filter: a checkbox, what it is marked with (`leading`), its name, and how many rows it would keep. The search page's own choices (状态, 来源) are drawn with it too. */
@Composable
internal fun ChoiceLine(title: String, selected: Boolean, count: String? = null, toggle: () -> Unit, leading: @Composable () -> Unit = {}) {
    val colors = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth().toggleable(selected, role = Role.Checkbox, onValueChange = { toggle() })
        .heightIn(min = 48.dp).padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(18.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(4.dp))
            .background(if (selected) DuduStyle.blue else colors.surface)
            .then(if (selected) Modifier else Modifier.border(1.dp,
                colors.onSurfaceVariant.copy(alpha = .45f), androidx.compose.foundation.shape.RoundedCornerShape(4.dp))),
            contentAlignment = Alignment.Center) {
            if (selected) Glyph(DuduGlyphs.check, size = 14, tint = Color.White)
        }
        leading()
        Text(title, Modifier.weight(1f), fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        count?.let { Text(it, fontSize = 14.sp, color = filterSecondary()) }
    }
}

@Composable
internal fun filterSecondary() = MaterialTheme.colorScheme.onSurface.copy(alpha = .68f)

@Composable
internal fun BoardFilterField.title(): String = when (this) {
    BoardFilterField.Status -> stringResource(R.string.status)
    BoardFilterField.Agent -> stringResource(R.string.agent)
    BoardFilterField.SessionState -> w("会话状态")
    BoardFilterField.Priority -> stringResource(R.string.priority)
    BoardFilterField.Due -> w("截止日期")
    BoardFilterField.Created -> w("创建时间")
    BoardFilterField.Updated -> w("更新时间")
    BoardFilterField.Project -> stringResource(R.string.project)
    BoardFilterField.Label -> w("标签")
    BoardFilterField.Source -> w("来源")
}

@Composable
internal fun BoardFilterField.title(id: String?, statuses: Map<String, Status>, labels: Map<String, Label>): String = when (this) {
    BoardFilterField.Status -> statuses[id]?.let { statusTitle(it) } ?: id.orEmpty()
    BoardFilterField.Agent -> if (id == null) stringResource(R.string.unassigned) else agentName(id)
    BoardFilterField.SessionState -> when (id) {
        "unread" -> w("未读")
        "processing" -> w("工作")
        "idle" -> w("空闲")
        else -> stringResource(R.string.unassigned)
    }
    BoardFilterField.Priority -> priorityTitle(id.orEmpty())
    BoardFilterField.Project -> id ?: stringResource(R.string.no_project)
    BoardFilterField.Label -> labels[id]?.name ?: "#$id"
    BoardFilterField.Source -> when (id) {
        "owner" -> w("你")
        "dudu" -> stringResource(R.string.dudu)
        "connector" -> w("信息")
        "session" -> w("会话")
        else -> id.orEmpty()
    }
    BoardFilterField.Due, BoardFilterField.Created, BoardFilterField.Updated -> when (id) {
        "overdue" -> w("已逾期")
        "today" -> w("今天")
        "next7" -> w("未来 7 天")
        "next30" -> w("未来 30 天")
        "day" -> w("过去一天")
        "week" -> w("过去一周")
        "month" -> w("过去一个月")
        else -> id.orEmpty()
    }
}
