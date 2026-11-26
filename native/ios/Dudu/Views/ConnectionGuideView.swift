import SwiftUI

/// The page that opens when the phone has no computer to talk to. For a phone with none (the first page after the install) and for one whose pairing has to be made again it shows the steps to
/// take on the computer (`ConnectionGuideSteps`; owner, 2026-11-27, proposal 1 of `.local/designs/phone-first-run-2026-11-27/`), and under them the two ways to pair; a phone that has a computer
/// keeps its card with that computer, what the connection is doing and the buttons.
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

    /// The steps were the line under the title in the same two cases: no computer yet, or a pairing that has to be made again.
    private var showsSteps: Bool {
        store.computers.isEmpty || needsNewPairing
    }

    private var statusMessage: String? {
        pairingError ?? connectionMessage
    }

    private var hasStatus: Bool {
        isConnecting || statusMessage != nil
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)

                    VStack(spacing: 14) {
                        DuduLogo(size: 64)

                        Text(L10n.text("连接嘟嘟"))
                            .font(.system(size: 29, weight: .medium))
                            .tracking(-0.7)
                            .foregroundStyle(DuduStyle.ink)
                            .multilineTextAlignment(.center)
                    }

                    VStack(spacing: 18) {
                        if showsSteps {
                            ConnectionGuideSteps()
                                .padding(20)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .duduGlass(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
                        }
                        actions
                    }
                    .frame(maxWidth: 380)
                    .padding(.top, 28)

                    Spacer(minLength: 24)
                }
                .padding(.horizontal, 22)
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

    /// A phone with a computer has it, what the connection is doing and the buttons in one card. A phone without one has only the buttons, on the page itself under the steps, and a line above
    /// them when there is something to say.
    @ViewBuilder
    private var actions: some View {
        if store.computers.isEmpty {
            VStack(spacing: 18) {
                if hasStatus {
                    statusLine.frame(maxWidth: .infinity, alignment: .leading)
                }
                buttons
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("connection.card")
        } else {
            VStack(alignment: .leading, spacing: 20) {
                computerRow

                ZStack(alignment: .leading) {
                    statusLine
                }
                .frame(maxWidth: .infinity, minHeight: 20, alignment: .leading)

                buttons
            }
            .padding(20)
            .duduGlass(in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("connection.card")
        }
    }

    @ViewBuilder
    private var computerRow: some View {
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
    }

    @ViewBuilder
    private var statusLine: some View {
        if isConnecting {
            HStack(spacing: 9) {
                ProgressView().controlSize(.small)
                Text(L10n.text("正在连接…"))
                    .font(.system(size: 14))
            }
            .foregroundStyle(DuduStyle.muted)
            .accessibilityIdentifier("connection.progress")
        } else if let message = statusMessage {
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(Color(red: 0.67, green: 0.29, blue: 0.27))
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("connection.failure")
        }
    }

    private var buttons: some View {
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
