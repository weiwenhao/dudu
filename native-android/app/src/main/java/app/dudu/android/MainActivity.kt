package app.dudu.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.dudu.android.ui.DuduApp
import app.dudu.android.ui.DuduTheme

class MainActivity : ComponentActivity() {
    private val model: DuduViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) intent?.dataString?.let { model.openPairingLink(it) }
        setContent {
            DisposableEffect(lifecycle) {
                val observer = LifecycleEventObserver { _, event ->
                    if (event == Lifecycle.Event.ON_START) model.foreground(true)
                    if (event == Lifecycle.Event.ON_STOP) model.foreground(false)
                }
                lifecycle.addObserver(observer)
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) model.foreground(true)
                onDispose { lifecycle.removeObserver(observer); model.foreground(false) }
            }
            val state = model.state.collectAsStateWithLifecycle().value
            val system = LocalConfiguration.current
            val context = LocalContext.current
            val configuration = remember(system, state.language) {
                android.content.res.Configuration(system).apply {
                    if (state.language.isNotEmpty()) setLocale(java.util.Locale.forLanguageTag(state.language))
                }
            }
            val localized = remember(context, configuration) {
                // Keep the Activity in the wrapper chain for document/camera/speech launchers.
                android.view.ContextThemeWrapper(this@MainActivity, R.style.Theme_Dudu).apply {
                    applyOverrideConfiguration(configuration)
                }
            }
            CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides configuration) {
                DuduTheme { DuduApp(state, model) }
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.dataString?.let { model.openPairingLink(it) }
    }
}
