package app.dudu.android

import android.content.Context
import android.os.Build
import android.util.Log
import app.dudu.android.data.DuduLog
import org.json.JSONException
import java.io.File
import java.util.concurrent.Executors

/**
 * Where the app's diagnostics go (`DuduLog`): `no_backup/diagnostics/events.jsonl` in the app's own storage, 1 MB a file and five files kept (every request is a line, so about twice the iPhone's room), and logcat under the
 * tag `Dudu`. Written on one background thread. A crash leaves `crash-<time>.txt` (the classes thrown and the trace; the message too, except a JSON one, which can carry a piece of
 * what was being read). `npm run logs:pull -- --android` copies the folder off a phone that runs a debug build.
 */
object Diagnostics {
    private const val MAX_BYTES = 1024 * 1024
    private const val KEPT = 5
    private val writer = Executors.newSingleThreadExecutor { work -> Thread(work, "dudu-diagnostics").apply { isDaemon = true } }
    @Volatile private var started = false

    fun start(context: Context) {
        if (started) return
        started = true
        val directory = File(context.noBackupFilesDir, "diagnostics")
        DuduLog.sink = { line, level ->
            Log.println(when (level) { "error" -> Log.ERROR; "warn" -> Log.WARN; else -> Log.INFO }, "Dudu", line)
            writer.execute { runCatching { append(directory, line) } }
        }
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { crash(directory, thread, error) }
            previous?.uncaughtException(thread, error)
        }
        val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0) }.getOrNull()
        DuduLog.record("app.launch", state = version?.versionName?.filter { it.isLetterOrDigit() || it in "._-" }?.take(32),
            counts = mapOf("sdk" to Build.VERSION.SDK_INT.toLong()), detail = Build.MODEL.filter { it.isLetterOrDigit() || it in "._-" }.take(40))
    }

    private fun append(directory: File, line: String) {
        directory.mkdirs()
        val file = File(directory, "events.jsonl")
        if (file.length() + line.length + 1 > MAX_BYTES) {
            File(directory, "events.${KEPT - 1}.jsonl").delete()
            for (index in KEPT - 2 downTo 1) File(directory, "events.$index.jsonl").renameTo(File(directory, "events.${index + 1}.jsonl"))
            file.renameTo(File(directory, "events.1.jsonl"))
        }
        file.appendText(line + "\n")
    }

    /** Synchronously, on the dying thread: the process is about to end. */
    private fun crash(directory: File, thread: Thread, error: Throwable) {
        directory.mkdirs()
        val text = StringBuilder("time ${System.currentTimeMillis()}\nthread ${thread.name}\n")
        var cause: Throwable? = error
        var depth = 0
        while (cause != null && depth < 6) {
            val message = if (cause is JSONException) "" else cause.message.orEmpty().take(200)
            text.append(if (depth == 0) "thrown " else "caused by ").append(cause.javaClass.name).append(if (message.isEmpty()) "" else ": $message").append('\n')
            cause.stackTrace.take(40).forEach { text.append("  at ").append(it.className).append('.').append(it.methodName).append('(').append(it.fileName).append(':').append(it.lineNumber).append(")\n") }
            cause = cause.cause
            depth += 1
        }
        File(directory, "crash-${System.currentTimeMillis()}.txt").writeText(text.toString())
        directory.listFiles { file -> file.name.startsWith("crash-") }?.sortedByDescending { it.name }?.drop(3)?.forEach { it.delete() }
        Log.e("Dudu", "app.crash ${DuduLog.describe(error)}")
        File(directory, "events.jsonl").appendText("{\"source\":\"native-android\",\"timestamp\":${System.currentTimeMillis()},\"level\":\"error\",\"event\":\"app.crash\",\"detail\":\"${DuduLog.describe(error)}\"}\n")
    }
}
