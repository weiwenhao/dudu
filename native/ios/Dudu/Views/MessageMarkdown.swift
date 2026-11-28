import MarkdownUI
import SwiftUI

/// The body text of a reply, set to Codex's (owner, 2026-11-21: 「参考 Codex 调整吧」, after three screenshots were measured: `.local/designs/font-compare-2026-11-21/`): 17pt with the
/// system body's -0.41pt tracking (16.6pt from one character to the next), 23.9pt from line to line and 40.2pt from the last line of a paragraph to the first of the next. The line spacing and the
/// gaps are what is added to PingFang's own line height (about 20.0pt at 17pt: measured 23.3pt a line with .195 em added, 23.9pt wanted). The streaming text (`StreamingReplyText`) and the Markdown share these, so a reply does not jump when it is recorded.
enum ChatTypography {
    static let size: CGFloat = 17
    static let tracking: CGFloat = -0.41
    static let lineSpacingEm: CGFloat = 0.23
    static var lineSpacing: CGFloat { size * lineSpacingEm }
    /// Between a paragraph (or a code block, a quote, a table) and what follows.
    static let blockGap: CGFloat = 19.5
    /// Between the items of a list.
    static let listItemGap: CGFloat = 3.5
    /// A heading is as big as the text (Codex's "第二步：…" lines), semibold, 28pt after the paragraph before it and 12pt before what follows (48.1pt and 32.3pt from line to line).
    static let headingEm: CGFloat = 1.0
    static let headingTop: CGFloat = 28
    static let headingBottom: CGFloat = 12
}

struct MessageMarkdown: View {
    let text: String
    /// Smaller, quieter text for secondary content such as a compaction summary.
    var compact = false
    /// The approved full-width text in a quick-sheet todo, unchanged when clipped or expanded.
    var todo = false
    var allowsTextSelection = true
    var sourceSequence: Double?
    var waitsForSourceSequence = false
    /// Already parsed (a reply still being written, `StreamingReplyText`, which parses its parts together off the main thread and without the shared cache, so that a new
    /// character neither waits for its own parse nor pushes the history's texts out of the cache's 48).
    var content: MarkdownContent?
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
            guard self.content == nil, prepared.content(for: text) == nil else { return }
            let content = await MessageMarkdownCache.shared.content(for: text)
            guard !Task.isCancelled else { return }
            parsed = (text, content)
        }
    }

    private var renderedContent: some View {
        Group {
            if let parsed = content ?? prepared.content(for: text) ?? MessageMarkdownCache.cachedContent(for: text) ??
                (parsed?.text == text ? parsed?.content : nil) {
                Markdown(parsed)
                    .markdownTheme(todo ? .duduTodo : compact ? .duduCompact : .duduChat)
                    .markdownImageProvider(MessageImageProvider(sequence: sourceSequence, waitsForSourceSequence: waitsForSourceSequence))
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
    static let duduTodo = Theme.dudu
        .text {
            FontSize(15)
            ForegroundColor(DuduStyle.ink)
        }
        .paragraph { configuration in
            configuration.label
                .fixedSize(horizontal: false, vertical: true)
                .relativeLineSpacing(.em(0.4))
                .markdownMargin(top: 0, bottom: 12)
        }

    /// The message theme at secondary-text size, used for a compaction summary.
    static let duduCompact = Theme.dudu
        .text {
            FontSize(14)
            ForegroundColor(DuduStyle.chatSecondary)
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

    /// The text as the quick sheets and the compact surfaces draw it (16pt, as approved); the reply text is `duduChat`.
    static let dudu = styled(size: 16, tracking: nil, lineSpacingEm: 0.25, blockGap: 14, listItemGap: 5, heading: nil)

    /// The reply text: Codex's numbers (`ChatTypography`).
    static let duduChat = styled(size: ChatTypography.size, tracking: ChatTypography.tracking, lineSpacingEm: ChatTypography.lineSpacingEm,
                                 blockGap: ChatTypography.blockGap, listItemGap: ChatTypography.listItemGap,
                                 heading: (em: ChatTypography.headingEm, top: ChatTypography.headingTop, bottom: ChatTypography.headingBottom))

    /// `heading`: the third level's size and the margins of every level; nil keeps the quick sheets' own (1.1 em; 18 / 16 / 14 above, 10 / 10 / 8 below).
    static func styled(size: CGFloat, tracking: CGFloat?, lineSpacingEm: CGFloat, blockGap: CGFloat, listItemGap: CGFloat,
                       heading: (em: CGFloat, top: CGFloat, bottom: CGFloat)?) -> Theme {
        Theme.basic
            .text {
                FontSize(size)
                ForegroundColor(DuduStyle.ink)
                TextTracking(tracking)
            }
            .link { ForegroundColor(DuduStyle.blue) }
            .strong { FontWeight(.semibold) }
            .code {
                FontFamilyVariant(.monospaced)
                FontSize(.em(0.88))
                BackgroundColor(DuduStyle.sheet)
            }
            .paragraph { configuration in
                configuration.label
                    .fixedSize(horizontal: false, vertical: true)
                    .relativeLineSpacing(.em(lineSpacingEm))
                    .markdownMargin(top: 0, bottom: blockGap)
            }
            .heading1 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontSize(.em(1.4))
                        FontWeight(.semibold)
                    }
                    .markdownMargin(top: heading?.top ?? 18, bottom: heading?.bottom ?? 10)
            }
            .heading2 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontSize(.em(1.25))
                        FontWeight(.semibold)
                    }
                    .markdownMargin(top: heading?.top ?? 16, bottom: heading?.bottom ?? 10)
            }
            .heading3 { configuration in
                configuration.label
                    .markdownTextStyle {
                        FontSize(.em(heading?.em ?? 1.1))
                        FontWeight(.semibold)
                    }
                    .markdownMargin(top: heading?.top ?? 14, bottom: heading?.bottom ?? 8)
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
                .background(DuduStyle.sheet, in: RoundedRectangle(cornerRadius: 12))
                .markdownMargin(top: 4, bottom: blockGap)
            }
            .blockquote { configuration in
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(DuduStyle.line)
                        .frame(width: 3)
                    configuration.label
                        .markdownTextStyle { ForegroundColor(DuduStyle.muted) }
                }
                .fixedSize(horizontal: false, vertical: true)
                .markdownMargin(top: 4, bottom: blockGap)
            }
            .listItem { configuration in
                configuration.label.markdownMargin(top: listItemGap)
            }
            .table { configuration in
                ScrollView(.horizontal, showsIndicators: false) {
                    configuration.label
                        .fixedSize(horizontal: true, vertical: false)
                        .markdownTableBorderStyle(.init(color: DuduStyle.line))
                        .markdownTableBackgroundStyle(.alternatingRows(.white, DuduStyle.sheet))
                }
                .markdownMargin(top: 4, bottom: blockGap)
            }
    }
}

// Both image providers use the watched conversation's authenticated attachment transport.
private struct MessageImageProvider: ImageProvider {
    let sequence: Double?
    let waitsForSourceSequence: Bool

    func makeImage(url: URL?) -> some View {
        MessageImage(url: url, sequence: sequence, waitsForSourceSequence: waitsForSourceSequence)
    }
}

private struct MessageImage: View {
    let url: URL?
    let sequence: Double?
    let waitsForSourceSequence: Bool
    @Environment(\.conversationAccess) private var access

    var body: some View {
        if let url, let access, sequence != nil || waitsForSourceSequence {
            ConversationImageThumbnail(
                attachment: TranscriptAttachment(kind: "markdown", name: L10n.text("图片"), id: url.absoluteString, seq: sequence),
                target: access.target, canLoadAttachment: access.connected,
                identifier: sequence.map { "chat.markdown.image.\(Int($0))" } ?? "chat.markdown.image", loadImage: access.loadImage,
                alignment: .leading
            )
        } else {
            DuduLabel(L10n.text("图片"), icon: .camera)
                .font(.system(size: 13))
                .foregroundStyle(DuduStyle.muted)
                .padding(12)
                .background(DuduStyle.sheet, in: RoundedRectangle(cornerRadius: 10))
        }
    }
}

private struct MessageInlineImageProvider: InlineImageProvider {
    let sequence: Double?
    let access: ConversationAccess?

    func image(with url: URL, label: String) async throws -> Image {
        guard let sequence, let access else { throw DuduFailure.remote("NOT_FOUND") }
        let attachment = TranscriptAttachment(kind: "markdown", name: label, id: url.absoluteString, seq: sequence)
        guard let image = await access.loadImage(attachment, access.target, false) else {
            throw DuduFailure.remote("NOT_FOUND")
        }
        return Image(uiImage: image.image)
    }
}
