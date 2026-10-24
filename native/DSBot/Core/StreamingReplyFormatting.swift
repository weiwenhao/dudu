import Foundation

actor StreamingReplyFormatting {
    static let shared = StreamingReplyFormatting()

    func paragraphs(for text: String) -> [String] {
        let paragraphs = text.components(separatedBy: "\n\n")
        return paragraphs.enumerated().map { index, paragraph in
            index < paragraphs.count - 1 ? paragraph + "\n" : paragraph
        }
    }
}
