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
    ) : TranscriptRow {
        val outcome: String get() = if (running) "running" else timing?.optString("outcome").orEmpty()
        val staysOpen: Boolean get() = outcome in listOf("failed", "stopped", "interrupted")
    }
}

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
    if (transcript == null) return messages.map(TranscriptRow::Entry)
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
    return timeline.map { item ->
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
            answer, running, final, timings[fragment.number])
    }
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
