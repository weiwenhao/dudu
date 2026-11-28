import SwiftUI

/// The page that opens when the phone has no computer to talk to. For a phone with none (the first page after the install) and for one whose pairing has to be made again it shows the steps to
/// take on the computer (`ConnectionGuideSteps`; owner, 2026-11-27, proposal 1 of `.local/designs/phone-first-run-2026-11-27/`), and under them the two ways to pair; a phone that has a computer
/// keeps its card with that computer, what the connection is doing and the buttons. A computer that could not be reached is marked on its own row (its name and address in red, a CircleX at the end), the
/// words of it are a short toast at the top, and the phone's own network and address are the line under the card (owner, 2026-11-27).
struct ConnectionGuideView: View {
    /// `root`: the page the app shows when it has no computer to talk to. `adding`: the page that 电脑连接's 「+」 pushes for a phone that has a computer already (owner, 2026-11-27: 「再次添加的时候也跳到连接指南那个窗口吧，
    /// 只是这一次它能返回」, then 「选 A」 of `.local/designs/connection-entry-2026-11-27/boards/add.png`): the same steps, scan and paste, a round back button, and a failed link marked on its own card as on the first connection.
    enum Mode { case root, adding }

    @ObservedObject var store: DuduStore
    var mode: Mode = .root
    var onManualEntry: () -> Void = {}
    var onOpenComputers: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var isScannerPresented = false
    @State private var isPairing = false
    @State private var pairingError: String?
    @State private var phoneNetwork: PhoneNetwork?
    /// `adding` only: the link that was tried and could not be reached. The store keeps nothing of it (it goes back to the computer it had), so the page holds it, and 重新连接 tries it again.
    @State private var addingAttempt: PairingAttempt?
    @State private var isPasteFormPresented = false

    private var isAdding: Bool { mode == .adding }

    /// The red of a failure on this page (the line under a computer used it already).
    private static let failureRed = Color(red: 0.67, green: 0.29, blue: 0.27)

    private var isConnecting: Bool {
        isAdding ? isPairing : (store.isRestoring || store.status == .connecting || isPairing)
    }

    private var needsNewPairing: Bool {
        !isAdding && store.connectionFailure?.requiresNewPairing == true
    }

    private var showsRetry: Bool {
        if isAdding { return addingAttempt != nil }
        return !needsNewPairing && (!store.computers.isEmpty || store.connectionFailure != nil)
    }

    /// The card with a computer on it: the saved one, or the one a pairing tried and could not reach.
    private var showsCard: Bool {
        isAdding ? addingAttempt != nil : !(store.computers.isEmpty && store.failedPairing == nil)
    }

    /// The computer of the card: the saved one, or the one a first connection tried and could not reach (nothing is saved then).
    private var cardComputer: (name: String, address: String)? {
        if isAdding { return addingAttempt.map { ($0.name, $0.address) } }
        if let computer = store.activeComputer ?? store.computers.first { return (computer.name, computer.shortAddress) }
        if let attempt = store.failedPairing { return (attempt.name, attempt.address) }
        return nil
    }

    /// The steps were the line under the title in the same two cases: no computer yet, or a pairing that has to be made again.
    private var showsSteps: Bool {
        isAdding ? addingAttempt == nil : ((store.computers.isEmpty && store.failedPairing == nil) || needsNewPairing)
    }

    private var statusMessage: String? {
        isAdding ? pairingError : (pairingError ?? connectionMessage)
    }

    /// The computer of the card could not be reached, or its pairing is no longer valid, and nothing is going on now.
    private var computerFailed: Bool {
        cardComputer != nil && !isConnecting && statusMessage != nil
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
                        if computerFailed, let phoneNetwork {
                            Text(phoneNetwork.footnote)
                                .font(.system(size: 12))
                                .foregroundStyle(DuduStyle.muted)
                                .frame(maxWidth: .infinity)
                                .padding(.top, -4)
                                .accessibilityIdentifier("connection.phone")
                        }
                    }
                    .frame(maxWidth: 380)
                    .padding(.top, 28)

                    // Leave a little more room below the guide so its group sits above vertical center.
                    Spacer(minLength: 72)
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 24)
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .background((isAdding ? DuduStyle.sheet : DuduStyle.canvas).ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("connection.guide")
        .fullScreenCover(isPresented: $isScannerPresented) {
            QRScannerView { link in
                isScannerPresented = false
                Task { await pair(link) }
            }
        }
        .sheet(isPresented: $isPasteFormPresented) {
            NavigationStack {
                PairingView(
                    store: store,
                    embeddedInSettings: true,
                    onPaired: {
                        isPasteFormPresented = false
                        dismiss()
                    },
                    onFailed: { attempt, words in
                        addingAttempt = attempt
                        pairingError = words
                        phoneNetwork = PhoneNetwork.current()
                    },
                    startsWithManualEntry: true
                )
            }
            .presentationDetents(PairingView.detents)
            .presentationDragIndicator(.hidden)
            .presentationCornerRadius(32)
            .presentationBackground(DuduStyle.settingsBackground)
        }
        .modifier(AddingPageChrome(isAdding: isAdding))
        .task { DuduLog.record(isAdding ? "connection.guide.add" : "connection.guide.open") }
        .task(id: computerFailed) {
            if computerFailed { phoneNetwork = PhoneNetwork.current() }
        }
    }

    /// Put the actions on the saved or attempted computer's card when there is one.
    @ViewBuilder
    private var actions: some View {
        if !showsCard {
            buttons.accessibilityIdentifier("connection.card")
        } else {
            VStack(alignment: .leading, spacing: 20) {
                computerRow
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
        if let shown = cardComputer {
            if !isAdding && !store.computers.isEmpty {
                Button(action: onOpenComputers) { rowContent(shown, selectable: true) }
                    .buttonStyle(DuduRowButtonStyle())
                    .accessibilityLabel(L10n.text("选择电脑，当前为{0}", "\(shown.name)"))
                    .accessibilityIdentifier("connection.computers")
            } else {
                rowContent(shown, selectable: false)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel([shown.name, shown.address].joined(separator: "，"))
                    .accessibilityIdentifier("connection.computer")
            }
        }
    }

    private func rowContent(_ shown: (name: String, address: String), selectable: Bool) -> some View {
        let failed = computerFailed
        return HStack(spacing: 12) {
            DuduIcon(.computer, size: 22)
                .foregroundStyle(DuduStyle.ink)
            VStack(alignment: .leading, spacing: 5) {
                Text(shown.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(failed ? Self.failureRed : DuduStyle.ink)
                    .lineLimit(1)
                Text(shown.address)
                    .font(.system(size: 12))
                    .foregroundStyle(failed ? Self.failureRed : DuduStyle.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 4)
            if failed {
                DuduIcon(.connectionFailed, size: 20)
                    .foregroundStyle(DuduStyle.chatError)
                    .accessibilityHidden(true)
            }
            if selectable {
                DuduIcon(.select, size: 17)
                    .foregroundStyle(DuduStyle.muted)
            }
        }
        .foregroundStyle(DuduStyle.ink)
        .frame(minHeight: 54)
        .contentShape(Rectangle())
    }

    private var buttons: some View {
        VStack(spacing: 12) {
            Button {
                pairingError = nil
                if showsRetry {
                    DuduLog.record("connection.guide.retry")
                    Task {
                        if isAdding, let attempt = addingAttempt {
                            await pair(attempt.link)
                        } else if let attempt = store.failedPairing, store.computers.isEmpty {
                            await pair(attempt.link)
                        } else {
                            await store.reconnect()
                            if let failure = store.connectionFailure {
                                TopToast.shared.showConnectionFailure(failure.localizedDescription)
                            }
                        }
                    }
                } else {
                    isScannerPresented = true
                    DuduLog.record("pairing.scan")
                }
            } label: {
                HStack(spacing: 10) {
                    if isConnecting {
                        ProgressView().controlSize(.small).tint(.white)
                            .frame(width: 21, height: 21)
                    } else {
                        DuduIcon(showsRetry ? .reconnect : .scan, size: 21)
                    }
                    Text(isConnecting ? L10n.text("正在连接…") :
                            showsRetry ? L10n.text("重新连接") :
                            needsNewPairing ? L10n.text("重新扫码配对") : L10n.text("扫描配对码"))
                        .font(.system(size: 16, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(DuduStyle.blue, in: Capsule())
                .contentShape(Capsule())
            }
            .buttonStyle(DuduIconButtonStyle())
            .disabled(isConnecting)
            .opacity(isConnecting ? 0.5 : 1)
            .accessibilityIdentifier(showsRetry ? "connection.retry" : "pairing.scan")

            Button {
                if isAdding {
                    isPasteFormPresented = true
                    DuduLog.record("pairing.manual")
                } else {
                    onManualEntry()
                }
            } label: {
                Text(L10n.text("粘贴配对链接"))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(DuduStyle.ink)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(DuduStyle.selected.opacity(0.65), in: Capsule())
                    .contentShape(Capsule())
            }
            .buttonStyle(DuduIconButtonStyle())
            .disabled(isConnecting)
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
            if isAdding { dismiss() }
        } catch is CancellationError {
            // The app left the screen while it was connecting: nothing to say.
        } catch {
            pairingError = error.localizedDescription
            if isAdding, let attempt = PairingAttempt(link: link) { addingAttempt = attempt }
            TopToast.shared.showConnectionFailure(error.localizedDescription)
        }
    }
}

/// The chrome of the page when 电脑连接 pushes it: the system's round back button with the chevron alone (the edge swipe works), no title, the sheet's own background behind the bar.
private struct AddingPageChrome: ViewModifier {
    let isAdding: Bool

    func body(content: Content) -> some View {
        if isAdding {
            content
                .navigationBarBackButtonHidden(false)
                .minimalBackButton()
                .tint(DuduStyle.ink)
                .navigationBarTitleDisplayMode(.inline)
                .toolbarBackground(DuduStyle.sheet, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .toolbarColorScheme(.light, for: .navigationBar)
                .hidesTabBarWhenPushed()
        } else {
            content
        }
    }
}
