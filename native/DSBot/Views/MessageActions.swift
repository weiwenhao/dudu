import SwiftUI
import UIKit

extension View {
    func messageActions(text: String, isUser: Bool = false, seq: Double? = nil) -> some View {
        modifier(MessageActions(text: text, isUser: isUser, seq: seq))
    }
}

private struct MessageActions: ViewModifier {
    let text: String
    let isUser: Bool
    let seq: Double?
    @Environment(\.conversationAccess) private var access
    @State private var selection: MessageSelection?
    @State private var forkFailure: DSBotToastMessage?
    @State private var forking = false

    func body(content: Content) -> some View {
        content
            .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: 20, style: .continuous))
            .contextMenu {
                if !text.isEmpty {
                    Button(action: copy) {
                        DSBotLabel("复制", icon: .copy)
                    }
                    .accessibilityIdentifier("message.copy")
                    Button {
                        selection = MessageSelection(text: text)
                    } label: {
                        Label("选择", systemImage: "selection.pin.in.out")
                    }
                    .accessibilityIdentifier("message.select")
                }
                if let seq, let access {
                    Button {
                        forking = true
                        Task { @MainActor in
                            defer { forking = false }
                            do { try await access.fork(seq) }
                            catch { forkFailure = DSBotToastMessage(text: error.localizedDescription, kind: .error) }
                        }
                    } label: {
                        Label("在新对话中分支", systemImage: "arrow.triangle.branch")
                    }
                    .disabled(!access.connected || forking)
                    .accessibilityIdentifier("message.fork")
                }
            } preview: {
                MessageMenuPreview(text: text, isUser: isUser, seq: seq)
            }
            .accessibilityAction(named: "复制", copy)
            .sheet(item: $selection) { selection in
                MessageSelectionSheet(text: selection.text)
            }
            .overlay(alignment: .top) {
                DSBotToastOverlay(message: forkFailure) { _ in forkFailure = nil }
            }
    }

    private func copy() {
        UIPasteboard.general.string = text
        DSBotLog.record("message.copy")
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
                    .foregroundStyle(DSBotStyle.chatInk)
            } else {
                MessageMarkdown(text: text, allowsTextSelection: false, sourceSequence: seq)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .frame(idealWidth: 320, maxWidth: 360)
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxHeight: 420, alignment: .top)
        .background(isUser ? DSBotStyle.chatBubble : Color.white)
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
                .navigationTitle("选择")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("完成") { dismiss() }
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
        view.textColor = UIColor(DSBotStyle.chatInk)
        view.backgroundColor = .white
        view.tintColor = UIColor(DSBotStyle.blue)
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
