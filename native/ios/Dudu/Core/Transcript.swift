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
    var requestId: String? = nil
    /// The rows of a card of 嘟嘟's chat, on the entry of the command that made it (`QuickCard`).
    var card: QuickCardSlot? = nil
    /// A line of the group chat (the owner's @ message to an issue, its answer, the result of a scheduled task), on the entry of the command that made it (`GroupLine`).
    var group: GroupLineSlot? = nil
}

struct TranscriptTurn: Codable, Equatable, Sendable {
    var turn: Int
    var start: Double?
    var end: Double?
    var outcome: String?
    var lastSeq: Double? = nil
    var files: [DeliveredFile]? = nil
    var changesSeq: Double? = nil
    var changesSummary: ConversationChangeSummary? = nil
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
    /// Host-authoritative next-step input, kept separate from the durable transcript.
    var pendingInputs: [QueuedMessage]? = nil
    /// The lines of 嘟嘟's thread that the owner hid, by the sequence number of their event (only in the answer for that conversation): the interface does not show them.
    var hidden: [Double]? = nil
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
        case "paused": return L10n.text("已暂停的目标")
        case "blocked": return L10n.text("受阻的目标")
        default: return L10n.text("进行中的目标")
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
        case .thinking: return L10n.text("已完成分析")
        case .read: return L10n.text("已读取文件")
        case .readImage: return L10n.text("已读取图片")
        case .write: return L10n.text("已写入文件")
        case .search: return L10n.text("已搜索代码")
        case .edit: return L10n.text("修改了文件")
        case .commands: return L10n.text("执行了命令")
        case .code: return L10n.text("运行了代码")
        case .webSearch: return L10n.text("已搜索网页")
        case .webFetch: return L10n.text("已访问网页")
        case .subagents: return L10n.text("已协调子智能体")
        case .plan: return L10n.text("更新了计划")
        case .questions: return L10n.text("向用户提出了问题")
        case .tools: return L10n.text("已调用工具")
        }
    }

    var runningTitle: String {
        switch self {
        case .thinking: return L10n.text("正在分析请求")
        case .read: return L10n.text("正在读取文件")
        case .readImage: return L10n.text("正在读取图片")
        case .write: return L10n.text("正在写入文件")
        case .search: return L10n.text("正在搜索代码")
        case .edit: return L10n.text("正在编辑文件")
        case .commands: return L10n.text("正在运行命令")
        case .code: return L10n.text("正在运行代码")
        case .webSearch: return L10n.text("正在搜索网页")
        case .webFetch: return L10n.text("正在访问网页")
        case .subagents: return L10n.text("正在协调子智能体")
        case .plan: return L10n.text("正在更新计划")
        case .questions: return L10n.text("等待你的操作")
        case .tools: return L10n.text("正在调用工具")
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
            return L10n.text("{0}并{1}", "\(first)", "\(second)")
        }
        let title = labels.joined(separator: L10n.language == "en" ? ", " : "，")
        return counts.count > 3 ? L10n.text("{0}等", "\(title)") : title
    }

    /// Row title for one tool call ("运行命令 · List top memory processes").
    static func rowTitle(forTool name: String) -> String {
        switch name {
        case "bash", "pwsh", "exec_command", "write_stdin": return L10n.text("运行命令")
        case "read": return L10n.text("读取")
        case "read_image": return L10n.text("读取图片")
        case "write": return L10n.text("写入")
        case "edit", "apply_patch": return L10n.text("编辑")
        case "run_code": return L10n.text("代码")
        case "grep": return L10n.text("搜索文件内容")
        case "glob": return L10n.text("查找文件")
        case "web_search": return L10n.text("网页搜索")
        case "web_fetch": return L10n.text("网页获取")
        case "ask_user_question", "request_user_input": return L10n.text("提问")
        case "todo_write": return L10n.text("更新待办清单")
        case "create_goal": return L10n.text("创建目标")
        case "get_goal": return L10n.text("查看目标")
        case "update_goal": return L10n.text("更新目标")
        default:
            if name.hasPrefix("terminal_") { return L10n.text("运行命令") }
            if name.hasPrefix("subagent") { return L10n.text("子智能体") }
            return L10n.text("工具调用")
        }
    }

    static func triggerTitle(_ source: String) -> String {
        switch source {
        case "goal": return L10n.text("继续执行目标")
        case "agent-message": return L10n.text("收到任务消息")
        case "team-message": return L10n.text("收到团队消息")
        case "subagent-settled": return L10n.text("子任务状态更新")
        case "github": return L10n.text("收到 GitHub 事件")
        case "webhook": return L10n.text("收到外部事件")
        case "schedule": return L10n.text("自动化任务")
        case "tool-jobs": return L10n.text("后台任务状态更新")
        case "cordis-host-runner": return L10n.text("插件状态更新")
        default: return L10n.text("收到执行请求")
        }
    }

    /// `44秒`, `5分13秒`, `1小时2分0秒` — whole seconds, no leading zero units.
    static func duration(milliseconds: Double) -> String {
        let total = max(0, Int(milliseconds / 1_000))
        let hours = total / 3_600
        let minutes = (total / 60) % 60
        let seconds = total % 60
        var text = ""
        if hours > 0 { text += L10n.text("{0}小时", "\(hours)") }
        if total >= 60 { text += L10n.text("{0}分", "\(minutes)") }
        return text + L10n.text("{0}秒", "\(seconds)")
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
        if parts.year == today.year, parts.month == today.month, parts.day == today.day {
            return L10n.date(date, template: "jmm", timezone: calendar.timeZone)
        }
        return L10n.date(date, template: parts.year == today.year ? "MMMdjmm" : "yMMMdjmm",
                         timezone: calendar.timeZone)
    }

    static func compactionSummary(items: Int?, tokens: Int?) -> String? {
        guard let items else { return nil }
        return L10n.text("已压缩 {0} 条历史记录（约 {1} tokens）", "\(items)", "\(tokens ?? 0)")
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
    var changesSummary: ConversationChangeSummary? = nil
    var notices: [TurnNotice] = []
    var performanceSeq: Double? = nil
    /// A user message can interrupt a turn. Only its last chronological fragment owns the turn footer.
    var isLastFragment = true

    var hasProcess: Bool { !segments.isEmpty }

    /// "已完成，用时 44 秒", "处理失败", "已停止" — nil when the turn has nothing to disclose.
    var summaryTitle: String? {
        guard isLastFragment, hasProcess, outcome != .running else { return nil }
        switch outcome {
        case .failed, .interrupted: return L10n.text("处理失败")
        case .stopped: return L10n.text("已停止")
        default:
            guard let duration, duration >= 0 else { return L10n.text("已完成") }
            return L10n.text("已完成，用时 {0}", "\(TranscriptTitles.duration(milliseconds: duration))")
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
    var isPending = false
    var requestId: String? = nil

    var presentationID: String { requestId.map { "submission:\($0)" } ?? id }
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
    /// A card of 嘟嘟's chat: the row is drawn as the card, not as a command.
    var card: QuickCard? = nil
    /// The id of the command that made the row (`assistant.card` names the card a repeat would only copy by it).
    var commandId: String? = nil
    /// A line of the group chat: the row is drawn as the owner's @ message, as the answer of an issue's agent or as the result of a scheduled task of 嘟嘟's, not as a command.
    var group: GroupLine? = nil
    /// The sequence number of the command's event: what hiding the row names.
    var seq: Double? = nil
    /// The answer of the issue is on its way: the row is the dots that stand for it (`GroupChat.waiting`).
    var isTyping = false
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
        case let .user(row): return "user:\(row.presentationID)"
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
        var turnRowIndices: [Int: [Int]] = [:]
        var stepsByRow: [Int: [TranscriptEntry]] = [:]
        let timing = Dictionary(uniqueKeysWithValues: transcript.turns.map { ($0.turn, $0) })
        let latestTurn = transcript.turns.map(\.turn).max()

        func appendTurn(_ turn: Int) -> Int {
            let index = rows.count
            let base = "turn-\(turn)"
            let boundaryTime: Double? = {
                switch rows.last {
                case let .user(user): return user.time
                case let .trigger(trigger): return trigger.time
                default: return nil
                }
            }()
            // A paged-in continuation keeps its identity when an earlier part of the same turn is later loaded.
            let beganBeforeBoundary = boundaryTime.map { time in timing[turn]?.start.map { time > $0 } ?? false } ?? false
            let id = turnRowIndices[turn] == nil && !beganBeforeBoundary
                ? base : "\(base):after:\(rows.last?.id ?? "start")"
            turnRowIndices[turn, default: []].append(index)
            rows.append(.turn(TurnRow(
                id: id, turn: turn >= 0 ? turn : nil, outcome: .done,
                segments: [], answerID: nil, answer: nil, answerTime: nil,
                duration: nil, startedAt: nil, usage: nil, live: nil
            )))
            return index
        }

        for entry in transcript.entries {
            switch entry.type {
            case "user":
                rows.append(.user(UserRow(
                    id: entry.id, text: entry.text ?? "",
                    attachments: entry.attachments ?? [], time: entry.time, seq: entry.seq, requestId: entry.requestId
                )))
            case "assistant", "turn-marker":
                let turn = entry.turn ?? -1
                let index: Int
                if let previous = turnRowIndices[turn]?.last, previous == rows.count - 1 {
                    index = previous
                } else { index = appendTurn(turn) }
                if entry.type == "assistant" { stepsByRow[index, default: []].append(entry) }
            case "command":
                // Native automatic compaction is an activity boundary, with no DSH summary.
                // Its completed marker must not remain pinned after an ever-growing turn.
                if entry.source == "dudu-harness", entry.name == "compact", entry.outcome == "success" {
                    continue
                }
                // A card that is still being made has nothing to show yet: the button's own spinner says so, and the card replaces it.
                if entry.name == QuickCard.command, entry.outcome == nil {
                    continue
                }
                // The same for a line of the group chat, and the silent mark that an answer will not come is no row at all.
                if entry.name == GroupChat.command, entry.outcome == nil || entry.group?.line?.kind == .end {
                    continue
                }
                rows.append(.command(commandRow(entry)))
            case "compaction":
                rows.append(.command(CommandRow(
                    id: entry.id, name: L10n.text("上下文已压缩"),
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
        if let runningTurn, turnRowIndices[runningTurn]?.last != rows.count - 1 {
            _ = appendTurn(runningTurn)
        }

        for (turn, indices) in turnRowIndices {
          for index in indices {
            guard case var .turn(row) = rows[index] else { continue }
            let info = timing[turn]
            let isRunningTurn = turn == runningTurn
            row.isLastFragment = index == indices.last
            let steps = (stepsByRow[index] ?? []).sorted { ($0.step ?? 0, $0.seq ?? 0) < ($1.step ?? 0, $1.seq ?? 0) }
            let liveStep = isRunningTurn && row.isLastFragment ? transcript.live : nil

            row.startedAt = info?.start
            row.files = row.isLastFragment ? info?.files ?? [] : []
            row.changesSeq = row.isLastFragment ? info?.changesSeq : nil
            row.changesSummary = row.isLastFragment ? info?.changesSummary : nil
            var retryChains = Set<String>()
            row.notices = (row.isLastFragment ? info?.notices ?? [] : []).reversed().filter { notice in
                guard notice.kind == "retry", let retryId = notice.retryId, !retryId.isEmpty else { return true }
                return retryChains.insert(retryId).inserted
            }.reversed()
            row.performanceSeq = row.isLastFragment ? info?.lastSeq : nil
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
            if row.isLastFragment, let start = info?.start, let end = info?.end, end >= start { row.duration = end - start }

            // The final answer is the last step's text when it made no tool calls; the rest is process.
            var processSteps = steps
            if row.isLastFragment, !isRunningTurn, let last = steps.last, (last.calls ?? []).isEmpty,
               let text = last.text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                row.answerID = last.id
                row.answer = text
                row.answerTime = last.time
                row.answerSeq = last.seq
                processSteps.removeLast()
            }
            row.segments = segments(from: processSteps, live: liveStep, isRunningTurn: isRunningTurn && row.isLastFragment)
            if isRunningTurn && row.isLastFragment { row.live = liveStatus(steps: steps, live: liveStep) }
            rows[index] = .turn(row)
          }
        }

        if isRunning, runningTurn == nil {
            rows.append(.status(startedAt: nil))
        }
        // An issue's answer stands under the line it answers, and the dots of the answers still on their way stand there too, until the answer comes: not at the end of the thread (owner, 2026-11-11:
        // "应该在原位吧，我新发的消息可以把它慢慢覆盖", and for the answer "我希望这个消息能停留在 loading 框对应的位置").
        rows = GroupChat.placingReplies(in: rows)
        rows = GroupChat.placingTyping(in: rows, now: Date().timeIntervalSince1970 * 1000) { line in
            var reply = line.group
            let live = reply?.liveReply
            if let live, !live.text.isEmpty {
                reply?.kind = .reply
                reply?.text = live.text
                reply?.at = live.at
                reply?.to = line.commandId
            }
            return .command(CommandRow(
                id: "answer:\(line.commandId ?? line.id)", name: GroupChat.command, summary: "", isError: false, isRunning: true,
                group: reply, isTyping: live?.text.isEmpty != false
            ))
        }
        let admittedIDs = Set(transcript.entries.filter { $0.type == "user" }.map(\.id))
        for input in transcript.pendingInputs ?? [] where !admittedIDs.contains(input.id) {
            rows.append(.user(UserRow(
                id: input.id, text: input.text, attachments: input.attachments ?? [],
                time: nil, isPending: true, requestId: input.requestId
            )))
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
                summary = L10n.text("正在压缩…")
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
            isCompaction: isCompaction,
            card: name == QuickCard.command && !isError ? entry.card?.card : nil,
            commandId: entry.commandId,
            group: name == GroupChat.command && !isError ? entry.group?.line : nil,
            seq: entry.seq
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
