package app.dudu.android.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import app.dudu.android.data.SettingsWords
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The words of the settings layouts (`data/SettingsPages.kt`) in the language of the screen: `Wording.kt`'s dictionary for code that draws nothing, and so cannot call the composable
 * `w`. The Chinese is the key and is said as it is in Chinese; any other language gets the English (the singular one for a count of 1), or the key when there is none.
 */
internal class PageWords(private val locale: Locale) : SettingsWords {
    override val inEnglish = locale.language != "zh"

    override fun w(key: String, vararg values: Any?, count: Int?): String {
        val template = if (!inEnglish) key else if (count == 1) englishSingular[key] ?: english[key] ?: key else english[key] ?: key
        // One pass over the template: a value that itself holds braces is never substituted again.
        return Regex("\\{(\\d+)}").replace(template) { match -> values.getOrNull(match.groupValues[1].toInt())?.toString() ?: match.value }
    }

    override fun time(at: Long): String =
        SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMdHHmm"), locale).format(Date(at))
}

@Composable
internal fun rememberPageWords(): SettingsWords {
    val locale = appLocale()
    return remember(locale) { PageWords(locale) }
}
