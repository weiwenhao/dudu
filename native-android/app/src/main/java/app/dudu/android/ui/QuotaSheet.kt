package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.UiState
import app.dudu.android.data.*
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date

/** The iPhone's quota sheet: the composer's sheet palette, one card per provider, remaining usage and aligned balances. */
@Composable
internal fun QuotaSheet(state: UiState, dismiss: () -> Unit) {
    val dark = isSystemInDarkTheme()
    val providers = remember(state.quota) { quotaProviders(state.quota) }
    val updating = state.quotaLoading
    DuduSheet(dismiss, containerColor = if (dark) MaterialTheme.colorScheme.surfaceContainer else Color(0xFFF4F4F4)) {
        Column(Modifier.fillMaxWidth().heightIn(max = 600.dp).testTag("quota-sheet")) {
            Row(Modifier.fillMaxWidth().height(59.dp).padding(horizontal = 40.dp).padding(top = 22.dp),
                verticalAlignment = Alignment.Top) {
                Text(w("额度"), Modifier.weight(1f), fontSize = 17.sp, lineHeight = 22.sp,
                    fontWeight = FontWeight.SemiBold, color = quotaMuted())
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (updating) RunningMark(12)
                    state.quota?.takeUnless { it.isNull("readAt") }?.let {
                        Text(w("更新于 {0}").replace("{0}", quotaWhen(it.getLong("readAt"))),
                            fontSize = 12.sp, lineHeight = 22.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Column(Modifier.fillMaxWidth().weight(1f, fill = false).verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp).padding(bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (providers.isNotEmpty()) providers.forEach { QuotaCard(it) }
                else if (updating) repeat(2) { QuotaSkeleton() }
                else Text(if (state.problem != null) "—" else w("暂无用量"),
                    Modifier.fillMaxWidth().padding(vertical = 40.dp), fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
}

@Composable
private fun QuotaCard(provider: QuotaProvider) {
    val plan = listOfNotNull(provider.plan, provider.until?.let {
        w("有效期至{0}").replace("{0}", quotaDate(it))
    }).joinToString(" · ")
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(27.dp), color = quotaCardColor()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth().height(26.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (provider.agent != null) AgentLogo(provider.agent, 20)
                Text(provider.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                Spacer(Modifier.weight(1f))
                if (plan.isNotEmpty()) Text(plan, Modifier.widthIn(max = 180.dp), fontSize = 13.sp, maxLines = 1,
                    overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            provider.amount?.let { amount ->
                Row(Modifier.fillMaxWidth().heightIn(min = 24.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(w("余额"), Modifier.weight(1f), fontSize = 14.sp, color = quotaSecondary())
                    Spacer(Modifier.width(8.dp))
                    Text(amount, fontSize = 16.sp, fontWeight = FontWeight.SemiBold,
                        style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"))
                }
            }
            provider.windows.forEach { QuotaWindowRow(it) }
        }
    }
}

@Composable
private fun QuotaWindowRow(window: QuotaWindow) {
    val whenReset = window.resetsAt?.let { quotaWhen(it) }
    val barColor = when (window.level) {
        2 -> Color(0xFFEC1313)
        1 -> Color(0xFFF59E0B)
        else -> DuduStyle.blue
    }
    val numberColor = when (window.level) {
        2 -> Color(0xFFB91C1C)
        1 -> Color(0xFFF59E0B)
        else -> MaterialTheme.colorScheme.onSurface
    }
    Column(Modifier.heightIn(min = 54.dp).padding(bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(quotaWindowName(window.label), Modifier.weight(1f), fontSize = 14.sp, lineHeight = 19.sp, color = quotaSecondary())
            if (window.used >= 100 && whenReset != null) {
                Text(w("已达上限，{0} 重置").replace("{0}", whenReset), fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold, color = numberColor)
            } else {
                Text(w("剩余"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(3.dp))
                Text("${window.left}%", fontSize = 16.sp, lineHeight = 21.sp, fontWeight = FontWeight.SemiBold,
                    style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"), color = numberColor)
            }
        }
        LinearProgressIndicator(progress = { window.left / 100f }, modifier = Modifier.fillMaxWidth().height(4.dp),
            color = barColor, trackColor = if (isSystemInDarkTheme()) MaterialTheme.colorScheme.outlineVariant else Color(0xFFECECEC),
            strokeCap = StrokeCap.Round, gapSize = 0.dp, drawStopIndicator = {})
        if (window.used < 100 && whenReset != null)
            Text(w("{0} 重置").replace("{0}", whenReset), fontSize = 12.sp, lineHeight = 16.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun QuotaSkeleton() {
    val line = if (isSystemInDarkTheme()) MaterialTheme.colorScheme.surfaceContainerHighest else Color(0xFFEEEEEE)
    Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(27.dp), color = quotaCardColor()) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Box(Modifier.size(20.dp).background(line, CircleShape))
                Box(Modifier.size(64.dp, 12.dp).background(line, RoundedCornerShape(4.dp)))
            }
            repeat(2) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row {
                        Box(Modifier.size(44.dp, 11.dp).background(line, RoundedCornerShape(4.dp)))
                        Spacer(Modifier.weight(1f))
                        Box(Modifier.size(64.dp, 11.dp).background(line, RoundedCornerShape(4.dp)))
                    }
                    Box(Modifier.fillMaxWidth().height(4.dp).background(line, CircleShape))
                }
            }
        }
    }
}

@Composable
private fun quotaCardColor() = if (isSystemInDarkTheme()) MaterialTheme.colorScheme.surface else Color(0xFFFCFCFC)
@Composable
private fun quotaMuted() = if (isSystemInDarkTheme()) MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFF666666)
@Composable
private fun quotaSecondary() = if (isSystemInDarkTheme()) MaterialTheme.colorScheme.onSurfaceVariant else Color(0xFF61666B)

@Composable
private fun quotaDate(timestamp: Long): String {
    val locale = appLocale()
    return remember(timestamp, locale) {
        SimpleDateFormat(android.text.format.DateFormat.getBestDateTimePattern(locale, "MMMd"), locale).format(Date(timestamp))
    }
}

@Composable
private fun quotaWhen(timestamp: Long): String {
    val locale = appLocale()
    return remember(timestamp, locale) {
        val date = Calendar.getInstance().apply { timeInMillis = timestamp }
        val today = Calendar.getInstance()
        val sameDay = date.get(Calendar.ERA) == today.get(Calendar.ERA) && date.get(Calendar.YEAR) == today.get(Calendar.YEAR) &&
            date.get(Calendar.DAY_OF_YEAR) == today.get(Calendar.DAY_OF_YEAR)
        val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, if (sameDay) "jmm" else "Ejmm")
        SimpleDateFormat(pattern, locale).format(date.time)
    }
}

@Composable
private fun quotaWindowName(label: String): String = when {
    label == "5 小时" -> w("5 小时")
    label == "每周" -> w("每周")
    label.endsWith(" 每周") -> w("{0} 每周").replace("{0}", label.removeSuffix(" 每周"))
    label.matches(Regex("\\d+ 天")) -> wp("%lld 天", label.substringBefore(' ').toInt())
    label.matches(Regex("\\d+ 小时")) -> wp("%lld 小时", label.substringBefore(' ').toInt())
    else -> label
}
