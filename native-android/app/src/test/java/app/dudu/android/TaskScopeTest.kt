package app.dudu.android

import app.dudu.android.data.*
import org.junit.Assert.*
import org.junit.Test

class TaskScopeTest {
    @Test fun onlyExplicitAndReusedConversationsBelongToTheCurrentSession() {
        assertTrue(taskBelongsToSession(json("target" to json("mode" to "existing", "sessionId" to "here")), "here"))
        assertTrue(taskBelongsToSession(json("target" to json("mode" to "reuse"), "sessionId" to "here"), "here"))
        assertFalse(taskBelongsToSession(json("target" to json("mode" to "existing", "sessionId" to "other")), "here"))
        assertFalse(taskBelongsToSession(json("target" to json("mode" to "new"), "sessionId" to "here"), "here"))
        assertFalse(taskBelongsToSession(json("target" to json("mode" to "reuse")), "here"))
    }
}
