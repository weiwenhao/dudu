import SwiftUI

/// The page the app opens on: the owner's board (owner, 2026-11-07), as a list grouped by what each agent is doing, "需要你" first.
/// Its header (the sidebar button, the scope menu, "+") is the root's toolbar; this is the rest of the page. A row is the sidebar's own:
/// the agent's mark, the title, the time. A tap opens the issue's conversation.
struct BoardView: View {
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    /// The toolbar above the page (the page itself starts below the status bar).
    let topInset: CGFloat
    let onOpen: (BoardIssue) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                content
            }
            .padding(.top, topInset + 8)
            .padding(.bottom, 40)
        }
        .refreshable { await board.refresh(using: store) }
        .background(DSBotStyle.canvas)
        .accessibilityIdentifier("board.page")
        // Read when the tab is on screen and again every few seconds while it is, as the desktop does. The page is open before the computer is connected (the app
        // opens on it): a read that has nowhere to go is skipped, so the loop starts again the moment the connection is there instead of after its pause
        // (2026-11-08: a connect of 60 ms and a read of 49 ms showed the spinner for five seconds).
        .task(id: BoardLoad(tab: board.tab, connected: store.status == .connected)) {
            guard store.status == .connected else { return }
            while !Task.isCancelled {
                await board.refresh(using: store)
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }

    /// What the reading loop is for: the tab, and whether the computer is there to ask.
    struct BoardLoad: Hashable {
        var tab: BoardTab
        var connected: Bool
    }

    @ViewBuilder
    private var content: some View {
        switch board.state {
        case .loading:
            ProgressView()
                .controlSize(.regular)
                .tint(DSBotStyle.muted)
                .frame(maxWidth: .infinity)
                .padding(.top, 80)
                .accessibilityIdentifier("board.loading")
        case .failed:
            VStack(spacing: 14) {
                Text("事项没能加载")
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                Button("重试") { Task { await board.refresh(using: store) } }
                    .font(.system(size: 15, weight: .medium))
                    .buttonStyle(DSBotGlassCapsuleButtonStyle())
                    .padding(.horizontal, 20)
                    .frame(height: 44)
                    .accessibilityIdentifier("board.retry")
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 80)
        case .loaded:
            if board.groups.isEmpty {
                Text("没有事项")
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 80)
                    .accessibilityIdentifier("board.empty")
            } else {
                ForEach(board.groups) { group in
                    BoardGroupHeader(group: group, isFolded: board.isFolded(group)) { board.toggle(group) }
                        .padding(.top, group.id == board.groups.first?.id ? 0 : DSBotLayout.sidebarPadding)
                    if !board.isFolded(group) {
                        ForEach(group.items) { issue in
                            BoardRow(issue: issue) { onOpen(issue) }
                                .onAppear {
                                    if issue.id == group.items.last?.id, group.nextCursor != nil {
                                        Task { await board.loadMore(group, using: store) }
                                    }
                                }
                        }
                    }
                }
            }
        }
    }
}

/// The board's selected scope, centered in the existing toolbar. iOS owns the menu and its selection mark.
struct BoardScopeMenu: View {
    @ObservedObject var board: BoardModel

    var body: some View {
        Menu {
            Picker(selection: Binding(get: { board.tab }, set: { board.select($0) })) {
                ForEach(BoardTab.allCases) { tab in
                    Text(tab.title)
                        .tag(tab)
                        .accessibilityIdentifier("board.tab.\(tab.id)")
                }
            } label: {
                EmptyView()
            }
            .pickerStyle(.inline)
        } label: {
            HStack(spacing: 6) {
                Text(board.tab.title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(DSBotStyle.muted)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 8)
            .frame(minWidth: DSBotLayout.toolbarButtonSize, minHeight: DSBotLayout.toolbarHeight)
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .accessibilityLabel(board.tab.title)
        .accessibilityIdentifier("board.scope")
    }
}

/// The Collector's three tabs: a glass capsule, the chosen one in the sidebar's selected grey.
struct GlassTabs<Tab: Identifiable & Hashable>: View {
    let tabs: [Tab]
    let title: (Tab) -> String
    let selection: Tab
    let identifier: String
    let onSelect: (Tab) -> Void

    var body: some View {
        HStack(spacing: 2) {
            ForEach(tabs) { tab in
                Button {
                    onSelect(tab)
                } label: {
                    Text(title(tab))
                        .font(.system(size: 15, weight: selection == tab ? .medium : .regular))
                        .foregroundStyle(selection == tab ? DSBotStyle.ink : DSBotStyle.muted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background(selection == tab ? DSBotStyle.selected : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
                .accessibilityIdentifier("\(identifier).\(tab.id)")
            }
        }
        .padding(4)
        .frame(height: 44)
        .dsbotGlass(in: Capsule())
        .padding(.horizontal, DSBotLayout.sidebarPadding)
        .padding(.bottom, 6)
    }
}

/// A compact group heading on the outer edge, above its inset issue rows.
private struct BoardGroupHeader: View {
    let group: BoardGroup
    let isFolded: Bool
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 10) {
                // Keep the state on the outer edge so it reads as the parent of the inset rows.
                BoardGroupIcon(key: group.key, active: group.count > 0)
                    .frame(width: 20)
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(group.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DSBotStyle.chatSecondary)
                        .lineLimit(1)
                    if isFolded {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(DSBotStyle.muted)
                            .alignmentGuide(.firstTextBaseline) { $0[.firstTextBaseline] + 1.2 }
                            .layoutPriority(1)
                            .accessibilityHidden(true)
                    }
                    Spacer(minLength: 0)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotQuietPressStyle())
        .padding(.leading, 10)
        .padding(.trailing, 4)
        .padding(.horizontal, DSBotLayout.sidebarPadding)
        .accessibilityLabel("\(group.title)，\(isFolded ? "已折叠" : "已展开")")
        .accessibilityHint("点按折叠或展开")
        .accessibilityIdentifier("board.group.\(group.key)")
    }
}

/// The icon of an agent state, as the desktop draws it (`AgentStateIcon`): idle a ring, working a ring that turns while the group has somebody in it, needs you an octagon with a pause
/// in the warning colour, unassigned a person.
private struct BoardGroupIcon: View {
    let key: String
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var turning = false

    private var glyph: DSBotGlyph {
        switch key {
        case "working": return .stateWorking
        case "blocked": return .stateBlocked
        case "unassigned": return .stateUnassigned
        default: return .stateIdle
        }
    }

    private var spins: Bool { key == "working" && active && !reduceMotion }

    var body: some View {
        DSBotIcon(glyph, size: 16, strokeWidth: 1.7)
            .foregroundStyle(key == "blocked" ? Color(red: 245.0 / 255, green: 158.0 / 255, blue: 11.0 / 255) : DSBotStyle.muted)
            .rotationEffect(.degrees(spins && turning ? 360 : 0))
            .animation(spins ? .linear(duration: 1).repeatForever(autoreverses: false) : nil, value: turning)
            .onAppear { turning = true }
            .accessibilityHidden(true)
    }
}

/// What an issue with no agent has where the agent's mark is: the desktop's dashed ring with a person in it.
private struct BoardNoAgentMark: View {
    var body: some View {
        Circle()
            .strokeBorder(DSBotStyle.muted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [2.5, 2.5]))
            .overlay { DSBotIcon(.stateUnassigned, size: 11, strokeWidth: 1.7).foregroundStyle(DSBotStyle.muted) }
            .frame(width: 18, height: 18)
            .frame(width: 20, height: 20)
            .accessibilityHidden(true)
    }
}

/// One issue, laid out like a conversation of the sidebar: what the agent is doing, its number, the title, and when it last changed.
private struct BoardRow: View {
    let issue: BoardIssue
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 0) {
                // Every row has the mark's column, so the titles line up (an issue without an agent had none, and its title stood further left).
                Group {
                    if let agent = issue.sessionAgent {
                        AgentAvatar(agent: agent, state: issue.workState, finished: issue.agentFinished == true, asleep: issue.deepSleep == true)
                    } else {
                        BoardNoAgentMark()
                    }
                }
                .frame(width: 20, height: 20)
                .padding(.trailing, 10)
                // Its number between the mark and the title, as on the desktop (owner, 2026-11-07).
                Text(issue.reference)
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(DSBotStyle.muted)
                    .lineLimit(1)
                    .frame(minWidth: 48, alignment: .leading)
                    .padding(.trailing, 6)
                Text(issue.title)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(relativeTime(issue.updatedAt))
                    .font(.system(size: 10))
                    .foregroundStyle(DSBotStyle.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(width: DSBotLayout.actionColumnWidth, alignment: .center)
            }
            .frame(minHeight: 46)
            .padding(.leading, 10 + DSBotLayout.sidebarPadding)
            .padding(.trailing, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .padding(.horizontal, DSBotLayout.sidebarPadding)
        .padding(.bottom, 2)
        .accessibilityIdentifier("board.issue.\(issue.id)")
    }
}
