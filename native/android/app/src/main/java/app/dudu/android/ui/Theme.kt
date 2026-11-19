package app.dudu.android.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object DuduStyle {
    val blue = Color(0xFF4176E6)
    val bubble = Color(0xFFEDF2FE)
    val settings = Color(0xFFF2F2F7)
    val selected = Color(0xFFEAEAED)
}

private val light = lightColorScheme(
    primary = Color(0xFF18191B), onPrimary = Color.White,
    primaryContainer = Color(0xFFEAF0FD), onPrimaryContainer = Color(0xFF2858B7),
    secondary = DuduStyle.blue, onSecondary = Color.White,
    secondaryContainer = Color(0xFFEAF0FD), onSecondaryContainer = Color(0xFF2858B7),
    surface = Color.White, background = Color(0xFFFAFAFA),
    onSurface = Color(0xFF18191B), onSurfaceVariant = Color(0xFF96989D),
    surfaceContainer = Color(0xFFF7F7F8), surfaceContainerLow = Color(0xFFF7F7F8),
    surfaceContainerHigh = Color(0xFFF0F1F4), surfaceContainerHighest = Color(0xFFECEEF1), surfaceTint = Color.Transparent,
    outline = Color(0xFFDADCE0), outlineVariant = Color(0xFFEDEDF0), error = Color(0xFFCF3434),
)
private val dark = darkColorScheme(
    primary = Color(0xFFE9EAED), onPrimary = Color(0xFF18191B),
    primaryContainer = Color(0xFF283855), onPrimaryContainer = Color(0xFFBDD2FF),
    secondary = Color(0xFF92B5FF), surface = Color(0xFF18191B), background = Color(0xFF18191B),
    onSurface = Color(0xFFE9EAED), onSurfaceVariant = Color(0xFF9B9EA7),
    surfaceContainer = Color(0xFF24262A), surfaceContainerLow = Color(0xFF202226),
    surfaceContainerHigh = Color(0xFF2B2D32), surfaceContainerHighest = Color(0xFF33363C),
    secondaryContainer = Color(0xFF283855), onSecondaryContainer = Color(0xFFBDD2FF),
    surfaceTint = Color.Transparent, outlineVariant = Color(0xFF41444B), error = Color(0xFFFF8C8C),
)

@Composable
fun DuduTheme(content: @Composable () -> Unit) {
    val type = Typography()
    fun text(size: Int, line: Int, weight: FontWeight = FontWeight.Normal) =
        TextStyle(fontSize = size.sp, lineHeight = line.sp, fontWeight = weight, letterSpacing = 0.sp)
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) dark else light,
        typography = type.copy(
            headlineSmall = text(23, 30, FontWeight.SemiBold),
            titleLarge = text(20, 27, FontWeight.SemiBold),
            titleMedium = text(16, 23, FontWeight.SemiBold),
            titleSmall = text(14, 20, FontWeight.Medium),
            bodyLarge = text(16, 24), bodyMedium = text(14, 21), bodySmall = text(12, 18),
            labelLarge = text(15, 21, FontWeight.Medium),
            labelMedium = text(13, 18, FontWeight.Medium), labelSmall = text(11, 16),
        ),
        shapes = Shapes(
            extraSmall = RoundedCornerShape(8.dp), small = RoundedCornerShape(12.dp),
            medium = RoundedCornerShape(16.dp), large = RoundedCornerShape(22.dp),
            extraLarge = RoundedCornerShape(28.dp),
        ),
        content = content,
    )
}
