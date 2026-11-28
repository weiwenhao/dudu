package app.dudu.android.ui

import android.content.Intent
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.VideoView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.content.FileProvider
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.dudu.android.DuduViewModel
import app.dudu.android.data.ApiFailure
import app.dudu.android.data.DuduLog
import app.dudu.android.data.json
import app.dudu.android.data.nullableString
import app.dudu.android.media.PreparedVideo
import app.dudu.android.media.VideoKey
import app.dudu.android.media.VideoPreviewStorage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * A video's tile (the iPhone's `VideoThumbnail`): its first frame over the chat panel's grey, cropped to fill, and the play mark in the middle, a black circle at 45 % with a white
 * triangle 38 % of its size.
 */
@Composable
internal fun VideoThumbnail(video: PreparedVideo?, modifier: Modifier = Modifier, playSize: Int = 44) {
    val picture = remember(video) { video?.thumbnail?.asImageBitmap() }
    Box(modifier.background(chatPanel()), contentAlignment = Alignment.Center) {
        picture?.let { Image(it, null, Modifier.matchParentSize(), contentScale = ContentScale.Crop) }
        Box(Modifier.size(playSize.dp).background(Color.Black.copy(alpha = .45f), CircleShape), contentAlignment = Alignment.Center) {
            // SF Symbols' play.fill at 38 % of the circle, nudged right by 2.5 % as the iPhone does.
            Canvas(Modifier.size((playSize * .38f).dp).offset(x = (playSize * .025f).dp)) {
                val path = Path().apply {
                    moveTo(size.width * .12f, size.height * .06f)
                    lineTo(size.width * .96f, size.height * .5f)
                    lineTo(size.width * .12f, size.height * .94f)
                    close()
                }
                drawPath(path, Color.White, style = Fill)
                drawPath(path, Color.White, style = Stroke(size.width * .1f, join = StrokeJoin.Round, cap = StrokeCap.Round))
            }
        }
    }
}

/**
 * A video of the owner's own message (the iPhone's `ConversationVideoThumbnail`): 56 % of the screen wide, at most 260 dp, 4:5, 18 dp corners. It is read and kept on the phone as soon as it is
 * shown while the computer is connected, then its first frame is its picture; a tap opens it in the app's own player (`VideoFullScreenPreview`).
 */
@Composable
internal fun ConversationVideoThumbnail(attachment: JSONObject, computer: String, sessionId: String, seq: Long?, connected: Boolean,
    model: DuduViewModel, pending: Boolean = false) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val id = attachment.nullableString("id")
    val key = id?.let { VideoKey(computer, sessionId, it) }
    var video by remember(key) { mutableStateOf<PreparedVideo?>(null) }
    var loading by remember(key) { mutableStateOf(false) }
    var failure by remember(key) { mutableStateOf<String?>(null) }
    var previewing by remember(key) { mutableStateOf(false) }
    val attachmentSeq = if (attachment.has("seq") && !attachment.isNull("seq")) attachment.optLong("seq") else seq
    var request by remember(key) { mutableIntStateOf(0) }
    suspend fun load(open: Boolean) {
        if (key == null) return
        val mine = ++request
        loading = true
        failure = null
        try {
            val cached = VideoPreviewStorage.load(context, key)
            if (cached != null) video = cached
            else {
                if (!connected || (attachmentSeq == null && !key.attachment.startsWith("queue:"))) return
                val params = json("id" to sessionId, "attachmentId" to key.attachment).apply { attachmentSeq?.let { put("seq", it) } }
                video = VideoPreviewStorage.store(context, key, attachment.optString("name")) { file -> model.downloadVideo(params, file) }
                DuduLog.record("video.download.complete")
            }
            if (open && mine == request) previewing = true
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            DuduLog.failure("video.download.fail", error)
            if (mine == request) failure = (error as? ApiFailure)?.code ?: "UNREADABLE"
        } finally { if (mine == request) loading = false }
    }
    LaunchedEffect(key, connected) { video = null; load(open = false) }
    val shape = RoundedCornerShape(18.dp)
    val width = minOf(LocalConfiguration.current.screenWidthDp * .56f, 260f).dp
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box {
            Box(Modifier.width(width).aspectRatio(.8f).clip(shape)
                .clickable(enabled = !loading && (video != null || connected), onClickLabel = attachment.optString("name")) {
                    if (video != null) previewing = true else scope.launch { load(open = true) }
                }.testTag("chat-video"), contentAlignment = Alignment.Center) {
                VideoThumbnail(video, Modifier.matchParentSize())
                if (loading) Box(Modifier.size(44.dp).background(Color.Black.copy(alpha = .6f), CircleShape), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
                }
            }
            if (pending) Box(Modifier.align(Alignment.BottomStart).offset(x = (-25).dp, y = (-6).dp)) {
                DeliveryLoadingMark(15, Color(0xFFA6CFE7))
            }
        }
        failure?.let { Text(if (it == "UNREADABLE") w("无法读取这个文件") else problemText(it), fontSize = 14.sp, color = chatError()) }
    }
    if (previewing) video?.let { VideoFullScreenPreview(it.file) { previewing = false } }
}

/**
 * The full-screen player (the iPhone's `VideoFullScreenPreview`): a white page in light colours, ✕ on the left, 下载 and 更多 (the system's share sheet) together on the right, the system's
 * player with its own controls under them; it plays at once and stops when the app goes to the background. Android's buttons have no glass: a white circle and capsule with a hairline.
 */
@Composable
internal fun VideoFullScreenPreview(file: File, dismiss: () -> Unit) {
    MediaPreviewPage(file, mediaType(file.name, "video/mp4"), dismiss) { VideoPlayer(file) }
}

/** The system's player (`VideoView` and its `MediaController`), the video fitted in the middle; paused when the app leaves the front, stopped when it closes. */
@Composable
internal fun VideoPlayer(file: File, modifier: Modifier = Modifier) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var player by remember { mutableStateOf<VideoView?>(null) }
    DisposableEffect(lifecycle, player) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_PAUSE) player?.pause() }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    AndroidView(factory = { context ->
        FrameLayout(context).apply {
            setBackgroundColor(android.graphics.Color.WHITE)
            val view = VideoView(context)
            addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT, Gravity.CENTER))
            val controls = MediaController(context)
            controls.setAnchorView(this)
            view.setMediaController(controls)
            view.setOnPreparedListener { view.start(); controls.show() }
            view.setOnErrorListener { _, what, _ -> DuduLog.record("video.play.fail", "warn", code = "MEDIA_$what".takeIf { what in -2000..2000 }); false }
            view.setVideoPath(file.path)
            player = view
        }
    }, modifier.fillMaxSize(), onRelease = { player?.stopPlayback(); player = null })
}

private enum class MediaSave { Idle, Saving, Saved, Failed }

/**
 * The page the player and a delivered file's preview share: white, light, ✕ on the left in a 44 dp circle (its 20 dp glyph), 下载 and 更多 (21 dp, 48 x 44 each) in one capsule on the right, 14 dp
 * from the sides and 10 dp under the status bar, 20 dp over what is shown. 下载 saves a copy where the person chooses and then shows ✓ (or ! when it failed); 更多 hands the file to the share sheet.
 */
@Composable
internal fun MediaPreviewPage(file: File, type: String, dismiss: () -> Unit, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var saving by remember(file) { mutableStateOf(MediaSave.Idle) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(type)) { uri ->
        if (uri == null) saving = MediaSave.Idle
        else scope.launch {
            saving = try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri)?.use { output -> file.inputStream().use { it.copyTo(output) } }
                        ?: throw ApiFailure("NOT_FOUND")
                }
                DuduLog.record("media.preview.save", state = "success")
                MediaSave.Saved
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("media.preview.save.failed", error)
                MediaSave.Failed
            }
        }
    }
    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val view = LocalView.current
        DisposableEffect(view) {
            (view.parent as? DialogWindowProvider)?.window?.let { window ->
                WindowCompat.getInsetsController(window, view).apply {
                    isAppearanceLightStatusBars = true
                    isAppearanceLightNavigationBars = true
                }
            }
            DuduLog.record("media.preview.open")
            onDispose { DuduLog.record("media.preview.close") }
        }
        val ink = Color(0xFF18191B)
        val edge = BorderStroke(.75.dp, Color(0xFFEDEDF0))
        Column(Modifier.fillMaxSize().background(Color.White).systemBarsPadding(), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp).padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(onClick = dismiss, modifier = Modifier.size(44.dp).testTag("media-close"), shape = CircleShape, color = Color.White,
                    shadowElevation = 3.dp, border = edge) {
                    Box(contentAlignment = Alignment.Center) { BarGlyph(DuduGlyphs.close, w("关闭"), ink) }
                }
                Spacer(Modifier.weight(1f))
                Surface(shape = RoundedCornerShape(22.dp), color = Color.White, shadowElevation = 3.dp, border = edge) {
                    Row {
                        Box(Modifier.size(48.dp, 44.dp).clickable(enabled = saving != MediaSave.Saving) {
                            saving = MediaSave.Saving
                            save.launch(file.name)
                        }.testTag("media-save"), contentAlignment = Alignment.Center) {
                            when (saving) {
                                MediaSave.Saving -> DeliveryLoadingMark(18, ink)
                                MediaSave.Saved -> Glyph(MenuGlyphs.photoSaved, w("下载"), 21, ink)
                                MediaSave.Failed -> {
                                    val label = w("下载")
                                    // The bare exclamation of the iPhone's save feedback.
                                    Canvas(Modifier.size(21.dp).semantics { contentDescription = label }) {
                                        drawLine(ink, Offset(size.width / 2, size.height * .18f), Offset(size.width / 2, size.height * .57f),
                                            1.8.dp.toPx(), StrokeCap.Round)
                                        drawCircle(ink, 1.2.dp.toPx(), Offset(size.width / 2, size.height * .78f))
                                    }
                                }
                                MediaSave.Idle -> Glyph(MenuGlyphs.photoDownload, w("下载"), 21, ink)
                            }
                        }
                        Box(Modifier.size(48.dp, 44.dp).clickable { share(context, file, type) }.testTag("media-share"),
                            contentAlignment = Alignment.Center) { Glyph(DuduGlyphs.options, w("更多"), 21, ink) }
                    }
                }
            }
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) { content() }
        }
    }
}

/** The system's share sheet for a file of the app's cache, readable by the app chosen for this share only. */
private fun share(context: android.content.Context, file: File, type: String) {
    try {
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        val send = Intent(Intent.ACTION_SEND).setType(type).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        DuduLog.record("media.preview.share")
    } catch (error: Exception) {
        DuduLog.failure("media.preview.share.fail", error)
    }
}

/** A file's media type from its name, as the system knows it. */
internal fun mediaType(name: String, fallback: String = "application/octet-stream") =
    android.webkit.MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase()) ?: fallback
