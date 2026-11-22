package app.dudu.android.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.DuduViewModel
import app.dudu.android.data.Message
import app.dudu.android.data.nullableString
import kotlinx.coroutines.delay

/**
 * The messages that wait for the agent's turn to end, above the composer, as the iPhone draws them (`QueuedMessagesPanel.swift`):
 * one rounded panel of 44 dp rows; one message is its row, several fold under a line with their number. A row has the message and
 * three actions: edit, delete and 插话发送 (the iPhone's glyphs: square-pen, trash, arrow-up). 插话发送 hands the message to the agent's
 * next step and is there only while the agent runs; the message then leaves this list and stands in the history as one on its way.
 */
@Composable
internal fun QueuedMessagesPanel(messages: List<Message>, sessionId: String, model: DuduViewModel,
    running: Boolean, enabled: Boolean, pending: Pair<String, String>?,
    edit: (Message) -> Unit, remove: (Message) -> Unit, steer: (Message) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    val dark = isSystemInDarkTheme()
    val secondary = if (dark) MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFF61666B)
    UpwardPanel(expanded && messages.size > 1, { expanded = false }, Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
    Surface(Modifier.fillMaxWidth().testTag("queue-panel"), shape = RoundedCornerShape(16.dp),
        color = if (dark) MaterialTheme.colorScheme.surfaceContainer else Color(0xFFF9FAFB),
        border = BorderStroke(.5.dp, if (dark) MaterialTheme.colorScheme.outlineVariant else Color.Black.copy(alpha = .04f))) {
        Column {
            if (messages.size > 1) Row(Modifier.fillMaxWidth().height(44.dp).clickable(role = Role.Button) { expanded = !expanded }
                .padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Glyph(DuduGlyphs.queue, size = 16, tint = secondary)
                Text(wp("%lld 条排队消息", messages.size), Modifier.weight(1f), fontSize = 14.sp, color = secondary)
                Glyph(if (expanded) DuduGlyphs.up else DuduGlyphs.down, size = 16, tint = secondary)
            }
            if (messages.size == 1) QueuedRow(messages[0], sessionId, model, single = true, running, enabled, pending, secondary, edit, remove, steer)
            else if (expanded) Column(Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState())) {
                messages.forEach { message -> key(message.id) {
                    QueuedRow(message, sessionId, model, single = false, running, enabled, pending, secondary, edit, remove, steer)
                } }
            }
        }
    }
    }
}

@Composable
private fun QueuedRow(message: Message, sessionId: String, model: DuduViewModel,
    single: Boolean, running: Boolean, enabled: Boolean, pending: Pair<String, String>?,
    secondary: Color, edit: (Message) -> Unit, remove: (Message) -> Unit, steer: (Message) -> Unit) {
    val editable = message.raw.optBoolean("editable")
    Row(Modifier.fillMaxWidth().height(44.dp).padding(start = 14.dp).alpha(if (enabled) 1f else .35f),
        verticalAlignment = Alignment.CenterVertically) {
        if (single) {
            Glyph(DuduGlyphs.queue, size = 16, tint = chatTertiary())
            Spacer(Modifier.width(8.dp))
        }
        val images = message.attachments.filter { it.optString("kind") == "image" }
        if (images.isNotEmpty()) {
            Row(Modifier.width(minOf(102, images.size * 34 - 4).dp).height(30.dp)
                .horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                images.forEach { image -> key(image.nullableString("id") ?: image.toString()) {
                    Attachment(sessionId, image, null, model, AttachmentImageStyle.Queue)
                } }
            }
            Spacer(Modifier.width(6.dp))
        }
        val files = message.attachments.filter { it.optString("kind") != "image" }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            if (message.text.isNotEmpty()) Text(message.text, fontSize = 14.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                color = MaterialTheme.colorScheme.onSurface)
            if (files.isNotEmpty()) Text(files.joinToString(" · ") { it.optString("name") },
                fontSize = 14.sp, lineHeight = 18.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = chatTertiary())
        }
        QueueAction(DuduGlyphs.compose, w("编辑排队消息"), 16, secondary, enabled && pending == null && editable,
            dim = !editable, waiting = false) { edit(message) }
        // A row this phone has sent and the computer has not listed yet has no item of the computer's to delete or hand over: it waits, dimmed, until the computer's own row replaces it.
        val optimistic = message.raw.optBoolean("optimistic")
        QueueAction(DuduGlyphs.trash, w("删除排队消息"), 16, secondary, enabled && pending == null && !optimistic,
            dim = optimistic, waiting = pending == message.id to "remove") { remove(message) }
        QueueAction(DuduGlyphs.send, w("插话发送"), 20, secondary, enabled && pending == null && running && !optimistic,
            dim = !running || optimistic, waiting = pending == message.id to "steer") { steer(message) }
    }
}

/** A 44 dp target. The press answers at once; a request that takes longer than 150 ms shows a small spinner in its place. */
@Composable
private fun QueueAction(icon: Int, label: String, size: Int, tint: Color, enabled: Boolean, dim: Boolean, waiting: Boolean,
    action: () -> Unit) {
    var spinning by remember { mutableStateOf(false) }
    LaunchedEffect(waiting) {
        spinning = false
        if (waiting) { delay(150); spinning = true }
    }
    Box(Modifier.size(44.dp).clickable(enabled = enabled, role = Role.Button, onClick = action), contentAlignment = Alignment.Center) {
        if (spinning) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 1.5.dp, color = tint)
        else Box(Modifier.alpha(if (dim) .35f else 1f)) { Glyph(icon, label, size, tint) }
    }
}
