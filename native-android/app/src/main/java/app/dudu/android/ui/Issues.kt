@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class,
    androidx.compose.foundation.layout.ExperimentalLayoutApi::class)

package app.dudu.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.*
import app.dudu.android.R
import app.dudu.android.data.*
import org.json.JSONObject

@Composable
fun SubIssuesScreen(route: Route, state: UiState, model: DuduViewModel) {
    val actions = rememberActions()
    var children by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    val resize = LocalSheetHeight.current
    LaunchedEffect(actions.revision) { actions.run {
        children = model.request("issue.get", json("id" to route.target?.toLong())).getJSONObject("issue").rows("children")
    } }
    LaunchedEffect(children.size) { resize((102 + children.size * 56).coerceIn(158, 600)) }
    Page(w("子事项"), model::backRoute, actions) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 24.dp)) {
            item { InsetCard { children.forEach { child ->
                val status = state.options?.statuses?.find { it.id == child.optString("status") }
                    ?: Status(child.optString("status"), null, child.optString("statusType"), false)
                Surface(color = MaterialTheme.colorScheme.surface, onClick = {
                    val session = child.nullableString("sessionId")
                    if (session != null && child.nullableString("agent") != null)
                        model.openSession(session, child.optString("title"), child.getLong("id"))
                    else model.navigate(Route("issue", child.optString("title"), child.getLong("id").toString()))
                }) {
                    Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) { IssueStatusMark(status) }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(child.optString("title"), fontSize = 15.sp, maxLines = 1,
                                overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                            Text(child.nullableString("ref") ?: "#${child.getLong("id")}", fontSize = 12.sp, maxLines = 1,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Glyph(R.drawable.ic_chevron_right, size = 16, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            } } }
        }
    }
}

@Composable
fun DueDateDialog(value: Long?, dismiss: () -> Unit, changed: (Long?) -> Unit) {
    val zone = java.time.ZoneId.systemDefault()
    val selected = value?.let { java.time.Instant.ofEpochMilli(it).atZone(zone).toLocalDate()
        .atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli() }
    val picker = rememberDatePickerState(initialSelectedDateMillis = selected)
    DatePickerDialog(onDismissRequest = dismiss,
        confirmButton = { TextButton(onClick = {
            changed(picker.selectedDateMillis?.let { java.time.Instant.ofEpochMilli(it)
                .atZone(java.time.ZoneOffset.UTC).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli() })
        }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = dismiss) { Text(stringResource(R.string.cancel)) } }) {
        DatePicker(picker)
    }
}

@Composable
fun IssueScreen(route: Route, state: UiState, model: DuduViewModel) {
    val id = route.target?.toLongOrNull() ?: return
    val actions = rememberActions()
    var full by remember(id) { mutableStateOf<Issue?>(null) }
    val brief = state.home?.rows?.firstOrNull { it.issue?.id == id }?.issue
    val issue = full ?: brief
    LaunchedEffect(id, actions.revision) { actions.run {
        full = Issue.parse(model.request("issue.get", json("id" to id)).getJSONObject("issue"))
    } }
    Page("", model::backRoute) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(issue?.title ?: route.title, fontSize = 19.sp, fontWeight = FontWeight.SemiBold)
            issue?.let {
                val status = state.options?.statuses?.find { value -> value.id == it.status }
                Text(listOfNotNull(it.ref, status?.let { value -> statusTitle(value) } ?: workflowTitle(it.status),
                    it.project?.name).filter { value -> value.isNotBlank() }.joinToString(" · "),
                    fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (actions.busy) CircularProgressIndicator(Modifier.padding(vertical = 8.dp).size(20.dp), strokeWidth = 2.dp)
            else if (actions.error != null) Row(verticalAlignment = Alignment.CenterVertically) {
                Text(w("事项没能加载"), fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick = actions::refresh) { Text(stringResource(R.string.retry)) }
            }
            full?.description?.takeIf { it.isNotBlank() }?.let {
                SelectionContainer { Text(it, Modifier.padding(top = 8.dp), fontSize = 16.sp, lineHeight = 24.sp) }
            }
        }
    }
}

@Composable
private fun workflowTitle(value: String): String = when (value) {
    "backlog" -> stringResource(R.string.workflow_backlog)
    "todo" -> stringResource(R.string.workflow_todo)
    "in_progress" -> stringResource(R.string.workflow_in_progress)
    "in_review" -> stringResource(R.string.workflow_in_review)
    "done" -> stringResource(R.string.workflow_done)
    "canceled" -> stringResource(R.string.workflow_canceled)
    else -> value
}
