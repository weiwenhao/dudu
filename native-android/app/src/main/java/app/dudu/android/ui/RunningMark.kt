package app.dudu.android.ui

import androidx.compose.animation.core.*
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.foundation.layout.size
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import app.dudu.android.R

@Composable
internal fun RunningMark(size: Int = 20) {
    val lifecycle by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val angle = if (lifecycle.isAtLeast(Lifecycle.State.STARTED)) {
        val transition = rememberInfiniteTransition(label = "agent-working")
        val rotation by transition.animateFloat(0f, 360f,
            infiniteRepeatable(tween(1000, easing = LinearEasing)), label = "rotation")
        rotation
    } else 0f
    Icon(painterResource(R.drawable.ic_loader_circle), null, Modifier.size(size.dp).rotate(angle),
        tint = MaterialTheme.colorScheme.onSurfaceVariant)
}
