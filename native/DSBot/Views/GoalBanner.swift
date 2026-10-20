import SwiftUI

/// The session's ongoing goal, docked above the composer like DSH's goal bar. The desktop's three
/// small icon buttons are hard to hit on a phone, so pause/resume, edit and clear sit behind one
/// "..." menu with a full-size target, and tapping the text expands a long objective.
struct GoalBanner: View {
    let goal: SessionGoal
    let isWorking: Bool
    let onPauseResume: () -> Void
    let onEdit: () -> Void
    let onClear: () -> Void
    @State private var expanded = false

    private var summary: Text {
        Text(goal.title).fontWeight(.semibold).foregroundColor(DSBotStyle.chatInk)
            + Text("  \(goal.objective)").foregroundColor(DSBotStyle.chatTertiary)
    }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    DSBotIcon(.goal, size: 16)
                        .foregroundStyle(goal.isPaused ? DSBotStyle.chatTertiary : DSBotStyle.chatSecondary)
                        .frame(height: 22)
                    summary
                        .font(.system(size: 14))
                        .lineLimit(expanded ? 12 : 1)
                        .truncationMode(.tail)
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.leading, 14)
                .padding(.vertical, 11)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(goal.title)，\(goal.objective)")
            .accessibilityIdentifier("goal.banner")

            Menu {
                Button {
                    onPauseResume()
                } label: {
                    Label(goal.isPaused ? "恢复目标" : "暂停目标", systemImage: goal.isPaused ? "play.circle" : "pause.circle")
                }
                .accessibilityIdentifier("goal.toggle")
                Button(action: onEdit) {
                    Label("编辑目标", systemImage: "square.and.pencil")
                }
                .accessibilityIdentifier("goal.edit")
                Button(role: .destructive, action: onClear) {
                    Label("清除目标", systemImage: "trash")
                }
                .accessibilityIdentifier("goal.clear")
            } label: {
                Group {
                    if isWorking {
                        ProgressView().controlSize(.small)
                    } else {
                        DSBotIcon(.options, size: 20)
                    }
                }
                .foregroundStyle(DSBotStyle.chatSecondary)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            // The menu's own icons take the ink, like every other icon.
            .tint(DSBotStyle.ink)
            .disabled(isWorking)
            .accessibilityLabel("目标操作")
            .accessibilityIdentifier("goal.menu")
        }
        .background(DSBotStyle.chatPanel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(DSBotStyle.chatBorder, lineWidth: 0.5))
    }
}
