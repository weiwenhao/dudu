package app.dudu.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/** The iPhone's DuduChecklistGlyph, with the same 20-point geometry and 1.4-point stroke. */
@Composable
internal fun ChecklistGlyph(size: Int = 20, tint: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Canvas(Modifier.size(size.dp)) {
        val scale = this.size.width / 20f
        for (y in listOf(6.15f, 13.85f)) {
            drawCircle(tint, 2.1f * scale, Offset(5.375f * scale, y * scale), style = Stroke(1.4f * scale))
            drawLine(tint, Offset(10.025f * scale, y * scale), Offset(16.725f * scale, y * scale),
                strokeWidth = 1.4f * scale, cap = StrokeCap.Round)
        }
    }
}
