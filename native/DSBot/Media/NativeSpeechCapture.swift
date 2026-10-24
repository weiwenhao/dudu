import AVFAudio
import Accelerate
import Combine
import Foundation
@preconcurrency import Speech

@MainActor
final class NativeSpeechCapture: ObservableObject {
    @Published private(set) var isRecording = false
    @Published private(set) var isFinishing = false
    @Published private(set) var transcript = ""
    @Published private(set) var notice: String?
    let meter = SpeechAudioMeter()

    var onRecognition: ((String) -> Void)?
    var onDraft: ((String) -> Void)?

    private let audioCapture = AudioCaptureController()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var completionTimeout: Task<Void, Never>?
    private var generation = 0
    private var shouldSubmit = false
    private var hasFinalResult = false
    private var preparedRecognizer: Task<PreparedRecognizer?, Never>?

    /// Warm what a press will need, without asking for anything: the recognizer, whose creation is the slow
    /// part of starting, is built here on a background thread. Does nothing until both permissions were granted.
    func prepare() {
        guard SFSpeechRecognizer.authorizationStatus() == .authorized,
              AVAudioApplication.shared.recordPermission == .granted else { return }
        _ = recognizer()
    }

    /// The one recognizer, built off the main thread the first time and kept.
    private func recognizer() -> Task<PreparedRecognizer?, Never> {
        if let preparedRecognizer { return preparedRecognizer }
        let startedAt = ProcessInfo.processInfo.systemUptime
        let task = Task.detached(priority: .userInitiated) { () -> PreparedRecognizer? in
            guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN")) else { return nil }
            let prepared = PreparedRecognizer(recognizer: recognizer, supportsOnDevice: recognizer.supportsOnDeviceRecognition)
            DSBotLog.record("voice.prepare", elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)
            return prepared
        }
        preparedRecognizer = task
        return task
    }

    func begin() async {
        cancel()
        generation += 1
        let token = generation
        let startedAt = ProcessInfo.processInfo.systemUptime
        transcript = ""
        notice = nil
        meter.reset()

        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("-dsbot-ui-review") {
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-delayed-speech") {
                try? await Task.sleep(nanoseconds: 700_000_000)
                guard generation == token else { return }
            }
            isRecording = true
            transcript = ProcessInfo.processInfo.arguments.contains("-dsbot-review-silent") ? "" : "继续优化手机界面"
            hasFinalResult = true
            meter.update(0.65, force: true)
            DSBotLog.record("voice.capture.ready", elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)
            return
        }
        #endif

        let currentSpeechStatus = SFSpeechRecognizer.authorizationStatus()
        let currentMicrophoneStatus = AVAudioApplication.shared.recordPermission
        let speechAuthorizationTask: Task<SFSpeechRecognizerAuthorizationStatus, Never>? =
            currentSpeechStatus == .notDetermined
            ? Task { await requestSpeechAuthorization() }
            : nil
        let microphoneAuthorizationTask: Task<Bool, Never>? =
            currentMicrophoneStatus == .undetermined
            ? Task { await requestMicrophonePermission() }
            : nil

        let speechStatus: SFSpeechRecognizerAuthorizationStatus
        if let speechAuthorizationTask {
            speechStatus = await speechAuthorizationTask.value
        } else {
            speechStatus = currentSpeechStatus
        }
        guard generation == token else { return }
        guard speechStatus == .authorized else {
            notice = "请允许语音识别权限。"
            DSBotLog.record("voice.capture.denied", state: "speech")
            return
        }

        let microphoneGranted: Bool
        if let microphoneAuthorizationTask {
            microphoneGranted = await microphoneAuthorizationTask.value
        } else {
            microphoneGranted = currentMicrophoneStatus == .granted
        }
        guard generation == token else { return }
        guard microphoneGranted else {
            notice = "请允许麦克风权限。"
            DSBotLog.record("voice.capture.denied", state: "microphone")
            return
        }
        DSBotLog.record("voice.permissions.ready", elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)

        // Already built when the talk bar came up; otherwise built here, but never on the main thread.
        guard let prepared = await recognizer().value else {
            preparedRecognizer = nil
            guard generation == token else { return }
            notice = "语音识别暂不可用。"
            DSBotLog.record("voice.capture.unavailable")
            return
        }
        guard generation == token else { return }
        let recognizer = prepared.recognizer
        guard recognizer.isAvailable else {
            notice = "语音识别暂不可用。"
            DSBotLog.record("voice.capture.unavailable")
            return
        }
        DSBotLog.record("voice.recognizer.ready", elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)

        let nextRequest = SFSpeechAudioBufferRecognitionRequest()
        nextRequest.shouldReportPartialResults = true
        if prepared.supportsOnDevice {
            nextRequest.requiresOnDeviceRecognition = true
        }
        request = nextRequest

        do {
            try await audioCapture.start(request: nextRequest) { [weak self] level in
                Task { @MainActor [weak self] in
                    guard let self, self.generation == token, self.isRecording else { return }
                    self.meter.update(level)
                }
            }
            guard generation == token else {
                nextRequest.endAudio()
                audioCapture.stop()
                return
            }
            DSBotLog.record("voice.audio.ready", elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)

            let task = await Task.detached(priority: .userInitiated) { [weak self] in
                prepared.recognizer.recognitionTask(with: nextRequest) { [weak self] result, error in
                    Task { @MainActor [weak self] in
                        guard let self, self.generation == token else { return }
                        if let result {
                            self.transcript = result.bestTranscription.formattedString
                            if result.isFinal {
                                self.hasFinalResult = true
                            }
                        }
                        if self.isFinishing, self.hasFinalResult {
                            self.complete(isFinal: true)
                        } else if self.isFinishing && error != nil {
                            self.complete(isFinal: false)
                        } else if error != nil {
                            self.failQuietly()
                        }
                    }
                }
            }.value
            guard generation == token else {
                task.cancel()
                return
            }
            recognitionTask = task
            isRecording = true
            DSBotLog.record(
                "voice.capture.ready",
                elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000
            )
        } catch {
            guard generation == token else { return }
            audioCapture.stop()
            request = nil
            notice = "语音识别暂不可用。"
            DSBotLog.record(
                "voice.capture.failed",
                elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000
            )
        }
    }

    func finish() {
        guard isRecording else { return }
        isRecording = false
        isFinishing = true
        shouldSubmit = true
        request?.endAudio()
        audioCapture.stop()

        if hasFinalResult {
            complete(isFinal: true)
            return
        }

        completionTimeout?.cancel()
        completionTimeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard let self, !Task.isCancelled, self.isFinishing else { return }
            self.complete(isFinal: false)
        }
    }

    func cancel() {
        generation += 1
        completionTimeout?.cancel()
        completionTimeout = nil
        shouldSubmit = false
        hasFinalResult = false
        isRecording = false
        isFinishing = false
        transcript = ""
        meter.reset()
        notice = nil
        request?.endAudio()
        audioCapture.stop()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
    }

    private func complete(isFinal: Bool) {
        completionTimeout?.cancel()
        completionTimeout = nil
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        let submit = shouldSubmit
        shouldSubmit = false
        hasFinalResult = false
        generation += 1
        isRecording = false
        isFinishing = false
        audioCapture.stop()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
        guard submit, !text.isEmpty else { return }
        if isFinal {
            onRecognition?(text)
        } else {
            onDraft?(text)
        }
    }

    private func failQuietly() {
        completionTimeout?.cancel()
        completionTimeout = nil
        shouldSubmit = false
        hasFinalResult = false
        generation += 1
        isRecording = false
        isFinishing = false
        audioCapture.stop()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
    }

    private func requestSpeechAuthorization() async -> SFSpeechRecognizerAuthorizationStatus {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                continuation.resume(returning: status)
            }
        }
    }

    private func requestMicrophonePermission() async -> Bool {
        await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}

/// A recognizer and what it can do, built on one thread and used on another.
private struct PreparedRecognizer: @unchecked Sendable {
    let recognizer: SFSpeechRecognizer
    let supportsOnDevice: Bool
}

@MainActor
final class SpeechAudioMeter: ObservableObject {
    @Published private(set) var level = 0.0
    private var lastUpdate = 0.0

    func update(_ value: Double, force: Bool = false) {
        let now = ProcessInfo.processInfo.systemUptime
        guard force || now - lastUpdate >= 0.05 else { return }
        lastUpdate = now
        level = min(1, max(0, value))
    }

    func reset() { level = 0 }
}

// Engine state is confined to queue; callbacks only publish immutable meter values.
private final class AudioCaptureController: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.harnessmobile.dsbot.audio-capture", qos: .userInitiated)
    private var engine: AVAudioEngine?
    private var tapInstalled = false
    private var sessionActive = false

    func start(
        request: SFSpeechAudioBufferRecognitionRequest,
        onLevel: @escaping @Sendable (Double) -> Void
    ) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    let audioSession = AVAudioSession.sharedInstance()
                    if audioSession.category != .record || audioSession.mode != .measurement {
                        try audioSession.setCategory(.record, mode: .measurement)
                    }
                    try audioSession.setActive(true)
                    self.sessionActive = true

                    let engine = self.engine ?? AVAudioEngine()
                    self.engine = engine
                    let inputNode = engine.inputNode
                    let format = inputNode.outputFormat(forBus: 0)
                    guard format.sampleRate > 0 else { throw SpeechCaptureError.noInput }

                    if self.tapInstalled {
                        inputNode.removeTap(onBus: 0)
                        self.tapInstalled = false
                    }
                    inputNode.installTap(onBus: 0, bufferSize: 1_024, format: format) { buffer, _ in
                        request.append(buffer)
                        if let samples = buffer.floatChannelData?.pointee, buffer.frameLength > 0 {
                            var rms: Float = 0
                            vDSP_rmsqv(samples, 1, &rms, vDSP_Length(buffer.frameLength))
                            onLevel(Double(min(1, rms * 10)))
                        }
                    }
                    self.tapInstalled = true
                    engine.prepare()
                    try engine.start()
                    continuation.resume()
                } catch {
                    self.stopOnQueue()
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func stop() {
        queue.async { self.stopOnQueue() }
    }

    private func stopOnQueue() {
        if let engine, engine.isRunning {
            engine.stop()
        }
        if tapInstalled, let engine {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        if sessionActive {
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            sessionActive = false
        }
    }
}

private enum SpeechCaptureError: Error {
    case noInput
}
