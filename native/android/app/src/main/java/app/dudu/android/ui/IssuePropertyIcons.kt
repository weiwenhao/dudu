package app.dudu.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.unit.dp
import app.dudu.android.data.Status

private val statusColors = mapOf("backlog" to "95a2b3", "todo" to "a0a5ad", "in_progress" to "f2c94c",
    "in_review" to "4cb782", "done" to "5e6ad2", "canceled" to "95a2b3")
internal val labelPalette = listOf("grey" to "bec2c8", "darkGrey" to "95a2b3", "purple" to "5e6ad2",
    "teal" to "26b5ce", "green" to "4cb782", "yellow" to "f2c94c", "orange" to "f2994a",
    "pink" to "f7c8c1", "red" to "eb5757")

internal fun issueColor(value: String?, fallback: String = "95a2b3"): Color =
    runCatching { Color(android.graphics.Color.parseColor("#${value?.removePrefix("#") ?: fallback}")) }
        .getOrDefault(Color(0xFF95A2B3))

internal fun labelColor(value: String?) = issueColor(labelPalette.find { it.first == value }?.second)

@Composable
fun IssueStatusMark(status: Status, size: Int = 16) {
    val color = issueColor(status.color, statusColors[status.type] ?: "95a2b3")
    Canvas(Modifier.size(size.dp)) {
        scale(this.size.width / 16, this.size.height / 16, pivot = Offset.Zero) {
            if (status.type == "done" || status.type == "canceled") {
                drawCircle(color, 7f, Offset(8f, 8f))
                val mark = Path().apply {
                    if (status.type == "done") { moveTo(5f, 8.2f); lineTo(7f, 10.2f); lineTo(11f, 5.8f) }
                    else { moveTo(5.6f, 5.6f); lineTo(10.4f, 10.4f); moveTo(10.4f, 5.6f); lineTo(5.6f, 10.4f) }
                }
                drawPath(mark, Color.White, style = Stroke(1.6f, cap = StrokeCap.Round, join = StrokeJoin.Round))
            } else {
                drawCircle(color, 6f, Offset(8f, 8f), style = Stroke(1.6f, cap = StrokeCap.Round,
                    pathEffect = if (status.type == "backlog") PathEffect.dashPathEffect(floatArrayOf(1.6f, 2.4f)) else null))
                if (status.type in listOf("in_progress", "in_review")) {
                    val progress = (status.iconProgress ?: if (status.type == "in_review") .75f else .5f).coerceIn(0f, 1f)
                    drawArc(color, -90f, progress * 360f, useCenter = true,
                        topLeft = Offset(4.2f, 4.2f), size = Size(7.6f, 7.6f))
                }
            }
        }
    }
}

@Composable
fun IssuePriorityMark(priority: String) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Canvas(Modifier.size(16.dp)) {
        scale(this.size.width / 16, this.size.height / 16, pivot = Offset.Zero) {
            when (priority) {
                "urgent" -> {
                    drawRoundRect(Color(0xFFF4793B), Offset(1.5f, 1.5f), Size(13f, 13f), CornerRadius(3.5f))
                    drawLine(Color.White, Offset(8f, 4.6f), Offset(8f, 8.6f), 1.7f, StrokeCap.Round)
                    drawCircle(Color.White, 1f, Offset(8f, 11f))
                }
                "none" -> listOf(2f, 6.7f, 11.4f).forEach { x ->
                    drawLine(muted, Offset(x, 8f), Offset(x + 2.6f, 8f), 1.7f, StrokeCap.Round)
                }
                else -> {
                    val level = when (priority) { "high" -> 3; "medium" -> 2; else -> 1 }
                    listOf(2f, 6.5f, 11f).forEachIndexed { index, x ->
                        val height = 5f + index * 3
                        drawRoundRect(muted.copy(alpha = if (index < level) 1f else .28f),
                            Offset(x, 14f - height), Size(3f, height), CornerRadius(1f))
                    }
                }
            }
        }
    }
}
