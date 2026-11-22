package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.data.HomeTab

internal data class HomePageChrome(val active: Boolean, val title: String, val openDrawer: () -> Unit)
internal val LocalHomePage = staticCompositionLocalOf<HomePageChrome?> { null }

@Composable
internal fun homeTitle(tab: HomeTab): String = when (tab) {
    HomeTab.Board -> w("看板")
    HomeTab.Inbox -> w("收件箱")
    HomeTab.Tasks -> w("任务")
    HomeTab.Settings -> w("设置")
}

/**
 * The flat bar of the four roots (owner, 2026-11-21: the iPhone's floating capsule does not suit Android; picked B of `.local/designs/android-bottom-menu-2026-11-21/`):
 * full width, white, a hairline above, 56dp of icons (24dp) over words (11sp) and the system navigation inset below it. The chosen root has the iPhone's look and no
 * indicator: its glyph filled and black (the board's coloured), its word darker and medium; the others are the grey outline glyphs.
 */
@Composable
internal fun HomeTabBar(selection: HomeTab, unread: Int, inboxUnread: Int, select: (HomeTab) -> Unit) {
    val dark = isSystemInDarkTheme()
    val colors = MaterialTheme.colorScheme
    val idle = if (dark) colors.onSurfaceVariant else DuduStyle.scopeInk
    Surface(Modifier.fillMaxWidth(), color = colors.surface) {
        Column(Modifier.navigationBarsPadding()) {
            HorizontalDivider(thickness = 1.dp, color = if (dark) colors.outlineVariant else Color(0xFFE3E4E8))
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                Row(Modifier.widthIn(max = 600.dp).fillMaxWidth().height(56.dp).selectableGroup()) {
                    HomeTab.entries.forEach { tab ->
                        val chosen = tab == selection
                        val color = if (chosen) colors.onSurface else idle
                        val count = when (tab) { HomeTab.Board -> unread; HomeTab.Inbox -> inboxUnread; else -> 0 }
                        val glyph = when (tab) {
                            HomeTab.Board -> if (chosen) R.drawable.home_board_selected else DuduGlyphs.issueStatus
                            HomeTab.Inbox -> if (chosen) R.drawable.home_inbox_selected else DuduGlyphs.inbox
                            HomeTab.Tasks -> if (chosen) R.drawable.home_tasks_selected else DuduGlyphs.schedule
                            HomeTab.Settings -> if (chosen) R.drawable.home_settings_selected else DuduGlyphs.settings
                        }
                        Column(Modifier.weight(1f).fillMaxHeight()
                            .testTag("home-tab-${tab.name.lowercase()}")
                            .semantics { if (count > 0) stateDescription = count.toString() }
                            .selectable(chosen, interactionSource = remember { MutableInteractionSource() },
                                indication = null, role = Role.Tab, onClick = { select(tab) }),
                            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                            Box(Modifier.size(24.dp)) {
                                Glyph(glyph, null, 24, if (chosen && tab == HomeTab.Board) Color.Unspecified else color)
                                if (count > 0) Box(Modifier.align(Alignment.TopEnd).offset(x = 10.dp, y = (-2).dp)
                                    .heightIn(min = 18.dp).widthIn(min = 18.dp)
                                    .background(Color(0xFFEC1313), CircleShape)
                                    .border(1.5.dp, colors.surface, CircleShape).padding(horizontal = 4.dp)
                                    .clearAndSetSemantics {}, contentAlignment = Alignment.Center) {
                                    Text(count.toString(), color = Color.White, fontSize = 11.sp,
                                        lineHeight = 14.sp, fontWeight = FontWeight.Medium, maxLines = 1)
                                }
                            }
                            Spacer(Modifier.height(3.dp))
                            Text(homeTitle(tab), color = color, fontSize = 11.sp, lineHeight = 13.sp,
                                fontWeight = if (chosen) FontWeight.Medium else FontWeight.Normal, maxLines = 1)
                        }
                    }
                }
            }
        }
    }
}
