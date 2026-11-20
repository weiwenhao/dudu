import SwiftUI

private struct BoardScopeSelectionKey: PreferenceKey {
    static var defaultValue: Anchor<CGRect>? { nil }

    static func reduce(value: inout Anchor<CGRect>?, nextValue: () -> Anchor<CGRect>?) {
        if let next = nextValue() { value = next }
    }
}

struct BoardScopeBar: View {
    let selection: BoardTab
    let hasFilters: Bool
    let onSelect: (BoardTab) -> Void
    let onFilter: () -> Void

    var body: some View {
        HStack(spacing: 2) {
            Button(action: onFilter) {
                DuduIcon(.listFilter, size: 18)
                    .foregroundStyle(hasFilters ? DuduStyle.blue : DuduStyle.ink)
                    .frame(width: 32, height: 32)
                    .background(hasFilters ? DuduStyle.chatBubble : DuduStyle.scopeTrack, in: Circle())
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(DuduQuietPressStyle())
            .accessibilityLabel(L10n.text("筛选"))
            .accessibilityAddTraits(hasFilters ? .isSelected : [])
            .accessibilityIdentifier("board.filters")
            HStack(spacing: 0) {
                ForEach(BoardTab.allCases) { tab in
                    Button { onSelect(tab) } label: {
                        Text(tab.title)
                            // The chosen tab's words stay the grey of the others; only the white pill marks it (owner, 2026-11-18: "就用灰色吧").
                            .font(.system(size: 14, weight: selection == tab ? .medium : .regular))
                            .foregroundStyle(DuduStyle.chatSecondary)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                            .padding(.horizontal, 13)
                            .frame(minWidth: 44, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(DuduQuietPressStyle())
                    .anchorPreference(key: BoardScopeSelectionKey.self, value: .bounds) {
                        selection == tab ? $0 : nil
                    }
                    .accessibilityAddTraits(selection == tab ? .isSelected : [])
                    .accessibilityIdentifier("board.tab.\(tab.id)")
                }
            }
            .padding(.horizontal, 2)
            .backgroundPreferenceValue(BoardScopeSelectionKey.self) { anchor in
                GeometryReader { geometry in
                    Capsule().fill(DuduStyle.scopeTrack)
                        .frame(height: 32)
                        .overlay(alignment: .leading) {
                            if let anchor {
                                let bounds = geometry[anchor]
                                Capsule().fill(.white)
                                    .frame(width: bounds.width, height: 28)
                                    .shadow(color: .black.opacity(0.1), radius: 10, x: 3, y: 0)
                                    .offset(x: bounds.minX)
                            }
                        }
                        // Clip only the backing: the buttons above retain their full 44pt touch regions.
                        .clipShape(Capsule())
                        .frame(maxHeight: .infinity)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .animation(.snappy(duration: 0.3), value: selection)
            .accessibilityIdentifier("board.scope")
            Spacer(minLength: 0)
        }
        .padding(.leading, BoardHomeLayout.horizontalInset - 6)
        .padding(.trailing, BoardHomeLayout.horizontalInset)
        .padding(.bottom, 2)
    }
}

/// The tabs of the Collector (two) and of the tasks (four): a glass capsule, the chosen one in the sidebar's selected grey.
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
                        .foregroundStyle(selection == tab ? DuduStyle.ink : DuduStyle.muted)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background(selection == tab ? DuduStyle.selected : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selection == tab ? .isSelected : [])
                .accessibilityIdentifier("\(identifier).\(tab.id)")
            }
        }
        .padding(4)
        .frame(height: 44)
        .duduGlass(in: Capsule())
        .padding(.horizontal, DuduLayout.sidebarPadding)
        .padding(.bottom, 6)
    }
}

/// What an issue with no agent has where the agent's mark is: the desktop's dashed ring with a person in it.
struct BoardNoAgentMark: View {
    var body: some View {
        Circle()
            .strokeBorder(DuduStyle.muted.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [2.5, 2.5]))
            .overlay { DuduIcon(.stateUnassigned, size: 11, strokeWidth: 1.7).foregroundStyle(DuduStyle.muted) }
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
                    .foregroundStyle(DuduStyle.muted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(width: 50, alignment: .leading)
                    .padding(.trailing, 6)
                Text(issue.title)
                    .font(.system(size: 15, weight: .regular))
                    .foregroundStyle(DuduStyle.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Group {
                    if busy {
                        ProgressView().controlSize(.small).tint(DuduStyle.muted)
                    } else {
                        Text(relativeTime(issue.updatedAt))
                            .font(.system(size: 10))
                            .foregroundStyle(DuduStyle.muted)
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                    }
                }
                .frame(width: DuduLayout.actionColumnWidth, alignment: .center)
            }
            .frame(minHeight: 46)
            .padding(.leading, 10)
            .padding(.trailing, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(DuduRowButtonStyle())
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .accessibilityIdentifier("board.issue.\(issue.id)")
    }
}
