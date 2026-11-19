import SwiftUI
import UIKit

extension View {
    /// The long-press menu of a message. In 嘟嘟's own conversation, which is a group chat, it is the menu of the thread (owner, 2026-11-10: "我们有这个回复和删除和复制就行"): 回复 where there is an issue to
    /// answer (`reply`), 复制, and 删除 of the lines `seqs` (or this message's `seq`), which only hides them; everywhere else it is the menu every conversation has.
    func messageActions(text: String, isUser: Bool = false, seq: Double? = nil, reply: GroupIssue? = nil, seqs: [Double] = []) -> some View {
        modifier(MessageActions(text: text, isUser: isUser, seq: seq, reply: reply, seqs: seqs))
    }
}

private struct MessageActions: ViewModifier {
    let text: String
    let isUser: Bool
    let seq: Double?
    var reply: GroupIssue? = nil
    var seqs: [Double] = []
    @Environment(\.conversationAccess) private var access
    @Environment(\.groupChat) private var group
    @State private var selection: MessageSelection?
    @State private var forkFailure: DuduToastMessage?
    @State private var forking = false

    func body(content: Content) -> some View {
        content
            .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 20, style: .continuous))
            .contextMenu {
                if let group {
                    groupMenu(group)
                } else {
                ordinaryMenu
                }
            } preview: {
                MessageMenuPreview(text: text, isUser: isUser, seq: seq)
            }
            .accessibilityAction(named: L10n.text("复制"), copy)
            .sheet(item: $selection) { selection in
                MessageSelectionSheet(text: selection.text)
            }
            .overlay(alignment: .top) {
                DuduToastOverlay(message: forkFailure) { _ in forkFailure = nil }
            }
    }

    /// The menu of 嘟嘟's thread: 回复, 复制, 删除.
    @ViewBuilder
    private func groupMenu(_ group: GroupChatContext) -> some View {
        if let reply {
            Button { group.reply(reply) } label: { DuduLabel(L10n.text("回复"), icon: .reply) }
                .accessibilityIdentifier("message.reply")
        }
        if !text.isEmpty {
            Button(action: copy) { DuduLabel(L10n.text("复制"), icon: .copy) }
                .accessibilityIdentifier("message.copy")
        }
        let lines = seqs.isEmpty ? (seq.map { [$0] } ?? []) : seqs
        if !lines.isEmpty {
            Button(role: .destructive) { group.hide(lines) } label: { DuduLabel(L10n.text("删除"), icon: .trash) }
                .accessibilityIdentifier("message.delete")
        }
    }

    @ViewBuilder
    private var ordinaryMenu: some View {
                if !text.isEmpty {
                    Button(action: copy) {
                        DuduLabel(L10n.text("复制"), icon: .copy)
                    }
                    .accessibilityIdentifier("message.copy")
                    Button {
                        selection = MessageSelection(text: text)
                    } label: {
                        Label(L10n.text("选择"), systemImage: "selection.pin.in.out")
                    }
                    .accessibilityIdentifier("message.select")
                }
                if let seq, let access {
                    Button {
                        forking = true
                        Task { @MainActor in
                            defer { forking = false }
                            do { try await access.fork(seq) }
                            catch { forkFailure = DuduToastMessage(text: error.localizedDescription, kind: .error) }
                        }
                    } label: {
                        Label(L10n.text("在新对话中分支"), systemImage: "arrow.triangle.branch")
                    }
                    .disabled(!access.connected || forking)
                    .accessibilityIdentifier("message.fork")
                }
    }

    private func copy() {
        UIPasteboard.general.string = text
        DuduLog.record("message.copy")
    }
}

private struct MessageSelection: Identifiable {
    let id = UUID()
    let text: String
}

private struct MessageMenuPreview: View {
    let text: String
    let isUser: Bool
    let seq: Double?

    var body: some View {
        Group {
            if isUser {
                Text(text)
                    .font(.system(size: 16))
                    .lineSpacing(3)
                    .foregroundStyle(DuduStyle.chatInk)
            } else {
                MessageMarkdown(text: text, allowsTextSelection: false, sourceSequence: seq)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .frame(idealWidth: 320, maxWidth: 360)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxHeight: 420, alignment: .top)
        .background(isUser ? DuduStyle.chatBubble : Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityIdentifier("message.preview")
    }
}

private struct MessageSelectionSheet: View {
    let text: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            SelectableMessageText(text: text)
                .navigationTitle(L10n.text("选择"))
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(L10n.text("完成")) { dismiss() }
                            .accessibilityIdentifier("message.selection.close")
                    }
                }
        }
    }
}

private struct SelectableMessageText: UIViewRepresentable {
    let text: String

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.isEditable = false
        view.isSelectable = true
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.textColor = UIColor(DuduStyle.chatInk)
        view.backgroundColor = .white
        view.tintColor = UIColor(DuduStyle.blue)
        view.textContainerInset = UIEdgeInsets(top: 20, left: 20, bottom: 32, right: 20)
        view.alwaysBounceVertical = true
        view.accessibilityIdentifier = "message.selection.text"
        view.text = text
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        if view.text != text { view.text = text }
    }
}
