package app.dudu.android.ui

import android.content.ClipData
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.DuduViewModel
import app.dudu.android.data.ApiFailure
import app.dudu.android.data.DuduLog
import app.dudu.android.data.json
import app.dudu.android.data.nullableString
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** A file the agent delivered, being read for its preview (the iPhone's `TurnFilePreview`): one at a time; the copy on the phone is deleted when the preview closes. */
@Stable
internal class TurnFilePreview {
    var file by mutableStateOf<File?>(null)
    var type by mutableStateOf("")
    var loadingId by mutableStateOf<String?>(null)
    var failure by mutableStateOf<String?>(null)
    private var job: Job? = null

    fun open(delivered: JSONObject, sessionId: String, model: DuduViewModel, context: android.content.Context,
        scope: kotlinx.coroutines.CoroutineScope) {
        if (loadingId != null) return
        val id = delivered.optString("id", delivered.optString("path"))
        loadingId = id
        failure = null
        job = scope.launch {
            try {
                val params = json("id" to sessionId, "kind" to delivered.optString("kind"), "seq" to delivered.optLong("seq")).apply {
                    if (delivered.has("callSeq") && !delivered.isNull("callSeq")) put("callSeq", delivered.getLong("callSeq"))
                    if (delivered.has("index") && !delivered.isNull("index")) put("index", delivered.getInt("index"))
                }
                val payload = model.attachment("session.file", params)
                val written = withContext(Dispatchers.IO) { writePreview(context, payload) }
                if (loadingId == id) {
                    type = payload.nullableString("mediaType")?.substringBefore(';') ?: mediaType(written.name)
                    file = written
                    DuduLog.record("files.preview.open")
                } else withContext(Dispatchers.IO) { written.parentFile?.deleteRecursively() }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("files.preview.fail", error)
                if (loadingId == id) failure = (error as? ApiFailure)?.code ?: "UNREADABLE"
            } finally { if (loadingId == id) { loadingId = null; job = null } }
        }
    }

    fun close() {
        val shown = file
        file = null
        shown?.parentFile?.let { folder -> Thread { folder.deleteRecursively() }.start() }
    }

    fun cancelPending() { job?.cancel(); job = null; loadingId = null }
}

/** Copies a run of the app left behind are removed before the first preview of this one (the iPhone's `ConversationFileStorage.initialized`). */
@Volatile private var previewsCleared = false

/** The iPhone's `ConversationFileStorage.write`: the bytes (at most 16 MB) under their own name, an extension from the media type when the name has none, in a folder of their own. */
private fun writePreview(context: android.content.Context, payload: JSONObject): File {
    val root = File(context.cacheDir, "conversation-previews")
    if (!previewsCleared) { root.deleteRecursively(); previewsCleared = true }
    val encoded = payload.optString("dataBase64")
    if (encoded.length > 24 * 1024 * 1024) throw ApiFailure("PROTOCOL_ERROR")
    val bytes = Base64.decode(encoded, Base64.DEFAULT)
    if (bytes.size > 16 * 1024 * 1024) throw ApiFailure("PROTOCOL_ERROR")
    var name = File(payload.optString("name").replace('\\', '/')).name.takeUnless { it.isEmpty() || it == "." || it == ".." } ?: "file"
    if (!name.contains('.')) android.webkit.MimeTypeMap.getSingleton()
        .getExtensionFromMimeType(payload.optString("mediaType").substringBefore(';'))?.let { name += ".$it" }
    val folder = File(root, UUID.randomUUID().toString())
    folder.mkdirs()
    val file = File(folder, name)
    try { file.writeBytes(bytes) } catch (error: Exception) { folder.deleteRecursively(); throw error }
    return file
}

/**
 * One delivered file (the iPhone's `DeliveredFileRow`): the file glyph (22 dp, a spinner while it is read), its name in 15 sp medium ink over its description in 12 sp, the chevron; 14 dp at the
 * sides, 12 dp above and below, at least 52 dp. A tap previews it in the app; a long press offers 复制路径.
 */
@Composable
internal fun DeliveredFileRow(file: JSONObject, title: String, preview: TurnFilePreview, sessionId: String, connected: Boolean,
    model: DuduViewModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboard.current
    val press = remember { PressPoint() }
    var menu by remember { mutableStateOf(false) }
    val id = file.optString("id", file.optString("path"))
    val enabled = preview.loadingId == null && connected
    Box {
        Row(Modifier.fillMaxWidth().notePress(press)
            .combinedClickable(enabled = enabled, onClick = { preview.open(file, sessionId, model, context, scope) },
                onLongClick = { menu = true })
            .heightIn(min = 52.dp).padding(horizontal = 14.dp, vertical = 12.dp).testTag("chat-file-$id"),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) {
                if (preview.loadingId == id) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = chatSecondary())
                else Glyph(DuduGlyphs.file, size = 22, tint = chatSecondary())
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(title, fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium, color = chatInk(),
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                file.nullableString("description")?.let {
                    Text(it, fontSize = 12.sp, lineHeight = 16.sp, color = chatSecondary(), maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
            }
            Glyph(DuduGlyphs.right, size = 14, tint = chatTertiary())
        }
        DropdownMenu(menu, { menu = false }, offset = press.menuOffset()) {
            DropdownMenuItem(text = { Text(w("复制路径")) }, leadingIcon = { Glyph(DuduGlyphs.copy, size = 18) }, onClick = {
                menu = false
                scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("path", file.optString("path")))) }
            })
        }
    }
}

/** The name a delivered file is listed under: its path when another file of the list has the same name (the iPhone's `TurnFileCollection.displayNames`). */
internal fun deliveredTitle(file: JSONObject, files: List<JSONObject>): String =
    if (files.count { it.optString("name") == file.optString("name") } > 1) file.optString("path") else file.optString("name")

/** The preview of a list of delivered files (the iPhone's `TurnFilePreviewPresentation`): what could not be read, red, 14 sp, under the list, and the file being shown. */
@Composable
internal fun TurnFilePreviewPresentation(preview: TurnFilePreview) {
    preview.failure?.let { Text(if (it == "UNREADABLE") w("无法读取这个文件") else problemText(it), fontSize = 14.sp, color = chatError()) }
    preview.file?.let { shown -> FilePreviewPage(shown, preview.type) { preview.close() } }
    // The list going away ends its preview and removes the copy on the phone.
    DisposableEffect(preview) { onDispose { preview.cancelPending(); preview.close() } }
}

/**
 * A delivered file in the app (the iPhone shows it in Quick Look): a picture fitted to the page, a video in the player, a PDF page under page, text as it is; anything else by its kind's mark and its
 * name, for 下载 or 更多 to take it elsewhere.
 */
@Composable
internal fun FilePreviewPage(file: File, type: String, dismiss: () -> Unit) {
    val kind = remember(file, type) {
        when {
            type.startsWith("image/") -> "image"
            type.startsWith("video/") || app.dudu.android.media.VideoPreviewStorage.isVideo(file.name) -> "video"
            type == "application/pdf" || file.name.endsWith(".pdf", true) -> "pdf"
            else -> "other"
        }
    }
    MediaPreviewPage(file, type, dismiss) {
        when (kind) {
            "video" -> VideoPlayer(file)
            "image" -> {
                val picture by produceState<ImageBitmap?>(null, file) { value = withContext(Dispatchers.IO) { decodeBounded(file, 2048) } }
                picture?.let { Image(it, file.name, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) } ?: OtherFile(file)
            }
            "pdf" -> PdfPages(file)
            else -> {
                val text by produceState<String?>(null, file) { value = withContext(Dispatchers.IO) { readableText(file, type) } }
                text?.let { body ->
                    SelectionContainer {
                        Text(body, Modifier.fillMaxSize().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())
                            .padding(18.dp), fontSize = 13.sp, lineHeight = 21.sp, fontFamily = FontFamily.Monospace, softWrap = false,
                            color = Color(0xFF0F1115))
                    }
                } ?: OtherFile(file)
            }
        }
    }
}

@Composable
private fun OtherFile(file: File) {
    Column(Modifier.padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        FileTypeIcon(file.name, 64)
        Text(file.name, fontSize = 17.sp, fontWeight = FontWeight.Medium, color = Color(0xFF0F1115), textAlign = TextAlign.Center,
            maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}

/** Every page of a PDF, as wide as the screen, drawn as it comes into view (the renderer reads one page at a time). */
@Composable
private fun PdfPages(file: File) {
    // Read, and then the renderer or null when the file could not be opened as a PDF.
    val renderer by produceState<Pair<Boolean, PdfRenderer?>>(false to null, file) {
        val opened = withContext(Dispatchers.IO) {
            runCatching { PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)) }.getOrNull()
        }
        value = true to opened
        awaitDispose { opened?.close() }
    }
    val lock = remember { Mutex() }
    val width = with(LocalDensity.current) { LocalConfiguration.current.screenWidthDp.dp.roundToPx() }
    if (!renderer.first) return
    val document = renderer.second ?: return OtherFile(file)
    LazyColumn(Modifier.fillMaxSize().background(Color(0xFFF2F2F7)), contentPadding = PaddingValues(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items((0 until document.pageCount).toList()) { index ->
            val page by produceState<ImageBitmap?>(null, document, index) {
                value = withContext(Dispatchers.IO) {
                    lock.withLock {
                        runCatching {
                            document.openPage(index).use { source ->
                                val scale = width.toFloat() / source.width
                                val bitmap = Bitmap.createBitmap(width, maxOf(1, (source.height * scale).toInt()), Bitmap.Config.ARGB_8888)
                                bitmap.eraseColor(android.graphics.Color.WHITE)
                                source.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                bitmap.asImageBitmap()
                            }
                        }.getOrNull()
                    }
                }
            }
            page?.let { Image(it, null, Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth) }
                ?: Box(Modifier.fillMaxWidth().aspectRatio(.77f).background(Color.White).alpha(.6f))
        }
    }
}

private fun decodeBounded(file: File, maxDimension: Int): ImageBitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxDimension) sample *= 2
    BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
}.getOrNull()

/** The file as text, when it is text: a text type, or bytes that read as UTF-8 with no NUL in them. At most 1 MB of it is shown. */
private fun readableText(file: File, type: String): String? {
    val bytes = file.readBytes()
    val textual = type.startsWith("text/") || type in setOf("application/json", "application/xml", "application/javascript",
        "application/x-sh", "application/yaml", "application/toml")
    if (!textual && bytes.take(8192).any { it == 0.toByte() }) return null
    val decoded = runCatching { Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString() }.getOrNull()
        ?: if (textual) String(bytes, Charsets.UTF_8) else return null
    return decoded.take(1024 * 1024)
}
