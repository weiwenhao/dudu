package app.dudu.android.ui

import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.IconButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import app.dudu.android.data.ApiFailure
import app.dudu.android.data.DuduLog
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private enum class PhotoSave { Idle, Saving, Saved, Failed }

/** PhotoAttachmentFullScreenPreview: black canvas, close left, download right;
 * controls disappear while zoomed or being dragged down. Android keeps its own
 * document picker for saving, and all decoding/writing stays off the UI thread.
 */
@Composable
internal fun PhotoPreview(encoded: String, name: String, dismiss: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val bitmap = rememberAttachmentImage(encoded, maxDimension = 2048)
    var feedback by remember(encoded) { mutableStateOf(PhotoSave.Idle) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("image/*")) { uri ->
        if (uri == null) feedback = PhotoSave.Idle
        else scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    require(encoded.length <= 24 * 1024 * 1024)
                    val bytes = Base64.decode(encoded, Base64.DEFAULT)
                    require(bytes.size <= 16 * 1024 * 1024)
                    context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw ApiFailure("NOT_FOUND")
                }
                feedback = PhotoSave.Saved
                DuduLog.record("photos.preview.save", state = "success")
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                feedback = PhotoSave.Failed
                DuduLog.failure("photos.preview.save.failed", error)
            }
        }
    }
    LaunchedEffect(feedback) {
        if (feedback == PhotoSave.Saved || feedback == PhotoSave.Failed) { delay(3000); feedback = PhotoSave.Idle }
    }
    var zoom by remember(encoded) { mutableFloatStateOf(1f) }
    var pan by remember(encoded) { mutableStateOf(Offset.Zero) }
    var drag by remember(encoded) { mutableFloatStateOf(0f) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    val density = LocalDensity.current
    val dismissDistance = with(density) { 125.dp.toPx() }
    val dismissVelocity = with(density) { 850.dp.toPx() }
    val transform = rememberTransformableState { zoomChange, panChange, _ ->
        zoom = (zoom * zoomChange).coerceIn(1f, 4f)
        if (zoom > 1.02f) drag = 0f
        if (zoom <= 1.02f) { zoom = 1f; pan = Offset.Zero }
        else bitmap?.let { image ->
            val fit = minOf(viewport.width.toFloat() / image.width, viewport.height.toFloat() / image.height)
            val limitX = ((image.width * fit * zoom - viewport.width) / 2).coerceAtLeast(0f)
            val limitY = ((image.height * fit * zoom - viewport.height) / 2).coerceAtLeast(0f)
            pan = (pan + panChange).let { Offset(it.x.coerceIn(-limitX, limitX), it.y.coerceIn(-limitY, limitY)) }
        }
    }
    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val view = LocalView.current
        DisposableEffect(view) {
            (view.parent as? DialogWindowProvider)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = false
                    isAppearanceLightNavigationBars = false
                }
            }
            DuduLog.record("photos.preview.open")
            onDispose { DuduLog.record("photos.preview.close") }
        }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            Box(Modifier.fillMaxSize().onSizeChanged { viewport = it }
                .transformable(transform, canPan = { zoom > 1.02f })
                .draggable(rememberDraggableState { drag = (drag + it).coerceAtLeast(0f) }, Orientation.Vertical,
                    enabled = zoom <= 1.02f, onDragStopped = { velocity ->
                        if (drag > dismissDistance || velocity > dismissVelocity) dismiss() else drag = 0f
                    })
                .pointerInput(encoded) { detectTapGestures(onTap = { if (zoom > 1.02f) { zoom = 1f; pan = Offset.Zero; drag = 0f } }) },
                contentAlignment = Alignment.Center) {
                bitmap?.let { image ->
                    Image(image, w("图片"), Modifier.fillMaxSize().graphicsLayer {
                        val shrink = (1 - drag / (1700 * density.density)).coerceAtLeast(.82f)
                        scaleX = zoom * shrink; scaleY = zoom * shrink
                        translationX = pan.x; translationY = pan.y + drag
                    }, contentScale = ContentScale.Fit)
                } ?: Glyph(DuduGlyphs.camera, size = 36, tint = Color.White.copy(alpha = .8f))
            }
            if (zoom <= 1.02f && drag == 0f) Row(Modifier.align(Alignment.TopCenter).fillMaxWidth()
                .statusBarsPadding().padding(horizontal = 14.dp).padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(dismiss, Modifier.size(44.dp).background(Color.White.copy(alpha = .15f), CircleShape)) {
                    BarGlyph(DuduGlyphs.close, w("关闭照片预览"), Color.White)
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = {
                    feedback = PhotoSave.Saving
                    save.launch(name.replace('\\', '/').substringAfterLast('/').ifBlank { "image.jpg" })
                }, enabled = bitmap != null && feedback != PhotoSave.Saving,
                    modifier = Modifier.size(44.dp).background(Color.White.copy(alpha = .15f), CircleShape)) {
                    when (feedback) {
                        PhotoSave.Saving -> DeliveryLoadingMark(18, Color.White)
                        PhotoSave.Saved -> Glyph(MenuGlyphs.photoSaved, w("下载"), 18, Color.White)
                        PhotoSave.Failed -> {
                            val label = w("下载")
                            // The bare exclamation from the iPhone's save feedback, with no alert circle.
                            Canvas(Modifier.size(18.dp).semantics { contentDescription = label }) {
                                drawLine(Color.White, Offset(size.width / 2, size.height * .18f),
                                    Offset(size.width / 2, size.height * .57f), 1.5.dp.toPx(), StrokeCap.Round)
                                drawCircle(Color.White, 1.dp.toPx(), Offset(size.width / 2, size.height * .78f))
                            }
                        }
                        PhotoSave.Idle -> Glyph(MenuGlyphs.photoDownload, w("下载"), 18, Color.White)
                    }
                }
            }
        }
    }
}
