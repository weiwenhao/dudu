import Foundation

struct ConversationProjection: Sendable {
    let transcript: Transcript?
    let rows: [TranscriptRow]
    let timeSeparators: [String: Double]
    let transcriptChanged: Bool
    let rowsChanged: Bool
}

actor ConversationProjector {
    private var previousTranscript: Transcript?
    private var previousRunning = false
    private var previousRows: [TranscriptRow] = []
    private var previousSeparators: [String: Double] = [:]

    func project(
        current: Transcript?, incoming: Transcript?, currentRows: [TranscriptRow],
        isRunning: Bool, prepending: Bool = false
    ) -> ConversationProjection {
        let combined: Transcript?
        if let current, let incoming {
            combined = prepending ? incoming.merging(current) : current.merging(incoming)
        } else {
            combined = incoming
        }
        if combined != previousTranscript || isRunning != previousRunning {
            if let combined, let previousTranscript,
               isRunning, previousRunning,
               combined.entries == previousTranscript.entries, combined.turns == previousTranscript.turns,
               let running = combined.turns.max(by: { $0.turn < $1.turn }), running.end == nil,
               let index = previousRows.firstIndex(where: {
                   if case let .turn(row) = $0 { return row.turn == running.turn }
                   return false
               }) {
                let tail = Transcript(
                    entries: combined.entries.filter { $0.turn == running.turn },
                    turns: [running], live: combined.live
                )
                if let row = TranscriptBuilder.rows(from: tail, isRunning: true).first(where: { $0.id == previousRows[index].id }) {
                    previousRows[index] = row
                } else {
                    previousRows = TranscriptBuilder.rows(from: combined, isRunning: isRunning)
                    previousSeparators = TranscriptTimeGrouping.separators(for: previousRows)
                }
            } else {
                previousRows = combined.map { TranscriptBuilder.rows(from: $0, isRunning: isRunning) } ?? []
                previousSeparators = TranscriptTimeGrouping.separators(for: previousRows)
            }
            previousTranscript = combined
            previousRunning = isRunning
        }
        return ConversationProjection(
            transcript: combined, rows: previousRows, timeSeparators: previousSeparators,
            transcriptChanged: combined != current, rowsChanged: previousRows != currentRows
        )
    }
}
