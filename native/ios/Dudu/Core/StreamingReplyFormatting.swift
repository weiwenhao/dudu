import Foundation
import MarkdownUI

/// A reply still being written, as Markdown in two parts (`StreamingReplyText`): what is settled, every block before the last blank line, drawn as one Markdown and parsed again
/// only when a block is added to it; and the block still being written, parsed again as it grows. A blank line inside a code fence does not end a block.
struct StreamingReplyParts: Equatable, Sendable {
    var settled: String
    var tail: String
}

/// Both parts parsed, handed to the view together so that a block that moves from the tail to the settled part is never drawn twice or not at all.
struct StreamingReplyPrepared: @unchecked Sendable {
    var text: String
    var parts: StreamingReplyParts
    var settled: MarkdownContent?
    var tail: MarkdownContent?
}

actor StreamingReplyFormatting {
    static let shared = StreamingReplyFormatting()
    /// The settled part last parsed: it changes once a block, not once a character.
    private var lastSettled: (text: String, content: MarkdownContent)?

    /// Parsed here, off the main thread, and not in the messages' cache (each version of the tail is drawn once).
    func prepare(_ text: String) -> StreamingReplyPrepared {
        let parts = Self.parts(for: text)
        var settled: MarkdownContent?
        if !parts.settled.isEmpty {
            if let lastSettled, lastSettled.text == parts.settled {
                settled = lastSettled.content
            } else {
                let content = MarkdownContent(parts.settled)
                lastSettled = (parts.settled, content)
                settled = content
            }
        }
        return StreamingReplyPrepared(text: text, parts: parts, settled: settled, tail: parts.tail.isEmpty ? nil : MarkdownContent(parts.tail))
    }

    nonisolated static func parts(for text: String) -> StreamingReplyParts {
        var inFence = false
        var settledEnd: String.Index?
        var tailStart: String.Index?
        var lastWritten = text.startIndex
        var index = text.startIndex
        while index < text.endIndex {
            let lineEnd = text[index...].firstIndex(of: "\n") ?? text.endIndex
            let line = text[index..<lineEnd].trimmingCharacters(in: .whitespaces)
            let next = lineEnd < text.endIndex ? text.index(after: lineEnd) : text.endIndex
            if line.hasPrefix("```") || line.hasPrefix("~~~") { inFence.toggle() }
            if line.isEmpty {
                if !inFence && lastWritten > text.startIndex {
                    settledEnd = lastWritten
                    tailStart = next
                }
            } else {
                lastWritten = lineEnd
            }
            index = next
        }
        guard let settledEnd, let tailStart else { return StreamingReplyParts(settled: "", tail: text) }
        return StreamingReplyParts(settled: String(text[..<settledEnd]), tail: String(text[tailStart...]))
    }
}
