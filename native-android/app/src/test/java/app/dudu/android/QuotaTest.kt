package app.dudu.android

import app.dudu.android.data.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class QuotaTest {
    @Test fun windowsUseRemainingPercentAndTheSameRoundedThresholdsAsThePhone() {
        val source = json("providers" to JSONArray(listOf(json("id" to "claude", "name" to "Claude",
            "windows" to JSONArray(listOf(.2, .695, .9, 1.2).map { json("label" to "5 小时", "used" to it) })))))
        val windows = quotaProviders(source).single().windows
        assertEquals(listOf(80, 30, 10, 0), windows.map { it.left })
        assertEquals(listOf(0, 1, 2, 2), windows.map { it.level })
    }

    @Test fun balanceBlocksKeepNegativeAndMultipleCurrenciesAndEmptySourcesAreOmitted() {
        val source = json("providers" to JSONArray(listOf(
            json("id" to "account", "name" to "DeepSeek", "kind" to "balance",
                "balance" to JSONArray(listOf(json("text" to "-¥0.08")))),
            json("id" to "api", "name" to "DeepSeek", "kind" to "balance",
                "balance" to JSONArray(listOf(json("text" to "¥735.29"), json("text" to "$0.00")))),
            json("id" to "empty", "name" to "Unavailable", "windows" to JSONArray()),
        )))
        val blocks = quotaProviders(source)
        assertEquals(listOf("account", "api"), blocks.map { it.id })
        assertEquals(listOf("-¥0.08", "¥735.29 + $0.00"), blocks.map { it.amount })
        assertTrue(blocks.all { it.windows.isEmpty() })
    }
}
