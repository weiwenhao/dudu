import SwiftUI
import UIKit

/// A photo waiting to be sent: a square thumbnail with a close badge in its corner. Tapping the
/// thumbnail opens the full picture.
struct PhotoAttachmentPreview: View {
    let photo: PreparedPhotoAttachment
    let onRemove: () -> Void

    @State private var isPreviewPresented = false

    private var previewImage: UIImage? {
        photo.thumbnailImage?.image
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Button {
                DSBotLog.record("photos.preview.open")
                isPreviewPresented = true
            } label: {
                thumbnail
                    .frame(width: AttachmentTile.size, height: AttachmentTile.size)
                    .clipShape(AttachmentTile.shape)
                    .overlay { AttachmentTile.shape.stroke(DSBotStyle.chatBorder, lineWidth: 0.5) }
                    .contentShape(AttachmentTile.shape)
            }
            .buttonStyle(DSBotQuietPressStyle())
            .accessibilityLabel("预览照片")
            .accessibilityIdentifier("photo.preview.\(photo.id)")

            AttachmentRemoveBadge(label: "移除照片", identifier: "photo.remove.\(photo.id)", action: onRemove)
        }
        .frame(width: AttachmentTile.size, height: AttachmentTile.size)
        .fullScreenCover(isPresented: $isPreviewPresented) {
            PhotoAttachmentFullScreenPreview(
                base64: photo.attachment.dataBase64,
                thumbnailImage: previewImage,
                onClose: {
                    DSBotLog.record("photos.preview.close")
                    isPreviewPresented = false
                }
            )
        }
    }

    @ViewBuilder
    private var thumbnail: some View {
        if let previewImage {
            Image(uiImage: previewImage)
                .resizable()
                .scaledToFill()
                .frame(width: AttachmentTile.size, height: AttachmentTile.size)
                .clipped()
        } else {
            ZStack {
                DSBotStyle.sheet
                DSBotIcon(.image, size: 22)
                    .foregroundStyle(DSBotStyle.muted)
            }
        }
    }
}

enum AttachmentTile {
    static let size: CGFloat = 76
    static let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
}

/// Dark round "x" in the top-right corner of a tile, with a larger invisible hit area.
struct AttachmentRemoveBadge: View {
    let label: String
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            DSBotIcon(.close, size: 11, strokeWidth: 2.4)
                .foregroundStyle(.white)
                .frame(width: 22, height: 22)
                .background(Color.black.opacity(0.55), in: Circle())
                .padding(4)
                .frame(width: 40, height: 40, alignment: .topTrailing)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityIdentifier(identifier)
    }
}

struct PhotoAttachmentFullScreenPreview: View {
    var base64: String? = nil
    let thumbnailImage: UIImage?
    let onClose: () -> Void
    var loadImage: (() async -> PreparedPhotoImage?)? = nil

    @State private var fullSizeImage: UIImage?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()

            previewContent

            Button(action: onClose) {
                DSBotIcon(.close, size: 18)
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(Color.black.opacity(0.55), in: Circle())
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("关闭照片预览")
            .accessibilityIdentifier("photo.preview.close")
            .padding(.top, 10)
            .padding(.trailing, 14)
        }
        .preferredColorScheme(.dark)
        .task {
            let prepared: PreparedPhotoImage?
            if let loadImage {
                prepared = await loadImage()
            } else if let base64 {
                prepared = await PhotoAttachments.loadFullSizePreview(fromBase64: base64)
            } else {
                prepared = nil
            }
            guard !Task.isCancelled, let prepared else { return }
            fullSizeImage = prepared.image
        }
    }

    @ViewBuilder
    private var previewContent: some View {
        if let image = fullSizeImage ?? thumbnailImage {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityLabel("照片预览")
        } else {
            DSBotIcon(.camera, size: 36)
                .foregroundStyle(.white.opacity(0.8))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
