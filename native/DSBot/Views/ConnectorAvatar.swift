import SwiftUI

/// Where a record comes from, as a small picture (owner, 2026-11-07): the service's own mark when the plugin names one for the
/// record (the catalog's connector, or a service its name says: Lark, Stripe, QQ, WeChat and so on), and otherwise the first letter
/// of the collector's name on a soft colour that its name picks. The desktop draws the same (`ui/collector/ConnectorAvatar.jsx`):
/// the same twelve tones, picked by the same sum (seven until 2026-11-18, when the owner asked for more: "加到 12 种吧"; the five added are sky, orange, lime, magenta and coffee, after the old seven).
struct ConnectorAvatar: View {
    /// The icon key of the card (`connectorIcon`), or nil.
    let icon: String?
    let name: String
    var size: CGFloat = 28

    /// The logos shipped in the asset catalog (`Connector-<key>`; rendered from the desktop's by `scripts/render-connector-icons.mjs`,
    /// which also writes this list as `ConnectorLogoKeys`).
    private static let logos = ConnectorLogoKeys.all
    private static let tones: [(background: Color, letter: Color)] = [
        (ConnectorAvatar.rgb(0xE8F0FE), ConnectorAvatar.rgb(0x2F5FD0)), (ConnectorAvatar.rgb(0xE6F4EA), ConnectorAvatar.rgb(0x177A3C)),
        (ConnectorAvatar.rgb(0xFDF1D6), ConnectorAvatar.rgb(0x8A5300)), (ConnectorAvatar.rgb(0xFCE8EC), ConnectorAvatar.rgb(0xB3294A)),
        (ConnectorAvatar.rgb(0xEEE9FD), ConnectorAvatar.rgb(0x5B3FC4)), (ConnectorAvatar.rgb(0xE0F4F3), ConnectorAvatar.rgb(0x0F766E)),
        (ConnectorAvatar.rgb(0xECEEF1), ConnectorAvatar.rgb(0x4B5563)), (ConnectorAvatar.rgb(0xE0F2FB), ConnectorAvatar.rgb(0x0B6A94)),
        (ConnectorAvatar.rgb(0xFDE9DC), ConnectorAvatar.rgb(0xA4410B)), (ConnectorAvatar.rgb(0xEDF5D6), ConnectorAvatar.rgb(0x4F6B0A)),
        (ConnectorAvatar.rgb(0xFBE6F5), ConnectorAvatar.rgb(0xA0198A)), (ConnectorAvatar.rgb(0xF3EBE3), ConnectorAvatar.rgb(0x6B4F3A)),
    ]

    fileprivate static func rgb(_ value: Int) -> Color {
        Color(red: Double((value >> 16) & 0xFF) / 255, green: Double((value >> 8) & 0xFF) / 255, blue: Double(value & 0xFF) / 255)
    }

    /// Which tone a name gets: the desktop's sum over the characters, so the same name has the same colour on both.
    static func tone(of name: String) -> Int {
        var sum: UInt32 = 0
        for scalar in name.unicodeScalars { sum = sum &* 31 &+ scalar.value }
        return Int(sum % UInt32(tones.count))
    }

    static func colors(of name: String) -> (background: Color, letter: Color) {
        tones[tone(of: name)]
    }

    static func initial(of name: String) -> String {
        guard let first = name.trimmingCharacters(in: .whitespacesAndNewlines).first else { return "?" }
        return String(first).uppercased()
    }

    var body: some View {
        let radius = (size * 0.29).rounded()
        Group {
            if let icon, Self.logos.contains(icon) {
                RoundedRectangle(cornerRadius: radius, style: .continuous).fill(.white)
                    .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(DSBotStyle.line, lineWidth: 1))
                    .overlay(Image("Connector-\(icon)").resizable().scaledToFit().frame(width: size * 0.6, height: size * 0.6))
            } else {
                let tone = Self.colors(of: name)
                RoundedRectangle(cornerRadius: radius, style: .continuous).fill(tone.background)
                    .overlay(Text(Self.initial(of: name)).font(.system(size: size * 0.46, weight: .semibold)).foregroundStyle(tone.letter))
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
