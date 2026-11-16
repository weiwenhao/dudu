import SwiftUI

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
                        AgentAvatar(agent: agent, state: issue.workState, asleep: issue.deepSleep == true)
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
