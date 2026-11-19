import Observation
import SwiftUI

/// Only the drawer's effects observe its per-touch translation, not the pages or their lists.
@MainActor
@Observable
final class DrawerMotion {
    private(set) var translation: CGFloat = 0
    private(set) var isInteracting = false
    private(set) var isSettling = false
    @ObservationIgnored private var revision = 0

    var isMoving: Bool { isInteracting || isSettling }

    func offset(width: CGFloat, isOpen: Bool) -> CGFloat {
        isOpen ? width + min(0, max(-width, translation))
            : min(width, max(0, translation))
    }

    func progress(width: CGFloat, isOpen: Bool) -> CGFloat {
        width > 0 ? offset(width: width, isOpen: isOpen) / width : 0
    }

    func drag(to translation: CGFloat, opening: Bool, width: CGFloat) {
        if !isInteracting {
            revision &+= 1
            isSettling = false
            isInteracting = true
        }
        self.translation = opening ? min(width, max(0, translation))
            : min(0, max(-width, translation))
    }

    func settle(animation: Animation, updates: () -> Void = {}) {
        revision &+= 1
        let current = revision
        isSettling = true
        isInteracting = false
        withAnimation(animation, completionCriteria: .logicallyComplete) {
            translation = 0
            updates()
        } completion: {
            guard self.revision == current else { return }
            self.isSettling = false
        }
    }

    func reset() {
        revision &+= 1
        isInteracting = false
        isSettling = false
        translation = 0
    }
}

struct DrawerCardMotion: ViewModifier {
    let motion: DrawerMotion
    let isOpen: Bool
    let width: CGFloat
    let safeTop: CGFloat
    let safeBottom: CGFloat
    let background: Color

    func body(content: Content) -> some View {
        let progress = motion.progress(width: width, isOpen: isOpen)
        let radius = DuduLayout.drawerCornerRadius * progress
        content
            .geometryGroup()
            .mask {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .padding(.top, -safeTop)
                    .padding(.bottom, -safeBottom)
            }
            .background {
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(background)
                    .padding(.top, -safeTop)
                    .padding(.bottom, -safeBottom)
                    .shadow(color: .black.opacity(Double(0.22 * progress)),
                            radius: 40 * progress, x: -3)
            }
            .offset(x: motion.offset(width: width, isOpen: isOpen))
    }
}

struct DrawerPageEffect: ViewModifier {
    let motion: DrawerMotion
    let isOpen: Bool
    let width: CGFloat

    func body(content: Content) -> some View {
        let progress = motion.progress(width: width, isOpen: isOpen)
        content
            .overlay {
                Color(white: 0.96)
                    .opacity(Double(0.4 * progress))
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            .blur(radius: 1.1 * progress)
    }
}

struct DrawerToolbarEffect: ViewModifier {
    let motion: DrawerMotion
    let isOpen: Bool
    let width: CGFloat

    func body(content: Content) -> some View {
        content.opacity(Double(1 - 0.4 * motion.progress(width: width, isOpen: isOpen)))
    }
}

/// The recognizer owns cancellation; a cancelled touch springs back without leaving a partial drawer.
struct DrawerDragGesture: ViewModifier {
    let motion: DrawerMotion
    let opening: Bool
    let width: CGFloat
    let animation: Animation
    let onBegin: () -> Void
    let onComplete: () -> Void
    @GestureState private var isTracking = false

    func body(content: Content) -> some View {
        content
            .gesture(
                DragGesture(minimumDistance: opening ? 8 : 12)
                    .updating($isTracking) { value, state, transaction in
                        guard state || abs(value.translation.width) > abs(value.translation.height) else { return }
                        transaction.animation = nil
                        state = true
                    }
                    .onChanged { value in
                        guard motion.isInteracting
                                || abs(value.translation.width) > abs(value.translation.height) else { return }
                        guard !opening || motion.isInteracting || value.translation.width > 0 else { return }
                        if !motion.isInteracting { onBegin() }
                        motion.drag(to: value.translation.width, opening: opening, width: width)
                    }
                    .onEnded { value in
                        guard motion.isInteracting else { return }
                        let completes = opening
                            ? value.translation.width > width * 0.3 || value.predictedEndTranslation.width > width * 0.6
                            : value.predictedEndTranslation.width < -width * 0.25
                        if completes { onComplete() } else { motion.settle(animation: animation) }
                    }
            )
            .onChange(of: isTracking) { _, tracking in
                if !tracking, motion.isInteracting { motion.settle(animation: animation) }
            }
    }
}

struct DrawerBackdrop: View {
    let motion: DrawerMotion
    let isOpen: Bool
    let width: CGFloat
    let pageWidth: CGFloat
    let pageHeight: CGFloat
    let safeBottom: CGFloat
    let animation: Animation
    let onClose: () -> Void

    var body: some View {
        Button(action: onClose) {
            Color.black.opacity(0.01)
        }
        .buttonStyle(.plain)
        .contentShape(Rectangle())
        .accessibilityLabel(L10n.text("关闭侧边栏"))
        .accessibilityIdentifier("sidebar.backdrop")
        .modifier(DrawerDragGesture(
            motion: motion, opening: false, width: width, animation: animation,
            onBegin: {}, onComplete: onClose
        ))
        .frame(
            width: max(0, pageWidth - motion.offset(width: width, isOpen: isOpen)),
            height: max(0, pageHeight + safeBottom - DuduLayout.toolbarHeight)
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .offset(y: safeBottom)
    }
}
