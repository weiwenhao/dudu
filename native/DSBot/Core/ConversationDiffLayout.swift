import Foundation
import UIKit

struct ConversationDiffLayout: Sendable {
    struct Row: Identifiable, Sendable {
        let id: String
        let text: String
        let line: ConversationDiff.Hunk.Line?
    }

    let rows: [Row]
    let width: CGFloat
    let lineNumberWidth: CGFloat
    let lineHeight: CGFloat

    init(_ diff: ConversationDiff) {
        let font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        let hunks = diff.hunks ?? []
        let largest = hunks.map { max($0.oldStart + $0.oldLines, $0.newStart + $0.newLines) }.max() ?? 0
        lineNumberWidth = max(24, ceil((String(largest) as NSString).size(withAttributes: attributes).width) + 6)
        lineHeight = ceil(font.lineHeight)
        var rows: [Row] = []
        var width: CGFloat = 0
        for (hunkIndex, hunk) in hunks.enumerated() {
            let title = "@@ −\(hunk.oldStart),\(hunk.oldLines) +\(hunk.newStart),\(hunk.newLines) @@"
            rows.append(Row(id: "hunk.\(hunkIndex)", text: title, line: nil))
            width = max(width, (title as NSString).size(withAttributes: attributes).width)
            for line in hunk.numberedLines {
                rows.append(Row(id: "line.\(hunkIndex).\(line.id)", text: line.text, line: line))
                width = max(width, lineNumberWidth * 2 + 16 + (line.text as NSString).size(withAttributes: attributes).width)
            }
        }
        self.rows = rows
        self.width = ceil(width)
    }
}
