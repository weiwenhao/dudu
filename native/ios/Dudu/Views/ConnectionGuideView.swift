import SwiftUI

struct ConnectionGuideView: View {
    @ObservedObject var store: DuduStore
    var onManualEntry: () -> Void
    var onOpenComputers: () -> Void

    @State private var isScannerPresented = false
    @State private var isPairing = false
    @State private var pairingError: String?

    private var isConnecting: Bool {
        store.isRestoring || store.status == .connecting || isPairing
    }

    private var needsNewPairing: Bool {
        store.connectionFailure?.requiresNewPairing == true
    }

    private var showsRetry: Bool {
        !needsNewPairing && (!store.computers.isEmpty || store.connectionFailure != nil)
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 28) {
                    Spacer(minLength: 24)

                    VStack(spacing: 20) {
                        DuduLogo(size: 76)

                        VStack(spacing: 12) {
                            Text(L10n.text("连接嘟嘟"))
                                .font(.system(size: 29, weight: .medium))
                                .tracking(-0.7)
                                .foregroundStyle(DuduStyle.ink)
                                .multilineTextAlignment(.center)

                            Text(L10n.text("打开 DSH 并安装嘟嘟插件，在嘟嘟设置中打开配对二维码"))
                                .font(.system(size: 14))
                                .foregroundStyle(DuduStyle.muted)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                                .fixedSize(horizontal: false, vertical: true)
                                .opacity(store.computers.isEmpty || needsNewPairing ? 1 : 0)
                                .accessibilityHidden(!store.computers.isEmpty && !needsNewPairing)
                        }
                    }
                    .frame(maxWidth: 380)

                    VStack(alignment: .leading, spacing: 20) {
                        if let computer = store.activeComputer ?? store.computers.first {
                            Button(action: onOpenComputers) {
                                HStack(spacing: 12) {
                                    DuduIcon(.computer, size: 22)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(computer.name)
                                            .font(.system(size: 15, weight: .medium))
                                            .lineLimit(1)
                                        Text(computer.displayAddress)
                                            .font(.system(size: 12))
                                            .foregroundStyle(DuduStyle.muted)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                    }
                                    Spacer(minLength: 4)
                                    DuduIcon(.select, size: 17)
                                        .foregroundStyle(DuduStyle.muted)
                                }
                                .foregroundStyle(DuduStyle.ink)
                                .frame(minHeight: 54)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(DuduRowButtonStyle())
                            .accessibilityLabel(L10n.text("选择电脑，当前为{0}", "\(computer.name)"))
                            .accessibilityIdentifier("connection.computers")
                        }

                        ZStack(alignment: .leading) {
                            if isConnecting {
                                HStack(spacing: 9) {
                                    ProgressView().controlSize(.small)
                                    Text(L10n.text("正在连接…"))
                                        .font(.system(size: 14))
                                }
                                .foregroundStyle(DuduStyle.muted)
                                .accessibilityIdentifier("connection.progress")
                            } else if let message = pairingError ?? connectionMessage {
                                Text(message)
                                    .font(.system(size: 14))
                                    .foregroundStyle(Color(red: 0.67, green: 0.29, blue: 0.27))
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .accessibilityIdentifier("connection.failure")
                            }
                        }
                        .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)

                        VStack(spacing: 12) {
                            Button {
                                pairingError = nil
                                if showsRetry {
                                    DuduLog.record("connection.guide.retry")
                                    Task { await store.reconnect() }
                                } else {
                                    isScannerPresented = true
                                    DuduLog.record("pairing.scan")
                                }
                            } label: {
                                DuduLabel(
                                    showsRetry ? L10n.text("重新连接") : (needsNewPairing ? L10n.text("重新扫码配对") : L10n.text("扫描配对码")),
                                    icon: showsRetry ? .reconnect : .scan
                                )
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, minHeight: 52)
                                .background(DuduStyle.blue, in: Capsule())
                                .contentShape(Capsule())
                            }
                            .buttonStyle(DuduIconButtonStyle())
                            .disabled(store.isRestoring || isPairing || (showsRetry && isConnecting))
                            .opacity(showsRetry && isConnecting ? 0.5 : 1)
                            .accessibilityIdentifier(showsRetry ? "connection.retry" : "pairing.scan")

                            Button(action: onManualEntry) {
                                Text(L10n.text("粘贴配对链接"))
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(DuduStyle.ink)
                                    .frame(maxWidth: .infinity, minHeight: 48)
                                    .background(DuduStyle.selected.opacity(0.65), in: Capsule())
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(DuduIconButtonStyle())
                            .disabled(store.isRestoring || isPairing)
                            .accessibilityIdentifier("pairing.manual")
                        }
                    }
                    .padding(20)
                    .duduGlass(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                    .frame(maxWidth: 380)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("connection.card")

                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 24)
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background(DuduStyle.canvas.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("connection.guide")
        .fullScreenCover(isPresented: $isScannerPresented) {
            QRScannerView { link in
                isScannerPresented = false
                Task { await pair(link) }
            }
        }
        .task { DuduLog.record("connection.guide.open") }
    }

    private var connectionMessage: String? {
        switch store.connectionFailure {
        case .remote("AUTH_FAILED"), .remote("UNAUTHORIZED"):
            return L10n.text("配对已失效")
        default:
            return store.connectionFailure?.localizedDescription
        }
    }

    @MainActor
    private func pair(_ link: String) async {
        guard !isPairing else { return }
        isPairing = true
        pairingError = nil
        defer { isPairing = false }
        DuduLog.record("pairing.connect")
        do {
            try await store.pair(link: link)
            DuduLog.record("pairing.success")
        } catch {
            pairingError = error.localizedDescription
        }
    }
}
