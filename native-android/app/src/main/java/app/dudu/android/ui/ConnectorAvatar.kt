package app.dudu.android.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.data.avatarTone

/** The twelve tones of a letter avatar (background to letter), shared by the connectors' and the conversations' tiles: the Desktop's `--tone-0` to `--tone-11`, in the same order. */
internal val avatarTones = listOf(0xFFE8F0FE to 0xFF2F5FD0, 0xFFE6F4EA to 0xFF177A3C,
    0xFFFDF1D6 to 0xFF8A5300, 0xFFFCE8EC to 0xFFB3294A, 0xFFEEE9FD to 0xFF5B3FC4,
    0xFFE0F4F3 to 0xFF0F766E, 0xFFECEEF1 to 0xFF4B5563, 0xFFE0F2FB to 0xFF0B6A94,
    0xFFFDE9DC to 0xFFA4410B, 0xFFEDF5D6 to 0xFF4F6B0A, 0xFFFBE6F5 to 0xFFA0198A,
    0xFFF3EBE3 to 0xFF6B4F3A)

@Composable
internal fun ConnectorAvatar(icon: String?, name: String, size: Int = 28) {
    val resource = connectorLogos[icon]
    val tone = avatarTones[avatarTone(name)]
    val shape = RoundedCornerShape((size * .29f).dp)
    Box(Modifier.size(size.dp).background(if (resource != null) Color.White else Color(tone.first), shape)
        .then(if (resource != null) Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape) else Modifier),
        contentAlignment = Alignment.Center) {
        if (resource != null) Image(painterResource(resource), null, Modifier.size((size * .6f).dp))
        else Text(name.trim().take(1).uppercase().ifEmpty { "?" }, fontSize = (size * .46f).sp,
            fontWeight = FontWeight.SemiBold, color = Color(tone.second))
    }
}
