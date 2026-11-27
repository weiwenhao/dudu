import LucideSwift
import SwiftUI
import UIKit

struct PairingView: View {
    static let detents: Set<PresentationDetent> = [.height(304), .large]

    @ObservedObject var store: DuduStore
    var embeddedInSettings = false
    var initialLink: String?
    var onPaired: (() -> Void)?
    /// What was tried and the words of why it failed, when a link the phone could read did not connect (the connection guide of a phone that has a computer shows it on its card).
    var onFailed: ((PairingAttempt, String) -> Void)?
    var showsCancelButton: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var isManualEntry: Bool
    @State private var isScannerPresented = false
    @State private var link: String
    @State private var isPairing = false
    @FocusState private var activeField: Field?

    private enum Field: Hashable {
        case link
    }

    init(
        store: DuduStore,
        embeddedInSettings: Bool = false,
        initialLink: String? = nil,
        onPaired: (() -> Void)? = nil,
        onFailed: ((PairingAttempt, String) -> Void)? = nil,
        showsCancelButton: Bool = true,
        startsWithManualEntry: Bool = false
    ) {
        self.store = store
        self.embeddedInSettings = embeddedInSettings
        self.initialLink = initialLink
        self.onPaired = onPaired
        self.onFailed = onFailed
        self.showsCancelButton = showsCancelButton
        _isManualEntry = State(initialValue: startsWithManualEntry || initialLink != nil)
        _link = State(initialValue: initialLink ?? "")
    }

    private var pairingContent: some View {
        VStack(spacing: 0) {
            if !embeddedInSettings {
                Spacer(minLength: 30)
                DuduLogo(size: 72)
                    .padding(.bottom, 22)
                Text(L10n.text("连接电脑上的 DSH"))
                    .font(.system(size: 23, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                    .padding(.bottom, 7)
            }

            VStack(spacing: 12) {
                Button {
                    DuduLog.record("pairing.scan")
                    isScannerPresented = true
                } label: {
                    DuduLabel(L10n.text("扫描配对码"), icon: .scan)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(DuduStyle.blue, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isPairing)
                .accessibilityIdentifier("pairing.scan")

                if isManualEntry {
                    manualForm
                        .transition(.move(edge: .top).combined(with: .opacity))
                } else {
                    Button {
                        isManualEntry = true
                        DuduLog.record("pairing.manual")
                    } label: {
                        Text(L10n.text("粘贴配对链接"))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(DuduStyle.ink)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("pairing.manual")
                }
            }
            .padding(.horizontal, 20)

        }
    }

    var body: some View {
        ScrollView {
            pairingContent
                .padding(.top, 8)
                .padding(.bottom, 16)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
        .background(DuduStyle.sheet.ignoresSafeArea())
        .interactiveDismissDisabled(isPairing)
        .navigationTitle(embeddedInSettings ? L10n.text("添加电脑") : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if embeddedInSettings && showsCancelButton {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton(label: L10n.text("取消")) { dismiss() }
                        .disabled(isPairing)
                }
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button(L10n.text("完成")) { activeField = nil }
            }
        }
        .fullScreenCover(isPresented: $isScannerPresented) {
            QRScannerView { scannedLink in
                isScannerPresented = false
                link = scannedLink
                Task { await pairComputer(scannedLink) }
            }
        }
        .onChange(of: initialLink) { _, value in
            guard let value, !value.isEmpty else { return }
            link = value
            isManualEntry = true
        }
    }

    private var manualForm: some View {
        VStack(alignment: .leading, spacing: 15) {
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.text("配对链接"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DuduStyle.ink)
                TextField(L10n.text("粘贴电脑生成的完整链接"), text: $link, axis: .vertical)
                    .focused($activeField, equals: .link)
                    .accessibilityIdentifier("pairing.link")
                    .font(.system(size: 15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .lineLimit(1...4)
                    .padding(.leading, 13)
                    // Room for the paste icon while the field is empty (it is one line high then, and grows with what is pasted or typed).
                    .padding(.trailing, link.isEmpty ? 48 : 13)
                    .padding(.vertical, 15)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 13))
                    .overlay(RoundedRectangle(cornerRadius: 13).stroke(DuduStyle.line, lineWidth: 1))
                    .overlay(alignment: .trailing) {
                        if link.isEmpty {
                            PasteIconButton { link = $0 }
                                .padding(.trailing, 6)
                        }
                    }
            }

            Button {
                Task { await pairComputer(link) }
            } label: {
                HStack(spacing: 9) {
                    if isPairing { ProgressView().tint(.white) }
                    Text(L10n.text("连接"))
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(DuduStyle.blue, in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(isPairing || link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("pairing.connect")
        }
        .padding(16)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    @MainActor
    private func pairComputer(_ value: String) async {
        guard !isPairing else { return }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        isPairing = true
        activeField = nil
        DuduLog.record("pairing.connect")
        do {
            try await store.pair(link: trimmed)
            DuduLog.record("pairing.success")
            onPaired?()
            dismiss()
        } catch is CancellationError {
            // The app left the screen while it was connecting: nothing to say.
        } catch {
            // Show the same short error toast as the connection guide.
            let words = error.localizedDescription
            if let attempt = PairingAttempt(link: trimmed) { onFailed?(attempt, words) }
            TopToast.shared.showConnectionFailure(words)
        }
        isPairing = false
    }
}

/// Only the clipboard glyph (owner, 2026-11-27: 「类似复制一样的小按钮，不需要颜色，不需要文案描述」, and 「它还有灰色的背景圆框」): no word, no colour, no background. What takes the tap is the system's paste control, hidden
/// behind the glyph (it pastes without the 「允许粘贴」 question; one that is nearly transparent is refused by the system, so it is hidden by the blend mode instead, as tried in the simulator on 2026-11-27).
private struct PasteIconButton: View {
    var onPaste: (String) -> Void
    @State private var hasText = UIPasteboard.general.hasStrings

    var body: some View {
        ZStack {
            LucideIcon(.clipboard, size: 18, strokeWidth: 2, absoluteStrokeWidth: false)
                .foregroundStyle(DuduStyle.ink)
                .opacity(hasText ? 1 : 0.35)
                .accessibilityHidden(true)
            PasteButton(payloadType: String.self) { strings in
                if let text = strings.first { onPaste(text) }
            }
            .labelStyle(.iconOnly)
            .blendMode(.destinationOver)
        }
        .frame(width: 36, height: 36)
        .accessibilityIdentifier("pairing.paste")
        .onReceive(NotificationCenter.default.publisher(for: UIPasteboard.changedNotification)) { _ in
            hasText = UIPasteboard.general.hasStrings
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didBecomeActiveNotification)) { _ in
            hasText = UIPasteboard.general.hasStrings
        }
    }
}
