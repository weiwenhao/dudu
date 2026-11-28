@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/** How many pictures a message takes, and files (the iPhone's `PhotoAttachments.maximumPhotoCount`, `FileAttachments.maximumCount`). */
internal const val PHOTO_LIMIT = 9
internal const val FILE_LIMIT = 5

/** What the + sheet adds (the iPhone's `PendingSheetAction`): pictures or a video from the phone's photos (the system photo picker, as the iPhone's photo library), or a file. */
enum class AttachmentKind { Photos, Video, File }

/**
 * The system's photo picker for pictures, as the iPhone's `photosPicker(… matching: .images)`: as many as `remaining` at once (one picker for one, the multiple one for more, which needs at least
 * two). It hands back what was chosen, nothing when the person cancels.
 */
@Composable
internal fun rememberPhotoLibrary(remaining: Int, picked: (List<Uri>) -> Unit): () -> Unit {
    val latest by rememberUpdatedState(picked)
    val one = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> uri?.let { latest(listOf(it)) } }
    val count = remaining.coerceIn(2, PHOTO_LIMIT)
    val contract = remember(count) { ActivityResultContracts.PickMultipleVisualMedia(count) }
    val many = rememberLauncherForActivityResult(contract) { uris -> if (uris.isNotEmpty()) latest(uris) }
    return {
        val request = PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
        if (remaining > 1) many.launch(request) else one.launch(request)
    }
}

@Composable
fun rememberAttachmentPicker(state: UiState, model: DuduViewModel, actions: Actions): (AttachmentKind) -> Unit {
    val context = LocalContext.current
    var target by remember { mutableStateOf<Pair<String, String>?>(null) }
    // Pictures are made into the message's own JPEGs; a video and a file go up to the computer (the iPhone sends a file as a file, a picture among them).
    fun load(uris: List<Uri>, pictures: Boolean) {
        val session = state.session ?: return
        if (target != (state.computerId to session.id)) return
        target = null
        if (uris.isEmpty()) return
        DuduLog.record(if (pictures) "photos.select" else "files.select", counts = mapOf("attachmentCount" to uris.size.toLong()))
        actions.run {
            var images = state.attachments.count { it.has("dataBase64") }
            var files = state.attachments.count { it.has("receiptId") }
            var rejected = 0
            try { for (uri in uris) {
                val metadata = withContext(Dispatchers.IO) {
                    var name = "file"
                    var bytes: Long? = null
                    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
                        if (it.moveToFirst()) {
                            name = it.getString(0).replace(Regex("[/\\\\]"), "_").take(160)
                            if (!it.isNull(1)) bytes = it.getLong(1).takeIf { size -> size >= 0 }
                        }
                    }
                    Triple(name, context.contentResolver.getType(uri).orEmpty(), bytes)
                }
                if (model.state.value.session?.watchId != session.watchId) return@run
                val (name, mime, length) = metadata
                if (pictures) {
                    // As the iPhone's `PhotoAttachments.load`: what is past the limit or cannot be read is left out, and a warning says so at the end.
                    if (images >= PHOTO_LIMIT || !mime.startsWith("image/")) { rejected++; continue }
                    val bytes = try { withContext(Dispatchers.IO) { preparePhoto(context.contentResolver, uri) } }
                        catch (error: Exception) {
                            if (error is kotlinx.coroutines.CancellationException) throw error
                            DuduLog.failure("photos.prepare.fail", error)
                            rejected++; continue
                        }
                    val base64 = withContext(Dispatchers.Default) { Base64.encodeToString(bytes, Base64.NO_WRAP) }
                    if (model.state.value.session?.watchId == session.watchId) {
                        images++
                        model.attach(json("dataBase64" to base64, "mimeType" to "image/jpeg",
                            "name" to "${name.substringBeforeLast('.')}.jpg"))
                    }
                } else {
                    if (++files > FILE_LIMIT) throw ApiFailure("LIMIT_EXCEEDED")
                    val receipt = model.upload(uri, name, length, session.id)
                    // A video is kept on the phone under its receipt too, so that its tile in the box and the message on its way show its first frame and open the player (the iPhone's
                    // `uploaded.video`). A copy that fails leaves the file staged as a file.
                    if (app.dudu.android.media.VideoPreviewStorage.isVideo(name)) try {
                        app.dudu.android.media.VideoPreviewStorage.store(context, app.dudu.android.media.VideoKey(state.computerId, session.id,
                            receipt.getString("receiptId")), name, uri)
                    } catch (error: Exception) {
                        if (error is kotlinx.coroutines.CancellationException) throw error
                        DuduLog.failure("video.stage.fail", error)
                    }
                    if (model.state.value.session?.watchId == session.watchId)
                        model.attach(json("receiptId" to receipt.getString("receiptId"), "name" to receipt.getString("name")))
                }
            } } finally {
                if (rejected > 0 && model.state.value.session?.watchId == session.watchId) model.toast(word("部分照片未添加"), ToastKind.Warning)
            }
        }
    }
    val photos = rememberPhotoLibrary(PHOTO_LIMIT - state.attachments.count { it.has("dataBase64") }) { load(it, pictures = true) }
    val video = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> load(listOfNotNull(uri), pictures = false) }
    val file = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> load(listOfNotNull(uri), pictures = false) }
    return { kind ->
        state.session?.let {
            target = state.computerId to it.id
            when (kind) {
                AttachmentKind.Photos -> { DuduLog.record("photos.open"); photos() }
                AttachmentKind.Video -> { DuduLog.record("videos.open"); video.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)) }
                AttachmentKind.File -> { DuduLog.record("files.open"); file.launch(arrayOf("*/*")) }
            }
        }
    }
}

internal fun preparePhoto(resolver: android.content.ContentResolver, uri: Uri): ByteArray {
    val bitmap = if (android.os.Build.VERSION.SDK_INT >= 28) {
        android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(resolver, uri)) { decoder, info, _ ->
            decoder.allocator = android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE
            val scale = minOf(1f, 2048f / maxOf(info.size.width, info.size.height))
            decoder.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
        }
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val stream = resolver.openInputStream(uri) ?: throw ApiFailure("NOT_FOUND")
        stream.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw ApiFailure("INVALID_PARAMS")
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 2048) sample *= 2
        val decoded = resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null,
            BitmapFactory.Options().apply { inSampleSize = sample }) } ?: throw ApiFailure("INVALID_PARAMS")
        val orientation = resolver.openInputStream(uri)?.use { android.media.ExifInterface(it).getAttributeInt(
            android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL) }
        val transform = android.graphics.Matrix().apply {
            when (orientation) {
                2 -> setScale(-1f, 1f)
                3 -> setRotate(180f)
                4 -> setScale(1f, -1f)
                5 -> { setRotate(90f); postScale(-1f, 1f) }
                6 -> setRotate(90f)
                7 -> { setRotate(270f); postScale(-1f, 1f) }
                8 -> setRotate(270f)
            }
        }
        android.graphics.Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, transform, true).also {
            if (it !== decoded) decoded.recycle()
        }
    }
    // Same preparation as iOS: bounded pixels and JPEG quality, rather than rejecting the original photo's byte size.
    return try {
        ByteArrayOutputStream().use { output ->
            if (!bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 82, output)) throw ApiFailure("INVALID_PARAMS")
            output.toByteArray()
        }
    } finally { bitmap.recycle() }
}

@Composable
fun StagedAttachments(state: UiState, model: DuduViewModel) {
    AttachmentTiles(state.attachments, !state.sending, state.session?.let { state.computerId to it.id }, remove = model::removeAttachment)
}

@Composable
fun AttachmentTiles(files: List<JSONObject>, enabled: Boolean, videoOwner: Pair<String, String>? = null, add: (() -> Unit)? = null, remove: (Int) -> Unit) {
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var playing by remember { mutableStateOf<java.io.File?>(null) }
    val context = LocalContext.current
    LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        itemsIndexed(files) { index, file ->
            val encoded = file.nullableString("dataBase64")
            Box(Modifier.size(76.dp)) {
                // A staged video kept on the phone (`VideoPreviewStorage`, under its receipt): its first frame with a 28 dp play mark, a tap plays it (the iPhone's `FileAttachmentTile`).
                val video by produceState<app.dudu.android.media.PreparedVideo?>(null, videoOwner, file.nullableString("receiptId")) {
                    val receipt = file.nullableString("receiptId")
                    value = if (videoOwner == null || receipt == null || !app.dudu.android.media.VideoPreviewStorage.isVideo(file.optString("name"))) null
                        else app.dudu.android.media.VideoPreviewStorage.load(context,
                            app.dudu.android.media.VideoKey(videoOwner.first, videoOwner.second, receipt))
                }
                Surface(Modifier.fillMaxSize(), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                    if (encoded != null) InlineImage(encoded,
                        Modifier.fillMaxSize().clickable { preview = file }, ContentScale.Crop)
                    else if (video != null) VideoThumbnail(video, Modifier.fillMaxSize().clickable(onClickLabel = file.optString("name")) {
                        playing = video?.file
                    }, playSize = 28)
                    else Column(Modifier.fillMaxSize().padding(horizontal = 7.dp),
                        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        Glyph(DuduGlyphs.file, size = 24, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(6.dp))
                        Text(file.optString("name"), fontSize = 11.sp, maxLines = 2,
                            textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
                    }
                }
                IconButton(onClick = { remove(index) }, enabled = enabled,
                    modifier = Modifier.align(Alignment.TopEnd).size(40.dp)) {
                    Box(Modifier.size(22.dp).background(Color.Black.copy(alpha = .55f), CircleShape), contentAlignment = Alignment.Center) {
                        Glyph(DuduGlyphs.close, w("移除文件"), 11, Color.White)
                    }
                }
            }
        }
        // A tile of the same size that adds more (the iPhone's new-issue `addPhotoTile`, shown until there are nine).
        if (add != null) item {
            val shape = RoundedCornerShape(16.dp)
            val label = w("添加图片")
            Box(Modifier.size(76.dp).clip(shape).background(MaterialTheme.colorScheme.surfaceContainer, shape).border(.5.dp, chatBorder(), shape)
                .clickable(enabled = enabled, onClickLabel = label, onClick = add), contentAlignment = Alignment.Center) {
                Glyph(DuduGlyphs.plus, label, 24, MaterialTheme.colorScheme.onSurface)
            }
        }
    }
    preview?.let { file -> PhotoPreview(file.optString("dataBase64"), file.optString("name", "image.jpg")) { preview = null } }
    playing?.let { file -> VideoFullScreenPreview(file) { playing = null } }
}

@Composable
fun InlineImage(encoded: String, modifier: Modifier = Modifier, scale: ContentScale = ContentScale.Fit) {
    val bitmap = rememberAttachmentImage(encoded)
    bitmap?.let { Image(it, stringResource(R.string.image), modifier, contentScale = scale) }
}

@Composable
internal fun rememberAttachmentImage(encoded: String, maxDimension: Int = 1600): ImageBitmap? {
    val bitmap by produceState<ImageBitmap?>(null, encoded, maxDimension) {
        value = decodeAttachmentImage(encoded, maxDimension)
    }
    return bitmap
}

private suspend fun decodeAttachmentImage(encoded: String, maxDimension: Int = 1600): ImageBitmap? = withContext(Dispatchers.Default) {
    runCatching {
        require(encoded.length <= 24 * 1024 * 1024)
        val bytes = Base64.decode(encoded, Base64.DEFAULT)
        val info = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, info)
        require(info.outWidth in 1..50000 && info.outHeight in 1..50000)
        var sample = 1
        while (maxOf(info.outWidth, info.outHeight) / sample > maxDimension) sample *= 2
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
    }.getOrNull()
}

internal fun conversationMarkdownPicture(sessionId: String, seq: Long?, model: DuduViewModel, waitsForSequence: Boolean = false):
    (@Composable (String, String) -> Unit)? {
    if (seq == null && !waitsForSequence) return null
    return { words, source ->
        key(seq, source) {
            Attachment(sessionId, json("kind" to "image", "name" to words, "source" to source), seq, model, AttachmentImageStyle.Message)
        }
    }
}

@Composable
fun Attachment(sessionId: String, file: JSONObject, seq: Long?, model: DuduViewModel,
    imageStyle: AttachmentImageStyle = AttachmentImageStyle.Inline) {
    if (file.optString("kind") == "file") {
        Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Glyph(DuduGlyphs.file, size = 18); Spacer(Modifier.width(8.dp)); Text(file.optString("name"))
            }
        }
        return
    }
    val actions = rememberActions()
    val context = LocalContext.current
    var payload by remember { mutableStateOf<JSONObject?>(null) }
    var thumbnail by remember { mutableStateOf<ImageBitmap?>(null) }
    var expanded by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf<JSONObject?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri ->
        val result = exporting
        if (uri != null && result != null) actions.run {
            if (file.optString("kind") == "video") {
                val type = model.video(json("id" to sessionId, "attachmentId" to file.getString("id"),
                    "seq" to if (file.has("seq")) file.getLong("seq") else seq), uri)
                runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW)
                    .setDataAndType(uri, type).addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)) }
            } else withContext(Dispatchers.IO) {
                val encoded = result.optString("dataBase64", result.optString("data"))
                require(encoded.length <= 24 * 1024 * 1024)
                val bytes = Base64.decode(encoded, Base64.DEFAULT)
                require(bytes.size <= 16 * 1024 * 1024)
                context.contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: throw ApiFailure("NOT_FOUND")
            }
            exporting = null
        }
    }
    val image = file.optString("kind") == "image" || file.has("source")
    val sourceSequence = if (file.isNull("seq")) seq else file.optLong("seq")
    val waitsForSequence = file.has("source") && sourceSequence == null
    fun read() = actions.run {
        val result = if (file.has("dataBase64")) file else model.attachment(
            if (file.optString("kind") in listOf("produced", "uploaded", "mentioned")) "session.file" else "session.attachment",
            json("id" to sessionId).apply {
                if (file.has("source")) put("source", file.getString("source"))
                else if (file.has("id")) put("attachmentId", file.getString("id"))
                if (file.optString("kind") == "video") put("kind", "video")
                if (file.optString("kind") in listOf("produced", "uploaded", "mentioned")) {
                    put("kind", file.getString("kind")); remove("attachmentId")
                }
                sourceSequence?.let { put("seq", it) }
                file.optLong("callSeq", -1).takeIf { it >= 0 }?.let { put("callSeq", it) }
                file.optInt("index", -1).takeIf { it >= 0 }?.let { put("index", it) }
            })
        thumbnail = decodeAttachmentImage(result.optString("dataBase64", result.optString("data"))) ?: throw ApiFailure("NOT_FOUND")
        payload = result
    }
    if (image) {
        LaunchedEffect(file.toString(), sourceSequence, actions.revision) {
            if (!waitsForSequence) read()
        }
        val imageModifier = when (imageStyle) {
            AttachmentImageStyle.Inline -> Modifier.fillMaxWidth().heightIn(min = 72.dp, max = 240.dp)
            // As wide as the iPhone's: 56 % of the screen (its conversation's scroll view), at most 260, whatever holds it.
            AttachmentImageStyle.Message -> Modifier.width(minOf(LocalConfiguration.current.screenWidthDp * .56f, 260f).dp).aspectRatio(.8f)
            AttachmentImageStyle.Queue -> Modifier.size(30.dp)
            // Inside a bubble (the pictures of an @ line): the bubble sets the width, 4:5 as a picture sent alone.
            AttachmentImageStyle.Bubble, AttachmentImageStyle.BubbleFirst -> Modifier.fillMaxWidth().aspectRatio(.8f)
        }
        val shape = when (imageStyle) {
            AttachmentImageStyle.Inline -> RoundedCornerShape(12.dp)
            AttachmentImageStyle.Message -> RoundedCornerShape(18.dp)
            AttachmentImageStyle.Queue -> RoundedCornerShape(6.dp)
            // Inset 8 dp in the bubble: the first picture's top corners follow the bubble's (24 - 8), the rest are the inner corners (the iPhone's `GroupAtBubble`).
            AttachmentImageStyle.BubbleFirst -> RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 10.dp, bottomStart = 10.dp)
            AttachmentImageStyle.Bubble -> RoundedCornerShape(10.dp)
        }
        val loading = waitsForSequence || actions.busy || (thumbnail == null && actions.error == null)
        Box(imageModifier.clip(shape)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(enabled = !loading) { if (payload != null) expanded = true else read() }, contentAlignment = Alignment.Center) {
            thumbnail?.let { Image(it, stringResource(R.string.image),
                if (imageStyle == AttachmentImageStyle.Inline) Modifier.fillMaxWidth().heightIn(max = 240.dp) else Modifier.matchParentSize(),
                contentScale = if (imageStyle == AttachmentImageStyle.Inline) ContentScale.Fit else ContentScale.Crop) }
            if (loading) CircularProgressIndicator(Modifier.size(if (imageStyle == AttachmentImageStyle.Queue) 14.dp else 20.dp), strokeWidth = 2.dp)
            if (imageStyle == AttachmentImageStyle.Queue) {
                if (payload == null && !loading) Glyph(DuduGlyphs.image, file.optString("name"), 16, chatTertiary())
            } else if (actions.error != null) TextButton(onClick = { read() }) { Text(stringResource(R.string.retry)) }
        }
    } else {
    val open: () -> Unit = { actions.run {
        if (file.optString("kind") == "video") {
            exporting = json(); launcher.launch(file.optString("name", "video.mp4")); return@run
        }
        if (payload == null) {
            payload = model.attachment(if (file.optString("kind") == "video") "session.attachment" else "session.file",
                json("id" to sessionId).apply {
                    if (file.optString("kind") == "video") {
                        put("attachmentId", file.getString("id")); put("kind", "video")
                    } else {
                        put("kind", file.getString("kind"))
                        if (file.has("callSeq")) put("callSeq", file.get("callSeq"))
                        if (file.has("index")) put("index", file.get("index"))
                    }
                    put("seq", if (file.has("seq")) file.getLong("seq") else seq)
                })
        }
        exporting = payload; launcher.launch(file.optString("name", "file"))
    } }
    if (file.optString("kind") == "presented") Line(file.optString("name"), file.nullableString("description"),
        icon = DuduGlyphs.file, enabled = !actions.busy, action = open)
    else OutlinedButton(onClick = open, enabled = !actions.busy) {
        Glyph(if (actions.error == null) DuduGlyphs.file else DuduGlyphs.completeContext, size = 18)
        Spacer(Modifier.width(8.dp)); Text(file.optString("name", w("文件")))
    }
    }
    if (expanded) payload?.let { data ->
        PhotoPreview(data.optString("dataBase64", data.optString("data")), file.optString("name", "image.png")) { expanded = false }
    }
    if (imageStyle != AttachmentImageStyle.Queue)
        actions.error?.let { Text(problemText(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
}

enum class AttachmentImageStyle { Inline, Message, Queue, Bubble, BubbleFirst }
