package app.dudu.android.ui

import android.content.Context
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner

/** The system's animator duration scale, read once for the process and then watched. */
private object SystemMotion {
    private val on = mutableStateOf(true)
    private var watching = false

    fun state(context: Context): State<Boolean> {
        if (watching) return on
        watching = true
        val resolver = context.applicationContext.contentResolver
        fun read() = Settings.Global.getFloat(resolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
        on.value = read()
        resolver.registerContentObserver(Settings.Global.getUriFor(Settings.Global.ANIMATOR_DURATION_SCALE), false,
            object : ContentObserver(Handler(Looper.getMainLooper())) {
                override fun onChange(selfChange: Boolean) { on.value = read() }
            })
        return on
    }
}

/**
 * Whether a moving mark moves: the app is in front and the system's animator duration scale is not 0 (developer options, or 移除动画). That is the setting Compose's own
 * animations follow. Not `ValueAnimator.areAnimatorsEnabled()`, the process's own copy of the scale, read once: on the owner's HyperOS phone it said 0 while the setting
 * said 1, and the board's running ring stood still at its starting angle (2026-11-22, 「loading 不会转」).
 */
@Composable
internal fun motionOn(): Boolean {
    val context = LocalContext.current
    val system = remember(context) { SystemMotion.state(context) }
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    return lifecycle.isAtLeast(Lifecycle.State.STARTED) && system.value
}

@Composable
private fun ringRotation(): State<Float> {
    return if (motionOn()) {
        rememberInfiniteTransition(label = "ring").animateFloat(0f, 360f,
            infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "ring-angle")
    } else remember { mutableFloatStateOf(0f) }
}

/** AgentLogo.swift: a fixed 28% arc, a 30% track and one linear turn per second. */
@Composable
internal fun WorkingMark(size: Dp, color: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    val rotation = ringRotation()
    Canvas(Modifier.size(size).graphicsLayer { rotationZ = rotation.value }) {
        val line = 1.5.dp.toPx()
        val radius = (this.size.minDimension - line).coerceAtLeast(0f) / 2
        drawCircle(color.copy(alpha = color.alpha * .3f), radius, style = Stroke(line))
        drawArc(color, 0f, 360f * .28f, false, Offset(line / 2, line / 2),
            Size(radius * 2, radius * 2), style = Stroke(line, cap = StrokeCap.Round))
    }
}

/** LoadingRing.swift: the approved thin arc and fading tail, used by connection and delivery. */
@Composable
internal fun DeliveryLoadingMark(size: Int = 22, color: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    val rotation = ringRotation()
    Canvas(Modifier.size(size.dp).graphicsLayer { rotationZ = rotation.value }) {
        val unit = this.size.minDimension / 24
        val radius = 9 * unit
        val brush = Brush.sweepGradient(0f to color.copy(alpha = 0f), .08f to color.copy(alpha = 0f),
            .24f to color.copy(alpha = color.alpha * .2f), .62f to color.copy(alpha = color.alpha * .7f),
            1f to color, center = center)
        // A sweep starts on the right on Android; the iPhone's conic gradient starts at the top.
        rotate(-90f) {
            drawArc(brush, 28.8f, 331.2f, false, center - Offset(radius, radius), Size(radius * 2, radius * 2),
                style = Stroke(1.8f * unit, cap = StrokeCap.Round))
        }
    }
}

/** BoardSubIssues.swift: the 14pt static ring, including its butt caps and fixed colours. */
@Composable
internal fun SubIssueProgressMark(done: Int, total: Int) {
    Canvas(Modifier.size(14.dp)) {
        val line = 2.dp.toPx()
        val radius = (size.minDimension - line) / 2
        drawCircle(Color(0xFFDEDEDE), radius, style = Stroke(line))
        val fraction = if (total > 0) (done.toFloat() / total).coerceIn(0f, 1f) else 0f
        drawArc(Color(0xFF5E6AD2), -90f, fraction * 360, false, Offset(line / 2, line / 2),
            Size(radius * 2, radius * 2), style = Stroke(line, cap = StrokeCap.Butt))
    }
}
