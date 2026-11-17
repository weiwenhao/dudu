package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import app.dudu.android.*
import app.dudu.android.R

@Composable
fun IssueContextMenu(panel: Panel.Actions, state: UiState, model: DuduViewModel) {
    val row = panel.row
    val enabled = state.connected && !state.busy
    val density = LocalDensity.current
    val title = if (row.id == "assistant") stringResource(R.string.dudu) else row.title
    val position = remember { object : PopupPositionProvider {
        override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize,
            layoutDirection: LayoutDirection, popupContentSize: IntSize) = IntOffset.Zero
    } }
    Popup(popupPositionProvider = position, onDismissRequest = model::dismissPanel,
        properties = PopupProperties(focusable = true, clippingEnabled = false)) {
        BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .18f))
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null,
                onClick = model::dismissPanel)) {
            val topInset = WindowInsets.statusBars.getTop(density)
            val bottomInset = WindowInsets.navigationBars.getBottom(density)
            val margin = with(density) { 16.dp.roundToPx() }
            val width = minOf(maxWidth - 32.dp, 300.dp)
            var height by remember(row.id) { mutableIntStateOf(0) }
            val left = (panel.anchor.left + margin).coerceIn(margin,
                (constraints.maxWidth - with(density) { width.roundToPx() } - margin).coerceAtLeast(margin))
            val top = panel.anchor.top.coerceIn(topInset + margin,
                (constraints.maxHeight - bottomInset - margin - height).coerceAtLeast(topInset + margin))
            Column(Modifier.width(width).heightIn(max = with(density) {
                (constraints.maxHeight - topInset - bottomInset - margin * 2).coerceAtLeast(0).toDp()
            }).offset { IntOffset(left, top) }
                .onSizeChanged { height = it.height }
                .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {}) {
                Surface(shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surface,
                    shadowElevation = 12.dp) {
                    Text(title, Modifier.fillMaxWidth().padding(horizontal = 22.dp, vertical = 16.dp),
                        fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.height(12.dp))
                Surface(Modifier.widthIn(max = 252.dp).weight(1f, fill = false).testTag("issue-context-menu"),
                    shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    shadowElevation = 12.dp) {
                    Column(Modifier.verticalScroll(rememberScrollState()).padding(vertical = 6.dp)) {
                        ContextAction(if (row.pinned) stringResource(R.string.unpin) else stringResource(R.string.pin),
                            if (row.pinned) R.drawable.ic_pin_off else R.drawable.ic_pin,
                            enabled, "toggle-pin") { model.pin(row) }
                        ContextAction(if (row.unread) stringResource(R.string.clear_unread) else stringResource(R.string.mark_unread),
                            if (row.unread) R.drawable.home_swipe_clear_unread else R.drawable.home_swipe_mark_unread,
                            enabled && row.sessionId != null, "toggle-unread") { model.read(row) }
                        row.issue?.let { issue ->
                            MenuDivider()
                            ContextAction(w("详情"), R.drawable.ic_file, true, "issue-detail") {
                                model.navigate(Route("issue", issue.title, issue.id.toString()))
                            }
                            ContextAction(w("重命名"), R.drawable.ic_pencil, enabled, "rename-issue") {
                                model.show(Panel.Rename(issue))
                            }
                            MenuDivider()
                            IssueProperty.entries.forEach { property ->
                                ContextAction(issuePropertyTitle(property), issuePropertyIcon(property),
                                    enabled && (issue.agent == null || property !in listOf(IssueProperty.Agent, IssueProperty.Project)),
                                    "issue-${property.name.lowercase()}") { model.show(Panel.EditIssue(issue, property)) }
                            }
                            ContextAction(w("添加子事项"), R.drawable.ic_corner_down_right, enabled, "add-subissue") {
                                model.addSubIssue(issue)
                            }
                            MenuDivider()
                            ContextAction(w("完成"), R.drawable.ic_check, enabled && issue.statusType != "done",
                                "complete-issue") { model.complete(row) }
                            ContextAction(stringResource(R.string.delete), R.drawable.ic_trash2, enabled,
                                "delete-issue", danger = true) { model.previewDelete(issue) }
                        }
                        if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                        state.problem?.let { Text(problemText(it), Modifier.padding(16.dp).testTag("panel-error"),
                            fontSize = 13.sp, color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
        }
    }
}

@Composable
private fun ContextAction(title: String, icon: Int, enabled: Boolean, tag: String,
    danger: Boolean = false, action: () -> Unit) {
    val color = (if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
        .copy(alpha = if (enabled) 1f else .35f)
    Row(Modifier.fillMaxWidth().clickable(enabled = enabled, onClick = action).testTag(tag)
        .heightIn(min = 44.dp).padding(horizontal = 18.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Glyph(icon, size = 18, tint = color)
        Text(title, fontSize = 15.sp, lineHeight = 20.sp, color = color)
    }
}

@Composable
private fun MenuDivider() {
    HorizontalDivider(Modifier.padding(horizontal = 16.dp, vertical = 6.dp), thickness = .5.dp,
        color = MaterialTheme.colorScheme.onSurface.copy(alpha = .12f))
}

@Composable
fun issuePropertyTitle(property: IssueProperty) = when (property) {
    IssueProperty.Priority -> stringResource(R.string.priority)
    IssueProperty.Agent -> stringResource(R.string.agent)
    IssueProperty.Status -> stringResource(R.string.status)
    IssueProperty.Due -> w("截止日期")
    IssueProperty.Labels -> w("标签")
    IssueProperty.Project -> stringResource(R.string.project)
}

fun issuePropertyIcon(property: IssueProperty) = when (property) {
    IssueProperty.Priority -> R.drawable.ic_chart_no_axes_column
    IssueProperty.Agent -> R.drawable.ic_user_round
    IssueProperty.Status -> R.drawable.ic_circle_dashed
    IssueProperty.Due -> R.drawable.ic_calendar
    IssueProperty.Labels -> R.drawable.ic_tag
    IssueProperty.Project -> R.drawable.ic_folder
}
