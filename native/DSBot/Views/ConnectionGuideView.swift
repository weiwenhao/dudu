import SwiftUI

struct ConnectionGuideView: View {
    @ObservedObject var store: DSBotStore
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
                            Text("连接电脑上的 DSH")
                                .font(.system(size: 29, weight: .medium))
                                .tracking(-0.7)
                                .foregroundStyle(DSBotStyle.ink)
                                .multilineTextAlignment(.center)

                            Text("在电脑的「设置 → 手机控制」中生成配对码")
                                .font(.system(size: 14))
                                .foregroundStyle(DSBotStyle.muted)
                                .multilineTextAlignment(.center)
                                .opacity(store.computers.isEmpty || needsNewPairing ? 1 : 0)
                                .accessibilityHidden(!store.computers.isEmpty && !needsNewPairing)
                        }
                    }

                    VStack(alignment: .leading, spacing: 20) {
                        if let computer = store.activeComputer ?? store.computers.first {
                            Button(action: onOpenComputers) {
                                HStack(spacing: 12) {
                                    DSBotIcon(.computer, size: 22)
                                    VStack(alignment: .leading, spacing: 5) {
                                        Text(computer.name)
                                            .font(.system(size: 15, weight: .medium))
                                            .lineLimit(1)
                                        Text(computer.displayAddress)
                                            .font(.system(size: 12))
                                            .foregroundStyle(DSBotStyle.muted)
                                            .lineLimit(1)
                                            .truncationMode(.middle)
                                    }
                                    Spacer(minLength: 4)
                                    DSBotIcon(.select, size: 17)
                                        .foregroundStyle(DSBotStyle.muted)
                                }
                                .foregroundStyle(DSBotStyle.ink)
                                .frame(minHeight: 54)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(DSBotRowButtonStyle())
                            .accessibilityLabel("选择电脑，当前为\(computer.name)")
                            .accessibilityIdentifier("connection.computers")
                        }

                        ZStack(alignment: .leading) {
                            if isConnecting {
                                HStack(spacing: 9) {
                                    ProgressView().controlSize(.small)
                                    Text("正在连接…")
                                        .font(.system(size: 14))
                                }
                                .foregroundStyle(DSBotStyle.muted)
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
                                    DSBotLog.record("connection.guide.retry")
                                    Task { await store.reconnect() }
                                } else {
                                    isScannerPresented = true
                                    DSBotLog.record("pairing.scan")
                                }
                            } label: {
                                DSBotLabel(
                                    showsRetry ? "重新连接" : (needsNewPairing ? "重新扫码配对" : "扫描配对码"),
                                    icon: showsRetry ? .reconnect : .scan
                                )
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, minHeight: 52)
                                .background(DSBotStyle.blue, in: Capsule())
                                .contentShape(Capsule())
                            }
                            .buttonStyle(DSBotIconButtonStyle())
                            .disabled(store.isRestoring || isPairing || (showsRetry && isConnecting))
                            .opacity(showsRetry && isConnecting ? 0.5 : 1)
                            .accessibilityIdentifier(showsRetry ? "connection.retry" : "pairing.scan")

                            Button(action: onManualEntry) {
                                Text("粘贴配对链接")
                                    .font(.system(size: 15, weight: .medium))
                                    .foregroundStyle(DSBotStyle.ink)
                                    .frame(maxWidth: .infinity, minHeight: 48)
                                    .background(DSBotStyle.selected.opacity(0.65), in: Capsule())
                                    .contentShape(Capsule())
                            }
                            .buttonStyle(DSBotIconButtonStyle())
                            .disabled(store.isRestoring || isPairing)
                            .accessibilityIdentifier("pairing.manual")
                        }
                    }
                    .padding(20)
                    .dsbotGlass(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
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
        .background(DSBotStyle.canvas.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("connection.guide")
        .fullScreenCover(isPresented: $isScannerPresented) {
            QRScannerView { link in
                isScannerPresented = false
                Task { await pair(link) }
            }
        }
        .task { DSBotLog.record("connection.guide.open") }
    }

    private var connectionMessage: String? {
        switch store.connectionFailure {
        case .remote("AUTH_FAILED"), .remote("UNAUTHORIZED"):
            return "配对已失效"
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
        DSBotLog.record("pairing.connect")
        do {
            try await store.pair(link: link)
            DSBotLog.record("pairing.success")
        } catch {
            pairingError = error.localizedDescription
        }
    }
}
