package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import app.dudu.android.data.rows
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.data.nullableString
import org.json.JSONObject

// What a phone that declared `settings.rich` is given in the settings pages (host/native-settings.mjs): the 状态 page as the owner drew it on 2026-11-21 (a strip for each category with its "+", a tile
// and the name for each status), the status form's tile, progress icons and colour dots, fields with their titles beside them, and the long-press menu of a row. The sizes are the iPhone's
// (`NativeSettingsView.swift`), in dp.

/** The "how far it is filled" of a status icon that the plugin sent, or nothing. */
private fun JSONObject.progress(): Float? = if (has("progress") && !isNull("progress")) optDouble("progress").toFloat() else null

/** A status icon in a soft tile of its own colour: the rows of the 状态 page (36) and the form's preview (64). */
@Composable
internal fun StatusTile(type: String, color: String?, progress: Float?, size: Int, icon: Int, radius: Int) {
    Box(Modifier.size(size.dp).background(statusInk(type, color).copy(alpha = .1f), RoundedCornerShape(radius.dp)),
        contentAlignment = Alignment.Center) { IssueStatusMark(type, color, progress, icon) }
}

/** A category's strip in the 状态 card, with its "+" at the right end. */
@Composable
internal fun GroupStrip(title: String, addTitle: String?, enabled: Boolean, add: () -> Unit) {
    Row(Modifier.padding(horizontal = 10.dp).fillMaxWidth().height(34.dp).clip(RoundedCornerShape(10.dp))
        .background(MaterialTheme.colorScheme.onSurface.copy(alpha = .06f)).padding(start = 14.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (addTitle != null) Box(Modifier.size(width = 40.dp, height = 34.dp).testTag("settings-add-$title")
            .clickable(enabled = enabled, role = Role.Button, onClick = add), contentAlignment = Alignment.Center) {
            Glyph(DuduGlyphs.plus, addTitle, 18, MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A status of the 状态 page: its icon in a tile, the name (and the word after it), the count under it. A tap opens it, a long press has the menu. */
@Composable
internal fun StatusRow(row: JSONObject, enabled: Boolean, onClick: () -> Unit, onLongClick: (() -> Unit)?) {
    val status = row.getJSONObject("status")
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Row(Modifier.fillMaxWidth().height(62.dp).testTag("settings-row-${row.optString("id")}").then(
        if (onLongClick == null) Modifier.clickable(enabled = enabled, onClick = onClick)
        else Modifier.combinedClickable(enabled = enabled, onClick = onClick, onLongClick = onLongClick))
        .padding(start = 20.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        StatusTile(status.optString("type"), status.nullableString("color"), status.progress(), 36, 18, 10)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(row.optString("title"), Modifier.weight(1f, fill = false), fontSize = 15.sp, fontWeight = FontWeight.Medium,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                row.nullableString("tag")?.let { Text(it, fontSize = 13.sp, color = muted, maxLines = 1) }
            }
            row.nullableString("subtitle")?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.5.sp, color = muted, maxLines = 1) }
        }
    }
}

/** The form's tile: the status's icon at 64, following the colour and progress chosen below it. */
@Composable
internal fun StatusPreview(row: JSONObject, color: String?, progress: String?) {
    val status = row.getJSONObject("status")
    Box(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 12.dp), contentAlignment = Alignment.Center) {
        StatusTile(status.optString("type"), color ?: status.nullableString("color"), progress?.toFloatOrNull() ?: status.progress(), 64, 32, 18)
    }
}

/** The colours of a status as dots in a row, the chosen one ringed (not a menu of hex words). */
@Composable
internal fun SwatchChoice(options: List<JSONObject>, selected: String, enabled: Boolean, choose: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().height(72.dp).padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        options.forEach { option ->
            val id = option.optString("id")
            val chosen = id == selected
            Box(Modifier.weight(1f).heightIn(min = 44.dp).semantics { this.selected = chosen; contentDescription = option.optString("title") }
                .clickable(enabled = enabled, role = Role.RadioButton) { choose(id) }, contentAlignment = Alignment.Center) {
                Box(Modifier.size(26.dp).background(issueColor(option.optString("color")), CircleShape))
                if (chosen) Box(Modifier.size(34.dp).border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape))
            }
        }
    }
}

/** How far a started status is filled: five icons in a row in the colour chosen, the chosen one on a soft block. */
@Composable
internal fun StatusIconChoice(options: List<JSONObject>, selected: String, color: String?, enabled: Boolean, choose: (String) -> Unit) {
    val ink = MaterialTheme.colorScheme.onSurface
    Row(Modifier.fillMaxWidth().height(76.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        options.forEach { option ->
            val status = option.optJSONObject("status") ?: return@forEach
            val id = option.optString("id")
            val chosen = id == selected
            val block = RoundedCornerShape(12.dp)
            Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                Box(Modifier.size(width = 60.dp, height = 48.dp).clip(block)
                    .then(if (chosen) Modifier.background(ink.copy(alpha = .08f)).border(.8.dp, ink.copy(alpha = .16f), block) else Modifier)
                    .semantics { this.selected = chosen; contentDescription = option.optString("title") }
                    .clickable(enabled = enabled, role = Role.RadioButton) { choose(id) }, contentAlignment = Alignment.Center) {
                    IssueStatusMark(status.optString("type"), color ?: status.nullableString("color"), status.progress(), 24)
                }
            }
        }
    }
}

/** A field with its title beside it (the 状态 form: 名称 and 描述). */
@Composable
internal fun InlineField(title: String, value: String, placeholder: String, multiline: Boolean, enabled: Boolean, tag: String,
    changed: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 18.dp, vertical = 16.dp), verticalAlignment = Alignment.Top) {
        Text(title, Modifier.width(74.dp), fontSize = 15.sp, lineHeight = 21.sp)
        Box(Modifier.weight(1f)) {
            if (value.isEmpty()) Text(placeholder, fontSize = 15.sp, lineHeight = 21.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            BasicTextField(value, changed, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag(tag),
                textStyle = MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp, lineHeight = 21.sp, color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(DuduStyle.blue), minLines = 1, maxLines = if (multiline) 4 else 1, singleLine = !multiline)
        }
    }
}

/** The glyph the plugin names for a menu item (the desktop's own Lucide icons). */
internal fun settingsMenuGlyph(name: String?): Int? = when (name) {
    "pencil" -> DuduGlyphs.rename
    "check" -> DuduGlyphs.check
    "arrow-up" -> DuduGlyphs.moveUp
    "arrow-down" -> DuduGlyphs.moveDown
    "trash" -> DuduGlyphs.trash
    "x" -> DuduGlyphs.close
    "unplug" -> DuduGlyphs.unplug
    "key-round" -> DuduGlyphs.keyRound
    "rotate-cw" -> DuduGlyphs.reconnect
    else -> null
}

/** What a long press on a row offers: a destructive item in red (its icon too), one that cannot be done now grey, as the desktop's menu. */
@Composable
internal fun SettingsRowMenu(expanded: Boolean, dismiss: () -> Unit, menu: List<JSONObject>, offset: DpOffset = DpOffset.Zero, choose: (JSONObject) -> Unit) {
    DropdownMenu(expanded, dismiss, offset = offset) {
        menu.forEach { item ->
            val tint = if (item.optString("role") == "destructive") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
            val glyph = settingsMenuGlyph(item.nullableString("glyph"))
            DropdownMenuItem(text = { Text(item.optString("title"), color = tint) },
                leadingIcon = glyph?.let { resource -> { Glyph(resource, size = 18, tint = tint) } },
                enabled = item.optBoolean("enabled", true), onClick = { dismiss(); choose(item) })
        }
    }
}

/** A colour the plugin names as `#rrggbb` (the iPhone's `Color(settingsHex:)`), or nothing for anything else. */
internal fun settingsHex(text: String?): Color? {
    val digits = text?.removePrefix("#") ?: return null
    if (digits.length != 6) return null
    return digits.toLongOrNull(16)?.let { Color(0xFF000000 or it) }
}

/** The colour of a row's words by its `tone` (the iPhone's `toneColor`): red for bad, amber for warn, the muted ink otherwise. */
@Composable
private fun toneColor(tone: String?): Color = when (tone) {
    "bad" -> SwipeColors.delete
    "warn" -> Color(0xFFF59E0B)
    else -> MaterialTheme.colorScheme.onSurfaceVariant
}

/** The chevron that ends a settings row which opens a page (the iPhone's `chevron.right`, muted at 70 %). */
@Composable
internal fun SettingsRowChevron() = Glyph(DuduGlyphs.right, size = 16, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .7f))

/**
 * A plain row of a settings page (the iPhone's `plainRowLabel`): a connector's 28 dp avatar, a colour dot, the title (15 sp, 14 sp monospace for a path or a command; red when bad, muted
 * when muted), its subtitle (13 sp, three lines), the detail on the right in the tone's colour, the row's button as a grey capsule, a chevron when it opens a page. A collector's row
 * has its bell between the words and the chevron (`bell`).
 */
@Composable
internal fun SettingsRowLabel(row: JSONObject, enabled: Boolean, bell: (@Composable () -> Unit)? = null, onLongClick: (() -> Unit)? = null,
    action: (() -> Unit)? = null, capsule: (() -> Unit)? = null) {
    val title = row.optString("title")
    val mono = row.optBoolean("mono")
    val tone = row.nullableString("tone")
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("settings-row-${row.optString("id")}").then(
        if (action == null && onLongClick == null) Modifier
        else if (onLongClick == null) Modifier.clickable(enabled = enabled, onClick = action ?: {})
        else Modifier.combinedClickable(enabled = enabled, onClick = action ?: {}, onLongClick = onLongClick))
        .padding(start = 16.dp, end = if (bell != null) 0.dp else 16.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Row(Modifier.weight(1f).padding(vertical = 12.dp).then(if (bell != null) Modifier.padding(end = 4.dp) else Modifier),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            row.nullableString("icon")?.let { ConnectorAvatar(it, title, 28) }
            settingsHex(row.nullableString("color"))?.let { Box(Modifier.size(12.dp).background(it, CircleShape)) }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, fontSize = if (mono) 14.sp else 15.sp, lineHeight = 20.sp, fontFamily = if (mono) FontFamily.Monospace else null,
                    color = when (tone) { "bad" -> SwipeColors.delete; "muted" -> MaterialTheme.colorScheme.onSurfaceVariant; else -> MaterialTheme.colorScheme.onSurface })
                row.nullableString("subtitle")?.takeIf { it.isNotBlank() }?.let {
                    Text(it, fontSize = 13.sp, lineHeight = 18.sp, maxLines = 3, overflow = TextOverflow.Ellipsis,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            row.nullableString("detail")?.let {
                Text(it, Modifier.widthIn(max = 160.dp), fontSize = 13.sp, lineHeight = 18.sp, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    textAlign = androidx.compose.ui.text.style.TextAlign.End, color = toneColor(tone))
            }
            val button = row.optJSONObject("button")
            if (button != null && capsule != null) RowCapsule(button.optString("title"), button.optString("role") == "destructive", enabled, capsule)
            if (row.has("to") && bell == null) SettingsRowChevron()
        }
        if (bell != null) {
            bell()
            Box(Modifier.padding(start = 4.dp, end = 16.dp)) { SettingsRowChevron() }
        }
    }
}

/** The button of a row (连接, 授权 …): a grey capsule 32 dp high, its 14 sp medium word in ink, red when it deletes (the iPhone's `capsule`). */
@Composable
internal fun RowCapsule(title: String, destructive: Boolean, enabled: Boolean, action: () -> Unit) {
    Surface(onClick = action, enabled = enabled, shape = CircleShape, color = DuduStyle.selected,
        modifier = Modifier.height(32.dp).alpha(if (enabled) 1f else .5f)) {
        Box(Modifier.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
            Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1,
                color = if (destructive) SwipeColors.delete else MaterialTheme.colorScheme.onSurface)
        }
    }
}

/** A collector's bell (the iPhone's `notificationButton`): in ink on a grey 32 dp square when its messages notify, muted and bare when they do not; a 44 dp place to touch. */
@Composable
internal fun NotificationBell(on: Boolean, title: String, enabled: Boolean, toggle: () -> Unit) {
    Box(Modifier.size(44.dp).semantics { selected = on }.clickable(enabled = enabled, role = Role.Button, onClick = toggle),
        contentAlignment = Alignment.Center) {
        Box(Modifier.size(32.dp).background(if (on) DuduStyle.selected else Color.Transparent, RoundedCornerShape(8.dp)),
            contentAlignment = Alignment.Center) {
            Glyph(if (on) app.dudu.android.R.drawable.ic_bell else app.dudu.android.R.drawable.ic_bell_off, title, 18,
                if (on) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/** A row that does what it says (断开, 删除, 忘记): its 15 sp title, red when it deletes, the whole row the button (the iPhone's `actionRow`). */
@Composable
internal fun SettingsActionRow(row: JSONObject, enabled: Boolean, action: () -> Unit) {
    Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("settings-row-${row.optString("id")}")
        .clickable(enabled = enabled, role = Role.Button, onClick = action).padding(horizontal = 16.dp), contentAlignment = Alignment.CenterStart) {
        Text(row.optString("title"), fontSize = 15.sp,
            color = if (row.optString("tone") == "bad") SwipeColors.delete else MaterialTheme.colorScheme.onSurface)
    }
}

/** A switch with its title (the iPhone's `switchRow`): what it shows changes at once and stays until the save ends. */
@Composable
internal fun SettingsSwitchRow(title: String, on: Boolean, enabled: Boolean, tag: String, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(title, Modifier.weight(1f), fontSize = 15.sp)
        Switch(on, change, enabled = enabled)
    }
}

/** A field with its title over it (the iPhone's `stackedFieldRow`): 13 sp muted title, the value in 15 sp (14 sp monospace for a path or a command), hidden when secret. */
@Composable
internal fun StackedField(row: JSONObject, value: String, enabled: Boolean, tag: String, changed: (String) -> Unit) {
    val mono = row.optBoolean("mono")
    val multiline = row.optBoolean("multiline")
    val style = MaterialTheme.typography.bodyMedium.copy(fontSize = if (mono) 14.sp else 15.sp, lineHeight = 21.sp,
        fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default)
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        row.optString("title").takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        Box {
            if (value.isEmpty()) row.nullableString("placeholder")?.let { Text(it, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            BasicTextField(value, changed, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag(tag),
                textStyle = style.copy(color = MaterialTheme.colorScheme.onSurface), cursorBrush = SolidColor(DuduStyle.blue),
                minLines = if (multiline) 3 else 1, maxLines = if (multiline) 12 else 1, singleLine = !multiline,
                visualTransformation = if (row.optBoolean("secret")) PasswordVisualTransformation() else VisualTransformation.None)
        }
    }
}

/** The 环境变量 a custom connector is given (the iPhone's `environmentRow`): a 变量名 and a hidden 值 side by side in monospace, and a small ✕ that takes the pair away. */
@Composable
internal fun EnvironmentRows(rows: List<Int>, values: SnapshotStateMap<String, String>, enabled: Boolean, remove: (Int) -> Unit) {
    val style = MaterialTheme.typography.bodyMedium.copy(fontSize = 14.sp, fontFamily = FontFamily.Monospace)
    @Composable
    fun Input(key: String, placeholder: String, secret: Boolean, modifier: Modifier) {
        Box(modifier) {
            val value = values[key].orEmpty()
            if (value.isEmpty()) Text(placeholder, style = style, color = MaterialTheme.colorScheme.onSurfaceVariant)
            BasicTextField(value, { values[key] = it }, Modifier.fillMaxWidth().testTag("settings-$key"), enabled = enabled, singleLine = true,
                textStyle = style.copy(color = MaterialTheme.colorScheme.onSurface), cursorBrush = SolidColor(DuduStyle.blue),
                visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None)
        }
    }
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        rows.forEach { index ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Input("envName$index", w("变量名"), false, Modifier.weight(1f))
                Input("envValue$index", w("值"), true, Modifier.weight(1f))
                Box(Modifier.size(44.dp).clickable(enabled = enabled, role = Role.Button) { remove(index) }, contentAlignment = Alignment.Center) {
                    Glyph(DuduGlyphs.close, w("删除"), 16)
                }
            }
        }
    }
}

/**
 * A choice made from a menu (the iPhone's `menuChoiceRow`): the title in ink, the chosen option's colour dot and name on the right in the muted ink (a model with its source under it
 * when its name does not already start with it), the up-and-down chevrons. The menu marks the chosen option with a check, shows an option's colour, and lists models under their
 * source when there is more than one; permission presets carry DSH's names.
 */
@Composable
internal fun SettingsChoiceRow(row: JSONObject, selected: String, enabled: Boolean, choose: (String) -> Unit) {
    val id = row.optString("id")
    var expanded by remember { mutableStateOf(false) }
    val raw = row.rows("options")
    val options = raw.map { option ->
        val name = option.optString("title")
        Triple(option, option.optString("id"), if (id == "permission") permissionName(option.optString("id"), name) else name)
    }
    val shown = options.find { it.second == selected }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Box {
        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("settings-row-$id")
            .clickable(enabled = enabled && options.isNotEmpty(), role = Role.Button) { expanded = true }
            .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(row.optString("title"), Modifier.weight(1f), fontSize = 15.sp)
            settingsHex(shown?.first?.nullableString("color"))?.let { Box(Modifier.size(12.dp).background(it, CircleShape)) }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(shown?.third.orEmpty(), Modifier.widthIn(max = 200.dp), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = muted)
                // The group's name is left out when the model's own name already starts with it ("DeepSeek" under "DeepSeek Flash").
                val source = shown?.first?.nullableString("subtitle")
                if (id == "model" && source != null && !shown.third.lowercase().startsWith(source.lowercase()))
                    Text(source, fontSize = 13.sp, maxLines = 1, color = muted)
            }
            Glyph(DuduGlyphs.select, size = 14, tint = muted.copy(alpha = .7f))
        }
        DropdownMenu(expanded, { expanded = false }) {
            @Composable
            fun Option(option: Triple<JSONObject, String, String>) {
                val color = settingsHex(option.first.nullableString("color"))
                DropdownMenuItem(text = { Text(option.third) }, modifier = Modifier.testTag("settings-row-$id-option-${option.second}"),
                    leadingIcon = if (option.second == selected) ({ Glyph(DuduGlyphs.check, size = 18) })
                    else color?.let { { Box(Modifier.size(14.dp).background(it, CircleShape)) } },
                    onClick = { expanded = false; choose(option.second) })
            }
            val sources = options.mapNotNull { it.first.nullableString("subtitle") }.distinct()
            if (id == "model" && sources.size > 1) sources.forEachIndexed { index, source ->
                if (index > 0) HorizontalDivider(thickness = .5.dp, color = MaterialTheme.colorScheme.outlineVariant)
                Text(source, Modifier.padding(horizontal = 16.dp, vertical = 6.dp), fontSize = 12.sp, color = muted)
                options.filter { it.first.nullableString("subtitle") == source }.forEach { Option(it) }
            } else options.forEach { Option(it) }
        }
    }
}
