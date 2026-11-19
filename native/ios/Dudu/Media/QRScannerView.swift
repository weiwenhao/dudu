import AVFoundation
import SwiftUI
import UIKit

struct QRScannerView: View {
    let onScan: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @StateObject private var scanner = QRScannerController()

    var body: some View {
        ZStack {
            QRScannerPreview(session: scanner.session)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                HStack {
                    Button {
                        dismiss()
                    } label: {
                        DuduIcon(.close, size: 22)
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(.black.opacity(0.25), in: Circle())
                    }
                    .buttonStyle(.plain)
                    Spacer()
                }
                .padding(.horizontal, 18)
                .padding(.top, 12)

                Spacer()

                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .stroke(.white.opacity(0.9), lineWidth: 2)
                    .frame(width: 248, height: 248)
                    .overlay {
                        DuduIcon(.focus, size: 248)
                            .foregroundStyle(.white.opacity(0.14))
                    }

                if let message = scanner.message {
                    Text(message)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                        .padding(.top, 22)
                } else {
                    Text(L10n.text("对准电脑上显示的配对码"))
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white)
                        .padding(.top, 22)
                }

                Spacer()
            }
        }
        .background(Color.black)
        .statusBarHidden()
        .onAppear { scanner.start() }
        .onDisappear { scanner.stop() }
        .onChange(of: scanner.scannedValue) { _, value in
            guard let value else { return }
            onScan(value)
        }
    }
}

private final class QRScannerController: NSObject, ObservableObject, AVCaptureMetadataOutputObjectsDelegate {
    let session = AVCaptureSession()
    @Published var scannedValue: String?
    @Published var message: String?

    private let sessionQueue = DispatchQueue(label: "com.harnessmobile.dudu.qr-camera")
    private let generationLock = NSLock()
    private var generation = 0
    private var configured = false
    private var deliveredResult = false

    func start() {
        let token = updateGeneration()
        deliveredResult = false
        message = nil

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            sessionQueue.async { [weak self] in self?.configureAndRun(token: token) }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                guard let self, self.isCurrent(token) else { return }
                if granted {
                    self.sessionQueue.async { [weak self] in self?.configureAndRun(token: token) }
                } else {
                    DispatchQueue.main.async { self.message = L10n.text("需要相机权限才能扫描配对码。") }
                }
            }
        default:
            message = L10n.text("请在系统设置中允许相机访问。")
        }
    }

    func stop() {
        _ = updateGeneration()
        sessionQueue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.session.stopRunning()
        }
    }

    private func configureAndRun(token: Int) {
        guard isCurrent(token) else { return }

        if !configured {
            session.beginConfiguration()
            session.sessionPreset = .high
            defer { session.commitConfiguration() }

            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else {
                showMessage(L10n.text("无法启动相机。"))
                return
            }
            session.addInput(input)

            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else {
                showMessage(L10n.text("无法读取配对码。"))
                return
            }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            guard output.availableMetadataObjectTypes.contains(.qr) else {
                showMessage(L10n.text("此相机不支持二维码扫描。"))
                return
            }
            output.metadataObjectTypes = [.qr]
            configured = true
        }

        guard isCurrent(token), !session.isRunning else { return }
        session.startRunning()
    }

    private func updateGeneration() -> Int {
        generationLock.lock()
        defer { generationLock.unlock() }
        generation += 1
        return generation
    }

    private func isCurrent(_ token: Int) -> Bool {
        generationLock.lock()
        defer { generationLock.unlock() }
        return generation == token
    }

    private func showMessage(_ text: String) {
        DispatchQueue.main.async { [weak self] in self?.message = text }
    }

    func metadataOutput(
        _ output: AVCaptureMetadataOutput,
        didOutput metadataObjects: [AVMetadataObject],
        from connection: AVCaptureConnection
    ) {
        guard !deliveredResult,
              let value = metadataObjects
                .compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue })
                .first
        else { return }

        deliveredResult = true
        DispatchQueue.main.async { [weak self] in self?.scannedValue = value }
    }
}

private struct QRScannerPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> QRPreviewView {
        let view = QRPreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ uiView: QRPreviewView, context: Context) {
        if uiView.previewLayer.session !== session {
            uiView.previewLayer.session = session
        }
    }
}

private final class QRPreviewView: UIView {
    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
}
