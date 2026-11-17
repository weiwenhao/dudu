package app.dudu.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

internal data class RowSwipeAction(val title: String, val icon: Int, val color: Color, val perform: () -> Unit)

/** The caller owns the revealed row so opening a swipe closes the other rows. */
@Composable
internal fun SwipeMenuRow(actions: List<RowSwipeAction>, enabled: Boolean, revealed: Boolean,
    onReveal: (Boolean) -> Unit, content: @Composable (close: () -> Boolean) -> Unit) {
    if (actions.isEmpty()) { content { false }; return }
    val unit = with(LocalDensity.current) { 76.dp.toPx() }
    val offset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var drag by remember { mutableStateOf<Float?>(null) }
    LaunchedEffect(revealed, unit, actions.size) {
        offset.animateTo(if (revealed) -unit * actions.size else 0f, tween(180))
    }
    fun close(): Boolean {
        val wasOpen = revealed || offset.value < -1f
        if (wasOpen) { onReveal(false); scope.launch { offset.animateTo(0f, tween(180)) } }
        return wasOpen
    }
    Box(Modifier.fillMaxWidth().height(IntrinsicSize.Min).clipToBounds().semantics {
        if (enabled) customActions = actions.map { action ->
            CustomAccessibilityAction(action.title) { close(); action.perform(); true }
        }
    }) {
        if ((drag ?: offset.value) < 0f) Row(Modifier.align(Alignment.CenterEnd).fillMaxHeight()) {
            actions.forEach { action ->
                Surface(onClick = { close(); action.perform() }, enabled = enabled, color = action.color,
                    modifier = Modifier.width(76.dp).fillMaxHeight()) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                        Glyph(action.icon, size = 20, tint = Color.White)
                        Spacer(Modifier.height(5.dp))
                        Text(action.title, color = Color.White, fontSize = 12.sp)
                    }
                }
            }
        }
        Box(Modifier.offset { IntOffset((drag ?: offset.value).roundToInt(), 0) }
            .draggable(rememberDraggableState { delta ->
                drag = ((drag ?: offset.value) + delta).coerceIn(-unit * actions.size, 0f)
            }, Orientation.Horizontal, enabled = enabled,
                onDragStarted = { offset.stop(); drag = offset.value }, onDragStopped = {
                    val end = drag ?: offset.value
                    offset.snapTo(end); drag = null
                    val open = end < -unit * .45f
                    onReveal(open)
                    offset.animateTo(if (open) -unit * actions.size else 0f, tween(180))
                })) { content(::close) }
    }
}
