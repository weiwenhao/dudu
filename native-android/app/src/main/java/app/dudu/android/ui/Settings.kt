@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.delay
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import org.json.JSONObject

@Composable
private fun settingsBackground() = if (isSystemInDarkTheme()) MaterialTheme.colorScheme.background else DuduStyle.settings

@Composable
private fun SettingsField(title: String, value: String, enabled: Boolean, multiline: Boolean,
    secret: Boolean, tag: String, changed: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (title.isNotBlank()) Text(title, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        BasicTextField(value, changed, enabled = enabled,
            modifier = Modifier.fillMaxWidth().testTag(tag),
            textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(DuduStyle.blue),
            minLines = if (multiline) 3 else 1, maxLines = if (multiline) 12 else 1,
            singleLine = !multiline, visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None)
    }
}

@Composable
fun SettingsScreen(route: Route, model: DuduViewModel) {
    val actions = rememberActions()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var page by remember { mutableStateOf<JSONObject?>(null) }
    val values = remember { mutableStateMapOf<String, String>() }
    var confirmation by remember { mutableStateOf<JSONObject?>(null) }
    var addMenu by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<String?>(null) }
    var suggestedName by remember { mutableStateOf<String?>(null) }
    var previewedValue by remember { mutableStateOf<String?>(null) }
    var previewing by remember { mutableStateOf(false) }
    var environmentRows by remember { mutableStateOf<List<Int>>(emptyList()) }
    var revealedRow by remember { mutableStateOf<String?>(null) }
    val section = route.target ?: "general"
    val target = route.params.nullableString("target")
    fun params() = json("section" to section).apply { target?.let { put("target", it) } }
    fun receive(next: JSONObject) {
        page = next
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
    fun perform(act: JSONObject, value: String? = null) {
        actions.run {
            val body = params().put("name", act.getString("name")).put("args", act.optJSONObject("args") ?: json())
                .put("values", JSONObject(values.toMap()))
            value?.let { body.put("value", it) }
            val result = model.request("settings.act", body)
            confirmation = null
            notice = result.optJSONObject("toast")?.nullableString("message")
            if (result.optBoolean("back")) model.backRoute()
            else if (result.optJSONObject("page") != null) receive(result.getJSONObject("page"))
            else actions.refresh()
        }
    }
    fun activate(button: JSONObject) {
        revealedRow = null
        if (button.optJSONObject("confirm") != null) confirmation = button
        else button.optJSONObject("act")?.let { perform(it) }
    }
    LaunchedEffect(actions.revision) {
        actions.run { receive(model.request("settings.page", params()).getJSONObject("page")) }
    }
    LaunchedEffect(page?.optDouble("poll", 0.0), lifecycle) {
        val seconds = page?.optDouble("poll", 0.0) ?: 0.0
        if (seconds > 0) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                delay((seconds.coerceAtLeast(1.0) * 1000).toLong())
                if (!actions.busy) actions.refresh()
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
                val result = model.request("settings.act", params().put("name", act.getString("name"))
                    .put("args", act.optJSONObject("args") ?: json())
                    .put("values", json(preview.getString("key") to previewValue)))
                if (values[preview.getString("key")]?.trim() == previewValue) {
                    receive(result.getJSONObject("page")); previewedValue = previewValue; actions.error = null
                }
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                actions.error = "UPSTREAM_ERROR"
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
    fun go(row: JSONObject) {
        row.optJSONObject("to")?.let {
            model.navigate(Route("settings", row.optString("title"), it.optString("section", section),
                json("target" to it.nullableString("target"))))
        }
    }
    Page(page?.optString("title") ?: route.title, model::backRoute, actions,
        nested = true, background = settingsBackground(), top = {
        if (additions.isNotEmpty() || environment != null) Box {
            IconButton(onClick = {
                if (additions.isEmpty()) addEnvironment()
                else if (additions.size == 1 && environment == null) go(additions[0]) else addMenu = true
            }, enabled = !actions.busy && !previewing) {
                Glyph(R.drawable.ic_plus, w("添加"))
            }
            DropdownMenu(addMenu, { addMenu = false }) {
                additions.forEach { row -> DropdownMenuItem(text = { Text(row.getString("title")) },
                    onClick = { addMenu = false; go(row) }) }
                environment?.let { DropdownMenuItem(text = { Text(it.optString("title")) }, onClick = { addMenu = false; addEnvironment() }) }
            }
        }
        page?.optJSONObject("save")?.let { save ->
            TextButton(onClick = { activate(save) }, enabled = !actions.busy && !previewing &&
                (preview == null || !previewValue.isNullOrEmpty() && previewedValue == previewValue)) { Text(save.getString("title")) }
        }
    }) {
        LazyColumn(Modifier.fillMaxSize()) {
            notice?.let { item { Text(it, Modifier.padding(20.dp)) } }
            sections.forEachIndexed { partIndex, part ->
                if (partIndex > 0 && part.nullableString("header") == null) item { Spacer(Modifier.height(12.dp)) }
                part.nullableString("header")?.let { item { Section(it) } }
                cardItems(part.rows("rows").filter { it !in additions && (it.optString("kind") != "environment" || environmentRows.isNotEmpty()) }) { row ->
                    val id = row.optString("key")
                    val act = row.optJSONObject("act")
                    val title = row.optString("title")
                    val current = values[id] ?: row.optString("value", row.optString("selected"))
                    val swipeKey = row.optString("id", "$partIndex:$id:$title")
                    SwipeMenuRow(row.rows("swipe").map { button ->
                        RowSwipeAction(button.optString("title"), settingsActionIcon(button),
                            if (button.optString("role") == "destructive") Color(0xFFE14848) else Color(0xFF96989D)) {
                            activate(button)
                        }
                    }, enabled = !actions.busy, revealed = revealedRow == swipeKey,
                        onReveal = { revealedRow = if (it) swipeKey else null }) { closeSwipe ->
                    Column {
                        when (row.optString("kind")) {
                            "field" -> SettingsField(title, current, !actions.busy, row.optBoolean("multiline"),
                                row.optBoolean("secret"), "settings-$id") { values[id] = it }
                            "environment" -> {
                                Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    environmentRows.forEach { index -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Box(Modifier.weight(1f)) { Field(w("名称"), values["envName$index"].orEmpty(), !actions.busy) { values["envName$index"] = it } }
                                        Box(Modifier.weight(1f)) { Field(w("值"), values["envValue$index"].orEmpty(), !actions.busy, secret = true) { values["envValue$index"] = it } }
                                        IconButton(onClick = { environmentRows = environmentRows - index; values.remove("envName$index"); values.remove("envValue$index") }, enabled = !actions.busy) {
                                            Glyph(R.drawable.ic_trash2, w("删除"), 20, MaterialTheme.colorScheme.error)
                                        }
                                    } }
                                }
                            }
                            "switch" -> Line(title, row.nullableString("subtitle"), minHeight = 48, trailing = {
                                Switch(row.optBoolean("on"), enabled = !actions.busy, onCheckedChange = {
                                    act?.let { a -> perform(a, it.toString()) }
                                })
                            })
                            "choice" -> Box {
                                val options = row.rows("options")
                                Choice(title, options.find { it.optString("id") == current }?.optString("title") ?: current,
                                    options.map { it.optString("id") to it.optString("title") }, !actions.busy) { value ->
                                    if (id.isNotEmpty()) {
                                        values[id] = value
                                        if (id == "common" && value.isNotBlank()) values["frequency"] = value
                                    }
                                    else act?.let { perform(it, value) }
                                }
                            }
                            else -> Line(title, row.nullableString("subtitle"), minHeight = 48,
                                danger = row.optString("tone") == "bad",
                                leading = row.nullableString("color")?.let { hex -> ({
                                    Box(Modifier.size(12.dp).background(runCatching { Color(android.graphics.Color.parseColor(hex)) }
                                        .getOrDefault(MaterialTheme.colorScheme.onSurfaceVariant), CircleShape))
                                }) },
                                enabled = !actions.busy,
                                action = if (row.has("to")) ({ if (!closeSwipe()) go(row) })
                                    else row.optJSONObject("button")?.let { ({ if (!closeSwipe()) activate(it) }) },
                                trailing = {
                                    row.nullableString("detail")?.let { Text(it, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                                    row.optJSONObject("button")?.takeIf { it.optString("title") != title }?.let { button -> TextButton(onClick = { activate(button) }, enabled = !actions.busy) {
                                        Text(button.optString("title"), fontSize = 14.sp)
                                    } }
                                    val notification = row.optJSONObject("notification")
                                    if (notification != null) IconButton(onClick = {
                                        notification.optJSONObject("act")?.let { perform(it, (!notification.optBoolean("on")).toString()) }
                                    }, enabled = !actions.busy) {
                                        Glyph(if (notification.optBoolean("on")) R.drawable.ic_bell else R.drawable.ic_bell_off,
                                            notification.optString("title"), 19, MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    else if (row.has("to")) Glyph(R.drawable.ic_chevron_right, size = 16,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant)
                                })
                        }
                    }
                    }
                }
                part.nullableString("footer")?.let { item {
                    Text(it, Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } }
            }
        }
    }
    confirmation?.let { button ->
        val dialog = button.getJSONObject("confirm")
        Confirm(dialog.optString("title"), dialog.nullableString("message"), actions,
            dismiss = { confirmation = null }, confirm = { perform(button.getJSONObject("act")) },
            destructive = button.optString("role") == "destructive")
    }
}

private fun settingsActionIcon(button: JSONObject): Int {
    val act = button.optJSONObject("act")
    return when (act?.optString("name")) {
        "remove", "forget" -> R.drawable.ic_trash2
        "default" -> R.drawable.ic_star
        "move" -> if ((act.optJSONObject("args")?.optInt("direction") ?: 1) < 0) R.drawable.ic_arrow_up else R.drawable.ic_arrow_down
        "verb" -> when (act.optJSONObject("args")?.optString("verb")) {
            "authorize" -> R.drawable.ic_key_round
            "retry" -> R.drawable.ic_refresh_cw
            "cancel" -> R.drawable.ic_x
            else -> R.drawable.ic_ellipsis
        }
        else -> if (button.optString("role") == "destructive") R.drawable.ic_trash2 else R.drawable.ic_ellipsis
    }
}

@Composable
fun PreferencesScreen(state: UiState, model: DuduViewModel) {
    val context = LocalContext.current
    val entries = state.navigation.rows("settings").filter {
        it.optString("group") == "dudu" || it.optJSONObject("open")?.optString("native") in listOf("dudu-settings", "dsh-settings")
    }
    Page(w("设置"), model::backRoute, background = settingsBackground()) {
        LazyColumn(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(20.dp),
            contentPadding = PaddingValues(horizontal = 18.dp, vertical = 12.dp)) {
            item { InsetCard {
                Surface(onClick = { model.navigate(Route("computers")) }, color = MaterialTheme.colorScheme.surface) {
                    Row(Modifier.fillMaxWidth().heightIn(min = 68.dp).padding(horizontal = 14.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.width(28.dp), contentAlignment = Alignment.Center) { Glyph(R.drawable.ic_monitor, size = 22) }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(state.computer.ifBlank { w("选择电脑") }, fontSize = 15.sp, fontWeight = FontWeight.Medium)
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Box(Modifier.size(6.dp).background(when {
                                    state.connecting -> Color(0xFFF2C94C)
                                    state.connected -> Color(0xFF4CB782)
                                    else -> MaterialTheme.colorScheme.onSurfaceVariant
                                }, CircleShape))
                                Text(if (state.connecting) w("正在连接…") else if (state.connected) w("已连接") else w("未连接"),
                                    fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Glyph(R.drawable.ic_chevron_right, size = 16, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } }
            item { InsetCard {
                entries.forEachIndexed { index, item ->
                    Line(if (item.optJSONObject("open")?.optString("native") == "dsh-settings") w("其他设置") else item.optString("title"),
                        leading = { if (item.has("icon")) NavigationGlyph(item.optJSONObject("icon"))
                            else Glyph(R.drawable.ic_settings, size = 21) }, action = { model.navigateItem(item) })
                    if (index < entries.lastIndex) HorizontalDivider(Modifier.padding(start = 48.dp), thickness = .5.dp)
                }
                if (entries.none { it.optJSONObject("open")?.optString("native") == "dudu-settings" }) {
                    Line(w("嘟嘟"), icon = R.drawable.ic_settings,
                        action = { model.navigate(Route("settings", target = "general")) })
                }
            } }
            item { Choice(w("语言"), when (state.language) {
                    "zh" -> "简体中文"; "en" -> "English"; else -> w("跟随系统")
                }, listOf("" to w("跟随系统"), "zh" to "简体中文", "en" to "English"), true) { model.language(it) }
            }
            item { InsetCard {
                Line(w("隐私政策"), icon = R.drawable.ic_lock, action = {
                    context.startActivity(Intent(Intent.ACTION_VIEW,
                        android.net.Uri.parse("https://github.com/weiwenhao/dudu/blob/main/docs/privacy.md")))
                })
                HorizontalDivider(Modifier.padding(start = 48.dp), thickness = .5.dp)
                Line(w("关于"), icon = R.drawable.ic_info, action = { model.navigate(Route("about")) })
            } }
            item {
                val info = context.packageManager.getPackageInfo(context.packageName, 0)
                Text("Dudu v${info.versionName}", Modifier.fillMaxWidth(),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center, fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
fun AboutScreen(model: DuduViewModel) {
    Page(w("关于"), model::backRoute, nested = true) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(top = 72.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
            androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(R.drawable.dudu), null, Modifier.size(76.dp))
            Text("Dudu", fontSize = 29.sp, fontWeight = FontWeight.Medium)
            Text(w("基于 DSH 的多 Agent 高效协作助手"), fontSize = 14.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

@Composable
fun NavigationScreen(route: Route, state: UiState, model: DuduViewModel) {
    Page(route.title, model::backRoute) {
        LazyColumn {
            cardItems(state.navigation.rows(route.target ?: "sidebar").filter {
                route.target != "settings" || (it.optString("group") != "dudu" &&
                    it.optJSONObject("open")?.optString("native") !in listOf("dudu-settings", "dsh-settings"))
            }) { item ->
                Line(item.optString("title"), action = { model.navigateItem(item) })
            }
        }
    }
}
