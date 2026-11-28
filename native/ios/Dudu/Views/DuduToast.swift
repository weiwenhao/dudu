import SwiftUI
import UIKit

struct DuduToastMessage: Identifiable, Equatable {
    enum Kind {
        case success
        case information
        case warning
        case error

        var symbol: String {
            switch self {
            case .success: return "checkmark.circle.fill"
            case .information: return "info.circle.fill"
            case .warning: return "exclamationmark.circle.fill"
            case .error: return "xmark.circle.fill"
            }
        }

        var duration: Duration {
            switch self {
            case .success: return .seconds(1) // owner, 2026-11-23: 「不需要 3 秒，1 秒就行了」
            case .information, .warning: return .seconds(5)
            case .error: return .seconds(7)
            }
        }
    }

    let id = UUID()
    let text: String
    let kind: Kind
    /// Override the default duration for short connection errors.
    var duration: Duration? = nil
    /// Whether to show the close button.
    var showsClose = true
}

struct DuduToastOverlay: View {
    let message: DuduToastMessage?
    let onDismiss: (DuduToastMessage) -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverEnabled

    var body: some View {
        ZStack {
            if let message {
                DuduToast(message: message) { onDismiss(message) }
                    .id(message.id)
                    .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
            }
        }
        .allowsHitTesting(message != nil)
        .animation(.easeOut(duration: reduceMotion ? 0.15 : 0.25), value: message?.id)
        .task(id: message?.id) {
            guard let message else { return }
            UIAccessibility.post(notification: .announcement, argument: message.text)
            do {
                let shown = message.duration ?? message.kind.duration
                try await Task.sleep(for: voiceOverEnabled ? max(shown, .seconds(8)) : shown)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            onDismiss(message)
        }
    }
}

private struct DuduToast: View {
    let message: DuduToastMessage
    let onDismiss: () -> Void
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    private let shape = RoundedRectangle(cornerRadius: 26, style: .continuous)

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: message.kind.symbol)
                .font(.system(size: 20, weight: .medium))
                .foregroundStyle(message.kind == .error ? DuduStyle.chatError : DuduStyle.ink)
                .accessibilityHidden(true)
            Text(message.text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(DuduStyle.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("feedback.message")
            if message.showsClose {
                Button(action: onDismiss) {
                    DuduIcon(.close, size: 13)
                        .foregroundStyle(DuduStyle.chatSecondary)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.text("关闭提示"))
                .accessibilityIdentifier("feedback.dismiss")
            }
        }
        // 54pt high with or without the ✕ (its button is 44pt).
        .frame(minHeight: 44)
        .padding(.leading, 16)
        .padding(.trailing, message.showsClose ? 4 : 18)
        .padding(.vertical, 5)
        .background {
            if reduceTransparency {
                shape.fill(DuduStyle.canvas)
            } else {
                shape.fill(.regularMaterial)
                    .overlay { shape.fill(DuduStyle.canvas.opacity(0.7)) }
            }
        }
        .overlay { shape.stroke(DuduStyle.ink.opacity(0.08), lineWidth: 0.5).allowsHitTesting(false) }
        .shadow(color: .black.opacity(0.08), radius: 12, y: 4)
        .frame(maxWidth: 360)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("feedback.toast")
    }
}
