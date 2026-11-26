import LucideSwift
import SwiftUI
import UIKit

/// What to do on the computer before the phone can connect: the card on the first page of the app (owner, 2026-11-27, proposal 1 of
/// `.local/designs/phone-first-run-2026-11-27/`: 「实现吧」). Install DSH, add the plugin, make the pairing QR code in 嘟嘟's settings. The numbered rings
/// with a line between them are the Desktop's 连接指南 (`ConnectionGuide.jsx`) at phone size. The words are the owner's; a name in 「」 never breaks
/// across two lines.
struct ConnectionGuideSteps: View {
    private static let pluginName = "dsh-dudu"
    private static let dshAddress = "deepseek.com/harness"

    @Environment(\.openURL) private var openURL
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            step(1) {
                text(L10n.text("在电脑上安装 DSH"))
                Button {
                    DuduLog.record("connection.guide.link")
                    if let url = URL(string: "https://\(Self.dshAddress)") { openURL(url) }
                } label: {
                    HStack(spacing: 2) {
                        Text(Self.dshAddress).font(.system(size: 14))
                        LucideIcon(.arrowUpRight, size: 13, strokeWidth: 2.2, absoluteStrokeWidth: false)
                            .frame(width: 13, height: 13)
                    }
                    .foregroundStyle(DuduStyle.blue)
                    .frame(minHeight: 22)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DuduIconButtonStyle())
                .accessibilityIdentifier("connection.guide.dsh")
            }
            step(2) {
                // The name follows the sentence on its line when there is room for it, and the copy chip follows the name; what does not fit starts the next line.
                WrappingRow(spacing: 6, lineSpacing: 4) {
                    text(L10n.text("在 DSH 的「添加插件」里输入"))
                    Text(Self.pluginName)
                        .font(.system(size: 13.5, design: .monospaced))
                        .foregroundStyle(DuduStyle.ink)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(DuduStyle.selected.opacity(0.8), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .textSelection(.enabled)
                    copyChip
                }
            }
            step(3, last: true) {
                text(L10n.text("打开嘟嘟，点右上角的设置，进入「手机控制」，点「生成二维码」"))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("connection.steps")
    }

    private func text(_ value: String) -> some View {
        Text(value.keepingNamesTogether)
            .font(.system(size: 15))
            .lineSpacing(1.5)
            .foregroundStyle(DuduStyle.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// A ring with its number, and the line that runs down to the next ring (not under the last step).
    private func step<Content: View>(_ number: Int, last: Bool = false, @ViewBuilder _ content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(number)")
                .font(.system(size: 12, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(DuduStyle.ink)
                .frame(width: 24, height: 24)
                .overlay(Circle().strokeBorder(DuduStyle.scopeInk.opacity(0.5), lineWidth: 1.5))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 0) { content() }
                .padding(.top, 1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.bottom, last ? 0 : 16)
        .background(alignment: .topLeading) {
            if !last {
                Rectangle().fill(DuduStyle.line).frame(width: 1).padding(.top, 24).offset(x: 11.5)
            }
        }
    }

    /// 复制: the plugin's name goes to the clipboard; the glyph turns into a check for a moment and the phone gives a light tap (no new word).
    private var copyChip: some View {
        Button {
            UIPasteboard.general.string = Self.pluginName
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            DuduLog.record("connection.guide.copy")
            copied = true
        } label: {
            HStack(spacing: 4) {
                LucideIcon(copied ? .check : .copy, size: 12, strokeWidth: 2.2, absoluteStrokeWidth: false)
                    .frame(width: 12, height: 12)
                Text(L10n.text("复制")).font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(DuduStyle.ink)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(DuduStyle.selected.opacity(0.8), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(DuduIconButtonStyle())
        .accessibilityIdentifier("connection.guide.copy")
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}

/// Children in a line that wraps as text does: a child that does not fit in the rest of the line starts the next one, and a line's children are centred on each other.
private struct WrappingRow: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrange(width: proposal.width ?? .infinity, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let arranged = arrange(width: bounds.width, subviews: subviews)
        for (subview, frame) in zip(subviews, arranged.frames) {
            subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), proposal: ProposedViewSize(frame.size))
        }
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> (frames: [CGRect], size: CGSize) {
        let limit = width.isFinite ? width : .greatestFiniteMagnitude
        var lines: [[(index: Int, size: CGSize)]] = [[]]
        var used: CGFloat = 0
        for (index, subview) in subviews.enumerated() {
            var size = subview.sizeThatFits(.unspecified)
            if size.width > limit { size = subview.sizeThatFits(ProposedViewSize(width: limit, height: nil)) }
            if lines[lines.count - 1].isEmpty {
                lines[lines.count - 1].append((index, size))
                used = size.width
            } else if used + spacing + size.width > limit {
                lines.append([(index, size)])
                used = size.width
            } else {
                lines[lines.count - 1].append((index, size))
                used += spacing + size.width
            }
        }
        var frames = [CGRect](repeating: .zero, count: subviews.count)
        var y: CGFloat = 0
        var widest: CGFloat = 0
        for (number, line) in lines.enumerated() {
            let height = line.map(\.size.height).max() ?? 0
            var x: CGFloat = 0
            for item in line {
                frames[item.index] = CGRect(x: x, y: y + (height - item.size.height) / 2, width: item.size.width, height: item.size.height)
                x += item.size.width + spacing
            }
            widest = max(widest, x - spacing)
            y += height + (number < lines.count - 1 ? lineSpacing : 0)
        }
        return (frames, CGSize(width: widest, height: y))
    }
}

private extension String {
    /// A name in 「」 stays on one line: a word joiner (U+2060), which a line is never broken at, between its characters. The brackets already keep to
    /// their neighbours (an opening one does not end a line, a closing one does not start one).
    var keepingNamesTogether: String {
        let characters = Array(self)
        var result = ""
        var inside = false
        for (index, character) in characters.enumerated() {
            result.append(character)
            if character == "「" { inside = true } else if character == "」" { inside = false }
            if inside, index + 1 < characters.count, characters[index + 1] != "」" { result.append("\u{2060}") }
        }
        return result
    }
}
