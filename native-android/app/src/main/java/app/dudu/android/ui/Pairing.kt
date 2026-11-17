package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import kotlinx.coroutines.launch

@Composable
fun PairingScreen(state: UiState, model: DuduViewModel, adding: Boolean = false) {
    var manual by rememberSaveable { mutableStateOf(adding) }
    var link by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    val clipboard = LocalClipboard.current
    val coroutine = rememberCoroutineScope()
    val busy = state.connecting
    if (adding) BackHandler(enabled = !busy) { model.backRoute() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
            val minimum = maxHeight
            Column(
                Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                    .heightIn(min = minimum).padding(horizontal = 28.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Image(painterResource(R.drawable.dudu), null, Modifier.size(76.dp))
                Spacer(Modifier.height(20.dp))
                Text(w("连接嘟嘟"), fontSize = 29.sp, lineHeight = 36.sp,
                    fontWeight = FontWeight.Medium, textAlign = TextAlign.Center)
                Spacer(Modifier.height(12.dp))
                Text(w("打开 DSH 并安装嘟嘟插件，在嘟嘟设置中打开配对二维码"),
                    fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center)
                Spacer(Modifier.height(28.dp))
                Surface(Modifier.widthIn(max = 380.dp).fillMaxWidth(),
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(26.dp),
                    color = MaterialTheme.colorScheme.surface, shadowElevation = 4.dp,
                    border = BorderStroke(.5.dp, MaterialTheme.colorScheme.outline)) {
                    Column(Modifier.fillMaxWidth().padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Spacer(Modifier.height(28.dp))
                        Button(onClick = { model.navigate(Route("scan")) }, enabled = !busy,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp).testTag("pairing-scan"),
                            shape = CircleShape,
                            colors = ButtonDefaults.buttonColors(containerColor = DuduStyle.blue)) {
                            Glyph(R.drawable.ic_scan_qr_code, size = 21, tint = Color.White)
                            Spacer(Modifier.width(10.dp))
                            Text(w("扫描配对码"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        }
                        FilledTonalButton(onClick = {
                            manual = true
                            model.clearProblem()
                            coroutine.launch {
                                clipboard.getClipEntry()?.clipData?.takeIf { it.itemCount > 0 }
                                    ?.getItemAt(0)?.text?.toString()?.let { link = it }
                            }
                        }, enabled = !busy,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("pairing-manual"),
                            colors = ButtonDefaults.filledTonalButtonColors(containerColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                                contentColor = MaterialTheme.colorScheme.onSurface)) {
                            Text(w("粘贴配对链接"), fontSize = 15.sp)
                        }
                        state.problem?.let {
                            Text(problemText(it), color = MaterialTheme.colorScheme.error, fontSize = 13.sp,
                                modifier = Modifier.testTag("pairing-error"))
                        }
                        if (busy && !manual) LinearProgressIndicator(Modifier.fillMaxWidth(), color = DuduStyle.blue)
                    }
                }
            }
        }
    }
    if (manual) DuduSheet({ if (!busy) { if (adding) model.backRoute() else manual = false } }) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { if (adding) model.backRoute() else manual = false }, enabled = !busy) {
                Text(stringResource(R.string.cancel))
            }
            Text(w("添加电脑"), Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center)
            Spacer(Modifier.width(64.dp))
        }
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(15.dp)) {
            Button(onClick = { model.navigate(Route("scan")) }, enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp),
                colors = ButtonDefaults.buttonColors(containerColor = DuduStyle.blue)) {
                Glyph(R.drawable.ic_scan_qr_code, size = 21, tint = Color.White)
                Spacer(Modifier.width(10.dp)); Text(w("扫描配对码"))
            }
            Field(w("配对链接"), link, !busy, multi = true, secret = true, tag = "pairing-link") { link = it }
            Field(w("电脑名称"), name, !busy, placeholder = w("选填")) { name = it }
            state.problem?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
            Button(onClick = { model.connect(link, name) }, enabled = link.isNotBlank() && !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp).testTag("connect"),
                colors = ButtonDefaults.buttonColors(containerColor = DuduStyle.blue)) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                Text(stringResource(R.string.connect))
            }
            Spacer(Modifier.height(12.dp))
        }
    }
}
