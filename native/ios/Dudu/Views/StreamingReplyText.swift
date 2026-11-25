import MarkdownUI
import SwiftUI

/// A reply still being written, drawn as Markdown as the Android app draws it (owner, 2026-11-23: 「能不能做成跟安卓一样，一直用 markdown 来显示？」). Drawing all of a growing reply again
/// for each character would reshape it on the main thread, so it is two Markdown views (`StreamingReplyFormatting`): the settled blocks, drawn again only when a block is added
/// to them, and the block being written. Both are parsed together off the main thread; until the first parse the text shows plain, and after it the last version drawn stays
/// until the next is ready.
struct StreamingReplyText: View {
    let text: String
    var id: String = ""
    var sourceSequence: Double?
    @State private var prepared: StreamingReplyPrepared?

    var body: some View {
        Group {
            if let prepared {
                VStack(alignment: .leading, spacing: ChatTypography.blockGap) {
                    if let settled = prepared.settled {
                        SettledReply(text: prepared.parts.settled, content: settled, sourceSequence: sourceSequence).equatable()
                    }
                    if let tail = prepared.tail {
                        MessageMarkdown(text: prepared.parts.tail, allowsTextSelection: false, sourceSequence: sourceSequence, content: tail)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                StreamingReplyParagraph(text: text)
            }
        }
        .preference(key: RenderedLiveReplies.self, value: [id: prepared?.text ?? text])
        .task(id: text) {
            let next = await StreamingReplyFormatting.shared.prepare(text)
            guard !Task.isCancelled else { return }
            prepared = next
        }
    }
}

private struct SettledReply: View, Equatable {
    let text: String
    let content: MarkdownContent
    let sourceSequence: Double?

    static func == (lhs: SettledReply, rhs: SettledReply) -> Bool {
        lhs.text == rhs.text && lhs.sourceSequence == rhs.sourceSequence
    }

    var body: some View {
        MessageMarkdown(text: text, allowsTextSelection: false, sourceSequence: sourceSequence, content: content)
    }
}

struct RenderedLiveReplies: PreferenceKey {
    static let defaultValue: [String: String] = [:]
    static func reduce(value: inout [String: String], nextValue: () -> [String: String]) {
        value.merge(nextValue(), uniquingKeysWith: { _, next in next })
    }
}

/// A reply's text before its first parse: plain, in the reply's own type.
private struct StreamingReplyParagraph: View {
    let text: String

    var body: some View {
        Text(text.isEmpty ? "\u{200B}" : text)
            .font(.system(size: ChatTypography.size))
            .tracking(ChatTypography.tracking)
            .lineSpacing(ChatTypography.lineSpacing)
            .foregroundStyle(DuduStyle.chatInk)
            .textSelection(.disabled)
            .fixedSize(horizontal: false, vertical: true)
    }
}
