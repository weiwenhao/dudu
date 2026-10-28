import SwiftUI
import UIKit

struct VoicePressSurface: UIViewRepresentable {
    var onBegan: (CGPoint, TimeInterval) -> Bool
    var onMoved: (CGPoint, CGFloat) -> Void
    var onEnded: () -> Void
    var onCancelled: () -> Void

    func makeUIView(context: Context) -> Surface {
        let view = Surface()
        updateUIView(view, context: context)
        return view
    }

    func updateUIView(_ view: Surface, context: Context) {
        view.onBegan = onBegan
        view.onMoved = onMoved
        view.onEnded = onEnded
        view.onCancelled = onCancelled
    }

    static func dismantleUIView(_ view: Surface, coordinator: ()) {
        view.cancelPress()
    }

    final class Surface: UIView {
        var onBegan: ((CGPoint, TimeInterval) -> Bool)?
        var onMoved: ((CGPoint, CGFloat) -> Void)?
        var onEnded: (() -> Void)?
        var onCancelled: (() -> Void)?
        private let press = PressGesture()
        private var isPressActive = false
        private var initialY: CGFloat = 0
        private let feedback = UIImpactFeedbackGenerator(style: .medium)

        init() {
            super.init(frame: .zero)
            isMultipleTouchEnabled = false
            isAccessibilityElement = true
            accessibilityLabel = "按住说话，上滑取消"
            accessibilityTraits = .button
            accessibilityIdentifier = "composer.hold"
            backgroundColor = .clear
            press.addTarget(self, action: #selector(handlePress))
            addGestureRecognizer(press)
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window == nil { cancelPress() } else { feedback.prepare() }
        }

        @objc private func handlePress() {
            let point = press.location(in: window)
            switch press.state {
            case .began:
                guard onBegan?(point, press.startedAt) == true else {
                    press.isEnabled = false
                    press.isEnabled = true
                    return
                }
                initialY = point.y
                isPressActive = true
                feedback.impactOccurred()
            case .changed:
                if isPressActive { onMoved?(point, point.y - initialY) }
            case .ended:
                guard isPressActive else { return }
                onMoved?(point, point.y - initialY)
                isPressActive = false
                onEnded?()
                feedback.prepare()
            case .cancelled, .failed:
                cancelPress()
            default:
                break
            }
        }

        func cancelPress() {
            guard isPressActive else { return }
            isPressActive = false
            onCancelled?()
            press.isEnabled = false
            press.isEnabled = true
        }
    }

    /// Claim the touch immediately, before an ancestor's message menu can recognize a long press.
    private final class PressGesture: UIGestureRecognizer {
        private var trackedTouch: UITouch?
        private(set) var startedAt: TimeInterval = 0

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            guard trackedTouch == nil, let touch = touches.first else { return }
            trackedTouch = touch
            startedAt = touch.timestamp
            state = .began
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
            guard let touch = trackedTouch, touches.contains(touch) else { return }
            state = .changed
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
            guard let touch = trackedTouch, touches.contains(touch) else { return }
            state = .ended
        }

        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
            state = .cancelled
        }

        override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool {
            false
        }

        override func reset() {
            super.reset()
            trackedTouch = nil
        }
    }
}
