@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle

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
    if (state.showsConnectionGuide) {
        val route = state.route
        if (route != null && !route.isSheet(false)) FeatureScreen(route, state, model)
        else PairingScreen(state, model)
        if (route?.isSheet(false) == true) FeatureSheet(route, state, model)
        Panels(state, model)
        return
    }
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val coroutine = rememberCoroutineScope()
    BackHandler(drawer.isOpen) { coroutine.launch { drawer.close() } }
    // The drawer's search slides in over it from the right and ‹ goes back to the drawer, as on the iPhone; opening a result closes both (the conversations it was given match by title at once).
    var searching by remember(state.computerId) { mutableStateOf<List<org.json.JSONObject>?>(null) }
    LaunchedEffect(drawer.isOpen) { if (!drawer.isOpen) searching = null }
    ModalNavigationDrawer(
        drawerState = drawer, gesturesEnabled = state.conversationTitle == null,
        drawerContent = { DuduSidebar(state, model, drawer.isOpen, search = { searching = it }) { coroutine.launch { drawer.close() } } },
    ) {
        val conversationOpen = state.conversationTitle != null
        val sheetRoute = state.route?.takeIf { it.isSheet(conversationOpen) }
        val pageRoute = pageRoute(state.route, model.routesBehindCurrent(), conversationOpen)
        val homeVisible = pageRoute == null && !conversationOpen
        // Where the back of the conversation goes: the board, the search page it was opened from, another page, or the conversation it was opened from inside. The search page stays composed under
        // its conversation (its words, rows and place are as they were when the conversation is closed), and, like the board, is placed under it while the back gesture is on its way, to be seen there.
        val shown = conversationOpen && pageRoute == null
        val returnRoute = if (shown) model.conversationReturnRoute() else null
        val returnsToConversation = shown && model.conversationReturnsToConversation()
        val searchPage = pageRoute?.takeIf { it.name == "search" } ?: returnRoute?.takeIf { it.name == "search" }
        val reveals = shown && !returnsToConversation && (returnRoute == null || returnRoute.name == "search")
        var revealing by remember { mutableStateOf(false) }
        Box(Modifier.fillMaxSize()) {
            key(state.computerId, state.language) {
                RetainedHomeRoot(homeVisible || revealing && reveals && returnRoute == null) {
                    HomeRoots(state, model, active = homeVisible && sheetRoute == null && state.panel == null && !drawer.isOpen) {
                        coroutine.launch { drawer.open() }
                    }
                }
            }
            if (searchPage != null) RetainedHomeRoot(pageRoute != null || revealing && reveals) {
                CompositionLocalProvider(LocalPageActive provides (pageRoute != null)) { FeatureScreen(searchPage, state, model) }
            }
            else if (pageRoute != null) FeatureScreen(pageRoute, state, model) { coroutine.launch { drawer.open() } }
            if (shown) key(state.computerId, state.conversationKey) {
                ConversationBackLayer(enabled = state.panel == null && state.route == null, reveals = reveals, revealing = { revealing = it },
                    leave = model::leaveConversation) { ConversationPage(state, model) }
            }
        }
        if (sheetRoute != null) FeatureSheet(sheetRoute, state, model)
    }
    val shown = searching
    androidx.compose.animation.AnimatedVisibility(shown != null && drawer.isOpen,
        enter = androidx.compose.animation.slideInHorizontally { it }, exit = androidx.compose.animation.slideOutHorizontally { it }) {
        var kept by remember { mutableStateOf(shown.orEmpty()) }
        if (shown != null) kept = shown
        SessionSearchPage(kept, state, model, back = { searching = null; DuduLog.record("sidebar.search.close") },
            opened = { searching = null; coroutine.launch { drawer.close() } })
    }
    Panels(state, model)
}

/**
 * What a tap on a board row does: open its conversation; for an issue no agent has been given, say 「请分配智能体」 in the app's toast, as the iPhone's board does (owner, 2026-11-22:
 * a tap on such a row did nothing and said nothing; the iPhone and the desktop say it too); and for an issue that has an agent but no conversation yet, show what it says (the iPhone's
 * issue detail), instead of a conversation that cannot be found.
 */
@Composable
internal fun rememberOpenRow(model: DuduViewModel): (Conversation) -> Unit = remember(model) {
    { row ->
        val issue = row.issue
        when {
            row.needsAgent -> model.toast(word("请分配智能体"), ToastKind.Information)
            issue != null && row.sessionId == null -> {
                DuduLog.record("board.open.detail", state = "no_session")
                model.navigate(Route("issue", issue.title, issue.id.toString()))
            }
            else -> model.open(row)
        }
    }
}

/** Keep each root's list, content and filters without leaving invisible hit targets or back handlers. */
@Composable
private fun RetainedHomeRoot(active: Boolean, content: @Composable () -> Unit) {
    androidx.compose.ui.layout.Layout(content, Modifier.fillMaxSize()) { measurables, constraints ->
        if (active) {
            val children = measurables.map { it.measure(constraints) }
            layout(constraints.maxWidth, constraints.maxHeight) { children.forEach { it.placeRelative(0, 0) } }
        } else layout(constraints.maxWidth, constraints.maxHeight) {}
    }
}

@Composable
private fun HomeRoots(state: UiState, model: DuduViewModel, active: Boolean, openDrawer: () -> Unit) {
    BackHandler(active && state.homeTab != HomeTab.Board) { model.selectHomeTab(HomeTab.Board) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(state.computerId, state.connected, active, lifecycle) {
        if (active && state.connected) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                model.refreshInboxCount()
                kotlinx.coroutines.delay(5_000)
            }
        }
    }
    val unread = remember(state.home, state.scope, state.boardFilters) {
        unreadSessionCount(state.boardFilters.matching(state.home?.rows.orEmpty().filter(state.scope::includes)) +
            state.home?.pinnedRows.orEmpty())
    }
    Scaffold(containerColor = MaterialTheme.colorScheme.surface, contentWindowInsets = WindowInsets(0),
        bottomBar = { HomeTabBar(state.homeTab, unread, state.inboxUnread, model::selectHomeTab) }) { insets ->
        Box(Modifier.fillMaxSize().padding(bottom = insets.calculateBottomPadding()).consumeWindowInsets(insets)) {
            HomeTab.entries.forEach { tab ->
                val selected = active && state.homeTab == tab
                RetainedHomeRoot(state.homeTab == tab) {
                    CompositionLocalProvider(LocalHomePage provides HomePageChrome(selected, homeTitle(tab), openDrawer)) {
                        when (tab) {
                            HomeTab.Board -> BoardPage(state, model, openDrawer)
                            HomeTab.Inbox -> CollectorScreen(model, active = selected && state.connected)
                            HomeTab.Tasks -> TasksScreen(model, active = selected && state.connected)
                            HomeTab.Settings -> PreferencesScreen(state, model)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BoardPage(state: UiState, model: DuduViewModel, openDrawer: () -> Unit) {
    Scaffold(containerColor = MaterialTheme.colorScheme.surface,
            topBar = {
                CenterAlignedTopAppBar(
                    navigationIcon = {
                        IconButton(onClick = { openDrawer() },
                            modifier = Modifier.testTag("open-drawer")) {
                            Glyph(DuduGlyphs.menu, stringResource(R.string.more))
                        }
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = MaterialTheme.colorScheme.surface),
                    title = {}, // no page title on the board (owner, 2026-11-18: "app 顶部的看板两个字不需要了"); the bar is the menu and the two buttons
                    actions = {
                        // The magnifier opens the search page; 额度 and 事项 are in the ··· menu (owner, 2026-11-27, `.local/designs/phone-search-2026-11-27/`), a drop-down like the conversation's.
                        IconButton(onClick = model::openSearch, enabled = state.connected, modifier = Modifier.testTag("search")) {
                            Glyph(DuduGlyphs.search, w("搜索"))
                        }
                        var menu by remember { mutableStateOf(false) }
                        Box {
                            IconButton(onClick = { menu = true }, modifier = Modifier.testTag("board-more")) {
                                Glyph(DuduGlyphs.options, stringResource(R.string.more))
                            }
                            DropdownMenu(menu, { menu = false }) {
                                DropdownMenuItem(text = { Text(w("事项")) }, leadingIcon = { Glyph(DuduGlyphs.plus, size = 18) },
                                    enabled = state.connected && !state.busy, modifier = Modifier.testTag("new-issue"),
                                    onClick = { menu = false; model.newIssue() })
                                DropdownMenuItem(text = { Text(stringResource(R.string.quota)) }, leadingIcon = { Glyph(DuduGlyphs.quota, size = 18) },
                                    enabled = state.connected && !state.busy, modifier = Modifier.testTag("quota"),
                                    onClick = { menu = false; model.show(Panel.Quota) })
                            }
                        }
                    },
                )
            },
        ) { insets ->
            val home = state.home
            val openRow = rememberOpenRow(model)
            val scoped = remember(home, state.scope) { home?.rows.orEmpty().filter(state.scope::includes) }
            val filters = state.boardFilters
            val rows = remember(scoped, filters) { filters.matching(scoped) }
            var showingFilters by remember(state.computerId) { mutableStateOf(false) }
            var pinsExpanded by remember(state.computerId) { mutableStateOf(false) }
            // One swiped row at a time, as on the iPhone: a scroll, another scope, a menu or leaving the page closes it.
            var revealed by remember(state.computerId) { mutableStateOf<String?>(null) }
            val pageActive = LocalHomePage.current?.active != false
            val list = rememberLazyListState()
            LaunchedEffect(list) {
                snapshotFlow { list.firstVisibleItemIndex to list.firstVisibleItemScrollOffset }.collect { revealed = null }
            }
            LaunchedEffect(state.scope, pageActive) { revealed = null }
            fun busy(row: Conversation) = row.id in state.changing
            fun available(row: Conversation) = state.connected && !busy(row)
            fun menu(row: Conversation, anchor: IntRect) { revealed = null; model.show(Panel.Actions(row, anchor)) }
            fun open(row: Conversation) { revealed = null; openRow(row) }
            Column(Modifier.fillMaxSize().padding(insets)) {
            if (state.computerUnavailable) {
                BoardConnectionNotice()
            }
            // The spinner of a pull shows only for the read the owner pulled for (owner, 2026-11-23: 「除非我主动下拉刷新，否则任何时候都不应该出现这个刷新 loading」): the board also reads
            // itself on connecting, after a pin, a read mark or 完成 and when the computer says it changed, and those reads were showing it.
            var pulled by remember { mutableStateOf(false) }
            LaunchedEffect(pulled, state.refreshing) { if (pulled && !state.refreshing) pulled = false }
            PullToRefreshBox(isRefreshing = pulled && state.refreshing && home != null, onRefresh = { pulled = true; model.refresh() },
                modifier = Modifier.fillMaxWidth().weight(1f)) {
                LazyColumn(Modifier.fillMaxSize().testTag("home-list"), state = list) {
                    val pinned = home?.pinnedRows.orEmpty()
                    if (pinned.isNotEmpty()) item("pins") {
                        Box(Modifier.testTag("pinned-shelf")) {
                            BoardPinnedShelf(pinned, pinsExpanded, { pinsExpanded = !pinsExpanded }) { row ->
                                PinnedCell(row, busy(row), open = { open(row) }, menu = { menu(row, it) })
                            }
                        }
                    }
                    item("filters") {
                        BoardFilterBar(state.scope, active = !filters.isEmpty, open = { revealed = null; showingFilters = true },
                            select = model::select)
                    }
                    if (home == null) item("board-loading") {
                        // Use the same position and states as iOS, below the scope row.
                        Column(Modifier.fillMaxWidth().padding(top = 80.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            if (state.boardLoadFailed && state.connected && !state.computerUnavailable)
                                ListFailure(w("事项没能加载"), retry = model::refresh)
                            else DeliveryLoadingMark(20)
                        }
                    }
                    // Only an empty 未读 says so, as on the iPhone; the other scopes are simply empty.
                    if (home != null && rows.isEmpty() && state.scope == Scope.Unread) item("board-empty") {
                        Box(Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(horizontal = BoardLayout.horizontalInset.dp),
                            contentAlignment = Alignment.Center) {
                            Text(w("没有找到事项"), fontSize = 15.sp, color = chatSecondary(),
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        }
                    }
                    items(rows, key = { it.id }) { row ->
                        HomeSwipeRow(row, enabled = pageActive && available(row), complete = { model.complete(row) },
                            read = { model.read(row) }, pin = { model.pin(row) }, revealed = revealed == row.id, onReveal = { open ->
                                if (open) revealed = row.id else if (revealed == row.id) revealed = null
                            }) { close ->
                            Surface { ConversationRow(row, busy(row), onClick = { close(); open(row) },
                                onLongClick = { menu(row, it) }, onChildren = {
                                    revealed = null
                                    model.navigate(Route("subissues", target = row.issue?.id?.toString()))
                                }) }
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

}

/** The guide and homepage open the same existing computer/detail sheets. */
@Composable
private fun FeatureSheet(route: Route, state: UiState, model: DuduViewModel) {
    DuduSheet(model::backRoute, showsConnectionToast = route.name == "pair", containerColor =
        if (route.name in setOf("changes", "diff", "files", "delivered-files")) MaterialTheme.colorScheme.surface
        else if (route.name == "preferences" &&
            !androidx.compose.foundation.isSystemInDarkTheme()) DuduStyle.settings else MaterialTheme.colorScheme.surfaceContainer) {
        if (route.name == "pair") {
            key(route) { AddComputerScreen(route, state, model) }
            return@DuduSheet
        }
        var measured by remember(route) { mutableIntStateOf(0) }
        val height = if (measured > 0) measured.dp else when (route.name) {
            "changes" -> 380.dp
            "files", "diff", "tool" -> 760.dp
            "activity", "session-tasks" -> 500.dp
            "issue" -> 420.dp
            "preferences", "task", "record" -> 760.dp
            else -> 660.dp
        }
        CompositionLocalProvider(LocalSheetHeight provides { measured = it }) {
            Box(Modifier.fillMaxWidth().height(height)) { FeatureScreen(route, state, model) }
        }
    }
}

@Composable
private fun BoardConnectionNotice() {
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    // Straight under the toolbar: the 16dp that was above it, on top of the bar's own slack, left a wide empty band (owner, 2026-11-21).
    Surface(Modifier.fillMaxWidth().height(40.dp).testTag("computer-unavailable"),
        color = if (dark) MaterialTheme.colorScheme.errorContainer else Color(0xFFFFE7E9)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Glyph(DuduGlyphs.stateFailed, size = 18, tint = MaterialTheme.colorScheme.error)
            Spacer(Modifier.width(12.dp))
            Text(w("电脑未连接"), Modifier.weight(1f), fontSize = 15.sp,
                color = if (dark) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSurface)
            DeliveryLoadingMark(14)
        }
    }
}

/**
 * One row of the board, the iPhone's `BoardConversationRow`: the avatar, the title (a sub-issue's under its parent) and the time, the last message and the agent's logo, which a spinner
 * replaces while the row's own change is saved. The sub-issue progress is a button of its own, 44 dp high, 8 dp before the logo, over the row's own tap.
 * The search page draws its conversations with it too (owner, 2026-11-27: each place in the rows of its own page): `highlight` is what was typed, whose words are coloured, and `snippet` the
 * line of the conversation's text that matched, which takes the place of the last message on two lines at most, so that the row is as tall as it needs; it has no long press and no progress button.
 */
@Composable
internal fun ConversationRow(row: Conversation, busy: Boolean, onClick: () -> Unit, onLongClick: ((IntRect) -> Unit)?, onChildren: () -> Unit,
    highlight: String = "", snippet: String? = null) {
    var anchor by remember(row.id) { mutableStateOf(IntRect.Zero) }
    val interaction = remember { MutableInteractionSource() }
    val issue = row.issue
    val tall = snippet != null
    val progress = issue?.takeIf { it.subTotal > 0 && !tall }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Box(Modifier.fillMaxWidth().then(if (tall) Modifier.heightIn(min = 66.dp) else Modifier.height(66.dp))) {
        Row((if (tall) Modifier.fillMaxWidth() else Modifier.fillMaxSize()).testTag("row-${row.id}")
            .onGloballyPositioned { anchor = it.boundsInWindow().roundToIntRect() }
            .combinedClickable(interactionSource = interaction, indication = null, enabled = !busy,
                onClick = onClick, onLongClick = onLongClick?.let { press -> { press(anchor) } })
            .pressShade(interaction)
            .padding(horizontal = BoardLayout.horizontalInset.dp).then(if (tall) Modifier.padding(vertical = 9.dp) else Modifier),
            verticalAlignment = if (tall) Alignment.Top else Alignment.CenterVertically) {
            TitleAvatar(row, 48)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (tall) 3.dp else BoardLayout.lineSpacing.dp)) {
                Row(Modifier.height(BoardLayout.titleLineHeight.dp), verticalAlignment = Alignment.CenterVertically) {
                    BoardConversationTitle(if (row.id == "assistant") stringResource(R.string.dudu) else row.title, issue?.parent,
                        17.sp, 22.sp, Modifier.weight(1f), highlight)
                    if (row.receivedAt > 0) {
                        Spacer(Modifier.width(8.dp))
                        Text(receivedTime(row.receivedAt), fontSize = 14.sp, maxLines = 1, color = muted)
                    }
                }
                if (snippet != null) Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(highlighted(snippet, highlight), Modifier.weight(1f), fontSize = 14.sp, lineHeight = 20.sp, maxLines = 2,
                        overflow = TextOverflow.Ellipsis, color = muted)
                    if (issue != null) Box(Modifier.height(20.dp), contentAlignment = Alignment.Center) { AgentLogo(issue.agent, BoardLayout.agentSize) }
                } else Row(Modifier.height(20.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val imageLabel = stringResource(R.string.image)
                    Text(highlighted(row.preview.replace("［图片］", "［$imageLabel］"), highlight), Modifier.weight(1f),
                        fontSize = 14.sp, lineHeight = 20.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                        color = muted)
                    // Room for the progress button above, which draws the same label.
                    if (progress != null) Box(Modifier.alpha(0f)) { SubIssueProgressLabel(progress.subDone, progress.subTotal) }
                    if (busy) Box(Modifier.size(BoardLayout.agentSize.dp), contentAlignment = Alignment.Center) { RowSpinner(12) }
                    else if (issue != null) AgentLogo(issue.agent, BoardLayout.agentSize)
                }
            }
        }
        if (progress != null) Box(Modifier.align(Alignment.CenterEnd)
            .padding(end = (BoardLayout.horizontalInset + BoardLayout.agentSize).dp)
            .offset(y = ((BoardLayout.titleLineHeight + BoardLayout.lineSpacing) / 2f).dp)
            .height(44.dp).clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onChildren)
            .padding(horizontal = 8.dp).testTag("subissues-${progress.id}"), contentAlignment = Alignment.Center) {
            SubIssueProgressLabel(progress.subDone, progress.subTotal)
        }
    }
}

/** A pinned conversation, the iPhone's `pinnedCell`: the 40 dp avatar (covered by a spinner while its change is saved) and its name under it, 54 dp wide. */
@Composable
private fun PinnedCell(row: Conversation, busy: Boolean, open: () -> Unit, menu: (IntRect) -> Unit) {
    var anchor by remember(row.id) { mutableStateOf(IntRect.Zero) }
    Column(Modifier.requiredWidth(54.dp).height(BoardLayout.pinnedRowHeight.dp)
        .onGloballyPositioned { anchor = it.boundsInWindow().roundToIntRect() }
        .combinedClickable(interactionSource = remember { MutableInteractionSource() }, indication = null, enabled = !busy,
            onClick = open, onLongClick = { menu(anchor) }),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(40.dp)) {
            TitleAvatar(row, 40)
            if (busy) Box(Modifier.matchParentSize().background(Color.White.copy(alpha = .9f), pinnedSpinnerShape(row)),
                contentAlignment = Alignment.Center) { RowSpinner(18) }
        }
        Text(if (row.id == "assistant") stringResource(R.string.dudu) else row.title,
            fontSize = 11.5.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        if (row.id == "assistant") Image(painterResource(R.drawable.dudu), null,
            Modifier.size((size * .94f).dp).align(Alignment.Center))
        else TitleTile(row.title, size)
        AvatarStatus(row.sessionState, size, roundedSquare = row.id != "assistant")
    }
}

@Composable
fun AgentLogo(agent: String?, size: Int = 22) {
    // The agents' pictures and names are in AgentMarks.kt, written from the Desktop's list. 嘟嘟 is not an agent of an issue: it has its own picture.
    val mark = agentMarks[agent]
    val dark = isDark()
    if (agent == "dudu") Image(painterResource(R.drawable.dudu), agentName(agent), Modifier.size(size.dp))
    else if (mark == null && agent != null) Box(Modifier.size(size.dp)
        .background(MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .15f), CircleShape), contentAlignment = Alignment.Center) {
        Text(agentName(agent).take(1), fontSize = (size * .55f).sp, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    else if (mark == null) Box(Modifier.size(size.dp), contentAlignment = Alignment.Center) {
        val outline = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .5f)
        Glyph(DuduGlyphs.stateUnassigned, size = (size * .75f).toInt(), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
            drawCircle(outline, radius = (this.size.minDimension - 1.dp.toPx()) / 2,
                style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx(),
                pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 2.dp.toPx()))))
        }
    }
    else Image(painterResource(if (dark) mark.dark ?: mark.light else mark.light), mark.name, Modifier.size(size.dp),
        colorFilter = if (mark.ink) ColorFilter.tint(if (dark) MaterialTheme.colorScheme.onSurface else Color(0xFF17181B)) else null)
}

@Composable
fun AgentAvatar(agent: String?, state: String, size: Int = 20) {
    Box(Modifier.size(size.dp), contentAlignment = Alignment.Center) {
        AgentLogo(agent, (size * .9f).toInt())
        AvatarStatus(state, size)
    }
}

/** The same local anchor and white halo as ConversationAvatarStatus on iPhone. The inbox's rows use it too (`CollectorSummary`). */
@Composable
internal fun BoxScope.AvatarStatus(state: String, size: Int, roundedSquare: Boolean = false) {
    val mark = maxOf(6f, size * 13f / 49)
    val center = size / 2f + (size / 2f - .5f) / kotlin.math.sqrt(2f)
    val x = if (roundedSquare) size - 2f else center
    val y = if (roundedSquare) 2f else size - center
    Box(Modifier.align(Alignment.TopStart).offset(x = (x - mark / 2).dp, y = (y - mark / 2).dp).size(mark.dp)) {
        androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
            if (state in listOf("processing", "unread")) drawCircle(Color.White,
                radius = this.size.minDimension / 2 + maxOf(1f, size * 1.6f / 49).dp.toPx())
            if (state == "unread") drawCircle(Color(0xFFEC1313))
        }
        if (state == "processing") WorkingMark(mark.dp)
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
    Scope.Unread -> R.string.unread
    Scope.All -> R.string.all
})

fun agentName(agent: String?) = agentMarks[agent]?.name ?: agent ?: ""

@Composable
fun problemText(code: String): String = when (code) {
    "INVALID_LINK" -> stringResource(R.string.invalid_link)
    "AUTH_FAILED", "UNAUTHORIZED" -> stringResource(R.string.auth_failed)
    // The connection's words of the iPhone's `DuduFailure`.
    "AUTH_REQUIRED" -> w("请更新电脑端的 Dudu 插件")
    "METHOD_NOT_ALLOWED" -> w("请更新电脑端的手机控制插件")
    "INSECURE_PUBLIC" -> w("公网地址请使用 HTTPS")
    "MISSING_CREDENTIAL" -> w("请粘贴电脑生成的完整配对链接")
    "ROUTES_UNAVAILABLE_LAN" -> w("无法连接内网地址")
    "ROUTES_UNAVAILABLE" -> w("内网和公网都无法连接")
    "TIMEOUT" -> w("连接超时")
    "DISCONNECTED" -> w("连接已断开")
    "INVALID_ARGUMENT" -> w("请求内容无效，请检查后重试。")
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
    "LIMIT_EXCEEDED" -> w("上传失败")
    // A message of 嘟嘟's box to an issue that was not sent or not delivered: the desktop's approved words, as the iPhone's `AssistantRelayResult.errorText`.
    "RELAY_empty_request" -> w("@ 后面还要写要说的话。")
    "RELAY_choose_agent" -> w("先选择智能体。")
    "RELAY_choose_project" -> w("先选项目，再把工作交给智能体。")
    "RELAY_recipient_unavailable" -> w("只能 @ 当前事项的处理者。")
    "RELAY_delivery_failed" -> w("留言已保存，请求没能送达。")
    "RELAY_invalid_message" -> w("先写点内容。")
    else -> if (code.startsWith("RELAY_")) w("回复没能发给会话：连接暂时不可用。") else w("电脑暂时无法完成请求。")
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
