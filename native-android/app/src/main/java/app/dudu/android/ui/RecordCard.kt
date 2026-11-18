package app.dudu.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject

/**
 * What a record says, in one white card (owner, 2026-11-18, the inbox redesign): a conversation as a talk when the plugin sent its messages one by one (`record.messages`; an older plugin
 * sends none), otherwise the text as it is; the source is the card's last row, 打开来源, when the record has a link a browser can open.
 */
@Composable
internal fun RecordCard(record: JSONObject, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val lines = talkLines(record.rows("messages"))
    val text = record.nullableString("text").orEmpty()
    val link = record.nullableString("url")?.let { runCatching { android.net.Uri.parse(it) }.getOrNull() }
        ?.takeIf { it.scheme?.lowercase() in listOf("http", "https") }
    val hasWords = lines.isNotEmpty() || text.isNotEmpty()
    if (!hasWords && link == null) return
    InsetCard(modifier) {
        if (lines.isNotEmpty()) SelectionContainer { RecordTalk(lines) }
        else if (text.isNotEmpty()) SelectionContainer {
            Text(text, Modifier.fillMaxWidth().padding(16.dp), fontSize = 16.sp, lineHeight = 24.sp)
        }
        if (link != null) {
            if (hasWords) HorizontalDivider(Modifier.padding(horizontal = 16.dp), thickness = .5.dp,
                color = MaterialTheme.colorScheme.outlineVariant)
            Row(Modifier.fillMaxWidth().height(53.dp)
                .clickable(role = Role.Button) { runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, link)) } }
                .padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(w("打开来源"), Modifier.weight(1f), fontSize = 16.sp)
                Glyph(R.drawable.ic_external_link, size = 18, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** A conversation's messages as a talk: the day between the days (`MM-DD`, on two hairlines), the sender's name (14 sp semibold) where it changes, each message in 16 sp with its time (12 sp, muted) at the right. */
@Composable
private fun RecordTalk(lines: List<TalkLine>) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 8.dp)) {
        lines.forEach { line ->
            if (line.startsDay) Row(Modifier.fillMaxWidth().height(30.dp), verticalAlignment = Alignment.CenterVertically) {
                HorizontalDivider(Modifier.weight(1f), thickness = .5.dp, color = MaterialTheme.colorScheme.outlineVariant)
                Text(line.day, Modifier.padding(horizontal = 10.dp), fontSize = 12.sp, color = muted)
                HorizontalDivider(Modifier.weight(1f), thickness = .5.dp, color = MaterialTheme.colorScheme.outlineVariant)
            }
            if (line.showsName) Box(Modifier.fillMaxWidth().height(24.dp), contentAlignment = Alignment.CenterStart) {
                Text(line.from.orEmpty(), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            }
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(line.text, Modifier.weight(1f).alignByBaseline(), fontSize = 16.sp, lineHeight = 22.sp)
                Text(line.time, Modifier.alignByBaseline(), fontSize = 12.sp, lineHeight = 22.sp, color = muted, maxLines = 1)
            }
        }
    }
}
