@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
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
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.window.Dialog
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream

@Composable
fun rememberAttachmentPicker(state: UiState, model: DuduViewModel, actions: Actions): (Array<String>) -> Unit {
    val context = LocalContext.current
    var target by remember { mutableStateOf<Pair<String, String>?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        val session = state.session ?: return@rememberLauncherForActivityResult
        if (target != (state.computerId to session.id)) return@rememberLauncherForActivityResult
        target = null
        actions.run {
            var images = state.attachments.count { it.has("dataBase64") }
            var files = state.attachments.count { it.has("receiptId") }
            for (uri in uris) {
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
                if (mime.startsWith("image/")) {
                    if (++images > 9) throw ApiFailure("LIMIT_EXCEEDED")
                    val bytes = withContext(Dispatchers.IO) {
                        preparePhoto(context.contentResolver, uri)
                    }
                    val base64 = withContext(Dispatchers.Default) { Base64.encodeToString(bytes, Base64.NO_WRAP) }
                    if (model.state.value.session?.watchId == session.watchId)
                        model.attach(json("dataBase64" to base64, "mimeType" to "image/jpeg",
                            "name" to "${name.substringBeforeLast('.')}.jpg"))
                } else {
                    if (++files > 5) throw ApiFailure("LIMIT_EXCEEDED")
                    val receipt = model.upload(uri, name, length, session.id)
                    if (model.state.value.session?.watchId == session.watchId)
                        model.attach(json("receiptId" to receipt.getString("receiptId"), "name" to receipt.getString("name")))
                }
            }
        }
    }
    return { types -> state.session?.let { target = state.computerId to it.id; picker.launch(types) } }
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
    AttachmentTiles(state.attachments, !state.sending, model::removeAttachment)
}

@Composable
fun AttachmentTiles(files: List<JSONObject>, enabled: Boolean, remove: (Int) -> Unit) {
    var preview by remember { mutableStateOf<String?>(null) }
    LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        itemsIndexed(files) { index, file ->
            val encoded = file.nullableString("dataBase64")
            Box(Modifier.size(76.dp)) {
                Surface(Modifier.fillMaxSize(), shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                    if (encoded != null) InlineImage(encoded,
                        Modifier.fillMaxSize().clickable { preview = encoded }, ContentScale.Crop)
                    else Column(Modifier.fillMaxSize().padding(horizontal = 7.dp),
                        verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        Glyph(R.drawable.ic_file, size = 24, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(6.dp))
                        Text(file.optString("name"), fontSize = 11.sp, maxLines = 2,
                            textAlign = TextAlign.Center, overflow = TextOverflow.Ellipsis)
                    }
                }
                IconButton(onClick = { remove(index) }, enabled = enabled,
                    modifier = Modifier.align(Alignment.TopEnd).size(40.dp)) {
                    Box(Modifier.size(22.dp).background(Color.Black.copy(alpha = .55f), CircleShape), contentAlignment = Alignment.Center) {
                        Glyph(R.drawable.ic_x, w("移除文件"), 11, Color.White)
                    }
                }
            }
        }
    }
    preview?.let { encoded -> Dialog(onDismissRequest = { preview = null }) {
        Surface(shape = RoundedCornerShape(16.dp)) {
            Column {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    IconButton(onClick = { preview = null }) { Glyph(R.drawable.ic_x, stringResource(R.string.close), 20) }
                }
                InlineImage(encoded, Modifier.fillMaxWidth().heightIn(max = 550.dp))
            }
        }
    } }
}

@Composable
fun InlineImage(encoded: String, modifier: Modifier = Modifier, scale: ContentScale = ContentScale.Fit) {
    val bitmap by produceState<ImageBitmap?>(null, encoded) {
        value = withContext(Dispatchers.Default) {
            runCatching {
                require(encoded.length <= 24 * 1024 * 1024)
                val bytes = Base64.decode(encoded, Base64.DEFAULT)
                val info = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, info)
                require(info.outWidth in 1..50000 && info.outHeight in 1..50000)
                var sample = 1
                while (maxOf(info.outWidth, info.outHeight) / sample > 1600) sample *= 2
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
            }.getOrNull()
        }
    }
    bitmap?.let { Image(it, stringResource(R.string.image), modifier, contentScale = scale) }
}

@Composable
fun Attachment(sessionId: String, file: JSONObject, seq: Long?, model: DuduViewModel) {
    if (file.optString("kind") == "file") {
        Surface(shape = RoundedCornerShape(10.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
            Row(Modifier.padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                Glyph(R.drawable.ic_file, size = 18); Spacer(Modifier.width(8.dp)); Text(file.optString("name"))
            }
        }
        return
    }
    val actions = rememberActions()
    val context = LocalContext.current
    var payload by remember { mutableStateOf<JSONObject?>(null) }
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
    fun read() = actions.run {
        payload = if (file.has("dataBase64")) file else model.attachment(
            if (file.optString("kind") in listOf("produced", "uploaded", "mentioned")) "session.file" else "session.attachment",
            json("id" to sessionId).apply {
                if (file.has("source")) put("source", file.getString("source"))
                else if (file.has("id")) put("attachmentId", file.getString("id"))
                if (file.optString("kind") == "video") put("kind", "video")
                if (file.optString("kind") in listOf("produced", "uploaded", "mentioned")) {
                    put("kind", file.getString("kind")); remove("attachmentId")
                }
                (if (file.has("seq")) file.optLong("seq") else seq)?.let { put("seq", it) }
                file.optLong("callSeq", -1).takeIf { it >= 0 }?.let { put("callSeq", it) }
                file.optInt("index", -1).takeIf { it >= 0 }?.let { put("index", it) }
            })
    }
    if (image) {
        LaunchedEffect(file.toString(), actions.revision) { read() }
        Box(Modifier.fillMaxWidth().heightIn(min = 72.dp, max = 240.dp)
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(12.dp))
            .clickable { if (payload != null) expanded = true else read() }, contentAlignment = Alignment.Center) {
            payload?.let { InlineImage(it.optString("dataBase64", it.optString("data")), Modifier.fillMaxWidth().heightIn(max = 240.dp)) }
            if (actions.busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            if (actions.error != null) TextButton(onClick = { read() }) { Text(stringResource(R.string.retry)) }
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
        icon = R.drawable.ic_file, enabled = !actions.busy, action = open)
    else OutlinedButton(onClick = open, enabled = !actions.busy) {
        Glyph(if (actions.error == null) R.drawable.ic_file else R.drawable.ic_refresh_cw, size = 18)
        Spacer(Modifier.width(8.dp)); Text(file.optString("name", w("文件")))
    }
    }
    if (expanded) Dialog(onDismissRequest = { expanded = false }) {
        Surface(shape = RoundedCornerShape(16.dp)) {
            Column {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    IconButton(onClick = { exporting = payload; launcher.launch(file.optString("name", "image.png")) }) { Glyph(R.drawable.ic_download, w("下载"), 20) }
                    IconButton(onClick = { expanded = false }) { Glyph(R.drawable.ic_x, stringResource(R.string.close), 20) }
                }
                payload?.let { InlineImage(it.optString("dataBase64", it.optString("data")), Modifier.fillMaxWidth().heightIn(max = 550.dp)) }
            }
        }
    }
    actions.error?.let { Text(problemText(it), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error) }
}
