@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package app.dudu.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject

@Composable
fun NewSessionScreen(state: UiState, model: DuduViewModel, openDrawer: () -> Unit) {
    val actions = rememberActions()
    var workspaces by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var sessions by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var catalog by remember { mutableStateOf(state.catalog) }
    var selectedModel by rememberSaveable { mutableStateOf("") }
    var preset by rememberSaveable { mutableStateOf("") }
    var picker by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(actions.revision) { actions.run {
        workspaces = (model.value("workspace.list") as org.json.JSONArray).objects()
        sessions = (model.value("session.list") as org.json.JSONArray).objects()
        catalog = model.request("catalog.get")
    } }
    val models = catalog.rows("models")
    val current = models.find { it.optString("id") == selectedModel } ?: models.firstOrNull()
    val provider = catalog.rows("providers").find { provider ->
        current?.optString("id") in provider.optJSONArray("modelIds")?.strings().orEmpty()
    }
    val agent = provider?.nullableString("id") ?: current?.optString("id")?.substringBefore(":")
    fun start(workspace: String) = actions.run {
        val params = json("workspaceId" to workspace).apply {
            current?.nullableString("id")?.let { put("modelId", it) }
            if (agent == "deepseek" && preset.isNotEmpty()) put("agentPreset", preset)
            sessions.firstOrNull { it.optBoolean("blank") && it.optString("workspaceId") == workspace }
                ?.nullableString("id")?.let { put("reuse", it) }
        }
        val created = model.request("session.create", params)
        model.openSession(created.getString("id"), created.optString("title"))
    }
    BackHandler { model.backRoute() }
    Scaffold(containerColor = MaterialTheme.colorScheme.background,
        topBar = { TopAppBar(title = {}, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            navigationIcon = { IconButton(onClick = openDrawer) { Glyph(R.drawable.ic_menu, stringResource(R.string.more), 22) } }) },
        bottomBar = {
            Column(Modifier.navigationBarsPadding().padding(horizontal = 24.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (actions.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                actions.error?.let { Text(problemText(it), color = MaterialTheme.colorScheme.error) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(onClick = { picker = "workspace" }, enabled = !actions.busy, shape = RoundedCornerShape(50),
                        color = MaterialTheme.colorScheme.background, border = BorderStroke(.5.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.weight(1.15f).testTag("new-session-workspace")) {
                        Row(Modifier.height(38.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Glyph(R.drawable.ic_folder, size = 17, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(w("选择工作区"), Modifier.weight(1f), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Glyph(R.drawable.ic_chevron_down, size = 13, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    Surface(onClick = { picker = "provider" }, enabled = !actions.busy && models.isNotEmpty(), shape = RoundedCornerShape(50),
                        color = MaterialTheme.colorScheme.background, border = BorderStroke(.5.dp, MaterialTheme.colorScheme.outlineVariant),
                        modifier = Modifier.weight(1f).testTag("new-session-model")) {
                        Row(Modifier.height(38.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            AgentLogo(agent, 18)
                            Text(provider?.nullableString("name") ?: current?.optString("sourceName") ?: w("供应商"), Modifier.weight(1f), fontSize = 14.sp,
                                maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Glyph(R.drawable.ic_chevron_down, size = 13, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (agent == "deepseek" && catalog.rows("presets").isNotEmpty()) IconButton(onClick = { picker = "preset" }, modifier = Modifier.size(38.dp)) {
                        Glyph(R.drawable.ic_sliders_horizontal, w("模式"), 19, MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                Surface(onClick = { picker = "workspace" }, enabled = !actions.busy, modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(28.dp), color = MaterialTheme.colorScheme.surface,
                    border = BorderStroke(.75.dp, MaterialTheme.colorScheme.outlineVariant), shadowElevation = 2.dp) {
                    Row(Modifier.height(52.dp).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Glyph(R.drawable.ic_plus, size = 24, tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = .55f))
                        Text(w("选择工作区"), fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }) { insets ->
        Box(Modifier.fillMaxSize().padding(insets), contentAlignment = Alignment.Center) {
            Row(Modifier.padding(horizontal = 24.dp), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Image(painterResource(R.drawable.dudu), null, Modifier.size(44.dp))
                Text(w("探索未至之境"), fontSize = 26.sp, fontWeight = FontWeight.Medium)
            }
        }
    }
    picker?.let { kind -> DuduSheet({ picker = null }) {
        SheetHeader(when (kind) { "workspace" -> w("项目"); "preset" -> w("模式"); else -> w("供应商") }, { picker = null })
        Form {
            val rows = when (kind) { "workspace" -> workspaces; "preset" -> catalog.rows("presets")
                else -> catalog.rows("providers").filter { row -> row.optJSONArray("modelIds")?.strings().orEmpty().any { id -> models.any { it.optString("id") == id } } } }
            InsetCard {
                rows.forEachIndexed { index, row ->
                    val id = row.getString("id")
                    Line(row.nullableString("name") ?: id, action = {
                        picker = null
                        when (kind) {
                            "workspace" -> start(id)
                            "preset" -> preset = id
                            else -> {
                                selectedModel = row.nullableString("defaultModelId")?.takeIf { value -> models.any { it.optString("id") == value } }
                                    ?: row.optJSONArray("modelIds")?.strings()?.firstOrNull { value -> models.any { it.optString("id") == value } }.orEmpty()
                            }
                        }
                    }, tag = "new-session-option-$id", leading = if (kind == "provider") ({ AgentLogo(id, 21) }) else null, trailing = {
                        if (id == if (kind == "provider") agent else preset)
                            Glyph(R.drawable.ic_check, size = 18)
                    })
                    if (index < rows.lastIndex) HorizontalDivider(Modifier.padding(start = 16.dp), thickness = .5.dp)
                }
            }
        }
    } }
}
