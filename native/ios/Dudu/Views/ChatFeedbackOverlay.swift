import SwiftUI

struct ChatFeedbackOverlay: View {
    @ObservedObject var store: DuduStore
    @ObservedObject var capture: NativeSpeechCapture
    @Binding var commandResult: DuduToastMessage?
    @Binding var photoNotice: String?
    let onDismissVoiceNotice: () -> Void
    @State private var feedback: Feedback?

    private enum Source {
        case command
        case notice
        case error
        case photo
        case voice
    }

    private struct Feedback {
        let source: Source
        let message: DuduToastMessage
    }

    var body: some View {
        DuduToastOverlay(message: feedback?.message, onDismiss: dismiss)
            .onReceive(store.$notice) { present($0, source: .notice, kind: .information) }
            .onReceive(store.$error) { present($0, source: .error, kind: .error) }
            .onReceive(capture.$notice) { present($0, source: .voice, kind: .error) }
            .onChange(of: commandResult, initial: true) { _, message in
                present(message, source: .command)
            }
            .onChange(of: photoNotice, initial: true) { _, notice in
                present(notice, source: .photo, kind: .warning)
            }
            .onChange(of: store.selectedSession?.id) { _, _ in dismissCurrent() }
            .onChange(of: store.activeComputer?.id) { _, _ in dismissCurrent() }
    }

    private func present(_ text: String?, source: Source, kind: DuduToastMessage.Kind) {
        present(text.flatMap { $0.isEmpty ? nil : DuduToastMessage(text: $0, kind: kind) }, source: source)
    }

    private func present(_ message: DuduToastMessage?, source: Source) {
        guard let message else {
            if feedback?.source == source { feedback = nil }
            return
        }
        let previous = feedback
        feedback = Feedback(source: source, message: message)
        if let previous, previous.source != source { clear(previous) }
    }

    private func dismiss(_ message: DuduToastMessage) {
        guard let feedback, feedback.message.id == message.id else { return }
        self.feedback = nil
        clear(feedback)
    }

    private func dismissCurrent() {
        if let feedback { dismiss(feedback.message) }
    }

    private func clear(_ feedback: Feedback) {
        let text = feedback.message.text
        switch feedback.source {
        case .command:
            if commandResult?.id == feedback.message.id { commandResult = nil }
        case .notice:
            if store.notice == text { store.notice = nil }
        case .error:
            if store.error == text { store.error = nil }
        case .photo:
            if photoNotice == text { photoNotice = nil }
        case .voice:
            if capture.notice == text { onDismissVoiceNotice() }
        }
    }
}
