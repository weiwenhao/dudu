import SwiftUI

struct QueuedMessagesPanel: View {
    let messages: [QueuedMessage]
    let isRunning: Bool
    let isConnected: Bool
    let busyItemID: String?
    let onEdit: (QueuedMessage) -> Void
    let onRemove: (QueuedMessage) -> Void
    let onSteer: (QueuedMessage) -> Void
    let onOverlayHeightChange: (CGFloat) -> Void
    @State private var expanded = false
    @State private var contentHeight: CGFloat = 0

    private var showsList: Bool { messages.count == 1 || expanded }
    private var overlayHeight: CGFloat {
        messages.count > 1 && expanded ? min(220, contentHeight) : 0
    }

    var body: some View {
        Color.clear
            .frame(height: 44)
            .overlay(alignment: .bottom) {
                panel
                    .fixedSize(horizontal: false, vertical: true)
                    .background { DSBotPanelBackdrop() }
            }
            .onChange(of: overlayHeight, initial: true) { _, height in onOverlayHeightChange(height) }
            .onDisappear { onOverlayHeightChange(0) }
    }

    private var panel: some View {
        VStack(spacing: 0) {
            if messages.count > 1 {
                Button {
                    withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
                } label: {
                    HStack(spacing: 8) {
                        DSBotIcon(.queue, size: 16, scalesStroke: true)
                        Text("\(messages.count) 条排队消息").font(.system(size: 14))
                        Spacer(minLength: 0)
                        DSBotIcon(.down, size: 16, scalesStroke: true)
                            .rotationEffect(.degrees(expanded ? 180 : 0))
                    }
                    .foregroundStyle(DSBotStyle.chatSecondary)
                    .padding(.horizontal, 14)
                    .frame(height: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("queue.toggle")
            }
            if showsList {
                if messages.count == 1, let message = messages.first {
                    row(message)
                } else {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(messages) { row($0) }
                        }
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
                    }
                    .frame(height: min(220, contentHeight))
                    .scrollBounceBehavior(.basedOnSize)
                }
            }
        }
        .background(DSBotStyle.chatPanel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(DSBotStyle.chatBorder, lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("queue.panel")
    }

    private func row(_ message: QueuedMessage) -> some View {
        HStack(spacing: 4) {
            DSBotIcon(.queue, size: 16, scalesStroke: true)
                .foregroundStyle(DSBotStyle.chatTertiary)
                .padding(.leading, 14)
            if let attachments = message.attachments {
                let images = attachments.filter { $0.kind == "image" }
                if !images.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 4) {
                            ForEach(Array(images.enumerated()), id: \.offset) { _, attachment in
                                QueuedImageThumbnail(attachment: attachment)
                            }
                        }
                    }
                    .frame(width: min(102, CGFloat(images.count) * 34 - 4), height: 30)
                    .scrollBounceBehavior(.basedOnSize)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                if !message.text.isEmpty {
                    Text(message.text)
                        .lineLimit(1)
                        .accessibilityIdentifier("queue.text.\(message.id)")
                }
                if let attachments = message.attachments, attachments.contains(where: { $0.kind != "image" }) {
                    Text(attachments.filter { $0.kind != "image" }.map(\.name).joined(separator: " · "))
                        .foregroundStyle(DSBotStyle.chatTertiary)
                        .lineLimit(1)
                }
            }
            .font(.system(size: 14))
            .foregroundStyle(DSBotStyle.chatInk)
            .frame(maxWidth: .infinity, alignment: .leading)
            if busyItemID == message.id {
                ProgressView().controlSize(.small).frame(width: 44, height: 44)
            } else {
                Menu {
                    Button { onEdit(message) } label: {
                        Label("编辑排队消息", systemImage: "square.and.pencil")
                    }
                    .disabled(!message.editable)
                    .accessibilityIdentifier("queue.edit.\(message.id)")
                    Button(role: .destructive) { onRemove(message) } label: {
                        Label("删除排队消息", systemImage: "trash")
                    }
                    .accessibilityIdentifier("queue.remove.\(message.id)")
                } label: {
                    DSBotIcon(.options, size: 20).frame(width: 44, height: 44)
                }
                .accessibilityLabel("排队消息")
                .accessibilityIdentifier("queue.menu.\(message.id)")
            }
            Button { onSteer(message) } label: {
                DSBotIcon(.send, size: 20).frame(width: 44, height: 44)
            }
            .disabled(!isRunning)
            .accessibilityLabel("插话发送")
            .accessibilityIdentifier("queue.steer.\(message.id)")
        }
        .foregroundStyle(DSBotStyle.chatSecondary)
        .buttonStyle(.plain)
        .disabled(!isConnected || busyItemID != nil)
        .frame(height: 44)
        .accessibilityElement(children: .contain)
    }
}

private struct QueuedImageThumbnail: View {
    let attachment: TranscriptAttachment
    @Environment(\.conversationAccess) private var access
    @State private var image: PreparedPhotoImage?
    @State private var presented = false

    private var loadKey: String {
        "\(access?.target.computerID ?? ""):\(access?.target.sessionID ?? ""):\(attachment.id ?? ""):\(access?.connected == true)"
    }

    var body: some View {
        Button { presented = true } label: {
            Group {
                if let image { Image(uiImage: image.image).resizable().scaledToFill() }
                else { DSBotIcon(.image, size: 18).frame(maxWidth: .infinity, maxHeight: .infinity) }
            }
            .frame(width: 30, height: 30)
            .background(DSBotStyle.chatBubble)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .disabled(image == nil)
        .accessibilityLabel(attachment.name)
        .accessibilityIdentifier("queue.image.\(attachment.id ?? "")")
        .task(id: loadKey) {
            guard let access else { return }
            let loaded = await access.loadImage(attachment, access.target, false)
            guard !Task.isCancelled else { return }
            image = loaded
        }
        .fullScreenCover(isPresented: $presented) {
            PhotoAttachmentFullScreenPreview(
                thumbnailImage: image?.image, onClose: { presented = false },
                loadImage: {
                    guard let access else { return nil }
                    return await access.loadImage(attachment, access.target, true)
                }
            )
        }
    }
}

struct QueuedMessageEditor: View {
    let message: QueuedMessage
    let isSaving: Bool
    let onSave: (String) -> Void
    let onCancel: () -> Void
    @State private var text: String

    init(message: QueuedMessage, isSaving: Bool, onSave: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.message = message
        self.isSaving = isSaving
        self.onSave = onSave
        self.onCancel = onCancel
        _text = State(initialValue: message.text)
    }

    var body: some View {
        NavigationStack {
            TextEditor(text: $text)
                .padding(16)
                .accessibilityIdentifier("queue.editor.text")
                .navigationTitle("编辑排队消息")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("取消编辑", action: onCancel).disabled(isSaving)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("保存排队消息") { onSave(text) }
                            .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            .accessibilityIdentifier("queue.editor.save")
                    }
                }
        }
        .interactiveDismissDisabled(isSaving)
    }
}
