package app.dudu.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import android.content.ClipData
import org.json.JSONArray

/**
 * The files a turn delivered (the iPhone's `TurnDeliveredFiles`): the chat panel's grey card, 16 dp corners and a hairline, the first three files and 「全部 N 个文件」 for the rest, hairlines from 48 dp.
 * A tap shows a file in the app (`FilePreviewPage`); a long press copies its path.
 */
@Composable
fun DeliveredFilesCard(files: List<JSONObject>, sessionId: String, model: DuduViewModel, connected: Boolean = true) {
    val shown = presentedFiles(files)
    val preview = remember { TurnFilePreview() }
    if (shown.isNotEmpty()) Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val shape = androidx.compose.foundation.shape.RoundedCornerShape(16.dp)
        Column(Modifier.fillMaxWidth().background(chatPanel(), shape).border(.5.dp, chatBorder(), shape)
            .clip(shape)) {
            shown.take(3).forEachIndexed { index, file ->
                if (index > 0) HorizontalDivider(Modifier.padding(start = 48.dp), thickness = .5.dp, color = chatBorder())
                DeliveredFileRow(file, deliveredTitle(file, shown), preview, sessionId, connected, model)
            }
            if (shown.size > 3) {
                HorizontalDivider(Modifier.padding(start = 48.dp), thickness = .5.dp, color = chatBorder())
                Row(Modifier.fillMaxWidth().clickable {
                    model.navigate(Route("delivered-files", params = json("files" to JSONArray(shown))))
                }.heightIn(min = 48.dp).padding(horizontal = 14.dp).testTag("files-presented-all"),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(wp("全部 %lld 个文件", shown.size), Modifier.weight(1f), fontSize = 15.sp, color = chatSecondary())
                    Glyph(DuduGlyphs.right, size = 14, tint = chatTertiary())
                }
            }
        }
        TurnFilePreviewPresentation(preview)
    }
}

@Composable
fun DeliveredFilesScreen(route: Route, state: UiState, model: DuduViewModel) {
    val files = presentedFiles(route.params.rows("files"))
    var query by remember { mutableStateOf("") }
    val shown = files.filter { (it.optString("name") + it.optString("path")).contains(query.trim(), true) }
    val resize = LocalSheetHeight.current
    LaunchedEffect(shown.size) { resize((138 + shown.size * 56).coerceIn(176, 600)) }
    val preview = remember { TurnFilePreview() }
    Page(wp("全部 %lld 个文件", files.size), model::backRoute) {
        Box(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) { SearchField(query, w("搜索文件")) { query = it } }
        Box(Modifier.padding(horizontal = 18.dp)) { TurnFilePreviewPresentation(preview) }
        LazyColumn {
            cardItems(shown, key = { it.optString("path", it.optString("id")) }) { file ->
                DeliveredFileRow(file, deliveredTitle(file, files), preview, state.session?.id ?: return@cardItems,
                    state.connected && state.session?.cached == false, model)
            }
        }
    }
}

@Composable
fun FilesScreen(route: Route, state: UiState, model: DuduViewModel) {
    val actions = rememberActions()
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var copied by remember { mutableStateOf(false) }
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val id = route.params.nullableString("id") ?: state.session?.id
    val path = route.target.orEmpty()
    val reading = route.params.optBoolean("file")
    LaunchedEffect(actions.revision) {
        if (id != null) actions.run { result = model.request(if (reading) "files.read" else "files.list", json("id" to id, "path" to path)) }
    }
    Page(if (reading) result?.optString("name") ?: route.title else "", model::backRoute, actions,
        background = MaterialTheme.colorScheme.surface, top = {
        if (reading) IconButton(onClick = { scope.launch {
            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("", result?.optString("text").orEmpty()))); copied = true
        } }, enabled = result != null) { Glyph(if (copied) DuduGlyphs.check else DuduGlyphs.copy, w("复制文件内容"), 20) }
    }) {
        if (id == null) Text(w("打开会话后查看项目文件"), Modifier.padding(20.dp))
        else if (reading) {
            result?.let { file -> SelectionContainer {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).horizontalScroll(rememberScrollState())
                    .padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(file.optString("text"), fontSize = 13.sp, lineHeight = 21.sp, fontFamily = FontFamily.Monospace, softWrap = false)
                    if (file.optBoolean("truncated")) Text(w("文件较大，仅显示开头部分"), fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } }
        } else {
            Row(Modifier.fillMaxWidth().height(46.dp).padding(start = 14.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = androidx.compose.foundation.shape.RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.surfaceContainer) {
                    Row(Modifier.padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Glyph(DuduGlyphs.folder, size = 20); Text(w("文件"), fontSize = 13.sp, fontWeight = FontWeight.Medium)
                    }
                }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = actions::refresh, enabled = !actions.busy) { Glyph(DuduGlyphs.completeContext, w("刷新文件"), 18) }
            }
            Row(Modifier.fillMaxWidth().heightIn(min = 36.dp).padding(start = if (path.isEmpty()) 16.dp else 4.dp, end = 16.dp),
                verticalAlignment = Alignment.CenterVertically) {
                if (path.isNotEmpty()) IconButton(onClick = model::backRoute, modifier = Modifier.size(36.dp)) {
                    BarGlyph(DuduGlyphs.back, w("返回上一级"))
                }
                Text(if (path.isEmpty()) result?.optString("name") ?: w("项目") else path,
                    fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HorizontalDivider(thickness = .5.dp)
            LazyColumn(contentPadding = PaddingValues(top = 4.dp, bottom = 20.dp)) {
                items(result?.rows("entries").orEmpty(), key = { it.getString("path") }) { entry ->
                    Surface(onClick = { model.navigate(Route("files", entry.getString("name"), entry.getString("path"),
                        json("id" to id, "file" to !entry.optBoolean("isDirectory")))) }, color = MaterialTheme.colorScheme.surface) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 42.dp).padding(horizontal = 14.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(9.dp)) {
                            Glyph(if (entry.optBoolean("isDirectory")) DuduGlyphs.folder else DuduGlyphs.file,
                                size = 17, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(entry.getString("name"), Modifier.weight(1f), fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (entry.optBoolean("isDirectory")) Glyph(DuduGlyphs.right, size = 12, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (result?.rows("entries")?.isEmpty() == true) item { Text(w("暂无文件"), Modifier.padding(20.dp), fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant) }
                if (result?.optBoolean("truncated") == true) item { Text(w("文件过多，仅显示前 500 项"), Modifier.padding(16.dp)) }
            }
        }
    }
}

@Composable
fun DetailScreen(route: Route, state: UiState, model: DuduViewModel) {
    val actions = rememberActions()
    var result by remember { mutableStateOf<JSONObject?>(null) }
    val texts = remember { mutableStateMapOf<String, String>() }
    val offsets = remember { mutableStateMapOf<String, Int>() }
    var query by remember { mutableStateOf("") }
    val session = state.session ?: return
    fun load(section: String? = null) = actions.run {
        val params = route.params.copyJson().put("id", route.params.nullableString("id") ?: session.id)
        if (section != null) offsets[section]?.let { params.put("${section}Offset", it) }
        val next = model.request("session.${route.name}", params)
        result = next
        if (route.name in listOf("changes", "diff")) DuduLog.record("conversation.${route.name}.loaded",
            counts = mapOf("rowCount" to if (route.name == "changes") next.rows("files").size.toLong()
                else next.rows("hunks").sumOf { it.optJSONArray("lines")?.length()?.toLong() ?: 0L }),
            state = if (route.name == "diff")
                next.optString("kind").takeIf { it in listOf("text", "binary", "oversized") } ?: "unknown" else null)
        if (route.name == "tool") for (field in listOf("input", "output", "metadata")) {
            if (section != null && section != field) continue
            val page = next.optJSONObject(field) ?: continue
            texts[field] = (if (section == field) texts[field].orEmpty() else "") + page.optString("text")
            if (page.isNull("nextOffset")) offsets.remove(field) else offsets[field] = page.getInt("nextOffset")
        }
    }
    LaunchedEffect(actions.revision) { load() }
    val resize = LocalSheetHeight.current
    val matching = result?.rows("files").orEmpty().withIndex().filter {
        "${it.value.optString("display")} ${it.value.optString("path")}".contains(query.trim(), true)
    }
    LaunchedEffect(route.name, matching.size) {
        if (route.name == "changes") resize((132 + matching.size * 56).coerceIn(176, 600))
    }
    Page(if (route.name == "changes" && result != null) wp("已编辑 %lld 个文件", result!!.optInt("total", result!!.rows("files").size)) else route.title.ifBlank {
        result?.nullableString(if (route.name == "diff") "display" else "name")
            ?: when (route.name) { "changes", "diff" -> w("已编辑文件"); else -> w("查看详情") }
    },
        model::backRoute, actions, nested = route.name == "diff", background = MaterialTheme.colorScheme.surface) {
        if (route.name == "changes") Box(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
            SearchField(query, w("搜索文件")) { query = it }
        }
        if (route.name == "diff") DiffContent(result)
        else LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
            when (route.name) {
                "tool" -> {
                    listOf("input", "output", "metadata").forEach { field ->
                        if (result != null && (field != "metadata" || !texts[field].isNullOrBlank())) {
                            item { Text(when (field) { "input" -> w("输入"); "output" -> w("输出"); else -> w("元数据") },
                                Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp, bottom = 10.dp), fontSize = 17.sp, fontWeight = FontWeight.SemiBold) }
                            item { SelectionContainer {
                                Text(texts[field].orEmpty().ifEmpty { "—" }, Modifier.padding(horizontal = 20.dp),
                                    fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp)
                            } }
                            if (offsets[field] != null) item { TextButton(onClick = { load(field) }, enabled = !actions.busy,
                                modifier = Modifier.fillMaxWidth()) { Text(w("加载更多")) } }
                        }
                    }
                    items(result?.rows("images").orEmpty()) { image -> Attachment(session.id, image, image.optLong("seq"), model) }
                }
                "changes" -> items(matching, key = { it.index }) { (index, file) ->
                    Surface(onClick = { model.navigate(Route("diff", file.optString("display"),
                        params = json("id" to (route.params.nullableString("id") ?: session.id),
                            "seq" to route.params.getLong("seq"), "index" to index))) }, color = MaterialTheme.colorScheme.surface) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(horizontal = 20.dp, vertical = 10.dp),
                            verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                                Text(file.optString("display", file.optString("path")), fontSize = 14.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    FileChangeCounts(file.optInt("added"), file.optInt("deleted"))
                                }
                            }
                            Glyph(DuduGlyphs.right, size = 15, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    HorizontalDivider(Modifier.padding(horizontal = 20.dp), thickness = .5.dp)
                }
                else -> result?.let { item { CodeBlock(it.toString(2), "JSON") } }
            }
        }
    }
}

@Composable
fun ActivityScreen(route: Route, state: UiState, model: DuduViewModel) {
    val actions = rememberActions()
    var result by remember { mutableStateOf(json()) }
    val session = state.session ?: return
    val jobs = route.target == "jobs"
    val jobId = route.params.nullableString("jobId")
    val locale = appLocale()
    var completedOpen by remember { mutableStateOf<Boolean?>(null) }
    val members = result.rows("members")
    val others = members.drop(1)
    val finished = others.filter { it.optString("state") == "completed" }
    val states = listOf("working", "blocked", "failed", "idle")
    val groups = states.mapNotNull { status ->
        val rows = others.filter { if (status == "idle") it.optString("state") !in listOf("working", "blocked", "failed", "completed")
            else it.optString("state") == status }
        rows.takeIf { it.isNotEmpty() }?.let { status to it }
    }
    val finishedIsOpen = completedOpen ?: groups.isEmpty()
    val jobRows = result.rows("jobs").sortedWith(compareByDescending<JSONObject> {
        it.optString("status") in listOf("running", "stopping")
    }.thenBy { if (it.optString("status") in listOf("running", "stopping")) it.optLong("startedAt")
        else -it.optLong("finishedAt", it.optLong("startedAt")) })
    val resize = LocalSheetHeight.current
    LaunchedEffect(result, finishedIsOpen, jobId) {
        val height = if (jobs) 118 + jobRows.size * 58 else 182 + groups.sumOf { 44 + it.second.size * 58 } +
            if (finished.isNotEmpty()) 66 + if (finishedIsOpen) 10 + finished.size * 58 else 0 else 0
        resize(if (jobId != null) 600 else height.coerceIn(248, 600))
    }
    fun read() = actions.run {
        result = model.request(if (jobId != null) "session.job.output" else if (jobs) "session.jobs" else "session.team",
            json("id" to session.id).apply {
                jobId?.let { put("jobId", it) }
                session.raw.optJSONObject("session")?.optJSONObject("subagent")?.let { if (!jobs) put("subagent", it) }
            })
    }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(actions.revision, session.watchId, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                if (!actions.busy) read()
                delay(3000)
                if (actions.error != null) break
                if (jobId != null && result.optJSONObject("job")?.optString("status")?.let { it !in listOf("running", "stopping") } == true) break
            }
        }
    }
    // A job that runs counts its time every second while the page is in front, as the iPhone's `TimelineView(.periodic(by: 1))`; the list itself is read every 3 s.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val live = (jobRows + listOfNotNull(result.optJSONObject("job"))).any { it.optString("status") in listOf("running", "stopping") }
    LaunchedEffect(live, lifecycle) {
        if (!live) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { now = System.currentTimeMillis(); delay(1000) }
        }
    }
    fun open(member: JSONObject) {
        model.openSession(member.getString("id"), member.optString("name"),
            subagent = member.optJSONObject("session")?.optJSONObject("subagent"))
    }
    Page(if (jobs) w("后台任务") else w("智能体团队"), model::backRoute, actions,
        nested = jobId != null) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 24.dp)) {
            if (jobId != null) {
                val job = result.optJSONObject("job")
                item {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text(job?.optString("title").orEmpty(), fontSize = 21.sp, fontWeight = FontWeight.SemiBold)
                            if (job != null) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                ActivityMark(job.optString("status"), 15)
                                Text("${jobStatus(job.optString("status"))} · ${jobElapsed(job, now)}", fontSize = 13.sp,
                                    color = chatSecondary(), style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"))
                            }
                        }
                        job?.optLong("startedAt")?.takeIf { it > 0 }?.let { started ->
                            InsetCard {
                                Line(w("开始时间"), trailing = { Text(java.text.DateFormat.getDateTimeInstance(
                                    java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT, locale).format(java.util.Date(started)),
                                    fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }, minHeight = 52)
                            }
                        }
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Text(w("输出"), Modifier.padding(start = 16.dp), fontSize = 13.sp,
                                fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            InsetCard {
                                SelectionContainer { Text(result.optString("text").ifEmpty { "—" },
                                    Modifier.fillMaxWidth().heightIn(min = 120.dp).horizontalScroll(rememberScrollState()).padding(16.dp),
                                    fontFamily = FontFamily.Monospace, fontSize = 13.sp, softWrap = false) }
                            }
                        }
                        if (job?.optString("status") in listOf("running", "stopping")) InsetCard {
                            Surface(onClick = { actions.run {
                                model.request("session.job.stop", json("id" to session.id, "jobId" to jobId)); actions.refresh()
                            } }, enabled = !actions.busy && job?.optString("status") != "stopping", color = MaterialTheme.colorScheme.surface) {
                                Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterHorizontally)) {
                                    Glyph(DuduGlyphs.jobStop, size = 14, tint = MaterialTheme.colorScheme.error)
                                    Text(w("停止"), fontSize = 16.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.error)
                                }
                            }
                        }
                    }
                }
            } else if (jobs) {
                if (jobRows.isEmpty() && !actions.busy && actions.error == null) item {
                    Column(Modifier.fillMaxWidth().heightIn(min = 160.dp), horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(20.dp, Alignment.CenterVertically)) {
                        Glyph(DuduGlyphs.stateWorking, size = 26, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(w("暂无后台任务"), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                items(jobRows, key = { it.getString("id") }) { job ->
                    GroupRow(job === jobRows.first(), job === jobRows.last(), inset = 0) {
                        ActivityRow(job.optString("title"), { model.navigate(Route("activity", target = "jobs",
                            params = json("jobId" to job.getString("id")))) }, leading = { ActivityMark(job.optString("status")) }) {
                            // Only a job that did not simply finish says its state in words; the others show how long they ran (the iPhone's `trailingText`).
                            val status = job.optString("status")
                            val finishedWell = status in listOf("running", "stopping", "completed")
                            Text((if (finishedWell) "" else "${jobStatus(status)} · ") + jobElapsed(job, now),
                                fontSize = 13.sp, color = if (finishedWell || status == "killed") chatSecondary() else chatError(),
                                maxLines = 1, style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"))
                        }
                    }
                }
            } else {
                members.firstOrNull()?.let { member -> item {
                    InsetCard {
                        Surface(onClick = { open(member) }, enabled = member.optBoolean("canOpen"), color = MaterialTheme.colorScheme.surface) {
                            Row(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                val agent = member.optJSONObject("session")?.nullableString("agent")
                                    ?: session.raw.optJSONObject("session")?.nullableString("agent")
                                if (agent != null) AgentLogo(agent, 26) else Glyph(DuduGlyphs.model, size = 24)
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(agent?.let(::agentName) ?: member.optString("name"), fontSize = 16.sp, fontWeight = FontWeight.Medium,
                                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    val modelId = member.nullableString("modelId")
                                    val modelName = state.catalog.rows("models").find { it.optString("id") == modelId }?.optString("name") ?: modelId
                                    Text(listOfNotNull(w("主智能体"), modelName).joinToString(" · "),
                                        fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                ActivityMark(member.optString("state"))
                            }
                        }
                    }
                } }
                groups.forEach { (status, group) ->
                    item { Row(Modifier.padding(start = 16.dp, top = 14.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(activityStatus(status), fontSize = 13.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(group.size.toString(), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    } }
                    items(group, key = { it.getString("id") }) { member -> GroupRow(member === group.first(), member === group.last(), inset = 0) {
                        ActivityRow(member.optString("name"), { open(member) }, enabled = member.optBoolean("canOpen"),
                            leading = { ActivityMark(status) })
                    } }
                }
                if (finished.isNotEmpty()) {
                    item { InsetCard(Modifier.padding(top = 14.dp)) {
                        ActivityRow(w("已完成"), { completedOpen = !finishedIsOpen }, leading = { ActivityMark("completed") }) {
                            Text(finished.size.toString(), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Glyph(if (finishedIsOpen) DuduGlyphs.down else DuduGlyphs.right, size = 16,
                                tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } }
                    if (finishedIsOpen) {
                        item { Spacer(Modifier.height(10.dp)) }
                        items(finished, key = { it.getString("id") }) { member -> GroupRow(member === finished.first(), member === finished.last(), inset = 0) {
                            ActivityRow(member.optString("name"), { open(member) }, enabled = member.optBoolean("canOpen"))
                        } }
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityRow(title: String, action: () -> Unit, enabled: Boolean = true,
    leading: (@Composable () -> Unit)? = null, trailing: @Composable () -> Unit = {}) {
    Surface(onClick = action, enabled = enabled, color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            leading?.let { Box(Modifier.size(20.dp), contentAlignment = Alignment.Center) { it() } }
            Text(title, Modifier.weight(1f), fontSize = 16.sp, fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
            trailing()
        }
    }
}

/** How long a job ran, or has run until `now`, in the iPhone's words (`SessionBackgroundJob.elapsed`): 1小时2分, 5分13秒, 42秒. */
@Composable
private fun jobElapsed(job: JSONObject, now: Long): String {
    val end = job.optLong("finishedAt").takeIf { it > 0 } ?: now
    val seconds = ((end - job.optLong("startedAt", end)) / 1000).coerceAtLeast(0)
    return when {
        seconds >= 3600 -> w("{0}小时{1}分").replace("{0}", (seconds / 3600).toString()).replace("{1}", (seconds % 3600 / 60).toString())
        seconds >= 60 -> w("{0}分{1}秒").replace("{0}", (seconds / 60).toString()).replace("{1}", (seconds % 60).toString())
        else -> w("{0}秒").replace("{0}", seconds.toString())
    }
}

/** A job's state in the iPhone's words (`SessionBackgroundJob.statusText`). */
@Composable
private fun jobStatus(value: String) = when (value) {
    "running", "stopping" -> w("运行中")
    "completed" -> w("已完成")
    "killed" -> w("已停止")
    else -> w("失败")
}

@Composable
private fun ActivityMark(state: String, size: Int = 18) {
    when (state) {
        "working", "running", "stopping" -> RunningMark(size)
        "completed" -> Glyph(DuduGlyphs.check, size = size, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        "failed" -> Glyph(DuduGlyphs.stateFailed, size = size, tint = MaterialTheme.colorScheme.error)
        "blocked" -> Glyph(DuduGlyphs.stateBlocked, size = size)
        else -> Glyph(DuduGlyphs.stateIdle, size = size, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun activityStatus(value: String) = when (value) {
    "working", "running", "stopping" -> w("工作中")
    "completed" -> w("已完成")
    "blocked" -> w("需要你")
    "failed" -> w("失败")
    "killed" -> w("已停止")
    else -> w("空闲中")
}
