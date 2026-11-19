package app.dudu.android.media

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import app.dudu.android.data.VoiceAttempt
import app.dudu.android.data.VoiceResult
import app.dudu.android.data.VoiceTarget

enum class VoicePhase { Idle, Starting, Listening, Finishing }
enum class VoiceProblem { Microphone, Unavailable }

/** Android owns audio capture and recognition in its recognition service, not in the UI thread. */
class AndroidSpeechCapture(private val context: Context) {
    var phase by mutableStateOf(VoicePhase.Idle)
        private set
    var transcript by mutableStateOf("")
        private set
    var level by mutableFloatStateOf(0f)
        private set
    var cancelling by mutableStateOf(false)
        private set
    var result by mutableStateOf<VoiceResult?>(null)
        private set
    var problem by mutableStateOf<VoiceProblem?>(null)
        private set

    val active get() = phase != VoicePhase.Idle
    private val handler = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var attempt: VoiceAttempt? = null
    private var generation = 0
    private var lastMeterAt = 0L
    private var limit: Runnable? = null
    private var completion: Runnable? = null

    fun microphoneDenied() { problem = VoiceProblem.Microphone }

    fun begin(target: VoiceTarget, language: String) {
        cancel()
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            microphoneDenied()
            return
        }
        phase = VoicePhase.Starting
        val token = generation
        val current = VoiceAttempt(target).also { attempt = it }
        Log.d("DuduVoice", "capture.start")
        try {
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                finish(null)
                problem = VoiceProblem.Unavailable
                return
            }
            val service = SpeechRecognizer.createSpeechRecognizer(context)
            recognizer = service
            service.setRecognitionListener(object : RecognitionListener {
                private fun isCurrent() = generation == token && attempt === current
                override fun onReadyForSpeech(params: Bundle?) {
                    if (isCurrent() && phase == VoicePhase.Starting) phase = VoicePhase.Listening
                }
                override fun onBeginningOfSpeech() = Unit
                override fun onEndOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) {
                    if (!isCurrent()) return
                    val now = SystemClock.uptimeMillis()
                    if (now - lastMeterAt >= 50) {
                        lastMeterAt = now
                        level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
                    }
                }
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
                override fun onPartialResults(partialResults: Bundle?) {
                    if (!isCurrent()) return
                    partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let {
                        current.update(it)
                        transcript = current.text
                        if (phase == VoicePhase.Starting) phase = VoicePhase.Listening
                    }
                }
                override fun onResults(results: Bundle?) {
                    if (!isCurrent()) return
                    current.update(results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty(), true)
                    transcript = current.text
                    if (phase == VoicePhase.Starting) phase = VoicePhase.Listening
                    completeIfReady(allowDraft = true)
                }
                override fun onError(error: Int) {
                    if (!isCurrent()) return
                    if (cancelling) { cancel(); return }
                    Log.d("DuduVoice", "capture.error:$error")
                    // A failed/partial recognition is a draft, never an automatic send.
                    val draft = current.text.trim().takeIf(String::isNotEmpty)?.let { VoiceResult(current.target, it, false) }
                    finish(draft)
                    if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) problem = VoiceProblem.Microphone
                    else if (error !in listOf(SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT))
                        problem = VoiceProblem.Unavailable
                }
            })
            service.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                // A hold, rather than a silence detector, owns the end of this utterance.
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 60000L)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 60000L))
            limit = Runnable {
                if (generation == token && attempt === current) {
                    if (cancelling) cancel() else release()
                }
            }.also { handler.postDelayed(it, 60000) }
        } catch (_: SecurityException) {
            finish(null)
            problem = VoiceProblem.Microphone
        } catch (_: RuntimeException) {
            finish(null)
            problem = VoiceProblem.Unavailable
        }
    }

    fun move(cancel: Boolean) { if (active && phase != VoicePhase.Finishing) cancelling = cancel }

    fun release() {
        val current = attempt ?: return
        if (cancelling || phase == VoicePhase.Starting) {
            cancel()
            return
        }
        if (phase == VoicePhase.Finishing) return
        current.release()
        phase = VoicePhase.Finishing
        limit?.let(handler::removeCallbacks); limit = null
        if (completeIfReady()) return
        Log.d("DuduVoice", "capture.release")
        val token = generation
        completion = Runnable {
            if (generation == token && attempt === current) completeIfReady(allowDraft = true)
        }.also { handler.postDelayed(it, 5000) }
        try { recognizer?.stopListening() }
        catch (_: RuntimeException) { completeIfReady(allowDraft = true) }
    }

    fun consumeResult() { result = null }

    fun cancel() {
        attempt?.cancel()
        finish(null)
        problem = null
        Log.d("DuduVoice", "capture.cancel")
    }

    private fun completeIfReady(allowDraft: Boolean = false): Boolean {
        val current = attempt ?: return false
        val recognized = current.takeResult(allowDraft)
        if (!current.completed) return false
        finish(recognized)
        return true
    }

    private fun finish(recognized: VoiceResult?) {
        generation++
        limit?.let(handler::removeCallbacks); limit = null
        completion?.let(handler::removeCallbacks); completion = null
        attempt = null
        val old = recognizer
        recognizer = null
        // Fence callbacks before cancel/destroy; a late service reply cannot finish another press.
        try { old?.cancel() } catch (_: RuntimeException) { }
        try { old?.destroy() } catch (_: RuntimeException) { }
        phase = VoicePhase.Idle
        transcript = ""
        level = 0f
        cancelling = false
        result = recognized
    }
}
