import Foundation

actor StreamingReplyFormatting {
    static let shared = StreamingReplyFormatting()

    /// The paragraphs of the streamed text, split at a blank line: the gap between two is the stack's spacing (`ChatTypography.blockGap`, the Markdown's own), not an empty line.
    func paragraphs(for text: String) -> [String] {
        text.components(separatedBy: "\n\n")
    }
}
