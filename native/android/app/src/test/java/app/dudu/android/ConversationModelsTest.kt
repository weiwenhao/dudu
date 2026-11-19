package app.dudu.android

import app.dudu.android.data.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class ConversationModelsTest {
    @Test fun duduAndAnAssignedAgentUseTheirOwnProviderCatalogs() {
        val catalog = json("providers" to JSONArray(listOf(json("id" to "deepseek", "modelIds" to JSONArray(listOf("ds"))),
            json("id" to "codex", "modelIds" to JSONArray(listOf("gpt"))))),
            "models" to JSONArray(listOf(json("id" to "ds"), json("id" to "gpt"))))
        assertEquals(listOf("ds"), conversationModels(catalog, "codex", true).map { it.getString("id") })
        assertEquals(listOf("gpt"), conversationModels(catalog, "codex", false).map { it.getString("id") })
        assertTrue(conversationModels(json("models" to catalog.getJSONArray("models")), null, true).isEmpty())
    }
}
