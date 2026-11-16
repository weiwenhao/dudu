import SwiftUI

/// Photos and files waiting to be sent, as square tiles at the top of the composer's glass.
struct ComposerAttachmentTiles: View {
    let photos: [PreparedPhotoAttachment]
    let files: [UploadedFile]
    let uploadingFileName: String?
    let onRemovePhoto: (PreparedPhotoAttachment) -> Void
    let onRemoveFile: (UploadedFile) -> Void

    var isEmpty: Bool { photos.isEmpty && files.isEmpty && uploadingFileName == nil }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(photos) { photo in
                    PhotoAttachmentPreview(photo: photo) { onRemovePhoto(photo) }
                }
                ForEach(files) { file in
                    FileAttachmentTile(file: file) { onRemoveFile(file) }
                }
                if let uploadingFileName {
                    UploadingTile(name: uploadingFileName)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 4)
        }
        .accessibilityIdentifier("composer.attachments")
    }
}

private struct FileAttachmentTile: View {
    let file: UploadedFile
    let onRemove: () -> Void
    @State private var previewing = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            if let video = file.video {
                Button { previewing = true } label: {
                    VideoThumbnail(video: video, playSize: 28)
                        .frame(width: AttachmentTile.size, height: AttachmentTile.size)
                        .clipShape(AttachmentTile.shape)
                        .contentShape(AttachmentTile.shape)
                }
                .buttonStyle(DSBotQuietPressStyle())
                .accessibilityLabel(file.name)
            } else {
                fileContent
            }
            AttachmentRemoveBadge(label: L10n.text("移除文件"), identifier: "file.remove.\(file.id)", action: onRemove)
        }
        .frame(width: AttachmentTile.size, height: AttachmentTile.size)
        .fullScreenCover(isPresented: $previewing) {
            if let video = file.video { VideoFullScreenPreview(video: video) { previewing = false } }
        }
    }

    private var fileContent: some View {
        VStack(spacing: 6) {
                DSBotIcon(.file, size: 24)
                    .foregroundStyle(DSBotStyle.chatTertiary)
                Text(file.name)
                    .font(.system(size: 11))
                    .foregroundStyle(DSBotStyle.chatSecondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 7)
            .frame(width: AttachmentTile.size, height: AttachmentTile.size)
            .background(Color(white: 0.94), in: AttachmentTile.shape)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(L10n.text("文件 {0}", "\(file.name)"))
            .accessibilityIdentifier("file.tile.\(file.id)")

    }
}

private struct UploadingTile: View {
    let name: String

    var body: some View {
        VStack(spacing: 6) {
            ProgressView().controlSize(.small)
            Text(name)
                .font(.system(size: 11))
                .foregroundStyle(DSBotStyle.chatSecondary)
                .lineLimit(2)
                .truncationMode(.middle)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 7)
        .frame(width: AttachmentTile.size, height: AttachmentTile.size)
        .background(Color(white: 0.94), in: AttachmentTile.shape)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("composer.file.uploading")
    }
}
