import SwiftUI

struct QuickSheetMetrics: Equatable {
    var height: CGFloat = 188
    var allowsExpansion = false
}

struct QuickDetailNavigation {
    let back: () -> Void
    let close: () -> Void
}

/// A word button at the left of a centred page's bar, in the place the ✕ would take on the right: the list that is being chosen from has 取消 here and no ✕ (owner, 2026-11-18, the inbox redesign).
struct QuickSheetLeading {
    let title: String
    var isEnabled = true
    let action: () -> Void
}

/// Observe navigation even when the surrounding sidebar page keeps this state as an optional input.
struct QuickSheetNavigation<Content: View>: View {
    @ObservedObject var state: AssistantQuickSheetState
    @ViewBuilder var content: (AssistantQuickSheetState) -> Content

    var body: some View { content(state) }
}

struct QuickSheetMetricsKey: PreferenceKey {
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
    /// The title sits in the middle of the bar on every sheet (owner, 2026-11-18: "我们其他弹窗我看 title 都是在中间的", about the 收件箱 and 任务 sheets, whose left heading was only the activity sheet's old header, copied into the
    /// quick-entry designs of 2026-11-12). The count of a list goes beside it. A page with a back button is always centred; `false` is the old left heading (21pt), no sheet asks for it now.
    var centersTitle = false
    /// A word button on the left of a centred page (`QuickSheetLeading`); it has no ✕ then, `showsClose: false`.
    var leading: QuickSheetLeading? = nil
    var showsClose = true
    var active = true
    var allowsExpansion = false
    var scrollID: Binding<String?> = .constant(nil)
    var horizontalInset: CGFloat = 20
    @ViewBuilder var actions: () -> Actions
    @ViewBuilder var filters: () -> Filters
    @ViewBuilder var content: () -> Content
    @ViewBuilder var footer: () -> Footer
    @State private var contentHeight: CGFloat = 82
    @State private var filtersHeight: CGFloat = 0
    @State private var footerHeight: CGFloat = 0
    @State private var containerFrame = CGRect.zero
    @State private var contentFrame = CGRect.zero

    private var headerHeight: CGFloat {
        guard !containerFrame.isEmpty, !contentFrame.isEmpty else { return 82 }
        return max(0, contentFrame.minY - containerFrame.minY)
    }

    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                page(width: geometry.size.width)
            }
            .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { contentFrame = $0 }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if let onBack {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(action: onBack) {
                            Image(systemName: "chevron.left").font(.system(size: 18, weight: .medium))
                        }
                        .accessibilityLabel(L10n.text("返回"))
                    }
                } else if let leading {
                    ToolbarItem(placement: .topBarLeading) {
                        Button(leading.title, action: leading.action)
                            .disabled(!leading.isEnabled)
                    }
                } else if #available(iOS 26.0, *) {
                    ToolbarItem(placement: .topBarLeading) { heading }
                        .sharedBackgroundVisibility(.hidden)
                } else {
                    ToolbarItem(placement: .topBarLeading) { heading }
                }
                if onBack != nil || centersTitle {
                    ToolbarItem(placement: .principal) {
                        // The count of a list stays beside its title, now in the middle with it.
                        HStack(spacing: 6) {
                            Text(title).font(.system(size: 16, weight: .semibold))
                            if let count {
                                Text("\(count)").font(.system(size: 13)).foregroundStyle(DuduStyle.muted).monospacedDigit()
                            }
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(.isHeader)
                    }
                }
                if Actions.self != EmptyView.self {
                    ToolbarItemGroup(placement: .topBarTrailing) { actions() }
                    if showsClose {
                        if #available(iOS 26.0, *) {
                            ToolbarSpacer(.fixed, placement: .topBarTrailing)
                        }
                    }
                }
                if showsClose {
                    ToolbarItem(placement: .topBarTrailing) {
                        SheetCloseButton(label: closeLabel, action: onClose)
                    }
                }
            }
            .foregroundStyle(DuduStyle.ink)
        }
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { containerFrame = $0 }
        .preference(key: QuickSheetMetricsKey.self, value: active
            ? QuickSheetMetrics(height: headerHeight + filtersHeight + contentHeight + footerHeight, allowsExpansion: allowsExpansion)
            : nil)
    }

    @ViewBuilder
    private var heading: some View {
        if !centersTitle {
            HStack(spacing: 8) {
                Text(title).font(.system(size: 21, weight: .semibold)).accessibilityAddTraits(.isHeader)
                if let count {
                    Text("\(count)").font(.system(size: 14)).foregroundStyle(DuduStyle.muted).monospacedDigit()
                }
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    private func page(width: CGFloat) -> some View {
        VStack(spacing: 0) {
            filters()
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { filtersHeight = $0 }
            ScrollView {
                content()
                    // Measure height at the sheet's width; long Markdown must not enlarge the sheet.
                    .frame(width: max(0, width - 2 * horizontalInset), alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, horizontalInset)
                    .padding(.bottom, 24)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            }
            .scrollPosition(id: scrollID, anchor: .top)
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
#if DEBUG && targetEnvironment(simulator)
            .defaultScrollAnchor(reviewAtBottom ? .bottom : nil, for: .initialOffset)
            .defaultScrollAnchor(reviewAtBottom ? .bottom : nil, for: .sizeChanges)
#endif
        }
        .modifier(SheetFooter {
            VStack(spacing: 0) { footer() }
                .fixedSize(horizontal: false, vertical: true)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { footerHeight = $0 }
        })
        .frame(width: width, alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(DuduStyle.sheet)
    }

#if DEBUG && targetEnvironment(simulator)
    private var reviewAtBottom: Bool {
        ProcessInfo.processInfo.arguments.contains("-dudu-ui-review")
            && ProcessInfo.processInfo.arguments.contains("-dudu-review-sheet-bottom")
    }
#endif
}

/// Fits the actual content, excluding the safe area that UIKit adds to a height detent.
struct AssistantQuickSheet: View {
    @ObservedObject var state: AssistantQuickSheetState
    @ObservedObject var store: DuduStore
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
    @Binding var toast: DuduToastMessage?

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
            DuduToastOverlay(message: toast) { message in
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
        .presentationBackground(DuduStyle.sheet)
        .background(SheetOutsideTapDismiss { dismiss() })
    }
}
