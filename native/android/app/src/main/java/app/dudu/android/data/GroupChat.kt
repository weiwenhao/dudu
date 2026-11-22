package app.dudu.android.data

import org.json.JSONObject

/**
 * 嘟嘟's conversation as a group chat, rule for rule the iPhone's (`Core/GroupChat.swift`, `Core/AssistantCompletion.swift`; owner, 2026-11-22: "原则上应该和 ios 完全保持一致").
 * The plugin's side is `host/assistant/home/group.mjs`: the owner's `@ID …` line (`at`), the answer of that issue's agent (`reply`), the silent mark that none will come (`end`) and the result of a
 * scheduled task (`task`) come into the transcript as `/dudu-say` commands whose `group` the bridge attaches.
 */
object GroupChat {
    /** The command of 嘟嘟's conversation that makes a line (`SAY_COMMAND`). */
    const val COMMAND = "dudu-say"
    /** A line whose answer has not come for this long is not waited for any more (the plugin was restarted, or the agent was left). */
    const val WAIT_LIMIT_MS = 15 * 60_000.0

    /** The name of the issue a line is about: its ID (`DUD-9`), else its number. */
    fun name(issue: JSONObject?): String =
        issue?.nullableString("ref") ?: issue?.takeIf { it.has("id") && !it.isNull("id") }?.let { "#${it.getLong("id")}" } ?: ""

    /** Whether the owner can answer the line by writing to its issue: not the silent end, not a task's result, and only an issue with a number. */
    fun isAnswerable(line: JSONObject): Boolean = line.optString("kind") !in listOf("end", "task") &&
        line.optJSONObject("issue")?.let { it.has("id") && !it.isNull("id") } == true

    /** A task line's words: 运行失败 and the reason when the run failed (`GroupLine.taskText`); `failed` and `join` are the words, given by the caller. */
    fun taskText(line: JSONObject, failed: String, join: (String, String) -> String): String {
        val said = line.optString("text").trim()
        if (line.optBoolean("ok", true)) return said
        return if (said.isEmpty()) failed else join(failed, said)
    }

    /** What the box holds after the owner chose to answer the issue named `name`: its `@ID`, put in front of what is written, or in place of the `@ID` that starts it. */
    fun replyDraft(draft: String, name: String): String {
        if (name.isEmpty()) return draft
        val leading = draft.trimStart(' ', '\n')
        if (leading.startsWith("@")) {
            val token = leading.drop(1).takeWhile { !it.isWhitespace() }
            if (isAddress(token)) {
                val rest = leading.drop(1 + token.length)
                return "@$name" + rest.ifEmpty { " " }
            }
        }
        return if (draft.isEmpty()) "@$name " else "@$name $draft"
    }

    /** An issue's address: its number (`7`, `#7`) or its project's reference (`DUD-7`). */
    private fun isAddress(token: String): Boolean {
        val value = token.removePrefix("#")
        if (value.isNotEmpty() && value.length <= 15 && value.all(Char::isDigit) && value.first() != '0') return true
        val parts = value.split("-")
        return parts.size == 2 && parts[0].length in 1..3 && parts[0].all(Char::isLetter) &&
            parts[1].isNotEmpty() && parts[1].length <= 15 && parts[1].all(Char::isDigit) && parts[1].first() != '0'
    }

    enum class Kind { Issue, Skill }

    /** What is being completed: an `@` at the start of the box or a `/` after a space, the word typed after it, and where the whole token is (`start` until `end`, UTF-16 like the field). */
    data class Query(val kind: Kind, val text: String, val start: Int, val end: Int) {
        fun continues(previous: Query?) = previous?.kind == kind && previous.start == start
    }

    private val issueQuery = Regex("^\\s*@([^\\s@]*)$")
    private val skillQuery = Regex("(?:^|\\s)/([A-Za-z0-9_-]*)$")
    private val addressPattern = Regex("^@(#?[1-9]\\d{0,14}|[A-Za-z]{1,3}-[1-9]\\d{0,14})(?=\\s|$)")
    private val leadingAddress = Regex("^\\s*(@(?:#?[1-9]\\d{0,14}|[A-Za-z]{1,3}-[1-9]\\d{0,14}))(?=\\s|$)")
    private val skillToken = Regex("(?:^|\\s)(/([A-Za-z0-9_-]+))(?=\\s|$)")

    /** The query at the caret. Chinese being composed is left alone; backspace may filter an open list, but removing a completed token must not open one. */
    fun query(text: String, selectionStart: Int, selectionEnd: Int, composing: Boolean, deleting: Boolean, previous: Query?): Query? {
        if (composing || selectionStart != selectionEnd || selectionStart < 0 || selectionStart > text.length) return null
        val prefix = text.substring(0, selectionStart)
        for ((kind, pattern) in listOf(Kind.Issue to issueQuery, Kind.Skill to skillQuery)) {
            val match = pattern.find(prefix) ?: continue
            val word = match.groups[1] ?: continue
            val next = Query(kind, prefix.substring(word.range.first, word.range.last + 1), word.range.first - 1, word.range.last + 1)
            return if (deleting && !next.continues(previous)) null else next
        }
        return null
    }

    data class Address(val id: String, val body: String)

    /** The issue a message is for: a leading `@ID` (only a leading one routes a message) and what is said after it. */
    fun address(text: String): Address? {
        val value = text.trim()
        val match = addressPattern.find(value) ?: return null
        return Address(match.groupValues[1], value.substring(match.range.last + 1).trim())
    }

    /** The box after `token` took the place of the query, and where the caret goes: behind it, with one space unless one follows already. */
    fun insert(token: String, query: Query, text: String): Pair<String, Int>? {
        if (query.start < 0 || query.end > text.length || query.start > query.end) return null
        val suffix = text.substring(query.end)
        val insertion = token + if (suffix.firstOrNull()?.isWhitespace() == true) "" else " "
        return text.replaceRange(query.start, query.end, insertion) to query.start + insertion.length
    }

    /** The skills whose name holds the typed letters in order, those that start with them first, the rest as listed. */
    fun rank(skills: List<JSONObject>, query: String): List<JSONObject> {
        val wanted = query.lowercase()
        return skills.filter { skill ->
            var offset = 0
            for (character in skill.optString("name").lowercase()) if (offset < wanted.length && character == wanted[offset]) offset++
            offset == wanted.length
        }.withIndex().sortedWith(compareBy({ !it.value.optString("name").lowercase().startsWith(wanted) }, { it.index })).map { it.value }
    }

    /** The parts of the box drawn blue: the leading `@ID`, and every `/skill` this conversation has. */
    fun highlights(text: String, skills: Set<String>): List<IntRange> {
        val ranges = mutableListOf<IntRange>()
        leadingAddress.find(text)?.groups?.get(1)?.let { ranges.add(it.range) }
        for (match in skillToken.findAll(text)) {
            val name = match.groups[2] ?: continue
            if (name.value in skills) match.groups[1]?.let { ranges.add(it.range) }
        }
        return ranges
    }

    // --- the thread ---------------------------------------------------------------------------------------------------------------------

    private fun TranscriptRow.message(): Message? = (this as? TranscriptRow.Entry)?.message?.takeIf { it.role == "command" }
    private fun TranscriptRow.line(): JSONObject? = message()?.raw?.optJSONObject("group")
    private fun TranscriptRow.commandId(): String? = message()?.raw?.nullableString("commandId")
    private fun TranscriptRow.isTyping(): Boolean = message()?.raw?.optBoolean("typing") == true

    /** The lines whose answer is still on its way: an `at` line that no `reply` names, and that is not older than the limit or carries live text. */
    fun waiting(rows: List<TranscriptRow>, now: Double): List<Message> {
        val answered = rows.mapNotNullTo(HashSet()) { row -> row.line()?.takeIf { it.optString("kind") != "at" }?.nullableString("to") }
        return rows.mapNotNull { row ->
            val line = row.line() ?: return@mapNotNull null
            if (row.isTyping() || line.optString("kind") != "at") return@mapNotNull null
            val id = row.commandId() ?: return@mapNotNull null
            if (id in answered) return@mapNotNull null
            val live = line.optJSONObject("liveReply")?.optString("text").orEmpty()
            if (live.isEmpty() && line.has("at") && now - line.optDouble("at") > WAIT_LIMIT_MS) return@mapNotNull null
            row.message()
        }
    }

    /**
     * The thread in the order the owner reads it: an issue's answer stands right under the line it answers, where its dots stood, and not where it arrived (owner, 2026-11-11: "我希望这个消息能停留在
     * loading 框对应的位置"). An answer moves behind its line and behind the answers already there; one whose line is not among the rows stays where it arrived; the others keep their order.
     */
    fun placingReplies(rows: List<TranscriptRow>): List<TranscriptRow> {
        val asked = rows.filter { it.line()?.optString("kind") == "at" && !it.isTyping() }.mapNotNullTo(HashSet()) { it.commandId() }
        val under = mutableMapOf<String, MutableList<TranscriptRow>>()
        val moved = HashSet<Int>()
        rows.forEachIndexed { index, row ->
            val line = row.line() ?: return@forEachIndexed
            val kind = line.optString("kind")
            if (kind != "reply" && kind != "end") return@forEachIndexed
            val to = line.nullableString("to")?.takeIf { it in asked } ?: return@forEachIndexed
            val answers = under.getOrPut(to) { mutableListOf() }
            // The first answer takes the place (and the identity) of the dots it replaces.
            answers.add(if (kind == "reply" && answers.isEmpty()) TranscriptRow.Entry(row.message()!!.copy(id = "answer:$to")) else row)
            moved.add(index)
        }
        if (moved.isEmpty()) return rows
        val placed = ArrayList<TranscriptRow>(rows.size)
        rows.forEachIndexed { index, row ->
            if (index in moved) return@forEachIndexed
            placed.add(row)
            if (row.line()?.optString("kind") == "at") row.commandId()?.let(under::get)?.let(placed::addAll)
        }
        return placed
    }

    /**
     * The dots of the answers still on their way, each right under the line it waits for, so that what comes after covers it as the thread grows (owner, 2026-11-11: "应该在原位吧"). A line that carries
     * the live text of its answer has that text in place of the dots, still running.
     */
    fun placingTyping(rows: List<TranscriptRow>, now: Double): List<TranscriptRow> {
        val placed = rows.toMutableList()
        for (waiting in waiting(rows, now)) {
            val commandId = waiting.raw.nullableString("commandId") ?: continue
            val index = placed.indexOfFirst { it.commandId() == commandId && !it.isTyping() }
            if (index < 0) continue
            val group = waiting.raw.optJSONObject("group")?.copyJson() ?: continue
            val live = group.optJSONObject("liveReply")
            val typing = live?.optString("text").isNullOrEmpty()
            if (!typing) {
                group.put("kind", "reply").put("text", live!!.optString("text")).put("at", live.opt("at")).put("to", commandId)
            }
            val raw = json("type" to "command", "name" to COMMAND, "outcome" to "success", "group" to group, "typing" to typing, "running" to true)
            placed.add(index + 1, TranscriptRow.Entry(Message("answer:$commandId", "command", "", false, raw = raw)))
        }
        return placed
    }

    /** Both, as the iPhone's transcript does after building its rows. */
    fun placing(rows: List<TranscriptRow>, now: Double = System.currentTimeMillis().toDouble()) = placingTyping(placingReplies(rows), now)
}
