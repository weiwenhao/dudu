package app.dudu.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.LaunchedEffect
import app.dudu.android.ui.EmbeddedPagePool
import app.dudu.android.ui.LocalPagePool
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.dudu.android.ui.DuduApp
import app.dudu.android.ui.DuduTheme
import app.dudu.android.ui.DuduToastOverlay
import app.dudu.android.ui.LocalToastHost
import app.dudu.android.ui.ToastHost
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.statusBars
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    private val model: DuduViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        Diagnostics.start(applicationContext)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) intent?.dataString?.let { model.openPairingLink(it) }
        if (savedInstanceState == null) openNotification(intent)
        setContent {
            // DSH's pages kept loaded for a while after they are left (`EmbeddedPagePool`): they live as long as this screen, and the ones not on screen go when the app goes to the background.
            val pageScope = rememberCoroutineScope()
            val pages = remember { EmbeddedPagePool(pageScope, model::releasePage).also { it.start() } }
            DisposableEffect(pages) { onDispose { pages.clear() } }
            DisposableEffect(lifecycle) {
                val observer = LifecycleEventObserver { _, event ->
                    if (event == Lifecycle.Event.ON_START) model.foreground(true)
                    if (event == Lifecycle.Event.ON_STOP) { model.foreground(false); pages.discardReleased() }
                }
                lifecycle.addObserver(observer)
                if (lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)) model.foreground(true)
                onDispose { lifecycle.removeObserver(observer); model.foreground(false) }
            }
            val state = model.state.collectAsStateWithLifecycle().value
            // A page opened on another computer or an older connection is no use: kept ones are closed, one on screen once it is left.
            LaunchedEffect(state.computerId, state.connected) {
                pages.connectionChanged("${state.computerId}/${model.connectionRevision}")
                if (!state.connected) pages.discardReleased()
            }
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
            val toasts = ToastHost(state.toast, model::dismissToast)
            CompositionLocalProvider(LocalContext provides localized, LocalConfiguration provides configuration, LocalToastHost provides toasts,
                LocalPagePool provides pages) {
                DuduTheme {
                    androidx.compose.foundation.layout.Box {
                        DuduApp(state, model)
                        // Over every page, under its bar (the iPhone's: the toolbar's height and 8 below the status bar); a sheet shows it over itself (`DuduSheet`).
                        DuduToastOverlay(toasts, androidx.compose.foundation.layout.WindowInsets.statusBars
                            .asPaddingValues().calculateTopPadding() + 72.dp)
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.dataString?.let { model.openPairingLink(it) }
        openNotification(intent)
    }

    /** A collector's notification was tapped (`DuduConnectionService`): that computer's inbox. */
    private fun openNotification(intent: android.content.Intent?) {
        val computer = intent?.getStringExtra(app.dudu.android.background.DuduConnectionService.EXTRA_COMPUTER) ?: return
        intent.removeExtra(app.dudu.android.background.DuduConnectionService.EXTRA_COMPUTER)
        model.openNotification(computer)
    }
}
