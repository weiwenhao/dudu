package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties

/** Reserve the same 44dp while an expanded composer panel grows upward.
 * A Popup owns its full touch region; drawing children outside a 44dp layout
 * would make the expanded rows visible but untappable on Android.
 */
@Composable
internal fun UpwardPanel(expanded: Boolean, dismiss: () -> Unit, modifier: Modifier = Modifier,
    content: @Composable () -> Unit) {
    var anchor by remember { mutableStateOf(IntRect.Zero) }
    val density = LocalDensity.current
    Box(modifier.height(44.dp).onGloballyPositioned { anchor = it.boundsInWindow().roundToIntRect() }) {
        if (!expanded || anchor.width == 0) content()
    }
    BackHandler(expanded, dismiss)
    if (expanded && anchor.width > 0) {
        val position = remember(anchor) { object : PopupPositionProvider {
            override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize,
                layoutDirection: LayoutDirection, popupContentSize: IntSize): IntOffset = IntOffset(
                anchor.left.coerceIn(0, (windowSize.width - popupContentSize.width).coerceAtLeast(0)),
                (anchor.bottom - popupContentSize.height).coerceAtLeast(0))
        } }
        Popup(popupPositionProvider = position, onDismissRequest = dismiss,
            properties = PopupProperties(focusable = false, dismissOnClickOutside = false, clippingEnabled = false)) {
            Box(Modifier.width(with(density) { anchor.width.toDp() })) { content() }
        }
    }
}
