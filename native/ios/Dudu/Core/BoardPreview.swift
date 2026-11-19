import Foundation
import MarkdownUI

/// The homepage keeps one plain line, never Markdown source or image file paths.
enum BoardMessagePreview {
    private static let images = try! NSRegularExpression(
        pattern: #"!\[(?:\\.|[^\]\\])*\](?:\((?:\\.|[^()\\]|\([^)]*\))*(?:\)|$)|\[[^\]]*\])?"#
    )
    private static let htmlImages = try! NSRegularExpression(pattern: #"(?i)<img\b[^>]*(?:>|$)"#)

    static func text(_ source: String) -> String {
        let placeholder = "［\(L10n.text("图片"))］"
        var value = source
        for expression in [images, htmlImages] {
            value = expression.stringByReplacingMatches(
                in: value, range: NSRange(value.startIndex..., in: value),
                withTemplate: NSRegularExpression.escapedTemplate(for: placeholder)
            )
        }
        return GroupChat.plain(MarkdownContent(value).renderPlainText())
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}

/// Both network answers and retained snapshots are prepared away from the UI thread.
actor BoardPreviewPreparation {
    private var cached: [String: String] = [:]

    func prepare(_ rows: [BoardConversation]) -> [BoardConversation] {
        rows.map { row in
            var row = row
            let raw = row.preview
            if let value = cached[raw] {
                row.preview = value
            } else {
                let value = BoardMessagePreview.text(raw)
                if cached.count >= 512 { cached.removeAll(keepingCapacity: true) }
                cached[raw] = value
                row.preview = value
            }
            return row
        }
    }
}
