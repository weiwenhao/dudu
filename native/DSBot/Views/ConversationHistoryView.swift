import SwiftUI
import UIKit

enum ConversationHistoryItem: Identifiable, Equatable {
    case transcript(TranscriptRow, Double?)
    case running(turnID: String, startedAt: Double?)
    case message(ChatMessage)
    case controls(hasEarlier: Bool, isLoading: Bool, failure: String?)
    case approval(Approval, isResponding: Bool)
    case questions(ConversationQuestions)

    var id: String {
        switch self {
        case let .transcript(row, _): return "transcript:\(row.id)"
        case let .running(turnID, _): return "running:\(turnID)"
        case let .message(message): return "message:\(message.id)"
        case .controls: return "history.controls"
        case let .approval(approval, _): return "approval:\(approval.id)"
        case let .questions(questions): return "questions:\(questions.id)"
        }
    }
}

@MainActor
protocol ConversationHistoryScrolling: AnyObject {
    func scrollToLatest(animated: Bool)
}

@MainActor
final class ConversationHistoryController {
    weak var viewport: (any ConversationHistoryScrolling)?

    func scrollToLatest(animated: Bool = false) {
        viewport?.scrollToLatest(animated: animated)
    }
}

struct ConversationHistoryView<Content: View>: UIViewRepresentable {
    let items: [ConversationHistoryItem]
    let target: DraftTarget?
    let topInset: CGFloat
    let bottomInset: CGFloat
    let canLoadAttachments: Bool
    let keyboardVisible: Bool
    let isCovered: Bool
    let controller: ConversationHistoryController
    @Binding var followsLatest: Bool
    @ViewBuilder let content: (ConversationHistoryItem) -> Content

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> ConversationTableView {
        let table = ConversationTableView(frame: .zero, style: .plain)
        table.backgroundColor = UIColor(DSBotStyle.canvas)
        table.separatorStyle = .none
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = 120
        table.estimatedSectionHeaderHeight = 0
        table.estimatedSectionFooterHeight = 0
        table.sectionHeaderTopPadding = 0
        table.contentInsetAdjustmentBehavior = .never
        table.automaticallyAdjustsScrollIndicatorInsets = false
        table.insetsContentViewsToSafeArea = false
        table.keyboardDismissMode = .interactive
        table.alwaysBounceVertical = true
        table.selfSizingInvalidation = .enabledIncludingConstraints
        table.accessibilityIdentifier = "chat.history"
        context.coordinator.attach(to: table)
        return table
    }

    func updateUIView(_ table: ConversationTableView, context: Context) {
        context.coordinator.update(self)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: ConversationTableView, context: Context) -> CGSize? {
        guard let width = proposal.width, let height = proposal.height else { return nil }
        return CGSize(width: width, height: height)
    }

    static func dismantleUIView(_ table: ConversationTableView, coordinator: Coordinator) {
        coordinator.detach()
        table.delegate = nil
        table.onLayout = nil
    }

    final class Coordinator: NSObject, UITableViewDelegate, ConversationHistoryScrolling {
        private var parent: ConversationHistoryView
        private weak var table: ConversationTableView?
        private var dataSource: UITableViewDiffableDataSource<Int, String>?
        private var values: [String: ConversationHistoryItem] = [:]
        private var identifiers: [String] = []
        private var heights: [String: CGFloat] = [:]
        private var hasTarget = false
        private var target: DraftTarget?
        private var following = true
        private var dragging = false
        private var dragKeepsLatest = false
        private var keyboardTransitioning = false
        private var keyboardDismissedAt = -Double.greatestFiniteMagnitude
        private var scrollScheduled = false
        private var aligning = false
        private var detached = false
        private var observers: [NSObjectProtocol] = []
        private var pendingDiagnostic: String?
        private var readingAnchor: (id: String, top: CGFloat)?
        private var restoringReadingAnchor = false
        private var needsInitialPosition = true

        init(_ parent: ConversationHistoryView) {
            self.parent = parent
            super.init()
        }

        func attach(to table: ConversationTableView) {
            self.table = table
            table.delegate = self
            table.register(ConversationTableCell.self, forCellReuseIdentifier: "message")
            dataSource = UITableViewDiffableDataSource<Int, String>(tableView: table) {
                [weak self] table, indexPath, identifier in
                guard let self, let item = self.values[identifier] else { return nil }
                let cell = table.dequeueReusableCell(withIdentifier: "message", for: indexPath)
                (cell as? ConversationTableCell)?.itemID = identifier
                cell.accessibilityIdentifier = identifier
                cell.backgroundColor = .clear
                cell.selectionStyle = .none
                cell.contentConfiguration = UIHostingConfiguration {
                    self.parent.content(item)
                        .disclosureGroupStyle(ConversationHistoryDisclosureStyle())
                        .frame(maxWidth: 728, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 7)
                        .id(self.parent.target)
                        .id(item.id)
                }
                .margins(.all, 0)
                return cell
            }
            table.onLayout = { [weak self] in
                guard let self else { return }
                self.cacheVisibleHeights()
                if !self.keyboardTransitioning { self.restoreReadingAnchor() }
                self.alignLatest(layoutImmediately: false)
            }
            parent.controller.viewport = self
            let center = NotificationCenter.default
            observers = [
                center.addObserver(
                    forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main
                ) { [weak self] _ in
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        if !self.following && !self.dragging { self.captureReadingAnchor() }
                        self.keyboardTransitioning = true
                    }
                },
                center.addObserver(
                    forName: UIResponder.keyboardDidChangeFrameNotification, object: nil, queue: .main
                ) { [weak self] note in
                    MainActor.assumeIsolated {
                        guard let self else { return }
                        self.keyboardTransitioning = false
                        self.restoreReadingAnchor()
                        if let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
                           !KeyboardAvoidance.isVisible(endFrameMinY: end.minY, screenHeight: DSBotLayout.screenHeight) {
                            self.keyboardDismissedAt = ProcessInfo.processInfo.systemUptime
                        }
                        self.scheduleLatest()
                    }
                }
            ]
        }

        func detach() {
            detached = true
            observers.forEach(NotificationCenter.default.removeObserver)
            observers = []
            if parent.controller.viewport === self { parent.controller.viewport = nil }
        }

        func update(_ parent: ConversationHistoryView) {
            let targetChanged = !hasTarget || target != parent.target
            let refreshContent = self.parent.canLoadAttachments != parent.canLoadAttachments ||
                self.parent.isCovered != parent.isCovered
            let returning = self.parent.isCovered && !parent.isCovered
            self.parent = parent
            guard let table, let dataSource else { return }
            if targetChanged {
                hasTarget = true
                target = parent.target
                following = true
                dragging = false
                readingAnchor = nil
                heights = [:]
                pendingDiagnostic = "chat.startup"
                needsInitialPosition = true
            } else {
                following = parent.followsLatest
            }
            if returning { pendingDiagnostic = "chat.resume" }
            let nextIdentifiers = parent.items.map(\.id)
            let nextValues = Dictionary(uniqueKeysWithValues: parent.items.map { ($0.id, $0) })
            let changed = nextIdentifiers.filter { refreshContent || values[$0] != nextValues[$0] }
            let structureChanged = identifiers != nextIdentifiers
            if structureChanged && !following && !dragging { captureReadingAnchor() }
            values = nextValues
            identifiers = nextIdentifiers
            let inset = UIEdgeInsets(top: parent.topInset, left: 0, bottom: parent.bottomInset, right: 0)
            if table.contentInset != inset {
                if !following && !dragging { captureReadingAnchor() }
                table.contentInset = inset
                table.verticalScrollIndicatorInsets = inset
                if !keyboardTransitioning { restoreReadingAnchor() }
            }
            if targetChanged || structureChanged || !changed.isEmpty {
                var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
                snapshot.appendSections([0])
                snapshot.appendItems(nextIdentifiers)
                let existing = Set(dataSource.snapshot().itemIdentifiers)
                if !targetChanged { snapshot.reconfigureItems(changed.filter { existing.contains($0) }) }
                UIView.performWithoutAnimation {
                    if targetChanged {
                        dataSource.applySnapshotUsingReloadData(snapshot) { [weak self] in
                            self?.restoreReadingAnchor()
                            self?.scheduleLatest()
                        }
                    } else {
                        dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
                            self?.restoreReadingAnchor()
                            self?.scheduleLatest()
                        }
                    }
                }
            }
            scheduleLatest()
        }

        private func captureReadingAnchor() {
            guard readingAnchor == nil, let table else { return }
            let visibleTop = table.bounds.minY + table.adjustedContentInset.top
            let visibleBottom = table.bounds.maxY - table.adjustedContentInset.bottom
            let candidates = (table.indexPathsForVisibleRows ?? []).sorted().filter {
                dataSource?.itemIdentifier(for: $0) != "history.controls" &&
                table.rectForRow(at: $0).maxY > visibleTop &&
                table.rectForRow(at: $0).minY < visibleBottom
            }
            guard let index = candidates.first(where: { table.rectForRow(at: $0).minY >= visibleTop }) ?? candidates.first,
                  let id = dataSource?.itemIdentifier(for: index) else { return }
            readingAnchor = (
                id, table.convert(CGPoint(x: 0, y: table.rectForRow(at: index).minY), to: table.window).y
            )
        }

        private func restoreReadingAnchor() {
            guard !restoringReadingAnchor, !following, !dragging, !keyboardTransitioning,
                  let anchor = readingAnchor, let table,
                  let index = dataSource?.indexPath(for: anchor.id) else { return }
            restoringReadingAnchor = true
            defer { restoringReadingAnchor = false }
            table.layoutIfNeeded()
            let visibleTop = table.convert(
                CGPoint(x: 0, y: table.rectForRow(at: index).minY), to: table.window
            ).y
            let offset = table.contentOffset.y + visibleTop - anchor.top
            if abs(table.contentOffset.y - offset) > 0.5 {
                table.setContentOffset(CGPoint(x: 0, y: offset), animated: false)
            }
        }

        private func scheduleLatest() {
            guard !detached, following, !dragging, !keyboardTransitioning, !parent.isCovered,
                  !scrollScheduled, !aligning else { return }
            scrollScheduled = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.scrollScheduled = false
                guard !self.detached else { return }
                self.alignLatest()
            }
        }

        private func alignLatest(animated: Bool = false, layoutImmediately: Bool = true) {
            guard let table, table.window != nil, following, !dragging, !keyboardTransitioning,
                  !parent.isCovered, !aligning, !table.isTracking, !table.isDragging,
                  !table.isDecelerating else { return }
            aligning = true
            defer { aligning = false }
            if needsInitialPosition, !identifiers.isEmpty, table.bounds.height > 0,
               table.numberOfSections > 0, table.numberOfRows(inSection: 0) == identifiers.count {
                needsInitialPosition = false
                table.scrollToRow(at: IndexPath(row: identifiers.count - 1, section: 0), at: .bottom, animated: false)
            }
            if layoutImmediately { table.layoutIfNeeded() }
            let offset = ChatScrollPosition.bottomOffset(
                contentHeight: table.contentSize.height, containerHeight: table.bounds.height,
                topInset: table.adjustedContentInset.top, bottomInset: table.adjustedContentInset.bottom
            )
            guard offset.isFinite else { return }
            if abs(table.contentOffset.y - offset) > 0.5 {
                UIView.performWithoutAnimation {
                    table.setContentOffset(CGPoint(x: 0, y: offset), animated: animated)
                }
            }
            if let event = pendingDiagnostic, !identifiers.isEmpty {
                pendingDiagnostic = nil
                DSBotLog.record(
                    event, counts: ["messageCount": identifiers.count],
                    geometry: [
                        "bottomY": Double(table.contentSize.height - table.contentOffset.y),
                        "viewportHeight": Double(table.bounds.height - table.adjustedContentInset.bottom)
                    ], state: "end"
                )
            }
        }

        func scrollToLatest(animated: Bool) {
            following = true
            dragging = false
            readingAnchor = nil
            publishFollowing()
            alignLatest(animated: animated)
            scheduleLatest()
        }

        private var isAtEnd: Bool {
            guard let table else { return true }
            return ChatScrollPosition.isAtEnd(
                contentHeight: table.contentSize.height, containerHeight: table.bounds.height,
                contentOffset: table.contentOffset.y,
                topInset: table.adjustedContentInset.top, bottomInset: table.adjustedContentInset.bottom
            )
        }

        private func publishFollowing() {
            guard parent.followsLatest != following else { return }
            parent.followsLatest = following
        }

        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            dragging = true
            readingAnchor = nil
            dragKeepsLatest = following && (
                parent.keyboardVisible || keyboardTransitioning ||
                ProcessInfo.processInfo.systemUptime - keyboardDismissedAt < 0.5
            )
            if parent.keyboardVisible { table?.window?.endEditing(true) }
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            guard dragging, !dragKeepsLatest else { return }
            if following && !isAtEnd {
                following = false
                publishFollowing()
            }
        }

        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            if !decelerate { finishDragging() }
        }

        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
            finishDragging()
        }

        private func finishDragging() {
            guard dragging else { return }
            dragging = false
            following = dragKeepsLatest || isAtEnd
            dragKeepsLatest = false
            if following { readingAnchor = nil }
            else { captureReadingAnchor() }
            publishFollowing()
            scheduleLatest()
            DSBotLog.record("chat.scroll.end", state: following ? "following" : "reading")
        }

        func tableView(_ tableView: UITableView, estimatedHeightForRowAt indexPath: IndexPath) -> CGFloat {
            guard let id = dataSource?.itemIdentifier(for: indexPath) else { return 120 }
            return heights[id] ?? 120
        }

        private func cacheVisibleHeights() {
            for cell in table?.visibleCells ?? [] {
                guard let id = (cell as? ConversationTableCell)?.itemID, cell.bounds.height > 0 else { continue }
                heights[id] = cell.bounds.height
            }
        }

        func tableView(_ tableView: UITableView, didEndDisplaying cell: UITableViewCell, forRowAt indexPath: IndexPath) {
            guard let id = (cell as? ConversationTableCell)?.itemID, cell.bounds.height > 0 else { return }
            heights[id] = cell.bounds.height
        }
    }
}

final class ConversationTableCell: UITableViewCell {
    var itemID: String?
}

private struct ConversationHistoryDisclosureStyle: DisclosureGroupStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) {
                    configuration.isExpanded.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    configuration.label
                    Spacer(minLength: 0)
                    DSBotIcon(.down, size: 14, scalesStroke: true)
                        .rotationEffect(.degrees(configuration.isExpanded ? 180 : 0))
                }
                .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if configuration.isExpanded { configuration.content }
        }
    }
}

final class ConversationTableView: UITableView {
    var onLayout: (() -> Void)?

    override func layoutSubviews() {
        UIView.performWithoutAnimation {
            super.layoutSubviews()
            let previousOffset = contentOffset
            onLayout?()
            if contentOffset != previousOffset {
                super.layoutSubviews()
                onLayout?()
            }
        }
    }
}
