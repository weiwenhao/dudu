package app.dudu.android

import app.dudu.android.data.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

// 嘟嘟's group chat and its box, the same rules as the iPhone's (`Core/GroupChat.swift`, `Core/AssistantCompletion.swift`).
class GroupChatTest {
    private val issue = json("id" to 6, "ref" to "DUD-6", "title" to "dudu 研发", "agent" to "claude")

    @Test fun replyPutsTheIssuesAtInFrontOrInPlaceOfTheLeadingOne() {
        assertEquals("@DUD-6 ", GroupChat.replyDraft("", "DUD-6"))
        assertEquals("@DUD-6 看一下", GroupChat.replyDraft("看一下", "DUD-6"))
        assertEquals("@DUD-6 看一下", GroupChat.replyDraft("@HOU-19 看一下", "DUD-6"))
        assertEquals("@DUD-6 ", GroupChat.replyDraft("@#12", "DUD-6"))
        assertEquals("@DUD-6 @某人 你好", GroupChat.replyDraft("@某人 你好", "DUD-6"))
        assertEquals("#6", GroupChat.name(json("id" to 6)))
    }

    @Test fun theListOpensForALeadingAtOrASlashAtTheCaretAndNotWhileComposingOrDeletingAToken() {
        assertEquals(GroupChat.Query(GroupChat.Kind.Issue, "DU", 0, 3), GroupChat.query("@DU", 3, 3, false, false, null))
        assertEquals(GroupChat.Query(GroupChat.Kind.Issue, "", 2, 3), GroupChat.query("  @", 3, 3, false, false, null))
        assertNull(GroupChat.query("x @DU", 5, 5, false, false, null))
        assertNull(GroupChat.query("@DUD-6 ", 7, 7, false, false, null))
        assertNull(GroupChat.query("@DU", 3, 3, true, false, null))
        assertEquals(GroupChat.Query(GroupChat.Kind.Skill, "pl", 3, 6), GroupChat.query("hi /pl", 6, 6, false, false, null))
        // Backspace filters an open list but does not open one on a finished token.
        val open = GroupChat.query("@DUD", 4, 4, false, false, null)
        assertNotNull(GroupChat.query("@DU", 3, 3, false, true, open))
        assertNull(GroupChat.query("@DU", 3, 3, false, true, null))
    }

    @Test fun choosingPutsTheTokenWithOneSpaceAndTheCaretBehindIt() {
        val query = GroupChat.Query(GroupChat.Kind.Issue, "DU", 0, 3)
        assertEquals("@DUD-6 " to 7, GroupChat.insert("@DUD-6", query, "@DU"))
        assertEquals("@DUD-6 看" to 6, GroupChat.insert("@DUD-6", query, "@DU 看"))
        assertEquals(GroupChat.Address("DUD-6", "看一下"), GroupChat.address(" @DUD-6  看一下 "))
        assertEquals(GroupChat.Address("#12", ""), GroupChat.address("@#12"))
        assertNull(GroupChat.address("@某人 看一下"))
        assertEquals(listOf(0..5, 7..11), GroupChat.highlights("@DUD-6 /plan 和 /nope", setOf("plan")))
    }

    private fun command(id: String, line: JSONObject, extra: Pair<String, Any?>? = null) = TranscriptRow.Entry(Message("e-$id", "command", "", false,
        raw = json("commandId" to id, "name" to GroupChat.COMMAND, "outcome" to "success", "group" to line).apply { extra?.let { put(it.first, it.second) } }))
    private fun user(id: String) = TranscriptRow.Entry(Message(id, "user", "x", false))
    private fun ids(rows: List<TranscriptRow>) = rows.map { it.id }

    @Test fun anAnswerStandsUnderItsLineAndTheDotsStandWhereItWillCome() {
        val now = 10 * 60_000.0
        val at = command("a1", json("kind" to "at", "issue" to issue, "text" to "结论了吗", "at" to now - 1000))
        val reply = command("r1", json("kind" to "reply", "issue" to issue, "text" to "结论：先用 SQLite。", "to" to "a1", "at" to now))
        assertEquals(listOf("e-a1", "answer:a1", "u1"), ids(GroupChat.placing(listOf(at, user("u1"), reply), now)))
        // No answer yet: the dots stand under the line, until fifteen minutes have gone without any text.
        val waiting = GroupChat.placing(listOf(at, user("u1")), now)
        assertEquals(listOf("e-a1", "answer:a1", "u1"), ids(waiting))
        assertTrue((waiting[1] as TranscriptRow.Entry).message.raw.getBoolean("typing"))
        assertEquals(listOf("e-a1", "u1"), ids(GroupChat.placing(listOf(at, user("u1")), now + GroupChat.WAIT_LIMIT_MS)))
        // The text of an answer still being written stands there in place of the dots.
        val live = command("a2", json("kind" to "at", "issue" to issue, "text" to "?", "at" to now, "liveReply" to json("text" to "正在看", "at" to now)))
        val answer = (GroupChat.placing(listOf(live), now)[1] as TranscriptRow.Entry).message.raw
        assertFalse(answer.getBoolean("typing"))
        assertEquals("正在看", answer.getJSONObject("group").getString("text"))
        assertEquals("a2", answer.getJSONObject("group").getString("to"))
    }
}
