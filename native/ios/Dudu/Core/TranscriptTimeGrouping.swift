import Foundation

enum TranscriptTimeGrouping {
    static let interval: Double = 5 * 60_000

    static func separators(for rows: [TranscriptRow], calendar: Calendar = .current) -> [String: Double] {
        var separators: [String: Double] = [:]
        var lastActivity: Double?
        var lastGroupTime: Double?
        var followsPrompt = false

        func valid(_ time: Double?) -> Double? {
            guard let time, time.isFinite, time >= 0 else { return nil }
            return time
        }

        func beginGroup(at time: Double?, id: String) {
            guard let time = valid(time) else { return }
            if let previous = lastActivity {
                guard time >= previous else { return }
                let sameDay = calendar.isDate(
                    Date(timeIntervalSince1970: (lastGroupTime ?? previous) / 1_000),
                    inSameDayAs: Date(timeIntervalSince1970: time / 1_000)
                )
                if sameDay, time - previous < interval { return }
            }
            separators[id] = time
            lastGroupTime = time
        }

        func recordActivity(_ time: Double?) {
            guard let time = valid(time) else { return }
            lastActivity = max(lastActivity ?? time, time)
        }

        for row in rows {
            switch row {
            case let .user(user):
                beginGroup(at: user.time, id: row.id)
                recordActivity(user.time)
                followsPrompt = true
            case let .trigger(trigger):
                beginGroup(at: trigger.time, id: row.id)
                recordActivity(trigger.time)
                followsPrompt = true
            case let .turn(turn):
                if !followsPrompt || lastActivity == nil {
                    beginGroup(at: valid(turn.startedAt) ?? turn.answerTime, id: row.id)
                }
                recordActivity(turn.startedAt)
                recordActivity(turn.answerTime)
                if let start = turn.startedAt, let duration = turn.duration, duration >= 0 {
                    recordActivity(start + duration)
                }
                followsPrompt = false
            case .command, .status:
                break
            }
        }
        return separators
    }
}
