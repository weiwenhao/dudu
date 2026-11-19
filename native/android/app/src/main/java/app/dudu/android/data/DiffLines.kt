package app.dudu.android.data

data class NumberedDiffLine(val text: String, val old: Int?, val new: Int?)

fun numberDiffLines(oldStart: Int, newStart: Int, lines: List<String>): List<NumberedDiffLine> {
    var old = oldStart
    var new = newStart
    return lines.map { text ->
        val addition = text.startsWith('+')
        val deletion = text.startsWith('-')
        val marker = text.startsWith('\\')
        NumberedDiffLine(text, if (addition || marker) null else old, if (deletion || marker) null else new).also {
            if (!addition && !marker) old++
            if (!deletion && !marker) new++
        }
    }
}
