package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject

/**
 * One record: where it comes from as a 44 dp picture, its title (16 sp, two lines at most), who it is from and which collector (13 sp), and at the right when it came (or the issue it went to) in 12 sp
 * and its number in 11 sp under it; 66 dp at least (owner, 2026-11-18, the inbox redesign: `.local/designs/inbox-forward-android-2026-11-18/`). The circle that chooses the row is before the picture and
 * stays in its place on a row that cannot be chosen; a chosen row is marked by a grey rounded fill, 5 dp from the sides of the card. The information card of 嘟嘟's chat draws its rows with it too.
 * The search page's rows are these (owner, 2026-11-27): `highlight` is what was typed, whose words are coloured, and `snippet` the line of the record's text that matched, which stands in the place
 * of who it is from and which collector.
 */
@Composable
internal fun CollectorSummary(record: JSONObject, tab: String = "todo", selecting: Boolean = false,
    selected: Boolean = false, horizontalPadding: Int = 10, completing: Boolean = record.optBoolean("completing"),
    highlight: String = "", snippet: String? = null) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val issue = record.optJSONObject("issue")
    val first = if (tab == "done" && issue != null) issue.nullableString("ref") ?: "#${issue.optLong("id")}"
        else record.optLong("at").takeIf { it > 0 }?.let { relativeTime(it) }
    Box(Modifier.fillMaxWidth().padding(horizontal = 5.dp, vertical = 2.dp).background(
        if (selected) MaterialTheme.colorScheme.onSurface.copy(alpha = .09f) else Color.Transparent, RoundedCornerShape(12.dp))) {
        Row(Modifier.fillMaxWidth().heightIn(min = 62.dp).padding(horizontal = (horizontalPadding - 5).dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (selecting) Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
                if (tab != "done" || issue == null) Box(Modifier.size(22.dp)
                    .background(if (selected) DuduStyle.blue else Color.Transparent, CircleShape)
                    .border(1.5.dp, if (selected) DuduStyle.blue else Color(0xFFC4C4C4), CircleShape),
                    contentAlignment = Alignment.Center) {
                    if (selected) TickMark()
                }
            }
            Box(Modifier.size(44.dp)) {
                ConnectorAvatar(record.nullableString("connectorIcon"), record.optString("connectorName"), 44)
                // The unread mark is the board's own (`AvatarStatus`: same red, halo, size and anchor on a rounded-square tile), as the iPhone's row (owner, 2026-11-21).
                AvatarStatus(if (record.optBoolean("unread")) "unread" else "idle", 44, roundedSquare = true)
            }
            // The column at the right is held to the text's two ends: the time on the first line, the number on the last.
            Box(Modifier.weight(1f)) {
                Column(Modifier.padding(end = 46.dp, top = 10.dp, bottom = 10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(highlighted(record.optString("title"), highlight), fontSize = 16.sp, lineHeight = 21.sp, fontWeight = FontWeight.Medium,
                        maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(highlighted(snippet ?: listOfNotNull(record.nullableString("from"), record.nullableString("connectorName")).joinToString(" · "), highlight),
                        fontSize = 13.sp, lineHeight = 17.sp, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Row(Modifier.align(Alignment.TopEnd).padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    // Its context is being filled in (`InboxCompletions`), or a mark on it is on its way: a small spinner before the time, as on the desktop's row.
                    if (completing) RunningMark(14)
                    first?.let { Text(it, fontSize = 12.sp, lineHeight = 21.sp, color = muted, maxLines = 1) }
                }
                record.nullableString("ref")?.let { ref ->
                    Text(ref, Modifier.align(Alignment.BottomEnd).padding(bottom = 10.dp), fontSize = 11.sp, lineHeight = 17.sp,
                        color = muted, maxLines = 1)
                }
            }
        }
    }
}
