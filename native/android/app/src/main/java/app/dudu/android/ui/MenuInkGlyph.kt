package app.dudu.android.ui

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import app.dudu.android.R

/** DuduGlyph.menuImage(ink: 16): match visible ink, rather than just image boxes. */
@Composable
internal fun MenuInkGlyph(resource: Int) {
    val inkIn24 = when (resource) {
        DuduGlyphs.dueDate -> 21f
        DuduGlyphs.plus -> 16f
        else -> 18f
    }
    Icon(painterResource(if (resource == DuduGlyphs.open) R.drawable.menu_ink_open else resource),
        null, Modifier.size((24f * 16 / inkIn24).dp), tint = MaterialTheme.colorScheme.onSurface)
}
