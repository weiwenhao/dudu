import Foundation

// 嘟嘟's conversation as a group chat with a boundary (owner, 2026-11-10; the plugin: `host/assistant/home/group.mjs`, the design: `.local/designs/group-chat-2026-11-10/`, `docs/assistant.md` 4.1).
//
// Four things come into the thread besides what the owner and 嘟嘟 say: the owner's `@ISSUE …` line (`at`), the answer of that issue's agent to it (`reply`), a silent mark that the answer will not
// come (`end`), and the result of a scheduled task that 嘟嘟 did itself (`task`, 2026-11-11). Each is a command of the conversation that the plugin runs without the model (`dudu-say`); the plugin keeps what it
// says under the command's id, and its bridge attaches that to the command's entry of the transcript (`group`), as it does a card. The issue's ID is its name here, its agent's logo its picture, and its title the
// signature after the time; a `task` line is about no issue: it is 嘟嘟's own words, with the task's name over them.

/// Who a line is about: the issue the owner wrote to, and the agent that answered.
struct GroupIssue: Codable, Equatable, Hashable, Sendable {
    var id: Int?
    var ref: String?
    var title: String
    var agent: String?

    /// The name: the issue's ID (`DUD-9`), else its number.
    var name: String { ref ?? id.map { "#\($0)" } ?? "" }
    var sessionAgent: SessionAgent? { agent.flatMap(SessionAgent.init(rawValue:)) }
}

enum GroupLineKind: String, Codable, Sendable { case at, reply, end, task }

/// The scheduled task whose run a `task` line tells of.
struct GroupTask: Codable, Equatable, Hashable, Sendable {
    var id: String
    var title: String
}

/// The current visible text of an answer, carried on its @ line until the final reply is committed.
struct GroupLiveReply: Codable, Equatable, Sendable {
    var text: String
    var at: Double
}

/// One line of the group chat as the plugin kept it.
struct GroupLine: Codable, Equatable, Sendable {
    var kind: GroupLineKind
    /// The issue the line is about. A `task` line has none: it comes without the key and reads as an empty issue (no ID, no title), so nothing that asks an issue for its ID answers for it.
    var issue: GroupIssue
    var text: String?
    var at: Double?
    /// The command of the `at` line that a `reply` or `end` belongs to.
    var to: String?
    /// `answer` or `question`: whether the reply is the agent's answer, or it stopped to ask the owner.
    var answer: String?
    var files: Int?
    /// Only a `task` line: the task that ran.
    var task: GroupTask?
    /// Only a `task` line: false when the run failed, and then `text` is the reason (the plugin's own words, which may be English).
    var ok: Bool?
    var liveReply: GroupLiveReply? = nil

    private enum CodingKeys: String, CodingKey { case kind, issue, text, at, to, answer, files, task, ok, liveReply }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        kind = try container.decode(GroupLineKind.self, forKey: .kind)
        if kind == .task {
            issue = try container.decodeIfPresent(GroupIssue.self, forKey: .issue) ?? GroupIssue.none
        } else {
            issue = try container.decode(GroupIssue.self, forKey: .issue)
        }
        text = try container.decodeIfPresent(String.self, forKey: .text)
        at = try container.decodeIfPresent(Double.self, forKey: .at)
        to = try container.decodeIfPresent(String.self, forKey: .to)
        answer = try container.decodeIfPresent(String.self, forKey: .answer)
        files = try container.decodeIfPresent(Int.self, forKey: .files)
        task = try container.decodeIfPresent(GroupTask.self, forKey: .task)
        ok = try container.decodeIfPresent(Bool.self, forKey: .ok)
        liveReply = try container.decodeIfPresent(GroupLiveReply.self, forKey: .liveReply)
    }

    /// Whether the owner can answer the line by writing to its issue. A `task` line is 嘟嘟's own words: there is no issue to write to.
    var isAnswerable: Bool { kind != .end && kind != .task && issue.id != nil }

    /// The word put in front of the reason of a run that failed (new, 2026-11-11, awaiting the owner's review; English: "Run failed").
    static let runFailed = L10n.text("运行失败")

    /// What a `task` line says under the task's name: the result, or for a run that failed the word 运行失败, a colon and the reason.
    var taskText: String {
        let said = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard ok == false else { return said }
        return said.isEmpty ? Self.runFailed : L10n.text("{0}：{1}", "\(Self.runFailed)", "\(said)")
    }
}

extension GroupIssue {
    /// The issue of a line that is about none (a `task` line).
    static let none = GroupIssue(id: nil, ref: nil, title: "", agent: nil)
}

/// What a command's entry of the transcript carries for a line. A line this app cannot read (a newer plugin's) is no line: the command keeps its plain row and the conversation still opens.
struct GroupLineSlot: Codable, Equatable, Sendable {
    var line: GroupLine?

    init(_ line: GroupLine?) { self.line = line }

    init(from decoder: Decoder) throws {
        line = try? GroupLine(from: decoder)
    }

    func encode(to encoder: Encoder) throws {
        if let line {
            try line.encode(to: encoder)
        } else {
            var container = encoder.singleValueContainer()
            try container.encodeNil()
        }
    }
}

enum GroupChat {
    /// The command of 嘟嘟's conversation that makes a line (`SAY_COMMAND`, `host/assistant/home/group.mjs`).
    static let command = "dudu-say"
    /// A line whose answer has not come for this long is not waited for any more (the plugin was restarted, or the agent was left).
    static let waitLimit: Double = 15 * 60_000

    /// What the box holds after the owner chose to answer `issue`: its `@ID`, put in front of what is written, or in place of the `@ID` that starts it (only a leading `@ID` routes a message).
    static func replyDraft(_ draft: String, to issue: GroupIssue) -> String {
        let name = issue.name
        guard !name.isEmpty else { return draft }
        let leading = draft.drop { $0 == " " || $0 == "\n" }
        if leading.hasPrefix("@") {
            let token = leading.dropFirst().prefix { !$0.isWhitespace }
            if isAddress(String(token)) {
                let rest = leading.dropFirst(1 + token.count)
                return "@\(name)" + (rest.isEmpty ? " " : String(rest))
            }
        }
        return draft.isEmpty ? "@\(name) " : "@\(name) \(draft)"
    }

    /// An issue's address as `AssistantCompletion.address` reads it: its number (`7`, `#7`) or its project's reference (`DUD-7`).
    private static func isAddress(_ token: String) -> Bool {
        let value = token.hasPrefix("#") ? String(token.dropFirst()) : token
        if !value.isEmpty, value.count <= 15, value.allSatisfy(\.isNumber), value.first != "0" { return true }
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 2, (1...3).contains(parts[0].count), parts[0].allSatisfy(\.isLetter),
              !parts[1].isEmpty, parts[1].count <= 15, parts[1].allSatisfy(\.isNumber), parts[1].first != "0" else { return false }
        return true
    }

    /// A message as one quiet line for under a title: the marks of markdown (emphasis, code, headings, quotes, list bullets, the bars of a table) are left out and the lines are run together.
    static func plain(_ markdown: String) -> String {
        var lines: [String] = []
        for raw in markdown.split(whereSeparator: \.isNewline) {
            var line = String(raw).trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") { continue }
            // A horizontal rule and the rule row of a table say nothing; the bars of a table are only a space between its cells.
            if line.contains("-"), line.allSatisfy({ "|-: ".contains($0) }) { continue }
            if line.hasPrefix("|") || line.contains(" | ") {
                line = line.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
            }
            while let first = line.first, "#>".contains(first) { line.removeFirst() }
            line = line.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") { line.removeFirst(2) }
            else if let dot = line.firstIndex(of: "."), line[..<dot].allSatisfy(\.isNumber), !line[..<dot].isEmpty, line[line.index(after: dot)...].hasPrefix(" ") { line = String(line[line.index(dot, offsetBy: 2)...]) }
            line = line.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "__", with: "").replacingOccurrences(of: "`", with: "")
            if !line.isEmpty { lines.append(line) }
        }
        return lines.joined(separator: " ")
    }

    /// The lines whose answer is still on its way: an `at` line that no `reply` or `end` names, and that is not older than `waitLimit` or carries live text.
    static func waiting(in rows: [TranscriptRow], now: Double) -> [CommandRow] {
        var answered = Set<String>()
        for case let .command(row) in rows {
            if let line = row.group, line.kind != .at, let to = line.to { answered.insert(to) }
        }
        return rows.compactMap { row -> CommandRow? in
            guard case let .command(command) = row, !command.isTyping, let line = command.group, line.kind == .at,
                  let id = command.commandId, !answered.contains(id) else { return nil }
            if line.liveReply?.text.isEmpty != false, let at = line.at, now - at > waitLimit { return nil }
            return command
        }
    }

    /// The thread in the order the owner reads it: an issue's answer (`reply`, or the silent `end`) stands right under the line it answers, where its dots stood while it was awaited, and not where it arrived,
    /// after everything written since (owner, 2026-11-11, with a screenshot of an answer at the end of the thread: "这个消息有回复了直接跳过了所有消息在最新消息展示，我希望这个消息能停留在 loading 框对应的位置").
    /// An answer moves behind its line and behind the answers already there; one whose line is not among the rows (hidden, or on a page not loaded yet) stays where it arrived; the other rows keep their order.
    static func placingReplies(in rows: [TranscriptRow]) -> [TranscriptRow] {
        var asked = Set<String>()
        for case let .command(command) in rows {
            if let line = command.group, line.kind == .at, !command.isTyping, let id = command.commandId { asked.insert(id) }
        }
        var under: [String: [TranscriptRow]] = [:]
        var moved = Set<Int>()
        for (index, row) in rows.enumerated() {
            guard case let .command(command) = row, let line = command.group, line.kind == .reply || line.kind == .end,
                  let to = line.to, asked.contains(to) else { continue }
            var placed = command
            if line.kind == .reply, under[to, default: []].isEmpty { placed.id = "answer:\(to)" }
            under[to, default: []].append(.command(placed))
            moved.insert(index)
        }
        guard !moved.isEmpty else { return rows }
        var placed: [TranscriptRow] = []
        placed.reserveCapacity(rows.count)
        for (index, row) in rows.enumerated() where !moved.contains(index) {
            placed.append(row)
            if case let .command(command) = row, command.group?.kind == .at, let id = command.commandId, let answers = under[id] { placed += answers }
        }
        return placed
    }

    /// `rows` with the dots of the answers still on their way put in (`make` builds a row from the waiting line): each stands right under the line it waits for, in its own place, so that what comes
    /// after it covers it as the thread grows (owner, 2026-11-11: "应该在原位吧，我新发的消息可以把它慢慢覆盖"), and not at the end of the thread, where it followed everything the owner wrote after the line.
    static func placingTyping(in rows: [TranscriptRow], now: Double, make: (CommandRow) -> TranscriptRow) -> [TranscriptRow] {
        var placed = rows
        for line in waiting(in: rows, now: now) {
            guard let commandId = line.commandId,
                  let index = placed.firstIndex(where: { row in
                      if case let .command(command) = row { return command.commandId == commandId && !command.isTyping }
                      return false
                  }) else { continue }
            placed.insert(make(line), at: index + 1)
        }
        return placed
    }
}
