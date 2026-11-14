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
    let state: AgentWorkState
    /// A `blocked` state that is a finished run: a green disc with a check, not red.
    var finished = false
    /// Deep sleep (the owner picked the picture on 2026-11-05): an agent that nobody has handled for a while. The crescent takes the place of whatever mark the agent has (owner,
    /// 2026-11-07: "进入到睡眠状态，右下角的图标应该都变成月亮才对。重新激活后再恢复到原来的状态"): the ring, the check or the red dot is only covered, and is there again when the agent wakes.
    var asleep = false
    /// 20 on the board; the marks grow with it.
    var size: CGFloat = 20

    private var sleeping: Bool { asleep && state != .working }
    private var unit: CGFloat { size / 20 }

    var body: some View {
        AgentLogo(agent: agent, size: size * 0.9)
            .frame(width: size, height: size)
            .overlay(alignment: .bottomTrailing) {
                if sleeping {
                    // One point larger than the mark's box on every side, centred where the ring is centred, as on the Desktop.
                    AgentSleepMark()
                        .frame(width: 10 * unit, height: 10 * unit)
                        .offset(x: 3 * unit, y: 3 * unit)
                } else {
                    activity
                        .frame(width: 8 * unit, height: 8 * unit)
                        .offset(x: 2 * unit, y: 2 * unit)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(agent.name) · \(sleeping ? L10n.text("深度睡眠") : state.name)")
    }

    @ViewBuilder
    private var activity: some View {
        switch state {
        case .idle:
            Circle().strokeBorder(DSBotStyle.muted.opacity(0.6), lineWidth: 1)
        case .working:
            AgentWorkingRing()
        case .blocked:
            if finished {
                AgentDoneMark()
            } else {
                // DSH's own error colour (`--dsw-alias-state-error-primary`, #EC1313 in the light theme), as the Desktop's mark.
                Circle().fill(Color(red: 236.0 / 255, green: 19.0 / 255, blue: 19.0 / 255))
            }
        }
    }
}

/// Deep sleep: a crescent in moon yellow #E8B923 (owner, 2026-11-05), the Desktop's (`CRESCENT` in `icons.jsx`): the moon, a circle of radius 6.8 on a 16 grid centred at (8.214, 7.803), with a bite of
/// radius 5.2 centred at (12.032, 3.985) taken out toward the upper right, so that the full circle is concentric with the mark's box.
private struct AgentSleepMark: View {
    var body: some View {
        Canvas { context, size in
            let unit = size.width / 16
            func circle(_ x: Double, _ y: Double, _ radius: Double) -> Path {
                Path(ellipseIn: CGRect(x: (x - radius) * unit, y: (y - radius) * unit, width: radius * 2 * unit, height: radius * 2 * unit))
            }
            context.fill(circle(8.214, 7.803, 6.8).subtracting(circle(12.032, 3.985, 5.2)), with: .color(Color(red: 232.0 / 255, green: 185.0 / 255, blue: 35.0 / 255)))
        }
    }
}

/// A finished run: DSH's success colour (`--dsw-alias-state-success-primary`, #22C55E) with a white check, as the Desktop's mark.
private struct AgentDoneMark: View {
    var body: some View {
        Circle().fill(Color(red: 34.0 / 255, green: 197.0 / 255, blue: 94.0 / 255))
            .overlay {
                GeometryReader { proxy in
                    Path { path in
                        let side = min(proxy.size.width, proxy.size.height)
                        path.move(to: CGPoint(x: side * 0.25, y: side * 0.51))
                        path.addLine(to: CGPoint(x: side * 0.42, y: side * 0.68))
                        path.addLine(to: CGPoint(x: side * 0.75, y: side * 0.34))
                    }
                    .stroke(.white, style: StrokeStyle(lineWidth: max(1, proxy.size.width * 0.17), lineCap: .round, lineJoin: .round))
                }
            }
    }
}

private struct AgentWorkingRing: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationIsCovered) private var covered
    @Environment(\.scenePhase) private var scenePhase
    @State private var spinning = false

    private var animates: Bool { !reduceMotion && !covered && scenePhase == .active }

    var body: some View {
        Circle().strokeBorder(DSBotStyle.muted.opacity(0.3), lineWidth: 1.5)
            .overlay {
                Circle().trim(from: 0, to: 0.28)
                    .stroke(DSBotStyle.muted, style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
                    .padding(0.75)
            }
            .rotationEffect(.degrees(spinning && animates ? 360 : 0))
            .animation(animates ? .linear(duration: 1).repeatForever(autoreverses: false) : nil, value: spinning)
            .onChange(of: animates, initial: true) { _, active in spinning = active }
    }
}
