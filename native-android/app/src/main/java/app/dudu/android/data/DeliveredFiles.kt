package app.dudu.android.data

import org.json.JSONObject

fun presentedFiles(files: List<JSONObject>): List<JSONObject> {
    val paths = linkedMapOf<String, JSONObject>()
    files.filter { it.optString("kind") == "presented" }.forEach { file ->
        val path = file.optString("path").ifEmpty { file.optString("id") }
        val previous = paths[path]
        if (previous == null || file.optLong("seq") >= previous.optLong("seq")) paths[path] = file
    }
    return paths.values.toList()
}
