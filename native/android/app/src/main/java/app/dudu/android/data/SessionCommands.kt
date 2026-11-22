package app.dudu.android.data

/** What a DSH command of the box answered (`session.command`: `{ kind: success | error, text }`), the iPhone's `CommandOutcome`. */
data class CommandOutcome(val isError: Boolean, val text: String)

/** Words for a toast: a key of the app's words (written with `word`) with what goes into its `{0}`, `{1}`…, or the computer's own text as it is (`literal`). */
data class CommandMessage(val text: String, val literal: Boolean = false, val args: List<String> = emptyList())

/**
 * DSH's command handlers answer in English; the known replies become the app's words for the toast, anything unfamiliar keeps the computer's text (the iPhone's `CommandText`,
 * `Core/SessionCommands.swift`, reply for reply).
 */
object CommandText {
    fun message(command: String, outcome: CommandOutcome): CommandMessage {
        val text = outcome.text.trim()
        return when (command) {
            "compact" -> compact(text, outcome.isError)
            "plan" -> plan(text, outcome.isError)
            else -> goal(text, outcome.isError)
        }
    }

    private fun compact(text: String, isError: Boolean): CommandMessage {
        if (text.startsWith("Compacted ")) {
            val numbers = Regex("\\d+").findAll(text).mapNotNull { it.value.toLongOrNull()?.toString() }.toList()
            if (numbers.size >= 2) return CommandMessage(word("已压缩 {0} 条历史（约 {1} tokens）"), args = numbers.take(2))
        }
        return when {
            text.startsWith("No compactable history") -> CommandMessage(word("暂无可压缩的历史"))
            text == "Compaction cancelled." -> CommandMessage(word("压缩已取消"))
            text.startsWith("Compaction is unavailable") -> CommandMessage(word("当前无法压缩，请等会话空闲后再试"))
            text.startsWith("The history selected for compaction changed") -> CommandMessage(word("压缩期间历史发生了变化，请重试"))
            text.startsWith("Compaction could not produce") -> CommandMessage(word("未能生成有效摘要，请稍后重试"))
            text.startsWith("Compaction did not finish cleanly") -> CommandMessage(word("压缩未能完整完成，请检查会话状态"))
            text.startsWith("Compaction finished, but") -> CommandMessage(word("压缩已完成，但会话保存失败"))
            text.isEmpty() -> CommandMessage(if (isError) word("压缩失败") else word("已压缩"))
            else -> CommandMessage(text, literal = true)
        }
    }

    private fun plan(text: String, isError: Boolean): CommandMessage = when {
        text.startsWith("Plan mode on") || text.startsWith("Entering plan mode") -> CommandMessage(word("已进入计划模式"))
        text == "Plan mode off." -> CommandMessage(word("已退出计划模式"))
        text.startsWith("Leaving plan mode") -> CommandMessage(word("正在退出计划模式，下一步生效"))
        text.startsWith("Plan mode entry cancelled") -> CommandMessage(word("已取消进入计划模式"))
        text.startsWith("Plan mode is already inactive") -> CommandMessage(word("计划模式当前未开启"))
        text.startsWith("Attachments cannot") -> CommandMessage(word("退出计划模式时不能带附件"))
        text.isEmpty() -> CommandMessage(if (isError) word("计划模式操作失败") else word("完成"))
        else -> CommandMessage(text, literal = true)
    }

    private fun goal(text: String, isError: Boolean): CommandMessage = when {
        text.startsWith("Goal created") -> CommandMessage(word("已设置目标"))
        text.startsWith("Goal updated") -> CommandMessage(word("已更新目标"))
        text.startsWith("Goal paused") -> CommandMessage(word("目标已暂停"))
        text.startsWith("Goal resumed") -> CommandMessage(word("目标已继续"))
        text == "Goal cleared." -> CommandMessage(word("已清除目标"))
        text.startsWith("No goal to clear") -> CommandMessage(word("没有可清除的目标"))
        text.startsWith("No goal is currently set") -> CommandMessage(word("尚未设置目标"))
        text.startsWith("A goal is already") -> CommandMessage(word("已有进行中的目标，请使用「更新目标」"))
        text.startsWith("The goal command is not valid") -> CommandMessage(word("当前状态下无法执行此操作"))
        text.startsWith("Goal editing requires") -> CommandMessage(word("请输入新的目标内容"))
        text.isEmpty() -> CommandMessage(if (isError) word("目标操作失败") else word("完成"))
        else -> CommandMessage(text, literal = true)
    }
}
