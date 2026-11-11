import SwiftUI

// The rows of the 待办 card that 嘟嘟 sends into the thread (owner, 2026-11-10; the drawing: `.local/designs/group-chat-2026-11-10/phone.png`). A row is an issue: its agent's picture with the mark of its state,
// its ID, when its latest message was said and its title as the signature; under it the latest message of its session, two lines of it. A tap opens the row downward to the whole message, and the two
// things to do with it: 回复 (the issue's @ goes into the box) and 打开会话 (its own conversation, one to one: the back button there leads back to this chat).

struct QuickTodoList: View {
    let issues: [BoardIssue]
    @State private var open: Int? = Self.reviewOpen
    /// `-dsbot-review-todo-open 1`: the row of that issue starts open (the simulator has no finger).
    private static var reviewOpen: Int? {
        #if DEBUG && targetEnvironment(simulator)
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "-dsbot-review-todo-open"), index + 1 < arguments.count else { return nil }
        return Int(arguments[index + 1])
        #else
        return nil
        #endif
    }
    @Environment(\.openQuickCardIssue) private var openIssue
    @Environment(\.groupChat) private var group

    var body: some View {
        VStack(spacing: 0) {
            ForEach(issues) { issue in
                QuickTodoRow(
                    issue: issue, isOpen: open == issue.id,
                    onToggle: { toggle(issue) },
                    onReply: { group?.reply(GroupIssue(id: issue.id, ref: issue.ref, title: issue.title, agent: issue.agent)) },
                    onOpen: { openIssue(issue) }
                )
                if issue.id != issues.last?.id {
                    Rectangle().fill(Color.black.opacity(0.06)).frame(height: 0.5).padding(.leading, 54)
                }
            }
        }
    }

    private func toggle(_ issue: BoardIssue) {
        // An issue nobody has yet has no conversation and nothing to say: what it says is shown, as the board shows it.
        guard issue.sessionId != nil, issue.latest != nil else { openIssue(issue); return }
        withAnimation(.easeOut(duration: 0.2)) { open = open == issue.id ? nil : issue.id }
    }
}

private struct QuickTodoRow: View {
    let issue: BoardIssue
    let isOpen: Bool
    let onToggle: () -> Void
    let onReply: () -> Void
    let onOpen: () -> Void

    private var latest: IssueLatest? { issue.latest }
    private var canAnswer: Bool { issue.sessionId != nil && issue.latest != nil }

    var body: some View {
        Button(action: onToggle) {
            HStack(alignment: .top, spacing: 12) {
                Group {
                    if let agent = issue.sessionAgent {
                        AgentAvatar(agent: agent, state: issue.workState, finished: issue.agentFinished == true, asleep: issue.deepSleep == true, size: 28)
                    } else {
                        BoardNoAgentMark()
                    }
                }
                .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 4) {
                    header
                    if let latest {
                        if isOpen {
                            expanded(latest)
                        } else {
                            Text((latest.isMine ? "你：" : "") + GroupChat.plain(latest.text))
                                .font(.system(size: 13))
                                .foregroundStyle(latest.isMine ? DSBotStyle.muted : DSBotStyle.chatSecondary)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 56, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .accessibilityElement(children: isOpen ? .contain : .combine)
        .accessibilityIdentifier("quick.todo.\(issue.id)")
        .accessibilityValue(isOpen ? "已展开" : "已收起")
    }

    /// The ID, when the latest message was said, and the title as the signature after them; the arrow says that the row opens.
    private var header: some View {
        HStack(spacing: 8) {
            Text(issue.reference)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(DSBotStyle.ink)
                .lineLimit(1)
                .fixedSize()
            if let latest {
                Text(relativeTime(latest.at))
                    .font(.system(size: 12))
                    .foregroundStyle(DSBotStyle.muted)
                    .fixedSize()
            }
            Text(issue.title)
                .font(.system(size: 15))
                .foregroundStyle(DSBotStyle.chatSecondary)
                .lineLimit(1)
            Spacer(minLength: 0)
            if canAnswer {
                DSBotIcon(isOpen ? .up : .down, size: 14, scalesStroke: true)
                    .foregroundStyle(DSBotStyle.muted)
            }
        }
        .frame(minHeight: 28)
    }

    private func expanded(_ latest: IssueLatest) -> some View {
        VStack(alignment: .trailing, spacing: 10) {
            ScrollView {
                MessageMarkdown(text: (latest.isMine ? "你：" : "") + latest.text, compact: true, allowsTextSelection: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 220)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .background(latest.isMine ? DSBotStyle.chatBubble : Color(red: 0xf4 / 255, green: 0xf5 / 255, blue: 0xf7 / 255), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            HStack(spacing: 8) {
                TodoActionButton(title: "回复", glyph: .reply, tint: DSBotStyle.blue, fill: DSBotStyle.chatBubble, action: onReply)
                    .accessibilityIdentifier("quick.todo.reply.\(issue.id)")
                TodoActionButton(title: "打开会话", glyph: .openLink, tint: DSBotStyle.chatSecondary, fill: Color(red: 0xf1 / 255, green: 0xf2 / 255, blue: 0xf4 / 255), action: onOpen)
                    .accessibilityIdentifier("quick.todo.open.\(issue.id)")
            }
        }
        .padding(.top, 2)
    }
}

/// A button under an opened row: its word and picture, a capsule (a phone has no mouse to hold over an icon).
private struct TodoActionButton: View {
    let title: String
    let glyph: DSBotGlyph
    let tint: Color
    let fill: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                DSBotIcon(glyph, size: 15, scalesStroke: true)
                Text(title).font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(tint)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(fill, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(DSBotQuietPressStyle())
    }
}
