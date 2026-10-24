import SwiftUI

struct StreamingReplyText: View {
    let text: String
    @State private var paragraphs: [String] = []

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
        .task(id: text) {
            let prepared = await StreamingReplyFormatting.shared.paragraphs(for: text)
            guard !Task.isCancelled else { return }
            if paragraphs != prepared { paragraphs = prepared }
        }
    }
}

private struct StreamingReplyParagraph: View, Equatable {
    let text: String

    var body: some View {
        Text(text.isEmpty ? "\u{200B}" : text)
            .font(.system(size: 16))
            .foregroundStyle(DSBotStyle.chatInk)
            .textSelection(.disabled)
            .fixedSize(horizontal: false, vertical: true)
    }
}
