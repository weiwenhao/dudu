@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import org.json.JSONObject

/** The canvas of the settings' pages (the iPhone's grouped background); the theme's own in the dark. */
@Composable
internal fun settingsCanvas() = if (isSystemInDarkTheme()) MaterialTheme.colorScheme.background else DuduStyle.settings

/**
 * One of 嘟嘟's settings pages, laid out here from the computer's values (`SettingsPages`), the iPhone's `SettingsPageView`: white cards on the settings canvas, pulled down to read again,
 * read again every few seconds while the page asks to be (`poll`). What the plugin refuses is said in its own words: under the form for 保存, as a message at the top for anything else
 * (更改没能保存 when it said nothing); what it reports done is a message too. While something is saved, and while the computer is not connected, the rows wait and the page cannot be left.
 */
@Composable
fun SettingsScreen(route: Route, model: DuduViewModel) {
    val scope = rememberCoroutineScope()
    val notifications = model.collectorNotifications
    val notificationChoices by notifications.state.collectAsState()
    // Turning a bell on asks the phone to let the app notify, as the iPhone asks then; allowed, the background connection that shows them starts.
    val bellContext = androidx.compose.ui.platform.LocalContext.current
    val notificationPermission = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { granted ->
        DuduLog.record("notifications.permission", state = if (granted) "granted" else "denied")
        if (granted) model.syncBackgroundNotifications()
    }
    fun askToNotify() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU &&
            androidx.core.content.ContextCompat.checkSelfPermission(bellContext, android.Manifest.permission.POST_NOTIFICATIONS) !=
            android.content.pm.PackageManager.PERMISSION_GRANTED) notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val ui by model.state.collectAsState()
    // The page is laid out here from the values the computer sends (`SettingsPages`); `words` are its words in the screen's language.
    val words = rememberPageWords()
    var page by remember { mutableStateOf<JSONObject?>(null) }
    var failed by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }
    // What the plugin refused on the form, in its own words (the iPhone's `problem`).
    var problem by remember { mutableStateOf<String?>(null) }
    val values = remember { mutableStateMapOf<String, String>() }
    val switches = remember { mutableStateMapOf<String, Boolean>() }
    var confirmation by remember { mutableStateOf<JSONObject?>(null) }
    var addMenu by remember { mutableStateOf(false) }
    var suggestedName by remember { mutableStateOf<String?>(null) }
    var previewedValue by remember { mutableStateOf<String?>(null) }
    var previewing by remember { mutableStateOf(false) }
    var environmentRows by remember { mutableStateOf<List<Int>>(emptyList()) }
    var revealedRow by remember { mutableStateOf<String?>(null) }
    // The row whose long-press menu is open.
    var menuRow by remember { mutableStateOf<String?>(null) }
    var reads by remember { mutableIntStateOf(0) }
    val section = route.target ?: "general"
    val target = route.params.nullableString("target")
    val failedWords = w("更改没能保存")
    fun params() = json("section" to section).apply { target?.let { put("target", it) } }
    fun receive(next: JSONObject, notificationRevision: Long) {
        page = next
        failed = false
        if (section == "collectors") notifications.receive(notificationRevision)
        next.rows("sections").flatMap { it.rows("rows") }.forEach { row ->
            row.nullableString("key")?.let { key ->
                val value = row.optString("value", row.optString("selected"))
                if (key !in values || (key == "name" && next.has("preview") && (values[key].isNullOrEmpty() || values[key] == suggestedName))) values[key] = value
                if (key == "name" && next.has("preview")) suggestedName = value
            }
        }
        if (next.has("preview")) {
            val rows = next.rows("sections").flatMap { it.rows("rows") }
            if (rows.none { it.optString("key") == "token" }) values.remove("token")
            if (rows.none { it.optString("kind") == "environment" }) {
                environmentRows = emptyList()
                values.keys.filter { it.startsWith("envName") || it.startsWith("envValue") }.toList().forEach(values::remove)
            }
        }
    }
    /** Read the page. A page that was read keeps what it shows when a later read fails; only a page never read says 配置加载失败. */
    suspend fun load() {
        try {
            val notificationRevision = notifications.checkpoint()
            receive(model.settingsPage(section, target, words), notificationRevision)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            DuduLog.failure("settings.page.fail", error, state = section)
            if (page == null) failed = true
        }
    }
    fun perform(act: JSONObject, value: String? = null, form: Boolean = false) {
        if (busy) return
        busy = true; problem = null
        scope.launch {
            try {
                val notificationRevision = notifications.checkpoint()
                val name = act.getString("name")
                val body = params().put("name", name).put("args", act.optJSONObject("args") ?: json())
                if (form) body.put("values", JSONObject(values.toMap()))
                value?.let { body.put("value", it) }
                DuduLog.record("settings.act", state = section)
                // A first local MCP launch may spend the desktop's 60-second budget installing what it needs (the iPhone waits as long).
                val result = model.request("settings.act", body, timeoutSeconds = if (section == "connectors" && name == "add") 120 else 30)
                confirmation = null
                result.optJSONObject("toast")?.nullableString("message")?.let { model.toast(it, ToastKind.Success, literal = true) }
                if (result.optBoolean("back")) model.backRoute()
                else if (model.settingsPagesFromComputer() && result.optJSONObject("page") != null) receive(result.getJSONObject("page"), notificationRevision)
                else load()
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("settings.act.fail", error, state = section)
                confirmation = null
                val words = (error as? ApiFailure)?.words
                if (form) problem = words ?: failedWords
                else if (words != null) model.toast(words, ToastKind.Error, literal = true)
                else model.toast(word("更改没能保存"), ToastKind.Error)
            } finally { busy = false; switches.clear() }
        }
    }
    fun activate(button: JSONObject, form: Boolean = false) {
        revealedRow = null
        if (button.optJSONObject("confirm") != null) confirmation = button
        else button.optJSONObject("act")?.let { perform(it, form = form) }
    }
    // Read when the page opens and again once the computer is connected again; with no computer and nothing read, the page says it could not be read (a mark while one is being reached).
    LaunchedEffect(reads, ui.connected, ui.connectionInFlight) {
        if (ui.connected) load() else if (page == null && !ui.connectionInFlight) failed = true
    }
    LaunchedEffect(page?.optDouble("poll", 0.0), lifecycle, ui.connected) {
        val seconds = page?.optDouble("poll", 0.0) ?: 0.0
        if (seconds > 0 && ui.connected) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay((seconds.coerceAtLeast(1.0) * 1000).toLong())
                if (!busy) load()
            }
        }
    }
    val preview = page?.optJSONObject("preview")
    val previewValue = preview?.let { values[it.optString("key")].orEmpty().trim() }
    LaunchedEffect(previewValue) {
        previewedValue = null
        previewing = !previewValue.isNullOrEmpty()
        if (preview != null && !previewValue.isNullOrBlank()) {
            try {
                delay(400)
                val act = preview.getJSONObject("act")
                val notificationRevision = notifications.checkpoint()
                val result = model.request("settings.act", params().put("name", act.getString("name"))
                    .put("args", act.optJSONObject("args") ?: json())
                    .put("values", json(preview.getString("key") to previewValue)))
                if (values[preview.getString("key")]?.trim() == previewValue) {
                    // The computer says what it recognized and the page is laid out here again; a plugin that lays pages out itself sends the page.
                    val next = result.optJSONObject("recognized")?.let { SettingsPages.customConnector(it, words) } ?: result.getJSONObject("page")
                    receive(next, notificationRevision); previewedValue = previewValue; problem = null
                }
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("settings.preview.fail", error, state = section)
                problem = failedWords
            } finally { previewing = false }
        }
    }
    val sections = page?.rows("sections").orEmpty()
    val additions = sections.flatMap { it.rows("rows") }.filter {
        val value = it.optJSONObject("to")?.optString("target").orEmpty()
        value == "add" || value.startsWith("add:")
    }
    val environment = sections.flatMap { it.rows("rows") }.find { it.optString("kind") == "environment" }
    fun addEnvironment() {
        (0 until 40).firstOrNull { it !in environmentRows }?.let { environmentRows = environmentRows + it }
    }
    fun goTo(to: JSONObject, title: String) {
        model.navigate(Route("settings", title, to.optString("section", section), json("target" to to.nullableString("target"))))
    }
    fun go(row: JSONObject) { row.optJSONObject("to")?.let { goTo(it, row.optString("title")) } }
    // An item of a long press opens the row's own page, or acts (asking first when it says to), as the swipe did.
    fun chooseMenu(item: JSONObject, title: String) {
        val to = item.optJSONObject("to")
        if (to != null) goTo(to, title) else activate(item)
    }
    val enabled = !busy && ui.connected
    val save = page?.optJSONObject("save")
    val canSave = save != null && !busy && !previewing && ui.connected &&
        (preview == null || !previewValue.isNullOrEmpty() && previewedValue == previewValue)
    // Leaving while a change is being saved would lose what it answers (the iPhone hides the back button then).
    BackHandler(enabled = busy) {}
    Page(page?.optString("title") ?: w(route.title), { if (!busy) model.backRoute() }, nested = true, background = settingsCanvas(), top = {
        if (save != null) TextButton(onClick = { activate(save, form = true) }, enabled = canSave, modifier = Modifier.testTag("settings-save")) {
            if (busy || previewing) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp, color = MaterialTheme.colorScheme.onSurface)
            else Text(save.getString("title"), fontSize = 15.sp, fontWeight = FontWeight.Medium)
        } else if (busy) Box(Modifier.size(44.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (additions.isNotEmpty() || environment != null) Box {
            IconButton(onClick = {
                if (additions.isEmpty()) addEnvironment()
                else if (additions.size == 1 && environment == null) go(additions[0]) else addMenu = true
            }, enabled = !busy && !previewing && ui.connected && (additions.isNotEmpty() || environmentRows.size < 40),
                modifier = Modifier.testTag("settings-add")) {
                Glyph(DuduGlyphs.plus, if (additions.size == 1 && environment == null) additions[0].optString("title")
                    else if (additions.isEmpty()) environment?.optString("title") else w("添加"), 22)
            }
            DropdownMenu(addMenu, { addMenu = false }) {
                additions.forEach { row -> DropdownMenuItem(text = { Text(row.getString("title")) },
                    onClick = { addMenu = false; go(row) }) }
                environment?.let { DropdownMenuItem(text = { Text(it.optString("title")) }, onClick = { addMenu = false; addEnvironment() }) }
            }
        }
    }) {
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = {
            refreshing = true
            scope.launch { try { load() } finally { refreshing = false } }
        }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 10.dp, bottom = 40.dp)) {
            // The page is drawn from what the computer sends: until it has, a mark, not a blank sheet (owner, 2026-11-21: "为什么设置打开是白屏").
            if (page == null && !failed) item {
                Box(Modifier.fillMaxWidth().padding(top = 80.dp), contentAlignment = Alignment.TopCenter) { DeliveryLoadingMark(22) }
            }
            if (page == null && failed) item {
                Column(Modifier.fillMaxWidth().padding(top = 80.dp).testTag("settings-failed"), horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(w("配置加载失败"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    FilledTonalButton(onClick = { failed = false; reads++ }, shape = CircleShape,
                        colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                            contentColor = MaterialTheme.colorScheme.onSurface),
                        contentPadding = PaddingValues(horizontal = 20.dp), modifier = Modifier.heightIn(min = 44.dp)) {
                        Text(stringResource(R.string.retry), fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
            sections.forEachIndexed { partIndex, part ->
                // What 添加 opens is the bar's +, and the 环境变量 rows show only once one is added: a section left with nothing is not drawn (the iPhone's `contentSections`).
                val partRows = part.rows("rows").filter { it !in additions && (it.optString("kind") != "environment" || environmentRows.isNotEmpty()) }
                if (partRows.isEmpty()) return@forEachIndexed
                // The 状态 page is one card with a strip for each category; the form's tile stands on the canvas, not in a card (owner's drawing, 2026-11-21).
                val grouped = partRows.any { it.optString("kind") == "group" }
                val bare = partRows.size == 1 && partRows[0].optString("kind") == "statusPreview"
                val header = part.nullableString("header")
                item { if (header != null) SettingsSectionText(header, top = 18, bottom = 8) else Spacer(Modifier.height(if (bare) 4.dp else 10.dp)) }
                if (bare) item {
                    val row = partRows[0]
                    StatusPreview(row, row.nullableString("colorKey")?.let { values[it] }, row.nullableString("progressKey")?.let { values[it] })
                } else if (grouped) item {
                    InsetCard(Modifier.padding(horizontal = 18.dp)) {
                        Column(Modifier.padding(vertical = 10.dp)) {
                            partRows.forEachIndexed { index, row ->
                                if (row.optString("kind") == "group") {
                                    if (index > 0) Spacer(Modifier.height(8.dp))
                                    val add = row.optJSONObject("add")
                                    GroupStrip(row.optString("title"), add?.optString("title"), enabled) {
                                        add?.optJSONObject("to")?.let { goTo(it, row.optString("title")) }
                                    }
                                } else {
                                    val menu = row.rows("menu")
                                    val key = row.optString("id")
                                    val press = remember { PressPoint() }
                                    Box(Modifier.notePress(press)) {
                                        if (row.has("status")) StatusRow(row, enabled, onClick = { go(row) },
                                            onLongClick = if (menu.isEmpty()) null else ({ menuRow = key }))
                                        else SettingsRowLabel(row, enabled, action = { go(row) })
                                        if (menu.isNotEmpty()) SettingsRowMenu(menuRow == key, { menuRow = null }, menu, press.menuOffset()) { chooseMenu(it, row.optString("title")) }
                                    }
                                    if (partRows.getOrNull(index + 1)?.let { it.optString("kind") != "group" } == true)
                                        HorizontalDivider(Modifier.padding(start = 68.dp, end = 10.dp), thickness = .5.dp,
                                            color = MaterialTheme.colorScheme.outlineVariant)
                                }
                            }
                        }
                    }
                } else cardItems(partRows) { row ->
                    val id = row.optString("key")
                    val act = row.optJSONObject("act")
                    val title = row.optString("title")
                    val current = values[id] ?: row.optString("value", row.optString("selected"))
                    val swipeKey = row.optString("id", "$partIndex:$id:$title")
                    val menu = row.rows("menu")
                    SwipeMenuRow(row.rows("swipe").map { button ->
                        RowSwipeAction(button.optString("title"), settingsActionIcon(button),
                            if (button.optString("role") == "destructive") SwipeColors.delete else Color(0xFF96989D)) {
                            activate(button)
                        }
                    }, enabled = enabled, revealed = revealedRow == swipeKey,
                        onReveal = { revealedRow = if (it) swipeKey else null }) { closeSwipe ->
                    val press = remember { PressPoint() }
                    Box(Modifier.notePress(press)) { Column {
                        when (row.optString("kind")) {
                            "field" -> if (row.optBoolean("inline")) InlineField(title, current, row.optString("placeholder"), row.optBoolean("multiline"),
                                enabled, "settings-$id") { values[id] = it }
                            else StackedField(row, current, enabled, "settings-$id") { values[id] = it }
                            "environment" -> EnvironmentRows(environmentRows, values, enabled) { index ->
                                environmentRows = environmentRows - index; values.remove("envName$index"); values.remove("envValue$index")
                            }
                            "switch" -> SettingsSwitchRow(title, switches[swipeKey] ?: row.optBoolean("on"), enabled, "settings-row-$swipeKey") { next ->
                                switches[swipeKey] = next
                                act?.let { perform(it, next.toString()) }
                            }
                            "choice" -> if (row.optString("style") == "swatches") SwatchChoice(row.rows("options"), current, enabled) { values[id] = it }
                            else if (row.optString("style") == "icons") StatusIconChoice(row.rows("options"), current,
                                row.nullableString("colorKey")?.let { values[it] }, enabled) { values[id] = it }
                            else SettingsChoiceRow(row, current, enabled) { value ->
                                if (id.isNotEmpty()) {
                                    values[id] = value
                                    if (id == "common" && value.isNotBlank()) values["frequency"] = value
                                }
                                else act?.let { perform(it, value) }
                            }
                            "action" -> SettingsActionRow(row, enabled) { row.optJSONObject("button")?.let { if (!closeSwipe()) activate(it) } }
                            else -> {
                                val notification = row.optJSONObject("notification")
                                // The bell changes at once and saves on its own: it neither waits for the page nor locks it (owner, 2026-11-19).
                                val bell: (@Composable () -> Unit)? = if (notification == null) null else ({
                                    val saved = notification.optBoolean("on")
                                    val on = notificationChoices[swipeKey]?.on ?: saved
                                    NotificationBell(on, notification.optString("title"), enabled) {
                                        val act = notification.optJSONObject("act") ?: return@NotificationBell
                                        DuduLog.record("settings.act", state = section)
                                        if (!on) askToNotify()
                                        notifications.set(swipeKey, saved, !on,
                                            params().put("name", act.getString("name")).put("args", act.optJSONObject("args") ?: json())) {
                                            model.toast(word("更改没能保存"), ToastKind.Error)
                                        }
                                    }
                                })
                                SettingsRowLabel(row, enabled, bell = bell,
                                    onLongClick = if (menu.isEmpty()) null else ({ if (!closeSwipe()) menuRow = swipeKey }),
                                    action = if (row.has("to")) ({ if (!closeSwipe()) go(row) }) else null,
                                    capsule = row.optJSONObject("button")?.let { button -> { if (!closeSwipe()) activate(button) } })
                            }
                        }
                    }
                    if (menu.isNotEmpty()) SettingsRowMenu(menuRow == swipeKey, { menuRow = null }, menu, press.menuOffset()) { chooseMenu(it, title) }
                    }
                    }
                }
                part.nullableString("footer")?.let { item { SettingsSectionText(it, top = 8, bottom = 0) } }
            }
            problem?.let { item {
                Text(it, Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 16.dp).testTag("settings-problem"),
                    fontSize = 14.sp, color = SwipeColors.delete)
            } }
        }
        }
    }
    confirmation?.let { button ->
        val dialog = button.getJSONObject("confirm")
        DuduConfirmation(dialog.optString("title"), dialog.nullableString("message"), !busy,
            dismiss = { confirmation = null }, confirm = { perform(button.getJSONObject("act")) },
            destructive = button.optString("role") == "destructive", confirmLabel = dialog.nullableString("button"))
    }
}

/** A section's header or footer: 13 sp in the muted ink, 6 dp in from the cards' edge. */
@Composable
private fun SettingsSectionText(text: String, top: Int, bottom: Int) {
    Text(text, Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = top.dp, bottom = bottom.dp),
        fontSize = 13.sp, lineHeight = 18.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

private fun settingsActionIcon(button: JSONObject): Int {
    val act = button.optJSONObject("act")
    return when (act?.optString("name")) {
        "remove", "forget" -> DuduGlyphs.trash
        "default" -> R.drawable.ic_star
        "move" -> if ((act.optJSONObject("args")?.optInt("direction") ?: 1) < 0) DuduGlyphs.send else R.drawable.ic_arrow_down
        "verb" -> when (act.optJSONObject("args")?.optString("verb")) {
            "authorize" -> R.drawable.ic_key_round
            "retry" -> DuduGlyphs.completeContext
            "cancel" -> DuduGlyphs.close
            else -> DuduGlyphs.options
        }
        else -> if (button.optString("role") == "destructive") DuduGlyphs.trash else DuduGlyphs.options
    }
}

/** One row of 嘟嘟's settings list. The plug of 连接器 is the narrowest of the seven and is drawn a tenth larger (owner, 2026-11-21: 「小了一点」), as on the iPhone. */
private class DuduSettingsPage(val section: String, val title: String, val glyph: Int, val iconSize: Int = 22)

private val DuduSettingsPages = listOf(
    DuduSettingsPage("general", "常规", DuduGlyphs.settingsGeneral),
    DuduSettingsPage("statuses", "状态", DuduGlyphs.settingsStatuses),
    DuduSettingsPage("connectors", "连接器", DuduGlyphs.settingsConnectors, iconSize = 24),
    DuduSettingsPage("collectors", "收集器", DuduGlyphs.settingsCollectors),
    DuduSettingsPage("rules", "规则", DuduGlyphs.settingsRules),
    DuduSettingsPage("memory", "记忆", DuduGlyphs.settingsMemory),
    DuduSettingsPage("skills", "技能", DuduGlyphs.settingsSkills),
)

/** The hairline between the rows of a settings card, from the words on (56 dp), as the iPhone's `rowDivider`. */
@Composable
private fun SettingsDivider() = HorizontalDivider(Modifier.padding(start = 56.dp), thickness = 1.dp, color = MaterialTheme.colorScheme.outlineVariant)

@Composable
private fun SettingsChevron() = Glyph(DuduGlyphs.right, size = 16, tint = MaterialTheme.colorScheme.onSurfaceVariant)

/**
 * The bottom bar's 设置, the iPhone's `SettingsView`: the computer (its name, a dot and 已连接 / 正在连接 / 未连接), 嘟嘟's seven pages, 隐私政策 and 关于, and the version. Each opens a page
 * of its own over the tab, the bar hidden (owner, 2026-11-22).
 */
@Composable
fun PreferencesScreen(state: UiState, model: DuduViewModel) {
    val context = LocalContext.current
    Page(w("设置"), model::backRoute, background = settingsCanvas()) {
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(22.dp),
            contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 30.dp)) {
            item { InsetCard {
                Row(Modifier.fillMaxWidth().heightIn(min = 68.dp).testTag("settings-computers")
                    .clickable { DuduLog.record("computers.open"); model.navigate(Route("computers")) }
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) { Glyph(DuduGlyphs.computer, size = 22) }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(state.computer.ifBlank { w("选择电脑") }, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Box(Modifier.size(6.dp).background(when {
                                state.connected -> Color(0xFF33A866)
                                state.connectionInFlight -> DuduStyle.blue
                                else -> MaterialTheme.colorScheme.onSurfaceVariant
                            }, CircleShape))
                            Text(if (state.connected) w("已连接") else if (state.connectionInFlight) w("正在连接") else w("未连接"),
                                fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    SettingsChevron()
                }
            } }
            item { InsetCard {
                // 嘟嘟's own pages are a fixed list in the app (owner, 2026-11-21: 「这个列表应该是原生组件写死的…不需要从 API 加载」): the plugin supplies what is on a page, not which pages there
                // are, nor their names or icons, so an older plugin cannot bring back older icons. DSH's settings are the drawer gear's, not a row here.
                DuduSettingsPages.forEachIndexed { index, page ->
                    if (index > 0) SettingsDivider()
                    SettingsCardRow(page.glyph, w(page.title), glyphSize = page.iconSize, tag = "settings-${page.section}",
                        trailing = { SettingsChevron() }) { model.navigate(Route("settings", page.title, page.section)) }
                }
            } }
            item { InsetCard {
                // The privacy row ends with the external-link glyph and About with the chevron, both 16 as on the iPhone (owner, 2026-11-21: the privacy row's icon differed).
                SettingsCardRow(DuduGlyphs.privacy, w("隐私政策"), tag = "settings-privacy", trailing = {
                    Glyph(DuduGlyphs.openLink, size = 16, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }) {
                    DuduLog.record("settings.privacy.open")
                    context.startActivity(Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse("https://github.com/weiwenhao/dudu/blob/main/docs/privacy.md")))
                }
                SettingsDivider()
                SettingsCardRow(DuduGlyphs.info, w("关于"), tag = "settings-about", trailing = { SettingsChevron() }) {
                    model.navigate(Route("about"))
                }
            } }
            item {
                val info = context.packageManager.getPackageInfo(context.packageName, 0)
                // The release version and the build number, without the app's name (owner, 2026-11-21).
                @Suppress("DEPRECATION")
                val build = if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
                Text("v${info.versionName} ($build)", Modifier.fillMaxWidth(),
                    textAlign = TextAlign.Center, fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
fun AboutScreen(model: DuduViewModel) {
    Page(w("关于"), model::backRoute, nested = true, background = settingsCanvas()) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp).padding(top = 72.dp, bottom = 30.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
            androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.dudu), null, Modifier.size(76.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Dudu", fontSize = 29.sp, letterSpacing = (-0.7).sp, fontWeight = FontWeight.Medium)
                Text(w("基于 DSH 的多 Agent 高效协作助手"), fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
fun NavigationScreen(route: Route, state: UiState, model: DuduViewModel) {
    if (route.target == "settings") return DshSettingsScreen(state, model)
    Page(route.title, model::backRoute) {
        LazyColumn {
            cardItems(state.navigation.rows(route.target ?: "sidebar")) { item ->
                Line(item.optString("title"), action = { model.navigateItem(item) })
            }
        }
    }
}

/**
 * DSH 设置, what the drawer's gear opens (the iPhone's DSH-only `SettingsView`): DSH's own sections as the plugin lists them, each with DSH's icon (or one guessed from its name) and a
 * chevron, opening its page of DSH's settings. The list is read again when the page opens; until it has come, 加载设置…, and 重试 when the computer did not answer.
 */
@Composable
private fun DshSettingsScreen(state: UiState, model: DuduViewModel) {
    var reading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt, state.connected) {
        if (!state.connected) return@LaunchedEffect
        reading = true; failed = false
        failed = !model.refreshNavigation()
        reading = false
    }
    val rows = state.navigation.rows("settings").filter {
        it.optString("group") != "dudu" && it.optJSONObject("open")?.optString("native") !in listOf("dudu-settings", "dsh-settings")
    }
    Page(w("DSH 设置"), model::backRoute, background = settingsCanvas()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(start = 18.dp, end = 18.dp, top = 12.dp, bottom = 30.dp)) {
            if (rows.isNotEmpty() || reading || failed || !state.connected) InsetCard {
                rows.forEachIndexed { index, item ->
                    if (index > 0) SettingsDivider()
                    SettingsCardRow(dshCategoryGlyph(item), item.optString("title"), tag = "settings-dsh-${item.optString("id")}",
                        leading = item.optJSONObject("icon")?.let { icon -> { NavigationGlyph(icon, 22) } },
                        trailing = { SettingsChevron() }) {
                        DuduLog.record("settings.dsh.section")
                        model.navigateItem(item)
                    }
                }
                if (rows.isEmpty() && !failed) SettingsCardRow(DuduGlyphs.settings, w("加载设置…"), tag = "settings-dsh-loading",
                    titleColor = MaterialTheme.colorScheme.onSurfaceVariant, trailing = {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    })
                if (rows.isEmpty() && failed) SettingsCardRow(DuduGlyphs.reconnect, w("重试"), tag = "settings-dsh-retry",
                    trailing = { SettingsChevron() }) { attempt++ }
            }
        }
    }
}

/** A glyph for a section DSH sent no icon for, guessed from its id and name (the iPhone's `categoryGlyph`). */
private fun dshCategoryGlyph(item: JSONObject): Int {
    val key = "${item.optString("id")} ${item.optString("title")}".lowercase()
    fun has(vararg words: String) = words.any { key.contains(it) }
    return when {
        has("account", "user", "账号", "账户", "余额", "登录") -> DuduGlyphs.account
        has("model", "模型", "provider") -> DuduGlyphs.model
        has("plugin", "market", "插件", "市场") -> DuduGlyphs.plugins
        has("skill", "agent", "preset", "技能", "智能体", "预设") -> DuduGlyphs.skills
        has("schedule", "automation", "定时", "计划", "自动化") -> DuduGlyphs.schedule
        has("permission", "security", "权限", "安全") -> DuduGlyphs.permission
        has("tool", "terminal", "工具", "终端") -> DuduGlyphs.terminal
        else -> DuduGlyphs.settings
    }
}
