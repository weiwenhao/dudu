package app.dudu.android

import app.dudu.android.data.*
import org.junit.Assert.*
import org.junit.Test

class VoiceCaptureTest {
    private val target = VoiceTarget("computer", "session")

    @Test fun earlyFinalWaitsForReleaseAndCanBeDeliveredOnlyOnce() {
        val attempt = VoiceAttempt(target)
        attempt.update("继续处理", true)
        assertNull(attempt.takeResult())
        attempt.release()
        assertEquals(VoiceResult(target, "继续处理", true), attempt.takeResult())
        assertNull(attempt.takeResult())
    }

    @Test fun releaseWaitsForFinalAndAnUnfinishedRecognitionBecomesADraft() {
        val attempt = VoiceAttempt(target)
        attempt.update("保留这些文字")
        attempt.release()
        assertNull(attempt.takeResult())
        assertEquals(VoiceResult(target, "保留这些文字", false), attempt.takeResult(allowDraft = true))
        attempt.update("late final", true)
        assertNull(attempt.takeResult())
        val final = VoiceAttempt(target)
        final.release()
        final.update("完整结果", true)
        assertEquals(VoiceResult(target, "完整结果", true), final.takeResult())
        val emptyFinal = VoiceAttempt(target)
        emptyFinal.update("尚未确认的文字")
        emptyFinal.release()
        emptyFinal.update("", true)
        assertEquals(VoiceResult(target, "尚未确认的文字", false), emptyFinal.takeResult(allowDraft = true))
    }

    @Test fun cancelRejectsLateResultsAndAnEmptyUtteranceNeverSends() {
        val attempt = VoiceAttempt(target)
        attempt.update("不能发送")
        attempt.cancel()
        attempt.release()
        attempt.update("late", true)
        assertNull(attempt.takeResult(allowDraft = true))
        val empty = VoiceAttempt(target)
        empty.release()
        empty.update("  ", true)
        assertNull(empty.takeResult())
        assertTrue(empty.completed)
    }

    @Test fun partialRecognitionAppendsWithoutReplacingTheExistingDraft() {
        assertEquals("原草稿\n识别文字", appendVoiceDraft("原草稿", " 识别文字 "))
        assertEquals("原草稿\n识别文字", appendVoiceDraft("原草稿\n", "识别文字"))
        assertEquals("原草稿", appendVoiceDraft("原草稿", " "))
        assertEquals("识别文字", appendVoiceDraft("", "识别文字"))
    }
}
