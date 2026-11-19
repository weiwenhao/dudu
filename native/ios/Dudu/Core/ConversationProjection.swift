import Foundation

struct ConversationProjection: Sendable {
    let transcript: Transcript?
    let rows: [TranscriptRow]
    let markdown: ConversationMarkdown
    let timeSeparators: [String: Double]
    let transcriptChanged: Bool
    let rowsChanged: Bool
}

actor ConversationProjector {
    private var previousTranscript: Transcript?
    private var previousRunning = false
    private var previousHidden = Set<Double>()
    private var previousRows: [TranscriptRow] = []
    private var previousSeparators: [String: Double] = [:]
    private var previousMarkdown = ConversationMarkdown.empty

    func project(
        current: Transcript?, incoming: Transcript?, currentRows: [TranscriptRow],
        isRunning: Bool, prepending: Bool = false, messages: [ChatMessage] = [],
        additionalMarkdown: [String] = [], hidden: Set<Double> = []
    ) -> ConversationProjection {
        let combined: Transcript?
        if let current, let incoming {
            combined = prepending ? incoming.merging(current) : current.merging(incoming)
        } else {
            combined = incoming
        }
        // The lines of 嘟嘟's thread that the owner hid are only left out of what is shown: the transcript keeps them.
        let hiding = hidden.union(combined?.hidden ?? [])
        let shown: Transcript? = {
            guard var visible = combined, !hiding.isEmpty else { return combined }
            visible.entries = visible.entries.filter { entry in entry.seq.map { !hiding.contains($0) } ?? true }
            return visible
        }()
        if combined != previousTranscript || isRunning != previousRunning || hiding != previousHidden {
            if let combined = shown, let previousTranscript,
               hiding == previousHidden,
               isRunning, previousRunning,
               combined.entries == previousTranscript.entries, combined.turns == previousTranscript.turns,
               combined.pendingInputs == previousTranscript.pendingInputs,
               let running = combined.turns.max(by: { $0.turn < $1.turn }), running.end == nil,
               let index = previousRows.lastIndex(where: {
                   if case let .turn(row) = $0 { return row.turn == running.turn }
                   return false
               }), case let .turn(previous) = previousRows[index] {
                let ids = Set(previous.messageSequences.keys)
                let tail = Transcript(
                    entries: combined.entries.filter { ids.contains($0.id) },
                    turns: [running], live: combined.live
                )
                if case var .turn(row)? = TranscriptBuilder.rows(from: tail, isRunning: true).last {
                    row.id = previous.id
                    previousRows[index] = .turn(row)
                } else {
                    previousRows = TranscriptBuilder.rows(from: combined, isRunning: isRunning)
                    previousSeparators = TranscriptTimeGrouping.separators(for: previousRows)
                }
            } else {
                previousRows = shown.map { TranscriptBuilder.rows(from: $0, isRunning: isRunning) } ?? []
                previousSeparators = TranscriptTimeGrouping.separators(for: previousRows)
            }
            previousTranscript = combined
            previousRunning = isRunning
            previousHidden = hiding
        }
        var texts = ConversationMarkdown.texts(in: previousRows)
        if combined == nil {
            for message in messages where message.status != "streaming" {
                texts.insert(message.text)
                if let process = message.process { texts.insert(process) }
                if let reasoning = message.reasoning { texts.insert(reasoning) }
            }
        }
        texts.formUnion(additionalMarkdown)
        if texts != previousMarkdown.texts {
            previousMarkdown = ConversationMarkdown(texts: texts, reusing: previousMarkdown)
        }
        return ConversationProjection(
            transcript: combined, rows: previousRows, markdown: previousMarkdown, timeSeparators: previousSeparators,
            transcriptChanged: combined != current, rowsChanged: previousRows != currentRows
        )
    }
}
