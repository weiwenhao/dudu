import Foundation

/// The approved B-1 title extract, matching the Desktop's conversation-identity.js.
enum ConversationIdentity {
    private static let latin = try! NSRegularExpression(pattern: "^[A-Za-z0-9]+")
    private static let han = try! NSRegularExpression(pattern: #"^[\p{Han}]{1,2}"#)

    static func initials(of value: String) -> String {
        let title = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(title.startIndex..<title.endIndex, in: title)
        if let match = latin.firstMatch(in: title, range: range),
           let bounds = Range(match.range, in: title) {
            let word = String(title[bounds])
            return (word.count <= 3 ? word : String(word.prefix(2))).uppercased()
        }
        if let match = han.firstMatch(in: title, range: range),
           let bounds = Range(match.range, in: title) {
            return String(title[bounds])
        }
        return String(String.UnicodeScalarView(title.unicodeScalars.prefix(2)))
    }
}
