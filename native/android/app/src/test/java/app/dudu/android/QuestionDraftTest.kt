package app.dudu.android

import app.dudu.android.data.*
import org.junit.Assert.*
import org.junit.Test

class QuestionDraftTest {
    private val single = QuestionSpec("single", listOf("Light", "Dark"))
    private val multi = QuestionSpec("multi", listOf("iOS", "Android"), multiSelect = true)
    private val text = QuestionSpec("text", emptyList())
    private val questions = listOf(single, multi, text)

    @Test fun pagingKeepsOtherAnswersAndSubmitsInQuestionAndOptionOrder() {
        val first = QuestionDraft().toggle(single, "Dark").advance(questions)
        assertNull(first.answers)
        val second = first.draft.toggle(multi, "Android").toggle(multi, "iOS").edit(multi, " Linux ").advance(questions)
        val final = second.draft.edit(text, " Dudu ").advance(questions)
        assertEquals(listOf(
            QuestionReply("single", listOf("Dark")),
            QuestionReply("multi", listOf("iOS", "Android"), "Linux"),
            QuestionReply("text", emptyList(), "Dudu"),
        ), final.answers)
        assertEquals(" Linux ", final.draft.previous().custom["multi"])
    }

    @Test fun editingSingleChoiceClearsOnlyItsSelectionAndInvalidatesCompletion() {
        val draft = QuestionDraft().toggle(single, "Dark").advance(questions).draft
            .toggle(multi, "iOS").edit(multi, "Linux").previous().edit(single, "Custom theme")
        assertEquals(emptySet<String>(), draft.selected["single"])
        assertEquals(setOf("iOS"), draft.selected["multi"])
        assertEquals("Linux", draft.custom["multi"])
        assertFalse("single" in draft.completed)
        val restored = draft.toggle(single, "Light")
        assertEquals("", restored.custom["single"])
        assertEquals(setOf("Light"), restored.selected["single"])
    }

    @Test fun skipClearsOnlyCurrentAnswerAndDoesNotAnswerWholeBatchEarly() {
        val draft = QuestionDraft().toggle(single, "Light").advance(questions).draft
            .toggle(multi, "iOS").edit(multi, "Linux")
        val skipped = draft.advance(questions, skipping = true)
        assertNull(skipped.answers)
        assertEquals(setOf("Light"), skipped.draft.selected["single"])
        assertEquals(emptySet<String>(), skipped.draft.selected["multi"])
        assertEquals("", skipped.draft.custom["multi"])
        assertEquals(listOf(
            QuestionReply("single", listOf("Light")),
            QuestionReply("multi", emptyList()),
            QuestionReply("text", emptyList()),
        ), skipped.draft.advance(questions, skipping = true).answers)
    }

    @Test fun emptyAnswerCannotAdvanceAndEarlierEditedPageCannotBeSubmittedUnconfirmed() {
        val empty = QuestionDraft().edit(single, "  ").advance(questions)
        assertEquals(QuestionProblem.AnswerRequired, empty.problem)
        assertEquals(0, empty.draft.index)
        assertTrue(empty.draft.completed.isEmpty())
        val ready = QuestionDraft().toggle(single, "Dark").advance(questions).draft
            .toggle(multi, "iOS").advance(questions).draft.edit(text, "Dudu")
        // A previous answer was edited after being completed: only confirmed pages may leave the phone.
        val stale = ready.copy(completed = ready.completed - "single").advance(questions)
        assertEquals(QuestionProblem.Incomplete, stale.problem)
        assertEquals(0, stale.draft.index)
        assertEquals("Dudu", stale.draft.custom["text"])
        assertNull(stale.answers)
    }
}
