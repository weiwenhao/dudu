package app.dudu.android.data

/** How long a message stays (the iPhone's `DuduToastMessage.Kind.duration`): 3 s for a success, 5 s for information and warnings, 7 s for an error. */
enum class ToastKind(val millis: Long) { Success(1_000), Information(5_000), Warning(5_000), Error(7_000) }

/**
 * A message at the top of the page (the iPhone's `DuduToastMessage`). `text` is the Chinese key of the app's words (written with `word` so that `scripts/sync-android-words.mjs` finds it),
 * shown in the app's language; `literal` text (the plugin's own words) is shown as it is. `{0}`, `{1}`… take `args`.
 */
data class Toast(
    val id: Long, val text: String, val kind: ToastKind, val literal: Boolean = false, val args: List<String> = emptyList(),
    /** Override the default duration for short connection errors. */
    val millis: Long? = null,
    /** Whether it has the ✕ at its end (the iPhone's `showsClose`); a toast that goes within a second has none. */
    val showsClose: Boolean = true,
    /** A failure code of the connection (`problemText`): its words are said in the app's language, and `text` is not used. */
    val problem: String? = null,
)

/** A key of the app's words written outside a composable (a toast the model raises); the screen says it in the app's language. */
fun word(key: String) = key
