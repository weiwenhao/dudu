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

data class UiState(
    val initialized: Boolean = false, val computer: String = "", val connected: Boolean = false,
    val connecting: Boolean = false, val scope: Scope = Scope.Active, val home: Home? = null,
    val refreshing: Boolean = false, val problem: String? = null, val panel: Panel? = null,
    val busy: Boolean = false, val options: Options? = null, val draft: IssueDraft = IssueDraft(),
    val session: Session? = null, val conversationTitle: String? = null, val opening: Boolean = false,
    val message: String = "", val sending: Boolean = false, val pending: Message? = null,
    val quota: JSONObject? = null, val quotaLoading: Boolean = false,
    val computers: List<SavedComputer> = emptyList(), val computerId: String = "",
    val route: Route? = null, val navigation: JSONObject = json(), val catalog: JSONObject = json(),
    val attachments: List<JSONObject> = emptyList(), val outbox: List<Outgoing> = emptyList(),
    val issueId: Long? = null, val pageLoading: Boolean = false, val language: String = "",
    val readOnly: Boolean = false,
    val isAssistant: Boolean = false,
    val preferences: JSONObject = json(),
    val conversationKey: String = "",
    val boardFilters: BoardFilters = BoardFilters(),
    val computerUnavailable: Boolean = false,
)

class DuduViewModel(application: Application) : AndroidViewModel(application) {
    private val vault = Vault(application)
    private val mutable = MutableStateFlow(UiState())
    val state = mutable.asStateFlow()
    private var api: DuduApi? = null
    private var computerId = ""
    private var generation = 0
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
    private val routes = mutableListOf<Route>()
    private data class ConversationReturn(val id: String?, val title: String?, val issue: Long?,
        val assistant: Boolean, val subagent: JSONObject?, val route: Route?, val routes: List<Route>)
    private val conversationBack = mutableListOf<ConversationReturn>()
    private var subagentAddress: JSONObject? = null
    private var pendingLink: String? = null

    init {
        viewModelScope.launch {
            val computers = vault.read("computers")?.let {
                runCatching { JSONArray(it).objects().map(SavedComputer::parse) }.getOrNull()
            }.orEmpty()
            val language = vault.read("language").orEmpty()
            val preferences = vault.read("preferences")?.let { runCatching { JSONObject(it) }.getOrNull() } ?: json()
            mutable.update { it.copy(computers = computers, language = language, preferences = preferences,
                scope = Scope.entries.find { s -> s.wire == preferences.optString("scope") } ?: Scope.Active) }
            val saved = vault.read("computer")
            if (saved != null) {
                try {
                    val data = JSONObject(saved)
                    computerId = data.getString("id")
                    val link = data.getString("link")
                    val endpoint = Endpoint.parse(link)
                    if (!computerId.matches(Regex("[A-Za-z0-9_-]{1,100}"))) error("Invalid identity")
                    restoreHomes()
                    api = DuduApi(endpoint, computerId)
                    mutable.update { it.copy(computer = data.getString("name"), initialized = true,
                        home = cachedHome(it.scope), computerId = computerId) }
                    if (visible && pendingLink == null) connect(link)
                } catch (_: Exception) {
                    mutable.update { it.copy(initialized = true, panel = Panel.Computers) }
                }
            } else mutable.update { it.copy(initialized = true, panel = Panel.Computers) }
            pendingLink?.let { pendingLink = null; connect(it) }
        }
    }

    fun openPairingLink(value: String) {
        if (!state.value.initialized) pendingLink = value else connect(value)
    }

    fun foreground(active: Boolean) {
        visible = active
        if (!active) {
            eventJob?.cancel()
            mutable.update { it.copy(computerUnavailable = false) }
            return
        }
        if (state.value.connected) startEvents()
        else if (state.value.initialized && api != null && !state.value.connecting) {
            viewModelScope.launch {
                vault.read("computer")?.let { connect(JSONObject(it).getString("link")) }
            }
        }
    }

    fun connect(link: String, displayName: String? = null) {
        val endpoint = try { Endpoint.parse(link) } catch (_: Exception) {
            mutable.update { it.copy(problem = "INVALID_LINK") }; return
        }
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
        mutable.update { it.copy(connecting = true, connected = false, busy = false, sending = false, refreshing = false,
            session = null, conversationTitle = null, opening = false, problem = null, computerUnavailable = false) }
        connectionJob = viewModelScope.launch {
            try {
                previousApi?.let { runCatching { it.disconnect() } }
                val computer = candidate.connect()
                if (next != generation) return@launch
                val id = computer.getString("id")
                val name = displayName?.trim()?.take(100)?.takeIf(String::isNotEmpty)
                    ?: savedComputer?.name ?: computer.getString("name")
                require(id.matches(Regex("[A-Za-z0-9_-]{1,100}")))
                if (computerId != id) {
                    homes.clear(); savedHomeJson = null; sessions.clear(); cachedSessions.clear(); outboxes.clear()
                }
                computerId = id
                routes.clear()
                conversationBack.clear(); subagentAddress = null
                api = candidate
                eventCursor = 0
                watchId = null
                restoreHomes()
                if (next != generation) return@launch
                val savedLink = candidate.endpoint.storedLink()
                vault.write("computer", json("id" to id, "name" to name, "link" to savedLink).toString())
                if (next != generation) return@launch
                val allComputers = state.value.computers.filterNot { it.id == id } +
                    SavedComputer(id, name, savedLink, candidate.preserveAddresses)
                vault.write("computers", JSONArray(allComputers.map { it.json() }).toString())
                if (next != generation) return@launch
                mutable.update { it.copy(initialized = true, computer = name,
                    connected = true, connecting = false, panel = null, home = cachedHome(it.scope),
                    boardFilters = if (it.computerId == id) it.boardFilters else BoardFilters(),
                    session = null, conversationTitle = null, message = "", pending = null,
                    computers = allComputers, computerId = id, route = null, attachments = emptyList(),
                    outbox = emptyList(), navigation = json(), catalog = json(), computerUnavailable = false,
                    quota = if (it.computerId == id) it.quota else null) }
                refresh()
                loadCatalog()
                if (visible) startEvents()
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (next == generation) mutable.update { it.copy(connecting = false, problem = code(error),
                    computerUnavailable = visible && isConnectionProblem(code(error))) }
            }
        }
    }

    suspend fun value(method: String, params: JSONObject = json()): Any {
        val client = api ?: throw ApiFailure("CONNECTION_FAILED")
        val current = generation
        val result = try { client.requestValue(method, params) }
        catch (error: Exception) {
            if (error is CancellationException) throw error
            if (current == generation && visible && isConnectionProblem(code(error)))
                mutable.update { it.copy(computerUnavailable = true) }
            throw error
        }
        if (current != generation) throw CancellationException("Computer switched")
        return result
    }

    suspend fun request(method: String, params: JSONObject = json()) =
        value(method, params) as? JSONObject ?: throw ApiFailure("PROTOCOL_ERROR")

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

    fun selectComputer(id: String) { state.value.computers.find { it.id == id }?.let { connect(it.link) } }

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
        viewModelScope.launch {
            val updated = state.value.computers.filterNot { it.id == id }
            vault.write("computers", JSONArray(updated.map { it.json() }).toString())
            mutable.update { it.copy(computers = updated) }
            if (computerId == id) {
                val previous = api
                previous?.retire(); generation++; api = null; eventJob?.cancel(); watchJob?.cancel()
                if (previous != null) viewModelScope.launch(Dispatchers.IO) { runCatching { previous.disconnect() } }
                homes.clear(); savedHomeJson = null; sessions.clear(); cachedSessions.clear(); outboxes.clear()
                vault.delete("computer")
                mutable.update { UiState(initialized = true, computers = updated, language = it.language,
                    panel = Panel.Computers) }
            }
        }
    }

    fun language(value: String) {
        api?.language = value
        mutable.update { it.copy(language = value) }
        viewModelScope.launch { vault.write("language", value) }
        if (state.value.connected) { loadCatalog(); refresh() }
    }

    private fun loadCatalog() {
        viewModelScope.launch {
            runCatching { request("catalog.get") }.onSuccess { result ->
                mutable.update { it.copy(catalog = result) }
            }
            runCatching { request("navigation.get") }.onSuccess { result ->
                mutable.update { it.copy(navigation = result) }
            }
        }
    }

    fun select(scope: Scope) {
        if (scope == state.value.scope) return
        mutable.update { it.copy(scope = scope, home = cachedHome(scope)) }
        preference("scope", scope.wire)
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

    fun refresh() {
        val client = api ?: return
        if (!state.value.connected) return
        refreshJob?.cancel()
        val revision = ++refreshRevision
        val currentGeneration = generation
        mutable.update { it.copy(refreshing = true) }
        refreshJob = viewModelScope.launch {
            try {
                val (home, raw) = client.home()
                if (currentGeneration != generation || revision != refreshRevision) return@launch
                homes.clear()
                homes[Scope.All] = home
                mutable.update { it.copy(home = home, refreshing = false, problem = null, computerUnavailable = false) }
                if (savedHomeJson != raw) {
                    // A canceled write may already have replaced the on-disk snapshot.
                    savedHomeJson = null
                    vault.write(cacheName(Scope.All), raw)
                    if (currentGeneration == generation && revision == refreshRevision) savedHomeJson = raw
                }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (currentGeneration == generation && revision == refreshRevision)
                    mutable.update { it.copy(refreshing = false, problem = code(error),
                        computerUnavailable = it.computerUnavailable || visible && isConnectionProblem(code(error))) }
            }
        }
    }

    fun show(panel: Panel) {
        if (panel != Panel.Quota) stopQuota()
        mutable.update { it.copy(panel = panel, problem = null) }
        if (panel == Panel.Create) loadOptions()
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
        it.copy(options = options, problem = null, draft = it.draft.copy(
            status = it.draft.status ?: options.statuses.firstOrNull { status -> status.isDefault }?.id))
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

    fun createIssue() {
        val draft = state.value.draft
        if (!draft.valid || state.value.busy) return
        operation { client ->
            client.request("issue.create", draft.params())
            mutable.update { it.copy(panel = null, draft = IssueDraft()) }
            refresh()
        }
    }

    fun pin(row: Conversation) = operation { client ->
        client.request("board.pin", json("target" to row.id, "pinned" to !row.pinned))
        mutable.update { it.copy(panel = null) }
        refresh()
    }

    fun read(row: Conversation) = operation { client ->
        if (row.sessionId == null) return@operation
        client.request("board.read", json("target" to row.id, "sessionId" to row.sessionId,
            "unread" to !row.unread, "seq" to row.readSeq))
        mutable.update { it.copy(panel = null) }
        refresh()
    }

    fun updateIssue(issue: Issue, patch: JSONObject) = operation { client ->
        client.request("issue.update", json("id" to issue.id, "patch" to patch))
        mutable.update { it.copy(panel = null) }
        refresh()
    }

    fun complete(row: Conversation) = operation { client ->
        val issue = row.issue ?: return@operation
        val done = client.options().statuses.firstOrNull { it.type == "done" } ?: return@operation
        client.request("issue.update", json("id" to issue.id, "patch" to json("status" to done.id)))
        mutable.update { it.copy(panel = null) }
        refresh()
    }

    fun addSubIssue(issue: Issue) {
        editDraft(IssueDraft(parent = issue.id, project = issue.project))
        show(Panel.Create)
    }

    fun assign(issue: Issue, project: Project, agent: String) {
        if (issue.agent != null || project.path.isNullOrBlank()) return
        operation { client ->
            client.request("issue.assign", json("id" to issue.id, "project" to project.json(), "agent" to agent))
            mutable.update { it.copy(panel = null) }
            refresh()
        }
    }

    fun previewDelete(issue: Issue) = operation { client ->
        val result = client.request("issue.delete", json("id" to issue.id))
        require(result.getBoolean("preview") && result.getJSONObject("issue").getLong("id") == issue.id)
        mutable.update { it.copy(panel = Panel.Delete(issue, result.getString("token"))) }
    }

    fun confirmDelete() {
        val panel = state.value.panel as? Panel.Delete ?: return
        operation { client ->
            val result = client.request("issue.delete", json("id" to panel.issue.id, "token" to panel.token))
            require(result.getBoolean("forgotten") && result.getLong("id") == panel.issue.id)
            mutable.update { it.copy(panel = null) }
            refresh()
        }
    }

    fun open(row: Conversation) {
        if (row.issue?.agent == null && row.id != "assistant") return
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
        mutable.update { it.copy(opening = true, conversationTitle = title,
            session = id?.let(cachedSessions::get)?.copy(watchId = nextWatch), conversationKey = nextWatch,
            issueId = issue, message = "", attachments = emptyList(), outbox = emptyList(),
            pending = null, sending = false, panel = null, route = null, problem = null,
            readOnly = subagent != null, isAssistant = assistant, pageLoading = false) }
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
                mutable.update { it.copy(opening = false) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (currentGeneration == generation && watchId == nextWatch)
                    mutable.update { it.copy(opening = false, problem = code(error),
                        computerUnavailable = it.computerUnavailable || visible && isConnectionProblem(code(error))) }
            }
        }
    }

    fun leaveConversation() {
        val oldWatch = watchId
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
            route = returning?.route, pageLoading = false) }
        api?.let { client ->
            viewModelScope.launch {
                if (oldWatch != null) runCatching { client.request("session.unwatch", json("watchId" to oldWatch)) }
                refresh()
            }
        }
    }

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
        val next = inputRequestId ?: UUID.randomUUID().toString().also { inputRequestId = it }
        submit(session, Outgoing(next, active.message, active.attachments))
    }

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

    fun retry(outgoing: Outgoing) { state.value.session?.let { session ->
        val ownsDraft = state.value.message == outgoing.text && state.value.attachments.map { it.toString() } == outgoing.attachments.map { it.toString() }
        submit(session, outgoing.copy(failed = false), ownsDraft)
    } }

    fun discard(outgoing: Outgoing) {
        val session = state.value.session ?: return
        if (!outgoing.failed || state.value.sending) return
        val key = storageKey("outbox", computerId, session.id)
        val updated = outboxes[session.id].orEmpty().filterNot { it.requestId == outgoing.requestId }
        outboxes[session.id] = updated
        mutable.update { it.copy(outbox = updated) }
        viewModelScope.launch { writeOutbox(key, updated) }
    }

    private fun submit(session: Session, outgoing: Outgoing, ownsDraft: Boolean = true) {
        val client = api ?: return
        val next = outgoing.requestId
        val currentGeneration = generation
        val name = draftName(session.id)
        val outgoingKey = storageKey("outbox", computerId, session.id)
        val assistant = state.value.isAssistant
        if (sendingDrafts.containsKey(name)) return
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
                val mention = Regex("^@([A-Za-z]{1,3}-[1-9]\\d*|#?[1-9]\\d*)\\s+([\\s\\S]+)$").matchEntire(outgoing.text)
                val forwarded = assistant && mention != null
                val receipt = if (forwarded) client.request("assistant.forward", json("sessionId" to session.id,
                    "id" to mention.groupValues[1], "text" to mention.groupValues[2], "requestId" to next,
                    "attachments" to JSONArray(outgoing.attachments.filter { it.has("dataBase64") }),
                    "files" to JSONArray(outgoing.attachments.filter { it.has("receiptId") })))
                else client.request("session.send", json("id" to session.id, "text" to outgoing.text,
                    "requestId" to next, "attachments" to JSONArray(outgoing.attachments.map { attachment ->
                        attachment.copyJson().apply { if (has("receiptId")) remove("name") }
                    })))
                if (!forwarded && receipt.optString("requestId") != next) throw ApiFailure("PROTOCOL_ERROR")
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
                if (currentGeneration == generation) {
                    changeOutgoing(session.id, next) { it.copy(failed = !received()) }
                    // A watch may admit the input while its failed HTTP receipt is being saved.
                    if (received()) clearSentDraft(name, next)
                    if (state.value.session?.id == session.id) {
                        val admitted = received()
                        if (ownsDraft) inputRequestId = next.takeUnless { admitted }
                        mutable.update { it.copy(sending = false,
                            message = if (!ownsDraft) it.message else if (admitted) "" else outgoing.text,
                            attachments = if (!ownsDraft) it.attachments else if (admitted) emptyList() else outgoing.attachments,
                            problem = if (admitted) null else "SEND_FAILED") }
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
        mutable.update { it.copy(pageLoading = true) }
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
                mutable.update { it.copy(problem = code(e)) }
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

    private fun operation(block: suspend (DuduApi) -> Unit) {
        val client = api ?: return
        if (state.value.busy || !state.value.connected) return
        val currentGeneration = generation
        mutable.update { it.copy(busy = true, problem = null) }
        viewModelScope.launch {
            try { block(client) }
            catch (error: Exception) {
                if (error is CancellationException) throw error
                if (currentGeneration == generation) mutable.update { it.copy(problem = code(error),
                    computerUnavailable = it.computerUnavailable || visible && isConnectionProblem(code(error))) }
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
            while (visible && currentGeneration == generation) {
                try {
                    val batch = client.events(eventCursor)
                    eventCursor = batch.getLong("cursor")
                    var changed = false
                    batch.getJSONArray("events").objects().forEach { event ->
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
                    if (changed && state.value.conversationTitle == null) refresh()
                } catch (error: Exception) {
                    if (error is CancellationException) throw error
                    // Read-only reconnects never replay a mutation or discard the cached home.
                    mutable.update { it.copy(problem = code(error),
                        computerUnavailable = visible && isConnectionProblem(code(error))) }
                    delay(2000)
                    try {
                        client.connect()
                        if (currentGeneration != generation) break
                        val savedLink = client.endpoint.storedLink()
                        vault.write("computer", json("id" to computerId, "name" to state.value.computer, "link" to savedLink).toString())
                        if (currentGeneration != generation) break
                        val computers = state.value.computers.map { if (it.id == computerId) it.copy(link = savedLink) else it }
                        vault.write("computers", JSONArray(computers.map { it.json() }).toString())
                        if (currentGeneration != generation) break
                        mutable.update { it.copy(computers = computers, problem = null, computerUnavailable = false) }
                        eventCursor = 0
                        state.value.session?.let { active ->
                            val params = json("id" to active.id, "watchId" to active.watchId, "transcript" to true)
                            subagentAddress?.let { params.put("subagent", it) }
                            val detail = client.request("session.watch", params)
                            receiveSession(detail, active.watchId, active.id)
                        }
                        refresh()
                    }
                    catch (e: Exception) {
                        if (e is CancellationException) throw e
                        if (e is ApiFailure && e.code in listOf("AUTH_FAILED", "UNAUTHORIZED")) {
                            mutable.update { it.copy(connected = false) }
                            break
                        }
                    }
                }
            }
        }
    }

    private suspend fun restoreHomes() {
        val current = generation
        // A full snapshot supersedes the per-scope caches from older app builds.
        for (scope in listOf(Scope.All, Scope.Active, Scope.Backlog)) {
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
