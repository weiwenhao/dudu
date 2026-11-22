package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.data.GroupChat
import app.dudu.android.data.nullableString
import org.json.JSONObject

enum class CompletionStatus { Loading, Ready, Failed }

/** A candidate of the box's list: an issue to write to (`assistant.recipients`) or a skill (`assistant.skills`); choosing one puts its token in the box, it never sends. */
internal sealed interface Completion {
    val id: String
    val token: String

    data class Issue(val recipient: JSONObject) : Completion {
        val address: String get() = recipient.nullableString("ref") ?: "#${recipient.optLong("id")}"
        override val id get() = "issue:${recipient.optLong("id")}"
        override val token get() = "@$address"
    }

    data class Skill(val skill: JSONObject) : Completion {
        override val id get() = "skill:${skill.optString("name")}"
        override val token get() = "/${skill.optString("name")}"
    }
}

/**
 * The list over the box while an `@` or a `/` is being written (the iPhone's `AssistantSuggestions`): rows in the conversation's panel, the first one marked. An issue's row is its agent's logo, its ID,
 * its title and its project; every ID takes the room of the widest one in the list and every row the room of a logo when any has one, so that the titles stand in one column (owner, 2026-11-22).
 */
@Composable
internal fun AssistantSuggestions(candidates: List<Completion>, status: CompletionStatus, kind: GroupChat.Kind, selected: Int, onSelect: (Completion) -> Unit) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val addressWidth = remember(candidates) {
        candidates.filterIsInstance<Completion.Issue>().maxOfOrNull { measurer.measure(it.address, TextStyle(fontSize = 12.sp)).size.width } ?: 0
    }
    val logo = candidates.any { it is Completion.Issue && it.recipient.nullableString("agent") != null }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val shape = RoundedCornerShape(16.dp)
    Box(Modifier.fillMaxWidth().height(minOf(240, maxOf(68, candidates.size * 48 + 8)).dp).clip(shape)
        .background(chatPanel(), shape).border(.5.dp, chatBorder(), shape).testTag("assistant-suggestions")) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(4.dp)) {
            if (candidates.isEmpty()) item {
                Box(Modifier.fillMaxWidth().heightIn(min = 60.dp), contentAlignment = Alignment.Center) {
                    if (status == CompletionStatus.Loading) CircularProgressIndicator(Modifier.size(20.dp), color = muted, strokeWidth = 2.dp)
                    else Text(if (status == CompletionStatus.Failed) w("连接暂时不可用。") else if (kind == GroupChat.Kind.Issue) w("没有事项") else w("还没有技能"),
                        fontSize = 14.sp, color = muted)
                }
            }
            itemsIndexed(candidates, key = { _, item -> item.id }) { index, item ->
                Box(Modifier.fillMaxWidth().heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp))
                    .background(if (index == selected) DuduStyle.selected else Color.Transparent)
                    .clickable { onSelect(item) }.padding(horizontal = 12.dp).testTag("assistant-suggestion-${item.id}"),
                    contentAlignment = Alignment.CenterStart) {
                    when (item) {
                        is Completion.Issue -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            val agent = item.recipient.nullableString("agent")
                            if (agent != null) AgentLogo(agent, 20) else if (logo) Spacer(Modifier.size(20.dp))
                            Text(item.address, Modifier.widthIn(min = with(density) { addressWidth.toDp() }), fontSize = 12.sp, color = muted,
                                maxLines = 1, softWrap = false)
                            Text(item.recipient.optString("title"), Modifier.weight(1f), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                            item.recipient.optJSONObject("project")?.nullableString("name")?.let { name ->
                                Row(Modifier.widthIn(max = 96.dp), horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Glyph(DuduGlyphs.workspace, size = 14, tint = muted)
                                    Text(name, fontSize = 12.sp, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                        is Completion.Skill -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Glyph(DuduGlyphs.skills, size = 20, tint = muted)
                            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                                Text("/${item.skill.optString("name")}", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
                                item.skill.optString("description").takeIf { it.isNotEmpty() }?.let {
                                    Text(it, fontSize = 12.sp, color = muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
