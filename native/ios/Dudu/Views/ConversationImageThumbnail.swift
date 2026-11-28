import SwiftUI

struct ConversationImageThumbnail: View {
    let attachment: TranscriptAttachment
    let target: DraftTarget?
    let canLoadAttachment: Bool
    let identifier: String
    let loadImage: (TranscriptAttachment, DraftTarget, Bool) async -> PreparedPhotoImage?
    var alignment: Alignment = .trailing
    var isPending = false
    /// A tile inside a bubble (the pictures of an @ line): it fills the bubble's width, with this shape, instead of standing alone at 56% of the column with 18pt corners.
    var tileShape: UnevenRoundedRectangle? = nil

    @State private var image: PreparedPhotoImage?
    @State private var isPreviewPresented = false
    @State private var loadedKey: ConversationImageKey?
    @State private var isLoading = false
    @State private var loadingID: UUID?

    private struct LoadKey: Equatable {
        let image: ConversationImageKey?
        let isReady: Bool
    }

    private var waitsForSourceSequence: Bool { attachment.kind == "markdown" && attachment.seq == nil }

    private var imageKey: ConversationImageKey? {
        guard !waitsForSourceSequence, let target else { return nil }
        return ConversationImageKey(target: target, attachment: attachment)
    }

    private var showsLoading: Bool {
        waitsForSourceSequence || isLoading || (canLoadAttachment && loadedKey != imageKey)
    }

    var body: some View {
        Button {
            if image != nil { isPreviewPresented = true }
            else { Task { await load() } }
        } label: {
            DuduStyle.sheet
                // Loading pixels must not resize a history row under the reader.
                // The full-screen preview keeps the original image's aspect ratio.
                .aspectRatio(0.8, contentMode: .fit)
                .overlay {
                    if let image, loadedKey == imageKey {
                        Image(uiImage: image.image).resizable().scaledToFill()
                    } else if showsLoading {
                        ThumbnailLoadingRing()
                    } else {
                        DuduIcon(.image, size: 28).foregroundStyle(DuduStyle.chatTertiary)
                    }
                }
                .modifier(ThumbnailFrame(tileShape: tileShape, alignment: alignment))
        }
        .buttonStyle(DuduQuietPressStyle())
        .disabled(showsLoading || (image == nil && !canLoadAttachment))
        .modifier(MessagePendingIndicator(isPending: isPending))
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
        guard !waitsForSourceSequence, image == nil, let target else { return }
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

/// Matches the Android attachment tile's 20-point indeterminate arc and rounded 2-point stroke.
private struct ThumbnailLoadingRing: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationIsCovered) private var isCovered

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: reduceMotion || isCovered || scenePhase != .active)) { timeline in
            let period = 1.332
            let phase = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
            let sweep = reduceMotion ? 0.25 : 0.1 + 0.55 * (1 - cos(phase * 2 * .pi)) / 2
            Circle()
                .trim(from: 0, to: sweep)
                .stroke(DuduStyle.ink, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                .frame(width: 18, height: 18)
                .rotationEffect(.degrees(reduceMotion ? -90 : 360 * (phase - sweep / 2) - 90))
        }
        .frame(width: 20, height: 20)
        .accessibilityRepresentation { ProgressView() }
    }
}

/// A picture alone in the column: 56% of it (at most 260pt) with 18pt corners. A picture in a bubble: the bubble's width (the bubble sets it), in the bubble's shape.
private struct ThumbnailFrame: ViewModifier {
    let tileShape: UnevenRoundedRectangle?
    let alignment: Alignment

    func body(content: Content) -> some View {
        if let tileShape {
            content
                .frame(maxWidth: .infinity)
                .clipShape(tileShape)
                .contentShape(tileShape)
        } else {
            content
                .containerRelativeFrame(.horizontal, alignment: alignment) { width, _ in min(width * 0.56, 260) }
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
    }
}
