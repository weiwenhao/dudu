package app.dudu.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R
import app.dudu.android.data.Conversation
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
fun HomeSwipeRow(row: Conversation, busy: Boolean, complete: () -> Unit, read: () -> Unit,
    pin: () -> Unit, content: @Composable (() -> Boolean) -> Unit) {
    val density = LocalDensity.current
    val unit = with(density) { 76.dp.toPx() }
    val offset = remember { Animatable(0f) }
    val scope = rememberCoroutineScope()
    var position by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    val displayed = if (dragging) position else offset.value
    fun close(): Boolean {
        if (displayed == 0f) return false
        scope.launch { offset.animateTo(0f, tween(180)) }
        return true
    }
    Box(Modifier.fillMaxWidth().height(66.dp).clipToBounds()) {
        if (displayed > 0 && row.issue != null) {
            SwipeAction(w("完成"), R.drawable.ic_check, Color(0xFF4F948E), Modifier.width(76.dp).fillMaxHeight(), !busy) {
                close(); complete()
            }
        } else if (displayed < 0) Row(Modifier.align(Alignment.CenterEnd).fillMaxHeight()) {
            if (row.sessionId != null) SwipeAction(stringResource(if (row.unread) R.string.clear_unread else R.string.mark_unread),
                if (row.unread) R.drawable.ic_mail_open else R.drawable.ic_mail,
                Color(0xFF4176E6), Modifier.width(76.dp).fillMaxHeight(), !busy) { close(); read() }
            SwipeAction(if (row.pinned) w("取消置顶") else w("置顶"),
                if (row.pinned) R.drawable.ic_pin_off else R.drawable.ic_pin,
                Color(0xFF96989D), Modifier.width(76.dp).fillMaxHeight(), !busy) { close(); pin() }
        }
        val leftActions = if (row.sessionId != null) 2 else 1
        Box(Modifier.offset { IntOffset(displayed.roundToInt(), 0) }
            .draggable(rememberDraggableState { delta ->
                position = (position + delta).coerceIn(-unit * leftActions,
                    if (row.issue != null) unit * 2.2f else 0f)
            }, Orientation.Horizontal, enabled = !busy,
                onDragStarted = { position = offset.value; dragging = true },
                onDragStopped = {
                    offset.snapTo(position)
                    dragging = false
                    val target = when {
                        position > unit * 1.8f -> { complete(); 0f }
                        position > unit * .45f -> unit
                        position < -unit * .45f -> -unit * leftActions
                        else -> 0f
                    }
                    offset.animateTo(target, tween(180))
                })) { content(::close) }
    }
}

@Composable
private fun SwipeAction(title: String, icon: Int, color: Color, modifier: Modifier, enabled: Boolean,
    action: () -> Unit) {
    Surface(onClick = action, enabled = enabled, color = color, modifier = modifier) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Glyph(icon, size = 20, tint = Color.White)
            Spacer(Modifier.height(5.dp))
            Text(title, fontSize = 11.sp, color = Color.White)
        }
    }
}
