import SwiftUI

/// The page the app opens on: the owner's board (owner, 2026-11-07), as a list grouped by what each agent is doing, "需要你" first.
/// Its header (the sidebar button, the scope menu, "+") is the root's toolbar; this is the rest of the page. A row is the sidebar's own:
/// the priority, agent's mark, reference, title and time. A tap opens the issue's conversation.
struct BoardView: View {
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    /// The toolbar above the page (the page itself starts below the status bar).
    let topInset: CGFloat
    var isActive = true
    let onOpen: (BoardIssue) -> Void
    @State private var removing: BoardIssue?
    @State private var revealed: Int?
    @State private var editing: IssueActionRequest?

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
        .sheet(item: $editing) { request in
            if request.action == .subIssue {
                NewIssueSheet(board: board, store: store, parent: request.issue)
            } else {
                IssueActionsSheet(board: board, store: store, issue: request.issue, action: request.action)
            }
        }
        .alert(
            removing.map { L10n.text("删除“{0} {1}”？", "\($0.reference)", "\($0.title)") } ?? L10n.text("删除"),
            isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
        ) {
            Button(L10n.text("取消"), role: .cancel) { removing = nil }
            Button(L10n.text("删除"), role: .destructive) {
                guard let issue = removing else { return }
                removing = nil
                Task { await board.delete(issue, using: store) }
            }
        } message: {
            Text(L10n.text("将删除这条事项、活动和本地关联。来源消息和会话历史会保留。"))
        }
        .onChange(of: store.activeComputer?.id) { _, _ in removing = nil; revealed = nil; editing = nil }
        .onChange(of: board.tab) { _, _ in revealed = nil }
        .onChange(of: isActive) { _, active in if !active { removing = nil; revealed = nil; editing = nil } }
        // Read when the tab is on screen and again every few seconds while it is, as the desktop does. The page is open before the computer is connected (the app
        // opens on it): a read that has nowhere to go is skipped, so the loop starts again the moment the connection is there instead of after its pause
        // (2026-11-08: a connect of 60 ms and a read of 49 ms showed the spinner for five seconds).
        .task(id: BoardLoad(tab: board.tab, connected: store.status == .connected, active: isActive)) {
            guard isActive, store.status == .connected else { return }
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
        var active: Bool
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
                Text(L10n.text("事项没能加载"))
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                Button(L10n.text("重试")) { Task { await board.refresh(using: store) } }
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
                Text(L10n.text("没有事项"))
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 80)
                    .accessibilityIdentifier("board.empty")
            } else {
                ForEach(board.groups) { group in
                    BoardGroupHeader(group: group, isFolded: board.isFolded(group), needsYouColor: board.needsYouColor) { board.toggle(group) }
                        .padding(.top, group.id == board.groups.first?.id ? 0 : DSBotLayout.sidebarPadding)
                    if !board.isFolded(group) {
                        ForEach(group.items) { issue in
                            SwipeActionRow(actions: actions(for: issue), isRevealed: revealed == issue.id, onReveal: { revealed = $0 ? issue.id : nil }) {
                                BoardRow(issue: issue, busy: board.deleting.contains(issue.id)) {
                                    if revealed != nil { revealed = nil } else { onOpen(issue) }
                                }
                                .contextMenu {
                                    ForEach(IssueQuickAction.allCases) { action in
                                        if action == .subIssue { Divider() }
                                        Button { edit(issue, action: action) } label: { DSBotLabel(action.title, icon: action.glyph) }
                                            .disabled(!action.isAvailable(for: issue) || store.status != .connected)
                                    }
                                    Divider()
                                    Button(role: .destructive) { revealed = nil; removing = issue } label: { DSBotLabel(L10n.text("删除"), icon: .trash) }
                                        .disabled(store.status != .connected)
                                } preview: { SidebarSessionCard(title: issue.title) }
                            }
                                .disabled(board.deleting.contains(issue.id))
                                .padding(.horizontal, DSBotLayout.sidebarPadding)
                                .padding(.bottom, 2)
                                .onAppear {
                                    if isActive, issue.id == group.items.last?.id, group.nextCursor != nil {
                                        Task { await board.loadMore(group, using: store) }
                                    }
                                }
                        }
                    }
                }
            }
        }
    }

    private func actions(for issue: BoardIssue) -> [SwipeAction] {
        guard store.status == .connected else { return [] }
        return [
            SwipeAction(id: "more", title: L10n.text("更多"), symbol: "ellipsis", color: SwipeAction.grey) { edit(issue) },
            SwipeAction(id: "delete", title: L10n.text("删除"), symbol: "trash", color: SwipeAction.red) { removing = issue },
        ]
    }

    private func edit(_ issue: BoardIssue, action: IssueQuickAction? = nil) {
        revealed = nil
        editing = IssueActionRequest(issue: issue, action: action)
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
    let needsYouColor: UInt32
    let onToggle: () -> Void

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 10) {
                // Keep the state on the outer edge so it reads as the parent of the inset rows.
                BoardGroupIcon(key: group.key, active: group.count > 0, needsYouColor: needsYouColor)
                    .frame(width: 20)
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text(group.title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DSBotStyle.chatSecondary)
                        .lineLimit(1)
                    Text("\(group.count)")
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(DSBotStyle.muted)
                        .padding(.leading, 5)
                        .padding(.trailing, 3)
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
        .accessibilityLabel(L10n.text("{0}，{1}", "\(group.title)", "\(isFolded ? L10n.text("已折叠") : L10n.text("已展开"))"))
        .accessibilityValue("\(group.count)")
        .accessibilityHint(L10n.text("点按折叠或展开"))
        .accessibilityIdentifier("board.group.\(group.key)")
    }
}

/// Needs you takes the computer's chosen color with the ordinary board response;
/// the heading and the other state icons keep their existing colors.
private struct BoardGroupIcon: View {
    let key: String
    let active: Bool
    let needsYouColor: UInt32
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationIsCovered) private var covered
    @State private var turning = false

    private var glyph: DSBotGlyph {
        switch key {
        case "working": return .stateWorking
        case "unassigned": return .stateUnassigned
        default: return .stateIdle
        }
    }

    private var spins: Bool { key == "working" && active && !reduceMotion && !covered }

    var body: some View {
        Group {
            if key == "blocked" {
                BoardNeedsYouMark(active: active, hex: needsYouColor)
            } else {
                DSBotIcon(glyph, size: 16, strokeWidth: 1.7)
                    .foregroundStyle(DSBotStyle.muted)
                    .rotationEffect(.degrees(spins && turning ? 360 : 0))
                    .animation(spins ? .linear(duration: 1).repeatForever(autoreverses: false) : nil, value: turning)
                    .onChange(of: spins, initial: true) { _, spins in turning = spins }
            }
        }
        .accessibilityHidden(true)
    }
}

/// The center stays still while one faint ring expands and disappears.
private struct BoardNeedsYouMark: View {
    let active: Bool
    let hex: UInt32
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.conversationIsCovered) private var covered
    @State private var expanded = false

    private var color: Color {
        Color(red: Double(hex >> 16 & 255) / 255, green: Double(hex >> 8 & 255) / 255, blue: Double(hex & 255) / 255)
    }
    private var animates: Bool { active && !reduceMotion && !covered && scenePhase == .active }

    var body: some View {
        ZStack {
            if animates {
                Circle()
                    .stroke(color, lineWidth: 0.8)
                    .frame(width: 13, height: 13)
                    .scaleEffect(expanded ? 20.0 / 13 : 7.0 / 13)
                    .opacity(expanded ? 0 : 0.32)
                    .animation(.easeOut(duration: 2.6).repeatForever(autoreverses: false), value: expanded)
                    .onAppear { expanded = true }
                    .onDisappear { expanded = false }
            }
            Circle()
                .fill(color.opacity(0.1))
                .frame(width: 13, height: 13)
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
        }
        .frame(width: 16, height: 16)
        .accessibilityHidden(true)
    }
}

/// What an issue with no agent has where the agent's mark is: the desktop's dashed ring with a person in it.
struct BoardNoAgentMark: View {
    var body: some View {
        Circle()
            .strokeBorder(DSBotStyle.muted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [2.5, 2.5]))
            .overlay { DSBotIcon(.stateUnassigned, size: 11, strokeWidth: 1.7).foregroundStyle(DSBotStyle.muted) }
            .frame(width: 18, height: 18)
            .frame(width: 20, height: 20)
            .accessibilityHidden(true)
    }
}

/// The approved aligned columns: priority under the group mark, then the agent, a fixed-width reference and title.
/// The todo card of 嘟嘟's chat draws its rows with it too (`QuickCardView`).
struct BoardRow: View {
    let issue: BoardIssue
    var busy = false
    let onOpen: () -> Void

    private var priority: IssuePriority { IssuePriority(rawValue: issue.priority) ?? .none }

    var body: some View {
        Button(action: onOpen) {
            HStack(spacing: 0) {
                IssuePriorityIcon(priority: priority)
                    .offset(y: priority == .high || priority == .medium || priority == .low ? -0.5 : 0)
                    .frame(width: 20, height: 20)
                    .padding(.trailing, 6)
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
                    .minimumScaleFactor(0.85)
                    .frame(width: 50, alignment: .leading)
                    .padding(.trailing, 6)
                Text(issue.title)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Group {
                    if busy {
                        ProgressView().controlSize(.small).tint(DSBotStyle.muted)
                    } else {
                        Text(relativeTime(issue.updatedAt))
                            .font(.system(size: 10))
                            .foregroundStyle(DSBotStyle.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                    }
                }
                .frame(width: DSBotLayout.actionColumnWidth, alignment: .center)
            }
            .frame(minHeight: 46)
            .padding(.leading, 10)
            .padding(.trailing, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .accessibilityIdentifier("board.issue.\(issue.id)")
    }
}
