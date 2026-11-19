import SwiftUI
import UIKit

/// Homepage-only swipes. The conversation keeps its width while the actions are revealed.
struct BoardConversationSwipeRow<Content: View>: View {
    let entry: BoardConversation
    let enabled: Bool
    let isRevealed: Bool
    let onReveal: (Bool) -> Void
    let onSwipe: (Bool) -> Void
    let onComplete: () async -> Void
    let onRead: () -> Void
    let onPin: () -> Void
    @ViewBuilder let content: () -> Content
    @State private var offset: CGFloat = 0
    @State private var start: CGFloat = 0
    @State private var isCompleting = false
    @State private var collapsed = false
    @State private var completionArmed = false
    @State private var completionLabelVisible = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var canComplete: Bool { entry.issue != nil && entry.issue?.statusType != "done" }
    private let actionWidth: CGFloat = 84
    private var trailingWidth: CGFloat { actionWidth * 2 }
    private let completeColor = Color(red: 39.0 / 255, green: 179.0 / 255, blue: 160.0 / 255)

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                if offset > 0, canComplete {
                    Button { complete(width: geometry.size.width) } label: {
                        action(L10n.text("完成"), image: "Home-SwipeComplete")
                            .frame(width: actionWidth)
                            .opacity(completionLabelVisible ? 1 : 0)
                            .offset(x: completionArmed ? max(0, offset - actionWidth) : 0)
                            .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: completionArmed)
                            .frame(width: max(actionWidth, offset), alignment: .leading)
                            .background(completeColor.opacity(collapsed ? 0 : 1))
                    }
                } else if offset < 0 {
                    HStack(spacing: 0) {
                        Button { close(); onRead() } label: {
                            action(entry.unread ? L10n.text("清除未读") : L10n.text("标为未读"),
                                   image: entry.readActionImage)
                                .background(Color(red: 39.0 / 255, green: 175.0 / 255, blue: 231.0 / 255))
                        }
                        .disabled(entry.sessionId == nil)
                        Button { close(); onPin() } label: {
                            action(entry.pinned ? L10n.text("取消置顶") : L10n.text("置顶"),
                                   image: entry.pinned ? "Home-SwipeUnpin" : "Home-SwipePin")
                                .background(Color(red: 51.0 / 255, green: 109.0 / 255, blue: 244.0 / 255))
                        }
                    }
                    .frame(width: trailingWidth)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                }
                content()
                    .compositingGroup()
                    .offset(x: offset)
                    .gesture(SwipeRowPanGesture(enabled: enabled && !isCompleting, allowsCompletion: canComplete || isRevealed,
                        onBegan: { start = offset; onSwipe(true) }, onChanged: { translation in
                            offset = min(geometry.size.width, max(-trailingWidth, start + translation))
                            if !canComplete { offset = min(0, offset) }
                            completionArmed = canComplete && start >= 0 && offset >= geometry.size.width * 2 / 3
                            if abs(offset) > 8, !isRevealed { onReveal(true) }
                        }, onEnded: { completed, velocity in
                            onSwipe(false)
                            guard completed else { close(); return }
                            if canComplete, start >= 0, offset >= geometry.size.width * 2 / 3 { complete(width: geometry.size.width) }
                            else {
                                let end = BoardSwipe.destination(start: start, offset: offset, velocity: velocity, actionWidth: actionWidth)
                                settle(end)
                                onReveal(end != 0)
                            }
                        }))
            }
            .buttonStyle(.plain)
            .frame(width: geometry.size.width, height: BoardHomeLayout.rowHeight)
            .position(x: geometry.size.width / 2, y: geometry.size.height / 2)
        }
        .frame(height: collapsed ? 0 : BoardHomeLayout.rowHeight)
        .clipped()
        .allowsHitTesting(!isCompleting)
        .onChange(of: isRevealed) { _, open in if !open, !isCompleting { settle(0) } }
        .onChange(of: enabled) { _, value in if !value, !isCompleting { close(); onSwipe(false) } }
        .onDisappear {
            if !isCompleting { offset = 0 }
            onSwipe(false)
            onReveal(false)
        }
    }

    private func action(_ title: String, image: String) -> some View {
        VStack(spacing: 4) {
            Image(image).resizable().renderingMode(.template).frame(width: 22, height: 22)
            Text(title).font(.system(size: 14)).lineLimit(1).frame(height: 18)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
    }

    private func settle(_ value: CGFloat) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) { offset = value; completionArmed = false }
    }
    private func close() { settle(0); onReveal(false) }
    private func complete(width: CGFloat) {
        guard enabled, canComplete, !isCompleting else { return }
        isCompleting = true
        onReveal(false)
        completionArmed = true
        // The reference moves the action to the reveal's trailing edge after arming.
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18), completionCriteria: .logicallyComplete) {
            offset = width
        } completion: {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.06), completionCriteria: .logicallyComplete) {
                completionLabelVisible = false
            } completion: {
                // Fixed-height artwork clips towards the centre; the colour fades with it.
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22), completionCriteria: .logicallyComplete) {
                    collapsed = true
                } completion: {
                    Task { @MainActor in
                        await onComplete()
                        // Failed saves and the All scope retain the original row.
                        var transaction = Transaction()
                        transaction.disablesAnimations = true
                        withTransaction(transaction) {
                            offset = 0
                            collapsed = false
                            completionArmed = false
                            completionLabelVisible = true
                            isCompleting = false
                        }
                    }
                }
            }
        }
    }
}

/// Reject vertical movement before recognition so the list keeps its ordinary scroll gesture. The board list's rows and the inbox's (`RevealSwipeRow`) share it.
struct SwipeRowPanGesture: UIGestureRecognizerRepresentable {
    /// The name its diagnostics are recorded under.
    var event = "board.row.swipe"
    let enabled: Bool
    let allowsCompletion: Bool
    let onBegan: () -> Void
    let onChanged: (CGFloat) -> Void
    let onEnded: (Bool, CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator(allowsCompletion: allowsCompletion) }
    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delaysTouchesBegan = false
        pan.delaysTouchesEnded = false
        pan.delegate = context.coordinator
        pan.isEnabled = enabled
        return pan
    }
    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        recognizer.isEnabled = enabled
        context.coordinator.allowsCompletion = allowsCompletion
    }
    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        switch pan.state {
        case .began:
            context.coordinator.tracking = true
            DSBotLog.record(event, state: "begin")
            onBegan()
            onChanged(pan.translation(in: nil).x)
        case .changed: onChanged(pan.translation(in: nil).x)
        case .ended, .cancelled, .failed:
            guard context.coordinator.tracking else { return }
            context.coordinator.tracking = false
            DSBotLog.record(event, geometry: ["dragX": pan.translation(in: nil).x],
                            state: pan.state == .ended ? "ended" : "cancelled")
            if pan.state == .ended { onChanged(pan.translation(in: nil).x) }
            onEnded(pan.state == .ended, pan.velocity(in: nil).x)
        default: break
        }
    }
    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var tracking = false
        var allowsCompletion: Bool
        init(allowsCompletion: Bool) { self.allowsCompletion = allowsCompletion }
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: nil)
            return abs(velocity.x) > abs(velocity.y) * 1.5 && (allowsCompletion || velocity.x < 0)
        }
        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
            other.view is UIScrollView
        }
    }
}
