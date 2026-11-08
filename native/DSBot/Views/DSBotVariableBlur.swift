import SwiftUI
import UIKit

/// Progressive blur that is strongest at a screen edge and eases to nothing across `height`.
///
/// Public API only: a stack of `UIVisualEffectView`s whose blur radius is dialled in by pausing a
/// `UIViewPropertyAnimator`, each faded out by a gradient mask. Every layer blurs the layers
/// beneath it, so the radius accumulates towards the edge — a close match to the bar edge effect
/// in iOS 26 without relying on private filters.
struct DSBotEdgeBlur: UIViewRepresentable {
    let edge: VerticalEdge
    let height: CGFloat
    /// Scales every layer's radius: 1 is the full effect, less is lighter.
    var strength: CGFloat = 1
    /// Keeps all layers fully visible this far from the edge, then eases them out below it.
    var fullStrengthHeight: CGFloat = 0

    func makeUIView(context: Context) -> VariableBlurView {
        VariableBlurView(edge: edge, strength: strength, fullStrengthHeight: fullStrengthHeight)
    }

    func updateUIView(_ view: VariableBlurView, context: Context) {
        view.edge = edge
        view.strength = strength
        view.fullStrengthHeight = fullStrengthHeight
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: VariableBlurView, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 0, height: height)
    }
}

final class VariableBlurView: UIView {
    /// One blur layer: `radius` is the animator fraction (0...1 of the style's full radius),
    /// `solid` and `reach` are fractions of the band height where the mask starts to fade and
    /// where it reaches zero.
    private struct Layer {
        let radius: CGFloat
        let solid: CGFloat
        let reach: CGFloat
    }

    private static let layers: [Layer] = [
        Layer(radius: 0.030, solid: 0.45, reach: 1.00),
        Layer(radius: 0.055, solid: 0.38, reach: 0.88),
        Layer(radius: 0.090, solid: 0.30, reach: 0.74),
        Layer(radius: 0.140, solid: 0.22, reach: 0.60),
        Layer(radius: 0.210, solid: 0.12, reach: 0.46)
    ]

    var edge: VerticalEdge {
        didSet { if edge != oldValue { setNeedsLayout() } }
    }

    var strength: CGFloat {
        didSet { if strength != oldValue { rebuildAnimators() } }
    }
    var fullStrengthHeight: CGFloat {
        didSet { if fullStrengthHeight != oldValue { setNeedsLayout() } }
    }
    private var effectViews: [UIVisualEffectView] = []
    private var animators: [UIViewPropertyAnimator] = []
    private var observer: NSObjectProtocol?

    init(edge: VerticalEdge, strength: CGFloat = 1, fullStrengthHeight: CGFloat = 0) {
        self.edge = edge
        self.strength = strength
        self.fullStrengthHeight = fullStrengthHeight
        super.init(frame: .zero)
        isUserInteractionEnabled = false
        isAccessibilityElement = false
        backgroundColor = .clear
        clipsToBounds = false

        // XCUITest never sees an app as idle while a paused UIViewPropertyAnimator is alive (a single
        // tap waited ~130 s), so UI test runs launch with the blur off. Screenshots keep it.
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("-dsbot-review-no-blur") { return }
        #endif
        for layer in Self.layers {
            let view = UIVisualEffectView(effect: nil)
            view.isUserInteractionEnabled = false
            view.layer.mask = CAGradientLayer()
            addSubview(view)
            effectViews.append(view)
            animators.append(makeAnimator(for: view, fraction: layer.radius * strength))
        }

        observer = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.rebuildAnimators()
        }
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        animators.forEach(Self.finish)
    }

    private func makeAnimator(for view: UIVisualEffectView, fraction: CGFloat) -> UIViewPropertyAnimator {
        view.effect = nil
        let animator = UIViewPropertyAnimator(duration: 1, curve: .linear) {
            view.effect = UIBlurEffect(style: .regular)
        }
        animator.pausesOnCompletion = true
        animator.fractionComplete = fraction
        return animator
    }

    private static func finish(_ animator: UIViewPropertyAnimator) {
        if animator.state == .active {
            animator.stopAnimation(false)
        }
        if animator.state == .stopped {
            animator.finishAnimation(at: .current)
        }
    }

    // The paused animators drop their blur when the app is backgrounded.
    private func rebuildAnimators() {
        animators.forEach(Self.finish)
        animators = zip(effectViews, Self.layers).map { [strength] view, layer in
            makeAnimator(for: view, fraction: layer.radius * strength)
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let solidFraction = bounds.height > 0 ? min(1, max(0, fullStrengthHeight / bounds.height)) : 0
        let fadeFraction = 1 - solidFraction
        for (view, layer) in zip(effectViews, Self.layers) {
            view.frame = bounds
            guard let mask = view.layer.mask as? CAGradientLayer else { continue }
            mask.frame = view.bounds
            mask.colors = [UIColor.black.cgColor, UIColor.black.cgColor, UIColor.clear.cgColor]
            mask.locations = [
                0,
                NSNumber(value: Double(solidFraction + layer.solid * fadeFraction)),
                NSNumber(value: Double(solidFraction + layer.reach * fadeFraction))
            ]
            if edge == .top {
                mask.startPoint = CGPoint(x: 0.5, y: 0)
                mask.endPoint = CGPoint(x: 0.5, y: 1)
            } else {
                mask.startPoint = CGPoint(x: 0.5, y: 1)
                mask.endPoint = CGPoint(x: 0.5, y: 0)
            }
        }
    }
}
