package app.dudu.android.media

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/** A video of a conversation on this phone: its file and the picture of its first frame (the iPhone's `PreparedVideo`). */
class PreparedVideo(val file: File, val thumbnail: Bitmap?)

/** Which video: the computer, the conversation and the attachment's id (the iPhone's `ConversationVideoKey`). */
data class VideoKey(val computer: String, val session: String, val attachment: String)

/**
 * The videos the in-app player shows, as the iPhone's `VideoPreviewStorage` keeps them: one folder a computer, one a video, in the app's cache (never backed up, and the system may clear it), at
 * most 128 MB of them on disk and eight with their pictures in memory. Every read and write is off the main thread; forgetting a computer removes its folder.
 */
object VideoPreviewStorage {
    private val lock = Mutex()
    private val prepared = LinkedHashMap<VideoKey, PreparedVideo>()
    private val removed = mutableSetOf<String>()
    private const val LIMIT = 128L * 1024 * 1024

    fun isVideo(name: String) = name.substringAfterLast('.', "").lowercase() in setOf("mp4", "m4v", "mov")

    fun root(context: Context) = File(context.cacheDir, "conversation-videos")

    suspend fun load(context: Context, key: VideoKey): PreparedVideo? = withContext(Dispatchers.IO) {
        lock.withLock {
            if (key.computer in removed) return@withContext null
            prepared[key]?.takeIf { it.file.exists() }?.let { remember(key, it); return@withContext it }
        }
        val folder = folder(context, key)
        val file = folder.listFiles()?.singleOrNull { it.isFile && isVideo(it.name) && it.length() > 0 } ?: return@withContext null
        val value = prepare(file)
        lock.withLock {
            if (key.computer in removed) null else value.also { remember(key, it) }
        }
    }

    /** Writes the video through `write` (a download, or a copy of a picked file) and keeps it; a failed write leaves nothing behind. */
    suspend fun store(context: Context, key: VideoKey, name: String, write: suspend (File) -> Unit): PreparedVideo {
        val clean = File(name.replace('\\', '/')).name.takeIf { isVideo(it) } ?: throw IllegalArgumentException("Not a video")
        val folder = folder(context, key)
        val file = File(folder, clean)
        withContext(Dispatchers.IO) { folder.deleteRecursively(); folder.mkdirs() }
        try {
            write(file)
            return withContext(Dispatchers.IO) {
                require(file.length() > 0)
                val value = prepare(file)
                lock.withLock {
                    if (key.computer in removed) throw IllegalStateException("Computer removed")
                    remember(key, value)
                }
                prune(context, file)
                value
            }
        } catch (error: Throwable) {
            withContext(Dispatchers.IO + kotlinx.coroutines.NonCancellable) {
                lock.withLock { if (prepared[key]?.file != file) folder.deleteRecursively() }
            }
            throw error
        }
    }

    /** A video picked for the box, kept under the id of its receipt so that the message on its way shows it at once (the iPhone keeps a staged video the same way). */
    suspend fun store(context: Context, key: VideoKey, name: String, source: Uri): PreparedVideo = store(context, key, name) { file ->
        withContext(Dispatchers.IO) {
            context.contentResolver.openInputStream(source)?.use { input -> file.outputStream().use { input.copyTo(it) } }
                ?: throw IllegalStateException("Unreadable")
        }
    }

    suspend fun remove(context: Context, computer: String) = withContext(Dispatchers.IO) {
        lock.withLock {
            removed.add(computer)
            prepared.keys.removeAll { it.computer == computer }
        }
        File(root(context), digest(computer)).deleteRecursively()
    }

    private fun remember(key: VideoKey, value: PreparedVideo) {
        prepared.remove(key)
        prepared[key] = value
        while (prepared.size > 8) prepared.remove(prepared.keys.first())
    }

    private fun folder(context: Context, key: VideoKey) =
        File(File(root(context), digest(key.computer)), digest(key.session + "\u0000" + key.attachment))

    private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
        .joinToString("") { "%02x".format(it) }

    /** The first frame, at most 800 px on its longer side (the iPhone's `AVAssetImageGenerator.maximumSize`). */
    private fun prepare(file: File): PreparedVideo {
        val retriever = MediaMetadataRetriever()
        val frame = try {
            retriever.setDataSource(file.path)
            if (Build.VERSION.SDK_INT >= 27) retriever.getScaledFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 800, 800)
            else retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)?.let { bitmap ->
                val scale = minOf(1f, 800f / maxOf(bitmap.width, bitmap.height))
                if (scale >= 1f) bitmap else Bitmap.createScaledBitmap(bitmap, maxOf(1, (bitmap.width * scale).toInt()),
                    maxOf(1, (bitmap.height * scale).toInt()), true).also { if (it !== bitmap) bitmap.recycle() }
            }
        } catch (_: Exception) { null } finally { runCatching { retriever.release() } }
        return PreparedVideo(file, frame)
    }

    /** Newest first, the one just written always kept: what is over 128 MB goes, folder and all. */
    private suspend fun prune(context: Context, current: File) {
        val files = root(context).walkTopDown().filter { it.isFile }.toList()
            .sortedWith(compareBy<File> { it != current }.thenByDescending { it.lastModified() })
        var total = 0L
        for (file in files) {
            total += file.length()
            if (total > LIMIT && file != current) {
                file.parentFile?.deleteRecursively()
                lock.withLock { prepared.entries.removeAll { it.value.file == file } }
            }
        }
    }
}
