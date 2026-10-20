import SwiftUI

/// One selector above the composer: project, mode or model, with a chevron when it can be changed.
struct ContextChip: View {
    let glyph: DSBotGlyph
    let title: String
    let showsChevron: Bool
    let identifier: String
    var maxTextWidth: CGFloat = 170
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                DSBotIcon(glyph, size: 15)
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: maxTextWidth)
                    .fixedSize(horizontal: true, vertical: false)
                if showsChevron {
                    DSBotIcon(.down, size: 12)
                        .opacity(0.7)
                }
            }
            .foregroundStyle(DSBotStyle.chatSecondary)
            .padding(.horizontal, 11)
            .frame(height: 32)
            .background(DSBotStyle.chatPanel, in: Capsule())
            .overlay(Capsule().stroke(DSBotStyle.chatBorder, lineWidth: 0.5))
            .contentShape(Capsule())
        }
        .buttonStyle(DSBotQuietPressStyle())
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier(identifier)
    }
}

/// Which list the context sheet shows.
enum ContextPicker: String, Identifiable {
    case project, mode
    var id: String { rawValue }
}

/// A short list to choose from (projects or modes), styled like the "+" sheet.
struct ContextPickerSheet: View {
    struct Row: Identifiable {
        let id: String
        let title: String
        var subtitle: String?
        var isSelected: Bool
    }

    let title: String
    let footnote: String?
    let rows: [Row]
    let emptyText: String
    let identifierPrefix: String
    let onSelect: (String) -> Void

    static func height(rows: Int, hasFootnote: Bool) -> CGFloat {
        let body = CGFloat(max(1, rows)) * 62 + (hasFootnote ? 44 : 0)
        return min(64 + body + 24, 560)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color(white: 0.4))
                .padding(.leading, 40.5)
                .padding(.top, 22)
                .frame(height: 59, alignment: .topLeading)
                .accessibilityAddTraits(.isHeader)
            ScrollView {
                VStack(spacing: 0) {
                    if rows.isEmpty {
                        Text(emptyText)
                            .font(.system(size: 15))
                            .foregroundStyle(DSBotStyle.muted)
                            .frame(maxWidth: .infinity, minHeight: 60)
                    }
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 {
                            Rectangle()
                                .fill(Color(white: 233.0 / 255))
                                .frame(height: 0.5)
                                .padding(.leading, 20)
                                .padding(.trailing, 16)
                        }
                        Button {
                            onSelect(row.id)
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.title)
                                        .font(.system(size: 17))
                                        .foregroundStyle(Color.black)
                                        .lineLimit(1)
                                    if let subtitle = row.subtitle {
                                        Text(subtitle)
                                            .font(.system(size: 12.5))
                                            .foregroundStyle(DSBotStyle.muted)
                                            .lineLimit(2)
                                            .multilineTextAlignment(.leading)
                                    }
                                }
                                Spacer(minLength: 8)
                                if row.isSelected {
                                    DSBotIcon(.check, size: 20)
                                        .foregroundStyle(DSBotStyle.ink)
                                }
                            }
                            .padding(.horizontal, 20)
                            .frame(minHeight: 60)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(DSBotQuietPressStyle())
                        .accessibilityLabel(row.title)
                        .accessibilityAddTraits(row.isSelected ? .isSelected : [])
                        .accessibilityIdentifier(identifierPrefix + row.id)
                    }
                }
                .background(ComposerAttachmentSheet.card, in: RoundedRectangle(cornerRadius: 27, style: .continuous))
                .padding(.horizontal, 16)
                if let footnote {
                    Text(footnote)
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.muted)
                        .padding(.horizontal, 28)
                        .padding(.top, 12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ComposerAttachmentSheet.background)
    }
}
