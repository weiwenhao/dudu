@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.roundToIntRect
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import java.text.DateFormat
import java.util.Calendar
import java.util.Date
import kotlinx.coroutines.launch

@Composable
fun DuduApp(state: UiState, model: DuduViewModel) {
    if (!state.initialized) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Box(contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.dudu), null, Modifier.size(64.dp))
            }
        }
        return
    }
    if (state.computers.isEmpty() && state.computerId.isEmpty()) {
        if (state.route?.name == "scan") PairingScanner(model) else PairingScreen(state, model)
        return
    }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val coroutine = rememberCoroutineScope()
    BackHandler(drawer.isOpen) { coroutine.launch { drawer.close() } }
    BackHandler(state.conversationTitle != null && state.panel == null && state.route == null) { model.leaveConversation() }
    ModalNavigationDrawer(
        drawerState = drawer, gesturesEnabled = state.conversationTitle == null,
        drawerContent = { DuduSidebar(state, model, drawer.isOpen) { coroutine.launch { drawer.close() } } },
    ) {
        val conversationOpen = state.conversationTitle != null
        val sheetRoute = state.route?.takeIf { it.isSheet(conversationOpen) }
        val pageRoute = pageRoute(state.route, model.routesBehindCurrent(), conversationOpen)
        if (pageRoute != null) FeatureScreen(pageRoute, state, model) { coroutine.launch { drawer.open() } }
        else if (state.conversationTitle != null) key(state.computerId, state.conversationKey) { ConversationPage(state, model) }
        else Scaffold(containerColor = MaterialTheme.colorScheme.surface,
            topBar = {
                CenterAlignedTopAppBar(
                    navigationIcon = {
                        IconButton(onClick = { coroutine.launch { drawer.open() } },
                            modifier = Modifier.testTag("open-drawer")) {
                            Glyph(R.drawable.ic_menu, stringResource(R.string.more))
                        }
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                    title = {}, // no page title on the board (owner, 2026-11-18: "app 顶部的看板两个字不需要了"); the bar is the menu and the two buttons
                    actions = {
                        IconButton(onClick = { model.show(Panel.Quota) }, enabled = state.connected && !state.busy,
                            modifier = Modifier.testTag("quota")) {
                            Glyph(R.drawable.ic_gauge, stringResource(R.string.quota))
                        }
                        IconButton(onClick = { model.show(Panel.Create) }, enabled = state.connected && !state.busy,
                            modifier = Modifier.testTag("new-issue")) {
                            Glyph(R.drawable.ic_plus, stringResource(R.string.new_issue))
                        }
                    },
                )
            },
        ) { insets ->
            val home = state.home
            val scoped = remember(home, state.scope) { home?.rows.orEmpty().filter(state.scope::includes) }
            val filters = state.boardFilters
            val rows = remember(scoped, filters) { filters.matching(scoped) }
            var showingFilters by remember(state.computerId) { mutableStateOf(false) }
            Column(Modifier.fillMaxSize().padding(insets)) {
            if (state.computerUnavailable) {
                BoardConnectionNotice()
            }
            PullToRefreshBox(isRefreshing = state.refreshing && home != null, onRefresh = model::refresh,
                modifier = Modifier.fillMaxWidth().weight(1f)) {
                LazyColumn(Modifier.fillMaxSize().testTag("home-list")) {
                    val pinned = home?.pinnedRows.orEmpty()
                    if (pinned.isNotEmpty()) item("pins") {
                        LazyRow(Modifier.fillMaxWidth().height(80.dp).testTag("pinned-shelf"),
                            contentPadding = PaddingValues(horizontal = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                            items(pinned, key = { it.id }) { row ->
                                var anchor by remember(row.id) { mutableStateOf(IntRect.Zero) }
                                Column(Modifier.width(56.dp).fillMaxHeight()
                                    .onGloballyPositioned { anchor = it.boundsInWindow().roundToIntRect() }
                                    .combinedClickable(onClick = { model.open(row) },
                                        onLongClick = { model.show(Panel.Actions(row, anchor)) })
                                    .padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                                    TitleAvatar(row, 40)
                                    Spacer(Modifier.height(5.dp))
                                    Text(if (row.id == "assistant") stringResource(R.string.dudu) else row.title,
                                        fontSize = 11.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                    }
                    item("filters") {
                        BoardFilterBar(state.scope, active = !filters.isEmpty, open = { showingFilters = true },
                            select = model::select)
                    }
                    items(rows, key = { it.id }) { row ->
                        HomeSwipeRow(row, state.busy, complete = { model.complete(row) },
                            read = { model.read(row) }, pin = { model.pin(row) }) { close ->
                            Surface { ConversationRow(row, onClick = { if (!close()) model.open(row) },
                                onLongClick = { model.show(Panel.Actions(row, it)) }, onChildren = {
                                    model.navigate(Route("subissues", target = row.issue?.id?.toString()))
                                }) }
                        }
                    }
                    if (home != null && rows.isEmpty()) item {
                        Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) {
                            Text(if (filters.isEmpty) stringResource(R.string.empty) else w("没有事项"),
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (home == null) {
                    if (state.refreshing || state.connecting) {
                        CircularProgressIndicator(Modifier.align(Alignment.Center).size(28.dp), strokeWidth = 2.dp)
                    } else {
                        TextButton(onClick = { if (state.connected) model.refresh() else model.show(Panel.Computers) },
                            modifier = Modifier.align(Alignment.Center)) {
                            Text(stringResource(if (state.connected) R.string.retry else R.string.computers))
                        }
                    }
                }
                if (state.problem != null && !isConnectionProblem(state.problem) && state.panel == null) {
                    Surface(Modifier.align(Alignment.BottomCenter).padding(16.dp),
                        shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                        Row(Modifier.padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(problemText(state.problem), Modifier.weight(1f), fontSize = 14.sp)
                            TextButton(onClick = { model.clearProblem(); model.refresh() }) { Text(stringResource(R.string.retry)) }
                        }
                    }
                }
            }
            }
            if (showingFilters) {
                BoardFilterSheet(home, scoped, filters, close = { showingFilters = false },
                    reset = model::resetBoardFilters, toggle = model::toggleBoardFilter)
            }
        }
        if (sheetRoute != null) DuduSheet(model::backRoute, containerColor =
            if (sheetRoute.name in setOf("preferences", "settings", "about", "computers", "computer") &&
                !androidx.compose.foundation.isSystemInDarkTheme()) DuduStyle.settings else MaterialTheme.colorScheme.surfaceContainer) {
            var measured by remember(sheetRoute) { mutableIntStateOf(0) }
            val height = if (measured > 0) measured.dp else when (sheetRoute.name) {
                "changes" -> 380.dp
                "files", "diff", "tool" -> 760.dp
                "activity", "session-tasks" -> 500.dp
                "issue" -> 420.dp
                "preferences", "settings", "about", "computers", "computer", "task", "record" -> 760.dp
                else -> 660.dp
            }
            CompositionLocalProvider(LocalSheetHeight provides { measured = it }) {
                Box(Modifier.fillMaxWidth().height(height)) { FeatureScreen(sheetRoute, state, model) }
            }
        }
    }
    Panels(state, model)
}

@Composable
private fun BoardConnectionNotice() {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    Surface(Modifier.fillMaxWidth().padding(top = 16.dp).height(40.dp).testTag("computer-unavailable"),
        color = if (dark) MaterialTheme.colorScheme.errorContainer else Color(0xFFFFE7E9)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Glyph(R.drawable.ic_circle_alert, size = 18, tint = MaterialTheme.colorScheme.error)
            Spacer(Modifier.width(12.dp))
            Text(w("电脑未连接"), Modifier.weight(1f), fontSize = 15.sp,
                color = if (dark) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface)
            RunningMark(14)
        }
    }
}

@Composable
private fun ConversationRow(row: Conversation, onClick: () -> Unit, onLongClick: (IntRect) -> Unit, onChildren: () -> Unit) {
    var anchor by remember(row.id) { mutableStateOf(IntRect.Zero) }
    Row(Modifier.fillMaxWidth().height(66.dp).testTag("row-${row.id}")
        .onGloballyPositioned { anchor = it.boundsInWindow().roundToIntRect() }
        .combinedClickable(onClick = onClick, onLongClick = { onLongClick(anchor) })
        .padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        TitleAvatar(row, 48)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(buildAnnotatedString {
                    row.issue?.parent?.let { withStyle(SpanStyle(MaterialTheme.colorScheme.onSurfaceVariant)) { append("$it#") } }
                    append(if (row.id == "assistant") stringResource(R.string.dudu) else row.title)
                }, Modifier.weight(1f), fontSize = 17.sp, lineHeight = 22.sp,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.width(12.dp))
                Text(receivedTime(row.receivedAt), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val imageLabel = stringResource(R.string.image)
                Text(row.preview.replace("［图片］", "［$imageLabel］"), Modifier.weight(1f),
                    fontSize = 14.sp, lineHeight = 20.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (row.issue != null) {
                    if (row.issue.subTotal > 0) {
                        Row(Modifier.clickable(onClick = onChildren).padding(horizontal = 8.dp)
                            .testTag("subissues-${row.issue.id}"), verticalAlignment = Alignment.CenterVertically) {
                        CircularProgressIndicator(progress = { row.issue.subDone.toFloat() / row.issue.subTotal },
                            modifier = Modifier.size(14.dp), strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            trackColor = MaterialTheme.colorScheme.outlineVariant)
                        Spacer(Modifier.width(6.dp))
                        Text("${row.issue.subDone}/${row.issue.subTotal}", fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Spacer(Modifier.width(12.dp))
                    AgentLogo(row.issue.agent, 14)
                }
            }
        }
    }
}

/** A conversation's tile: a rounded square in the tone of its title, with the title's initials (the home list, the forward picker; `title` is the issue's own, without its number). */
@Composable
fun TitleTile(title: String, size: Int) {
    val tone = avatarTones[avatarTone(title)]
    Box(Modifier.size(size.dp).clip(RoundedCornerShape((size / 4f).dp)).background(Color(tone.first)),
        contentAlignment = Alignment.Center) {
        Text(initials(title), fontSize = (size * .37).sp, fontWeight = FontWeight.Medium, color = Color(tone.second))
    }
}

@Composable
fun TitleAvatar(row: Conversation, size: Int) {
    Box(Modifier.size(size.dp)) {
        if (row.id == "assistant") Image(painterResource(R.drawable.dudu), null, Modifier.fillMaxSize())
        else TitleTile(row.title, size)
        val badge = (size * .265f).dp
        if (row.unread) Box(Modifier.align(Alignment.TopEnd).offset(x = badge / 2 - 1.dp, y = 2.dp - badge / 2)
            .size(badge).background(Color(0xFFEC1313), CircleShape))
        else if (row.sessionState == "processing") CircularProgressIndicator(
            Modifier.align(Alignment.TopEnd).offset(x = badge / 2 - 1.dp, y = 2.dp - badge / 2).size(badge),
            strokeWidth = 1.5.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
fun AgentLogo(agent: String?, size: Int = 22) {
    // The agents' pictures and names are in AgentMarks.kt, written from the Desktop's list. 嘟嘟 is not an agent of an issue: it has its own picture.
    val mark = agentMarks[agent]
    val dark = isDark()
    if (agent == "dudu") Image(painterResource(R.drawable.dudu), agentName(agent), Modifier.size(size.dp))
    else if (mark == null) Glyph(R.drawable.ic_user_round, size = size, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    else Image(painterResource(if (dark) mark.dark ?: mark.light else mark.light), mark.name, Modifier.size(size.dp),
        colorFilter = if (mark.ink && dark) ColorFilter.tint(MaterialTheme.colorScheme.onSurface) else null)
}

@Composable
fun AgentAvatar(agent: String?, state: String, size: Int = 20) {
    Box(Modifier.size(size.dp), contentAlignment = Alignment.Center) {
        AgentLogo(agent, (size * .9f).toInt())
        val mark = maxOf(6f, size * 13f / 49)
        val center = size / 2f + (size / 2f - .5f) / kotlin.math.sqrt(2f)
        if (state in listOf("processing", "unread")) Box(Modifier.offset(x = (center - size / 2f).dp, y = (size / 2f - center).dp)
            .size((mark + 2).dp).background(MaterialTheme.colorScheme.surface, CircleShape), contentAlignment = Alignment.Center) {
            if (state == "unread") Box(Modifier.size(mark.dp).background(Color(0xFFEC1313), CircleShape))
            else CircularProgressIndicator(Modifier.size(mark.dp), strokeWidth = 1.dp,
                color = MaterialTheme.colorScheme.onSurfaceVariant, trackColor = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
fun Glyph(@DrawableRes resource: Int, description: String? = null, size: Int = 24,
    tint: Color = MaterialTheme.colorScheme.onSurface) {
    Icon(painterResource(resource), description, Modifier.size(size.dp), tint = tint)
}

@Composable
fun scopeTitle(scope: Scope): String = stringResource(when (scope) {
    Scope.Active -> R.string.active
    Scope.Backlog -> R.string.backlog
    Scope.All -> R.string.all
})

fun agentName(agent: String?) = agentMarks[agent]?.name ?: agent ?: ""

@Composable
fun problemText(code: String): String = when (code) {
    "INVALID_LINK" -> stringResource(R.string.invalid_link)
    "AUTH_FAILED", "UNAUTHORIZED" -> stringResource(R.string.auth_failed)
    "IDENTITY_MISMATCH" -> stringResource(R.string.identity_mismatch)
    "PROTOCOL_ERROR" -> stringResource(R.string.protocol_error)
    "SEND_FAILED" -> stringResource(R.string.send_failed)
    "NOT_FOUND" -> w("请求的会话或资源已不存在。")
    "STALE_APPROVAL" -> w("电脑暂时无法完成请求。")
    "BAD_REQUEST" -> w("请求内容无效，请检查后重试。")
    "conflict" -> w("更改没能保存")
    "CONNECTION_FAILED", "UPSTREAM_UNAVAILABLE", "UPSTREAM_DISCONNECTED" -> stringResource(R.string.connection_failed)
    "UNSUPPORTED" -> w("暂不支持此操作。")
    "FORBIDDEN" -> w("电脑拒绝了此操作。")
    "BUSY", "busy" -> w("电脑正在处理其他操作，请稍后重试。")
    else -> w("电脑暂时无法完成请求。")
}

@Composable
private fun isDark() = androidx.compose.foundation.isSystemInDarkTheme()

@Composable
fun receivedTime(at: Long): String {
    if (at <= 0) return ""
    val locale = appLocale()
    val day = Calendar.getInstance().apply { timeInMillis = at }
    val today = Calendar.getInstance()
    if (day.get(Calendar.YEAR) == today.get(Calendar.YEAR) && day.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR))
        return DateFormat.getTimeInstance(DateFormat.SHORT, locale).format(Date(at))
    today.add(Calendar.DAY_OF_YEAR, -1)
    return if (day.get(Calendar.YEAR) == today.get(Calendar.YEAR) && day.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR))
        stringResource(R.string.yesterday) else android.text.format.DateFormat.getBestDateTimePattern(
            locale, "MMMd").let { java.text.SimpleDateFormat(it, locale).format(Date(at)) }
}
