package app.dudu.android.background

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.dudu.android.MainActivity
import app.dudu.android.R
import app.dudu.android.data.*
import app.dudu.android.ui.english
import kotlinx.coroutines.*
import org.json.JSONObject

/**
 * Notifications without Google's push service, as OpenClaw's Android app does (owner, 2026-11-22: 「就按 openclaw 的方式做」): while a collector's bell is on, a foreground service keeps a
 * connection of its own to the computer and long-polls it; the computer puts a `notification` event on that connection where it pushes the iPhone through Apple (`host/dudu-control.mjs`,
 * capability `notifications.events`), and this service shows it as the iPhone shows its push: the collector's name and what it collected, one notification per collector replaced by the next.
 * The computer keeps ONE connection for each phone, and lets one request wait for events on it at a time (`TOO_MANY_REQUESTS` for a second one), so while the app is in front the app holds the
 * connection and the service waits (`appVisible`); the service takes it 0.2 s after the app goes away, and the app takes it back by connecting when `holding` is set. A tap opens the app on that computer's inbox (`MainActivity`). The ongoing notification says 嘟嘟正在接收通知 (the owner's words).
 * It follows the computer the app last used; it stops by itself when no bell is on any more (`notifications.state`), and the app stops it when the last bell is turned off.
 */
class DuduConnectionService : Service() {
    companion object {
        const val CHANNEL_BACKGROUND = "background"
        const val CHANNEL_COLLECTOR = "collector"
        const val EXTRA_COLLECTOR = "dudu.notification.collector"
        const val EXTRA_COMPUTER = "dudu.notification.computer"
        /** The app is in front (`DuduViewModel.foreground`): it holds this phone's connection to the computer, and the service waits. */
        @Volatile var appVisible = false
        /** The service holds the connection now (the app takes it back by connecting, rather than finding it gone). */
        @Volatile var holding = false
        private const val ONGOING = 1
        private const val PREFERENCES = "dudu.background"
        private const val WANTED = "notifications"

        private const val RESTART = "dudu.background.restart"

        /** Start (or keep) the connection; remembered so that it comes back after the phone restarts. Notifications must be allowed. `restart`: connect again (another computer may be in use). */
        fun start(context: Context, restart: Boolean = false) {
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean(WANTED, true).apply()
            runCatching { ContextCompat.startForegroundService(context, Intent(context, DuduConnectionService::class.java).putExtra(RESTART, restart)) }
                .onFailure { DuduLog.failure("notifications.service.start.fail", it) }
        }

        fun stop(context: Context) {
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putBoolean(WANTED, false).apply()
            context.stopService(Intent(context, DuduConnectionService::class.java))
        }

        internal fun wanted(context: Context) = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean(WANTED, false)

        /** The app's words outside a screen: Chinese as written, English from the app's dictionary. */
        internal fun text(context: Context, key: String) =
            if (context.resources.configuration.locales[0].language == "zh") key else english[key] ?: key

        fun channels(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            manager.createNotificationChannel(NotificationChannel(CHANNEL_COLLECTOR, text(context, word("收集器通知")), NotificationManager.IMPORTANCE_HIGH))
            manager.createNotificationChannel(NotificationChannel(CHANNEL_BACKGROUND, text(context, word("后台连接")), NotificationManager.IMPORTANCE_MIN)
                .apply { setShowBadge(false) })
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var listening: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        channels(this)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val ongoing = NotificationCompat.Builder(this, CHANNEL_BACKGROUND)
            .setSmallIcon(R.drawable.ic_inbox).setContentTitle(text(this, word("嘟嘟正在接收通知")))
            .setOngoing(true).setSilent(true).setPriority(NotificationCompat.PRIORITY_MIN).setContentIntent(open).build()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(ONGOING, ongoing, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            else startForeground(ONGOING, ongoing)
        } catch (error: Exception) {
            DuduLog.failure("notifications.service.foreground.fail", error)
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.getBooleanExtra(RESTART, false) == true) listening?.cancel()
        if (listening?.isActive != true) listening = scope.launch { listen() }
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    /** One connection to the last used computer, polled again at once; a failure waits 1, 2, 4 … up to 30 s before the next try, as the iPhone's reconnects do. */
    private suspend fun listen() {
        val vault = Vault(applicationContext)
        var wait = 1_000L
        DuduLog.record("notifications.listen.start")
        while (currentCoroutineContext().isActive) {
            // The app in front holds the computer's connection for this phone: wait, and take it when the app goes away.
            if (appVisible) { delay(1_000L); continue }
            var client: DuduApi? = null
            try {
                val saved = vault.read("computer")?.let(::JSONObject)
                if (saved == null) { DuduLog.record("notifications.listen.stop", state = "unpaired"); stopSelf(); return }
                val computer = saved.optString("id")
                client = DuduApi(Endpoint.parse(saved.getString("link")))
                client.connect()
                if (client.request("notifications.state").optBoolean("enabled") != true) {
                    DuduLog.record("notifications.listen.stop", state = "off")
                    stop(applicationContext)
                    return
                }
                holding = true
                DuduLog.record("notifications.listen.ready")
                wait = 1_000L
                var cursor = 0L
                while (currentCoroutineContext().isActive && !appVisible) {
                    val batch = client.events(cursor)
                    cursor = batch.getLong("cursor")
                    batch.getJSONArray("events").objects().filter { it.optString("topic") == "notification" }
                        .forEach { show(it.getJSONObject("params"), computer) }
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("notifications.listen.fail", error)
                delay(wait)
                wait = (wait * 2).coerceAtMost(30_000L)
            } finally {
                holding = false
                client?.retire()
            }
        }
    }

    /** As the iPhone's push: the collector's name over what it collected; the next one of the same collector takes its place. */
    private fun show(params: JSONObject, computer: String) {
        val manager = NotificationManagerCompat.from(this)
        if (!manager.areNotificationsEnabled()) return
        val collector = params.optString("collectorId")
        val body = params.optString("body")
        val tap = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_COLLECTOR, collector).putExtra(EXTRA_COMPUTER, computer)
        val notification = NotificationCompat.Builder(this, CHANNEL_COLLECTOR)
            .setSmallIcon(R.drawable.ic_inbox).setContentTitle(params.optString("title")).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(this, "$computer:$collector".hashCode(), tap,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()
        try {
            manager.notify("collector:$computer:$collector", 0, notification)
            DuduLog.record("notifications.show")
        } catch (error: SecurityException) { DuduLog.failure("notifications.show.fail", error) }
    }
}

/** Brings the connection back after the phone restarts, when it was on before. */
class DuduBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED && DuduConnectionService.wanted(context)) DuduConnectionService.start(context)
    }
}
