package app.dudu.android

import app.dudu.android.data.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class TranscriptTest {
    @Test fun changeCountsSurviveExpiryAndCacheRestoreButNeverFollowAnotherComparison() {
        val counts = json("total" to 2, "added" to 8, "deleted" to 3)
        fun transcript(seq: Int) = json("turns" to JSONArray(listOf(json("turn" to 1, "changesSeq" to seq))))
        val known = transcript(12)
        known.rows("turns").single().put("changesSummary", counts)
        val retained = mergeTranscript(known, transcript(12))
        assertEquals(counts.toString(), retained.rows("turns").single().getJSONObject("changesSummary").toString())
        val cached = cachedSession(json("session" to json("id" to "session"), "transcript" to retained))
        assertEquals(counts.toString(), cached.getJSONObject("transcript").rows("turns").single()
            .getJSONObject("changesSummary").toString())
        val changed = mergeTranscript(retained, transcript(14)).rows("turns").single()
        assertEquals(14, changed.getInt("changesSeq"))
        assertFalse(changed.has("changesSummary"))
    }

    private fun step(id: String, turn: Int, text: String = "", calls: List<String> = emptyList(), reasoning: String = "") =
        Message(id, "assistant", text, false, reasoning = reasoning,
            raw = json("id" to id, "type" to "assistant", "turn" to turn, "seq" to id.filter(Char::isDigit).toInt(),
                "calls" to JSONArray(calls.map { json("id" to it, "name" to "Bash", "activity" to "commands", "seq" to 9) })))

    @Test fun completedTurnRetainsInterimRepliesAndToolReferencesSeparatelyFromTheFinalAnswer() {
        val steps = listOf(
            step("a1", 1, calls = listOf("one"), reasoning = "First thought"),
            step("a2", 1, calls = listOf("two")),
            step("a3", 1, "Interim reply", listOf("three")),
            step("a4", 1, "Final answer"),
        )
        val timing = json("turn" to 1, "start" to 10, "end" to 20,
            "files" to JSONArray(listOf(json("id" to "file"))), "changesSeq" to 12)
        val rows = transcriptRows(steps, json("turns" to JSONArray(listOf(timing))), false)
        val turn = rows.single() as TranscriptRow.Turn
        assertEquals("Final answer", turn.answer?.text)
        assertEquals(listOf("group:thought:a1", "a3", "group:call:three"), turn.segments.map { it.id })
        val first = turn.segments.first() as ProcessSegment.Group
        assertEquals(listOf("thought:a1", "call:one", "call:two"), first.members.map { it.id })
        assertEquals(9, (first.members[1] as ProcessMember.Call).call.getInt("seq"))
        assertEquals(12, turn.timing?.getInt("changesSeq"))
        assertEquals("file", turn.timing?.rows("files")?.single()?.getString("id"))
    }

    @Test fun interveningUserInputSplitsTheProcessWithoutMovingItOrDuplicatingTheTurnFooter() {
        val user = Message("u", "user", "Follow-up", false, attachments = listOf(json("id" to "photo")),
            raw = json("time" to 15))
        val transcript = json("turns" to JSONArray(listOf(json("turn" to 1, "start" to 10, "end" to 30))))
        val rows = transcriptRows(listOf(step("a1", 1, calls = listOf("call")), user, step("a2", 1, "Answer")), transcript, false)
        assertEquals(listOf("turn-1", "u", "turn-1:after:u"), rows.map { it.id })
        assertFalse((rows.first() as TranscriptRow.Turn).finalFragment)
        assertNull((rows.first() as TranscriptRow.Turn).answer)
        assertEquals("photo", (rows[1] as TranscriptRow.Entry).message.attachments.single().getString("id"))
        assertTrue((rows.last() as TranscriptRow.Turn).finalFragment)
        assertEquals("Answer", (rows.last() as TranscriptRow.Turn).answer?.text)
        // Loading the earlier half later must not change the visible continuation's identity.
        assertEquals(rows.last().id, transcriptRows(listOf(user, step("a2", 1, "Answer")), transcript, false).last().id)
    }

    @Test fun liveTextStaysVisibleAndDoesNotBecomeACompletedAnswerBeforeTheTurnEnds() {
        val live = Message("live", "assistant", "Partial\n\nanswer", true,
            raw = json("calls" to JSONArray(listOf(json("id" to "live-call", "activity" to "commands")))))
        val transcript = json("turns" to JSONArray(listOf(json("turn" to 2, "start" to 10))))
        val row = transcriptRows(listOf(step("a1", 2, calls = listOf("one")), live), transcript, true).single() as TranscriptRow.Turn
        assertTrue(row.running)
        assertNull(row.answer)
        assertEquals(live.text, (row.segments[1] as ProcessSegment.Reply).message.text)
        assertTrue((row.segments.last() as ProcessSegment.Group).running)
    }

    @Test fun successfulNativeCompactionAndTurnMarkersDoNotLeaveBlankStandaloneMessageRows() {
        val compact = Message("compact", "command", "", false,
            raw = json("source" to "dudu-harness", "name" to "compact", "outcome" to "success"))
        val marker = Message("marker", "turn-marker", "", false, raw = json("turn" to 3))
        val transcript = json("turns" to JSONArray(listOf(json("turn" to 3, "end" to 20, "outcome" to "stopped"))))
        val row = transcriptRows(listOf(compact, marker, step("a1", 3, calls = listOf("one"))), transcript, false)
            .single() as TranscriptRow.Turn
        assertEquals("turn-3", row.id)
        assertTrue(row.staysOpen)
        assertTrue(row.segments.isNotEmpty())
    }

    /** The iPhone's `TranscriptTimeGrouping`: a time over a prompt after five quiet minutes or on another day, none over the turn that answers it, none when time runs backwards. */
    @Test fun timeSeparatorsFollowTheIPhonesGrouping() {
        val utc = java.util.TimeZone.getTimeZone("UTC")
        val minute = 60_000L
        val day = 24 * 60 * minute
        fun user(id: String, time: Long) = Message(id, "user", "hi", false, raw = json("time" to time))
        fun turn(id: Int, start: Long, end: Long) = json("turn" to id, "start" to start, "end" to end)
        val base = 10 * day + 8 * 60 * minute
        val messages = listOf(
            user("u1", base), step("a1", 1, "One"),
            user("u2", base + 3 * minute), step("a2", 2, "Two"),
            user("u3", base + 9 * minute), step("a3", 3, "Three"),
            user("u4", base + 8 * minute),
            user("u5", base + day + 9 * minute),
        )
        val transcript = json("turns" to JSONArray(listOf(turn(1, base, base + minute), turn(2, base + 3 * minute, base + 4 * minute),
            turn(3, base + 9 * minute, base + 10 * minute))))
        val separators = timeSeparators(transcriptRows(messages, transcript, false), utc)
        // u2 is 2 minutes after turn 1 ended, u4 is earlier than what came before, the turns answer their prompts.
        assertEquals(mapOf("u1" to base, "u3" to base + 9 * minute, "u5" to base + day + 9 * minute), separators)
        // A chain of retries shows its latest notice only.
        val notices = turnNotices(json("notices" to JSONArray(listOf(json("id" to "r1", "kind" to "retry", "retryId" to "x"),
            json("id" to "e", "kind" to "error"), json("id" to "r2", "kind" to "retry", "retryId" to "x")))))
        assertEquals(listOf("e", "r2"), notices.map { it.getString("id") })
    }
}
