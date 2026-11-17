package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import android.content.ClipData
import androidx.compose.ui.platform.ClipEntry

@Composable
fun Markdown(text: String, compact: Boolean = false, selectable: Boolean = true) {
    val blocks = remember(text) { markdownBlocks(text) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(if (compact) 6.dp else 12.dp)) {
        blocks.forEach { block ->
            when (block.kind) {
                "code" -> CodeBlock(block.text, block.language)
                "table" -> {
                    val rows = remember(block.text) { block.text.lines().filterNot { it.matches(Regex("[| :\\-]+")) }
                        .map { it.trim().trim('|').split('|').map(String::trim) } }
                    Column(Modifier.horizontalScroll(rememberScrollState())) {
                        rows.forEachIndexed { index, row ->
                            Row(Modifier.background(if (index == 0) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surface)) {
                                row.forEach { cell ->
                                    Text(inlineMarkdown(cell), Modifier.widthIn(min = 96.dp, max = 240.dp).padding(10.dp),
                                        fontSize = 14.sp, fontWeight = if (index == 0) FontWeight.Medium else FontWeight.Normal)
                                }
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                    }
                }
                "rule" -> HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                else -> {
                    val paragraph: @Composable () -> Unit = {
                    val heading = block.kind.toIntOrNull()
                    Text(inlineMarkdown(block.text), modifier = if (block.kind == "quote")
                        Modifier.background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(8.dp)).padding(12.dp) else Modifier,
                        fontSize = when (heading) { 1 -> 24.sp; 2 -> 21.sp; 3 -> 18.sp; else -> if (compact) 14.sp else 16.sp },
                        lineHeight = if (compact) 22.sp else 26.sp,
                        fontWeight = if (heading != null) FontWeight.SemiBold else FontWeight.Normal,
                        color = MaterialTheme.colorScheme.onSurface)
                    }
                    if (selectable) SelectionContainer { paragraph() } else paragraph()
                }
            }
        }
    }
}

data class MarkdownBlock(val kind: String, val text: String, val language: String = "")

fun markdownBlocks(text: String): List<MarkdownBlock> {
    val result = mutableListOf<MarkdownBlock>()
    val lines = text.lines()
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        when {
            line.startsWith("```") || line.startsWith("~~~") -> {
                val marker = line.take(3); val language = line.drop(3).trim(); i++
                val code = mutableListOf<String>()
                while (i < lines.size && !lines[i].startsWith(marker)) { code.add(lines[i]); i++ }
                result.add(MarkdownBlock("code", code.joinToString("\n"), language))
            }
            line.isBlank() -> Unit
            line.trim().matches(Regex("([-*_])(?:\\s*\\1){2,}")) -> result.add(MarkdownBlock("rule", ""))
            line.matches(Regex("^#{1,6} .*")) -> result.add(MarkdownBlock(line.takeWhile { it == '#' }.length.toString(), line.substringAfter(' ')))
            line.contains('|') && i + 1 < lines.size && lines[i + 1].matches(Regex("[| :\\-]+")) -> {
                val rows = mutableListOf(line); i++
                while (i < lines.size && lines[i].contains('|')) { rows.add(lines[i]); i++ }
                i--; result.add(MarkdownBlock("table", rows.joinToString("\n")))
            }
            line.startsWith(">") -> result.add(MarkdownBlock("quote", line.removePrefix(">").trimStart()))
            else -> {
                val paragraph = mutableListOf(line.replace(Regex("^\\s*[-*+] "), "• "))
                while (i + 1 < lines.size && lines[i + 1].isNotBlank() &&
                    !lines[i + 1].matches(Regex("^(?:#{1,6} |[-*+] |\\d+\\. |>|```|~~~).*")) &&
                    !lines[i + 1].contains('|')) { i++; paragraph.add(lines[i]) }
                result.add(MarkdownBlock("text", paragraph.joinToString("\n")))
            }
        }
        i++
    }
    return result
}

@Composable
private fun inlineMarkdown(text: String): AnnotatedString {
    val linkColor = MaterialTheme.colorScheme.secondary
    val codeColor = MaterialTheme.colorScheme.surfaceContainerHigh
    return remember(text, linkColor, codeColor) {
        buildAnnotatedString {
            val regex = Regex("!?\\[([^]]+)]\\(([^)]+)\\)|`([^`]+)`|\\*\\*([^*]+)\\*\\*|__([^_]+)__|~~([^~]+)~~|\\*([^*]+)\\*")
            var from = 0
            regex.findAll(text).forEach { match ->
                append(text.substring(from, match.range.first))
                when {
                    match.groups[1] != null -> {
                        val url = match.groupValues[2]
                        if (!match.value.startsWith('!') && runCatching { java.net.URI(url).scheme in listOf("https", "http", "mailto") }.getOrDefault(false)) {
                            withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = linkColor)))) { append(match.groupValues[1]) }
                        } else append(match.groupValues[1])
                    }
                    match.groups[3] != null -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeColor)) { append(match.groupValues[3]) }
                    match.groups[4] != null || match.groups[5] != null -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) {
                        append(match.groupValues[4].ifEmpty { match.groupValues[5] })
                    }
                    match.groups[6] != null -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(match.groupValues[6]) }
                    else -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(match.groupValues[7]) }
                }
                from = match.range.last + 1
            }
            append(text.substring(from))
        }
    }
}

@Composable
fun CodeBlock(text: String, language: String = "") {
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(12.dp))) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text(language, Modifier.weight(1f), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            IconButton(onClick = { scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("code", text))) } }) {
                Glyph(app.dudu.android.R.drawable.ic_copy, w("复制"), 16)
            }
        }
        SelectionContainer { Text(text, Modifier.horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, bottom = 12.dp),
            fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp) }
    }
}
