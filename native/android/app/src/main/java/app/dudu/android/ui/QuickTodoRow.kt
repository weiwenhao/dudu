package app.dudu.android.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject

@Composable
internal fun QuickTodoIssueRow(issue: JSONObject, state: UiState, model: DuduViewModel, open: Boolean,
    toggle: () -> Unit, close: () -> Unit = {}, leave: ((() -> Unit) -> Unit)? = null, onLongClick: (() -> Unit)? = null) {
    val actions = rememberActions()
    val id = issue.getLong("id")
    val child = issue.nullableString("sessionId") ?: issue.nullableString("session")?.removePrefix("dsh:")
    val latest = issue.optJSONObject("latest")
    val canAnswer = child != null && latest != null
    var full by remember(id) { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(open, actions.revision) {
        if (open && canAnswer && full == null) actions.run {
            full = model.request("assistant.reply.read", json("sessionId" to state.session?.id, "id" to id, "session" to "dsh:$child"))
                .rows("messages").lastOrNull { it.optString("status") != "streaming" &&
                    (it.optString("text").isNotBlank() || it.rows("attachments").isNotEmpty()) }
        }
    }
    // 打开会话: from the quick sheet it leaves the sheet so that it comes back with 嘟嘟's chat (`leave`); from a card of the thread the card stays.
    fun openIssue() {
        val go = {
            if (child != null && issue.nullableString("agent") != null) model.openSession(child, issue.optString("title"), id)
            else model.navigate(Route("issue", issue.optString("title"), id.toString()))
        }
        if (leave != null) leave(go) else { close(); go() }
    }
    // A press and hold on a card of the thread opens the card's menu (`onLongClick`), over the row as well.
    fun Modifier.tap(action: () -> Unit) = if (onLongClick == null) clickable(onClick = action)
        else combinedClickable(onClick = action, onLongClick = onLongClick)
    // 回复 (the button, or a pull of the row to the right as on the iPhone): the sheet closes and the conversation puts the issue's @ into the box.
    fun reply() { model.reply(issue); close() }
    Box(Modifier.fillMaxWidth().padding(horizontal = 14.dp).clipToBounds()) {
    SwipeToReply(enabled = canAnswer, onReply = ::reply) {
    Column(Modifier.fillMaxWidth().padding(vertical = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth().heightIn(min = 28.dp).tap { if (canAnswer) toggle() else openIssue() },
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            AgentAvatar(issue.nullableString("agent"), issue.optString("sessionState", "idle"), 28)
            Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(issue.nullableString("ref") ?: "#$id", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                latest?.optLong("at")?.takeIf { it > 0 }?.let { Text(relativeTime(it), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text(issue.optString("title"), Modifier.weight(1f), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (canAnswer) Glyph(if (open) DuduGlyphs.up else DuduGlyphs.down, size = 14,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (latest != null) {
            val text = if (open) full?.optString("text") ?: latest.optString("text") else latest.optString("text")
            Box(if (open) Modifier else Modifier.heightIn(max = 48.dp).clipToBounds().tap(toggle)) {
                Markdown((if (latest.optString("who") == "me" && text.isNotEmpty()) w("你：") else "") + text,
                    compact = true, selectable = open)
            }
            if (open) {
                if (actions.busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 1.5.dp)
                actions.error?.let { TextButton(onClick = actions::refresh) { Text(w("重试")) } }
                full?.rows("attachments").orEmpty().forEach { attachment -> if (child != null)
                    Attachment(child, attachment, full?.optLong("seq"), model) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
                    TextButton(onClick = ::reply) {
                        Glyph(DuduGlyphs.reply, size = 15, tint = DuduStyle.blue); Spacer(Modifier.width(6.dp))
                        Text(w("回复"), fontSize = 13.sp, color = DuduStyle.blue)
                    }
                    Spacer(Modifier.width(20.dp))
                    TextButton(onClick = ::openIssue) {
                        Glyph(DuduGlyphs.openLink, size = 15, tint = MaterialTheme.colorScheme.onSurfaceVariant); Spacer(Modifier.width(6.dp))
                        Text(w("打开会话"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    }
    }
}

@Composable
internal fun relativeTime(at: Long): String {
    val seconds = ((System.currentTimeMillis() - at) / 1000).coerceAtLeast(0)
    return when {
        seconds < 60 -> w("刚刚")
        seconds < 3600 -> w("{0}分钟").replace("{0}", (seconds / 60).toString())
        seconds < 86400 -> w("{0}小时").replace("{0}", (seconds / 3600).toString())
        else -> receivedTime(at)
    }
}
