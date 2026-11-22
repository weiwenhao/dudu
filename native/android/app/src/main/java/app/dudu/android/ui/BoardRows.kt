package app.dudu.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.data.Conversation

/** The board's measures, the iPhone's `BoardHomeLayout` (from the owner's Lark screenshot). */
internal object BoardLayout {
    const val pinnedRowHeight = 72
    const val horizontalInset = 16
    const val agentSize = 14
    const val titleLineHeight = 22
    const val lineSpacing = 6
}

/**
 * The pinned shelf, the iPhone's `BoardPinnedShelf`: seven across, each slot 40 dp wide and 72 dp high with the space between them shared out; more than seven pins show six and,
 * in the seventh place, 展开 (with the red count of the unread ones it hides) or, once open, 收起 after the last pin.
 */
@Composable
internal fun BoardPinnedShelf(entries: List<Conversation>, expanded: Boolean, toggle: () -> Unit, cell: @Composable (Conversation) -> Unit) {
    val overflow = entries.size > 7
    val slots = if (overflow) (if (expanded) entries.size + 1 else 7) else entries.size
    val rows = (slots + 6) / 7
    Column(Modifier.fillMaxWidth().padding(horizontal = BoardLayout.horizontalInset.dp).padding(top = 8.dp)) {
        for (row in 0 until rows) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                for (column in 0 until 7) {
                    val index = row * 7 + column
                    Box(Modifier.width(40.dp).height(BoardLayout.pinnedRowHeight.dp), contentAlignment = Alignment.TopCenter) {
                        if (overflow && index == 6) ShelfToggle(entries, expanded, toggle)
                        else {
                            val item = if (overflow && index > 6) index - 1 else index
                            if (item < entries.size) cell(entries[item])
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ShelfToggle(entries: List<Conversation>, expanded: Boolean, toggle: () -> Unit) {
    Column(Modifier.requiredWidth(54.dp).height(BoardLayout.pinnedRowHeight.dp)
        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = toggle),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(40.dp)) {
            // The reference shelf's small filled triangle on its 40 dp canvas, on the iPhone's grey circle.
            Image(painterResource(if (expanded) R.drawable.home_pins_collapse else R.drawable.home_pins_expand), null,
                Modifier.size(40.dp).background(Color(0xFFF0F0F2), CircleShape), colorFilter = ColorFilter.tint(chatSecondary()))
            val unread = entries.drop(6).count { it.unread }
            if (!expanded && unread > 0) Box(Modifier.align(Alignment.TopEnd).offset(x = 3.dp, y = (-3).dp)
                .defaultMinSize(16.dp, 16.dp).background(Color(0xFFEC1313), CircleShape).border(1.5.dp, Color.White, CircleShape),
                contentAlignment = Alignment.Center) {
                Text(if (unread > 9) "9+" else "$unread", fontSize = 10.sp, lineHeight = 12.sp, fontWeight = FontWeight.Medium, color = Color.White)
            }
        }
        Text(if (expanded) w("收起") else w("展开"), fontSize = 11.5.sp, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The spinner a row shows while its own change is saved (the iPhone's small `ProgressView`): in place of the agent's logo, or over a pinned avatar. */
@Composable
internal fun RowSpinner(size: Int) {
    CircularProgressIndicator(Modifier.size(size.dp), strokeWidth = (size / 9f).coerceAtLeast(1.5f).dp,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/**
 * A sub-issue's title, the iPhone's `BoardConversationTitle`: its parent in grey, `#`, then its own title, which comes first: the parent keeps its width up to 128 dp and gives way down
 * to 48 dp before the sub-issue's title is cut.
 */
@Composable
internal fun BoardConversationTitle(title: String, parent: String?, fontSize: TextUnit, lineHeight: TextUnit, modifier: Modifier = Modifier) {
    if (parent == null) {
        Text(title, modifier, fontSize = fontSize, lineHeight = lineHeight, maxLines = 1, overflow = TextOverflow.Ellipsis)
        return
    }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val label = "$parent#$title"
    Layout({
        Text(parent, fontSize = fontSize, lineHeight = lineHeight, maxLines = 1, overflow = TextOverflow.Ellipsis, color = muted)
        Text("#", fontSize = fontSize, lineHeight = lineHeight, maxLines = 1, color = muted)
        Text(title, fontSize = fontSize, lineHeight = lineHeight, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }, modifier.semantics(mergeDescendants = true) { contentDescription = label }) { measurables, constraints ->
        val parentWidth = measurables[0].maxIntrinsicWidth(Constraints.Infinity)
        val separator = measurables[1].maxIntrinsicWidth(Constraints.Infinity)
        val child = measurables[2].maxIntrinsicWidth(Constraints.Infinity)
        val wide = 128.dp.roundToPx()
        val width = if (constraints.hasBoundedWidth) constraints.maxWidth else minOf(parentWidth, wide) + separator + child
        val childWidth = minOf(child, maxOf(0, width - minOf(parentWidth, 48.dp.roundToPx()) - separator))
        val parentShown = minOf(parentWidth, wide, maxOf(0, width - childWidth - separator))
        val placeables = listOf(parentShown, separator, childWidth).zip(measurables) { shown, measurable ->
            measurable.measure(Constraints.fixedWidth(shown).copy(minHeight = 0, maxHeight = constraints.maxHeight))
        }
        val height = placeables.maxOf { it.height }
        layout(if (constraints.hasBoundedWidth) constraints.maxWidth else width, height) {
            var x = 0
            placeables.forEach { it.placeRelative(x, (height - it.height) / 2); x += it.width }
        }
    }
}

/** A sub-issue progress: the Desktop's static ring and a muted count (the iPhone's `BoardSubIssueProgressLabel`). */
@Composable
internal fun SubIssueProgressLabel(done: Int, total: Int) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        SubIssueProgressMark(done, total)
        Text("$done/$total", fontSize = 12.sp, maxLines = 1, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** The board row's press: the whole row under a flat 6 % black while the finger is down, without a ripple (the iPhone's `BoardConversationPressStyle`). */
@Composable
internal fun Modifier.pressShade(interaction: MutableInteractionSource): Modifier {
    val pressed by interaction.collectIsPressedAsState()
    return drawWithContent {
        drawContent()
        if (pressed) drawRect(Color.Black.copy(alpha = .06f))
    }
}

/** The corner a pinned avatar is cut to while its spinner covers it: the tile's, or the round 嘟嘟's. */
internal fun pinnedSpinnerShape(row: Conversation) = RoundedCornerShape(if (row.id == "assistant") 20.dp else 10.dp)
