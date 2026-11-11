import SwiftUI

struct ConversationImageThumbnail: View {
    let attachment: TranscriptAttachment
    let target: DraftTarget?
    let canLoadAttachment: Bool
    let identifier: String
    let loadImage: (TranscriptAttachment, DraftTarget, Bool) async -> PreparedPhotoImage?
    var alignment: Alignment = .trailing

    @State private var image: PreparedPhotoImage?
    @State private var isPreviewPresented = false
    @State private var loadedKey: ConversationImageKey?
    @State private var isLoading = false
    @State private var loadingID: UUID?

    private struct LoadKey: Equatable {
        let image: ConversationImageKey?
        let isReady: Bool
    }

    private var imageKey: ConversationImageKey? {
        guard let target else { return nil }
        return ConversationImageKey(target: target, attachment: attachment)
    }

    var body: some View {
        Button {
            if image != nil { isPreviewPresented = true }
            else { Task { await load() } }
        } label: {
            DSBotStyle.chatPanel
                // Loading pixels must not resize a history row under the reader.
                // The full-screen preview keeps the original image's aspect ratio.
                .aspectRatio(0.8, contentMode: .fit)
                .overlay {
                if let image {
                    Image(uiImage: image.image).resizable().scaledToFill()
                } else if isLoading {
                    ProgressView()
                } else {
                    DSBotIcon(.image, size: 28).foregroundStyle(DSBotStyle.chatTertiary)
                }
            }
            .containerRelativeFrame(.horizontal, alignment: alignment) { width, _ in min(width * 0.56, 260) }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isLoading || (image == nil && !canLoadAttachment))
        .frame(maxWidth: .infinity, alignment: alignment)
        .accessibilityLabel(attachment.name)
        .accessibilityIdentifier(identifier)
        .task(id: LoadKey(image: imageKey, isReady: canLoadAttachment)) {
            if loadedKey != imageKey {
                image = nil
                loadedKey = imageKey
            }
            await load()
        }
        .fullScreenCover(isPresented: $isPreviewPresented) {
            PhotoAttachmentFullScreenPreview(
                thumbnailImage: image?.image,
                onClose: { isPreviewPresented = false },
                loadImage: {
                    guard let target else { return nil }
                    return await loadImage(attachment, target, true)
                }
            )
        }
    }

    @MainActor private func load() async {
        guard image == nil, let target else { return }
        let identifier = UUID()
        let key = imageKey
        loadingID = identifier
        isLoading = true
        defer {
            if loadingID == identifier {
                isLoading = false
                loadingID = nil
            }
        }
        let prepared = await loadImage(attachment, target, false)
        guard !Task.isCancelled, loadingID == identifier, key == imageKey else { return }
        image = prepared
    }
}
