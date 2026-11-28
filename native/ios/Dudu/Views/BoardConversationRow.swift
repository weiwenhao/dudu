import SwiftUI

/// Measured from the owner's Lark screenshot at the phone's 420pt viewport width.
enum BoardHomeLayout {
    static let rowHeight: CGFloat = 66
    static let avatarSize: CGFloat = 48
    static let horizontalInset: CGFloat = 16
    static let avatarTextSpacing: CGFloat = 12
    static let pinnedRowHeight: CGFloat = 72
    static let titleLineHeight: CGFloat = 22
    static let previewLineHeight: CGFloat = 20
    static let lineSpacing: CGFloat = 6
    static let agentSize: CGFloat = 14
}

// Read/unread artwork is shared between the native menu and the supplied Lark swipe design.
extension BoardConversation {
    var pinActionGlyph: DuduGlyph { pinned ? .unpin : .pin }
    var readActionImage: String { unread ? "Home-SwipeClearUnread" : "Home-SwipeMarkUnread" }
}

/// The approved C layout: issue avatar, two text lines, time with a small Agent logo below.
struct BoardConversationRow: View {
    let entry: BoardConversation
    var busy = false
    let onSubIssues: (BoardIssue) -> Void
    let onOpen: (BoardOpenTrace) -> Void
    @State private var rowToken = UUID()
    @State private var openTrace: BoardOpenTrace?

    private var progress: BoardSubIssueProgress? {
        guard let value = entry.issue?.subIssues, value.total > 0 else { return nil }
        return value
    }

    var body: some View {
        // Separate buttons: the subissue hit area must never invoke the row's open action.
        ZStack(alignment: .trailing) {
            openButton
            if let progress, let issue = entry.issue {
                BoardSubIssueProgressButton(progress: progress) { onSubIssues(issue) }
                    .padding(.trailing, BoardHomeLayout.horizontalInset + BoardHomeLayout.agentSize)
                    .offset(y: (BoardHomeLayout.titleLineHeight + BoardHomeLayout.lineSpacing) / 2)
            }
        }
    }

    private var openButton: some View {
        Button {
            let trace = openTrace ?? BoardOpenTrace(rowToken: rowToken)
            trace.record("action", state: "row")
            onOpen(trace)
        } label: {
            HStack(alignment: .center, spacing: BoardHomeLayout.avatarTextSpacing) {
                BoardConversationAvatar(entry: entry, size: BoardHomeLayout.avatarSize)
                VStack(alignment: .leading, spacing: BoardHomeLayout.lineSpacing) {
                    HStack(spacing: 8) {
                        BoardConversationTitle(
                            title: entry.isAssistant ? L10n.text("嘟嘟") : entry.title,
                            parent: entry.issue?.parent
                        )
                            .font(.system(size: 17))
                            .foregroundStyle(DuduStyle.ink)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if entry.receivedAt > 0 {
                            Text(receivedTime)
                                .font(.system(size: 14))
                                .foregroundStyle(DuduStyle.muted)
                                .fixedSize()
                        }
                    }
                    .frame(height: BoardHomeLayout.titleLineHeight)
                    HStack(spacing: 8) {
                        Text(entry.preview)
                            .font(.system(size: 14))
                            .foregroundStyle(DuduStyle.muted)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if let progress {
                            // Reserve only the visible content; the independent button above retains
                            // the old capsule padding without squeezing the preview further.
                            BoardSubIssueProgressLabel(progress: progress)
                                .hidden()
                                .accessibilityHidden(true)
                        }
                        if busy {
                            ProgressView().controlSize(.mini).tint(DuduStyle.muted)
                                .frame(width: BoardHomeLayout.agentSize, height: BoardHomeLayout.agentSize)
                        } else {
                            BoardAgentMark(entry: entry)
                        }
                    }
                    .frame(height: BoardHomeLayout.previewLineHeight)
                }
            }
            .padding(.horizontal, BoardHomeLayout.horizontalInset)
            .frame(height: BoardHomeLayout.rowHeight)
            .frame(maxWidth: .infinity)
            .background(.white)
            .contentShape(Rectangle())
        }
        .buttonStyle(BoardConversationPressStyle { pressed in
            if pressed { openTrace = BoardOpenTrace(rowToken: rowToken) }
            openTrace?.record("press", state: pressed ? "down" : "released_or_cancelled")
        })
        .accessibilityIdentifier("board.conversation.\(entry.id)")
    }

    private var receivedTime: String { entry.receivedLabel }
}

extension BoardConversation {
    /// When the newest message came, as a row says it: the time of day today, 昨天, or the date.
    var receivedLabel: String {
        let date = Date(timeIntervalSince1970: receivedAt / 1000)
        if Calendar.current.isDateInToday(date) { return L10n.date(date, template: "jmm") }
        if Calendar.current.isDateInYesterday(date) { return L10n.text("昨天") }
        return L10n.date(date, template: "MMMd")
    }
}

/// The small mark at the end of a row's second line: the agent that has the issue, or the dashed circle of an issue that nobody has yet. 嘟嘟 has none.
struct BoardAgentMark: View {
    let entry: BoardConversation

    var body: some View {
        if let agent = entry.issue?.sessionAgent {
            AgentLogo(agent: agent, size: BoardHomeLayout.agentSize)
        } else if entry.issue != nil {
            // Desktop's empty AgentAvatar: the same user glyph in a dashed circle.
            DuduIcon(.stateUnassigned, size: 10.5, scalesStroke: true)
                .foregroundStyle(DuduStyle.muted)
                .frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(DuduStyle.muted.opacity(0.5),
                    style: StrokeStyle(lineWidth: 1, dash: [2, 2])))
                .accessibilityHidden(true)
        }
    }
}

/// A full-row press highlight, without dimming or resizing the conversation's content.
private struct BoardConversationPressStyle: ButtonStyle {
    let onPress: (Bool) -> Void

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .overlay {
                Color.black.opacity(configuration.isPressed ? 0.06 : 0)
                    .allowsHitTesting(false)
            }
            .onChange(of: configuration.isPressed) { _, pressed in onPress(pressed) }
    }
}

/// A conversation's tile (the approved B-1 avatar): a rounded square in the tone of its title with the title's initials, wherever the conversation is listed (the home list, the forward picker).
struct ConversationTile: View {
    let title: String
    let size: CGFloat

    var body: some View {
        let initials = ConversationIdentity.initials(of: title)
        let tone = ConnectorAvatar.colors(of: title)
        RoundedRectangle(cornerRadius: (size * 0.25).rounded(), style: .circular)
            .fill(tone.background)
            .overlay {
                Text(initials)
                    .font(.system(size: size * (initials.unicodeScalars.count > 2 ? 0.32 : 0.37), weight: .medium))
                    .foregroundStyle(tone.letter)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .frame(maxWidth: size * 0.79)
                    .offset(y: size * 0.015)
            }
            .frame(width: size, height: size)
    }
}

struct BoardConversationAvatar: View {
    let entry: BoardConversation
    let size: CGFloat

    var body: some View {
        Group {
            if entry.isAssistant {
                DuduLogo(size: size * 0.94).frame(width: size, height: size)
            } else {
                ConversationTile(title: entry.title, size: size)
            }
        }
        .modifier(ConversationAvatarStatus(state: entry.sessionState, size: size, roundedSquare: !entry.isAssistant))
        .accessibilityHidden(true)
    }
}

/// Seven across, six plus expansion when overflowing; pinned conversations remain in the main list.
struct BoardPinnedShelf<Cell: View>: View {
    let entries: [BoardConversation]
    @Binding var expanded: Bool
    @ViewBuilder let cell: (BoardConversation) -> Cell

    private var overflow: Bool { entries.count > 7 }
    private var slots: Int { overflow ? (expanded ? entries.count + 1 : 7) : entries.count }
    private var rows: Int { (slots + 6) / 7 }

    var body: some View {
        VStack(spacing: 0) {
            ForEach(0..<rows, id: \.self) { row in
                HStack(alignment: .top, spacing: 0) {
                    ForEach(0..<7, id: \.self) { column in
                        if column > 0 { Spacer(minLength: 0) }
                        slot(at: row * 7 + column).frame(width: 40, height: BoardHomeLayout.pinnedRowHeight, alignment: .top)
                    }
                }
            }
        }
        .padding(.horizontal, BoardHomeLayout.horizontalInset)
        .padding(.top, 8)
    }

    @ViewBuilder private func slot(at index: Int) -> some View {
        if overflow && index == 6 {
            Button { expanded.toggle() } label: {
                VStack(spacing: 8) {
                    // Keep the reference shelf's small filled triangle on its original 40pt canvas.
                    Image(expanded ? "Home-PinsCollapse" : "Home-PinsExpand")
                        .resizable().renderingMode(.template)
                        .foregroundStyle(DuduStyle.chatSecondary)
                        .frame(width: 40, height: 40)
                        .background(Color(red: 240.0 / 255, green: 240.0 / 255, blue: 242.0 / 255), in: Circle())
                        .overlay(alignment: .topTrailing) {
                            let unread = entries.dropFirst(6).filter(\.unread).count
                            if !expanded && unread > 0 {
                                Text(unread > 9 ? "9+" : "\(unread)")
                                    .font(.system(size: 10, weight: .medium)).foregroundStyle(.white)
                                    .frame(minWidth: 16, minHeight: 16)
                                    .background(Color(red: 236.0 / 255, green: 19.0 / 255, blue: 19.0 / 255), in: Capsule())
                                    .overlay(Capsule().strokeBorder(.white, lineWidth: 1.5))
                                    .offset(x: 3, y: -3)
                            }
                        }
                    Text(expanded ? L10n.text("收起") : L10n.text("展开"))
                        .font(.system(size: 11.5)).foregroundStyle(DuduStyle.muted)
                }
                .frame(width: 54, height: BoardHomeLayout.pinnedRowHeight, alignment: .top)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        } else {
            let item = overflow && index > 6 ? index - 1 : index
            if item < entries.count { cell(entries[item]) }
            else { Color.clear }
        }
    }
}
