@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.compose.foundation.clickable
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
import androidx.compose.ui.platform.LocalContext
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
 * One conversation only (owner: "我们的转发不需要多选"). A tap asks once more, in the app's own card (转发给, the conversation, what goes); 转发 sends the records as a message to the conversation, says so
 * and closes the sheet, 取消 puts the card away, and a failure stays in the card.
 */
@Composable
fun ForwardPicker(model: DuduViewModel, records: List<JSONObject>, dismiss: () -> Unit, forwarded: () -> Unit) {
    val loading = rememberActions()
    val sending = rememberActions()
    var issues by remember { mutableStateOf<List<JSONObject>?>(null) }
    var query by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf<JSONObject?>(null) }
    val context = LocalContext.current
    val said = w("已转发到 {0}")
    LaunchedEffect(loading.revision) {
        loading.run { issues = model.request("issue.pick", json("withSession" to true)).rows("items").distinctBy { it.getLong("id") } }
    }
    val all = issues
    val words = query.trim()
    val shown = all.orEmpty().filter { it.optString("title").contains(words, true) || it.nullableString("ref").orEmpty().contains(words, true) }
    DuduSheet(dismiss, canDismiss = !sending.busy) {
        Box(Modifier.fillMaxWidth().height(760.dp)) {
            Page(w("转发"), dismiss, loading) {
                Box(Modifier.padding(start = 16.dp, end = 16.dp, top = 2.dp)) {
                    SearchField(query, w("搜索"), tag = "forward-search", prominent = true) { query = it }
                }
                LazyColumn(Modifier.fillMaxSize().testTag("forward-list"), contentPadding = PaddingValues(bottom = 24.dp)) {
                    // No issue has a conversation: say so. A search that finds nothing leaves the list empty, as the old picker did (the words of iOS's "没有找到事项" are not on Android).
                    if (all != null && all.isEmpty()) item {
                        Box(Modifier.fillMaxWidth().heightIn(min = 160.dp), contentAlignment = Alignment.Center) {
                            Text(w("没有事项"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (shown.isNotEmpty()) item { Section(w("最近会话")) }
                    itemsIndexed(shown, key = { _, issue -> issue.getLong("id") }) { index, issue ->
                        GroupRow(index == 0, index == shown.lastIndex, inset = 16, dividerStart = 74, dividerEnd = 14) {
                            ForwardRow(issue) { sending.error = null; chosen = issue }
                        }
                    }
                }
            }
        }
    }
    chosen?.let { issue ->
        val ref = issue.nullableString("ref") ?: "#${issue.optLong("id")}"
        DuduConfirmation(w("转发给"), null, !sending.busy, { chosen = null }, {
            sending.run {
                model.request("inbox.share", json("ids" to JSONArray(records.map { it.getLong("id") }),
                    "issue" to issue.getLong("id"), "to" to "session"))
                android.widget.Toast.makeText(context, said.replace("{0}", ref), android.widget.Toast.LENGTH_SHORT).show()
                chosen = null
                forwarded()
                dismiss()
            }
        }, destructive = false, error = sending.error?.let { problemText(it) }, tag = "forward-confirm",
            confirmLabel = w("转发")) { ForwardCard(issue, records) }
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

/** What the card says before the buttons: the conversation, and what goes as the list shows it (the title of the record and its number, who and where; for several, the first one's title and how many are chosen). */
@Composable
private fun ForwardCard(issue: JSONObject, records: List<JSONObject>) {
    val first = records.firstOrNull()
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 10.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        TitleTile(issue.optString("title"), 40)
        Text(conversationName(issue), Modifier.weight(1f, fill = false), fontSize = 16.sp, fontWeight = FontWeight.Medium,
            maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    val count = w("已选 {0} 条").replace("{0}", records.size.toString())
    Surface(Modifier.fillMaxWidth().padding(top = 14.dp), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(first?.optString("title").orEmpty(), fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(if (records.size == 1 && first != null) recordByLine(first) else count, fontSize = 12.sp, lineHeight = 16.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
    Spacer(Modifier.height(14.dp))
}
