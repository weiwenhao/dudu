package app.dudu.android.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.media.AndroidSpeechCapture
import app.dudu.android.media.VoicePhase
import kotlin.math.*

@Composable
internal fun HoldToTalkBar(capture: AndroidSpeechCapture, enabled: Boolean, modifier: Modifier, begin: () -> Boolean) {
    val latestBegin by rememberUpdatedState(begin)
    val threshold = with(LocalDensity.current) { 160.dp.toPx() }
    val description = w("按住说话，上滑取消")
    val cancelLabel = w("取消")
    Box(modifier.height(44.dp).testTag("composer-hold-to-talk")
        .semantics {
            role = Role.Button
            contentDescription = description
            if (!enabled) disabled()
            if (capture.active) customActions = listOf(CustomAccessibilityAction(cancelLabel) { capture.cancel(); true })
            onClick {
                if (!enabled) false
                else {
                    if (capture.active) capture.release() else latestBegin()
                    true
                }
            }
        }
        .pointerInput(capture, enabled, threshold) {
            awaitEachGesture {
                val down = awaitFirstDown()
                if (!enabled) return@awaitEachGesture
                down.consume()
                if (!latestBegin()) return@awaitEachGesture
                var released = false
                try {
                    while (true) {
                        val change = awaitPointerEvent().changes.firstOrNull { it.id == down.id } ?: break
                        if (change.isConsumed) break
                        capture.move(change.position.y - down.position.y < -threshold)
                        change.consume()
                        if (!change.pressed) {
                            capture.release()
                            released = true
                            break
                        }
                    }
                } finally {
                    if (!released) capture.cancel()
                }
            }
        }, contentAlignment = Alignment.Center) {
        Text(w("按住说话"), fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface)
    }
}

/** Exact proportions of the existing iPhone composer's bare voice and keyboard glyphs. */
@Composable
internal fun ComposerModeGlyph(keyboard: Boolean, description: String) {
    val ink = MaterialTheme.colorScheme.onSurface
    Canvas(Modifier.size(25.dp).semantics { contentDescription = description }) {
        val k = size.width / 25f
        val scale = if (keyboard) 1.42f else 1.22f
        fun point(x: Float, y: Float) = Offset((12.5f + (x - 12.5f) * scale) * k, (12.5f + (y - 12.5f) * scale) * k)
        if (keyboard) {
            for (y in listOf(8.6f, 12.4f)) for (x in listOf(8.65f, 12.5f, 16.35f))
                drawCircle(ink, 1.2f * scale * k, point(x, y))
            drawRoundRect(ink, point(8.4f, 15.9f),
                androidx.compose.ui.geometry.Size(8.25f * scale * k, 1.9f * scale * k),
                androidx.compose.ui.geometry.CornerRadius(.95f * scale * k))
        } else {
            val dot = point(8.4f, 12.85f)
            drawCircle(ink, 1.35f * scale * k, dot)
            for ((radius, sweep) in listOf(4.9f to 42f, 8.5f to 50f)) {
                val path = Path()
                var degrees = -sweep
                while (degrees <= sweep + .01f) {
                    val radians = degrees * PI.toFloat() / 180f
                    val tip = dot + Offset(radius * cos(radians), radius * sin(radians)) * (scale * k)
                    if (degrees == -sweep) path.moveTo(tip.x, tip.y) else path.lineTo(tip.x, tip.y)
                    degrees += 3f
                }
                drawPath(path, ink, style = Stroke(2f * k, cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
        }
    }
}

/** Reuses the iPhone's blue/red bottom wash, transcript, hint and 54-bar audio meter. */
@Composable
internal fun VoiceCaptureOverlay(capture: AndroidSpeechCapture, modifier: Modifier) {
    if (!capture.active) return
    val cancelling = capture.cancelling
    val finishing = capture.phase == VoicePhase.Finishing
    val ink = if (cancelling) Color(0xFFEC3E42) else Color.White
    val colors = if (cancelling) listOf(0xFFFFE2E4, 0xFFFFDEE0, 0xFFFFDADB, 0xFFFFDEE0, 0xFFFFE2E4)
        else listOf(0xFF37B1FE, 0xFF239BF9, 0xFF1380F5, 0xFF239BF9, 0xFF37B1FE)
    val level by animateFloatAsState(capture.level, tween(90, easing = LinearEasing), label = "voice-level")
    Box(modifier.testTag(if (cancelling) "voice-overlay-cancel" else "voice-overlay-recording")) {
        Canvas(Modifier.matchParentSize().graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
            drawRect(Brush.horizontalGradient(colors.map(::Color)))
            drawRect(Brush.verticalGradient(
                0f to Color.Transparent, .25f to Color.Transparent,
                .4f to Color.Black.copy(alpha = .02f), .56f to Color.Black.copy(alpha = .12f),
                .8f to Color.Black.copy(alpha = .58f), 1f to Color.Black,
                endY = size.height), blendMode = BlendMode.DstIn)
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(bottom = 74.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            if (capture.transcript.isNotBlank())
                Text(capture.transcript, Modifier.padding(horizontal = 28.dp).padding(bottom = 20.dp),
                    fontSize = 19.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium,
                    maxLines = 2, color = ink, textAlign = TextAlign.Center)
            Text(if (cancelling) w("松手取消") else if (finishing || capture.phase == VoicePhase.Starting)
                w("正在识别…") else w("松手发送，上移取消"),
                fontSize = 13.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium,
                color = ink.copy(alpha = if (cancelling) 1f else .78f))
            Spacer(Modifier.height(46.dp))
            Canvas(Modifier.fillMaxWidth(.72f).widthIn(max = 300.dp).height(32.dp)) {
                val cell = size.width / 54
                for (index in 0 until 54) {
                    val taper = sin(PI * index / 53).toFloat()
                    val variation = .45f + .55f * abs(sin(index * 1.71f))
                    val height = (6.4f + 21f * level * taper * variation).dp.toPx()
                    val x = (index + .5f) * cell
                    drawLine(ink.copy(alpha = if (finishing) .65f else 1f),
                        Offset(x, (size.height - height) / 2), Offset(x, (size.height + height) / 2),
                        strokeWidth = min(3.dp.toPx(), cell * .6f), cap = StrokeCap.Round)
                }
            }
        }
    }
}
