import SwiftUI

/// The conversation's task list, like the "任务" panel DSH keeps above its composer: folded to one line
/// (the counts of what is done, going on and waiting) until it is opened, then the items with a mark each.
struct TaskPanel: View {
    let todos: [TodoItem]
    let onOverlayHeightChange: (CGFloat) -> Void
    @State private var isExpanded: Bool
    @State private var contentHeight: CGFloat = 0

    init(todos: [TodoItem], onOverlayHeightChange: @escaping (CGFloat) -> Void = { _ in }) {
        self.todos = todos
        self.onOverlayHeightChange = onOverlayHeightChange
        // DSH keeps it folded until it is opened.
        var opened = false
        #if DEBUG && targetEnvironment(simulator)
        opened = ProcessInfo.processInfo.arguments.contains("-dudu-review-tasks-open")
        #endif
        _isExpanded = State(initialValue: opened)
    }

    var body: some View {
        Color.clear
            .frame(height: 44)
            .overlay(alignment: .bottom) {
                panel
                    .fixedSize(horizontal: false, vertical: true)
                    .background { DuduPanelBackdrop() }
            }
            .onChange(of: overlayHeight, initial: true) { _, height in
                onOverlayHeightChange(height)
            }
            .onDisappear { onOverlayHeightChange(0) }
    }

    private var overlayHeight: CGFloat {
        isExpanded ? min(232, contentHeight) : 0
    }

    private var panel: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    DuduChecklistGlyph(size: 16)
                        .foregroundStyle(DuduStyle.chatSecondary)
                    Text(L10n.text("任务"))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(DuduStyle.chatInk)
                    Text(TodoSummary.progress(todos))
                        .font(.system(size: 13))
                        .foregroundStyle(DuduStyle.chatTertiary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    DuduIcon(.options, size: 20)
                        .foregroundStyle(DuduStyle.chatTertiary)
                }
                .padding(.horizontal, 14)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L10n.text("任务，{0}", "\(TodoSummary.progress(todos))"))
            .accessibilityHint(isExpanded ? L10n.text("点按收起") : L10n.text("点按展开"))
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
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
                }
                .scrollBounceBehavior(.basedOnSize)
                .frame(height: min(232, contentHeight))
                .accessibilityIdentifier("tasks.list")
            }
        }
        .background(DuduStyle.chatPanel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(DuduStyle.chatBorder, lineWidth: 0.5)
                .allowsHitTesting(false)
        }
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
                .foregroundStyle(DuduStyle.chatSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 5)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.text("{0}，{1}", "\(item.content)", "\(item.isCompleted ? L10n.text("已完成") : item.isInProgress ? L10n.text("进行中") : L10n.text("待处理"))"))
    }
}

private struct TaskStateMark: View {
    let item: TodoItem

    var body: some View {
        Group {
            if item.isCompleted {
                Circle()
                    .fill(Color(red: 0x22 / 255, green: 0xc5 / 255, blue: 0x5e / 255))
                    .frame(width: 6, height: 6)
            } else if item.isInProgress {
                TaskActivityRing()
            } else {
                Circle()
                    .fill(Color(white: 0xd4 / 255))
                    .frame(width: 6, height: 6)
            }
        }
        .accessibilityHidden(true)
    }
}

private struct TaskActivityRing: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationIsCovered) private var isCovered

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion || isCovered)) { timeline in
            let phase = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                .truncatingRemainder(dividingBy: 1.5) / 1.5
            let breath = reduceMotion ? 0.5 : (1 - cos(phase * 2 * .pi)) / 2
            let circumference = 2 * .pi * 9.5
            ZStack {
                Circle()
                    .stroke(DuduStyle.chatTertiary.opacity(0.25), lineWidth: 14.0 / 12)
                Circle()
                    .trim(from: 0, to: (12 + 12 * breath) / circumference)
                    .stroke(DuduStyle.chatTertiary, style: StrokeStyle(lineWidth: 14.0 / 12, lineCap: .round))
                    .rotationEffect(.degrees(phase * 360 - 6 * breath / circumference * 360))
            }
            .padding(14.0 * 2.5 / 24)
            .frame(width: 14, height: 14)
        }
    }
}
