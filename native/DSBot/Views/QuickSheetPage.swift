import SwiftUI

struct QuickSheetMetrics: Equatable {
    var height: CGFloat = 188
    var allowsExpansion = false
}

struct QuickDetailNavigation {
    let back: () -> Void
    let close: () -> Void
}

/// Observe navigation even when the surrounding sidebar page keeps this state as an optional input.
struct QuickSheetNavigation<Content: View>: View {
    @ObservedObject var state: AssistantQuickSheetState
    @ViewBuilder var content: (AssistantQuickSheetState) -> Content

    var body: some View { content(state) }
}

private struct QuickSheetMetricsKey: PreferenceKey {
    static let defaultValue: QuickSheetMetrics? = nil
    static func reduce(value: inout QuickSheetMetrics?, nextValue: () -> QuickSheetMetrics?) {
        if let next = nextValue() { value = next }
    }
}

/// The approved activity-sheet chrome. Only the outer message/list scrolls.
struct QuickSheetPage<Actions: View, Filters: View, Content: View, Footer: View>: View {
    let title: String
    var count: Int? = nil
    var onBack: (() -> Void)? = nil
    let onClose: () -> Void
    var closeLabel = L10n.text("关闭")
    var active = true
    var allowsExpansion = false
    var scrollID: Binding<String?> = .constant(nil)
    @ViewBuilder var actions: () -> Actions
    @ViewBuilder var filters: () -> Filters
    @ViewBuilder var content: () -> Content
    @ViewBuilder var footer: () -> Footer
    @State private var contentHeight: CGFloat = 82
    @State private var filtersHeight: CGFloat = 0
    @State private var footerHeight: CGFloat = 0

    var body: some View {
        GeometryReader { geometry in
            page(width: geometry.size.width)
        }
    }

    private func page(width: CGFloat) -> some View {
        VStack(spacing: 0) {
            header
                .padding(.horizontal, 24)
                .padding(.top, 22)
                .padding(.bottom, 16)
            filters()
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { filtersHeight = $0 }
            ScrollView {
                content()
                    // Measure height at the sheet's width; long Markdown must not enlarge the sheet.
                    .frame(width: max(0, width - 40), alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 24)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollPosition(id: scrollID, anchor: .top)
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
            footer()
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { footerHeight = $0 }
        }
        .frame(width: width, alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(DSBotStyle.sheet)
        .preference(key: QuickSheetMetricsKey.self, value: active
            ? QuickSheetMetrics(height: 82 + filtersHeight + contentHeight + footerHeight, allowsExpansion: allowsExpansion)
            : nil)
    }

    private var header: some View {
        HStack(spacing: 8) {
            if let onBack {
                Button(action: onBack) {
                    DSBotIcon(.back, size: 21)
                        .frame(width: 28, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DSBotQuietPressStyle())
                .accessibilityLabel(L10n.text("返回"))
                Spacer(minLength: 0)
            } else {
                Text(title)
                    .font(.system(size: 21, weight: .semibold))
                    .accessibilityAddTraits(.isHeader)
                if let count {
                    Text("\(count)").font(.system(size: 14)).foregroundStyle(DSBotStyle.muted).monospacedDigit()
                }
                Spacer(minLength: 8)
            }
            actions()
            Button(action: onClose) {
                DSBotIcon(.close, size: 12)
                    .foregroundStyle(DSBotStyle.chatSecondary)
                    .frame(width: 28, height: 28)
                    .background(DSBotStyle.selected, in: Circle())
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(DSBotQuietPressStyle())
            .padding(.trailing, -8)
            .accessibilityLabel(closeLabel)
        }
        .foregroundStyle(DSBotStyle.ink)
        .frame(height: 44)
        .overlay {
            if onBack != nil {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DSBotStyle.ink)
                    .accessibilityAddTraits(.isHeader)
                    .allowsHitTesting(false)
            }
        }
    }
}

/// Fits the actual content, excluding the safe area that UIKit adds to a height detent.
struct AssistantQuickSheet: View {
    @ObservedObject var state: AssistantQuickSheetState
    @ObservedObject var store: DSBotStore
    @ObservedObject var board: BoardModel
    @ObservedObject var collector: CollectorModel
    @ObservedObject var tasks: TasksModel
    let maximumHeight: CGFloat
    let onOpenIssue: (BoardIssue) -> Void
    let onOpenIssueID: (Int) -> Void
    let onOpenSession: (String) -> Void
    let onReply: (GroupIssue) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var metrics = QuickSheetMetrics()
    @State private var selection: PresentationDetent = .height(188)
    @Binding var toast: DSBotToastMessage?

    private var fitted: PresentationDetent { .height(min(metrics.height, maximumHeight)) }
    private var detents: Set<PresentationDetent> {
        metrics.allowsExpansion ? [fitted, .large] : [fitted]
    }

    var body: some View {
        Group {
            switch state.kind {
            case .todo:
                AssistantTodoSheet(
                    state: state, model: state.todos, store: store,
                    onClose: { dismiss() }, onReply: onReply, onOpenIssue: onOpenIssue
                )
            case .info:
                CollectorView(model: collector, board: board, store: store, topInset: 0, onOpenIssue: onOpenIssueID, quickSheet: state)
            case .task:
                TasksView(model: tasks, store: store, topInset: 0, onOpenSession: onOpenSession, quickSheet: state)
            }
        }
        .overlay(alignment: .top) {
            DSBotToastOverlay(message: toast) { message in
                if toast?.id == message.id { toast = nil }
            }
            .padding(.horizontal, 24)
            .padding(.top, 70)
        }
        .onAppear {
            selection = fitted
        }
        .onPreferenceChange(QuickSheetMetricsKey.self) { value in
            guard let value, value != metrics else { return }
            let wasExpanded = metrics.allowsExpansion && selection == .large
            metrics = value
            if !wasExpanded || !value.allowsExpansion { selection = .height(min(value.height, maximumHeight)) }
        }
        .presentationDetents(detents, selection: $selection)
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(DSBotStyle.sheet)
        .background(SheetOutsideTapDismiss { dismiss() })
    }
}
