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
    var onOverlayHeightChange: (CGFloat) -> Void = { _ in }
    @State private var expanded = false
    @State private var panelHeight: CGFloat = 44

    private var summary: Text {
        Text(goal.title).fontWeight(.semibold).foregroundColor(DSBotStyle.chatInk)
            + Text("  \(goal.objective)").foregroundColor(DSBotStyle.chatTertiary)
    }

    var body: some View {
        Color.clear
            .frame(height: 44)
            .overlay(alignment: .bottom) {
                panel
                    .fixedSize(horizontal: false, vertical: true)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { panelHeight = $0 }
            }
            .onChange(of: overlayHeight, initial: true) { _, height in
                onOverlayHeightChange(height)
            }
            .onDisappear { onOverlayHeightChange(0) }
    }

    private var overlayHeight: CGFloat {
        expanded ? max(0, panelHeight - 44) : 0
    }

    private var panel: some View {
        HStack(alignment: .top, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    DSBotIcon(.goal, size: 16, scalesStroke: true)
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

struct GoalEditorSheet: View {
    let isSaving: Bool
    let error: String?
    let onSave: (String) -> Void
    let onClose: () -> Void
    @State private var objective: String
    @FocusState private var isFocused: Bool

    init(objective: String, isSaving: Bool, error: String?, onSave: @escaping (String) -> Void, onClose: @escaping () -> Void) {
        self.isSaving = isSaving
        self.error = error
        self.onSave = onSave
        self.onClose = onClose
        _objective = State(initialValue: objective)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                TextEditor(text: $objective)
                    .font(.system(size: 16))
                    .foregroundStyle(DSBotStyle.chatInk)
                    .scrollContentBackground(.hidden)
                    .padding(12)
                    .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .focused($isFocused)
                    .disabled(isSaving)
                    .accessibilityLabel("目标")
                    .accessibilityIdentifier("goal.editor.text")
                if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.chatError)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(20)
            .background(DSBotStyle.canvas)
            .navigationTitle("编辑")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消", action: onClose)
                        .disabled(isSaving)
                        .accessibilityIdentifier("goal.editor.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        onSave(objective)
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("保存")
                        }
                    }
                    .disabled(isSaving || objective.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel("保存")
                    .accessibilityIdentifier("goal.editor.save")
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
        .onAppear { isFocused = true }
    }
}
