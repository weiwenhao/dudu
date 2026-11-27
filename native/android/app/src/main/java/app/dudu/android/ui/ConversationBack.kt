package app.dudu.android.ui

import androidx.activity.BackEventCompat
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * The conversation on screen with the system's back gesture on it (owner, 2026-11-27, on the iPhone's search: the back of a conversation opened from a result is the system's swipe, and lands on
 * the page it came from). Android's is predictive back: while the finger is on the edge the conversation shrinks a little and follows it, with rounded corners, and the page it goes back to is seen
 * under it (`reveals`: the board or the search page, which `DuduApp` then keeps placed; `revealing` tells it so); let go past the point where it comes back, the conversation finishes its way out and
 * `leave` runs, and given up, it comes back. A back that is no gesture (the bar's ‹, a key, a phone without predictive back) calls `leave` at once. Its own back, the bar's ‹, is the page's.
 */
@Composable
internal fun ConversationBackLayer(enabled: Boolean, reveals: Boolean, revealing: (Boolean) -> Unit, leave: () -> Unit, content: @Composable () -> Unit) {
    val scope = rememberCoroutineScope()
    val progress = remember { Animatable(0f) }
    var fromLeft by remember { mutableStateOf(true) }
    val moving by remember { derivedStateOf { progress.value > 0f } }
    DisposableEffect(Unit) { onDispose { revealing(false) } }
    PredictiveBackHandler(enabled) { events ->
        var seen = false
        try {
            events.collect { event ->
                seen = true
                if (reveals) {
                    fromLeft = event.swipeEdge == BackEventCompat.EDGE_LEFT
                    revealing(true)
                    progress.snapTo(event.progress)
                }
            }
            if (seen && reveals) progress.animateTo(1f, tween(110))
            leave()
        } catch (cancelled: CancellationException) {
            // The gesture was given up: the conversation comes back, and the page under it goes.
            scope.launch { progress.animateTo(0f, tween(150)); revealing(false) }
            throw cancelled
        }
    }
    Box(Modifier.fillMaxSize().then(if (!moving) Modifier else Modifier.graphicsLayer {
        val p = progress.value.coerceIn(0f, 1f)
        val scale = 1f - 0.1f * p
        scaleX = scale
        scaleY = scale
        translationX = (if (fromLeft) 1f else -1f) * p * size.width * 0.04f
        // It fades out over the last fifth, so that finishing its way out leaves no jump.
        alpha = if (p < 0.8f) 1f else 1f - (p - 0.8f) / 0.2f
        shape = RoundedCornerShape(28.dp.toPx() * minOf(1f, p * 3f))
        clip = true
    })) { content() }
}
