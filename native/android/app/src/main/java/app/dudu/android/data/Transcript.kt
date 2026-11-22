package app.dudu.android.data

import org.json.JSONObject

sealed interface TranscriptRow {
    val id: String

    data class Entry(val message: Message) : TranscriptRow {
        override val id = message.id
    }

    data class Turn(
        override val id: String,
        val number: Int,
        val segments: List<ProcessSegment>,
        val answer: Message?,
        val running: Boolean,
        val finalFragment: Boolean,
        val timing: JSONObject?,
        /** What the running group says it is doing (the iPhone's `TurnRow.live`); only on the running turn's last fragment. */
        val live: LiveStatus? = null,
        /** The sequence numbers of every message of this fragment: what 删除 of its answer hides in 嘟嘟's conversation (the iPhone's `lineSequences`). */
        val seqs: List<Long> = emptyList(),
    ) : TranscriptRow {
        val outcome: String get() = if (running) "running" else timing?.optString("outcome").orEmpty()
        val staysOpen: Boolean get() = outcome in listOf("failed", "stopped", "interrupted")
        /** When the turn began, if the host has said. */
        val startedAt: Long? get() = timing?.takeUnless { it.isNull("start") || !it.has("start") }?.optLong("start")
    }
}

/** The iPhone's `LiveStatus`: the kind of the latest running call and its detail, or thinking and the first line of the newest paragraph of reasoning. */
data class LiveStatus(val activity: String, val detail: String)

sealed interface ProcessMember {
    val id: String
    data class Thought(val message: Message) : ProcessMember { override val id = "thought:${message.id}" }
    data class Call(val call: JSONObject) : ProcessMember { override val id = "call:${call.optString("id")}" }
}

sealed interface ProcessSegment {
    val id: String
    data class Reply(val message: Message) : ProcessSegment { override val id = message.id }
    data class Group(val members: List<ProcessMember>, val running: Boolean) : ProcessSegment {
        override val id = "group:${members.first().id}"
    }
}

private class TurnFragment(val id: String, val number: Int, val steps: MutableList<Message> = mutableListOf())

/**
 * The iPhone's turn/process/reply structure, prepared with the snapshot off the UI thread.
 * Non-assistant boundaries split a turn without moving the answer, files or notices ahead of an intervening input.
 */
fun transcriptRows(messages: List<Message>, transcript: JSONObject?, processing: Boolean): List<TranscriptRow> {
    if (transcript == null) return GroupChat.placing(messages.map(TranscriptRow::Entry))
    val timings = transcript.rows("turns").associateBy { it.optInt("turn", -1) }
    val latest = timings.keys.maxOrNull()
    val live = messages.lastOrNull { it.streaming }
    val runningTurn = if (processing) {
        latest?.takeIf { timings[it]?.isNull("end") == true }
            ?: live?.let { -1 }
    } else null
    val timeline = mutableListOf<Any>()
    val fragments = mutableMapOf<Int, MutableList<TurnFragment>>()
    fun appendTurn(number: Int): TurnFragment {
        val previous = timeline.lastOrNull()
        val boundary = (previous as? Message)?.raw
        val continuation = boundary?.takeUnless { it.isNull("time") }?.let {
            val timing = timings[number]
            timing != null && !timing.isNull("start") && it.optDouble("time") > timing.optDouble("start")
        } == true
        val base = "turn-$number"
        val id = if (fragments[number].isNullOrEmpty() && !continuation) base else
            "$base:after:${(previous as? Message)?.id ?: (previous as? TurnFragment)?.id ?: "start"}"
        return TurnFragment(id, number).also { fragments.getOrPut(number) { mutableListOf() }.add(it); timeline.add(it) }
    }
    for (message in messages.filterNot(Message::streaming)) {
        when (message.role) {
            "assistant", "turn-marker" -> {
                val number = message.raw.optInt("turn", -1)
                val fragment = (timeline.lastOrNull() as? TurnFragment)?.takeIf { it.number == number } ?: appendTurn(number)
                if (message.role == "assistant") fragment.steps.add(message)
            }
            "command" -> {
                val raw = message.raw
                if (raw.optString("source") == "dudu-harness" && raw.optString("name") == "compact" &&
                    raw.optString("outcome") == "success") continue
                if (raw.optJSONObject("group")?.optString("kind") == "end") continue
                if (raw.isNull("outcome") && (raw.has("card") || raw.has("group"))) continue
                timeline.add(message)
            }
            else -> timeline.add(message)
        }
    }
    if (runningTurn != null && (timeline.lastOrNull() as? TurnFragment)?.number != runningTurn) appendTurn(runningTurn)
    // A live-only snapshot still has visible content even before the host publishes its turn metadata.
    if (live != null && runningTurn == null) timeline.add(live)
    // An issue's answer stands under the line it answers, and the dots of the answers still on their way stand there too (the iPhone's `GroupChat.placingReplies` / `placingTyping`).
    return GroupChat.placing(timeline.map { item ->
        if (item is Message) return@map TranscriptRow.Entry(item)
        val fragment = item as TurnFragment
        val final = fragments[fragment.number]?.last() === fragment
        val running = fragment.number == runningTurn && final
        val steps = fragment.steps.sortedWith(compareBy({ it.raw.optInt("step") }, { it.raw.optLong("seq") }))
        val answer = steps.lastOrNull()?.takeIf {
            final && !running && it.raw.rows("calls").isEmpty() && it.text.isNotBlank()
        }
        TranscriptRow.Turn(fragment.id, fragment.number,
            processSegments(if (answer == null) steps else steps.dropLast(1), if (running) live else null, running),
            answer, running, final, timings[fragment.number],
            live = if (running) liveStatus(steps, live) else null,
            seqs = steps.mapNotNull { step -> step.raw.takeIf { it.has("seq") && !it.isNull("seq") }?.optLong("seq") }.distinct())
    })
}

/** The iPhone's `TranscriptBuilder.liveStatus`: the last call still running of the live step and the last recorded one, or thinking. */
private fun liveStatus(steps: List<Message>, live: Message?): LiveStatus {
    val calls = live?.raw?.rows("calls").orEmpty() + steps.lastOrNull()?.raw?.rows("calls").orEmpty()
    calls.lastOrNull { (it.nullableString("status") ?: "running") == "running" }?.let {
        return LiveStatus(it.nullableString("activity") ?: "tools", it.optString("detail"))
    }
    if (live != null) return LiveStatus("thinking", latestParagraphSummary(live.reasoning))
    return LiveStatus("thinking", "")
}

/** The first line of the newest paragraph of reasoning that has any words, without emphasis markers (the iPhone's `latestParagraphSummary`). */
fun latestParagraphSummary(reasoning: String): String {
    for (paragraph in reasoning.split("\n\n").asReversed()) {
        val line = paragraph.lineSequence().firstOrNull() ?: paragraph
        val cleaned = line.replace("**", "").trim()
        if (cleaned.isNotEmpty()) return cleaned
    }
    return ""
}

/**
 * Where a time stands over the history (the iPhone's `TranscriptTimeGrouping.separators`): over a message, a trigger or a turn that comes five minutes or more after the last thing that happened,
 * or on another day than the time shown before it. A turn that answers the message right before it has none of its own. Keyed by the row's id, in milliseconds.
 */
fun timeSeparators(rows: List<TranscriptRow>, zone: java.util.TimeZone = java.util.TimeZone.getDefault()): Map<String, Long> {
    val interval = 5 * 60_000L
    val separators = mutableMapOf<String, Long>()
    var lastActivity: Long? = null
    var lastGroupTime: Long? = null
    var followsPrompt = false
    fun valid(raw: JSONObject?, key: String): Long? {
        if (raw == null || !raw.has(key) || raw.isNull(key)) return null
        val value = raw.optDouble(key)
        return if (value.isFinite() && value >= 0) value.toLong() else null
    }
    val calendar = java.util.Calendar.getInstance(zone)
    fun day(time: Long) = calendar.run {
        timeInMillis = time
        get(java.util.Calendar.YEAR) * 1000 + get(java.util.Calendar.DAY_OF_YEAR)
    }
    fun beginGroup(time: Long?, id: String) {
        if (time == null) return
        lastActivity?.let { previous ->
            if (time < previous) return
            if (day(lastGroupTime ?: previous) == day(time) && time - previous < interval) return
        }
        separators[id] = time
        lastGroupTime = time
    }
    fun recordActivity(time: Long?) {
        if (time != null) lastActivity = maxOf(lastActivity ?: time, time)
    }
    for (row in rows) {
        when (row) {
            is TranscriptRow.Entry -> if (row.message.role == "user" || row.message.role == "trigger") {
                val time = valid(row.message.raw, "time")
                beginGroup(time, row.id)
                recordActivity(time)
                followsPrompt = true
            }
            is TranscriptRow.Turn -> {
                val start = valid(row.timing, "start")
                val answered = row.answer?.let { valid(it.raw, "time") }
                if (!followsPrompt || lastActivity == null) beginGroup(start ?: answered, row.id)
                recordActivity(start)
                recordActivity(answered)
                val end = if (row.finalFragment) valid(row.timing, "end") else null
                if (start != null && end != null && end >= start) recordActivity(end)
                followsPrompt = false
            }
        }
    }
    return separators
}

/** The notices of a turn as the iPhone shows them: a chain of retries is its latest notice only (`TranscriptBuilder`, `retryChains`). */
fun turnNotices(timing: JSONObject?): List<JSONObject> {
    val chains = mutableSetOf<String>()
    return timing?.rows("notices").orEmpty().asReversed().filter { notice ->
        val retry = notice.nullableString("retryId")
        notice.optString("kind") != "retry" || retry == null || chains.add(retry)
    }.asReversed()
}

private fun processSegments(steps: List<Message>, live: Message?, running: Boolean): List<ProcessSegment> {
    val segments = mutableListOf<ProcessSegment>()
    val members = mutableListOf<ProcessMember>()
    fun flush(active: Boolean = false) {
        if (members.isNotEmpty()) {
            segments.add(ProcessSegment.Group(members.toList(), active))
            members.clear()
        }
    }
    for (message in steps + listOfNotNull(live)) {
        if (message.reasoning.isNotBlank()) members.add(ProcessMember.Thought(message))
        if (message.text.isNotBlank() || message.attachments.isNotEmpty()) {
            flush()
            segments.add(ProcessSegment.Reply(message))
        }
        members.addAll(message.raw.rows("calls").map(ProcessMember::Call))
    }
    flush(running)
    return segments
}
