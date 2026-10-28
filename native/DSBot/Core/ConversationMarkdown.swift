import MarkdownUI
import SwiftUI

final class ConversationMarkdown: @unchecked Sendable {
    static let empty = ConversationMarkdown()

    let texts: Set<String>
    private let contents: [String: MarkdownContent]

    private init() {
        texts = []
        contents = [:]
    }

    init(texts: Set<String>, reusing previous: ConversationMarkdown) {
        self.texts = texts
        contents = Dictionary(uniqueKeysWithValues: texts.map { text in
            (text, previous.content(for: text) ?? MarkdownContent(text))
        })
    }

    func content(for text: String) -> MarkdownContent? {
        contents[text]
    }

    static func texts(in rows: [TranscriptRow]) -> Set<String> {
        Set(rows.flatMap { row -> [String] in
            switch row {
            case let .turn(turn):
                return (turn.answer.map { [$0] } ?? []) + turn.segments.compactMap {
                    if case let .reply(id, text) = $0, !id.hasPrefix("live:") { return text }
                    return nil
                }
            case let .command(command): return command.detail.map { [$0] } ?? []
            default: return []
            }
        })
    }
}

private struct ConversationMarkdownKey: EnvironmentKey {
    static let defaultValue = ConversationMarkdown.empty
}

extension EnvironmentValues {
    var conversationMarkdown: ConversationMarkdown {
        get { self[ConversationMarkdownKey.self] }
        set { self[ConversationMarkdownKey.self] = newValue }
    }
}
