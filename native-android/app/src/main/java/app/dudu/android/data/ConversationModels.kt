package app.dudu.android.data

import org.json.JSONObject

fun conversationModels(catalog: JSONObject, agent: String?, assistant: Boolean): List<JSONObject> {
    val provider = catalog.rows("providers").find { it.optString("id") == if (assistant) "deepseek" else agent }
    val allowed = provider?.optJSONArray("modelIds")?.strings()
    return catalog.rows("models").filter { (allowed == null && !assistant) || it.optString("id") in allowed.orEmpty() }
}
