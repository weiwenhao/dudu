package app.dudu.android.data

data class QuestionSpec(val id: String, val options: List<String>, val multiSelect: Boolean = false)
data class QuestionReply(val id: String, val selected: List<String>, val custom: String? = null)
enum class QuestionProblem { AnswerRequired, Incomplete }
data class QuestionAdvance(
    val draft: QuestionDraft,
    val problem: QuestionProblem? = null,
    val answers: List<QuestionReply>? = null,
)

/** Kept by the conversation entry, independently of whether its sheet is visible. */
data class QuestionDraft(
    val index: Int = 0,
    val selected: Map<String, Set<String>> = emptyMap(),
    val custom: Map<String, String> = emptyMap(),
    val completed: Set<String> = emptySet(),
) {
    fun toggle(question: QuestionSpec, label: String): QuestionDraft {
        val old = selected[question.id].orEmpty()
        val next = when {
            label in old -> old - label
            question.multiSelect -> old + label
            else -> setOf(label)
        }
        return copy(
            selected = selected + (question.id to next),
            custom = if (question.multiSelect) custom else custom + (question.id to ""),
            completed = completed - question.id,
        )
    }

    fun edit(question: QuestionSpec, text: String) = copy(
        selected = if (question.multiSelect) selected else selected + (question.id to emptySet()),
        custom = custom + (question.id to text),
        completed = completed - question.id,
    )

    fun previous() = copy(index = (index - 1).coerceAtLeast(0))

    fun advance(questions: List<QuestionSpec>, skipping: Boolean = false): QuestionAdvance {
        val question = questions.getOrNull(index) ?: return QuestionAdvance(this)
        if (!skipping && selected[question.id].orEmpty().isEmpty() && custom[question.id].orEmpty().isBlank())
            return QuestionAdvance(this, QuestionProblem.AnswerRequired)
        val next = copy(
            selected = if (skipping) selected + (question.id to emptySet()) else selected,
            custom = if (skipping) custom + (question.id to "") else custom,
            completed = completed + question.id,
        )
        if (index < questions.lastIndex) return QuestionAdvance(next.copy(index = index + 1))
        val missing = questions.indexOfFirst { it.id !in next.completed }
        if (missing >= 0) return QuestionAdvance(next.copy(index = missing), QuestionProblem.Incomplete)
        return QuestionAdvance(next, answers = questions.map {
            QuestionReply(it.id, it.options.filter { label -> label in next.selected[it.id].orEmpty() },
                next.custom[it.id]?.trim()?.takeIf(String::isNotEmpty))
        })
    }
}
