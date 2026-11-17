package app.dudu.android

import app.dudu.android.data.*
import org.junit.Assert.*
import org.junit.Test

class DeliveredFilesTest {
    @Test fun onlyPresentedFilesKeepTheLatestReferenceWithoutReordering() {
        fun file(id: String, kind: String, path: String, seq: Int) = json("id" to id, "kind" to kind, "path" to path, "seq" to seq)
        val result = presentedFiles(listOf(file("old", "presented", "/a", 3), file("produced", "produced", "/internal", 9),
            file("b", "presented", "/b", 4), file("latest", "presented", "/a", 6), file("stale", "presented", "/a", 2)))
        assertEquals(listOf("latest", "b"), result.map { it.getString("id") })
        assertEquals(6, result.first().getInt("seq"))
    }
}
