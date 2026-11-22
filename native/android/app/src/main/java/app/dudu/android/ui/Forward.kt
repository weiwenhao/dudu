@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.compose.foundation.clickable
import kotlinx.coroutines.launch
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.clip
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.data.*
import org.json.JSONArray
import org.json.JSONObject

/**
 * 转发: where a collected record, or the chosen records, can go (owner, 2026-11-18, the inbox redesign; the drawings are `.local/designs/inbox-forward-android-2026-11-18/`): the conversations of the
 * open issues that have a session, the one touched last first, in one white card (a 48 dp tile in the colour of the title, "REF title", the Agent's logo); the box finds one by its number or its words.
 * One conversation only (owner: "我们的转发不需要多选"). A tap asks once more, in the iPhone's card over the list (`ForwardPickerSheet.confirmation`: 转发给, the conversation, what goes on grey, 取消 and
 * a black 转发); 转发 sends the records as a message to the conversation, says 已转发到 {ref} and closes the sheet, 取消 or a tap beside the card puts it away, and a failure stays in the card as
 * 更改没能保存. The list says 没有事项 when no issue has a conversation, 没有找到事项 when the words find none, and 事项没能加载 when it could not be read.
 */
@Composable
fun ForwardPicker(model: DuduViewModel, records: List<JSONObject>, dismiss: () -> Unit, forwarded: () -> Unit) {
    val scope = rememberCoroutineScope()
    var issues by remember { mutableStateOf<List<JSONObject>?>(null) }
    var failed by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf<JSONObject?>(null) }
    var sending by remember { mutableStateOf(false) }
    var sendFailed by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        try { issues = model.request("issue.pick", json("withSession" to true)).rows("items").distinctBy { it.getLong("id") } }
        catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            DuduLog.failure("issue.pick.fail", error)
            failed = true
        }
    }
    val all = issues
    val words = query.trim()
    val shown = all.orEmpty().filter { it.optString("title").contains(words, true) || it.nullableString("ref").orEmpty().contains(words, true) }
    fun send(issue: JSONObject) {
        if (sending) return
        sending = true; sendFailed = false
        val ref = issue.nullableString("ref") ?: "#${issue.optLong("id")}"
        scope.launch {
            try {
                model.request("inbox.share", json("ids" to JSONArray(records.map { it.getLong("id") }),
                    "issue" to issue.getLong("id"), "to" to "session"))
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                DuduLog.failure("inbox.share.fail", error)
                sending = false; sendFailed = true
                return@launch
            }
            sending = false
            model.toast(word("已转发到 {0}"), ToastKind.Success, args = listOf(ref))
            chosen = null
            forwarded()
            dismiss()
        }
    }
    DuduSheet(dismiss, canDismiss = !sending) {
        Box(Modifier.fillMaxWidth().height(760.dp)) {
            Page(w("转发"), dismiss) {
                Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 2.dp)) {
                    SearchField(query, w("搜索"), tag = "forward-search", prominent = true) { query = it }
                }
                LazyColumn(Modifier.fillMaxSize().testTag("forward-list"), contentPadding = PaddingValues(bottom = 24.dp)) {
                    if (shown.isEmpty()) item {
                        Box(Modifier.fillMaxWidth().heightIn(min = 160.dp), contentAlignment = Alignment.Center) {
                            when {
                                all != null -> Text(if (all.isEmpty()) w("没有事项") else w("没有找到事项"), fontSize = 15.sp,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                failed -> ListFailure(w("事项没能加载"))
                                else -> ListLoading()
                            }
                        }
                    }
                    if (shown.isNotEmpty()) item { Section(w("最近会话")) }
                    itemsIndexed(shown, key = { _, issue -> issue.getLong("id") }) { index, issue ->
                        GroupRow(index == 0, index == shown.lastIndex, inset = 16, dividerStart = 74, dividerEnd = 14) {
                            ForwardRow(issue) { sendFailed = false; chosen = issue }
                        }
                    }
                }
            }
            chosen?.let { issue ->
                BackHandler { if (!sending) chosen = null }
                Box(Modifier.matchParentSize().background(Color.Black.copy(alpha = .32f))
                    .clickable(interactionSource = null, indication = null) { if (!sending) chosen = null },
                    contentAlignment = Alignment.Center) {
                    ForwardConfirmation(issue, records, sending, sendFailed, cancel = { chosen = null }) { send(issue) }
                }
            }
        }
    }
}

/**
 * The card that asks once more, the iPhone's: 321 dp wide, white with 28 dp corners and a soft shadow, 24 dp inside; 转发给 (13 sp, muted), the conversation (a 40 dp tile and "REF title" in 16 sp
 * medium) 6 dp under it, what goes 18 dp lower on grey, 更改没能保存 in red after a failure, and the two 46 dp buttons: 取消 on the light capsule and 转发 in white on black, a spinner while it goes.
 */
@Composable
private fun ForwardConfirmation(issue: JSONObject, records: List<JSONObject>, sending: Boolean, failed: Boolean, cancel: () -> Unit, forward: () -> Unit) {
    val shape = RoundedCornerShape(28.dp)
    val ink = MaterialTheme.colorScheme.onSurface
    Column(Modifier.width(321.dp).shadow(14.dp, shape, ambientColor = Color.Black.copy(alpha = .13f), spotColor = Color.Black.copy(alpha = .13f))
        .background(MaterialTheme.colorScheme.surface, shape).clickable(interactionSource = null, indication = null) {}
        .padding(24.dp).testTag("forward-card")) {
        Text(w("转发给"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            TitleTile(issue.optString("title"), 40)
            Text(conversationName(issue), fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        ForwardPreview(records, Modifier.padding(top = 18.dp))
        if (failed) Text(w("更改没能保存"), Modifier.padding(top = 12.dp).testTag("forward-failed"), fontSize = 13.sp, color = Color(0xFFEC1313))
        Row(Modifier.padding(top = if (failed) 14.dp else 30.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.weight(1f).height(46.dp).duduGlass(CircleShape, glass()).clip(CircleShape)
                .clickable(enabled = !sending, role = Role.Button, onClick = cancel).testTag("forward-cancel"), contentAlignment = Alignment.Center) {
                Text(w("取消"), fontSize = 16.sp, fontWeight = FontWeight.Medium, color = ink.copy(alpha = if (sending) .38f else 1f))
            }
            Box(Modifier.weight(1f).height(46.dp).background(ink, CircleShape).clip(CircleShape)
                .clickable(enabled = !sending, role = Role.Button, onClick = forward).testTag("forward-confirm"), contentAlignment = Alignment.Center) {
                if (sending) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.surface)
                else Text(w("转发"), fontSize = 16.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.surface)
            }
        }
    }
}

/** A conversation as the home list draws it: its tile, "REF title" in one line, the Agent's logo at the right. */
@Composable
private fun ForwardRow(issue: JSONObject, choose: () -> Unit) {
    Row(Modifier.fillMaxWidth().height(66.dp).testTag("forward-${issue.getLong("id")}").clickable(onClick = choose)
        .padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        TitleTile(issue.optString("title"), 48)
        Spacer(Modifier.width(12.dp))
        Text(conversationName(issue), Modifier.weight(1f), fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.width(12.dp))
        AgentLogo(issue.nullableString("agent"), 16)
    }
}

private fun conversationName(issue: JSONObject) = listOfNotNull(issue.nullableString("ref"), issue.optString("title")).joinToString(" ")

/** "r221 · who · where": the number of a record, who it is from and which collector brought it (what the forward card's preview says under the title). */
private fun recordByLine(record: JSONObject) = listOfNotNull(record.nullableString("ref"), record.nullableString("from"),
    record.nullableString("connectorName")).joinToString(" · ")

/** What goes, as the list shows it, on grey (16 dp corners, 14 dp inside): the title of the record (15 sp medium, two lines), and its number, who and where (12 sp, muted); for several, the first one's title and how many are chosen. */
@Composable
private fun ForwardPreview(records: List<JSONObject>, modifier: Modifier = Modifier) {
    val first = records.firstOrNull()
    val grey = if (androidx.compose.foundation.isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHighest else DuduStyle.selected
    Column(modifier.fillMaxWidth().background(grey, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(first?.optString("title").orEmpty(), fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium,
            maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(if (records.size == 1 && first != null) recordByLine(first) else w("已选 {0} 条").replace("{0}", records.size.toString()),
            fontSize = 12.sp, lineHeight = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}
