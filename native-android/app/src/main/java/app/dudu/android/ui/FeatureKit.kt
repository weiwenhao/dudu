@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun appLocale(): java.util.Locale = LocalConfiguration.current.locales[0]

class Actions(private val scope: CoroutineScope) {
    var busy by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var revision by mutableIntStateOf(0)
    fun run(block: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        scope.launch {
            try { block() }
            catch (e: Exception) {
                if (e is CancellationException) throw e
                error = (e as? ApiFailure)?.code ?: "CONNECTION_FAILED"
            } finally { busy = false }
        }
    }
    fun refresh() { revision++ }
}

@Composable
fun rememberActions(): Actions {
    val scope = rememberCoroutineScope()
    return remember(scope) { Actions(scope) }
}

private val LocalSheet = staticCompositionLocalOf { false }
private val LocalSheetColor = staticCompositionLocalOf { Color.Unspecified }
val LocalSheetHeight = staticCompositionLocalOf<(Int) -> Unit> { {} }
private class SheetDismissGuard { var blocked by mutableStateOf(false) }
private val LocalSheetDismissGuard = staticCompositionLocalOf<SheetDismissGuard?> { null }

@Composable
internal fun PreventSheetDismiss(blocked: Boolean) {
    val guard = LocalSheetDismissGuard.current
    DisposableEffect(guard, blocked) {
        guard?.blocked = blocked
        onDispose { guard?.blocked = false }
    }
}

@Composable
fun DuduSheet(dismiss: () -> Unit, containerColor: Color = MaterialTheme.colorScheme.surfaceContainer,
    canDismiss: Boolean = true,
    content: @Composable ColumnScope.() -> Unit) {
    val guard = remember { SheetDismissGuard() }
    ModalBottomSheet(
        onDismissRequest = { if (canDismiss && !guard.blocked) dismiss() }, containerColor = containerColor,
        tonalElevation = 0.dp, shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true,
            confirmValueChange = { it != SheetValue.Hidden || canDismiss && !guard.blocked }),
    ) {
        val maxHeight = with(androidx.compose.ui.platform.LocalDensity.current) {
            (androidx.compose.ui.platform.LocalWindowInfo.current.containerSize.height * .88f).toDp()
        }
        CompositionLocalProvider(LocalSheet provides true, LocalSheetColor provides containerColor,
            LocalSheetDismissGuard provides guard) {
            Column(Modifier.fillMaxWidth().heightIn(max = maxHeight), content = content)
        }
    }
}

@Composable
fun SheetHeader(title: String, dismiss: () -> Unit, enabled: Boolean = true,
    action: @Composable (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(start = 20.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
        action?.invoke()
        IconButton(onClick = dismiss, enabled = enabled, modifier = Modifier.testTag("close-sheet")) {
            Glyph(R.drawable.ic_x, stringResource(R.string.close), 20)
        }
    }
}

@Composable
fun Page(title: String, back: () -> Unit, actions: Actions? = null,
    centersSheetTitle: Boolean = false, nested: Boolean = false, cancels: Boolean = false,
    background: Color = if (LocalSheet.current) LocalSheetColor.current else MaterialTheme.colorScheme.background, count: Int? = null,
    close: (() -> Unit)? = null,
    top: @Composable RowScope.() -> Unit = {}, content: @Composable ColumnScope.() -> Unit) {
    val sheet = LocalSheet.current
    BackHandler { back() }
    Scaffold(containerColor = background,
        topBar = {
            if (sheet && centersSheetTitle) CenterAlignedTopAppBar(
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    fontSize = 16.sp, fontWeight = FontWeight.SemiBold) },
                windowInsets = WindowInsets(0),
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = background),
                navigationIcon = { if (cancels) TextButton(onClick = back) { Text(stringResource(R.string.cancel)) }
                    else if (nested) IconButton(onClick = back) {
                    Glyph(R.drawable.ic_arrow_left, stringResource(R.string.back), 22)
                } },
                actions = {
                    top()
                    if ((!nested && !cancels) || close != null) IconButton(onClick = close ?: back, modifier = Modifier.testTag("page-back")) {
                        Glyph(R.drawable.ic_x, stringResource(R.string.close), 20)
                    }
                },
            ) else if (sheet) TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            fontSize = if (count != null) 21.sp else 17.sp, fontWeight = FontWeight.SemiBold)
                        count?.let { Text(it.toString(), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                },
                windowInsets = WindowInsets(0),
                colors = TopAppBarDefaults.topAppBarColors(containerColor = background),
                actions = {
                    top()
                    IconButton(onClick = back, modifier = Modifier.testTag("page-back")) {
                        Glyph(R.drawable.ic_x, stringResource(R.string.close), 20)
                    }
                },
            ) else CenterAlignedTopAppBar(
                title = { Text(title, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    fontSize = 17.sp, fontWeight = FontWeight.SemiBold) },
                colors = TopAppBarDefaults.centerAlignedTopAppBarColors(containerColor = background),
                navigationIcon = { IconButton(onClick = back, modifier = Modifier.testTag("page-back")) {
                    Glyph(R.drawable.ic_arrow_left, stringResource(R.string.back), 22)
                } },
                actions = top,
            )
        },
    ) { insets ->
        Column(Modifier.fillMaxSize().padding(insets)) {
            Box(Modifier.fillMaxWidth().height(2.dp)) {
                if (actions?.busy == true) LinearProgressIndicator(Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.secondary)
            }
            actions?.error?.let { code ->
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(problemText(code), Modifier.weight(1f).testTag("page-error"), color = MaterialTheme.colorScheme.error, fontSize = 14.sp)
                    IconButton(onClick = { actions.error = null; actions.refresh() }, modifier = Modifier.testTag("page-retry")) {
                        Glyph(R.drawable.ic_refresh_cw, stringResource(R.string.retry), 20)
                    }
                }
            }
            content()
        }
    }
}

@Composable
fun Section(title: String) {
    Text(title, Modifier.padding(top = 20.dp, start = 20.dp, end = 20.dp, bottom = 6.dp),
        color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 13.sp, fontWeight = FontWeight.Medium)
}

@Composable
fun InsetCard(modifier: Modifier = Modifier, radius: Int = 22, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface,
        shape = RoundedCornerShape(radius.dp)) { Column(content = content) }
}

@Composable
fun GroupRow(first: Boolean, last: Boolean, divider: Boolean = true, inset: Int = 18, content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(
        topStart = if (first) 22.dp else 0.dp, topEnd = if (first) 22.dp else 0.dp,
        bottomStart = if (last) 22.dp else 0.dp, bottomEnd = if (last) 22.dp else 0.dp)
    Column(Modifier.padding(horizontal = inset.dp).fillMaxWidth().clip(shape)
        .background(MaterialTheme.colorScheme.surface)) {
        content()
        if (!last && divider) HorizontalDivider(Modifier.padding(start = 16.dp), thickness = .5.dp,
            color = MaterialTheme.colorScheme.outlineVariant)
    }
}

fun <T> LazyListScope.cardItems(rows: List<T>, key: ((T) -> Any)? = null, inset: Int = 18,
    content: @Composable (T) -> Unit) {
    itemsIndexed(rows, key = key?.let { getKey -> { _, row -> getKey(row) } }) { index, row ->
        GroupRow(index == 0, index == rows.lastIndex, inset = inset) { content(row) }
    }
}

@Composable
internal fun LibraryRowGroup(first: Boolean, last: Boolean, grouped: Boolean, content: @Composable () -> Unit) {
    if (grouped) GroupRow(first, last, inset = 20, content = content)
    else Box(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 2.dp).clip(RoundedCornerShape(11.dp))) { content() }
}

@Composable
fun Line(title: String, detail: String? = null, icon: Int? = null, danger: Boolean = false,
    enabled: Boolean = true, tag: String = "", leading: @Composable (() -> Unit)? = null,
    trailing: @Composable (() -> Unit)? = null,
    minHeight: Int = 56,
    action: (() -> Unit)? = null) {
    val color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    Row(Modifier.fillMaxWidth().testTag(tag).then(
        if (action == null) Modifier else Modifier.clickable(enabled = enabled, onClick = action))
        .heightIn(min = minHeight.dp).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (leading != null) leading() else icon?.let { Glyph(it, size = 21, tint = color) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, color = color, fontSize = 15.sp, lineHeight = 21.sp,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
            detail?.takeIf(String::isNotBlank)?.let {
                Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 12.sp,
                    lineHeight = 18.sp, maxLines = 3, overflow = TextOverflow.Ellipsis)
            }
        }
        if (trailing != null) trailing() else if (action != null) {
            Glyph(R.drawable.ic_chevron_right, size = 15, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun Form(scroll: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    val scrolling = if (scroll) Modifier.verticalScroll(rememberScrollState()) else Modifier
    Column(Modifier.fillMaxWidth().then(scrolling)
        .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp), content = content)
}

@Composable
fun Field(label: String, value: String, enabled: Boolean = true, multi: Boolean = false,
    secret: Boolean = false, tag: String = "", placeholder: String = "",
    keyboard: KeyboardOptions = KeyboardOptions.Default,
    changed: (String) -> Unit) {
    var focused by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        BasicTextField(value = value, onValueChange = changed, enabled = enabled,
            modifier = Modifier.fillMaxWidth().testTag(tag).onFocusChanged { focused = it.isFocused },
            textStyle = MaterialTheme.typography.bodyLarge.copy(color =
                MaterialTheme.colorScheme.onSurface.copy(alpha = if (enabled) 1f else .45f)),
            keyboardOptions = keyboard,
            singleLine = !multi, minLines = if (multi) 3 else 1, maxLines = if (multi) 12 else 1,
            cursorBrush = SolidColor(DuduStyle.blue),
            decorationBox = { inner ->
                Box(Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .background(MaterialTheme.colorScheme.surface, RoundedCornerShape(13.dp))
                    .border(if (focused) 1.dp else .5.dp, if (focused) DuduStyle.blue else MaterialTheme.colorScheme.outlineVariant,
                        RoundedCornerShape(13.dp)).padding(horizontal = 14.dp, vertical = 13.dp)) {
                    if (value.isEmpty() && placeholder.isNotEmpty()) Text(placeholder,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyLarge)
                    inner()
                }
            },
        visualTransformation = if (secret) androidx.compose.ui.text.input.PasswordVisualTransformation()
            else androidx.compose.ui.text.input.VisualTransformation.None)
    }
}

@Composable
fun SearchField(value: String, placeholder: String, tag: String = "", autoFocus: Boolean = false,
    capsule: Boolean = false, changed: (String) -> Unit) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(autoFocus) { if (autoFocus) focus.requestFocus() }
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp)
        .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(if (capsule) 50.dp else 13.dp))
        .padding(start = 13.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Glyph(R.drawable.ic_search, size = 18, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(9.dp))
        BasicTextField(value, changed, Modifier.weight(1f).testTag(tag).focusRequester(focus), singleLine = true,
            textStyle = MaterialTheme.typography.bodyMedium.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(DuduStyle.blue),
            decorationBox = { inner ->
                if (value.isEmpty()) Text(placeholder, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium)
                inner()
            })
        if (value.isNotEmpty()) IconButton(onClick = { changed(""); focus.requestFocus() }, modifier = Modifier.size(40.dp)) {
            Glyph(R.drawable.ic_x, stringResource(R.string.close), 16,
                MaterialTheme.colorScheme.onSurfaceVariant)
        } else Spacer(Modifier.width(12.dp))
    }
}

@Composable
fun FilterTabs(selected: String, options: List<Pair<String, String>>, changed: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 18.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (id, title) ->
            Surface(onClick = { changed(id) }, shape = RoundedCornerShape(50),
                color = if (selected == id) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.surfaceContainer) {
                Text(title, Modifier.padding(horizontal = 14.dp, vertical = 8.dp), fontSize = 13.sp,
                    color = if (selected == id) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
fun Confirm(title: String, body: String? = null, actions: Actions, dismiss: () -> Unit,
    confirm: () -> Unit, destructive: Boolean = true) {
    DuduConfirmation(title, body, !actions.busy, dismiss, confirm, destructive = destructive,
        error = actions.error?.let { problemText(it) })
}

@Composable
fun DuduConfirmation(title: String, body: String?, enabled: Boolean, dismiss: () -> Unit,
    confirm: () -> Unit, destructive: Boolean = true, error: String? = null, tag: String = "") {
    Dialog(onDismissRequest = { if (enabled) dismiss() },
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnBackPress = enabled,
            dismissOnClickOutside = enabled)) {
        Surface(Modifier.padding(horizontal = 32.dp).widthIn(max = 360.dp).fillMaxWidth(),
            shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Column(Modifier.padding(20.dp)) {
                Text(title, Modifier.padding(horizontal = 8.dp, vertical = 4.dp), fontSize = 17.sp,
                    lineHeight = 23.sp, fontWeight = FontWeight.SemiBold)
                if (!body.isNullOrBlank()) Text(body, Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                    fontSize = 14.sp, lineHeight = 20.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                error?.let { Text(it, Modifier.padding(horizontal = 8.dp, vertical = 8.dp), fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.error) }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = dismiss, enabled = enabled, modifier = Modifier.weight(1f).heightIn(min = 46.dp),
                        shape = RoundedCornerShape(50), colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.onSurface.copy(alpha = .08f),
                            contentColor = MaterialTheme.colorScheme.onSurface)) { Text(stringResource(R.string.cancel)) }
                    Button(onClick = confirm, enabled = enabled,
                        modifier = Modifier.weight(1f).heightIn(min = 46.dp).testTag(tag),
                        shape = RoundedCornerShape(50), colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.onSurface.copy(alpha = .08f),
                            contentColor = if (destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)) {
                        Text(stringResource(if (destructive) R.string.delete else R.string.save))
                    }
                }
            }
        }
    }
}

@Composable
fun FeatureScreen(route: Route, state: UiState, model: DuduViewModel, openDrawer: (() -> Unit)? = null) {
    key(state.computerId, state.language, route) {
        when (route.name) {
            "sessions" -> SessionsScreen(state, model)
            "session-search" -> SessionSearchScreen(route, state, model)
            "session-new" -> NewSessionScreen(state, model, openDrawer ?: model::backRoute)
            "collector" -> CollectorScreen(model)
            "record" -> RecordScreen(route, model)
            "tasks" -> TasksScreen(model)
            "session-tasks" -> TasksScreen(model, sessionId = state.session?.id)
            "todos" -> AssistantTodos(state, model)
            "task" -> TaskScreen(route, state, model)
            "settings" -> SettingsScreen(route, model)
            "preferences" -> PreferencesScreen(state, model)
            "about" -> AboutScreen(model)
            "computer" -> ComputerScreen(route, state, model)
            "computers" -> ComputersScreen(state, model)
            "pair" -> PairingScreen(state, model, adding = true)
            "web" -> EmbeddedScreen(route, state, model)
            "scan" -> PairingScanner(model)
            "issue" -> IssueScreen(route, state, model)
            "subissues" -> SubIssuesScreen(route, state, model)
            "activity" -> ActivityScreen(route, state, model)
            "files" -> FilesScreen(route, state, model)
            "delivered-files" -> DeliveredFilesScreen(route, state, model)
            "tool", "changes", "diff", "performance" -> DetailScreen(route, state, model)
            else -> NavigationScreen(route, state, model)
        }
    }
}

fun DuduViewModel.navigateItem(item: JSONObject) {
    val open = item.optJSONObject("open") ?: return
    val web = open.optJSONObject("web")
    val title = item.optString("title")
    fun fallback() {
        if (web?.optString("page") == "dudu") navigate(Route("settings", title, web.nullableString("target") ?: "general"))
        else if (web != null) navigate(Route("web", title, web.nullableString("target"),
            json("page" to web.getString("page"), "sessionId" to state.value.session?.id)))
    }
    when (open.optString("native")) {
        "assistant" -> state.value.home?.rows?.find { it.id == "assistant" }?.let(::open)
            ?: openSession(null, title, assistant = true)
        "board" -> navigate(null)
        "chat" -> navigate(Route("sessions", title))
        "collector" -> navigate(Route("collector", title))
        "dudu-settings" -> navigate(Route("settings", title, open.optString("target", "general")))
        "dsh-settings" -> navigate(Route("navigation", title, "settings"))
        "schedule" -> if (item.optString("id") == "dudu.tasks" || open.optString("target") == "dudu-tasks")
            navigate(Route("tasks", title)) else fallback()
        "files" -> navigate(Route("files", title))
        else -> fallback()
    }
}
