import SwiftUI

/// The conversation's task list, like the "任务" panel DSH keeps above its composer: folded to one line
/// (the counts of what is done, going on and waiting) until it is opened, then the items with a mark each.
struct TaskPanel: View {
    let todos: [TodoItem]
    @State private var isExpanded: Bool

    init(todos: [TodoItem]) {
        self.todos = todos
        // DSH keeps it folded until it is opened.
        var opened = false
        #if DEBUG && targetEnvironment(simulator)
        opened = ProcessInfo.processInfo.arguments.contains("-dsbot-review-tasks-open")
        #endif
        _isExpanded = State(initialValue: opened)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    DSBotChecklistGlyph(size: 16)
                        .foregroundStyle(DSBotStyle.chatSecondary)
                    Text("任务")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DSBotStyle.chatInk)
                    Text(TodoSummary.progress(todos))
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.chatTertiary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    // Folded, the panel opens upwards over the conversation: the chevron points that way.
                    DSBotIcon(isExpanded ? .down : .up, size: 14)
                        .foregroundStyle(DSBotStyle.chatTertiary)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("任务，\(TodoSummary.progress(todos))")
            .accessibilityHint(isExpanded ? "点按收起" : "点按展开")
            .accessibilityIdentifier("tasks.toggle")

            if isExpanded {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(todos.enumerated()), id: \.offset) { index, item in
                            row(item)
                                .accessibilityIdentifier("tasks.item.\(index)")
                        }
                    }
                    .padding(.bottom, 8)
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(maxHeight: 232)
            }
        }
        .background(DSBotStyle.chatPanel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(DSBotStyle.chatBorder, lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("tasks.panel")
    }

    private func row(_ item: TodoItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            TaskStateMark(item: item)
                .frame(width: 16, height: 22)
            Text(item.content)
                .font(.system(size: 14))
                .lineSpacing(2)
                .foregroundStyle(
                    item.isInProgress ? DSBotStyle.chatInk
                        : item.isCompleted ? DSBotStyle.chatTertiary : DSBotStyle.chatSecondary
                )
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(item.content)，\(item.isCompleted ? "已完成" : item.isInProgress ? "进行中" : "待处理")")
    }
}

/// Done, going on or waiting, in the marks DSH uses: a check, a ring that turns, a quiet dot.
private struct TaskStateMark: View {
    let item: TodoItem

    var body: some View {
        Group {
            if item.isCompleted {
                DSBotIcon(.check, size: 13)
                    .foregroundStyle(DSBotStyle.chatTertiary)
            } else if item.isInProgress {
                ProgressView()
                    .controlSize(.mini)
                    .tint(DSBotStyle.chatSecondary)
            } else {
                Circle()
                    .fill(Color(white: 0.8))
                    .frame(width: 6, height: 6)
            }
        }
        .accessibilityHidden(true)
    }
}
