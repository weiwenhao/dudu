import Foundation
import UIKit

struct ConversationDiffLayout: Sendable {
    struct Row: Identifiable, Sendable {
        let id: String
        let text: String
        let line: ConversationDiff.Hunk.Line?
    }

    let rows: [Row]
    let lineNumberWidth: CGFloat

    init(_ diff: ConversationDiff) {
        let font = UIFont.monospacedSystemFont(ofSize: 12, weight: .regular)
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        let hunks = diff.hunks ?? []
        let largest = hunks.map { max($0.oldStart + $0.oldLines, $0.newStart + $0.newLines) }.max() ?? 0
        lineNumberWidth = max(24, ceil((String(largest) as NSString).size(withAttributes: attributes).width) + 6)
        var rows: [Row] = []
        for (hunkIndex, hunk) in hunks.enumerated() {
            let title = "@@ −\(hunk.oldStart),\(hunk.oldLines) +\(hunk.newStart),\(hunk.newLines) @@"
            rows.append(Row(id: "hunk.\(hunkIndex)", text: title, line: nil))
            for line in hunk.numberedLines {
                rows.append(Row(id: "line.\(hunkIndex).\(line.id)", text: line.text, line: line))
            }
        }
        self.rows = rows
    }
}
