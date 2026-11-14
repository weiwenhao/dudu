import MarkdownUI
import SwiftUI

struct MessageMarkdown: View {
    let text: String
    /// Smaller, quieter text for secondary content such as a compaction summary.
    var compact = false
    /// The approved full-width text in a quick-sheet todo, unchanged when clipped or expanded.
    var todo = false
    var allowsTextSelection = true
    var sourceSequence: Double?
    @Environment(\.conversationMarkdown) private var prepared
    @Environment(\.conversationAccess) private var access
    @State private var parsed: (text: String, content: MarkdownContent)?

    var body: some View {
        Group {
            if allowsTextSelection {
                renderedContent.textSelection(.enabled)
            } else {
                renderedContent.textSelection(.disabled)
            }
        }
        .task(id: text) {
            guard prepared.content(for: text) == nil else { return }
            let content = await MessageMarkdownCache.shared.content(for: text)
            guard !Task.isCancelled else { return }
            parsed = (text, content)
        }
    }

    private var renderedContent: some View {
        Group {
            if let parsed = prepared.content(for: text) ?? MessageMarkdownCache.cachedContent(for: text) ??
                (parsed?.text == text ? parsed?.content : nil) {
                Markdown(parsed)
                    .markdownTheme(todo ? .dsbotTodo : compact ? .dsbotCompact : .dsbot)
                    .markdownImageProvider(MessageImageProvider(sequence: sourceSequence))
                    .markdownInlineImageProvider(MessageInlineImageProvider(sequence: sourceSequence, access: access))
            } else {
                ProgressView()
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// Parse once off the UI thread, with a bounded cache for revisiting conversations.
private actor MessageMarkdownCache {
    static let shared = MessageMarkdownCache()
    private nonisolated static let memory = MessageMarkdownMemory()

    nonisolated static func cachedContent(for text: String) -> MarkdownContent? {
        memory.content(for: text)
    }

    func content(for text: String) -> MarkdownContent {
        if let content = Self.memory.content(for: text) { return content }
        let content = MarkdownContent(text)
        Self.memory.insert(content, for: text)
        return content
    }
}

private final class MessageMarkdownMemory: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [String: MarkdownContent] = [:]
    private var recent: [String] = []
    private var byteCount = 0

    func content(for text: String) -> MarkdownContent? {
        lock.lock()
        defer { lock.unlock() }
        if let content = values[text] {
            recent.removeAll { $0 == text }
            recent.append(text)
            return content
        }
        return nil
    }

    func insert(_ content: MarkdownContent, for text: String) {
        let size = text.utf8.count
        guard size <= 512_000 else { return }
        lock.lock()
        defer { lock.unlock() }
        guard values[text] == nil else { return }
        while recent.count >= 48 || byteCount + size > 2_000_000 {
            guard !recent.isEmpty else { break }
            let removed = recent.removeFirst()
            values[removed] = nil
            byteCount -= removed.utf8.count
        }
        values[text] = content
        recent.append(text)
        byteCount += size
    }
}

private extension Theme {
    static let dsbotTodo = Theme.dsbot
        .text {
            FontSize(15)
            ForegroundColor(DSBotStyle.ink)
        }
        .paragraph { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .relativeLineSpacing(.em(0.4))
                .markdownMargin(top: 0, bottom: 12)
        }

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

// Both image providers use the watched conversation's authenticated attachment transport.
private struct MessageImageProvider: ImageProvider {
    let sequence: Double?

    func makeImage(url: URL?) -> some View {
        MessageImage(url: url, sequence: sequence)
    }
}

private struct MessageImage: View {
    let url: URL?
    let sequence: Double?
    @Environment(\.conversationAccess) private var access

    var body: some View {
        if let url, let sequence, let access {
            ConversationImageThumbnail(
                attachment: TranscriptAttachment(kind: "markdown", name: L10n.text("图片"), id: url.absoluteString, seq: sequence),
                target: access.target, canLoadAttachment: access.connected,
                identifier: "chat.markdown.image.\(Int(sequence))", loadImage: access.loadImage,
                alignment: .leading
            )
        } else {
            DSBotLabel(L10n.text("图片"), icon: .camera)
                .font(.system(size: 13))
                .foregroundStyle(DSBotStyle.muted)
                .padding(12)
                .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

private struct MessageInlineImageProvider: InlineImageProvider {
    let sequence: Double?
    let access: ConversationAccess?

    func image(with url: URL, label: String) async throws -> Image {
        guard let sequence, let access else { throw DSBotFailure.remote("NOT_FOUND") }
        let attachment = TranscriptAttachment(kind: "markdown", name: label, id: url.absoluteString, seq: sequence)
        guard let image = await access.loadImage(attachment, access.target, false) else {
            throw DSBotFailure.remote("NOT_FOUND")
        }
        return Image(uiImage: image.image)
    }
}
