import Observation
import SwiftUI

@MainActor
@Observable
final class BoardPageMotion {
    private(set) var progress: CGFloat = 0
    private(set) var isInteracting = false
    private(set) var isAnimating = false
    @ObservationIgnored private var revision = 0

    var isMoving: Bool { isInteracting || isAnimating }

    func drag(to translation: CGFloat, width: CGFloat) {
        guard !isAnimating, width > 0 else { return }
        if !isInteracting {
            revision &+= 1
            isInteracting = true
        }
        progress = min(1, max(0, 1 - translation / width))
    }

    func animate(
        showingConversation: Bool, animation: Animation,
        updates: () -> Void = {},
        completion: @escaping () -> Void = {}
    ) {
        revision &+= 1
        let current = revision
        let started = ProcessInfo.processInfo.systemUptime
        DuduLog.record("board.input.lock", state: showingConversation ? "enter" : "return")
        // Keep the history covered when the finger hands the page over to its spring.
        isAnimating = true
        isInteracting = false
        // Unlock when the page reaches its destination, not after the spring's invisible tail.
        withAnimation(animation, completionCriteria: .logicallyComplete) {
            progress = showingConversation ? 1 : 0
            updates()
        } completion: {
            guard self.revision == current else { return }
            DuduLog.record("board.input.unlock", elapsedMs: (ProcessInfo.processInfo.systemUptime - started) * 1_000,
                            state: showingConversation ? "enter" : "return")
            completion()
            if self.revision == current { self.isAnimating = false }
        }
    }

    func reset(showingConversation: Bool) {
        if isAnimating { DuduLog.record("board.input.unlock", state: "reset") }
        revision &+= 1
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            isInteracting = false
            isAnimating = false
            progress = showingConversation ? 1 : 0
        }
    }
}

enum BoardPagePosition {
    case board, issue, other

    @MainActor
    func progress(using motion: BoardPageMotion) -> CGFloat {
        let progress = motion.progress
        switch self {
        case .board: return 0
        case .issue: return progress
        case .other: return 1
        }
    }
}

/// Only these page transforms observe continuous motion; the lists and root observe its boundaries.
struct BoardConversationMotion: ViewModifier {
    let motion: BoardPageMotion
    let position: BoardPagePosition
    let width: CGFloat
    let reduceMotion: Bool

    func body(content: Content) -> some View {
        let progress = position.progress(using: motion)
        content
            .geometryGroup()
            .offset(x: reduceMotion ? 0 : width * (1 - progress))
            .opacity(reduceMotion ? Double(progress) : 1)
    }
}

struct BoardBackgroundMotion: ViewModifier {
    let motion: BoardPageMotion
    let position: BoardPagePosition
    let width: CGFloat
    let reduceMotion: Bool

    func body(content: Content) -> some View {
        let progress = position.progress(using: motion)
        content
            .overlay {
                Color.black.opacity(Double(0.09 * progress))
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .geometryGroup()
            .offset(x: reduceMotion ? 0 : -width * 0.24 * progress)
    }
}

struct BoardBackGesture: ViewModifier {
    let motion: BoardPageMotion
    let width: CGFloat
    let onBegin: () -> Void
    let onComplete: () -> Void
    let onCancel: () -> Void
    @GestureState private var isTracking = false

    func body(content: Content) -> some View {
        content
            .gesture(
                DragGesture(minimumDistance: 12)
                    .updating($isTracking) { value, state, transaction in
                        guard state || value.translation.width > abs(value.translation.height) * 1.5 else { return }
                        transaction.animation = nil
                        state = true
                    }
                    .onChanged { value in
                        guard !motion.isAnimating,
                              motion.isInteracting || value.translation.width > abs(value.translation.height) * 1.5 else { return }
                        if !motion.isInteracting { onBegin() }
                        motion.drag(to: value.translation.width, width: width)
                    }
                    .onEnded { value in
                        guard motion.isInteracting else { return }
                        if value.predictedEndTranslation.width > width * 0.33 {
                            onComplete()
                        } else {
                            onCancel()
                        }
                    }
            )
            .onChange(of: isTracking) { _, tracking in
                if !tracking, motion.isInteracting { onCancel() }
            }
    }
}
