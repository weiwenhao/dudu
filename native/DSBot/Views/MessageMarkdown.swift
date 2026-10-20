import MarkdownUI
import SwiftUI

struct MessageMarkdown: View {
    let text: String
    /// Smaller, quieter text for secondary content such as a compaction summary.
    var compact = false
    @State private var parsed: MarkdownContent?
    @State private var parsedText: String?

    var body: some View {
        Group {
            if let parsed, parsedText == text {
                Markdown(parsed)
                    .markdownTheme(compact ? .dsbotCompact : .dsbot)
                    .markdownImageProvider(MessageImagePlaceholder())
                    .markdownInlineImageProvider(MessageInlineImagePlaceholder())
            } else {
                Text(text)
                    .font(.system(size: compact ? 14 : 16))
                    .foregroundStyle(compact ? DSBotStyle.chatSecondary : DSBotStyle.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .textSelection(.enabled)
        .task(id: text) {
            let content = await MessageMarkdownCache.shared.content(for: text)
            guard !Task.isCancelled else { return }
            parsed = content
            parsedText = text
        }
    }
}

// Parse once off the UI thread, with a bounded cache for revisiting conversations.
private actor MessageMarkdownCache {
    static let shared = MessageMarkdownCache()
    private var values: [String: MarkdownContent] = [:]
    private var recent: [String] = []
    private var byteCount = 0

    func content(for text: String) -> MarkdownContent {
        if let content = values[text] {
            recent.removeAll { $0 == text }
            recent.append(text)
            return content
        }
        let content = MarkdownContent(text)
        let size = text.utf8.count
        guard size <= 512_000 else { return content }
        while recent.count >= 48 || byteCount + size > 2_000_000 {
            guard !recent.isEmpty else { break }
            let removed = recent.removeFirst()
            values[removed] = nil
            byteCount -= removed.utf8.count
        }
        values[text] = content
        recent.append(text)
        byteCount += size
        return content
    }
}

private extension Theme {
    /// The message theme at secondary-text size, used for a compaction summary.
    static let dsbotCompact = Theme.dsbot
        .text {
            FontSize(14)
            ForegroundColor(DSBotStyle.chatSecondary)
        }
        .paragraph { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .relativeLineSpacing(.em(0.22))
                .markdownMargin(top: 0, bottom: 8)
        }
        .heading1 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontSize(.em(1.2))
                    FontWeight(.semibold)
                }
                .markdownMargin(top: 10, bottom: 6)
        }
        .heading2 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontSize(.em(1.12))
                    FontWeight(.semibold)
                }
                .markdownMargin(top: 10, bottom: 6)
        }
        .heading3 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontSize(.em(1.05))
                    FontWeight(.semibold)
                }
                .markdownMargin(top: 8, bottom: 4)
        }

    static let dsbot = Theme.basic
        .text {
            FontSize(16)
            ForegroundColor(DSBotStyle.ink)
        }
        .link { ForegroundColor(DSBotStyle.blue) }
        .strong { FontWeight(.semibold) }
        .code {
            FontFamilyVariant(.monospaced)
            FontSize(.em(0.88))
            BackgroundColor(DSBotStyle.sheet)
        }
        .paragraph { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .relativeLineSpacing(.em(0.25))
                .markdownMargin(top: 0, bottom: 14)
        }
        .heading1 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontSize(.em(1.4))
                    FontWeight(.semibold)
                }
                .markdownMargin(top: 18, bottom: 10)
        }
        .heading2 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontSize(.em(1.25))
                    FontWeight(.semibold)
                }
                .markdownMargin(top: 16, bottom: 10)
        }
        .heading3 { configuration in
            configuration.label
                .markdownTextStyle {
                    FontSize(.em(1.1))
                    FontWeight(.semibold)
                }
                .markdownMargin(top: 14, bottom: 8)
        }
        .codeBlock { configuration in
            ScrollView(.horizontal, showsIndicators: false) {
                configuration.label
                    .markdownTextStyle {
                        FontFamilyVariant(.monospaced)
                        FontSize(13)
                    }
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(12)
            }
            .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 12))
            .markdownMargin(top: 4, bottom: 14)
        }
        .blockquote { configuration in
            HStack(spacing: 12) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(DSBotStyle.line)
                    .frame(width: 3)
                configuration.label
                    .markdownTextStyle { ForegroundColor(DSBotStyle.muted) }
            }
            .fixedSize(horizontal: false, vertical: true)
            .markdownMargin(top: 4, bottom: 14)
        }
        .listItem { configuration in
            configuration.label.markdownMargin(top: 5)
        }
        .table { configuration in
            ScrollView(.horizontal, showsIndicators: false) {
                configuration.label
                    .fixedSize(horizontal: true, vertical: false)
                    .markdownTableBorderStyle(.init(color: DSBotStyle.line))
                    .markdownTableBackgroundStyle(.alternatingRows(.white, DSBotStyle.sheet))
            }
            .markdownMargin(top: 4, bottom: 14)
        }
}

// Message markup must not silently create a second network transport.
private struct MessageImagePlaceholder: ImageProvider {
    func makeImage(url: URL?) -> some View {
        DSBotLabel("图片", icon: .camera)
            .font(.system(size: 13))
            .foregroundStyle(DSBotStyle.muted)
            .padding(12)
            .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 10))
    }
}

private struct MessageInlineImagePlaceholder: InlineImageProvider {
    func image(with url: URL, label: String) async throws -> Image {
        Image(uiImage: UIImage())
    }
}
