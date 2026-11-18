package app.dudu.android.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.dudu.android.R

internal enum class TaskPicker { Provider, Model, Workspace, Target, Session, Timezone }

internal data class TaskChoice(val id: String, val title: String, val subtitle: String? = null,
    val agent: String? = null, val icon: Int? = null, val enabled: Boolean = true)

@Composable
internal fun TaskChoicePage(picker: TaskPicker, choices: List<TaskChoice>, selected: String,
    emptyText: String? = null, back: () -> Unit, choose: (String) -> Unit) {
    var query by remember(picker) { mutableStateOf("") }
    val title = when (picker) {
        TaskPicker.Provider -> w("供应商")
        TaskPicker.Model -> w("模型")
        TaskPicker.Workspace -> w("关联工作区")
        TaskPicker.Target -> w("执行位置")
        TaskPicker.Session -> w("关联会话")
        TaskPicker.Timezone -> w("时区")
    }
    val shown = choices.filter { "${it.title} ${it.subtitle.orEmpty()}".contains(query.trim(), true) }
    Page(title, back, nested = true, background = MaterialTheme.colorScheme.background) {
        if (picker !in listOf(TaskPicker.Provider, TaskPicker.Target))
            Box(Modifier.padding(horizontal = 18.dp, vertical = 8.dp)) { SearchField(query, title) { query = it } }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(top = 12.dp, bottom = 24.dp)) {
            itemsIndexed(shown, key = { _, choice -> choice.id }) { index, choice ->
                GroupRow(index == 0, index == shown.lastIndex, divider = false) {
                    IssueChoiceRow(choice.title, choice.subtitle, selected = choice.id == selected,
                        enabled = choice.enabled, tag = "task-${picker.name.lowercase()}-option-${choice.id}", icon = {
                            if (choice.agent != null) AgentLogo(choice.agent, 20)
                            else choice.icon?.let { Glyph(it, size = 18) }
                        }) { choose(choice.id) }
                }
            }
            if (shown.isEmpty() && emptyText != null) item {
                Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
                    Text(emptyText, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
