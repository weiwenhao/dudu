import SwiftUI

/// One selector above the composer: project, mode or model, with a chevron when it can be changed.
struct ContextChip: View {
    let glyph: DuduGlyph
    let title: String
    let showsChevron: Bool
    let identifier: String
    var maxTextWidth: CGFloat = 170
    var agent: SessionAgent? = nil
    var iconOnly = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ContextChipLabel(title: title, showsChevron: showsChevron, maxTextWidth: maxTextWidth, iconOnly: iconOnly) {
                if let agent {
                    AgentLogo(agent: agent, size: 16)
                } else {
                    DuduIcon(glyph, size: 16, scalesStroke: true)
                }
            }
        }
        .buttonStyle(DuduQuietPressStyle())
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier(identifier)
    }
}

/// The existing context pill, shared by composer buttons and issue property selectors.
struct ContextChipLabel<Icon: View>: View {
    let title: String
    var showsChevron = false
    var maxTextWidth: CGFloat? = nil
    var iconOnly = false
    @ViewBuilder var icon: () -> Icon

    var body: some View {
        HStack(spacing: 6) {
            icon()
            if !iconOnly {
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(maxWidth: maxTextWidth)
            }
            if showsChevron && !iconOnly {
                Image("ContextChevron")
                    .resizable()
                    .renderingMode(.template)
                    .frame(width: 12, height: 12)
                    .opacity(0.7)
                    .accessibilityHidden(true)
            }
        }
        .foregroundStyle(DuduStyle.chatSecondary)
        .padding(.horizontal, iconOnly ? 8 : 11)
        .frame(height: 32)
        .background(DuduStyle.chatPanel, in: Capsule())
        .overlay(Capsule().stroke(DuduStyle.chatBorder, lineWidth: 0.5))
        .contentShape(Capsule())
    }
}

/// Which list the context sheet shows.
enum ContextPicker: String, Identifiable {
    case project, mode, provider
    var id: String { rawValue }
}

/// A short list to choose from (projects or modes), styled like the "+" sheet.
struct ContextPickerSheet: View {
    struct Row: Identifiable {
        let id: String
        let title: String
        var subtitle: String?
        var isSelected: Bool
        var agent: SessionAgent? = nil
    }

    let title: String
    let rows: [Row]
    let emptyText: String
    let identifierPrefix: String
    let onSelect: (String) -> Void

    static func height(rows: Int) -> CGFloat {
        let body = CGFloat(max(1, rows)) * 62
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
                            .foregroundStyle(DuduStyle.muted)
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
                                if let agent = row.agent { AgentLogo(agent: agent, size: 20) }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(row.title)
                                        .font(.system(size: 17))
                                        .foregroundStyle(Color.black)
                                        .lineLimit(1)
                                    if let subtitle = row.subtitle {
                                        Text(subtitle)
                                            .font(.system(size: 12.5))
                                            .foregroundStyle(DuduStyle.muted)
                                            .lineLimit(2)
                                            .multilineTextAlignment(.leading)
                                    }
                                }
                                Spacer(minLength: 8)
                                if row.isSelected {
                                    DuduIcon(.check, size: 20)
                                        .foregroundStyle(DuduStyle.ink)
                                }
                            }
                            .padding(.horizontal, 20)
                            .frame(minHeight: 60)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(DuduQuietPressStyle())
                        .accessibilityLabel(row.title)
                        .accessibilityAddTraits(row.isSelected ? .isSelected : [])
                        .accessibilityIdentifier(identifierPrefix + row.id)
                    }
                }
                .background(ComposerAttachmentSheet.card, in: RoundedRectangle(cornerRadius: 27, style: .continuous))
                .padding(.horizontal, 16)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ComposerAttachmentSheet.background)
    }
}
