package app.dudu.android.ui

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.IntSize

/**
 * Where a long-press menu opens: at the finger (owner, 2026-11-21: 「能不能跟随点击的位置？」), as the system's menus do, not under the row it belongs to. A `DropdownMenu` hangs from the bottom-left
 * of the composable it sits in; `PressPoint` remembers where the last touch went down in that composable and how big it is, and `menuOffset()` moves the menu from the bottom-left to the finger.
 */
@Stable
class PressPoint {
    var at by mutableStateOf(Offset.Zero)
    var size by mutableStateOf(IntSize.Zero)

    @Composable
    fun menuOffset(): DpOffset = with(LocalDensity.current) { DpOffset(at.x.toDp(), (at.y - size.height).toDp()) }
}

/** Notes where a touch goes down in this composable, without taking part in the gesture: taps, swipes and long presses go on as they did. Put it on the composable the menu sits in. */
fun Modifier.notePress(point: PressPoint): Modifier = this
    .onSizeChanged { point.size = it }
    .pointerInput(point) {
        awaitEachGesture { point.at = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial).position }
    }
