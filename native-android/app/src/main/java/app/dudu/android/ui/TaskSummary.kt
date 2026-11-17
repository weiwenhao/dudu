package app.dudu.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.TimeZone

@Composable
internal fun TaskSummary(task: JSONObject, conversationScoped: Boolean = false, busy: Boolean = false,
    horizontalPadding: Int = 16) {
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
    Row(Modifier.fillMaxWidth().height(58.dp).padding(horizontal = horizontalPadding.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(22.dp).alpha(if (on) 1f else .55f), contentAlignment = Alignment.Center) {
            if (conversationScoped) Glyph(R.drawable.ic_clock, size = 20, tint = muted) else AgentLogo(task.nullableString("agent"), 22)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(task.optString("title"), Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.Medium,
                    color = if (on) MaterialTheme.colorScheme.onSurface else muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (busy) RunningMark(16) else Text(taskStatus(task.optString("status")), fontSize = 12.sp,
                    color = if (on) Color(0xFF177A3C) else muted, maxLines = 1)
            }
            if (line.isNotEmpty() || failure) Text(buildAnnotatedString {
                append(line)
                if (failure) withStyle(SpanStyle(color = failureColor)) { append((if (line.isEmpty()) "" else " · ") + failedWord) }
            }, fontSize = 12.sp, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}
