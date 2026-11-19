package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.data.*
import org.json.JSONObject

private data class DiffRow(val text: String, val line: NumberedDiffLine? = null)

@Composable
internal fun DiffContent(diff: JSONObject?) {
    val rows = remember(diff) { diff?.rows("hunks").orEmpty().flatMap { hunk ->
        listOf(DiffRow("@@ −${hunk.optInt("oldStart")},${hunk.optInt("oldLines")} +${hunk.optInt("newStart")},${hunk.optInt("newLines")} @@")) +
            numberDiffLines(hunk.optInt("oldStart"), hunk.optInt("newStart"), hunk.optJSONArray("lines")?.strings().orEmpty())
                .map { DiffRow(it.text.replace("\t", "    "), it) }
    } }
    val style = TextStyle(fontFamily = FontFamily.Monospace, fontSize = 12.sp)
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val widest = remember(rows) { rows.maxByOrNull { row -> row.text.sumOf { if (it.code > 255) 2 else 1 } }?.text.orEmpty() }
    val largest = remember(rows) { rows.maxOfOrNull { maxOf(it.line?.old ?: 0, it.line?.new ?: 0) } ?: 0 }
    val numberWidth = with(density) { maxOf(24.dp, measurer.measure(largest.toString(), style).size.width.toDp() + 6.dp) }
    val textWidth = with(density) { measurer.measure(widest, style, softWrap = false).size.width.toDp() }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val width = maxOf(maxWidth, textWidth + numberWidth * 2 + 48.dp)
        LazyColumn(Modifier.horizontalScroll(rememberScrollState()).width(width), contentPadding = PaddingValues(16.dp)) {
            if (diff?.optString("kind") == "binary") item { Text(w("二进制文件，无法显示改动"), Modifier.padding(16.dp)) }
            else if (diff?.optString("kind") == "oversized") item { Text(w("文件过大，无法显示改动"), Modifier.padding(16.dp)) }
            else {
                if (diff?.optBoolean("coarse") == true) item { Text(w("逐行对比超时，按整个文件替换显示"), Modifier.padding(16.dp)) }
                if (diff?.has("before") == true && !diff.optBoolean("before")) item { Text(w("本轮新建的文件"), Modifier.padding(16.dp)) }
                if (diff?.has("after") == true && !diff.optBoolean("after")) item { Text(w("本轮删除的文件"), Modifier.padding(16.dp)) }
                if (diff != null && rows.isEmpty()) item { Text(w("两侧内容相同"), Modifier.padding(16.dp)) }
                items(rows) { row -> SelectionContainer {
                    if (row.line == null) Text(row.text, Modifier.heightIn(min = 36.dp).padding(vertical = 10.dp), style = style,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, softWrap = false)
                    else Row(Modifier.fillMaxWidth().background(when {
                        row.text.startsWith('+') -> Color(0x1A16A34A)
                        row.text.startsWith('-') -> Color(0x14DC2626)
                        else -> Color.Transparent
                    }).padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val color = if (row.text.startsWith('-')) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
                        Text(row.line.old?.toString().orEmpty(), Modifier.width(numberWidth), style = style, textAlign = TextAlign.End, color = color)
                        Text(row.line.new?.toString().orEmpty(), Modifier.width(numberWidth), style = style, textAlign = TextAlign.End, color = color)
                        Text(row.text, style = style, color = color, softWrap = false)
                    }
                } }
            }
        }
    }
}
