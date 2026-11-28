import SwiftUI

/// The round button at a sheet's trailing edge. Its glyph is the app's own back / close / confirm set (owner, 2026-11-28, picked B of `.local/designs/sheet-icons-2026-11-28/`): Lucide at 22pt, Lucide's own
/// line (1.83pt) and the ink colour, the same for all three (`DuduBarGlyph`), where the close was a 13pt system ✕ in grey next to an 18pt ‹ and a 13pt ✓. The icon canvas stays 20pt, which is what gives
/// the system's circle its approved size (2026-11-16); the 22pt drawing is centred in it.
struct SheetCloseButton: View {
    var label = L10n.text("关闭")
    /// `.close` for a sheet that is closed or cancelled; `.check` for one that is done (the board's filter: its choices apply as they are made, the ✓ closes it).
    var glyph: DuduGlyph = .close
    let action: () -> Void

    var body: some View {
        Group {
            if glyph == .close, #available(iOS 26.0, *) {
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
        DuduBarGlyph(glyph).frame(width: 20, height: 20)
    }
}

/// One of the three glyphs of a sheet's or page's bar: back ‹, close ✕, confirm ✓. They are drawn alike everywhere (owner, 2026-11-28): Lucide, 22pt, its own scaled line, ink.
struct DuduBarGlyph: View {
    let glyph: DuduGlyph
    init(_ glyph: DuduGlyph) { self.glyph = glyph }

    var body: some View {
        DuduIcon(glyph, size: Self.size).foregroundStyle(DuduStyle.ink)
    }

    static let size: CGFloat = 22
}

/// The system reserves the footer once, including in short detents and above the home indicator.
struct SheetFooter<Footer: View>: ViewModifier {
    var showsEffect = true
    @ViewBuilder var footer: () -> Footer

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.modifier(DuduScrollEdgeBar(edge: .bottom, showsEffect: showsEffect, bar: footer))
        } else {
            content.safeAreaInset(edge: .bottom, spacing: 0, content: footer)
        }
    }
}
