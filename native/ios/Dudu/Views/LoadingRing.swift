import SwiftUI
import UIKit

/// The reference's thin, fading ring, shared by connection and message delivery progress.
struct DuduLoadingRing: View {
    var size: CGFloat = 22
    var color: Color = DuduStyle.muted
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationIsCovered) private var covered
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        LoadingRingSurface(color: UIColor(color), animates: !reduceMotion && !covered && scenePhase == .active)
            .frame(width: size, height: size)
            .allowsHitTesting(false)
    }
}

/// Like the working avatar mark, rotate on the compositor without a SwiftUI frame timer.
private struct LoadingRingSurface: UIViewRepresentable {
    let color: UIColor
    let animates: Bool

    func makeUIView(context: Context) -> LoadingRingView { LoadingRingView() }
    func updateUIView(_ view: LoadingRingView, context: Context) {
        view.configure(color: color, animates: animates)
    }
    static func dismantleUIView(_ view: LoadingRingView, coordinator: ()) {
        view.setAnimating(false)
    }
}

private final class LoadingRingView: UIView {
    private let ring = CAGradientLayer()
    private let stroke = CAShapeLayer()
    private var color: UIColor?
    private var animates = false
    private let rotationKey = "loading.rotation"

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        ring.type = .conic
        ring.startPoint = CGPoint(x: 0.5, y: 0.5)
        ring.endPoint = CGPoint(x: 0.5, y: 0)
        ring.locations = [0, 0.08, 0.24, 0.62, 1]
        stroke.fillColor = UIColor.clear.cgColor
        stroke.strokeColor = UIColor.black.cgColor
        stroke.lineCap = .round
        ring.mask = stroke
        layer.addSublayer(ring)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        ring.bounds = bounds
        ring.position = CGPoint(x: bounds.midX, y: bounds.midY)
        stroke.frame = bounds
        // Keep the same 24pt-grid proportions as the approved LoaderCircle preview.
        let unit = min(bounds.width, bounds.height) / 24
        stroke.lineWidth = 1.8 * unit
        stroke.path = UIBezierPath(
            arcCenter: CGPoint(x: bounds.midX, y: bounds.midY), radius: 9 * unit,
            startAngle: -.pi / 2 + .pi * 0.16, endAngle: .pi * 1.5, clockwise: true
        ).cgPath
        CATransaction.commit()
    }

    func configure(color: UIColor, animates: Bool) {
        if self.color != color {
            self.color = color
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            let opacities: [CGFloat] = [0, 0, 0.2, 0.7, 1]
            ring.colors = opacities.map { color.withAlphaComponent($0).cgColor }
            CATransaction.commit()
        }
        setAnimating(animates)
    }

    override func didMoveToWindow() { super.didMoveToWindow(); updateRotation() }

    func setAnimating(_ value: Bool) {
        guard animates != value else { return }
        animates = value
        updateRotation()
    }

    private func updateRotation() {
        guard animates, window != nil else { ring.removeAnimation(forKey: rotationKey); return }
        guard ring.animation(forKey: rotationKey) == nil else { return }
        let rotation = CABasicAnimation(keyPath: "transform.rotation.z")
        rotation.fromValue = 0
        rotation.toValue = Double.pi * 2
        rotation.duration = 1
        rotation.timingFunction = CAMediaTimingFunction(name: .linear)
        rotation.repeatCount = .infinity
        ring.add(rotation, forKey: rotationKey)
    }
}
