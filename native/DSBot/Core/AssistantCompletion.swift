import Foundation

struct AssistantSkill: Decodable, Equatable, Sendable {
    var name: String
    var description: String
}

struct ComposerEditingState: Equatable {
    var text: String
    var selection: NSRange
    var isComposing = false
}

struct ComposerSelection: Equatable {
    let id = UUID()
    let range: NSRange
}

enum AssistantCompletion {
    enum Kind: Equatable { case issue, skill }
    struct Query: Equatable {
        var kind: Kind
        var text: String
        var range: NSRange
    }
    struct Address: Equatable {
        var id: String
        var body: String
    }

    /// Cursor coordinates are UTF-16, exactly like UITextView. Marked Chinese input is left alone.
    static func query(_ edit: ComposerEditingState) -> Query? {
        let source = edit.text as NSString
        guard !edit.isComposing, edit.selection.length == 0,
              edit.selection.location >= 0, edit.selection.location <= source.length else { return nil }
        let prefix = source.substring(to: edit.selection.location)
        for (kind, pattern) in [(Kind.issue, #"^\s*@([^\s@]*)$"#), (.skill, #"(?:^|\s)/([A-Za-z0-9_-]*)$"#)] {
            guard let expression = try? NSRegularExpression(pattern: pattern),
                  let match = expression.firstMatch(in: prefix, range: NSRange(location: 0, length: (prefix as NSString).length)) else { continue }
            let word = match.range(at: 1)
            return Query(kind: kind, text: (prefix as NSString).substring(with: word),
                         range: NSRange(location: word.location - 1, length: word.length + 1))
        }
        return nil
    }

    static func address(_ text: String) -> Address? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let expression = try? NSRegularExpression(pattern: #"^@(#?[1-9]\d{0,14}|[A-Za-z]{1,3}-[1-9]\d{0,14})(?=\s|$)"#),
              let match = expression.firstMatch(in: value, range: NSRange(location: 0, length: (value as NSString).length)) else { return nil }
        let source = value as NSString
        return Address(id: source.substring(with: match.range(at: 1)),
                       body: source.substring(from: NSMaxRange(match.range)).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    static func insert(_ token: String, query: Query, in text: String) -> (String, NSRange)? {
        let source = text as NSString
        guard query.range.location >= 0, NSMaxRange(query.range) <= source.length else { return nil }
        let suffix = source.substring(from: NSMaxRange(query.range))
        let insertion = token + (suffix.first?.isWhitespace == true ? "" : " ")
        return (source.replacingCharacters(in: query.range, with: insertion),
                NSRange(location: query.range.location + (insertion as NSString).length, length: 0))
    }

    static func rank(_ skills: [AssistantSkill], query: String) -> [AssistantSkill] {
        let wanted = Array(query.lowercased())
        return skills.filter { skill in
            var offset = 0
            for character in skill.name.lowercased() where offset < wanted.count {
                if character == wanted[offset] { offset += 1 }
            }
            return offset == wanted.count
        }.enumerated().sorted {
            let left = $0.element.name.lowercased().hasPrefix(query.lowercased())
            let right = $1.element.name.lowercased().hasPrefix(query.lowercased())
            return left == right ? $0.offset < $1.offset : left
        }.map(\.element)
    }

    static func highlights(_ text: String, skills: [AssistantSkill]) -> [NSRange] {
        let source = text as NSString
        var ranges: [NSRange] = []
        if let expression = try? NSRegularExpression(pattern: #"^\s*(@(?:#?[1-9]\d{0,14}|[A-Za-z]{1,3}-[1-9]\d{0,14}))(?=\s|$)"#),
           let match = expression.firstMatch(in: text, range: NSRange(location: 0, length: source.length)) {
            ranges.append(match.range(at: 1))
        }
        let names = Set(skills.map(\.name))
        if let expression = try? NSRegularExpression(pattern: #"(?:^|\s)(/([A-Za-z0-9_-]+))(?=\s|$)"#) {
            for match in expression.matches(in: text, range: NSRange(location: 0, length: source.length))
                where names.contains(source.substring(with: match.range(at: 2))) {
                ranges.append(match.range(at: 1))
            }
        }
        return ranges
    }
}

