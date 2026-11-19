import SwiftUI

struct StreamingReplyText: View {
    let text: String
    var id: String = ""
    @State private var paragraphs: [String] = []
    @State private var preparedText: String?

    var body: some View {
        Group {
            if paragraphs.isEmpty {
                StreamingReplyParagraph(text: text)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(paragraphs.enumerated()), id: \.offset) { _, paragraph in
                        StreamingReplyParagraph(text: paragraph)
                            .equatable()
                    }
                }
            }
        }
        .preference(key: RenderedLiveReplies.self, value: [id: preparedText ?? text])
        .task(id: text) {
            let prepared = await StreamingReplyFormatting.shared.paragraphs(for: text)
            guard !Task.isCancelled else { return }
            if paragraphs != prepared { paragraphs = prepared }
            preparedText = text
        }
    }
}

struct RenderedLiveReplies: PreferenceKey {
    static let defaultValue: [String: String] = [:]
    static func reduce(value: inout [String: String], nextValue: () -> [String: String]) {
        value.merge(nextValue(), uniquingKeysWith: { _, next in next })
    }
}

private struct StreamingReplyParagraph: View, Equatable {
    let text: String

    var body: some View {
        Text(text.isEmpty ? "\u{200B}" : text)
            .font(.system(size: 16))
            .foregroundStyle(DuduStyle.chatInk)
            .textSelection(.disabled)
            .fixedSize(horizontal: false, vertical: true)
    }
}
