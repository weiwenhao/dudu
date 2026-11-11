import SwiftUI

// The quick buttons above the input of 嘟嘟's chat and the cards they send (owner, 2026-11-10; the approved design is `.local/designs/quick-chips-2026-11-09/`, the model `Core/QuickCards.swift`).
// A button is Doubao's rounded rectangle (the owner's reference: radius a fifth of the height, white, a thin edge, no shadow) at the context chips' height. A card is the conversation's
// own: white, rounded, a title row that stays, and the rows of the board and the Collector underneath. Only the rows of a todo card open something.

private struct OpenQuickCardIssueKey: EnvironmentKey {
    static let defaultValue: (BoardIssue) -> Void = { _ in }
}

extension EnvironmentValues {
    /// What a row of a todo card does when it is tapped: the root opens that issue, as a row of the board does.
    var openQuickCardIssue: (BoardIssue) -> Void {
        get { self[OpenQuickCardIssueKey.self] }
        set { self[OpenQuickCardIssueKey.self] = newValue }
    }
}

// MARK: - Buttons

/// The row of buttons above the input. The one whose card is on its way shows a spinner, and nothing else can be tapped meanwhile.
struct QuickChipsRow: View {
    let busy: QuickCardKind?
    /// 待办: 嘟嘟 sends the card.
    let onPick: (QuickCardKind) -> Void
    /// 信息 and 定时任务: their pages open (owner, 2026-11-10); they carry the small › that says so.
    let onOpen: (QuickCardKind) -> Void

    var body: some View {
        // The glass of the box and the queue bar, as one group (owner, 2026-11-10: "用这种吧", the blurred one: the white buttons looked pasted on beside the glass box).
        DSBotGlassGroup(spacing: 8) {
            HStack(spacing: 8) {
                ForEach(QuickCardKind.allCases) { kind in
                    Button { kind == .todo ? onPick(kind) : onOpen(kind) } label: {
                        QuickChipLabel(kind: kind, isBusy: busy == kind)
                    }
                    .buttonStyle(DSBotQuietPressStyle())
                    .disabled(busy != nil)
                    .opacity(busy != nil && busy != kind ? 0.5 : 1)
                    .accessibilityLabel(kind.title)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityIdentifier("quick.chip.\(kind.rawValue)")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("quick.chips")
    }
}

private struct QuickChipLabel: View {
    let kind: QuickCardKind
    let isBusy: Bool

    private static let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)

    var body: some View {
        HStack(spacing: 6) {
            if isBusy {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.75)
                    .tint(DSBotStyle.ink)
                    .frame(width: 15, height: 15)
            } else {
                DSBotIcon(kind.glyph, size: 15, strokeWidth: 1.8, scalesStroke: true)
            }
            Text(kind.title)
                .font(.system(size: 14, weight: .medium))
                .lineLimit(1)
            if kind != .todo {
                DSBotIcon(.right, size: 14, scalesStroke: true)
                    .foregroundStyle(Color(red: 0x9a / 255, green: 0x9d / 255, blue: 0xa3 / 255))
                    .padding(.leading, -2)
            }
        }
        .foregroundStyle(DSBotStyle.ink)
        .padding(.leading, 11)
        .padding(.trailing, kind == .todo ? 11 : 8)
        .frame(height: 32)
        .dsbotGlass(in: Self.shape)
        .contentShape(Self.shape)
    }
}

// MARK: - Card

struct QuickCardView: View {
    let card: QuickCard
    /// The sequence number of the command's event: what 删除 in the long-press menu hides.
    var seq: Double? = nil

    @Environment(\.openQuickCardIssue) private var openIssue
    /// What the rows measure, to know whether they overflow the cap of the cards that have one.
    @State private var rowsContentHeight: CGFloat = 0

    private static let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
    private static let headerHeight: CGFloat = 46
    private static let rowsBottomPadding: CGFloat = 4
    /// The rows of information and tasks show whole up to this height, which is seven and a half rows; past it they scroll under the title, and the cut row says there are more.
    private static let rowsCap: CGFloat = 7.5 * 46 + rowsBottomPadding

    var body: some View {
        VStack(spacing: 0) {
            header
            if card.rowCount > 0 {
                Rectangle().fill(Color.black.opacity(0.06)).frame(height: 0.5)
                rows
            }
        }
        .frame(maxWidth: .infinity)
        .background(Color.white, in: Self.shape)
        .clipShape(Self.shape)
        .overlay(Self.shape.strokeBorder(Color.black.opacity(0.08), lineWidth: 0.75))
        .messageActions(text: "", seq: seq)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(card.kind.title)
        .accessibilityIdentifier("quick.card.\(card.kind.rawValue)")
        #if DEBUG && targetEnvironment(simulator)
        // `-dsbot-review-tap-card-issue`: the review's stand-in for a finger on the first row of a todo card that has a conversation (the row's closure, through the root).
        .task {
            guard card.kind == .todo, ProcessInfo.processInfo.arguments.contains("-dsbot-review-tap-card-issue"),
                  let issue = card.issues.first(where: { $0.sessionId != nil }) else { return }
            try? await Task.sleep(nanoseconds: 2_500_000_000)
            openIssue(issue)
        }
        #endif
    }

    /// The title and how many the list had; an empty list leaves the title and says so on its right, in the grey the board and the Collector use when they are empty.
    private var header: some View {
        HStack(spacing: 8) {
            DSBotIcon(card.kind.glyph, size: 18, strokeWidth: 1.8, scalesStroke: true)
                .foregroundStyle(DSBotStyle.chatSecondary)
            Text(card.kind.title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(DSBotStyle.ink)
            if card.rowCount > 0 {
                Text("\(card.total)")
                    .font(.system(size: 13))
                    .monospacedDigit()
                    .foregroundStyle(DSBotStyle.muted)
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 8)
                Text(card.kind.emptyText)
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: Self.headerHeight)
    }

    /// The height the rows allow. A todo card has no cap: its rows are as tall as they are (two lines of the latest message, and one of them may be open), and the conversation scrolls, not a list inside it (owner, 2026-11-10:
    /// "APP 端展开了之后也无法下拉"). The cards of information and tasks, which are only in older threads now, keep theirs.
    private var rowsCap: CGFloat? { card.kind == .todo ? nil : Self.rowsCap }

    /// The height follows what the rows measure up to the cap, and the rows scroll under the title only when they are more than it. (The todo rows were taken for 46 pt each, so a card of three was 142 pt high with its scrolling
    /// off: the second line of each row and an open row were cut off and could not be reached.)
    private var rows: some View {
        let overflows = rowsCap.map { rowsContentHeight > $0 + 0.5 } ?? false
        return ScrollView {
            VStack(spacing: 0) {
                switch card.kind {
                case .todo:
                    QuickTodoList(issues: card.issues)
                case .info:
                    ForEach(card.records) { record in
                        CollectorRow(record: record, tab: .todo, selecting: false, selected: false)
                    }
                case .task:
                    ForEach(card.tasks) { QuickCardTaskRow(task: $0) }
                }
            }
            .padding(.bottom, Self.rowsBottomPadding)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { rowsContentHeight = $0 }
        }
        .scrollDisabled(!overflows)
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxHeight: rowsCap ?? .infinity)
    }
}

extension QuickCardKind {
    /// The desktop's icons for the three (`ListTodo`, `Inbox`, `Clock`).
    var glyph: DSBotGlyph {
        switch self {
        case .todo: return .listTodo
        case .info: return .inbox
        case .task: return .schedule
        }
    }
}

/// A scheduled task: the agent that runs it, its name, its rule and when it runs next, and whether it is on. Read only; the tasks page draws the same row (`TaskSummaryRow`).
private struct QuickCardTaskRow: View {
    let task: QuickCardTask

    var body: some View {
        TaskSummaryRow(agent: task.taskAgent, title: task.title, line: task.line, statusText: task.statusText, isOn: !task.isPaused)
    }
}
