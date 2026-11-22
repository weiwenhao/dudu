import SwiftUI

/// Retained transcript cards use the same approved rows, with their existing reply/open routes.
struct QuickTodoList: View {
    let issues: [BoardIssue]
    @State private var open: Int?
    @Environment(\.openQuickCardIssue) private var openIssue
    @Environment(\.groupChat) private var group

    var body: some View {
        VStack(spacing: 0) {
            ForEach(issues) { issue in
                QuickTodoRow(
                    issue: issue, isOpen: open == issue.id,
                    onToggle: {
                        guard issue.sessionId != nil, issue.latest != nil else { openIssue(issue); return }
                        open = open == issue.id ? nil : issue.id
                    },
                    onReply: { group?.reply(GroupIssue(id: issue.id, ref: issue.ref, title: issue.title, agent: issue.agent)) },
                    onOpen: { openIssue(issue) }
                )
                if issue.id != issues.last?.id { QuickTodoSeparator() }
            }
        }
    }
}

struct QuickTodoSeparator: View {
    /// Where the line starts: 14pt, the row's edge, or the start of the text after a picture (the inbox's rows, 2026-11-18).
    var leading: CGFloat = 14

    var body: some View {
        Rectangle().fill(Color.black.opacity(0.06)).frame(height: 0.5).padding(.leading, leading).padding(.trailing, 14)
    }
}

/// B-right: one white outer list, full-width Markdown, and two independent 44pt actions at the right edge.
struct QuickTodoRow: View {
    let issue: BoardIssue
    let isOpen: Bool
    var sourceSequence: Double?
    var attachments: [TranscriptAttachment] = []
    var onToggle: (() -> Void)?
    let onReply: () -> Void
    let onOpen: () -> Void

    /// Clip the same 15pt Markdown to about two lines, as the message bubble clips its unchanged body.
    private static let collapsedMessageHeight: CGFloat = 48
    private var canAnswer: Bool { issue.sessionId != nil && issue.latest != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if onToggle != nil {
                Button(action: toggle) {
                    header
                        .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                // Use the row's existing inset for the touch area without moving the header or body.
                .padding(.horizontal, -14)
                .padding(.vertical, -8)
            } else {
                header
            }
            if let latest = issue.latest {
                message(latest)
                if isOpen {
                    QuickTodoAttachments(attachments: attachments)
                    QuickTodoActions(onReply: onReply, onOpen: onOpen)
                }
            }
        }
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        .swipeToReply(enabled: canAnswer, direction: .right, onReply: onReply)
        .padding(.horizontal, 14)
        .clipped()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("quick.todo.\(issue.id)")
        .accessibilityValue(isOpen ? L10n.text("已展开") : L10n.text("已收起"))
    }

    private func message(_ latest: IssueLatest) -> some View {
        MessageMarkdown(text: (latest.isMine && !latest.text.isEmpty ? L10n.text("你：") : "") + latest.text, todo: true, sourceSequence: sourceSequence)
            .frame(maxWidth: .infinity, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxHeight: isOpen ? nil : Self.collapsedMessageHeight, alignment: .top)
            .clipped()
            .overlay {
                if !isOpen, onToggle != nil {
                    // Keep tapping the collapsed content to open it, without making the text a button label.
                    Button(action: toggle) { Color.clear.contentShape(Rectangle()) }
                        .buttonStyle(.plain)
                        .accessibilityHidden(true)
                }
            }
    }

    private func toggle() {
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) { onToggle?() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Group {
                if let agent = issue.sessionAgent {
                    AgentAvatar(agent: agent, state: issue.workState, asleep: issue.deepSleep == true, size: 28)
                } else {
                    BoardNoAgentMark()
                }
            }
            .frame(width: 28, height: 28)
            HStack(spacing: 8) {
                Text(issue.reference)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                    .fixedSize()
                if let latest = issue.latest {
                    Text(relativeTime(latest.at))
                        .font(.system(size: 12))
                        .foregroundStyle(DuduStyle.muted)
                        .fixedSize()
                }
                Text(issue.title)
                    .font(.system(size: 15))
                    .foregroundStyle(DuduStyle.chatSecondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if canAnswer, onToggle != nil {
                    DuduIcon(isOpen ? .up : .down, size: 14, scalesStroke: true)
                        .foregroundStyle(DuduStyle.muted)
                }
            }
        }
        .frame(minHeight: 28)
    }
}

private struct QuickTodoAttachments: View {
    let attachments: [TranscriptAttachment]
    @Environment(\.conversationAccess) private var access

    var body: some View {
        ForEach(Array(attachments.enumerated()), id: \.offset) { _, attachment in
            if attachment.kind == "image", let access {
                ConversationImageThumbnail(
                    attachment: attachment, target: access.target, canLoadAttachment: access.connected,
                    identifier: "quick.todo.image.\(attachment.id ?? "")", loadImage: access.loadImage, alignment: .leading
                )
            } else {
                DuduLabel(attachment.name, icon: .file)
                    .font(.system(size: 13)).foregroundStyle(DuduStyle.chatSecondary)
                    .padding(12)
                    .background(DuduStyle.sheet, in: RoundedRectangle(cornerRadius: 10))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

@MainActor
private extension AssistantQuickSheetState {
    func access(for issue: BoardIssue, using store: DuduStore) -> ConversationAccess? {
        guard let session = issue.sessionId else { return nil }
        return ConversationAccess(
            target: DraftTarget(computerID: target.computerID, sessionID: session),
            connected: isCurrent(store) && store.status == .connected,
            request: { _, _ in throw DuduFailure.remote("UNSUPPORTED") },
            loadImage: { attachment, _, fullSize in await self.image(attachment, of: issue, fullSize: fullSize, using: store) }
        )
    }
}

struct QuickTodoActions: View {
    let onReply: () -> Void
    let onOpen: () -> Void

    var body: some View {
        HStack(spacing: 20) {
            action(L10n.text("回复"), glyph: .reply, tint: DuduStyle.blue, onReply)
            action(L10n.text("打开会话"), glyph: .openLink, tint: DuduStyle.chatSecondary, onOpen)
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func action(_ title: String, glyph: DuduGlyph, tint: Color, _ perform: @escaping () -> Void) -> some View {
        Button(action: perform) {
            HStack(spacing: 6) {
                DuduIcon(glyph, size: 15, scalesStroke: true)
                Text(title).font(.system(size: 13, weight: .medium))
            }
            .foregroundStyle(tint)
            .frame(minWidth: 44, minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(DuduQuietPressStyle())
    }
}

struct AssistantTodoSheet: View {
    @ObservedObject var state: AssistantQuickSheetState
    @ObservedObject var model: AssistantTodoModel
    @ObservedObject var store: DuduStore
    let onClose: () -> Void
    let onReply: (GroupIssue) -> Void
    let onOpenIssue: (BoardIssue) -> Void
    @Environment(\.scenePhase) private var scenePhase

    private struct Reading: Equatable {
        var connection: Int
        var active: Bool
    }

    var body: some View {
        list
        .task(id: Reading(connection: store.connectionRevision, active: scenePhase == .active)) {
            guard scenePhase == .active else { return }
            await model.refresh(state, using: store)
        }
        .task(id: model.expandedID) {
            guard let issue = model.issues.first(where: { $0.id == model.expandedID }) else { return }
            await model.expand(issue, in: state, using: store)
        }
    }

    private var list: some View {
        QuickSheetPage(
            title: L10n.text("待办"), count: model.loading ? nil : model.total, onClose: onClose, centersTitle: true,
            scrollID: $state.scrollID,
            actions: {}, filters: {}
        ) {
            VStack(spacing: 0) {
                if model.loading {
                    ProgressView().tint(DuduStyle.chatSecondary).frame(maxWidth: .infinity, minHeight: 82)
                } else if model.issues.isEmpty, model.failure == nil {
                    Text(L10n.text("没有事项"))
                        .font(.system(size: 15)).foregroundStyle(DuduStyle.muted)
                        .frame(maxWidth: .infinity, minHeight: 82)
                } else {
                    VStack(spacing: 0) {
                        ForEach(model.issues) { issue in
                            QuickTodoRow(
                                issue: issue, isOpen: model.expandedID == issue.id,
                                sourceSequence: model.fullLatest[issue.id]?.seq,
                                attachments: model.fullLatest[issue.id]?.attachments ?? [],
                                onToggle: {
                                    guard issue.latest != nil, issue.sessionId != nil else { onOpenIssue(issue); return }
                                    model.expandedID = model.expandedID == issue.id ? nil : issue.id
                                },
                                onReply: { onReply(GroupIssue(id: issue.id, ref: issue.ref, title: issue.title, agent: issue.agent)) },
                                onOpen: { onOpenIssue(issue) }
                            )
                            .environment(\.conversationAccess, state.access(for: issue, using: store))
                            .id(String(issue.id))
                            if issue.id != model.issues.last?.id { QuickTodoSeparator() }
                        }
                    }
                    .scrollTargetLayout()
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    if let cursor = model.nextCursor {
                        ProgressView()
                            .tint(DuduStyle.chatSecondary)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .id(cursor)
                            .onScrollVisibilityChange(threshold: 0.1) { visible in
                                if visible { Task { await model.refresh(state, using: store, more: true) } }
                            }
                    }
                }
                if let failure = model.failure { ConversationFailureView(message: failure).padding(14) }
            }
        } footer: {}
    }
}
