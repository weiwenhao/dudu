package app.dudu.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.data.Toast
import app.dudu.android.data.ToastKind
import kotlinx.coroutines.delay

/** What a screen needs to show the current message and close it; provided at the root so that a sheet (its own window) shows it over itself too. */
class ToastHost(val toast: Toast?, val dismiss: (Long) -> Unit)

val LocalToastHost = compositionLocalOf<ToastHost?> { null }

/**
 * The message at the top of the page, the iPhone's `DuduToast`: a capsule (26 dp corners, at most 360 dp wide) on the page colour with a hairline and a soft shadow, the kind's filled
 * circle mark, the words (15 sp medium) and ✕ in a 44 dp place; it slides down from the top and goes by itself after the kind's time.
 */
@Composable
internal fun DuduToastOverlay(host: ToastHost?, top: Dp) {
    val toast = host?.toast
    var shown by remember { mutableStateOf<Toast?>(null) }
    if (toast != null) shown = toast
    LaunchedEffect(toast?.id) {
        val current = toast ?: return@LaunchedEffect
        delay(current.kind.millis)
        host.dismiss(current.id)
    }
    Box(Modifier.fillMaxWidth().padding(top = top, start = 16.dp, end = 16.dp), contentAlignment = Alignment.TopCenter) {
        AnimatedVisibility(toast != null, enter = slideInVertically(tween(250)) { -it } + fadeIn(tween(250)),
            exit = slideOutVertically(tween(250)) { -it } + fadeOut(tween(250))) {
            shown?.let { message -> ToastCapsule(message) { host?.dismiss(message.id) } }
        }
    }
}

@Composable
private fun ToastCapsule(toast: Toast, dismiss: () -> Unit) {
    val shape = RoundedCornerShape(26.dp)
    val ink = MaterialTheme.colorScheme.onSurface
    val error = Color(0xFFEC1313)
    var text = if (toast.literal) toast.text else w(toast.text)
    toast.args.forEachIndexed { index, value -> text = text.replace("{$index}", value) }
    Row(Modifier.widthIn(max = 360.dp).shadow(8.dp, shape, ambientColor = Color.Black.copy(alpha = .08f), spotColor = Color.Black.copy(alpha = .08f))
        .background(MaterialTheme.colorScheme.background.copy(alpha = .97f), shape).border(.5.dp, ink.copy(alpha = .08f), shape)
        .padding(start = 16.dp, end = 4.dp, top = 5.dp, bottom = 5.dp).semantics { liveRegion = LiveRegionMode.Polite }.testTag("feedback-toast"),
        horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(20.dp).background(if (toast.kind == ToastKind.Error) error else ink, CircleShape), contentAlignment = Alignment.Center) {
            when (toast.kind) {
                ToastKind.Success -> Glyph(DuduGlyphs.check, size = 13, tint = MaterialTheme.colorScheme.background)
                ToastKind.Error -> Glyph(DuduGlyphs.close, size = 11, tint = Color.White)
                ToastKind.Information -> Text("i", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.background)
                ToastKind.Warning -> Text("!", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.background)
            }
        }
        Text(text, Modifier.weight(1f, fill = false), fontSize = 15.sp, fontWeight = FontWeight.Medium, color = ink)
        IconButton(onClick = dismiss, modifier = Modifier.size(44.dp).testTag("feedback-dismiss")) {
            Glyph(DuduGlyphs.close, w("关闭提示"), 13, chatSecondary())
        }
    }
}
