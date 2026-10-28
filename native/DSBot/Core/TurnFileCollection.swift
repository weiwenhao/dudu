import Foundation

struct TurnFileCollection {
    static let previewLimit = 3
    let presented: [DeliveredFile]

    init(_ files: [DeliveredFile]) {
        presented = Self.unique(files.filter { $0.kind == "presented" })
    }

    static func matching(_ files: [DeliveredFile], query: String) -> [DeliveredFile] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return query.isEmpty ? files : files.filter {
            $0.name.localizedStandardContains(query) || $0.path.localizedStandardContains(query)
        }
    }

    static func matchingChanges(_ files: [ConversationChanges.File], query: String) -> [Int] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        // Diff requests address the recorded array, never the filtered list.
        return files.indices.filter {
            query.isEmpty || files[$0].display.localizedStandardContains(query)
                || files[$0].path.localizedStandardContains(query)
        }
    }

    static func displayNames(_ files: [DeliveredFile]) -> [String: String] {
        let names = Dictionary(grouping: files, by: \.name)
        return Dictionary(uniqueKeysWithValues: files.map { file in
            let title = (names[file.name]?.count ?? 0) > 1 ? file.path : file.name
            return (file.id, title)
        })
    }

    private static func unique(_ files: [DeliveredFile]) -> [DeliveredFile] {
        var result: [DeliveredFile] = []
        var positions: [String: Int] = [:]
        for file in files {
            if let index = positions[file.path] {
                if file.seq >= result[index].seq { result[index] = file }
            } else {
                positions[file.path] = result.count
                result.append(file)
            }
        }
        return result
    }
}
