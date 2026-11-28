import SwiftUI
import UIKit
import Photos

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
                DuduLog.record("photos.preview.open")
                isPreviewPresented = true
            } label: {
                thumbnail
                    .frame(width: AttachmentTile.size, height: AttachmentTile.size)
                    .clipShape(AttachmentTile.shape)
                    .overlay { AttachmentTile.shape.stroke(DuduStyle.chatBorder, lineWidth: 0.5) }
                    .contentShape(AttachmentTile.shape)
            }
            .buttonStyle(DuduQuietPressStyle())
            .accessibilityLabel(L10n.text("预览照片"))
            .accessibilityIdentifier("photo.preview.\(photo.id)")

            AttachmentRemoveBadge(label: L10n.text("移除照片"), identifier: "photo.remove.\(photo.id)", action: onRemove)
        }
        .frame(width: AttachmentTile.size, height: AttachmentTile.size)
        .fullScreenCover(isPresented: $isPreviewPresented) {
            PhotoAttachmentFullScreenPreview(
                base64: photo.attachment.dataBase64,
                thumbnailImage: previewImage,
                onClose: {
                    DuduLog.record("photos.preview.close")
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
                DuduStyle.sheet
                DuduIcon(.image, size: 22)
                    .foregroundStyle(DuduStyle.muted)
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
            DuduIcon(.close, size: 11, strokeWidth: 2.4)
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
    @State private var isZoomed = false
    @State private var dismissProgress: CGFloat = 0
    @State private var isSaving = false
    @State private var saveFeedback: SaveFeedback?
    @State private var saveFeedbackID = UUID()

    private enum SaveFeedback {
        case saved
        case failed
    }

    private var imageToSave: UIImage? {
        fullSizeImage
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            if let image = fullSizeImage ?? thumbnailImage {
                PhotoZoomingScrollView(
                    image: image,
                    isZoomed: $isZoomed,
                    dismissProgress: $dismissProgress,
                    onDismiss: onClose
                )
                .ignoresSafeArea()
            } else {
                DuduIcon(.camera, size: 36)
                    .foregroundStyle(.white.opacity(0.8))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

        }
        .overlay(alignment: .top) {
            if controlsVisible {
                previewControls
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.16), value: controlsVisible)
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

    private var previewControls: some View {
        HStack {
                Button(action: onClose) {
                    DuduIcon(.close, size: DuduBarGlyph.size)
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(DuduGlassButtonStyle())
                .accessibilityLabel(L10n.text("关闭照片预览"))
                .accessibilityIdentifier("photo.preview.close")

                Spacer()

                Button(action: savePhoto) {
                    Group {
                        if isSaving {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: saveSymbol)
                                .font(.system(size: 18, weight: .regular))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
                }
                .buttonStyle(DuduGlassButtonStyle())
                .disabled(imageToSave == nil || isSaving)
                .opacity(imageToSave == nil ? 0.45 : 1)
                .accessibilityLabel(L10n.text("下载"))
                .accessibilityIdentifier(saveControlIdentifier)
            }
            .padding(.horizontal, 14)
            .padding(.top, 10)
    }

    private var controlsVisible: Bool {
        !isZoomed && dismissProgress < 0.001
    }

    private var saveSymbol: String {
        switch saveFeedback {
        case .saved: "checkmark"
        case .failed: "exclamationmark"
        case nil: "arrow.down.to.line"
        }
    }

    private var saveControlIdentifier: String {
        switch saveFeedback {
        case .saved: "photo.preview.save.saved"
        case .failed: "photo.preview.save.failed"
        case nil: "photo.preview.save"
        }
    }

    @MainActor
    private func savePhoto() {
        guard let image = imageToSave, !isSaving else { return }
        let prepared = PreparedPhotoImage(image: image)
        isSaving = true

        Task {
            let authorization = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
            guard authorization == .authorized || authorization == .limited else {
                finishSave(.failed, state: "permission-denied")
                return
            }

            do {
                try await PreviewPhotoLibrary.shared.save(prepared)
                finishSave(.saved, state: "success")
            } catch {
                DuduLog.networkFailure("photos.preview.save.failed", error: error)
                finishSave(.failed, state: "failed")
            }
        }
    }

    @MainActor
    private func finishSave(_ result: SaveFeedback, state: String) {
        isSaving = false
        saveFeedback = result
        DuduLog.record("photos.preview.save", state: state)
        let resultID = UUID()
        saveFeedbackID = resultID
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            if saveFeedbackID == resultID { saveFeedback = nil }
        }
    }
}

private struct PhotoZoomingScrollView: UIViewRepresentable {
    let image: UIImage
    @Binding var isZoomed: Bool
    @Binding var dismissProgress: CGFloat
    let onDismiss: () -> Void

    fileprivate func makeCoordinator() -> Coordinator {
        Coordinator(isZoomed: $isZoomed, dismissProgress: $dismissProgress, onDismiss: onDismiss)
    }

    func makeUIView(context: Context) -> PhotoZoomScrollView {
        let scrollView = PhotoZoomScrollView()
        scrollView.delegate = context.coordinator
        scrollView.minimumZoomScale = 1
        scrollView.maximumZoomScale = 4
        scrollView.bouncesZoom = true
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.backgroundColor = .clear
        scrollView.clipsToBounds = true
        scrollView.accessibilityIdentifier = "photo.preview.zoom"

        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleAspectFit
        imageView.isAccessibilityElement = true
        imageView.accessibilityLabel = L10n.text("预览照片")
        imageView.frame = .zero
        scrollView.addSubview(imageView)
        context.coordinator.imageView = imageView
        context.coordinator.scrollView = scrollView

        let singleTap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.didTapImage))
        singleTap.cancelsTouchesInView = false
        scrollView.addGestureRecognizer(singleTap)

        let dismissPan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.dismissPanChanged(_:)))
        dismissPan.delegate = context.coordinator
        dismissPan.cancelsTouchesInView = false
        dismissPan.maximumNumberOfTouches = 1
        scrollView.addGestureRecognizer(dismissPan)
        context.coordinator.dismissPan = dismissPan

        scrollView.onResize = { [weak coordinator = context.coordinator, weak scrollView] size in
            guard let scrollView else { return }
            coordinator?.resizeContent(to: size, in: scrollView)
        }
        return scrollView
    }

    func updateUIView(_ scrollView: PhotoZoomScrollView, context: Context) {
        let coordinator = context.coordinator
        coordinator.isZoomed = $isZoomed
        coordinator.dismissProgress = $dismissProgress
        coordinator.onDismiss = onDismiss
        if coordinator.imageView?.image !== image {
            coordinator.imageView?.image = image
            coordinator.resizeContent(to: scrollView.bounds.size, in: scrollView)
        }
    }

    fileprivate final class Coordinator: NSObject, UIScrollViewDelegate, UIGestureRecognizerDelegate {
        var isZoomed: Binding<Bool>
        var dismissProgress: Binding<CGFloat>
        var onDismiss: () -> Void
        weak var imageView: UIImageView?
        weak var scrollView: PhotoZoomScrollView?
        weak var dismissPan: UIPanGestureRecognizer?
        private var viewportSize = CGSize.zero
        private var fittedSize = CGSize.zero

        init(isZoomed: Binding<Bool>, dismissProgress: Binding<CGFloat>, onDismiss: @escaping () -> Void) {
            self.isZoomed = isZoomed
            self.dismissProgress = dismissProgress
            self.onDismiss = onDismiss
        }

        func resizeContent(to size: CGSize, in scrollView: PhotoZoomScrollView) {
            guard size.width > 0, size.height > 0, let imageView, let image = imageView.image,
                  image.size.width > 0, image.size.height > 0 else { return }
            let fit = min(size.width / image.size.width, size.height / image.size.height)
            let fitted = CGSize(width: image.size.width * fit, height: image.size.height * fit)
            guard size != viewportSize || fitted != fittedSize else { return }
            viewportSize = size
            fittedSize = fitted
            scrollView.setZoomScale(1, animated: false)
            imageView.frame = CGRect(origin: .zero, size: fitted)
            scrollView.contentSize = fitted
            scrollView.minimumZoomScale = 1
            scrollView.maximumZoomScale = 4
            scrollView.setZoomScale(1, animated: false)
            scrollViewDidZoom(scrollView)
            updateZoomState(false)
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? {
            imageView
        }

        func scrollViewDidZoom(_ scrollView: UIScrollView) {
            guard let imageView else { return }
            let offsetX = max((scrollView.bounds.width - scrollView.contentSize.width) * 0.5, 0)
            let offsetY = max((scrollView.bounds.height - scrollView.contentSize.height) * 0.5, 0)
            imageView.center = CGPoint(
                x: scrollView.contentSize.width * 0.5 + offsetX,
                y: scrollView.contentSize.height * 0.5 + offsetY
            )
            updateZoomState(scrollView.zoomScale > scrollView.minimumZoomScale + 0.02)
            #if DEBUG && targetEnvironment(simulator)
            scrollView.accessibilityValue = String(format: "%.2f", scrollView.zoomScale)
            #endif
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard gestureRecognizer === dismissPan, let scrollView else { return true }
            guard scrollView.zoomScale <= scrollView.minimumZoomScale + 0.02,
                  let pan = gestureRecognizer as? UIPanGestureRecognizer
            else { return false }
            let velocity = pan.velocity(in: scrollView)
            return velocity.y > 0 && velocity.y > abs(velocity.x) * 1.15
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            gestureRecognizer === dismissPan || otherGestureRecognizer === dismissPan
        }

        @objc func didTapImage() {
            guard let scrollView, scrollView.zoomScale > scrollView.minimumZoomScale + 0.02 else { return }
            scrollView.setZoomScale(scrollView.minimumZoomScale, animated: true)
        }

        @objc func dismissPanChanged(_ recognizer: UIPanGestureRecognizer) {
            guard let scrollView else { return }
            let translation = recognizer.translation(in: scrollView)
            switch recognizer.state {
            case .began, .changed:
                let distance = max(0, translation.y)
                let scale = max(0.82, 1 - distance / 1_700)
                scrollView.transform = CGAffineTransform(translationX: 0, y: distance)
                    .scaledBy(x: scale, y: scale)
                dismissProgress.wrappedValue = min(distance / 440, 0.8)
            case .ended:
                let velocity = recognizer.velocity(in: scrollView).y
                if translation.y > 125 || velocity > 850 {
                    dismissProgress.wrappedValue = 1
                    onDismiss()
                } else {
                    restorePosition(of: scrollView)
                }
            case .cancelled, .failed:
                restorePosition(of: scrollView)
            default:
                break
            }
        }

        private func updateZoomState(_ zoomed: Bool) {
            guard isZoomed.wrappedValue != zoomed else { return }
            isZoomed.wrappedValue = zoomed
        }

        private func restorePosition(of scrollView: UIScrollView) {
            UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
                scrollView.transform = .identity
            }
            dismissProgress.wrappedValue = 0
        }
    }
}

private actor PreviewPhotoLibrary {
    static let shared = PreviewPhotoLibrary()

    func save(_ image: PreparedPhotoImage) async throws {
        try await PHPhotoLibrary.shared().performChanges {
            PHAssetChangeRequest.creationRequestForAsset(from: image.image)
        }
    }
}

private final class PhotoZoomScrollView: UIScrollView {
    var onResize: ((CGSize) -> Void)?
    private var lastBoundsSize = CGSize.zero

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.size != lastBoundsSize else { return }
        lastBoundsSize = bounds.size
        onResize?(bounds.size)
    }
}
