import SwiftUI
import UIKit

enum DSBotScrollEdges {
    static var usesSystemEffect: Bool {
        if #available(iOS 26.0, *) { return true }
        return false
    }

    @available(iOS 26.0, *)
    static var systemStyle: ScrollEdgeEffectStyle {
        // Build with SDK 27+: SDK 26.2 omitted the toolbar from this effect on iOS 27.
        return .soft
    }
}

/// Attach the actual controls so the system can shape the scroll edge around them.
struct DSBotScrollEdgeBar<Bar: View>: ViewModifier {
    let edge: VerticalEdge
    var underlapsBar = false
    var showsEffect = true
    @ViewBuilder let bar: () -> Bar

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                // Chat already reserves the measured chrome on its last history row.
                .ignoresSafeArea(.container, edges: underlapsBar ? edges : [])
                .safeAreaBar(edge: edge, spacing: 0) {
                    bar()
                }
                .scrollEdgeEffectStyle(DSBotScrollEdges.systemStyle, for: edges)
                .scrollEdgeEffectHidden(!showsEffect, for: edges)
        } else {
            content
                .overlay(alignment: edge == .top ? .top : .bottom) {
                    bar()
                }
        }
    }

    private var edges: Edge.Set { edge == .top ? .top : .bottom }
}

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
    /// Positions the title transition; stronger layers begin easing out before this height.
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
    private var masks: [EdgeBlurMaskView] = []
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
            let mask = EdgeBlurMaskView()
            view.mask = mask
            addSubview(view)
            effectViews.append(view)
            masks.append(mask)
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
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        defer { CATransaction.commit() }
        for (index, layer) in Self.layers.enumerated() where index < effectViews.count {
            let view = effectViews[index]
            view.frame = bounds
            // Keep the reference's faint ink shadows rather than whitening them away.
            view.contentView.backgroundColor = fullStrengthHeight > 0 && index == Self.layers.count - 1
                ? UIColor.systemBackground.withAlphaComponent(0.36) : .clear
            let maskView = masks[index]
            maskView.frame = view.bounds
            let mask = maskView.gradient
            if fullStrengthHeight > 0 {
                // Synchronized stops draw a horizontal boundary. Begin the stronger
                // layers earlier, with a zero-slope transition at both ends.
                let strongestRadius = Self.layers.last?.radius ?? layer.radius
                let startHeight = max(0, fullStrengthHeight - 24 * layer.radius / strongestRadius)
                let start = bounds.height > 0 ? min(1, startHeight / bounds.height) : 0
                let steps = 32
                mask.colors = [UIColor.black.cgColor] + (0...steps).map { step in
                    let progress = Double(step) / Double(steps)
                    let eased = progress * progress * (3 - 2 * progress)
                    let opacity = 1 - eased
                    return UIColor.black.withAlphaComponent(CGFloat(opacity)).cgColor
                }
                mask.locations = [0] + (0...steps).map { step in
                    NSNumber(value: Double(start + (1 - start) * CGFloat(step) / CGFloat(steps)))
                }
            } else {
                mask.colors = [UIColor.black.cgColor, UIColor.black.cgColor, UIColor.clear.cgColor]
                mask.locations = [
                    0,
                    NSNumber(value: Double(layer.solid)),
                    NSNumber(value: Double(layer.reach))
                ]
            }
            if edge == .top {
                mask.startPoint = CGPoint(x: 0.5, y: 0)
                mask.endPoint = CGPoint(x: 0.5, y: 1)
            } else {
                mask.startPoint = CGPoint(x: 0.5, y: 1)
                mask.endPoint = CGPoint(x: 0.5, y: 0)
            }
            // UIKit copies a view mask into its backdrop and content views. A layer mask
            // only clips the effect's output; reassign after resizing to refresh those copies.
            view.mask = nil
            view.mask = maskView
        }
    }
}

private final class EdgeBlurMaskView: UIView {
    override class var layerClass: AnyClass { CAGradientLayer.self }
    var gradient: CAGradientLayer { layer as! CAGradientLayer }
}
