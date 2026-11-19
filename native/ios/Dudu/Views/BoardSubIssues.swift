import SwiftUI

/// The approved A: Desktop's existing static progress ring and a muted count, without a capsule.
struct BoardSubIssueProgressLabel: View {
    let progress: BoardSubIssueProgress
    private let indigo = Color(red: 94 / 255, green: 106 / 255, blue: 210 / 255)

    var body: some View {
        HStack(spacing: 6) {
            ZStack {
                Circle().strokeBorder(Color(white: 222 / 255), lineWidth: 2)
                Circle().inset(by: 1)
                    .trim(from: 0, to: progress.total > 0 ? min(1, max(0, Double(progress.done) / Double(progress.total))) : 0)
                    .stroke(indigo, style: StrokeStyle(lineWidth: 2, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
            }
            .frame(width: 14, height: 14)
            Text("\(progress.done)/\(progress.total)")
                .font(.system(size: 12))
                .monospacedDigit()
                .foregroundStyle(DuduStyle.muted)
        }
        .fixedSize()
        .accessibilityHidden(true)
    }
}

struct BoardSubIssueProgressButton: View {
    let progress: BoardSubIssueProgress
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            BoardSubIssueProgressLabel(progress: progress)
                // Keep the former capsule's full horizontal padding and a 44pt touch height.
                .padding(.horizontal, 8)
                .frame(height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(L10n.text("子事项"))
        .accessibilityValue("\(progress.done)/\(progress.total)")
        .accessibilityIdentifier("board.subissues")
    }
}

/// Give the child's own title priority, keeping a short parent at its intrinsic width.
struct BoardConversationTitle: View {
    let title: String
    let parent: BoardIssueParent?

    var body: some View {
        if let parent {
            BoardParentTitleLayout {
                Text(parent.title).foregroundStyle(DuduStyle.muted).lineLimit(1)
                Text("#").foregroundStyle(DuduStyle.muted).lineLimit(1)
                Text(title).foregroundStyle(DuduStyle.ink).lineLimit(1)
            }
            .accessibilityElement(children: .combine)
        } else {
            Text(title).lineLimit(1)
        }
    }
}

private struct BoardParentTitleLayout: Layout {
    private func widths(_ available: CGFloat?, _ views: Subviews) -> [CGFloat] {
        guard views.count == 3 else { return [] }
        let parent = views[0].sizeThatFits(.unspecified).width
        let separator = views[1].sizeThatFits(.unspecified).width
        let child = views[2].sizeThatFits(.unspecified).width
        let width = available ?? (min(parent, 128) + separator + child)
        let childWidth = min(child, max(0, width - min(parent, 48) - separator))
        let parentWidth = min(parent, 128, max(0, width - childWidth - separator))
        return [parentWidth, separator, childWidth]
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let assigned = widths(proposal.width, subviews)
        let height = zip(subviews, assigned).map { view, width in
            view.sizeThatFits(.init(width: width, height: proposal.height)).height
        }.max() ?? 0
        return CGSize(width: assigned.reduce(0, +), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let assigned = widths(bounds.width, subviews)
        var x = bounds.minX
        for (view, width) in zip(subviews, assigned) {
            view.place(at: CGPoint(x: x, y: bounds.midY), anchor: .leading,
                       proposal: .init(width: width, height: bounds.height))
            x += width
        }
    }
}

/// One ordinary issue.get, read only after opening. No duplicate parent caption or progress row.
struct BoardSubIssuesSheet: View {
    let issue: BoardIssue
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DuduStore
    let onOpen: (BoardIssue) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var children: [BoardIssue]?
    @State private var failed = false
    private let computerID: String?

    init(issue: BoardIssue, board: BoardModel, store: DuduStore, onOpen: @escaping (BoardIssue) -> Void) {
        self.issue = issue
        self.board = board
        self.store = store
        self.onOpen = onOpen
        computerID = store.activeComputer?.id
    }

    private var sheetHeight: CGFloat {
        let count = children?.count ?? issue.subIssues?.total ?? 0
        return min(600, max(170, 114 + CGFloat(count) * 56))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                Group {
                    if let children {
                        VStack(spacing: 0) {
                            ForEach(children) { child in
                                Button { onOpen(child) } label: { childRow(child) }
                                    .buttonStyle(DuduRowButtonStyle())
                            }
                        }
                        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    } else if failed {
                        VStack(spacing: 14) {
                            Text(L10n.text("事项没能加载")).font(.system(size: 14)).foregroundStyle(DuduStyle.muted)
                            Button(L10n.text("重试")) { Task { await read() } }
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 24)
                    } else {
                        ProgressView().tint(DuduStyle.muted)
                            .frame(maxWidth: .infinity).padding(.vertical, 32)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(DuduStyle.sheet)
            .navigationTitle(L10n.text("子事项"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    SheetCloseButton { dismiss() }
                }
            }
        }
        .presentationDetents([.height(sheetHeight), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(DuduStyle.sheet)
        .background(SheetOutsideTapDismiss { dismiss() })
        .task(id: store.connectionRevision) { await read() }
        .onChange(of: store.activeComputer?.id) { _, id in if id != computerID { dismiss() } }
    }

    private func childRow(_ child: BoardIssue) -> some View {
        HStack(spacing: 12) {
            IssueStatusIcon(type: child.statusType).frame(width: 16, height: 16)
            VStack(alignment: .leading, spacing: 4) {
                Text(child.title).font(.system(size: 15)).foregroundStyle(DuduStyle.ink).lineLimit(1)
                Text(child.reference).font(.system(size: 12)).foregroundStyle(DuduStyle.muted).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            DuduIcon(.right, size: 16).foregroundStyle(DuduStyle.muted).accessibilityHidden(true)
        }
        .padding(.horizontal, 16)
        .frame(height: 56)
        .contentShape(Rectangle())
    }

    private func read() async {
        failed = false
        guard computerID == store.activeComputer?.id else { return }
        let connection = store.connectionRevision
        let full = await board.detail(of: issue, using: store)
        guard !Task.isCancelled, computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
        children = full?.children
        failed = children == nil
    }
}
