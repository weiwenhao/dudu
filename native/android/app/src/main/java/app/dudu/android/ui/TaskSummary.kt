package app.dudu.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.TimeZone

/** `roomy` is the row of the 任务 sheet (owner, 2026-11-18, the inbox redesign): a 30 dp logo, the title in 16 sp, the status in 13 sp, the line under it across the whole row, 64 dp high. The other lists keep the compact row. */
@Composable
internal fun TaskSummary(task: JSONObject, conversationScoped: Boolean = false, busy: Boolean = false,
    horizontalPadding: Int = 16, roomy: Boolean = false, onToggle: ((Boolean) -> Unit)? = null,
    toggleEnabled: Boolean = true, pendingToggle: Boolean? = null) {
    val on = task.optString("status") == "active"
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val schedule = task.optJSONObject("schedule") ?: json()
    val locale = appLocale()
    val next = task.optLong("nextRunAt").takeIf { on && it > 0 }?.let {
        val format = android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMdHHmm")
        val stamp = SimpleDateFormat(format, locale).apply {
            timeZone = TimeZone.getTimeZone(schedule.optString("timezone", TimeZone.getDefault().id))
        }.format(Date(it))
        w("下次运行 {0}").replace("{0}", stamp)
    }
    val line = listOfNotNull(scheduleLine(schedule).takeIf(String::isNotBlank), next).joinToString(" · ")
    val failure = conversationScoped && task.optString("status") != "ended" && task.optJSONObject("lastRun")?.optString("status") == "failed"
    val failedWord = w("投递失败")
    val failureColor = MaterialTheme.colorScheme.error
    Row(Modifier.fillMaxWidth().height(if (roomy) 64.dp else 58.dp).padding(horizontal = horizontalPadding.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(if (roomy) 12.dp else 14.dp)) {
        Box(Modifier.size(if (roomy) 30.dp else 22.dp).alpha(if (on) 1f else .55f), contentAlignment = Alignment.Center) {
            if (conversationScoped) Glyph(DuduGlyphs.schedule, size = if (roomy) 24 else 20, tint = muted)
            else AgentLogo(task.nullableString("agent"), if (roomy) 30 else 22)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(if (roomy) 4.dp else 2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(task.optString("title"), Modifier.weight(1f), fontSize = if (roomy) 16.sp else 15.sp,
                    lineHeight = if (roomy) 21.sp else TextUnit.Unspecified, fontWeight = FontWeight.Medium,
                    color = if (on) MaterialTheme.colorScheme.onSurface else muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (busy) RunningMark(16) else if (onToggle == null) Text(taskStatus(task.optString("status")), fontSize = if (roomy) 13.sp else 12.sp,
                    color = if (on) Color(0xFF177A3C) else muted, maxLines = 1)
            }
            if (line.isNotEmpty() || failure) Text(buildAnnotatedString {
                append(line)
                if (failure) withStyle(SpanStyle(color = failureColor)) { append((if (line.isEmpty()) "" else " · ") + failedWord) }
            }, fontSize = 12.sp, lineHeight = if (roomy) 16.sp else TextUnit.Unspecified, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (onToggle != null) Switch(checked = pendingToggle ?: on, onCheckedChange = onToggle,
            enabled = toggleEnabled && !busy,
            modifier = Modifier.scale(0.8f).semantics { contentDescription = task.optString("title") })
    }
}
