import Observation
import SwiftUI

@MainActor
@Observable
final class BoardPageMotion {
    private(set) var progress: CGFloat = 0
    private(set) var isInteracting = false
    private(set) var isAnimating = false
    @ObservationIgnored private var revision = 0
    /// The revision whose end was already handled: the animation's notice and the watchdog can both come, only the first counts.
    @ObservationIgnored private var settled = -1
    @ObservationIgnored private var watchdog: Task<Void, Never>?
    private let watchdogDelay: Duration
    private let perform: Perform

    /// Runs a page's animation: `body` moves the page, `done` is called when it has arrived. SwiftUI's own is the default.
    typealias Perform = @MainActor (Animation, () -> Void, @escaping () -> Void) -> Void

    static let swiftUIAnimation: Perform = { animation, body, done in
        withAnimation(animation, completionCriteria: .logicallyComplete) { body() } completion: { done() }
    }

    /// A transition takes 0.15 to 0.7 s. One that still holds the input after this long has lost the animation's notice: on
    /// 2026-11-24 a conversation opened at 03:56 and the board ignored every touch for 171 s (owner: cannot scroll, cannot go back).
    static let defaultWatchdogDelay: Duration = .seconds(2)

    init(watchdogDelay: Duration? = nil, perform: Perform? = nil) {
        self.watchdogDelay = watchdogDelay ?? Self.defaultWatchdogDelay
        self.perform = perform ?? Self.swiftUIAnimation
    }

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
        let direction = showingConversation ? "enter" : "return"
        DuduLog.record("board.input.lock", state: direction)
        // Keep the history covered when the finger hands the page over to its spring.
        isAnimating = true
        isInteracting = false
        // The end of this transition: the animation says so when the page reaches its destination (not after the spring's
        // invisible tail), or the watchdog does when that notice never comes. Only the first counts.
        let arrive = { [weak self] (lost: Bool) in
            guard let self, self.revision == current, self.settled != current else { return }
            self.settled = current
            self.watchdog?.cancel()
            self.watchdog = nil
            if lost {
                // Put the page where the animation was going, with no animation of its own.
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) { self.progress = showingConversation ? 1 : 0 }
            }
            DuduLog.record("board.input.unlock", elapsedMs: (ProcessInfo.processInfo.systemUptime - started) * 1_000,
                           state: lost ? "watchdog.\(direction)" : direction)
            completion()
            if self.revision == current { self.isAnimating = false }
        }
        watchdog?.cancel()
        let delay = watchdogDelay
        watchdog = Task {
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            arrive(true)
        }
        perform(animation, {
            progress = showingConversation ? 1 : 0
            updates()
        }, { arrive(false) })
    }

    func reset(showingConversation: Bool) {
        if isAnimating { DuduLog.record("board.input.unlock", state: "reset") }
        watchdog?.cancel()
        watchdog = nil
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
