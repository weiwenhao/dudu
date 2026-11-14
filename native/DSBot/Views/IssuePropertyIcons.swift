import SwiftUI

/// The desktop's status geometry and colours (`ui/issues/icons.jsx`), including custom workflow colours.
struct IssueStatusIcon: View {
    let type: String
    var color: String?
    var iconProgress: Double?
    var size: CGFloat = 16

    private var ink: Color {
        if let color = color.flatMap(Color.init(issueHex:)) { return color }
        let hex = [
            "backlog": "95a2b3", "todo": "a0a5ad", "in_progress": "f2c94c",
            "in_review": "4cb782", "done": "5e6ad2", "canceled": "95a2b3",
        ][type] ?? "95a2b3"
        return Color(issueHex: hex) ?? DSBotStyle.muted
    }

    var body: some View {
        Canvas { context, _ in
            context.scaleBy(x: size / 16, y: size / 16)
            let circle = Path(ellipseIn: CGRect(x: 2, y: 2, width: 12, height: 12))
            if type == "done" || type == "canceled" {
                context.fill(Path(ellipseIn: CGRect(x: 1, y: 1, width: 14, height: 14)), with: .color(ink))
                var mark = Path()
                if type == "done" {
                    mark.move(to: CGPoint(x: 5, y: 8.2))
                    mark.addLine(to: CGPoint(x: 7, y: 10.2))
                    mark.addLine(to: CGPoint(x: 11, y: 5.8))
                } else {
                    mark.move(to: CGPoint(x: 5.6, y: 5.6))
                    mark.addLine(to: CGPoint(x: 10.4, y: 10.4))
                    mark.move(to: CGPoint(x: 10.4, y: 5.6))
                    mark.addLine(to: CGPoint(x: 5.6, y: 10.4))
                }
                context.stroke(mark, with: .color(.white), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
            } else {
                context.stroke(circle, with: .color(ink), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: type == "backlog" ? [1.6, 2.4] : []))
                if type == "in_progress" || type == "in_review" {
                    let progress = iconProgress ?? (type == "in_review" ? 0.75 : 0.5)
                    if progress == 1 {
                        context.fill(Path(ellipseIn: CGRect(x: 4.2, y: 4.2, width: 7.6, height: 7.6)), with: .color(ink))
                    } else if progress > 0 {
                        var sector = Path()
                        sector.move(to: CGPoint(x: 8, y: 8))
                        sector.addArc(center: CGPoint(x: 8, y: 8), radius: 3.8, startAngle: .degrees(-90), endAngle: .degrees(-90 + progress * 360), clockwise: false)
                        sector.closeSubpath()
                        context.fill(sector, with: .color(ink))
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

struct IssuePriorityIcon: View {
    let priority: IssuePriority

    var body: some View {
        Canvas { context, _ in
            if priority == .urgent {
                context.fill(Path(roundedRect: CGRect(x: 1.5, y: 1.5, width: 13, height: 13), cornerRadius: 3.5), with: .color(Color(issueHex: "f4793b")!))
                var bang = Path()
                bang.move(to: CGPoint(x: 8, y: 4.6))
                bang.addLine(to: CGPoint(x: 8, y: 8.6))
                context.stroke(bang, with: .color(.white), style: StrokeStyle(lineWidth: 1.7, lineCap: .round))
                context.fill(Path(ellipseIn: CGRect(x: 7, y: 10, width: 2, height: 2)), with: .color(.white))
            } else if priority == .none {
                for x in [2.0, 6.7, 11.4] {
                    var dash = Path()
                    dash.move(to: CGPoint(x: x, y: 8))
                    dash.addLine(to: CGPoint(x: x + 2.6, y: 8))
                    context.stroke(dash, with: .color(DSBotStyle.muted), style: StrokeStyle(lineWidth: 1.7, lineCap: .round))
                }
            } else {
                let level = priority == .high ? 3 : priority == .medium ? 2 : 1
                for (index, x) in [2.0, 6.5, 11.0].enumerated() {
                    let height = Double(5 + index * 3)
                    let bar = Path(roundedRect: CGRect(x: x, y: 14 - height, width: 3, height: height), cornerRadius: 1)
                    context.fill(bar, with: .color(DSBotStyle.muted.opacity(index < level ? 1 : 0.28)))
                }
            }
        }
        .frame(width: 16, height: 16)
        .accessibilityHidden(true)
    }
}

enum IssueLabelPalette {
    static let colors: [(id: String, title: String, hex: String)] = [
        ("grey", L10n.text("灰色"), "bec2c8"), ("darkGrey", L10n.text("深灰"), "95a2b3"), ("purple", L10n.text("紫色"), "5e6ad2"),
        ("teal", L10n.text("青色"), "26b5ce"), ("green", L10n.text("绿色"), "4cb782"), ("yellow", L10n.text("黄色"), "f2c94c"),
        ("orange", L10n.text("橙色"), "f2994a"), ("pink", L10n.text("粉色"), "f7c8c1"), ("red", L10n.text("红色"), "eb5757"),
    ]

    static func color(_ name: String) -> Color {
        Color(issueHex: colors.first { $0.id == name }?.hex ?? "95a2b3") ?? DSBotStyle.muted
    }
}

extension Color {
    init?(issueHex text: String) {
        let digits = text.hasPrefix("#") ? String(text.dropFirst()) : text
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(red: Double(value >> 16 & 255) / 255, green: Double(value >> 8 & 255) / 255, blue: Double(value & 255) / 255)
    }
}
