package app.dudu.android.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/** One block of a swiped row, as the iPhone's board list draws its own: 84 dp wide, a 22 dp glyph over a 14 sp word, white on its colour. */
internal data class RevealAction(val title: String, val icon: Int, val color: Color, val enabled: Boolean = true, val perform: () -> Unit)

/** The colours of the board list's swipe, the iPhone's numbers (`BoardConversationSwipeRow.swift`, `RevealSwipeAction`): the two phones show the same (owner, 2026-11-19: "安卓和 iOS 保持一致"). */
internal object SwipeColors {
    val complete = Color(0xFF27B3A0)
    val read = Color(0xFF27AFE7)
    val blue = Color(0xFF336DF4)
    val delete = Color(0xFFE0333D)
}

/** Where a released row goes, in pixels (the iPhone's `BoardSwipe.destination`): back to 0, to the one block at its start, or to the blocks at its end. `dp` is the pixels of one dp. */
internal fun swipeDestination(start: Float, offset: Float, velocity: Float, unit: Float, trailing: Float, dp: Float): Float {
    val travel = offset - start
    if (start < 0 && (travel > 18 * dp || (travel > 4 * dp && velocity > 180 * dp))) return 0f
    if (start > 0 && (travel < -18 * dp || (travel < -4 * dp && velocity < -180 * dp))) return 0f
    if (offset > unit / 2) return unit
    if (offset < -55 * dp) return -trailing
    return 0f
}

/**
 * The swipe of the board list and of the inbox, the iPhone's (`BoardConversationSwipeRow`, `RevealSwipeRow`): the row keeps its width and slides over its blocks. To the right is one
 * thing (`leading`): a tap on its block, or a swipe past two thirds of the row, lets the row slide away, fades the word and closes the band towards its middle, and then does it. To the
 * left are the blocks to tap. A block shows only where the row has left. `enabled` is false while the page saves: a row that is still there when the page is free again was kept
 * (the save failed, or the list keeps finished rows) and comes back as it was. With `revealed` the caller keeps which row is open, one at a time.
 */
@Composable
internal fun SwipeRevealRow(
    leading: RevealAction?, trailing: List<RevealAction>, enabled: Boolean,
    revealed: Boolean? = null, onReveal: (Boolean) -> Unit = {},
    content: @Composable (close: () -> Boolean) -> Unit,
) {
    val density = LocalDensity.current
    val dp = density.density
    val unit = 84 * dp
    val trailingWidth = unit * trailing.size
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    val collapse = remember { Animatable(0f) } // 0 open, 1 closed
    val word = remember { Animatable(1f) }
    var width by remember { mutableIntStateOf(0) }
    var height by remember { mutableIntStateOf(0) }
    var start by remember { mutableFloatStateOf(0f) }
    var drag by remember { mutableStateOf<Float?>(null) }
    var completing by remember { mutableStateOf(false) }
    val free = rememberUpdatedState(enabled)
    val displayed = drag ?: offset.value
    val armed = completing || (leading != null && start >= 0f && width > 0 && displayed >= width * 2f / 3f)
    // Past two thirds the word goes to the row's edge: letting go there does it.
    val toEdge by animateFloatAsState(if (armed) 1f else 0f, tween(200, easing = LinearOutSlowInEasing), label = "swipe-armed")

    fun close(): Boolean {
        val wasOpen = displayed != 0f
        if (wasOpen && !completing) {
            onReveal(false)
            scope.launch { offset.animateTo(0f, tween(220, easing = FastOutSlowInEasing)) }
        }
        return wasOpen
    }
    suspend fun finish() {
        val action = leading ?: return
        if (completing || !free.value || width == 0) return
        completing = true
        onReveal(false)
        offset.animateTo(width.toFloat(), tween(180, easing = LinearOutSlowInEasing))
        word.animateTo(0f, tween(60, easing = LinearOutSlowInEasing))
        collapse.animateTo(1f, tween(220, easing = FastOutSlowInEasing))
        action.perform()
        withTimeoutOrNull(1_000) { snapshotFlow { free.value }.first { !it } }
        snapshotFlow { free.value }.first { it }
        offset.snapTo(0f); collapse.snapTo(0f); word.snapTo(1f)
        completing = false
    }
    LaunchedEffect(revealed) {
        if (revealed == false && !completing && drag == null && offset.value != 0f) offset.animateTo(0f, tween(220, easing = FastOutSlowInEasing))
    }
    // A row that can no longer be used (the computer went away, the row is saving) closes, as the iPhone's do (`onChange(of: enabled)`).
    LaunchedEffect(enabled) {
        if (!enabled && !completing && offset.value != 0f) {
            drag = null
            onReveal(false)
            offset.animateTo(0f, tween(220, easing = FastOutSlowInEasing))
        }
    }

    Box(Modifier.fillMaxWidth()
        .then(if (completing && height > 0) Modifier.height(with(density) { (height * (1f - collapse.value)).toDp() }) else Modifier)
        .clipToBounds().onSizeChanged { width = it.width }
        .semantics {
            if (enabled) customActions = (listOfNotNull(leading) + trailing).filter { it.enabled }.map { action ->
                CustomAccessibilityAction(action.title) { action.perform(); true }
            }
        }) {
        if (displayed > 0f && leading != null) Box(Modifier.matchParentSize()) {
            Box(Modifier.fillMaxHeight().width(with(density) { displayed.toDp() }).clipToBounds()) {
                Box(Modifier.fillMaxHeight().wrapContentWidth(Alignment.Start, unbounded = true)
                    .width(with(density) { max(unit, displayed).toDp() })
                    .background(leading.color.copy(alpha = 1f - collapse.value))
                    .clickable(enabled = enabled && !completing) { scope.launch { finish() } }) {
                    RevealBlock(leading, Modifier.width(84.dp).fillMaxHeight()
                        .offset { IntOffset((toEdge * max(0f, displayed - unit)).roundToInt(), 0) }.alpha(word.value))
                }
            }
        } else if (displayed < 0f) Box(Modifier.matchParentSize()) {
            Box(Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(with(density) { (-displayed).toDp() }).clipToBounds()) {
                Row(Modifier.fillMaxHeight().wrapContentWidth(Alignment.End, unbounded = true)) {
                    trailing.forEach { action ->
                        RevealBlock(action, Modifier.width(84.dp).fillMaxHeight().background(action.color)
                            .clickable(enabled = enabled && action.enabled) { close(); action.perform() })
                    }
                }
            }
        }
        // The row keeps its own height while its band closes over it, towards the middle.
        Box(Modifier.wrapContentHeight(Alignment.CenterVertically, unbounded = true)
            .onSizeChanged { if (!completing) height = it.height }
            .offset { IntOffset(displayed.roundToInt(), 0) }
            .draggable(rememberDraggableState { delta ->
                val next = ((drag ?: offset.value) + delta).coerceIn(-trailingWidth, if (leading != null) width.toFloat() else 0f)
                drag = next
                if (abs(next) > 8 * dp && revealed == false) onReveal(true)
            }, Orientation.Horizontal, enabled = enabled && !completing && (leading != null || trailing.isNotEmpty()),
                onDragStarted = { offset.stop(); start = offset.value; drag = offset.value },
                onDragStopped = { velocity ->
                    val end = drag ?: offset.value
                    offset.snapTo(end); drag = null
                    if (leading != null && start >= 0f && width > 0 && end >= width * 2f / 3f) scope.launch { finish() }
                    else {
                        val target = swipeDestination(start, end, velocity, unit, trailingWidth, dp)
                        onReveal(target != 0f)
                        offset.animateTo(target, tween(220, easing = FastOutSlowInEasing))
                    }
                })) { content(::close) }
    }
}

@Composable
private fun RevealBlock(action: RevealAction, modifier: Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        InboxGlyph(action.icon, 22, Color.White)
        Spacer(Modifier.height(4.dp))
        Text(action.title, fontSize = 14.sp, lineHeight = 18.sp, color = Color.White, maxLines = 1)
    }
}
