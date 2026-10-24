import Foundation

struct ConversationQuestion: Codable, Identifiable, Equatable, Sendable {
    struct Option: Codable, Hashable, Sendable {
        var label: String
        var description: String?
    }
    var id: String
    var question: String
    var header: String?
    var detail: String?
    var multiSelect: Bool
    var options: [Option]
}

struct ConversationQuestions: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var sessionId: String
    var state: String
    var questions: [ConversationQuestion]
}

struct ConversationAnswer: Codable, Equatable, Sendable {
    var id: String
    var selected: [String]
    var custom: String?
}

struct TurnNotice: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var kind: String
    var seq: Double
    var message: String
    var code: String?
    var time: Double?
    var retry: Int?
    var maximum: Int?
    var delayMs: Double?
    var state: String?
    var retryId: String? = nil
}

struct DeliveredFile: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var kind: String
    var seq: Double
    var callSeq: Double?
    var index: Int?
    var path: String
    var name: String
    var description: String?

    var parameters: [String: JSONValue] {
        var values: [String: JSONValue] = ["kind": .string(kind), "seq": .number(seq)]
        if let callSeq { values["callSeq"] = .number(callSeq) }
        if let index { values["index"] = .number(Double(index)) }
        return values
    }
}

struct ConversationTextPage: Codable, Equatable, Sendable {
    var text: String
    var offset: Int
    var total: Int
    var nextOffset: Int?
}

struct ConversationToolDetail: Codable, Sendable {
    var id: String
    var name: String
    var status: String
    var input: ConversationTextPage
    var output: ConversationTextPage
    var metadata: ConversationTextPage
    var images: [TranscriptAttachment]
}

struct ConversationChanges: Codable, Sendable {
    struct File: Codable, Equatable, Sendable {
        var path: String
        var display: String
        var added: Int
        var deleted: Int
        var binary: Bool?
        var oversized: Bool?
    }
    var turn: Int
    var files: [File]
    var total: Int
    var added: Int
    var deleted: Int
}

struct ConversationDiff: Codable, Sendable {
    struct Hunk: Codable, Sendable {
        var oldStart: Int
        var oldLines: Int
        var newStart: Int
        var newLines: Int
        var lines: [String]
    }
    var kind: String
    var path: String
    var display: String
    var before: Bool?
    var after: Bool?
    var coarse: Bool?
    var hunks: [Hunk]?
}

struct ConversationPerformance: Codable, Equatable, Sendable {
    var stats: [String: Double]
    var usage: [String: Double]
}

struct ConversationPage: Codable, Sendable {
    var transcript: Transcript
}

extension Transcript {
    func merging(_ newer: Transcript) -> Transcript {
        var combined = self
        let currentBoundary = newer.beforeSeq ?? newer.entries.compactMap(\.seq).min() ?? 0
        let prefix = entries.filter { ($0.seq ?? currentBoundary) < currentBoundary }
        combined.entries = prefix + newer.entries
        var references = tools ?? [:]
        for (id, next) in newer.tools ?? [:] {
            let old = references[id]
            references[id] = TranscriptToolReference(
                seq: next.seq ?? old?.seq,
                resultSeq: next.resultSeq ?? old?.resultSeq,
                status: next.status ?? old?.status
            )
        }
        combined.tools = tools == nil && newer.tools == nil ? nil : references
        combined.entries = combined.entries.map { entry in
            var updated = entry
            updated.calls = entry.calls?.map { call in
                var resolved = call
                let reference = references[call.id]
                resolved.seq = reference?.seq ?? call.seq
                resolved.resultSeq = reference?.resultSeq ?? call.resultSeq
                resolved.status = reference?.status ?? call.status
                return resolved
            }
            return updated
        }
        var turnMap = Dictionary(turns.map { ($0.turn, $0) }, uniquingKeysWith: { _, latest in latest })
        for next in newer.turns {
            if var old = turnMap[next.turn] {
                old.start = next.start ?? old.start
                old.end = next.end ?? old.end
                old.outcome = next.outcome ?? old.outcome
                old.lastSeq = [old.lastSeq, next.lastSeq].compactMap { $0 }.max()
                if old.files != nil || next.files != nil {
                    old.files = Self.mergeItems(old.files ?? [], next.files ?? [])
                }
                if old.notices != nil || next.notices != nil {
                    old.notices = Self.mergeItems(old.notices ?? [], next.notices ?? [])
                }
                old.changesSeq = next.changesSeq ?? old.changesSeq
                old.stats = next.stats ?? old.stats
                old.usage = next.usage ?? old.usage
                turnMap[next.turn] = old
            } else {
                turnMap[next.turn] = next
            }
        }
        combined.turns = turnMap.values.sorted { $0.turn < $1.turn }
        combined.live = newer.live
        combined.throughSeq = newer.throughSeq
        if (beforeSeq ?? currentBoundary) >= currentBoundary {
            combined.beforeSeq = newer.beforeSeq
            combined.hasMore = newer.hasMore
        }
        return combined
    }

    private static func mergeItems<Item: Identifiable>(_ older: [Item], _ newer: [Item]) -> [Item] where Item.ID: Hashable {
        var values = Dictionary(older.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
        for value in newer { values[value.id] = value }
        var seen = Set<Item.ID>()
        return (older + newer).compactMap { seen.insert($0.id).inserted ? values[$0.id] : nil }
    }
}
