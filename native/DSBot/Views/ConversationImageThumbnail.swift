import SwiftUI

struct ConversationImageThumbnail: View {
    let attachment: TranscriptAttachment
    let target: DraftTarget?
    let canLoadAttachment: Bool
    let identifier: String
    let loadImage: (TranscriptAttachment, DraftTarget, Bool) async -> PreparedPhotoImage?

    @State private var image: PreparedPhotoImage?
    @State private var isPreviewPresented = false
    @State private var loadedKey: ConversationImageKey?
    @State private var isLoading = false
    @State private var loadingID: UUID?

    private struct LoadKey: Equatable {
        let image: ConversationImageKey?
        let isReady: Bool
    }

    private var aspectRatio: CGFloat {
        guard let size = image?.image.size, size.height > 0 else { return 0.8 }
        return max(0.75, min(1.6, size.width / size.height))
    }

    private var imageKey: ConversationImageKey? {
        guard let target, let attachmentID = attachment.id else { return nil }
        return ConversationImageKey(target: target, attachmentID: attachmentID)
    }

    var body: some View {
        Button {
            if image != nil { isPreviewPresented = true }
            else { Task { await load() } }
        } label: {
            DSBotStyle.chatPanel
                .aspectRatio(aspectRatio, contentMode: .fit)
                .overlay {
                if let image {
                    Image(uiImage: image.image).resizable().scaledToFill()
                } else {
                    DSBotIcon(.image, size: 28).foregroundStyle(DSBotStyle.chatTertiary)
                }
            }
            .containerRelativeFrame(.horizontal, alignment: .trailing) { width, _ in min(width * 0.56, 260) }
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isLoading || (image == nil && !canLoadAttachment))
        .frame(maxWidth: .infinity, alignment: .trailing)
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
