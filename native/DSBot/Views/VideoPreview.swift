import AVKit
import CoreTransferable
import SwiftUI
import UniformTypeIdentifiers

struct VideoThumbnail: View {
    let video: PreparedVideo?
    var playSize: CGFloat = 44

    var body: some View {
        DSBotStyle.chatPanel.overlay {
            if let image = video?.thumbnail?.image {
                Image(uiImage: image).resizable().scaledToFill()
            }
        }
        .clipped()
        .overlay {
            Image(systemName: "play.fill")
                .font(.system(size: playSize * 0.38, weight: .regular))
                .foregroundStyle(.white)
                .offset(x: playSize * 0.025)
                .frame(width: playSize, height: playSize)
                .background(.black.opacity(0.45), in: Circle())
                .accessibilityHidden(true)
        }
    }
}

struct ConversationVideoThumbnail: View {
    let attachment: TranscriptAttachment
    let target: DraftTarget?
    let canLoadAttachment: Bool
    var isPending = false
    @Environment(\.conversationAccess) private var access
    @State private var video: PreparedVideo?
    @State private var loading = false
    @State private var failure: String?
    @State private var previewing = false
    @State private var loadID: UUID?

    private struct LoadKey: Equatable {
        let target: DraftTarget?
        let attachment: TranscriptAttachment
        let connected: Bool
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            Button {
                Task { await load(openWhenReady: true) }
            } label: {
                Color.clear.aspectRatio(0.8, contentMode: .fit)
                    .overlay { VideoThumbnail(video: video) }
                    .overlay {
                        if loading { ProgressView().tint(.white).frame(width: 44, height: 44).background(.black.opacity(0.6), in: Circle()) }
                    }
                    .containerRelativeFrame(.horizontal, alignment: .trailing) { width, _ in min(width * 0.56, 260) }
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(loading || (video == nil && !canLoadAttachment))
            .modifier(MessagePendingIndicator(isPending: isPending))
            .accessibilityLabel(attachment.name)
            if let failure { ConversationFailureView(message: failure) }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .task(id: LoadKey(target: target, attachment: attachment, connected: canLoadAttachment)) {
            video = nil
            await load(openWhenReady: false)
        }
        .fullScreenCover(isPresented: $previewing) {
            if let video { VideoFullScreenPreview(video: video) { previewing = false } }
        }
    }

    @MainActor private func load(openWhenReady: Bool) async {
        guard let target, let id = attachment.id else { return }
        let key = ConversationVideoKey(target: target, attachmentID: id)
        let request = UUID()
        loadID = request
        loading = true
        failure = nil
        defer { if loadID == request { loading = false; loadID = nil } }
        do {
            if let cached = try await VideoPreviewStorage.shared.load(key) {
                guard !Task.isCancelled, loadID == request else { return }
                video = cached
            } else {
                guard canLoadAttachment, let access, access.target == target, attachment.seq != nil || id.hasPrefix("queue:") else { return }
                var parameters: [String: JSONValue] = ["attachmentId": .string(id)]
                if let seq = attachment.seq { parameters["seq"] = .number(seq) }
                let downloaded = try await access.downloadVideo(parameters)
                defer { Task { await VideoPreviewStorage.shared.removeDownload(downloaded) } }
                let prepared = try await VideoPreviewStorage.shared.store(downloaded, name: attachment.name, for: key)
                guard !Task.isCancelled, loadID == request else { return }
                video = prepared
            }
            if openWhenReady { previewing = true }
        } catch is CancellationError {
        } catch {
            if !Task.isCancelled, loadID == request {
                failure = (error as? DSBotFailure)?.localizedDescription ?? FileAttachments.message(for: FileAttachments.LoadError.unreadable)
            }
        }
    }
}

/// The reference's white full-screen media surface, with system playback, export and sharing.
struct VideoFullScreenPreview: View {
    let video: PreparedVideo
    let onClose: () -> Void
    @State private var player: AVPlayer
    @State private var exporting = false
    @State private var saveSymbol = "arrow.down.to.line"
    @Environment(\.scenePhase) private var scenePhase

    init(video: PreparedVideo, onClose: @escaping () -> Void) {
        self.video = video
        self.onClose = onClose
        _player = State(initialValue: AVPlayer(url: video.url))
    }

    var body: some View {
        VStack(spacing: 20) {
            HStack {
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 20, weight: .regular))
                        .frame(width: 44, height: 44).contentShape(Circle())
                }
                .buttonStyle(DSBotGlassButtonStyle())
                .accessibilityLabel(L10n.text("关闭"))
                Spacer()
                HStack(spacing: 0) {
                    Button { exporting = true } label: {
                        Image(systemName: saveSymbol).font(.system(size: 21, weight: .regular))
                            .frame(width: 48, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel(L10n.text("下载"))
                    ShareLink(item: video.url) {
                        Image(systemName: "ellipsis").font(.system(size: 21, weight: .regular))
                            .frame(width: 48, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel(L10n.text("更多"))
                }
                .buttonStyle(.plain)
                .dsbotGlass(in: Capsule())
            }
            .foregroundStyle(DSBotStyle.ink)
            .padding(.horizontal, 14)
            .padding(.top, 10)
            NativeVideoPlayer(player: player)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(.white)
        .preferredColorScheme(.light)
        .fileExporter(
            isPresented: $exporting, item: VideoExport(url: video.url),
            contentTypes: [UTType(filenameExtension: video.url.pathExtension) ?? .movie],
            defaultFilename: video.url.lastPathComponent
        ) { result in
            switch result {
            case .success: saveSymbol = "checkmark"
            case .failure: saveSymbol = "exclamationmark"
            }
        }
        .onAppear { player.play() }
        .onDisappear { player.pause() }
        .onChange(of: scenePhase) { _, phase in if phase != .active { player.pause() } }
    }
}

private struct VideoExport: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .mpeg4Movie) { SentTransferredFile($0.url) }
            .exportingCondition { $0.url.pathExtension.lowercased() == "mp4" }
        FileRepresentation(exportedContentType: .quickTimeMovie) { SentTransferredFile($0.url) }
            .exportingCondition { $0.url.pathExtension.lowercased() == "mov" }
        FileRepresentation(exportedContentType: UTType(filenameExtension: "m4v") ?? .mpeg4Movie) { SentTransferredFile($0.url) }
            .exportingCondition { $0.url.pathExtension.lowercased() == "m4v" }
    }
}

private struct NativeVideoPlayer: UIViewControllerRepresentable {
    let player: AVPlayer
    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.videoGravity = .resizeAspect
        controller.view.backgroundColor = .white
        return controller
    }
    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
    static func dismantleUIViewController(_ controller: AVPlayerViewController, coordinator: ()) {
        controller.player?.pause()
        controller.player = nil
    }
}
