import SwiftUI

struct QueuedMessagesPanel: View {
    let messages: [QueuedMessage]
    let isRunning: Bool
    let isConnected: Bool
    let busyItemID: String?
    let busyAction: String?
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
                        Text(L10n.plural("\(messages.count) 条排队消息")).font(.system(size: 14))
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
                            ForEach(messages, id: \.presentationID) { row($0) }
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
        HStack(spacing: 0) {
            if messages.count == 1 {
                DSBotIcon(.queue, size: 16, scalesStroke: true)
                    .foregroundStyle(DSBotStyle.chatTertiary)
                    .padding(.trailing, 8)
                    .accessibilityHidden(true)
            }
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
                    .padding(.trailing, 6)
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
            Button { onEdit(message) } label: {
                DSBotIcon(.compose, size: 16, scalesStroke: true)
                    .opacity(message.editable ? 1 : 0.35)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .disabled(!message.editable || message.isSubmissionEcho)
            .accessibilityLabel(L10n.text("编辑排队消息"))
            .accessibilityIdentifier("queue.edit.\(message.id)")
            Button { onRemove(message) } label: {
                QueueActionLabel(
                    glyph: .trash, size: 16,
                    isPending: busyItemID == message.id && busyAction == "remove"
                )
            }
            .disabled(message.isSubmissionEcho)
            .accessibilityLabel(L10n.text("删除排队消息"))
            .accessibilityIdentifier("queue.remove.\(message.id)")
            Button { onSteer(message) } label: {
                QueueActionLabel(
                    glyph: .send, size: 20,
                    isPending: busyItemID == message.id && busyAction == "steer"
                )
                .opacity(isRunning ? 1 : 0.35)
            }
            .disabled(!isRunning || message.isSubmissionEcho)
            .accessibilityLabel(L10n.text("插话发送"))
            .accessibilityIdentifier("queue.steer.\(message.id)")
        }
        .foregroundStyle(DSBotStyle.chatSecondary)
        .buttonStyle(DSBotQuietPressStyle())
        .disabled(!isConnected || busyItemID != nil)
        .opacity(isConnected ? 1 : 0.35)
        .padding(.leading, 14)
        .frame(height: 44)
        .accessibilityElement(children: .contain)
    }
}

private struct QueueActionLabel: View {
    let glyph: DSBotGlyph
    let size: CGFloat
    let isPending: Bool
    @State private var showsProgress = false

    var body: some View {
        DSBotIcon(glyph, size: size, scalesStroke: size < 20)
            .opacity(showsProgress ? 0 : 1)
            .frame(width: 44, height: 44)
            .overlay {
                if showsProgress {
                    ProgressView()
                        .controlSize(.small)
                        .tint(DSBotStyle.chatSecondary)
                }
            }
            .contentShape(Rectangle())
            .task(id: isPending) {
                showsProgress = false
                guard isPending else { return }
                // The press responds immediately; short requests need no spinner flash.
                do { try await Task.sleep(for: .milliseconds(150)) }
                catch { return }
                guard !Task.isCancelled else { return }
                showsProgress = true
            }
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
                else { DSBotIcon(.image, size: 16, scalesStroke: true).frame(maxWidth: .infinity, maxHeight: .infinity) }
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
    let error: String?
    let onSave: (String) -> Void
    let onCancel: () -> Void
    @State private var text: String

    init(
        message: QueuedMessage, isSaving: Bool, error: String?,
        onSave: @escaping (String) -> Void, onCancel: @escaping () -> Void
    ) {
        self.message = message
        self.isSaving = isSaving
        self.error = error
        self.onSave = onSave
        self.onCancel = onCancel
        _text = State(initialValue: message.text)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                TextEditor(text: $text)
                    .font(.system(size: 16))
                    .foregroundStyle(DSBotStyle.chatInk)
                    .scrollContentBackground(.hidden)
                    .padding(12)
                    .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .disabled(isSaving)
                    .accessibilityIdentifier("queue.editor.text")
                if let error {
                    Text(error)
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.chatError)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("queue.editor.error")
                }
            }
            .padding(20)
            .background(DSBotStyle.canvas)
            .navigationTitle(L10n.text("编辑"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L10n.text("取消"), action: onCancel)
                        .disabled(isSaving)
                        .accessibilityIdentifier("queue.editor.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        onSave(text)
                    } label: {
                        if isSaving {
                            ProgressView()
                                .accessibilityIdentifier("queue.editor.saving")
                        } else {
                            Text(L10n.text("保存"))
                        }
                    }
                    .disabled(isSaving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityLabel(L10n.text("保存"))
                    .accessibilityIdentifier("queue.editor.save")
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }
}
