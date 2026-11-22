package app.dudu.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.dudu.android.R
import app.dudu.android.data.Conversation

/**
 * The board list's swipe, the iPhone's (owner, 2026-11-19: "安卓和 iOS 保持一致 … 动画也要保持一样，看板列表那里也进行调整保持一样"): to the right 完成 in the iPhone's teal, which a long
 * swipe does as the row slides away and closes; to the left the unread mark and the pin, in the iPhone's two blues, with the iPhone's own glyphs (`home_swipe_*`, copied from its asset
 * catalog by `scripts/sync-android-assets.mjs`). A conversation without a session shows the unread block and cannot use it, as on the iPhone.
 * `enabled` is the row's own (the computer connected, the row not saving a change of its own); `revealed` / `onReveal` keep one row open at a time, as the iPhone's board does.
 */
@Composable
fun HomeSwipeRow(row: Conversation, enabled: Boolean, complete: () -> Unit, read: () -> Unit,
    pin: () -> Unit, revealed: Boolean? = null, onReveal: (Boolean) -> Unit = {}, content: @Composable (() -> Boolean) -> Unit) {
    val done = if (row.issue != null && row.issue.statusType != "done")
        RevealAction(w("完成"), R.drawable.home_swipe_complete, SwipeColors.complete, perform = complete) else null
    SwipeRevealRow(done, listOf(
        RevealAction(stringResource(if (row.unread) R.string.clear_unread else R.string.mark_unread),
            if (row.unread) R.drawable.home_swipe_clear_unread else R.drawable.home_swipe_mark_unread,
            SwipeColors.read, enabled = row.sessionId != null, perform = read),
        RevealAction(if (row.pinned) w("取消置顶") else w("置顶"),
            if (row.pinned) R.drawable.home_swipe_unpin else R.drawable.home_swipe_pin, SwipeColors.blue, perform = pin),
    ), enabled = enabled, revealed = revealed, onReveal = onReveal, content = content)
}
