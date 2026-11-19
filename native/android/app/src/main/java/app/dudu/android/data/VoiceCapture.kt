package app.dudu.android.data

data class VoiceTarget(val computer: String, val session: String)
data class VoiceResult(val target: VoiceTarget, val text: String, val isFinal: Boolean)

/** An utterance may finish before the finger lifts. Only release admits its result, once. */
class VoiceAttempt(val target: VoiceTarget) {
    var text: String = ""
        private set
    var hasFinal: Boolean = false
        private set
    var released: Boolean = false
        private set
    var completed: Boolean = false
        private set
    private var confirmed = false

    fun update(text: String, isFinal: Boolean = false) {
        if (completed || hasFinal) return
        if (text.isNotBlank() || this.text.isBlank()) this.text = text
        hasFinal = isFinal
        confirmed = isFinal && text.isNotBlank()
    }

    fun release() { if (!completed) released = true }

    fun takeResult(allowDraft: Boolean = false): VoiceResult? {
        if (completed || !released || !hasFinal && !allowDraft) return null
        completed = true
        return text.trim().takeIf(String::isNotEmpty)?.let { VoiceResult(target, it, confirmed) }
    }

    fun cancel() {
        completed = true
        text = ""
    }
}

fun appendVoiceDraft(draft: String, text: String): String {
    val spoken = text.trim()
    if (spoken.isEmpty()) return draft
    return if (draft.isEmpty()) spoken else draft + (if (draft.endsWith('\n')) "" else "\n") + spoken
}
