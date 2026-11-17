import SwiftUI
import UIKit

struct AgentLogo: View {
    let agent: SessionAgent
    var size: CGFloat = 18

    private var color: Color {
        switch agent.rawValue {
        case "claude": return Color(red: 217.0 / 255, green: 119.0 / 255, blue: 87.0 / 255)
        case "codex": return DSBotStyle.ink
        case "deepseek": return Color(red: 77.0 / 255, green: 107.0 / 255, blue: 254.0 / 255)
        default: return DSBotStyle.muted
        }
    }

    var body: some View {
        Group {
            if agent == .pi {
                PiMark()
            } else if UIImage(named: "Agent-\(agent.rawValue)") != nil {
                Image("Agent-\(agent.rawValue)")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(color)
            } else {
                // An agent the app has no mark for: its first letter, as the Desktop draws an agent it does not know.
                Text(String(agent.name.prefix(1)))
                    .font(.system(size: size * 0.55, weight: .semibold))
                    .foregroundStyle(color)
                    .frame(width: size, height: size)
                    .background(Circle().fill(color.opacity(0.15)))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// The Pi mark (the three pieces of pi.dev/logo-on-light.svg, on its 800 x 800 grid, in its own colours), the Desktop's `PI_PARTS`: the pieces span 165 to 635 of the grid and are
/// drawn at four fifths of the box, centred.
private struct PiMark: View {
    var body: some View {
        Canvas { context, size in
            let span: CGFloat = 469.43
            let unit = size.width * 0.8 / span
            let origin = (size.width - span * unit) / 2 - 165.29 * unit
            func piece(_ points: [(CGFloat, CGFloat)], _ color: Color) {
                var path = Path()
                path.move(to: CGPoint(x: origin + points[0].0 * unit, y: origin + points[0].1 * unit))
                for point in points.dropFirst() { path.addLine(to: CGPoint(x: origin + point.0 * unit, y: origin + point.1 * unit)) }
                path.closeSubpath()
                context.fill(path, with: .color(color))
            }
            piece([(165.29, 165.29), (517.36, 165.29), (517.36, 400), (400, 400), (400, 282.65), (165.29, 282.65)], Color(red: 240.0 / 255, green: 144.0 / 255, blue: 130.0 / 255))
            piece([(165.29, 282.65), (282.65, 282.65), (282.65, 400), (400, 400), (400, 517.36), (282.65, 517.36), (282.65, 634.72), (165.29, 634.72)], Color(red: 77.0 / 255, green: 154.0 / 255, blue: 191.0 / 255))
            piece([(517.36, 400), (634.72, 400), (634.72, 634.72), (517.36, 634.72)], Color(red: 241.0 / 255, green: 190.0 / 255, blue: 88.0 / 255))
        }
    }
}

struct AgentAvatar: View {
    let agent: SessionAgent
    let state: SessionActivityState
    /// Sleep remains available to accessibility; the phone does not draw its old crescent.
    var asleep = false
    /// 20 on the board; the marks grow with it.
    var size: CGFloat = 20

    private var sleeping: Bool { asleep && state == .idle }

    var body: some View {
        AgentLogo(agent: agent, size: size * 0.9)
            .frame(width: size, height: size)
            .modifier(ConversationAvatarStatus(state: state, size: size))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(agent.name) · \(sleeping ? L10n.text("深度睡眠") : state.name)")
    }

}

/// Working and unread share the upper-right anchor; idle and sleep have no mark on the phone.
struct ConversationAvatarStatus: ViewModifier {
    let state: SessionActivityState
    let size: CGFloat
    var roundedSquare = false

    private var markSize: CGFloat { max(6, size * 13 / 49) }
    private var center: CGFloat { size / 2 + (size / 2 - 0.5) / sqrt(2) }
    private var markX: CGFloat { roundedSquare ? size - 2 : center }
    private var markY: CGFloat { roundedSquare ? 2 : size - center }

    func body(content: Content) -> some View {
        content.overlay(alignment: .topLeading) {
            // Keep the mark mounted in the avatar's local coordinates. Do not cancel the
            // inherited transaction here: it also carries the enclosing row's swipe.
            ZStack {
                Circle().fill(.white)
                    .padding(-max(1, size * 1.6 / 49))
                    .opacity(state == .idle ? 0 : 1)
                Circle()
                    .fill(Color(red: 236.0 / 255, green: 19.0 / 255, blue: 19.0 / 255))
                    .opacity(state == .unread ? 1 : 0)
                if state == .processing { AgentWorkingRing() }
            }
            .frame(width: markSize, height: markSize)
            .offset(x: markX - markSize / 2, y: markY - markSize / 2)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
        .compositingGroup()
    }
}

private struct AgentWorkingRing: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationIsCovered) private var covered
    @Environment(\.scenePhase) private var scenePhase
    private var animates: Bool { !reduceMotion && !covered && scenePhase == .active }

    var body: some View {
        WorkingRingSurface(animates: animates)
    }
}

/// One compositor animation, independent of row refreshes and ancestor spring transactions.
/// Updating an existing view never restarts the rotation and needs no per-frame SwiftUI work.
private struct WorkingRingSurface: UIViewRepresentable {
    let animates: Bool

    func makeUIView(context: Context) -> WorkingRingView { WorkingRingView() }
    func updateUIView(_ view: WorkingRingView, context: Context) {
        view.setAnimating(animates)
    }
    static func dismantleUIView(_ view: WorkingRingView, coordinator: ()) { view.setAnimating(false) }
}

private final class WorkingRingView: UIView {
    private let track = CAShapeLayer()
    private let arc = CAShapeLayer()
    private var animates = false
    private let rotationKey = "working.rotation"

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        let color = UIColor(DSBotStyle.muted)
        for shape in [track, arc] {
            shape.fillColor = UIColor.clear.cgColor
            shape.lineWidth = 1.5
            layer.addSublayer(shape)
        }
        track.strokeColor = color.withAlphaComponent(0.3).cgColor
        arc.strokeColor = color.cgColor
        arc.strokeEnd = 0.28
        arc.lineCap = .round
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for shape in [track, arc] {
            shape.bounds = bounds
            shape.position = CGPoint(x: bounds.midX, y: bounds.midY)
            shape.path = UIBezierPath(ovalIn: bounds.insetBy(dx: 0.75, dy: 0.75)).cgPath
        }
        CATransaction.commit()
    }

    override func didMoveToWindow() { super.didMoveToWindow(); updateRotation() }

    func setAnimating(_ value: Bool) {
        guard animates != value else { return }
        animates = value
        updateRotation()
    }

    private func updateRotation() {
        guard animates, window != nil else { arc.removeAnimation(forKey: rotationKey); return }
        guard arc.animation(forKey: rotationKey) == nil else { return }
        let rotation = CABasicAnimation(keyPath: "transform.rotation.z")
        rotation.fromValue = 0
        rotation.toValue = Double.pi * 2
        rotation.duration = 1
        rotation.timingFunction = CAMediaTimingFunction(name: .linear)
        rotation.repeatCount = .infinity
        arc.add(rotation, forKey: rotationKey)
    }
}
