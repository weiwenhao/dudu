import Foundation

// MARK: - Wire model (what the desktop plugin sends in "transcript" mode)

struct TranscriptCall: Codable, Identifiable, Equatable, Sendable {
    var id: String
    var name: String
    var activity: String
    var detail: String
    var status: String?
    var seq: Double? = nil
    var resultSeq: Double? = nil
}

struct TranscriptAttachment: Codable, Equatable, Hashable, Sendable {
    var kind: String
    var name: String
    var id: String? = nil
    var seq: Double? = nil
}

struct TranscriptCompaction: Codable, Equatable, Sendable {
    var items: Int?
    var tokens: Int?
    /// The summary the model keeps in place of the folded history (Markdown).
    var summary: String?
}

struct TranscriptEntry: Codable, Identifiable, Equatable, Sendable {
    var type: String
    var id: String
    var seq: Double?
    var time: Double?
    var text: String?
    var reasoning: String?
    var turn: Int?
    var step: Int?
    var calls: [TranscriptCall]?
    var usage: Int?
    var attachments: [TranscriptAttachment]?
    var commandId: String?
    var name: String?
    var outcome: String?
    var summary: String?
    var compaction: TranscriptCompaction?
    var source: String?
    var items: Int?
    var tokens: Int?
}

struct TranscriptTurn: Codable, Equatable, Sendable {
    var turn: Int
    var start: Double?
    var end: Double?
    var outcome: String?
    var lastSeq: Double? = nil
    var files: [DeliveredFile]? = nil
    var changesSeq: Double? = nil
    var notices: [TurnNotice]? = nil
    var stats: [String: Double]? = nil
    var usage: [String: Double]? = nil
}

struct TranscriptLive: Codable, Equatable, Sendable {
    var id: String
    var text: String?
    var reasoning: String?
    var calls: [TranscriptCall]?
}

struct Transcript: Codable, Equatable, Sendable {
    var entries: [TranscriptEntry]
    var turns: [TranscriptTurn]
    var live: TranscriptLive?
    var beforeSeq: Double? = nil
    var throughSeq: Double? = nil
    var hasMore: Bool? = nil
    var tools: [String: TranscriptToolReference]? = nil
}

struct TranscriptToolReference: Codable, Equatable, Sendable {
    var seq: Double?
    var resultSeq: Double?
    var status: String?
}

struct SessionGoal: Codable, Equatable, Sendable {
    var id: String
    var phase: String
    var objective: String
    var blocked: String?

    var isPaused: Bool { phase == "paused" || phase == "blocked" }

    var title: String {
        switch phase {
        case "paused": return "已暂停的目标"
        case "blocked": return "受阻的目标"
        default: return "进行中的目标"
        }
    }
}

// MARK: - Presentation model

/// How DSH groups tool activity: the kind picks the icon and the group's title.
enum ActivityKind: String, Sendable, Equatable {
    case thinking, read, readImage, search, edit, write, commands, code
    case webSearch, webFetch, subagents, plan, questions, tools

    init(wire: String) { self = ActivityKind(rawValue: wire) ?? .tools }

    var doneTitle: String {
        switch self {
        case .thinking: return "已完成分析"
        case .read: return "已读取文件"
        case .readImage: return "已读取图片"
        case .write: return "已写入文件"
        case .search: return "已搜索代码"
        case .edit: return "修改了文件"
        case .commands: return "执行了命令"
        case .code: return "运行了代码"
        case .webSearch: return "已搜索网页"
        case .webFetch: return "已访问网页"
        case .subagents: return "已协调子智能体"
        case .plan: return "更新了计划"
        case .questions: return "向用户提出了问题"
        case .tools: return "已调用工具"
        }
    }

    var runningTitle: String {
        switch self {
        case .thinking: return "正在分析请求"
        case .read: return "正在读取文件"
        case .readImage: return "正在读取图片"
        case .write: return "正在写入文件"
        case .search: return "正在搜索代码"
        case .edit: return "正在编辑文件"
        case .commands: return "正在运行命令"
        case .code: return "正在运行代码"
        case .webSearch: return "正在搜索网页"
        case .webFetch: return "正在访问网页"
        case .subagents: return "正在协调子智能体"
        case .plan: return "正在更新计划"
        case .questions: return "等待你的操作"
        case .tools: return "正在调用工具"
        }
    }
}

enum TranscriptTitles {
    /// Compose a closed group's title from its top three activity kinds, as DSH's chat does.
    static func groupTitle(_ counts: [(kind: ActivityKind, count: Int)]) -> String {
        let labels = counts.prefix(3).map { $0.kind.doneTitle }
        guard let first = labels.first else { return ActivityKind.thinking.doneTitle }
        guard labels.count > 1 else { return first }
        let sharedPrefix = "已"
        if labels.count == 2 {
            var second = labels[1]
            if first.hasPrefix(sharedPrefix), second.hasPrefix(sharedPrefix) {
                second = String(second.dropFirst(sharedPrefix.count))
            }
            return "\(first)并\(second)"
        }
        let title = labels.joined(separator: "，")
        return counts.count > 3 ? "\(title)等" : title
    }

    /// Row title for one tool call ("运行命令 · List top memory processes").
    static func rowTitle(forTool name: String) -> String {
        switch name {
        case "bash", "pwsh", "exec_command", "write_stdin": return "运行命令"
        case "read": return "读取"
        case "read_image": return "读取图片"
        case "write": return "写入"
        case "edit", "apply_patch": return "编辑"
        case "run_code": return "代码"
        case "grep": return "搜索文件内容"
        case "glob": return "查找文件"
        case "web_search": return "网页搜索"
        case "web_fetch": return "网页获取"
        case "ask_user_question", "request_user_input": return "提问"
        case "todo_write": return "更新待办清单"
        case "create_goal": return "创建目标"
        case "get_goal": return "查看目标"
        case "update_goal": return "更新目标"
        default:
            if name.hasPrefix("terminal_") { return "运行命令" }
            if name.hasPrefix("subagent") { return "子智能体" }
            return "工具调用"
        }
    }

    static func triggerTitle(_ source: String) -> String {
        switch source {
        case "goal": return "继续执行目标"
        case "agent-message": return "收到任务消息"
        case "team-message": return "收到团队消息"
        case "subagent-settled": return "子任务状态更新"
        case "github": return "收到 GitHub 事件"
        case "webhook": return "收到外部事件"
        case "schedule": return "自动化任务"
        case "tool-jobs": return "后台任务状态更新"
        case "cordis-host-runner": return "插件状态更新"
        default: return "收到执行请求"
        }
    }

    /// `44秒`, `5分13秒`, `1小时2分0秒` — whole seconds, no leading zero units.
    static func duration(milliseconds: Double) -> String {
        let total = max(0, Int(milliseconds / 1_000))
        let hours = total / 3_600
        let minutes = (total / 60) % 60
        let seconds = total % 60
        var text = ""
        if hours > 0 { text += "\(hours)小时" }
        if total >= 60 { text += "\(minutes)分" }
        return text + "\(seconds)秒"
    }

    /// `517`, `12.2K`, `1.3M` — the compact token figure used in the usage label.
    static func tokens(_ value: Int) -> String {
        func scaled(_ candidate: Double) -> String {
            candidate >= 100 ? String(Int(candidate.rounded())) : String(format: "%g", (candidate * 10).rounded() / 10)
        }
        if value < 1_000 { return String(value) }
        if value < 1_000_000 { return "\(scaled(Double(value) / 1_000))K" }
        return "\(scaled(Double(value) / 1_000_000))M"
    }

    /// Same calendar day → `HH:mm`; same year → `M月d日 HH:mm`; otherwise `y年M月d日 HH:mm`.
    static func clock(_ milliseconds: Double, now: Date = Date(), calendar: Calendar = .current) -> String {
        let date = Date(timeIntervalSince1970: milliseconds / 1_000)
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let today = calendar.dateComponents([.year, .month, .day], from: now)
        let time = String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
        if parts.year == today.year, parts.month == today.month, parts.day == today.day { return time }
        let monthDay = "\(parts.month ?? 1)月\(parts.day ?? 1)日"
        if parts.year == today.year { return "\(monthDay) \(time)" }
        return "\(parts.year ?? 0)年\(monthDay) \(time)"
    }

    static func compactionSummary(items: Int?, tokens: Int?) -> String? {
        guard let items else { return nil }
        return "已压缩 \(items) 条历史记录（约 \(tokens ?? 0) tokens）"
    }
}

struct ProcessGroup: Identifiable, Equatable, Sendable {
    var id: String
    var calls: [TranscriptCall]
    var thoughts: [ProcessThought]
    /// Interleaved order of thoughts and calls as the model produced them.
    var order: [ProcessMember]
    var isRunning: Bool

    var counts: [(kind: ActivityKind, count: Int)] {
        var tally: [ActivityKind: Int] = [:]
        var first: [ActivityKind: Int] = [:]
        for (index, call) in calls.enumerated() {
            let kind = ActivityKind(wire: call.activity)
            tally[kind, default: 0] += 1
            if first[kind] == nil { first[kind] = index }
        }
        return tally.map { (kind: $0.key, count: $0.value) }
            .sorted { lhs, rhs in
                if lhs.count != rhs.count { return lhs.count > rhs.count }
                return (first[lhs.kind] ?? 0) < (first[rhs.kind] ?? 0)
            }
    }

    var title: String { TranscriptTitles.groupTitle(counts) }
    var leadingKind: ActivityKind { counts.first?.kind ?? .thinking }

    static func == (lhs: ProcessGroup, rhs: ProcessGroup) -> Bool {
        lhs.id == rhs.id && lhs.calls == rhs.calls && lhs.thoughts == rhs.thoughts
            && lhs.order == rhs.order && lhs.isRunning == rhs.isRunning
    }
}

struct ProcessThought: Identifiable, Equatable, Sendable {
    var id: String
    var text: String

    /// The collapsed row shows the first non-empty line without markdown emphasis markers.
    var summary: String {
        let line = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? text
        return line.replacingOccurrences(of: "**", with: "").trimmingCharacters(in: .whitespaces)
    }
}

enum ProcessMember: Equatable, Sendable, Identifiable {
    case thought(String)
    case call(String)

    var id: String {
        switch self {
        case let .thought(id): return "thought:\(id)"
        case let .call(id): return "call:\(id)"
        }
    }
}

enum ProcessSegment: Identifiable, Equatable, Sendable {
    case group(ProcessGroup)
    case reply(id: String, text: String)

    var id: String {
        switch self {
        case let .group(group): return "group:\(group.id)"
        case let .reply(id, _): return "reply:\(id)"
        }
    }
}

struct LiveStatus: Equatable, Sendable {
    var activity: ActivityKind
    var detail: String
}

struct TurnRow: Identifiable, Equatable, Sendable {
    enum Outcome: Equatable, Sendable { case running, done, failed, stopped, interrupted }

    var id: String
    var turn: Int?
    var outcome: Outcome
    var segments: [ProcessSegment]
    var answerID: String?
    var answer: String?
    var answerTime: Double?
    var duration: Double?
    var startedAt: Double?
    var usage: Int?
    var live: LiveStatus?
    var answerSeq: Double? = nil
    var messageSequences: [String: Double] = [:]
    var files: [DeliveredFile] = []
    var changesSeq: Double? = nil
    var notices: [TurnNotice] = []
    var performanceSeq: Double? = nil

    var hasProcess: Bool { !segments.isEmpty }

    /// "已完成，用时 44 秒", "处理失败", "已停止" — nil when the turn has nothing to disclose.
    var summaryTitle: String? {
        guard hasProcess, outcome != .running else { return nil }
        switch outcome {
        case .failed, .interrupted: return "处理失败"
        case .stopped: return "已停止"
        default:
            guard let duration, duration >= 0 else { return "已完成" }
            return "已完成，用时 \(TranscriptTitles.duration(milliseconds: duration))"
        }
    }

    /// Failed and stopped turns keep their process open, as DSH does.
    var staysOpen: Bool { outcome == .failed || outcome == .stopped || outcome == .interrupted }
}

struct UserRow: Identifiable, Equatable, Sendable {
    var id: String
    var text: String
    var attachments: [TranscriptAttachment]
    var time: Double?
    var seq: Double? = nil
}

struct CommandRow: Identifiable, Equatable, Sendable {
    var id: String
    var name: String
    var summary: String
    var isError: Bool
    var isRunning: Bool
    /// What opens when the row is tapped: the compaction summary, as in DSH.
    var detail: String? = nil
    var isCompaction = false
}

struct TriggerRow: Identifiable, Equatable, Sendable {
    var id: String
    var title: String
    var text: String
    var time: Double?
}

enum TranscriptRow: Identifiable, Equatable, Sendable {
    case user(UserRow)
    case turn(TurnRow)
    case command(CommandRow)
    case trigger(TriggerRow)
    case status(startedAt: Double?)

    var id: String {
        switch self {
        case let .user(row): return "user:\(row.id)"
        case let .turn(row): return "turn:\(row.id)"
        case let .command(row): return "command:\(row.id)"
        case let .trigger(row): return "trigger:\(row.id)"
        case .status: return "status"
        }
    }
}

// MARK: - Builder

enum TranscriptBuilder {
    /// Folds the plugin's entries into the rows the chat renders. Pure and order-preserving.
    static func rows(from transcript: Transcript, isRunning: Bool) -> [TranscriptRow] {
        var rows: [TranscriptRow] = []
        var turnRowIndex: [Int: Int] = [:]
        var stepsByTurn: [Int: [TranscriptEntry]] = [:]
        let timing = Dictionary(uniqueKeysWithValues: transcript.turns.map { ($0.turn, $0) })
        let latestTurn = transcript.turns.map(\.turn).max()

        for entry in transcript.entries {
            switch entry.type {
            case "user":
                rows.append(.user(UserRow(
                    id: entry.id, text: entry.text ?? "",
                    attachments: entry.attachments ?? [], time: entry.time, seq: entry.seq
                )))
            case "assistant", "turn-marker":
                let turn = entry.turn ?? -1
                if entry.type == "assistant" { stepsByTurn[turn, default: []].append(entry) }
                if turnRowIndex[turn] == nil {
                    turnRowIndex[turn] = rows.count
                    rows.append(.turn(TurnRow(
                        id: "turn-\(turn)", turn: turn >= 0 ? turn : nil, outcome: .done,
                        segments: [], answerID: nil, answer: nil, answerTime: nil,
                        duration: nil, startedAt: nil, usage: nil, live: nil
                    )))
                }
            case "command":
                rows.append(.command(commandRow(entry)))
            case "compaction":
                rows.append(.command(CommandRow(
                    id: entry.id, name: "上下文已压缩",
                    summary: TranscriptTitles.compactionSummary(items: entry.items, tokens: entry.tokens) ?? "",
                    isError: false, isRunning: false,
                    detail: nonEmpty(entry.summary), isCompaction: true
                )))
            case "trigger":
                rows.append(.trigger(TriggerRow(
                    id: entry.id, title: TranscriptTitles.triggerTitle(entry.source ?? ""),
                    text: entry.text ?? "", time: entry.time
                )))
            default:
                break
            }
        }

        // The turn that is still streaming: the newest one that has not ended, or a fresh row when the
        // model has not produced a step yet.
        let runningTurn: Int? = {
            guard isRunning else { return nil }
            if let latestTurn, timing[latestTurn]?.end == nil { return latestTurn }
            return nil
        }()
        if let live = transcript.live, let runningTurn, turnRowIndex[runningTurn] == nil {
            turnRowIndex[runningTurn] = rows.count
            rows.append(.turn(TurnRow(
                id: "turn-\(runningTurn)", turn: runningTurn, outcome: .running, segments: [],
                answerID: nil, answer: nil, answerTime: nil, duration: nil, startedAt: nil, usage: nil, live: nil
            )))
            stepsByTurn[runningTurn] = []
        }

        for (turn, index) in turnRowIndex {
            guard case var .turn(row) = rows[index] else { continue }
            let info = timing[turn]
            let isRunningTurn = turn == runningTurn
            let steps = (stepsByTurn[turn] ?? []).sorted { ($0.step ?? 0, $0.seq ?? 0) < ($1.step ?? 0, $1.seq ?? 0) }
            let liveStep = isRunningTurn ? transcript.live : nil

            row.startedAt = info?.start
            row.files = info?.files ?? []
            row.changesSeq = info?.changesSeq
            var retryChains = Set<String>()
            row.notices = (info?.notices ?? []).reversed().filter { notice in
                guard notice.kind == "retry", let retryId = notice.retryId, !retryId.isEmpty else { return true }
                return retryChains.insert(retryId).inserted
            }.reversed()
            row.performanceSeq = info?.lastSeq
            row.messageSequences = Dictionary(steps.compactMap { entry in entry.seq.map { (entry.id, $0) } },
                                              uniquingKeysWith: { _, latest in latest })
            let usage = steps.compactMap(\.usage).reduce(0, +)
            row.usage = usage > 0 ? usage : nil
            if isRunningTurn {
                row.outcome = .running
            } else {
                switch info?.outcome {
                case "failed": row.outcome = .failed
                case "stopped": row.outcome = .stopped
                case "interrupted": row.outcome = .interrupted
                default: row.outcome = .done
                }
            }
            if let start = info?.start, let end = info?.end, end >= start { row.duration = end - start }

            // The final answer is the last step's text when it made no tool calls; the rest is process.
            var processSteps = steps
            if !isRunningTurn, let last = steps.last, (last.calls ?? []).isEmpty,
               let text = last.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                row.answerID = last.id
                row.answer = text
                row.answerTime = last.time
                row.answerSeq = last.seq
                processSteps.removeLast()
            }
            row.segments = segments(from: processSteps, live: liveStep, isRunningTurn: isRunningTurn)
            if isRunningTurn { row.live = liveStatus(steps: steps, live: liveStep) }
            rows[index] = .turn(row)
        }

        if isRunning, runningTurn == nil {
            rows.append(.status(startedAt: nil))
        }
        return rows
    }

    private static func commandRow(_ entry: TranscriptEntry) -> CommandRow {
        let name = entry.name ?? ""
        let isError = entry.outcome == "error"
        let running = entry.outcome == nil
        var summary = (entry.summary ?? "").split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        if name == "compact" {
            if running {
                summary = "正在压缩…"
            } else if !isError {
                summary = TranscriptTitles.compactionSummary(
                    items: entry.compaction?.items, tokens: entry.compaction?.tokens
                ) ?? CommandText.message(
                    for: .compact, argument: nil,
                    outcome: CommandOutcome(isError: false, text: entry.summary ?? "")
                )
            } else {
                summary = CommandText.message(
                    for: .compact, argument: nil,
                    outcome: CommandOutcome(isError: true, text: entry.summary ?? "")
                )
            }
        }
        let isCompaction = name == "compact"
        return CommandRow(
            id: entry.id, name: name, summary: summary, isError: isError, isRunning: running,
            detail: isCompaction && !isError ? nonEmpty(entry.compaction?.summary) : nil,
            isCompaction: isCompaction
        )
    }

    private static func nonEmpty(_ text: String?) -> String? {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        return trimmed
    }

    /// Splits process steps into groups of thinking + tool rows, broken by interim replies.
    private static func segments(
        from steps: [TranscriptEntry],
        live: TranscriptLive?,
        isRunningTurn: Bool
    ) -> [ProcessSegment] {
        var segments: [ProcessSegment] = []
        var calls: [TranscriptCall] = []
        var thoughts: [ProcessThought] = []
        var order: [ProcessMember] = []
        var groupIndex = 0

        func flush(running: Bool) {
            guard !order.isEmpty else { return }
            segments.append(.group(ProcessGroup(
                id: "g\(groupIndex)", calls: calls, thoughts: thoughts, order: order, isRunning: running
            )))
            groupIndex += 1
            calls = []
            thoughts = []
            order = []
        }
        func absorb(id: String, reasoning: String?, text: String?, stepCalls: [TranscriptCall]?) {
            if let reasoning, !reasoning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                thoughts.append(ProcessThought(id: id, text: reasoning))
                order.append(.thought(id))
            }
            if let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                flush(running: false)
                segments.append(.reply(id: id, text: text))
            }
            for call in stepCalls ?? [] {
                calls.append(call)
                order.append(.call(call.id))
            }
        }

        for step in steps {
            absorb(id: step.id, reasoning: step.reasoning, text: step.text, stepCalls: step.calls)
        }
        if let live {
            absorb(id: live.id, reasoning: live.reasoning, text: live.text, stepCalls: live.calls)
        }
        flush(running: isRunningTurn)
        return segments
    }

    private static func liveStatus(steps: [TranscriptEntry], live: TranscriptLive?) -> LiveStatus {
        let calls = (live?.calls ?? []) + (steps.last?.calls ?? [])
        if let running = calls.last(where: { ($0.status ?? "running") == "running" }) {
            return LiveStatus(activity: ActivityKind(wire: running.activity), detail: running.detail)
        }
        if let reasoning = live?.reasoning {
            return LiveStatus(activity: .thinking, detail: latestParagraphSummary(reasoning))
        }
        return LiveStatus(activity: .thinking, detail: "")
    }

    /// The first line of the newest completed reasoning paragraph, without emphasis markers.
    static func latestParagraphSummary(_ reasoning: String) -> String {
        let paragraphs = reasoning.components(separatedBy: "\n\n")
        for paragraph in paragraphs.reversed() {
            let line = paragraph.split(whereSeparator: \.isNewline).first.map(String.init) ?? paragraph
            let cleaned = line.replacingOccurrences(of: "**", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !cleaned.isEmpty { return cleaned }
        }
        return ""
    }
}
