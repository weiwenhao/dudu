import SwiftUI

// The two trailing composer glyphs. They are drawn bare — no ring — so they read as a pair with the
// plain "+" on the other side of the capsule. Proportions come from Doubao's icons (25pt box).

/// Voice-input toggle: a dot and two sound arcs opening to the right.
struct DSBotVoiceGlyph: View {
    var size: CGFloat = 25
    /// Grows the mark inside its box; with the ring gone it carries the visual weight alone.
    var scale: CGFloat = 1.22

    var body: some View {
        Canvas { context, canvas in
            let k = canvas.width / 25
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: (12.5 + (x - 12.5) * scale) * k, y: (12.5 + (y - 12.5) * scale) * k)
            }

            let dot = point(8.4, 12.85)
            let dotRadius = 1.35 * scale * k
            context.fill(
                Path(ellipseIn: CGRect(
                    x: dot.x - dotRadius, y: dot.y - dotRadius, width: dotRadius * 2, height: dotRadius * 2
                )),
                with: .foreground
            )
            for (radius, sweep) in [(4.9, 42.0), (8.5, 50.0)] {
                var arc = Path()
                var degrees = -sweep
                while degrees <= sweep + 0.01 {
                    let radians = degrees * .pi / 180
                    let tip = CGPoint(
                        x: dot.x + CGFloat(radius * cos(radians)) * scale * k,
                        y: dot.y + CGFloat(radius * sin(radians)) * scale * k
                    )
                    if degrees == -sweep { arc.move(to: tip) } else { arc.addLine(to: tip) }
                    degrees += 3
                }
                context.stroke(
                    arc,
                    with: .foreground,
                    style: StrokeStyle(lineWidth: 2 * k, lineCap: .round, lineJoin: .round)
                )
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// Keyboard toggle: a 3×2 key grid over a space bar.
struct DSBotKeyboardGlyph: View {
    var size: CGFloat = 25
    var scale: CGFloat = 1.42

    var body: some View {
        Canvas { context, canvas in
            let k = canvas.width / 25
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: (12.5 + (x - 12.5) * scale) * k, y: (12.5 + (y - 12.5) * scale) * k)
            }

            let keyRadius = 1.2 * scale * k
            for y in [8.6, 12.4] {
                for x in [8.65, 12.5, 16.35] {
                    let center = point(x, y)
                    context.fill(
                        Path(ellipseIn: CGRect(
                            x: center.x - keyRadius, y: center.y - keyRadius,
                            width: keyRadius * 2, height: keyRadius * 2
                        )),
                        with: .foreground
                    )
                }
            }
            let bar = point(8.4, 15.9)
            context.fill(
                Path(
                    roundedRect: CGRect(x: bar.x, y: bar.y, width: 8.25 * scale * k, height: 1.9 * scale * k),
                    cornerRadius: 0.95 * scale * k
                ),
                with: .foreground
            )
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// DSH's checklist mark: two small rings, each followed by a dash. It stands for a list of things to go
/// through (the sidebar's view options, a conversation's tasks). Proportions are measured from the
/// reference (a 14pt-wide mark in a 20pt box, 1pt strokes at 3x), so it sits as lightly as the "…" under it,
/// and its centre is the centre of the box, which is what lines the two columns up.
struct DSBotChecklistGlyph: View {
    var size: CGFloat = 20
    var strokeWidth: CGFloat = 1.4

    var body: some View {
        Canvas { context, canvas in
            let k = canvas.width / 20
            let style = StrokeStyle(lineWidth: strokeWidth * k, lineCap: .round)
            let radius = 2.1 * k
            let ringX = 5.375 * k
            for y in [6.15, 13.85] {
                let centre = CGPoint(x: ringX, y: CGFloat(y) * k)
                context.stroke(
                    Path(ellipseIn: CGRect(
                        x: centre.x - radius, y: centre.y - radius, width: radius * 2, height: radius * 2
                    )),
                    with: .foreground,
                    style: style
                )
                var dash = Path()
                dash.move(to: CGPoint(x: 10.025 * k, y: centre.y))
                dash.addLine(to: CGPoint(x: 16.725 * k, y: centre.y))
                context.stroke(dash, with: .foreground, style: style)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
