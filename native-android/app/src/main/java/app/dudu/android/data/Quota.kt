package app.dudu.android.data

import org.json.JSONObject
import kotlin.math.roundToInt

data class QuotaWindow(val label: String, val used: Int, val resetsAt: Long?) {
    val left get() = 100 - used
    val level get() = when {
        used >= 90 -> 2
        used >= 70 -> 1
        else -> 0
    }
}

data class QuotaProvider(
    val id: String, val agent: String?, val name: String, val plan: String?, val until: Long?,
    val amount: String?, val windows: List<QuotaWindow>,
)

fun quotaProviders(quota: JSONObject?): List<QuotaProvider> = quota?.rows("providers").orEmpty().mapNotNull { source ->
    val balance = source.optString("kind") == "balance"
    val amount = if (balance) source.rows("balance").mapNotNull { it.nullableString("text") }
        .takeIf { it.isNotEmpty() }?.joinToString(" + ") else null
    val windows = if (balance) emptyList() else source.rows("windows").mapNotNull window@{ window ->
        val used = window.optDouble("used").takeIf(Double::isFinite) ?: return@window null
        QuotaWindow(window.optString("label"), (used.coerceIn(0.0, 1.0) * 100).roundToInt(),
            if (window.isNull("resetsAt")) null else window.optLong("resetsAt"))
    }
    if (amount == null && windows.isEmpty()) return@mapNotNull null
    QuotaProvider(source.optString("id"), source.nullableString("agent"), source.optString("name"),
        source.nullableString("plan"), if (source.isNull("until")) null else source.optLong("until"), amount, windows)
}
