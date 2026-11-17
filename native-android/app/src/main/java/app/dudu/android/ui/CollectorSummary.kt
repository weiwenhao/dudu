package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
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

@Composable
internal fun CollectorSummary(record: JSONObject, tab: String = "todo", selecting: Boolean = false,
    selected: Boolean = false, horizontalPadding: Int = 10) {
    Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).padding(horizontal = horizontalPadding.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        if (selecting) Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) {
            if (tab != "done" || record.optJSONObject("issue") == null) Box(Modifier.size(22.dp)
                .background(if (selected) DuduStyle.blue else Color.Transparent, CircleShape)
                .border(1.5.dp, if (selected) DuduStyle.blue else Color(0xFFC4C4C4), CircleShape),
                contentAlignment = Alignment.Center) {
                if (selected) Glyph(R.drawable.ic_check, size = 13, tint = Color.White)
            }
        }
        ConnectorAvatar(record.nullableString("connectorIcon"), record.optString("connectorName"))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(record.optString("title"), fontSize = 15.sp, fontWeight = FontWeight.Medium,
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(listOf(record.optString("ref"), record.optString("from"), record.optString("connectorName"))
                .filter(String::isNotBlank).joinToString(" · "), fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            if (record.optBoolean("completing")) RunningMark(14)
            val issue = record.optJSONObject("issue")
            if (tab == "done" && issue != null) Text(issue.nullableString("ref") ?: "#${issue.optLong("id")}", fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            else record.optLong("at").takeIf { it > 0 }?.let { Text(relativeTime(it), fontSize = 10.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
