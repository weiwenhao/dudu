package app.dudu.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

/** GoalBanner.swift: the goal mark, one-line summary and three icon-labelled menu actions. */
@Composable
internal fun GoalBanner(goal: JSONObject, busy: Boolean, enabled: Boolean,
    toggle: () -> Unit, edit: () -> Unit, clear: () -> Unit) {
    var expanded by remember(goal.optString("id")) { mutableStateOf(false) }
    var menu by remember(goal.optString("id")) { mutableStateOf(false) }
    val paused = goal.optString("phase") in listOf("paused", "blocked")
    val title = when (goal.optString("phase")) {
        "paused" -> w("已暂停的目标")
        "blocked" -> w("受阻的目标")
        else -> w("进行中的目标")
    }
    UpwardPanel(expanded, { expanded = false }, Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Surface(shape = RoundedCornerShape(16.dp), color = chatPanel(), border = BorderStroke(.5.dp, chatBorder())) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Row(Modifier.weight(1f).clickable(role = Role.Button) { expanded = !expanded }
                    .padding(start = 14.dp, top = 11.dp, bottom = 11.dp),
                    verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.height(22.dp), contentAlignment = Alignment.Center) {
                        Glyph(DuduGlyphs.goal, size = 16, tint = if (paused) chatTertiary() else chatSecondary())
                    }
                    Text(buildAnnotatedString {
                        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)) { append(title) }
                        withStyle(SpanStyle(color = chatTertiary())) { append("  "); append(goal.optString("objective")) }
                    }, fontSize = 14.sp, lineHeight = 22.sp, maxLines = if (expanded) 12 else 1, overflow = TextOverflow.Ellipsis)
                }
                Box {
                    IconButton(onClick = { menu = true }, enabled = enabled && !busy, modifier = Modifier.size(44.dp)) {
                        if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp, color = chatSecondary())
                        else Glyph(DuduGlyphs.options, w("目标操作"), 20, chatSecondary())
                    }
                    DropdownMenu(menu, { menu = false }) {
                        DropdownMenuItem(text = { Text(if (paused) w("恢复目标") else w("暂停目标")) },
                            leadingIcon = { Glyph(if (paused) MenuGlyphs.goalResume else MenuGlyphs.goalPause, size = 18) },
                            onClick = { menu = false; toggle() })
                        DropdownMenuItem(text = { Text(w("编辑目标")) }, leadingIcon = { Glyph(MenuGlyphs.goalEdit, size = 18) },
                            onClick = { menu = false; edit() })
                        DropdownMenuItem(text = { Text(w("清除目标"), color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { Glyph(DuduGlyphs.trash, size = 18, tint = MaterialTheme.colorScheme.error) },
                            onClick = { menu = false; clear() })
                    }
                }
            }
        }
    }
}
