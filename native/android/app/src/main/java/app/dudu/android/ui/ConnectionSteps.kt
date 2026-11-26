@file:OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.dudu.android.ui

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.data.DuduLog
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val PluginName = "dsh-dudu"
private const val DshAddress = "deepseek.com/harness"

/**
 * What to do on the computer before the phone can connect: the card on the first page of the app, the iPhone's `ConnectionGuideSteps` (owner, 2026-11-27, proposal 1 of
 * `.local/designs/phone-first-run-2026-11-27/`: 「实现吧」). Install DSH, add the plugin, make the pairing QR code in 嘟嘟's settings. The numbered rings with a line between
 * them are the Desktop's 连接指南 at phone size. The words are the owner's; a name in 「」 never breaks across two lines.
 */
@Composable
internal fun ConnectionSteps() {
    val context = LocalContext.current
    val clipboard = LocalClipboard.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
    val chip = MaterialTheme.colorScheme.surfaceContainerHighest
    Column(Modifier.fillMaxWidth().testTag("connection-steps")) {
        Step(1) {
            StepText(w("在电脑上安装 DSH"))
            Row(Modifier.heightIn(min = 22.dp).clickable(role = Role.Button) {
                DuduLog.record("connection.guide.link")
                runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://$DshAddress"))) }
            }.testTag("connection-dsh"), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(DshAddress, fontSize = 14.sp, color = DuduStyle.blue)
                ArrowUpRight(13.dp, DuduStyle.blue)
            }
        }
        Step(2) {
            // The name follows the sentence on its line when there is room for it, and the copy chip follows the name; what does not fit starts the next line.
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp),
                itemVerticalAlignment = Alignment.CenterVertically) {
                StepText(w("在 DSH 的「添加插件」里输入"))
                SelectionContainer {
                    Text(PluginName, fontFamily = FontFamily.Monospace, fontSize = 13.5.sp, color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier.background(chip, RoundedCornerShape(6.dp)).padding(horizontal = 6.dp, vertical = 1.dp))
                }
                // 复制: the plugin's name goes to the clipboard; the glyph turns into a check for a moment and the phone gives a tap (no new word).
                Surface(onClick = {
                    scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("", PluginName))) }
                    haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    DuduLog.record("connection.guide.copy")
                    copied = true
                }, shape = CircleShape, color = chip, modifier = Modifier.height(26.dp).testTag("connection-copy")) {
                    Row(Modifier.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Glyph(if (copied) DuduGlyphs.check else DuduGlyphs.copy, size = 12)
                        Text(w("复制"), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }
        }
        Step(3, last = true) {
            StepText(w("打开嘟嘟，点右上角的设置，进入「手机控制」，点「生成二维码」"))
        }
    }
}

/** A ring with its number, and the line that runs down to the next ring (not under the last step). */
@Composable
private fun Step(number: Int, last: Boolean = false, content: @Composable ColumnScope.() -> Unit) {
    val line = MaterialTheme.colorScheme.outlineVariant
    Row(Modifier.fillMaxWidth()
        .drawBehind {
            if (!last) drawLine(line, Offset(12.dp.toPx(), 24.dp.toPx()), Offset(12.dp.toPx(), size.height), strokeWidth = 1.dp.toPx())
        }
        .padding(bottom = if (last) 0.dp else 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(Modifier.size(24.dp).border(1.5.dp, DuduStyle.scopeInk.copy(alpha = .5f), CircleShape), contentAlignment = Alignment.Center) {
            Text("$number", fontSize = 12.sp, fontWeight = FontWeight.Medium)
        }
        Column(Modifier.weight(1f).padding(top = 1.dp), content = content)
    }
}

@Composable
private fun StepText(value: String) {
    Text(value.keepingNamesTogether(), fontSize = 15.sp, lineHeight = 22.sp, color = MaterialTheme.colorScheme.onSurface)
}

/** Lucide's arrow-up-right, drawn as the iPhone draws it (13 pt, line 2.2 of its 24-unit square). */
@Composable
private fun ArrowUpRight(size: Dp, color: Color) {
    Canvas(Modifier.size(size)) {
        val unit = this.size.minDimension / 24f
        val stroke = Stroke(width = 2.2f * unit, cap = StrokeCap.Round, join = StrokeJoin.Round)
        drawLine(color, Offset(7f * unit, 17f * unit), Offset(17f * unit, 7f * unit), strokeWidth = stroke.width, cap = StrokeCap.Round)
        drawPath(Path().apply { moveTo(7f * unit, 7f * unit); lineTo(17f * unit, 7f * unit); lineTo(17f * unit, 17f * unit) }, color, style = stroke)
    }
}

/**
 * A name in 「」 stays on one line: a word joiner (U+2060), which a line is never broken at, between its characters. The brackets already keep to their neighbours (an opening one
 * does not end a line, a closing one does not start one).
 */
internal fun String.keepingNamesTogether(): String {
    val result = StringBuilder()
    var inside = false
    for ((index, character) in withIndex()) {
        result.append(character)
        if (character == '「') inside = true else if (character == '」') inside = false
        if (inside && index + 1 < length && this[index + 1] != '」') result.append('⁠')
    }
    return result.toString()
}
