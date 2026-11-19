import SwiftUI

/// One compact system close symbol for native sheet toolbars.
struct SheetCloseButton: View {
    var label = L10n.text("关闭")
    let action: () -> Void

    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                Button(role: .close, action: action) { symbol }
            } else {
                Button(action: action) { symbol }
            }
        }
        .controlSize(.small)
        .labelStyle(.iconOnly)
        .buttonBorderShape(.circle)
        .accessibilityLabel(label)
    }

    private var symbol: some View {
        Image(systemName: "xmark")
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(DuduStyle.chatSecondary)
            .frame(width: 20, height: 20)
    }
}

/// The system reserves the footer once, including in short detents and above the home indicator.
struct SheetFooter<Footer: View>: ViewModifier {
    @ViewBuilder var footer: () -> Footer

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.modifier(DuduScrollEdgeBar(edge: .bottom, bar: footer))
        } else {
            content.safeAreaInset(edge: .bottom, spacing: 0, content: footer)
        }
    }
}
