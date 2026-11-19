package app.dudu.android

import app.dudu.android.data.numberDiffLines
import org.junit.Assert.assertEquals
import org.junit.Test

class DiffLinesTest {
    @Test fun additionsDeletionsAndNoNewlineMarkersKeepIndependentSourcePositions() {
        val rows = numberDiffLines(8, 12, listOf(" context", "-old", "\\ No newline at end of file", "+new", "+more", " next"))
        assertEquals(listOf(8, 9, null, null, null, 10), rows.map { it.old })
        assertEquals(listOf(12, null, null, 13, 14, 15), rows.map { it.new })
    }
}
