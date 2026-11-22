package app.dudu.android.ui

import androidx.annotation.DrawableRes
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import app.dudu.android.R

/**
 * The inbox's actions as one set (owner, 2026-11-21, of `.local/designs/inbox-menu-icons-2026-11-21/`: "一堆图标感觉大小不一，尤其是补全上下文"; he approved it with the checkbox for 选择): the iPhone's
 * `DuduGlyph.inkIn24` and `inboxBox(slot:)`. Lucide draws every one of them in a 24 box, but the ink of the refresh and the trash can reaches 20 and 22 across and that of the check and the arrow only
 * 18 x 13, so each is drawn at the box that gives it the same visual size (the side of the square with the area of its ink box, measured from Lucide's drawing in `measure.mjs`): `slot * 17 / visual`
 * (17 of a 24 slot, as the iPhone's 17pt). A box larger than its slot overflows it, centred.
 *
 * The line is the iPhone's too: the same on the screen for all of them (`2 * slot / 24`, the line an icon of that slot has anywhere else). A bitmap that is only scaled would keep its line in proportion to
 * its box, so each of these has its own bitmap whose line is made up for the box it is drawn at (`inbox_set_*.png`: Lucide's outline of that glyph, line `2 * visual / 17` in the 24 grid, 96px).
 * A glyph that is not one of the eight is drawn as ever.
 */
private class InboxGlyphDrawing(val visual: Float, @param:DrawableRes val drawn: Int)

private val inboxGlyphs: Map<Int, InboxGlyphDrawing> = mapOf(
    DuduGlyphs.selectRows to InboxGlyphDrawing(20.5f, R.drawable.inbox_set_select_rows),
    DuduGlyphs.forward to InboxGlyphDrawing(15.3f, R.drawable.inbox_set_forward),
    DuduGlyphs.plus to InboxGlyphDrawing(16f, R.drawable.inbox_set_plus),
    DuduGlyphs.completeContext to InboxGlyphDrawing(20f, R.drawable.inbox_set_complete_context),
    DuduGlyphs.check to InboxGlyphDrawing(15.3f, R.drawable.inbox_set_check),
    DuduGlyphs.restore to InboxGlyphDrawing(20f, R.drawable.inbox_set_restore),
    DuduGlyphs.trash to InboxGlyphDrawing(21f, R.drawable.inbox_set_trash),
    DuduGlyphs.openLink to InboxGlyphDrawing(20f, R.drawable.inbox_set_open_link),
    // The message menu of 嘟嘟's group chat: 回复, 复制 (and 删除 above), one set as on the iPhone.
    DuduGlyphs.reply to InboxGlyphDrawing(15.3f, R.drawable.inbox_set_reply),
    DuduGlyphs.copy to InboxGlyphDrawing(22f, R.drawable.inbox_set_copy),
)

/** A glyph of the inbox's set in a `slot`-dp icon place (a menu's 18 or 20, a bar's 22, a swipe block's 22); any other glyph is a plain [Glyph] of that size. */
@Composable
internal fun InboxGlyph(resource: Int, slot: Int, tint: Color = MaterialTheme.colorScheme.onSurface, description: String? = null) {
    val drawing = inboxGlyphs[resource]
    if (drawing == null) {
        Glyph(resource, description, slot, tint)
        return
    }
    Box(Modifier.size(slot.dp), contentAlignment = Alignment.Center) {
        Icon(painterResource(drawing.drawn), description, Modifier.requiredSize((slot * 17f / drawing.visual).dp), tint = tint)
    }
}
