package app.dudu.android

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.compose.ui.unit.IntRect
import app.dudu.android.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

sealed interface Panel {
    data object Computers : Panel
    data object Create : Panel
    data object Quota : Panel
    data class Actions(val row: Conversation, val anchor: IntRect = IntRect.Zero) : Panel
    data class EditIssue(val issue: Issue, val property: IssueProperty) : Panel
    data class Rename(val issue: Issue) : Panel
    data class Delete(val issue: Issue, val token: String) : Panel
}

enum class IssueProperty { Priority, Agent, Status, Due, Labels, Project }

data class Route(val name: String, val title: String = "", val target: String? = null,
    val params: JSONObject = json())

/**
 * A quick sheet of 嘟嘟's chat (`kind`: todo, info, task) as it was when 打开会话 / 打开事项 / 关联会话 left it, for the chat of `sessionId` on `computerId` (the iPhone's `AssistantQuickSheetState`):
 * its tab, where its list was scrolled to, the row that was open and the record or task that was open in it.
 */
data class QuickSheetReturn(val kind: String, val computerId: String, val sessionId: String, val tab: String? = null,
    val scrollIndex: Int = 0, val scrollOffset: Int = 0, val expanded: Long? = null, val detail: Route? = null)

data class IssueDraft(
    val title: String = "", val description: String = "", val project: Project? = null,
    val agent: String? = null, val status: String? = null, val priority: String = "none",
    val labels: Set<Long> = emptySet(), val dueAt: Long? = null, val parent: Long? = null,
    val record: Long? = null,
    val photos: List<JSONObject> = emptyList(),
    val preparingPhotos: Boolean = false,
) {
    val valid get() = !preparingPhotos && title.isNotBlank() && (agent == null || !project?.path.isNullOrBlank())
    fun params() = json("title" to title.trim(), "description" to description, "project" to project?.json(),
        "priority" to priority, "labels" to JSONArray(labels.toList())).apply {
        status?.let { put("status", it) }
        agent?.let { put("agent", it) }
        dueAt?.let { put("dueAt", it) }; parent?.let { put("parent", it) }
        record?.let { put("record", it) }
        if (photos.isNotEmpty()) put("attachments", JSONArray(photos))
    }
}

/** An attempt to connect that the person has to wait for. A saved computer that is only being tried again (`retrying`) is not one: the computer pages stay usable. */
val UiState.connectionInFlight: Boolean get() = connecting && !retrying

data class UiState(
    val initialized: Boolean = false, val computer: String = "", val connected: Boolean = false,
    val connecting: Boolean = false,
    /** A saved computer that could not be reached is tried again every two seconds while the app is in front (`connectSaved`); `connecting` stays true all that time. Nothing is in flight that the person must wait for: adding, switching or editing a computer replaces that attempt. */
    val retrying: Boolean = false,
    val scope: Scope = Scope.Active, val home: Home? = null,
    val refreshing: Boolean = false, val problem: String? = null, val panel: Panel? = null,
    val busy: Boolean = false, val options: Options? = null, val draft: IssueDraft = IssueDraft(),
    val session: Session? = null, val conversationTitle: String? = null, val opening: Boolean = false,
    val message: String = "", val sending: Boolean = false, val pending: Message? = null,
    val quota: JSONObject? = null, val quotaLoading: Boolean = false,
    val computers: List<SavedComputer> = emptyList(), val computerId: String = "",
    val route: Route? = null, val navigation: JSONObject = json(), val catalog: JSONObject = json(),
    val attachments: List<JSONObject> = emptyList(), val outbox: List<Outgoing> = emptyList(),
    val issueId: Long? = null, val pageLoading: Boolean = false, val language: String = "",
    /** Why the page of earlier history could not be read: shown at the top of the history with 重试 (the iPhone's `historyFailure`), not over the box. */
    val pageFailure: String? = null,
    val readOnly: Boolean = false,
    val isAssistant: Boolean = false,
    /** 回复 asked for outside the conversation's own rows (a todo row of the quick sheet): the conversation page takes it once the sheet has closed (the iPhone's `GroupReplyRequest`). */
    val replyRequest: JSONObject? = null,
    /** The message at the top of the page (`DuduToastOverlay`), the iPhone's toast. */
    val toast: Toast? = null,
    val preferences: JSONObject = json(),
    val conversationKey: String = "",
    val boardFilters: BoardFilters = BoardFilters(),
    val computerUnavailable: Boolean = false,
    // Connection recovery must survive dismissing a panel or clearing its transient error.
    val connectionFailure: String? = null,
    val pairingRequired: Boolean = false,
    val boardLoadFailed: Boolean = false,
    val homeTab: HomeTab = HomeTab.Board,
    val inboxWaiting: Int = 0,
    val inboxUnread: Int = 0,
    /** The board rows a pin, a read mark or 完成 is being saved for (the iPhone's `BoardModel.changing`): each shows its own spinner, and nothing else on the board waits for it. */
    val changing: Set<String> = emptySet(),
    /** The plugin on the computer predates `navigation.get` (the iPhone's `NavigationAvailability.unsupported`): the drawer says why DSH's entries are missing. */
    val navigationUnsupported: Boolean = false,
) {
    /** The connection guide stands in for the board (the iPhone's `needsConnectionGuide`): no computer yet, or one the app must not try again by itself (pairing, or a plugin to update). */
    val showsConnectionGuide: Boolean
        get() = conversationTitle == null &&
            (computerId.isEmpty() || !connected && (pairingRequired || !retriesConnection(connectionFailure)))
}

class DuduViewModel(application: Application) : AndroidViewModel(application) {
    private var inboxReadRevision = 0
    private val vault = Vault(application)
    private val mutable = MutableStateFlow(UiState())
    val state = mutable.asStateFlow()
    private var api: DuduApi? = null
    private var computerId = ""
    private var generation = 0
    /** Filling in records' context (`inbox.complete`), followed until the computer says it is over (the iPhone's `CollectorModel.completing`). */
    val inboxCompletions = InboxCompletions(viewModelScope, { generation }, { method, params -> request(method, params) }) { problem ->
        if (problem.isEmpty()) toast(word("更改没能保存"), ToastKind.Error) else toast(problem, ToastKind.Error, literal = true)
    }
    private val inboxChangesFlow = MutableStateFlow<Pair<Int, Long?>>(0 to null)
    /** Counts the records that left the inbox other than by its own lists' marks (an issue made of one, the record's id second): the lists read again and that record in full goes back to them. */
    val inboxChanges = inboxChangesFlow.asStateFlow()
    /** A quick sheet of 嘟嘟's chat that 打开会话 / 打开事项 / 关联会话 left (the iPhone's `returningQuickSheet`): it comes back as it was when 嘟嘟's chat is shown again. */
    private var quickSheetReturn: QuickSheetReturn? = null
    val collectorNotifications = CollectorNotifications(viewModelScope, { generation }) { body ->
        request("settings.act", body)
        // A bell turned on or off decides whether the background connection that shows the notifications runs.
        syncBackgroundNotifications()
        Unit
    }
    private var refreshRevision = 0
    private var eventCursor = 0L
    private var eventJob: Job? = null
    private var connectionJob: Job? = null
    private var refreshJob: Job? = null
    private var quotaJob: Job? = null
    private var quotaRevision = 0
    private var watchJob: Job? = null
    private var watchId: String? = null
    private var visible = false
    private val homes = mutableMapOf<Scope, Home>()
    private var savedHomeJson: String? = null
    private val draftWrites = Mutex()
    private var inputRequestId: String? = null
    private val sendingDrafts = mutableMapOf<String, String>()
    private val observedInputs = mutableSetOf<String>()
    private val sessions = mutableMapOf<String, Session>()
    private val cachedSessions = mutableMapOf<String, Session>()
    private val outboxes = mutableMapOf<String, List<Outgoing>>()
    private val outboxWrites = Mutex()
    // A snapshot rebuilds every message's JSONObject from scratch, so an attachment row backed by a new object still names the same
    // picture; without this, scrolling or an unrelated event during a long poll re-downloaded and re-decoded it each time (measured:
    // one photo fetched seven times in a minute). Keyed by the exact request this image would send, which already names it uniquely.
    // (Named `attachmentCache`, not `attachments`: `UiState.attachments` is the composer's own staged files and a same-named
    // property on this class would read as the same thing at a glance.)
    private val attachmentCache = LinkedHashMap<String, JSONObject>()
    private val attachmentWrites = Mutex()
    private val routes = mutableListOf<Route>()
    private data class ConversationReturn(val id: String?, val title: String?, val issue: Long?,
        val assistant: Boolean, val subagent: JSONObject?, val route: Route?, val routes: List<Route>)
    private val conversationBack = mutableListOf<ConversationReturn>()
    private var subagentAddress: JSONObject? = null
    private var pendingLink: String? = null
    // The phone's default network, as last told (declared before `init`, which registers the callback).
    private var network: android.net.Network? = null
    private var networkKnown = false
    private var networkChange: Job? = null
    private val networkCallback = object : android.net.ConnectivityManager.NetworkCallback() {
        override fun onAvailable(next: android.net.Network) { viewModelScope.launch { networkChanged(next) } }
        override fun onLost(lost: android.net.Network) { viewModelScope.launch { if (lost == network) networkChanged(null) } }
    }

    init {
        runCatching {
            val info = application.packageManager.getPackageInfo(application.packageName, 0)
            AppDeclaration.version = info.versionName.orEmpty()
            // `longVersionCode` is API 28; the app supports 26.
            @Suppress("DEPRECATION")
            AppDeclaration.build = (if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()).toString()
        }
        // The diagnostics follow what the person sees: the 电脑未连接 notice, the connection and the problem code, each as it changes.
        // The line just before says what raised it (`board.load.fail`, `events.fail`, `http.request.fail` …).
        viewModelScope.launch {
            state.map { it.computerUnavailable }.distinctUntilChanged().collect {
                DuduLog.record(if (it) "notice.unavailable.on" else "notice.unavailable.off", if (it) "warn" else "info",
                    state = if (visible) "foreground" else "background")
            }
        }
        viewModelScope.launch {
            state.map { if (it.connected) "connected" else if (it.connecting) "connecting" else "disconnected" }
                .distinctUntilChanged().collect { DuduLog.record("connection.state", state = it) }
        }
        viewModelScope.launch {
            state.map { it.problem }.distinctUntilChanged().collect {
                if (it == null) DuduLog.record("problem.clear") else DuduLog.record("problem.set", "warn", code = it)
            }
        }
        viewModelScope.launch {
            state.map { it.initialized && it.showsConnectionGuide }.distinctUntilChanged().collect { shown ->
                DuduLog.record(if (shown) "connection.guide.show" else "connection.guide.hide",
                    code = if (shown) state.value.connectionFailure else null)
            }
        }
        viewModelScope.launch {
            val computers = vault.read("computers")?.let {
                runCatching { JSONArray(it).objects().map(SavedComputer::parse) }.getOrNull()
            }.orEmpty()
            // The in-app language choice is gone (owner, 2026-11-21): the app follows the system, as the iPhone does, and an old stored choice is ignored.
            val language = ""
            val preferences = vault.read("preferences")?.let { runCatching { JSONObject(it) }.getOrNull() } ?: json()
            // The board always opens on 进行中, as the iPhone's does (a scope chosen earlier is not remembered).
            mutable.update { it.copy(computers = computers, language = language, preferences = preferences, scope = Scope.Active) }
            val saved = vault.read("computer")
            if (saved != null) {
                try {
                    val data = JSONObject(saved)
                    computerId = data.getString("id")
                    val link = data.getString("link")
                    if (!computerId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) error("Invalid identity")
                    // Cached content belongs to the saved identity, not to a successful handshake
                    // or a still-current pairing link. An upgrade must not hide that cache.
                    restoreHomes()
                    mutable.update { it.copy(computer = data.getString("name"),
                        home = cachedHome(it.scope), computerId = computerId) }
                    val endpoint = try { Endpoint.parse(link) } catch (error: Exception) {
                        DuduLog.record("connection.restore.fail", "warn", code = "INVALID_LINK",
                            detail = DuduLog.describe(error), at = DuduLog.place(error))
                        throw ApiFailure("INVALID_LINK")
                    }
                    api = DuduApi(endpoint, computerId)
                    mutable.update { it.copy(initialized = true) }
                    DuduLog.record("app.restore", state = "paired", counts = mapOf("rowCount" to (cachedHome(Scope.All)?.rows?.size ?: 0).toLong()))
                    if (visible) connect(link)
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    DuduLog.failure("app.restore.fail", error,
                        counts = mapOf("rowCount" to state.value.home?.rows.orEmpty().size.toLong()))
                    val failure = (error as? ApiFailure)?.code ?: "INVALID_LINK"
                    mutable.update { it.copy(initialized = true, problem = failure, connectionFailure = failure,
                        pairingRequired = true) }
                }
            } else {
                DuduLog.record("app.restore", state = "unpaired")
                mutable.update { it.copy(initialized = true) }
            }
            pendingLink?.let { pendingLink = null; showPairing(it) }
        }
        // A change of network reaches the computer again at once, as the iPhone's `networkPathChanged` does.
        runCatching { application.getSystemService(android.net.ConnectivityManager::class.java)?.registerDefaultNetworkCallback(networkCallback) }
            .onFailure { DuduLog.failure("network.monitor.fail", it) }
    }

    override fun onCleared() {
        runCatching { getApplication<Application>().getSystemService(android.net.ConnectivityManager::class.java)?.unregisterNetworkCallback(networkCallback) }
        super.onCleared()
    }

    /**
     * A `dudu://connect?url=…` link (the pairing QR code read by the phone's camera): the pairing form opens with the link filled in, as the iPhone's `handlePairingURL` does; nothing is paired
     * until the person taps 添加并连接.
     */
    fun openPairingLink(value: String) {
        val link = pairingLinkTarget(value) ?: return
        DuduLog.record("pairing.link.prefill")
        if (!state.value.initialized) pendingLink = link else showPairing(link)
    }

    /** The pairing form as a sheet (the guide's 粘贴配对链接, a pairing link from outside): `link` fills it in. */
    fun showPairing(link: String? = null) {
        navigate(Route("pair", params = json("sheet" to true, "link" to link)))
    }

    /** The computer on screen, reached again (the iPhone's `reconnect`): its 重新连接 rows, the guide's button, a change of network. What is open stays open. */
    fun reconnect(reason: String = "manual") {
        val saved = state.value.computers.find { it.id == computerId } ?: return
        DuduLog.record("computer.reconnect", state = reason)
        connect(saved.link)
    }

    /** The phone's network changed (the first answer is only what it is now): 300 ms later the computer is reached again, unless an attempt the person waits for is already on its way. */
    private fun networkChanged(next: android.net.Network?) {
        if (networkKnown && next == network) return
        val first = !networkKnown
        networkKnown = true
        network = next
        if (first) return
        networkChange?.cancel()
        networkChange = viewModelScope.launch {
            delay(300)
            val shown = state.value
            if (!visible || api == null || computerId.isEmpty() || shown.connectionInFlight || shown.pairingRequired ||
                !retriesConnection(shown.connectionFailure)) return@launch
            DuduLog.record("network.path.changed", state = if (network == null) "lost" else "available")
            reconnect("network")
        }
    }

    /**
     * The conversation that was open when the computer was reached again: watched again under its own watch, as the events loop does after its reconnect, so that what it shows, its draft
     * and its queue stay. One that was still opening is opened again; one there is nothing to open again by is closed.
     */
    private fun resumeConversation(client: DuduApi, currentGeneration: Int) {
        val shown = state.value
        val active = shown.session
        if (active == null) {
            if (shown.issueId == null && !shown.isAssistant) {
                mutable.update { it.copy(conversationTitle = null, opening = false) }
                return
            }
            val kept = routes.toList()
            openSession(null, shown.conversationTitle.orEmpty(), shown.issueId, shown.isAssistant, subagentAddress, rememberReturn = false)
            routes.clear(); routes.addAll(kept)
            mutable.update { it.copy(route = shown.route) }
            return
        }
        watchJob?.cancel()
        watchId = active.watchId
        watchJob = viewModelScope.launch {
            try {
                val params = json("id" to active.id, "watchId" to active.watchId, "transcript" to true)
                subagentAddress?.let { params.put("subagent", it) }
                val detail = client.request("session.watch", params)
                if (currentGeneration != generation || watchId != active.watchId) return@launch
                receiveSession(detail, active.watchId, active.id)
                mutable.update { it.copy(opening = false) }
                DuduLog.record("conversation.resume", requestId = active.watchId)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("conversation.resume.fail", error, requestId = active.watchId)
                if (currentGeneration == generation && watchId == active.watchId)
                    mutable.update { it.copy(opening = false, problem = code(error)) }
            }
        }
    }

    fun foreground(active: Boolean) {
        if (visible != active) DuduLog.record(if (active) "app.foreground" else "app.background",
            state = if (state.value.connected) "connected" else if (state.value.connecting) "connecting" else "disconnected")
        visible = active
        // The background service waits while the app is in front: the computer keeps one connection for this phone and lets one request wait on it, and the app holds it then.
        app.dudu.android.background.DuduConnectionService.appVisible = active
        if (!active) {
            eventJob?.cancel()
            mutable.update { it.copy(computerUnavailable = false) }
            return
        }
        if (state.value.connected) {
            val retake = api
            if (app.dudu.android.background.DuduConnectionService.holding && retake != null) {
                // The service held this phone's connection while the app was away: taking it back is a request of its own, not an events poll that is refused and waits (which showed a refresh every 30 s).
                viewModelScope.launch {
                    try { retake.connect(); eventCursor = 0 }
                    catch (error: Exception) { if (error is CancellationException) throw error; DuduLog.failure("connection.retake.fail", error) }
                    if (visible) {
                        startEvents()
                        if (state.value.conversationTitle == null) refresh(quiet = true)
                    }
                }
                return
            }
            startEvents()
            // Back in front: what it shows may be a long time old, and the events it missed are gone.
            if (state.value.conversationTitle == null) refresh(quiet = true)
        }
        // Back in front, the computer is tried again, a plugin that asked to be updated too (it may have been), as the iPhone's `resume` does; never a pairing that failed.
        else if (state.value.initialized && api != null && connectionJob?.isActive != true
            && !state.value.pairingRequired && !requiresNewPairing(state.value.connectionFailure)) {
            viewModelScope.launch {
                vault.read("computer")?.let { connect(JSONObject(it).getString("link")) }
            }
        }
    }

    fun connect(link: String, displayName: String? = null) {
        val endpoint = try { Endpoint.parse(link) } catch (_: Exception) {
            // Why the link cannot be used, in the iPhone's words: no pairing token, an unencrypted public address, or anything else.
            val failure = pairingLinkFailure(link)
            DuduLog.record("connection.fail", "warn", code = failure)
            mutable.update { it.copy(problem = failure,
                connectionFailure = if (!it.connected && !it.connecting) failure else it.connectionFailure,
                pairingRequired = it.pairingRequired || !it.connected && !it.connecting) }
            return
        }
        val began = System.nanoTime()
        DuduLog.record("connection.begin", state = if (visible) "foreground" else "background", counts = mapOf(
            "lanAddressCount" to endpoint.addresses.count { it.kind == "lan" }.toLong(),
            "publicAddressCount" to endpoint.addresses.count { it.kind == "public" }.toLong()))
        connectionJob?.cancel()
        eventJob?.cancel()
        refreshJob?.cancel()
        watchJob?.cancel()
        stopQuota()
        val previousApi = api
        previousApi?.retire()
        val next = ++generation
        val savedComputer = state.value.computers.firstOrNull { saved -> runCatching {
            val previous = Endpoint.parse(saved.link)
            previous.token == endpoint.token && (previous.origin == endpoint.origin || saved.id == endpoint.computerId)
        }.getOrDefault(false) }
        val known = savedComputer?.id ?: computerId.takeIf {
            it.isNotEmpty() && previousApi?.endpoint?.origin == endpoint.origin && previousApi.endpoint.token == endpoint.token
        }
        val candidate = DuduApi(endpoint, endpoint.computerId ?: known, savedComputer?.addressesEdited == true)
        candidate.language = state.value.language
        // The computer already on screen, connected again (重新连接, the app back in front, a change of network): what is open stays open, as the iPhone's `reconnect` keeps it.
        // A link from the pairing form (it names the computer) and another computer start afresh.
        val resuming = displayName == null && known != null && known == computerId && state.value.computerId == known
        mutable.update { if (resuming) it.copy(connecting = true, retrying = false, connected = false, busy = false, sending = false,
            refreshing = false, problem = null, computerUnavailable = false, boardLoadFailed = false, changing = emptySet())
        else it.copy(connecting = true, retrying = false, connected = false, busy = false, sending = false, refreshing = false,
            session = null, conversationTitle = null, opening = false, problem = null, computerUnavailable = false,
            boardLoadFailed = false, homeTab = HomeTab.Board, inboxWaiting = 0, inboxUnread = 0, changing = emptySet(),
            navigationUnsupported = false) }
        connectionJob = viewModelScope.launch {
            try {
                previousApi?.let { runCatching { it.disconnect() } }
                val computer = connectSaved(candidate, next, savedComputer != null || known != null)
                if (next != generation) return@launch
                val id = computer.getString("id")
                val name = displayName?.trim()?.take(100)?.takeIf(String::isNotEmpty)
                    ?: savedComputer?.name ?: computer.getString("name")
                require(id.matches(Regex("[A-Za-z0-9_-]{1,100}")))
                if (computerId != id) {
                    homes.clear(); savedHomeJson = null; sessions.clear(); cachedSessions.clear(); outboxes.clear()
                    attachmentCache.clear()
                }
                computerId = id
                if (!resuming) {
                    routes.clear()
                    conversationBack.clear(); subagentAddress = null
                    quickSheetReturn = null
                    watchId = null
                }
                api = candidate
                eventCursor = 0
                restoreHomes()
                if (next != generation) return@launch
                val savedLink = candidate.endpoint.storedLink()
                vault.write("computer", json("id" to id, "name" to name, "link" to savedLink).toString())
                if (next != generation) return@launch
                val allComputers = state.value.computers.filterNot { it.id == id } +
                    SavedComputer(id, name, savedLink, candidate.preserveAddresses)
                vault.write("computers", JSONArray(allComputers.map { it.json() }).toString())
                if (next != generation) return@launch
                val cachedNavigation = vault.read("navigation-$id-${java.util.Locale.getDefault().language}")?.let { runCatching { JSONObject(it) }.getOrNull() } ?: json()
                mutable.update {
                    // Reconnected to the same computer, the page, the sheet and the conversation on screen stay; anything else starts on the board.
                    val kept = if (resuming) it.copy(navigation = if (it.navigation.length() > 0) it.navigation else cachedNavigation)
                    else it.copy(panel = null, session = null, conversationTitle = null, message = "", pending = null, route = null,
                        attachments = emptyList(), outbox = emptyList(), navigation = cachedNavigation, catalog = json())
                    kept.copy(initialized = true, computer = name,
                    connected = true, connecting = false, retrying = false, home = cachedHome(it.scope),
                    // Another computer has another board: it opens on 进行中, as the iPhone's `BoardModel.reset` does.
                    scope = if (it.computerId == id) it.scope else Scope.Active,
                    boardFilters = if (it.computerId == id) it.boardFilters else BoardFilters(),
                    computers = allComputers, computerId = id, computerUnavailable = false,
                    connectionFailure = null, pairingRequired = false,
                    quota = if (it.computerId == id) it.quota else null) }
                DuduLog.record("connection.ready", elapsedMs = (System.nanoTime() - began) / 1_000_000,
                    state = if (resuming) "resumed" else "fresh")
                syncBackgroundNotifications(restart = !resuming)
                pendingNotification?.let { target -> if (target == id) { pendingNotification = null; selectHomeTab(HomeTab.Inbox) } }
                // A link from the pairing form names its computer (the iPhone's `pairing.success` / `pair.fail`).
                if (displayName != null) DuduLog.record("pairing.success")
                refresh()
                loadCatalog()
                if (visible) startEvents()
                if (resuming && state.value.conversationTitle != null) resumeConversation(candidate, next)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("connection.fail", error, elapsedMs = (System.nanoTime() - began) / 1_000_000,
                    state = if (next == generation) "current" else "superseded")
                if (displayName != null) DuduLog.failure("pair.fail", error)
                if (next == generation) mutable.update { it.copy(connecting = false, retrying = false, problem = code(error),
                    connectionFailure = code(error),
                    pairingRequired = it.pairingRequired || requiresNewPairing(code(error)),
                    computerUnavailable = visible && isConnectionProblem(code(error))) }
            } finally {
                if (next == generation && !state.value.connected)
                    mutable.update { it.copy(connecting = false, retrying = false) }
            }
        }
    }

    /**
     * Reuse this connection job for saved-computer retries; never retry pairing or a mutation. It waits longer after each failure, 1, 2, 4, 8, 16 s and then every 30 s, as the iPhone's
     * `scheduleReconnect` does; a change of network or a 重新连接 starts a new attempt at once.
     */
    private suspend fun connectSaved(client: DuduApi, currentGeneration: Int, saved: Boolean): JSONObject {
        var attempt = 0
        while (true) {
            try { return client.connect() }
            catch (error: Exception) {
                if (error is CancellationException || !saved || !visible || currentGeneration != generation ||
                    !isConnectionProblem(code(error))) throw error
                attempt++
                DuduLog.failure("connection.retry", error, state = "foreground", counts = mapOf("attempt" to attempt.toLong()))
                mutable.update { it.copy(connectionFailure = code(error), problem = code(error), computerUnavailable = true, retrying = true) }
                delay(reconnectDelayMillis(attempt))
                if (!visible || currentGeneration != generation) throw CancellationException("Connection suspended")
            }
        }
    }

    suspend fun value(method: String, params: JSONObject = json(), timeoutSeconds: Long? = null): Any {
        val client = api ?: throw ApiFailure("CONNECTION_FAILED")
        val current = generation
        val result = try { client.requestValue(method, params, timeoutSeconds) }
        catch (error: Exception) {
            if (error is CancellationException) throw error
            if (current == generation && visible && isConnectionProblem(code(error)))
                mutable.update { it.copy(computerUnavailable = true) }
            throw error
        }
        if (current != generation) throw CancellationException("Computer switched")
        return result
    }

    suspend fun request(method: String, params: JSONObject = json(), timeoutSeconds: Long? = null) =
        value(method, params, timeoutSeconds) as? JSONObject ?: throw ApiFailure("PROTOCOL_ERROR")

    /** Which connection a page was opened on: a page of DSH kept for later is no use once the computer has been reached again (`EmbeddedPagePool`). */
    val connectionRevision: Int get() = generation

    /** DSH's entries again (the iPhone's `refreshNavigation`), as the DSH 设置 list reads them when it opens: false when the computer did not answer, the last good list is kept. */
    suspend fun refreshNavigation(): Boolean {
        val current = generation
        return try {
            val result = request("navigation.get")
            if (current != generation) return false
            mutable.update { it.copy(navigation = result, navigationUnsupported = false) }
            vault.write("navigation-${mutable.value.computerId}-${java.util.Locale.getDefault().language}", result.toString())
            true
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            DuduLog.failure("navigation.load.fail", error)
            false
        }
    }

    /** The models and permissions again, after DSH's own settings were open (the iPhone refreshes its catalog when a settings page was changed). */
    fun refreshCatalog() {
        if (!state.value.connected) return
        val current = generation
        viewModelScope.launch {
            runCatching { request("catalog.get") }.onSuccess { result ->
                if (current == generation) mutable.update { it.copy(catalog = result) }
            }.onFailure { if (it is CancellationException) throw it }
        }
    }

    /**
     * What this connection's plugin does about the settings pages, with the connection's generation: it answers `settings.data` (true: the computer sends values and the app lays the page out,
     * `SettingsPages`) or it is older and answered the unknown method (false: it still lays the page out, `settings.page`). A new connection asks again, the plugin may have been updated.
     */
    private var settingsData: Pair<Int, Boolean>? = null

    /** True while this connection's plugin lays the settings pages out itself: the page that comes back with an act is then the one to draw. */
    fun settingsPagesFromComputer() = settingsData?.takeIf { it.first == generation }?.second == false

    /**
     * One page of 嘟嘟's settings: the values from `settings.data`, laid out here (owner, 2026-11-21: "从 api 获取的是值，而不是布局"). A plugin that does not know the method gets the old
     * request, `settings.page`, for the rest of the connection; any other failure is the page's failure.
     */
    suspend fun settingsPage(section: String, target: String?, words: SettingsWords): JSONObject {
        val params = json("section" to section).apply { target?.let { put("target", it) } }
        val current = generation
        if (settingsData?.takeIf { it.first == current }?.second != false) {
            try {
                val values = request("settings.data", params).getJSONObject("data")
                if (settingsData?.first != current) DuduLog.record("settings.layout", state = "app")
                settingsData = current to true
                // Values that are not what a page is made of are the plugin's mistake, not a lost connection.
                return withContext(Dispatchers.Default) {
                    try { SettingsPages.page(section, target, values, words) } catch (_: org.json.JSONException) { throw ApiFailure("PROTOCOL_ERROR") }
                }
            } catch (error: ApiFailure) {
                if (!isUnsupportedMethod(error.code)) throw error
                DuduLog.record("settings.layout", state = "computer")
                settingsData = current to false
            }
        }
        return request("settings.page", params).getJSONObject("page")
    }

    /**
     * Like `request`, but for a payload that never changes once the computer has answered once (an attachment's bytes): the exact
     * request this would send is already that attachment's identity, so it serves a repeat of the same request from memory instead
     * of asking again. Never used for a mutation.
     */
    suspend fun attachment(method: String, params: JSONObject): JSONObject {
        val key = "$method:$params"
        attachmentCache[key]?.let { return it }
        val result = request(method, params)
        // Pictures are small, but a delivered file read for its preview can be tens of MB: the cache holds at most 40 answers and 48 MB of data, and none over 8 MB.
        val bytes = result.optString("dataBase64", result.optString("data")).length.toLong()
        if (bytes > 8L * 1024 * 1024) return result
        attachmentWrites.withLock {
            attachmentCache[key] = result
            var held = attachmentCache.values.sumOf { it.optString("dataBase64", it.optString("data")).length.toLong() }
            while (attachmentCache.size > 40 || held > 48L * 1024 * 1024) {
                val oldest = attachmentCache.keys.first()
                held -= attachmentCache.remove(oldest)?.let { it.optString("dataBase64", it.optString("data")).length.toLong() } ?: 0
            }
        }
        return result
    }

    suspend fun openPage(page: String, target: String?, sessionId: String?): OpenPage {
        val client = api ?: throw ApiFailure("CONNECTION_FAILED")
        val current = generation
        val opened = client.openPage(page, target, sessionId, computerId)
        if (current != generation) throw CancellationException("Computer switched")
        return opened
    }
    suspend fun closePage(page: OpenPage) { api?.closePage(page) }
    fun releasePage(page: OpenPage) {
        val client = api ?: return
        if (client.endpoint.origin != page.origin) return
        viewModelScope.launch(Dispatchers.IO) { runCatching { client.closePage(page) } }
    }

    fun navigate(route: Route?) {
        DuduLog.record(if (route == null) "route.close" else "route.open", state = route?.name)
        stopQuota()
        if (route == null) routes.clear()
        else state.value.route?.let { routes.add(it) }
        mutable.update { it.copy(route = route, panel = null, problem = null,
            draft = it.draft.copy(preparingPhotos = false)) }
    }
    fun backRoute() {
        mutable.update { it.copy(route = if (routes.isEmpty()) null else routes.removeAt(routes.lastIndex), problem = null) }
    }
    fun routesBehindCurrent(): List<Route> = routes.toList()

    /** A quick sheet leaves for a conversation or an issue: kept until 嘟嘟's chat is shown again (the iPhone's `leaveQuickSheet`). */
    fun leaveQuickSheet(sheet: QuickSheetReturn) {
        quickSheetReturn = sheet
        DuduLog.record("quick.sheet.leave", state = sheet.kind)
    }

    /** The kind of the quick sheet that comes back now, if one was left from this chat of this computer; it is taken by `takeQuickSheetReturn` when the sheet opens. */
    fun returningQuickSheet(computerId: String, sessionId: String?, assistant: Boolean): String? {
        val sheet = quickSheetReturn ?: return null
        if (!assistant || sheet.computerId != computerId || sheet.sessionId != sessionId) return null
        return sheet.kind
    }

    fun takeQuickSheetReturn(kind: String, computerId: String, sessionId: String?): QuickSheetReturn? {
        val sheet = quickSheetReturn?.takeIf { it.kind == kind && it.computerId == computerId && it.sessionId == sessionId } ?: return null
        quickSheetReturn = null
        DuduLog.record("quick.sheet.restore", state = kind)
        return sheet
    }

    /** The conversation of an issue, when it has one (`issue.open`, as the iPhone's `BoardModel.session(ofIssue:)`); nil otherwise, and on a failure, which is logged. */
    suspend fun issueSession(id: Long): String? = try {
        request("issue.open", json("id" to id)).nullableString("sessionId")
    } catch (error: Exception) {
        if (error is CancellationException) throw error
        DuduLog.failure("issue.open.fail", error)
        null
    }

    /** An issue was made of a record (`IssueDraft.record`): the inbox's lists read again, and the record in full goes back to its list. */
    private fun inboxChanged(record: Long) {
        inboxChangesFlow.value = (inboxChangesFlow.value.first + 1) to record
        viewModelScope.launch { refreshInboxCount() }
    }

    fun selectHomeTab(tab: HomeTab) {
        quickSheetReturn = null
        if (state.value.conversationTitle != null) {
            conversationBack.clear()
            leaveConversation()
        }
        routes.clear()
        stopQuota()
        mutable.update { it.copy(homeTab = tab, route = null, panel = null, problem = null) }
        DuduLog.record("home.tab.select", state = tab.name.lowercase())
    }

    private fun receiveInboxCount(total: Int? = null, unread: Int) {
        mutable.update { it.copy(inboxWaiting = total?.coerceAtLeast(0) ?: it.inboxWaiting,
            inboxUnread = unread.coerceAtLeast(0)) }
    }

    suspend fun refreshInboxCount() {
        try {
            inboxList(json("tab" to "todo"))
        } catch (error: Exception) {
            if (error is CancellationException) throw error
            DuduLog.failure("inbox.count.fail", error)
        }
    }

    suspend fun inboxList(params: JSONObject): JSONObject {
        val current = generation
        val revision = inboxReadRevision
        val result = request("inbox.list", params)
        if (current == generation && revision == inboxReadRevision) {
            receiveInboxCount(result.optInt("total", result.rows("items").size)
                .takeIf { params.optString("tab", "todo") == "todo" && !params.has("connector") },
                result.optInt("unreadCount"))
        }
        return result
    }

    suspend fun acknowledgeInboxRecord(record: JSONObject) {
        if (!record.optBoolean("unread") || !record.has("revision")) return
        val current = generation
        inboxReadRevision++
        val result = request("inbox.read", json("id" to record.getLong("id"), "revision" to record.getLong("revision")))
        if (current != generation) return
        inboxReadRevision++
        receiveInboxCount(unread = result.optInt("unreadCount"))
    }

    /**
     * The background connection that shows the notifications (`DuduConnectionService`, as OpenClaw's app; owner, 2026-11-22) runs while a collector's bell is on and the phone lets the app
     * notify, as the iPhone registers for Apple's push then; it stops when no bell is on. `restart`: another computer may have become the one in use.
     */
    fun syncBackgroundNotifications(restart: Boolean = false) {
        val client = api ?: return
        val context = getApplication<Application>()
        viewModelScope.launch {
            try {
                val enabled = client.request("notifications.state").optBoolean("enabled")
                if (enabled && androidx.core.app.NotificationManagerCompat.from(context).areNotificationsEnabled())
                    app.dudu.android.background.DuduConnectionService.start(context, restart)
                else if (!enabled) app.dudu.android.background.DuduConnectionService.stop(context)
                DuduLog.record("notifications.sync", state = if (enabled) "on" else "off")
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("notifications.sync.fail", error)
            }
        }
    }

    /** A collector's notification was tapped: that computer's inbox, as the iPhone's `openCollectorNotification` (another computer is connected first). */
    private var pendingNotification: String? = null
    fun openNotification(computer: String) {
        DuduLog.record("notifications.open", state = if (computer == computerId) "same" else "other")
        if (computer == computerId && state.value.connected) { selectHomeTab(HomeTab.Inbox); return }
        // Opened from a notification with the app closed, or while it connects: the inbox opens once that computer is connected.
        pendingNotification = computer
        if (computer == computerId || !state.value.initialized || state.value.connecting) return
        state.value.computers.find { it.id == computer }?.let { connect(it.link) }
    }

    fun selectComputer(id: String) {
        DuduLog.record("computer.select", state = if (id == computerId) "same" else "other")
        state.value.computers.find { it.id == id }?.let { connect(it.link) }
    }

    suspend fun updateConnectionAddresses(id: String, values: List<ConnectionAddress>) {
        val current = generation
        val saved = state.value.computers.find { it.id == id } ?: throw ApiFailure("NOT_FOUND")
        val endpoint = try { Endpoint.parse(saved.link).withAddresses(values) }
            catch (_: Exception) { throw ApiFailure("INVALID_PARAMS") }
        val probe = DuduApi(endpoint, id, preserveAddresses = true)
        probe.language = state.value.language
        val verified = try { probe.verifyAddresses() } finally { probe.retire() }
        if (current != generation) throw CancellationException("Computer switched")
        val updated = state.value.computers.map {
            if (it.id == id) it.copy(link = verified.storedLink(), addressesEdited = true) else it
        }
        vault.write("computers", JSONArray(updated.map { it.json() }).toString())
        if (current != generation) throw CancellationException("Computer switched")
        mutable.update { it.copy(computers = updated) }
        if (computerId == id) connect(verified.storedLink()) else backRoute()
    }

    fun forgetComputer(id: String) {
        DuduLog.record("computer.forget", state = if (id == computerId) "current" else "other")
        viewModelScope.launch {
            val updated = state.value.computers.filterNot { it.id == id }
            vault.write("computers", JSONArray(updated.map { it.json() }).toString())
            mutable.update { it.copy(computers = updated) }
            // Its videos go with it, as on the iPhone (`VideoPreviewStorage.remove(for:)`).
            try { app.dudu.android.media.VideoPreviewStorage.remove(getApplication(), id) }
            catch (e: java.io.IOException) { DuduLog.failure("video.cache.remove.fail", e) }
            if (computerId == id) {
                val previous = api
                previous?.retire(); generation++; api = null; eventJob?.cancel(); watchJob?.cancel()
                if (previous != null) viewModelScope.launch(Dispatchers.IO) { runCatching { previous.disconnect() } }
                homes.clear(); savedHomeJson = null; sessions.clear(); cachedSessions.clear(); outboxes.clear()
                attachmentCache.clear()
                vault.delete("computer")
                mutable.update { UiState(initialized = true, computers = updated, language = it.language,
                    panel = Panel.Computers) }
            }
        }
    }

    private fun loadCatalog() {
        viewModelScope.launch {
            runCatching { request("catalog.get") }.onSuccess { result ->
                mutable.update { it.copy(catalog = result) }
            }
            runCatching { request("navigation.get") }.onFailure { error ->
                if (error is CancellationException) throw error
                // A plugin from before `navigation.get`: the drawer says so instead of listing nothing (the iPhone's `NavigationAvailability.unsupported`).
                if ((error as? ApiFailure)?.code in listOf("UNSUPPORTED", "METHOD_NOT_ALLOWED")) mutable.update { it.copy(navigationUnsupported = true) }
                DuduLog.failure("navigation.load.fail", error)
            }.onSuccess { result ->
                mutable.update { it.copy(navigation = result, navigationUnsupported = false) }
                // Kept for the next start, so the settings and the drawer list the same entries before the computer answers, as the iPhone's do.
                vault.write("navigation-${mutable.value.computerId}-${java.util.Locale.getDefault().language}", result.toString())
            }
        }
    }

    fun select(scope: Scope) {
        if (scope == state.value.scope) return
        mutable.update { it.copy(scope = scope, home = cachedHome(scope)) }
    }

    fun toggleBoardFilter(field: BoardFilterField, key: String?) {
        mutable.update { it.copy(boardFilters = it.boardFilters.toggle(field, key)) }
    }

    fun resetBoardFilters() {
        mutable.update { it.copy(boardFilters = BoardFilters()) }
    }

    fun preference(key: String, value: Any) {
        val updated = state.value.preferences.copyJson().put(key, value)
        mutable.update { it.copy(preferences = updated) }
        viewModelScope.launch { vault.write("preferences", updated.toString()) }
    }

    /** When the board last asked the computer for its list (nanoTime): the safety net below asks only when nothing has for a while. */
    private var boardAsked = 0L

    /**
     * Reads the board. `quiet` is a read nobody asked for with a finger (the computer said the board changed, the safety net, the app coming back): no spinner, no failure shown, and it never
     * cancels a read that is already on its way.
     */
    fun refresh(quiet: Boolean = false) {
        val client = api ?: return
        if (!state.value.connected) { DuduLog.record("board.load.skip", state = "disconnected"); return }
        if (quiet && refreshJob?.isActive == true) return
        // While a pin, a read mark or 完成 is being saved the board is not read (it would show the row as it was): it is read once they are all done (the iPhone's `refreshPending`).
        if (state.value.changing.isNotEmpty()) return
        refreshJob?.cancel()
        val revision = ++refreshRevision
        val currentGeneration = generation
        val began = System.nanoTime()
        boardAsked = began
        if (!quiet) mutable.update { it.copy(refreshing = true, boardLoadFailed = false) }
        refreshJob = viewModelScope.launch {
            try {
                val (home, raw) = client.home()
                if (currentGeneration != generation || revision != refreshRevision) return@launch
                homes.clear()
                homes[Scope.All] = home
                DuduLog.record("board.load.complete", elapsedMs = (System.nanoTime() - began) / 1_000_000,
                    counts = mapOf("rowCount" to home.rows.size.toLong(), "payloadBytes" to raw.length.toLong()))
                mutable.update { it.copy(home = home, refreshing = false, problem = null, computerUnavailable = false,
                    boardLoadFailed = false) }
                if (savedHomeJson != raw) {
                    // A canceled write may already have replaced the on-disk snapshot.
                    savedHomeJson = null
                    vault.write(cacheName(Scope.All), raw)
                    if (currentGeneration == generation && revision == refreshRevision) savedHomeJson = raw
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                // What was thrown and where: a list the app could not read is told apart from a computer it could not reach.
                DuduLog.failure("board.load.fail", error, elapsedMs = (System.nanoTime() - began) / 1_000_000,
                    state = if (currentGeneration == generation && revision == refreshRevision) "current" else "superseded")
                if (currentGeneration == generation && revision == refreshRevision) {
                    if (quiet) mutable.update { it.copy(refreshing = false) }
                    // A pull that fails while the board has rows says nothing, as on the iPhone: the rows stay (the 电脑未连接 notice still tells a lost connection).
                    else if (state.value.home != null) mutable.update { it.copy(refreshing = false,
                        computerUnavailable = it.computerUnavailable || visible && isConnectionProblem(code(error))) }
                    else mutable.update { it.copy(refreshing = false, boardLoadFailed = true, problem = code(error),
                        computerUnavailable = it.computerUnavailable || visible && isConnectionProblem(code(error))) }
                }
            }
        }
    }

    fun show(panel: Panel) {
        DuduLog.record("panel.show", state = panel.javaClass.simpleName)
        if (panel != Panel.Quota) stopQuota()
        mutable.update { it.copy(panel = panel, problem = null) }
        // The new-issue form reads its choices itself, without holding the page (`Panels`): the iPhone's buttons are buttons while they load.
        if (panel == Panel.Quota) loadQuota()
    }

    fun dismissPanel() {
        if (!state.value.busy && !state.value.connecting) {
            stopQuota()
            mutable.update { it.copy(panel = null, problem = null, draft = it.draft.copy(preparingPhotos = false)) }
        }
    }

    private fun stopQuota() {
        quotaRevision++
        quotaJob?.cancel()
        mutable.update { if (it.quotaLoading) it.copy(quotaLoading = false) else it }
    }

    /** Like the iPhone: ask once, then only read the pending result while the sheet remains open. */
    private fun loadQuota() {
        val client = api ?: return
        stopQuota()
        val revision = quotaRevision
        val currentGeneration = generation
        mutable.update { it.copy(quotaLoading = true) }
        quotaJob = viewModelScope.launch {
            try {
                for (attempt in 0..10) {
                    val result = client.request("quota.get", json("ask" to (attempt == 0)))
                    if (currentGeneration != generation || revision != quotaRevision || state.value.panel != Panel.Quota) return@launch
                    mutable.update { it.copy(quota = result) }
                    if (!result.optBoolean("refreshing")) break
                    if (attempt < 10) delay(3000)
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("quota.load.fail", error)
                if (currentGeneration == generation && revision == quotaRevision)
                    mutable.update { it.copy(problem = code(error),
                        computerUnavailable = it.computerUnavailable || visible && isConnectionProblem(code(error))) }
            } finally {
                if (currentGeneration == generation && revision == quotaRevision) mutable.update { it.copy(quotaLoading = false) }
            }
        }
    }

    fun editDraft(draft: IssueDraft) {
        mutable.update { it.copy(draft = draft, problem = null) }
    }

    private fun loadOptions() = operation { client ->
        val result = client.options()
        mutable.update { current ->
            current.copy(options = result, draft = current.draft.copy(
                status = current.draft.status ?: result.statuses.firstOrNull { it.isDefault }?.id))
        }
    }
    fun reloadOptions() { loadOptions() }
    fun receiveIssueOptions(options: Options) { mutable.update {
        // The default status, else the first, as the iPhone's form starts (an issue is not made without one).
        it.copy(options = options, problem = null, draft = it.draft.copy(
            status = it.draft.status ?: (options.statuses.firstOrNull { status -> status.isDefault } ?: options.statuses.firstOrNull())?.id))
    } }
    suspend fun issueOptions(): Options {
        val client = api ?: throw ApiFailure("CONNECTION_FAILED")
        val current = generation
        val result = client.options()
        if (current != generation) throw CancellationException("Computer switched")
        return result
    }

    suspend fun upload(uri: android.net.Uri, name: String, bytes: Long?, sessionId: String): JSONObject {
        val client = api ?: throw ApiFailure("CONNECTION_FAILED")
        val current = generation
        val resolver = getApplication<Application>().contentResolver
        val result = client.upload(sessionId, name, bytes) { resolver.openInputStream(uri) ?: throw ApiFailure("NOT_FOUND") }
        if (current != generation) throw CancellationException("Computer switched")
        return result
    }
    /** A video of the conversation into `file` (the in-app player's copy, `VideoPreviewStorage`); the computer must be the same when it is in. */
    suspend fun downloadVideo(params: JSONObject, file: java.io.File): String {
        val client = api ?: throw ApiFailure("CONNECTION_FAILED")
        val current = generation
        try {
            val type = client.video(params) { java.io.FileOutputStream(file) }
            if (current != generation) throw CancellationException("Computer switched")
            return type
        } catch (e: Exception) {
            withContext(Dispatchers.IO) { file.delete() }
            throw e
        }
    }

    suspend fun video(params: JSONObject, uri: android.net.Uri): String {
        val client = api ?: throw ApiFailure("CONNECTION_FAILED")
        val current = generation
        val resolver = getApplication<Application>().contentResolver
        try {
            val type = client.video(params) { resolver.openOutputStream(uri) ?: throw ApiFailure("NOT_FOUND") }
            if (current != generation) throw CancellationException("Computer switched")
            return type
        } catch (e: Exception) {
            withContext(Dispatchers.IO) { runCatching { android.provider.DocumentsContract.deleteDocument(resolver, uri) } }
            throw e
        }
    }

    /** The board's + : a new issue starts from an empty form every time, as the iPhone's sheet does (an abandoned draft is not kept). */
    fun newIssue() {
        editDraft(IssueDraft())
        show(Panel.Create)
    }

    /** `failed` is told when the computer did not make it: the form says 事项没能创建 and keeps what was typed, as the iPhone's does. */
    fun createIssue(failed: () -> Unit = {}) {
        val draft = state.value.draft
        if (!draft.valid || state.value.busy) return
        operation(onFailure = { failed() }) { client ->
            client.request("issue.create", draft.params())
            mutable.update { it.copy(panel = null, draft = IssueDraft()) }
            draft.record?.let(::inboxChanged)
            refresh()
        }
    }

    /** Pin or unpin a row: the shelf changes at once, the row shows its spinner until the computer answers, and a refusal puts it back and says 更改没能保存 (the iPhone's `setPinned`). */
    fun pin(row: Conversation) = changeHome(row, "board.pin", json("target" to row.id, "pinned" to !row.pinned)) {
        BoardChanges.pinned(it, row.id, !row.pinned)
    }

    /** Mark a row read or unread, at once, as `pin` does (the iPhone's `toggleUnread`). A row without a session has nothing to read. */
    fun read(row: Conversation) {
        val session = row.sessionId ?: return
        changeHome(row, "board.read", json("target" to row.id, "sessionId" to session, "unread" to !row.unread, "seq" to row.readSeq)) {
            BoardChanges.read(it, row.id, !row.unread)
        }
    }

    private fun changeHome(row: Conversation, method: String, params: JSONObject, apply: (Home) -> Home) {
        val client = api ?: return
        val current = state.value
        if (!current.connected || row.id in current.changing) return
        val currentGeneration = generation
        val before = current.home
        val beforeHomes = homes.toMap()
        beginChange(row.id)
        homes.replaceAll { _, home -> apply(home) }
        mutable.update { it.copy(home = it.home?.let(apply), panel = if (it.panel is Panel.Actions) null else it.panel) }
        viewModelScope.launch {
            try {
                client.request(method, params)
                DuduLog.record("board.change.complete", method = method)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("board.change.fail", error, method = method)
                if (currentGeneration == generation) {
                    // Only this row goes back: another one may have finished a change of its own meanwhile.
                    homes.replaceAll { scope, home -> beforeHomes[scope]?.let { BoardChanges.restore(home, it, row.id) } ?: home }
                    mutable.update { it.copy(home = it.home?.let { home -> before?.let { old -> BoardChanges.restore(home, old, row.id) } ?: home }) }
                    toast(word("更改没能保存"), ToastKind.Error)
                }
            } finally {
                if (currentGeneration == generation) finishChange(row.id)
            }
        }
    }

    /** A row's change begins: a read of the board already on its way would show the row as it was, so it is dropped and read again once every change is done. */
    private fun beginChange(id: String) {
        if (refreshJob?.isActive == true) { refreshJob?.cancel(); refreshRevision++ }
        mutable.update { it.copy(changing = it.changing + id, refreshing = false) }
        DuduLog.record("board.change.begin", counts = mapOf("rowCount" to state.value.changing.size.toLong()))
    }

    private fun finishChange(id: String) {
        mutable.update { it.copy(changing = it.changing - id) }
        if (state.value.changing.isEmpty()) refresh(quiet = true)
    }

    /** Rename from the board's menu: the dialog has closed already; a refusal says 更改没能保存 (the iPhone's `BoardView.rename`). */
    fun rename(issue: Issue, title: String) {
        val client = api ?: return
        val name = title.trim()
        if (name.isEmpty() || !state.value.connected) return
        val currentGeneration = generation
        mutable.update { it.copy(panel = null) }
        viewModelScope.launch {
            try {
                val changed = Issue.parse(client.request("issue.update", json("id" to issue.id, "patch" to json("title" to name))).getJSONObject("issue"))
                if (currentGeneration == generation) receiveIssue(changed)
                refresh(quiet = true)
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("issue.rename.fail", error)
                if (currentGeneration == generation) toast(word("更改没能保存"), ToastKind.Error)
            }
        }
    }

    /** A changed issue in the board's rows at once (its title, its status: a finished one leaves 进行中), before the board is read again (the iPhone's `BoardModel.change`). */
    private fun receiveIssue(changed: Issue) {
        fun Home.with(changed: Issue) = copy(rows = rows.map {
            if (it.issue?.id == changed.id) it.copy(title = changed.title, issue = changed) else it
        })
        homes.replaceAll { _, home -> home.with(changed) }
        mutable.update { it.copy(home = it.home?.with(changed)) }
    }

    /** A property sheet's save. It stays open while it saves; a refusal leaves it open, saying 更改没能保存 at its foot (the iPhone's `IssueActionsSheet`). */
    fun updateIssue(issue: Issue, patch: JSONObject) = operation(onFailure = { mutable.update { it.copy(problem = "conflict") } }) { client ->
        client.request("issue.update", json("id" to issue.id, "patch" to patch))
        mutable.update { it.copy(panel = null) }
        refresh()
    }

    /** 完成 from the swipe or the menu: the row shows its spinner while the computer moves the issue to its done status; a refusal says 更改没能保存 (the iPhone's `BoardModel.complete`). */
    fun complete(row: Conversation) {
        val client = api ?: return
        val issue = row.issue ?: return
        if (!state.value.connected || row.id in state.value.changing) return
        val currentGeneration = generation
        beginChange(row.id)
        mutable.update { it.copy(panel = if (it.panel is Panel.Actions) null else it.panel) }
        viewModelScope.launch {
            try {
                val done = client.options().statuses.firstOrNull { it.type == "done" } ?: throw ApiFailure("BAD_REQUEST")
                val changed = Issue.parse(client.request("issue.update", json("id" to issue.id, "patch" to json("status" to done.id))).getJSONObject("issue"))
                if (currentGeneration == generation) receiveIssue(changed)
                DuduLog.record("board.change.complete", method = "issue.update")
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("board.change.fail", error, method = "issue.update")
                if (currentGeneration == generation) toast(word("更改没能保存"), ToastKind.Error)
            } finally {
                if (currentGeneration == generation) finishChange(row.id)
            }
        }
    }

    fun addSubIssue(issue: Issue) {
        editDraft(IssueDraft(parent = issue.id, project = issue.project))
        show(Panel.Create)
    }

    fun assign(issue: Issue, project: Project, agent: String) {
        if (issue.agent != null || project.path.isNullOrBlank()) return
        operation(onFailure = { mutable.update { it.copy(problem = "conflict") } }) { client ->
            client.request("issue.assign", json("id" to issue.id, "project" to project.json(), "agent" to agent))
            mutable.update { it.copy(panel = null) }
            refresh()
        }
    }

    /** 删除 from the menu asks the computer first; a failure closes the menu and says 更改没能保存, the iPhone's toast. */
    fun previewDelete(issue: Issue) = operation(onFailure = {
        mutable.update { if (it.panel is Panel.Actions) it.copy(panel = null) else it }
        toast(word("更改没能保存"), ToastKind.Error)
    }) { client ->
        val result = client.request("issue.delete", json("id" to issue.id))
        require(result.getBoolean("preview") && result.getJSONObject("issue").getLong("id") == issue.id)
        mutable.update { it.copy(panel = Panel.Delete(issue, result.getString("token"))) }
    }

    fun confirmDelete() {
        val panel = state.value.panel as? Panel.Delete ?: return
        operation(onFailure = {
            mutable.update { if (it.panel is Panel.Delete) it.copy(panel = null) else it }
            toast(word("更改没能保存"), ToastKind.Error)
        }) { client ->
            val result = client.request("issue.delete", json("id" to panel.issue.id, "token" to panel.token))
            require(result.getBoolean("forgotten") && result.getLong("id") == panel.issue.id)
            mutable.update { it.copy(panel = null) }
            refresh()
        }
    }

    fun open(row: Conversation) {
        if (row.needsAgent) return
        openSession(row.sessionId, row.title, row.issue?.id, row.id == "assistant")
    }

    fun openSession(id: String?, title: String, issue: Long? = null, assistant: Boolean = false,
        subagent: JSONObject? = null, rememberReturn: Boolean = true) {
        watchJob?.cancel()
        val client = api ?: return
        val previous = state.value
        if (rememberReturn && (previous.conversationTitle != null || previous.route != null)) {
            conversationBack.add(ConversationReturn(previous.session?.id, previous.conversationTitle,
                previous.issueId, previous.isAssistant, subagentAddress, previous.route, routes.toList()))
        }
        routes.clear()
        subagentAddress = subagent
        val currentGeneration = generation
        val nextWatch = UUID.randomUUID().toString()
        watchId = nextWatch
        val began = System.nanoTime()
        DuduLog.record("conversation.open", requestId = nextWatch,
            state = if (assistant) "assistant" else if (subagent != null) "subagent" else if (id == null) "issue" else "session")
        mutable.update { it.copy(opening = true, conversationTitle = title,
            session = id?.let(cachedSessions::get)?.copy(watchId = nextWatch), conversationKey = nextWatch,
            issueId = issue, message = "", attachments = emptyList(), outbox = emptyList(),
            pending = null, sending = false, panel = null, route = null, problem = null,
            readOnly = subagent != null, isAssistant = assistant, pageLoading = false, pageFailure = null) }
        watchJob = viewModelScope.launch {
            try {
                val resolved = if (assistant) client.request("assistant.open").getString("id")
                    else id ?: client.request("issue.open", json("id" to issue)).nullableString("sessionId")
                        ?: throw ApiFailure("NOT_FOUND")
                fun current() = currentGeneration == generation && watchId == nextWatch
                if (!current()) return@launch
                val inMemory = sessions[resolved]
                val cache = if (inMemory != null) withContext(Dispatchers.Default) {
                    Session.parse(cachedSession(inMemory.raw), nextWatch, cached = true)
                } else vault.read(storageKey("session", computerId, resolved))?.let { raw ->
                    withContext(Dispatchers.Default) { runCatching { Session.parse(JSONObject(raw), nextWatch, cached = true) }.getOrNull() }
                }
                val name = draftName(resolved)
                val saved = draftWrites.withLock { vault.read(name)?.let { raw -> withContext(Dispatchers.Default) { JSONObject(raw) } } }
                val outgoing = outboxes[resolved] ?: vault.read(storageKey("outbox", computerId, resolved))?.let {
                    withContext(Dispatchers.Default) { runCatching { JSONArray(it).objects().map(Outgoing::parse) }.getOrNull() }
                }.orEmpty().map { if (!it.accepted) it.copy(failed = true) else it }
                if (!current()) return@launch
                outboxes[resolved] = outgoing
                inputRequestId = saved?.nullableString("requestId")
                mutable.update { it.copy(session = cache, opening = cache == null,
                    message = saved?.optString("text").orEmpty(), attachments = saved?.rows("attachments").orEmpty(),
                    outbox = outgoing, sending = sendingDrafts.containsKey(name)) }
                val params = json("id" to resolved, "watchId" to nextWatch, "transcript" to true)
                subagent?.let { params.put("subagent", it) }
                val detail = client.request("session.watch", params)
                if (!current()) return@launch
                receiveSession(detail, nextWatch, resolved)
                if (!current()) return@launch
                restoreUnsent(resolved)
                DuduLog.record("conversation.open.complete", requestId = nextWatch, elapsedMs = (System.nanoTime() - began) / 1_000_000,
                    state = if (cache == null) "fresh" else "cached",
                    counts = mapOf("messageCount" to (state.value.session?.messages?.size ?: 0).toLong(), "pendingCount" to outgoing.size.toLong()))
                mutable.update { it.copy(opening = false) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("conversation.open.fail", error, requestId = nextWatch, elapsedMs = (System.nanoTime() - began) / 1_000_000,
                    state = if (currentGeneration == generation && watchId == nextWatch) "current" else "superseded")
                if (currentGeneration == generation && watchId == nextWatch)
                    mutable.update { it.copy(opening = false, problem = code(error),
                        computerUnavailable = it.computerUnavailable || visible && isConnectionProblem(code(error))) }
            }
        }
    }

    fun leaveConversation() {
        val oldWatch = watchId
        DuduLog.record("conversation.close", requestId = oldWatch)
        watchId = null
        watchJob?.cancel()
        val returning = conversationBack.removeLastOrNull()
        if (returning?.title != null) {
            openSession(returning.id, returning.title, returning.issue, returning.assistant,
                returning.subagent, rememberReturn = false)
            routes.clear(); routes.addAll(returning.routes)
            mutable.update { it.copy(route = returning.route) }
            return
        }
        subagentAddress = null
        routes.clear(); returning?.let { routes.addAll(it.routes) }
        mutable.update { it.copy(session = null, conversationTitle = null, opening = false,
            message = "", attachments = emptyList(), outbox = emptyList(), issueId = null,
            pending = null, sending = false, problem = null, readOnly = false,
            route = returning?.route, pageLoading = false, pageFailure = null) }
        api?.let { client ->
            viewModelScope.launch {
                if (oldWatch != null) runCatching { client.request("session.unwatch", json("watchId" to oldWatch)) }
                refresh()
            }
        }
    }

    /** Answer `issue` (its `id`, `ref`, `title`) from 嘟嘟's conversation: its @ goes into the box as a 回复 there does. */
    private var toastCount = 0L
    /** A message at the top of the page, as the iPhone's toast: `text` is a key of the app's words (written with `word`) unless `literal` (the plugin's own words). */
    fun toast(text: String, kind: ToastKind = ToastKind.Information, literal: Boolean = false, args: List<String> = emptyList()) =
        mutable.update { it.copy(toast = Toast(++toastCount, text, kind, literal, args)) }
    fun dismissToast(id: Long) = mutable.update { if (it.toast?.id == id) it.copy(toast = null) else it }

    fun reply(issue: JSONObject) = mutable.update { it.copy(replyRequest = issue) }
    fun replied() = mutable.update { it.copy(replyRequest = null) }

    fun editMessage(value: String) {
        if (state.value.sending) return
        inputRequestId = null
        mutable.update { it.copy(message = value, problem = null) }
        persistDraft()
    }

    fun attach(file: JSONObject) {
        if (state.value.sending) return
        mutable.update { it.copy(attachments = it.attachments + file, problem = null) }
        inputRequestId = null
        persistDraft()
    }

    fun removeAttachment(index: Int) {
        mutable.update { it.copy(attachments = it.attachments.filterIndexed { i, _ -> i != index }) }
        inputRequestId = null
        persistDraft()
    }

    private fun persistDraft() {
        val active = state.value
        val id = active.session?.id ?: return
        val name = draftName(id)
        val text = active.message
        val attachments = active.attachments
        viewModelScope.launch {
            writeDraft(name, text, attachments)
        }
    }

    fun send() {
        val active = state.value
        val session = active.session ?: return
        if ((active.message.isBlank() && active.attachments.isEmpty()) || active.sending || active.readOnly) return
        // In 嘟嘟's conversation a message that starts with @ goes to that issue's agent, or is not sent and the box says why; the draft stays (the iPhone's `forwardAssistant`).
        if (active.isAssistant && active.message.trim().startsWith("@")) {
            val address = GroupChat.address(active.message)
            if (address == null || address.body.isEmpty()) {
                mutable.update { it.copy(problem = "RELAY_" + if (address == null) "recipient_unavailable" else "empty_request") }
                return
            }
        }
        val next = inputRequestId ?: UUID.randomUUID().toString().also { inputRequestId = it }
        submit(session, Outgoing(next, active.message, active.attachments))
    }

    /** The issue last chosen from the list of 嘟嘟's box: its own session goes with a message to it, so a message never reaches a session the issue has since left (the iPhone's `assistantRecipient`). */
    var assistantRecipient: JSONObject? = null
    /** A message to an issue whose note was saved but not delivered: sending the same message again retries that note instead of writing another (the iPhone's `assistantRelayRetry`). */
    private var assistantRelayRetry: Pair<String, Long>? = null

    /** Voice uses the same durable input journal, keeping the existing text/attachment draft. */
    fun acceptVoice(result: VoiceResult): Boolean {
        val active = state.value
        val session = active.session ?: return true
        if (result.target != VoiceTarget(active.computerId, session.id) || active.readOnly ||
            !visible || active.route != null || active.panel != null) return true
        if (active.sending) return false
        if (!result.isFinal) {
            editMessage(appendVoiceDraft(active.message, result.text))
        } else if (result.text.isNotBlank()) {
            submit(session, Outgoing(UUID.randomUUID().toString(), result.text, emptyList()), ownsDraft = false)
        }
        return true
    }

    /** A spoken message that did not go, for a conversation that is not open: added to its saved draft (no list of failed messages keeps it). */
    private suspend fun restoreSpokenDraft(name: String, text: String) = draftWrites.withLock {
        val saved = vault.read(name)?.let { raw -> withContext(Dispatchers.Default) { runCatching { JSONObject(raw) }.getOrNull() } }
        val restored = json("text" to appendVoiceDraft(saved?.optString("text").orEmpty(), text),
            "attachments" to (saved?.optJSONArray("attachments") ?: JSONArray()))
        vault.write(name, restored.toString())
    }

    /**
     * What this phone never got onto the computer (the app ended while it was on its way) goes back into the box once the conversation has been read, as a failed send does: no list of failed
     * messages keeps it (owner, 2026-11-22). The draft's own input keeps its id; another is added to the draft.
     */
    private suspend fun restoreUnsent(sessionId: String) {
        val unsent = outboxes[sessionId].orEmpty().filter { it.failed && it.requestId !in sendingDrafts.values }
        val active = state.value
        if (unsent.isEmpty() || active.session?.id != sessionId || active.sending) return
        val ids = unsent.mapTo(HashSet()) { it.requestId }
        val others = unsent.filter { it.requestId != inputRequestId }
        var text = active.message
        var attachments = active.attachments
        others.forEach { text = appendVoiceDraft(text, it.text); attachments = attachments + it.attachments }
        if (others.isNotEmpty())
            inputRequestId = if (active.message.isEmpty() && active.attachments.isEmpty() && others.size == 1) others[0].requestId else null
        outboxes[sessionId] = outboxes[sessionId].orEmpty().filterNot { it.requestId in ids }
        mutable.update { it.copy(outbox = outboxes[sessionId].orEmpty(), message = text, attachments = attachments) }
        DuduLog.record("message.draft.restored", counts = mapOf("pendingCount" to unsent.size.toLong()))
        writeOutbox(storageKey("outbox", computerId, sessionId), outboxes[sessionId].orEmpty())
        if (others.isNotEmpty()) writeDraft(draftName(sessionId), text, attachments, inputRequestId)
    }

    private fun submit(session: Session, sent: Outgoing, ownsDraft: Boolean = true) {
        val client = api ?: return
        val next = sent.requestId
        val currentGeneration = generation
        val name = draftName(session.id)
        val outgoingKey = storageKey("outbox", computerId, session.id)
        val assistant = state.value.isAssistant
        if (sendingDrafts.containsKey(name)) return
        val mention = if (assistant && sent.text.trim().startsWith("@")) GroupChat.address(sent.text)?.takeIf { it.body.isNotEmpty() } else null
        val forwarded = mention != null
        // Sent while the agent runs, it waits in the queue's panel from the start, not in the history (the iPhone: `placement: selectedSession.status == "running" ? .queued : .transcript`).
        val outgoing = sent.copy(queued = session.processing && !forwarded)
        val began = System.nanoTime()
        DuduLog.record("message.send.begin", requestId = next, state = if (outgoing.failed) "retry" else "first",
            counts = mapOf("attachmentCount" to outgoing.attachments.size.toLong()))
        sendingDrafts[name] = next
        val updated = outboxes[session.id].orEmpty().filterNot { it.requestId == next } + outgoing
        outboxes[session.id] = updated
        mutable.update { it.copy(sending = true, message = if (ownsDraft) "" else it.message,
            attachments = if (ownsDraft) emptyList() else it.attachments, outbox = updated, problem = null) }
        viewModelScope.launch {
            try {
                // The input and its stable identity are durable before any network mutation.
                writeOutbox(outgoingKey, updated)
                if (ownsDraft) writeDraft(name, outgoing.text, outgoing.attachments, next)
                val receipt = if (forwarded) {
                    val params = json("sessionId" to session.id, "id" to mention!!.id, "text" to mention.body,
                        "attachments" to JSONArray(outgoing.attachments.filter { it.has("dataBase64") }),
                        "files" to JSONArray(outgoing.attachments.filter { it.has("receiptId") }))
                    assistantRecipient?.takeIf { (it.nullableString("ref") ?: "#${it.optLong("id")}").equals(mention.id, ignoreCase = true) }
                        ?.nullableString("session")?.let { params.put("session", it) }
                    val signature = "$computerId\n$params"
                    assistantRelayRetry?.takeIf { it.first == signature }?.let { params.put("retryEntry", it.second) }
                    params.put("requestId", next)
                    val relayed = client.request("assistant.forward", params)
                    // The plugin's answer says whether the agent got it; a refusal keeps the draft and says why in the plugin's approved words (`AssistantRelayResult.errorText`).
                    if (relayed.optString("outcome") !in listOf("success", "no_op")) {
                        val saved = relayed.optBoolean("saved")
                        if (saved && relayed.has("entryId")) assistantRelayRetry = signature to relayed.getLong("entryId")
                        throw ApiFailure("RELAY_" + if (saved) "delivery_failed" else relayed.optString("code").ifEmpty { "error" })
                    }
                    assistantRelayRetry = null
                    relayed
                } else client.request("session.send", json("id" to session.id, "text" to outgoing.text,
                    "requestId" to next, "attachments" to JSONArray(outgoing.attachments.map { attachment ->
                        attachment.copyJson().apply { if (has("receiptId")) remove("name") }
                    })))
                if (!forwarded && receipt.optString("requestId") != next) throw ApiFailure("PROTOCOL_ERROR")
                DuduLog.record("message.send.accepted", requestId = next, elapsedMs = (System.nanoTime() - began) / 1_000_000,
                    state = if (forwarded) "forwarded" else "sent")
                clearSentDraft(name, next)
                if (currentGeneration != generation) return@launch
                changeOutgoing(session.id, next) { it.copy(accepted = true) }
                if (forwarded) {
                    outboxes[session.id] = outboxes[session.id].orEmpty().filterNot { it.requestId == next }
                    writeOutbox(outgoingKey, outboxes[session.id].orEmpty())
                    if (state.value.session?.id == session.id) mutable.update { it.copy(outbox = outboxes[session.id].orEmpty()) }
                }
                if (state.value.session?.id == session.id) {
                    if (ownsDraft) inputRequestId = null
                    mutable.update { it.copy(sending = false) }
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                fun received() = next in observedInputs || sessions[session.id]?.observed(next) == true
                // `admitted`: the answer was lost and the conversation shows the message all the same.
                DuduLog.failure("message.send.fail", error, requestId = next, elapsedMs = (System.nanoTime() - began) / 1_000_000,
                    state = if (received()) "admitted" else "failed")
                val refused = (error as? ApiFailure)?.code?.takeIf { it.startsWith("RELAY_") }
                if (refused != null && currentGeneration == generation) {
                    // The plugin refused the message to an issue (no agent, no project, not delivered…): it is no message waiting to be sent again. The draft and its attachments
                    // come back and the box says why, as on the iPhone.
                    outboxes[session.id] = outboxes[session.id].orEmpty().filterNot { it.requestId == next }
                    writeOutbox(outgoingKey, outboxes[session.id].orEmpty())
                    if (state.value.session?.id == session.id) {
                        if (ownsDraft) inputRequestId = null
                        mutable.update { it.copy(sending = false, outbox = outboxes[session.id].orEmpty(),
                            message = if (ownsDraft) outgoing.text else it.message,
                            attachments = if (ownsDraft) outgoing.attachments else it.attachments, problem = refused) }
                    }
                } else if (currentGeneration == generation) {
                    val admitted = received()
                    if (admitted) {
                        changeOutgoing(session.id, next) { it.copy(failed = false) }
                        // A watch may admit the input while its failed HTTP receipt is being saved.
                        clearSentDraft(name, next)
                    } else {
                        // No list keeps a message that did not go (owner, 2026-11-22, as the iPhone): it comes back to the box, its input keeping its id for the next try, and a
                        // spoken one is added to the draft.
                        outboxes[session.id] = outboxes[session.id].orEmpty().filterNot { it.requestId == next }
                        writeOutbox(outgoingKey, outboxes[session.id].orEmpty())
                        if (!ownsDraft && state.value.session?.id != session.id) restoreSpokenDraft(name, outgoing.text)
                    }
                    if (state.value.session?.id == session.id) {
                        if (ownsDraft) inputRequestId = next.takeUnless { admitted }
                        else if (!admitted) inputRequestId = null
                        mutable.update { it.copy(sending = false, outbox = outboxes[session.id].orEmpty(),
                            message = if (!ownsDraft) (if (admitted) it.message else appendVoiceDraft(it.message, outgoing.text))
                                else if (admitted) "" else outgoing.text,
                            attachments = if (!ownsDraft) it.attachments else if (admitted) emptyList() else outgoing.attachments,
                            problem = if (admitted) null else "SEND_FAILED") }
                        if (!ownsDraft && !admitted) persistDraft()
                    }
                }
            } finally {
                if (sendingDrafts[name] == next) sendingDrafts.remove(name)
                observedInputs.remove(next)
            }
        }
    }

    private suspend fun changeOutgoing(id: String, requestId: String, change: (Outgoing) -> Outgoing) {
        outboxes[id] = outboxes[id].orEmpty().map { if (it.requestId == requestId) change(it) else it }
        if (state.value.session?.id == id) mutable.update { it.copy(outbox = outboxes[id].orEmpty()) }
        val key = storageKey("outbox", computerId, id)
        writeOutbox(key, outboxes[id].orEmpty())
    }

    private suspend fun writeOutbox(key: String, values: List<Outgoing>) = outboxWrites.withLock {
        val raw = withContext(Dispatchers.Default) { JSONArray(values.map { it.json() }).toString() }
        vault.write(key, raw)
    }

    private suspend fun writeDraft(name: String, text: String, attachments: List<JSONObject>, requestId: String? = null) = draftWrites.withLock {
        val raw = withContext(Dispatchers.Default) { json("text" to text, "attachments" to JSONArray(attachments)).apply {
            requestId?.let { put("requestId", it) }
        }.toString() }
        vault.write(name, raw)
    }

    private suspend fun clearSentDraft(name: String, requestId: String) = draftWrites.withLock {
        val saved = vault.read(name)?.let { raw -> withContext(Dispatchers.Default) { JSONObject(raw) } }
        if (saved?.nullableString("requestId") == requestId) vault.write(name, json("text" to "").toString())
        Unit
    }

    private fun updateSession(session: Session) {
        sessions.remove(session.id)
        sessions[session.id] = session
        while (sessions.size > 6) {
            val expired = sessions.keys.first()
            sessions.remove(expired); cachedSessions.remove(expired)
        }
        sendingDrafts.values.filter { session.observed(it) }.forEach(observedInputs::add)
        val receivedDraft = inputRequestId?.takeIf(session::observed)
        if (receivedDraft != null) {
            inputRequestId = null
            val name = draftName(session.id)
            viewModelScope.launch { clearSentDraft(name, receivedDraft) }
        }
        outboxes[session.id] = outboxes[session.id].orEmpty().filterNot { session.observed(it.requestId) }
        val outgoingKey = storageKey("outbox", computerId, session.id)
        val sessionKey = storageKey("session", computerId, session.id)
        val currentGeneration = generation
        val outgoing = outboxes[session.id].orEmpty()
        mutable.update { current -> current.copy(session = session, outbox = outgoing,
            message = if (receivedDraft != null) "" else current.message,
            attachments = if (receivedDraft != null) emptyList() else current.attachments,
            problem = if (receivedDraft != null && current.problem == "SEND_FAILED" || current.problem?.let(::isConnectionProblem) == true)
                null else current.problem, computerUnavailable = false) }
        viewModelScope.launch {
            writeOutbox(outgoingKey, outgoing)
            val cached = withContext(Dispatchers.Default) {
                val safe = cachedSession(session.raw)
                Session.parse(safe, session.watchId, cached = true) to safe.toString()
            }
            if (currentGeneration == generation && sessions[session.id] === session) cachedSessions[session.id] = cached.first
            vault.write(sessionKey, cached.second)
        }
    }

    private suspend fun receiveSession(raw: JSONObject, expectedWatch: String, expectedId: String) {
        if (raw.optJSONObject("session")?.optString("id") != expectedId) throw ApiFailure("PROTOCOL_ERROR")
        while (watchId == expectedWatch) {
            val previous = state.value.session
            val parsed = withContext(Dispatchers.Default) { Session.parse(raw, expectedWatch, previous) }
            if (watchId != expectedWatch) return
            if (state.value.session === previous) { updateSession(parsed); return }
        }
    }

    fun older() {
        val session = state.value.session ?: return
        val transcript = session.transcript ?: return
        if (state.value.pageLoading || !transcript.optBoolean("hasMore")) return
        mutable.update { it.copy(pageLoading = true, pageFailure = null) }
        viewModelScope.launch {
            try {
                val result = request("session.page", json("id" to session.id,
                    "throughSeq" to transcript.getLong("throughSeq"), "beforeSeq" to transcript.getLong("beforeSeq")))
                if (state.value.session?.watchId != session.watchId) return@launch
                while (state.value.session?.watchId == session.watchId) {
                    val current = state.value.session!!
                    val decoded = withContext(Dispatchers.Default) {
                        val raw = current.raw.copyJson().put("transcript",
                            mergeTranscript(result.getJSONObject("transcript"), current.transcript!!))
                        Session.parse(raw, session.watchId)
                    }
                    if (state.value.session === current) { updateSession(decoded); break }
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                DuduLog.failure("conversation.page.fail", e)
                // Said at the top of the history with 重试, as on the iPhone (owner's audit, 2026-11-22, A25), not over the box.
                if (state.value.session?.watchId == session.watchId) mutable.update { it.copy(pageFailure = code(e)) }
            } finally { if (state.value.session?.watchId == session.watchId) mutable.update { it.copy(pageLoading = false) } }
        }
    }

    fun acknowledge(session: Session) {
        if (watchId != session.watchId || session.readPosition == null || !visible || state.value.panel != null || state.value.route != null || session.cached) return
        val client = api ?: return
        viewModelScope.launch {
            runCatching { client.request("session.read", json("id" to session.id,
                "watchId" to session.watchId, "position" to session.readPosition)) }
        }
    }

    fun clearProblem() = mutable.update { it.copy(problem = null) }

    /** `onFailure`, when given, says the failure in its own way (the iPhone's words for that place) instead of the plugin's code in `problem`. */
    private fun operation(onFailure: (() -> Unit)? = null, block: suspend (DuduApi) -> Unit) {
        val client = api ?: return
        if (state.value.busy || !state.value.connected) return
        val currentGeneration = generation
        mutable.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try { block(client) }
            catch (error: Exception) {
                if (error is CancellationException) throw error
                DuduLog.failure("operation.fail", error)
                if (currentGeneration == generation) {
                    mutable.update { it.copy(problem = if (onFailure == null) code(error) else it.problem,
                        computerUnavailable = it.computerUnavailable || visible && isConnectionProblem(code(error))) }
                    onFailure?.invoke()
                }
            } finally {
                if (currentGeneration == generation) mutable.update { it.copy(busy = false) }
            }
        }
    }

    private fun startEvents() {
        if (eventJob?.isActive == true) return
        val client = api ?: return
        val currentGeneration = generation
        eventJob = viewModelScope.launch {
            DuduLog.record("events.start")
            var quiet = 0L
            var reconnects = 0
            try { while (visible && currentGeneration == generation) {
                try {
                    val asked = System.nanoTime()
                    val batch = client.events(eventCursor)
                    eventCursor = batch.getLong("cursor")
                    reconnects = 0
                    var changed = false
                    val events = batch.getJSONArray("events").objects()
                    // Every poll that brought something is a line; the ones that only waited are counted, a line for every ten (about four minutes).
                    if (events.isEmpty()) {
                        quiet += 1
                        if (quiet % 10 == 0L) DuduLog.record("events.idle", counts = mapOf("attempt" to quiet))
                    } else {
                        quiet = 0
                        DuduLog.record("events.batch", elapsedMs = (System.nanoTime() - asked) / 1_000_000,
                            counts = mapOf("eventCount" to events.size.toLong()),
                            state = if (state.value.conversationTitle == null) "board" else "conversation",
                            detail = events.map { it.optString("topic") }.distinct().take(3).joinToString(":").take(64))
                    }
                    events.forEach { event ->
                        val topic = event.getString("topic")
                        val params = event.getJSONObject("params")
                        if (topic == "session.snapshot") {
                            val active = state.value.session
                            if (active != null && params.optString("watchId") == watchId &&
                                params.optJSONObject("session")?.optString("id") == active.id) {
                                receiveSession(params, active.watchId, active.id)
                            }
                            changed = true
                        } else if (topic == "session.watch.failed" && params.optString("watchId") == watchId) {
                            throw ApiFailure("UPSTREAM_UNAVAILABLE")
                        } else if (topic.startsWith("board.") || topic.startsWith("issue.") ||
                            topic.startsWith("sessions.")) changed = true
                    }
                    // The computer says the board changed: read it now. Otherwise this poll, which comes back at least every 25 s, is the safety net: it reads a board nothing has read for 20 s.
                    if (state.value.conversationTitle == null && (changed || System.nanoTime() - boardAsked > 20_000_000_000L)) refresh(quiet = true)
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    DuduLog.failure("events.fail", error, state = if (visible) "foreground" else "background")
                    // Read-only reconnects never replay a mutation or discard the cached home.
                    val failure = code(error)
                    mutable.update { it.copy(problem = failure, connectionFailure = failure,
                        pairingRequired = it.pairingRequired || requiresNewPairing(failure),
                        connected = it.connected && retriesConnection(failure),
                        computerUnavailable = visible && isConnectionProblem(code(error))) }
                    if (!retriesConnection(failure)) break
                    // Waits longer after each failure, 1 s up to 30 s, as the iPhone's `scheduleReconnect` does; a poll that comes back starts again from 1 s.
                    reconnects++
                    delay(reconnectDelayMillis(reconnects))
                    val again = System.nanoTime()
                    try {
                        client.connect()
                        if (currentGeneration != generation) break
                        val savedLink = client.endpoint.storedLink()
                        vault.write("computer", json("id" to computerId, "name" to state.value.computer, "link" to savedLink).toString())
                        if (currentGeneration != generation) break
                        val computers = state.value.computers.map { if (it.id == computerId) it.copy(link = savedLink) else it }
                        vault.write("computers", JSONArray(computers.map { it.json() }).toString())
                        if (currentGeneration != generation) break
                        mutable.update { it.copy(computers = computers, problem = null, computerUnavailable = false,
                            connectionFailure = null, pairingRequired = false) }
                        eventCursor = 0
                        state.value.session?.let { active ->
                            val params = json("id" to active.id, "watchId" to active.watchId, "transcript" to true)
                            subagentAddress?.let { params.put("subagent", it) }
                            val detail = client.request("session.watch", params)
                            receiveSession(detail, active.watchId, active.id)
                        }
                        DuduLog.record("events.reconnect.complete", elapsedMs = (System.nanoTime() - again) / 1_000_000)
                        refresh()
                    }
                    catch (e: Exception) {
                        if (e is CancellationException) throw e
                        DuduLog.failure("events.reconnect.fail", e, elapsedMs = (System.nanoTime() - again) / 1_000_000,
                            counts = mapOf("attempt" to reconnects.toLong()))
                        if (!retriesConnection(code(e))) {
                            mutable.update { it.copy(connected = false, problem = code(e),
                                connectionFailure = code(e), pairingRequired = it.pairingRequired || requiresNewPairing(code(e)),
                                computerUnavailable = false) }
                            break
                        }
                    }
                }
            } } finally {
                DuduLog.record("events.stop", state = if (currentGeneration != generation) "superseded" else if (visible) "foreground" else "background")
            }
        }
    }

    private suspend fun restoreHomes() {
        val current = generation
        // A full snapshot supersedes the per-scope caches from older app builds.
        for (scope in listOf(Scope.All, Scope.Active)) {
            if (Scope.All in homes) return
            if (homes.containsKey(scope)) continue
            val raw = vault.read(cacheName(scope)) ?: continue
            val home = withContext(Dispatchers.Default) { runCatching { Home.parse(JSONObject(raw), scope) }.getOrNull() }
            if (current != generation) return
            if (home != null) {
                homes[scope] = home
                if (scope == Scope.All) savedHomeJson = raw
            }
        }
    }

    private fun cachedHome(scope: Scope) = homes[Scope.All] ?: homes[scope]

    private fun cacheName(scope: Scope) = "home-$computerId-${scope.wire}"
    private fun draftName(id: String) = "draft-" + java.security.MessageDigest.getInstance("SHA-256")
        .digest("$computerId:$id".toByteArray()).joinToString("") { "%02x".format(it) }
    private fun code(error: Exception) = (error as? ApiFailure)?.code ?: "CONNECTION_FAILED"
}
