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
        private var trackedTouch: UITouch?
        private var initialY: CGFloat = 0
        private let feedback = UIImpactFeedbackGenerator(style: .medium)

        init() {
            super.init(frame: .zero)
            isMultipleTouchEnabled = false
            isAccessibilityElement = false
            backgroundColor = .clear
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window == nil { cancelPress() } else { feedback.prepare() }
        }

        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard trackedTouch == nil, let touch = touches.first else { return }
            let point = touch.location(in: window)
            guard onBegan?(point, touch.timestamp) == true else { return }
            initialY = point.y
            trackedTouch = touch
            feedback.impactOccurred()
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let touch = trackedTouch, touches.contains(touch) else { return }
            let point = touch.location(in: window)
            onMoved?(point, point.y - initialY)
        }

        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
            guard let touch = trackedTouch, touches.contains(touch) else { return }
            let point = touch.location(in: window)
            onMoved?(point, point.y - initialY)
            trackedTouch = nil
            onEnded?()
            feedback.prepare()
        }

        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
            cancelPress()
        }

        func cancelPress() {
            guard trackedTouch != nil else { return }
            trackedTouch = nil
            onCancelled?()
        }
    }
}
