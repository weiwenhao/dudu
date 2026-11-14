import SwiftUI

struct PairingView: View {
    @ObservedObject var store: DSBotStore
    var embeddedInSettings = false
    var initialLink: String?
    var onPaired: (() -> Void)?
    var showsCancelButton: Bool

    @Environment(\.dismiss) private var dismiss
    @State private var isManualEntry: Bool
    @State private var isScannerPresented = false
    @State private var link: String
    @State private var computerName = ""
    @State private var errorMessage: String?
    @State private var isPairing = false
    @FocusState private var activeField: Field?

    private enum Field: Hashable {
        case link, name
    }

    init(
        store: DSBotStore,
        embeddedInSettings: Bool = false,
        initialLink: String? = nil,
        onPaired: (() -> Void)? = nil,
        showsCancelButton: Bool = true,
        startsWithManualEntry: Bool = false
    ) {
        self.store = store
        self.embeddedInSettings = embeddedInSettings
        self.initialLink = initialLink
        self.onPaired = onPaired
        self.showsCancelButton = showsCancelButton
        _isManualEntry = State(initialValue: startsWithManualEntry || initialLink != nil)
        _link = State(initialValue: initialLink ?? "")
        _computerName = State(initialValue: initialLink.map { pairingName(from: $0) } ?? "")
    }

    private var pairingContent: some View {
        VStack(spacing: 0) {
            if !embeddedInSettings {
                Spacer(minLength: 30)
                DuduLogo(size: 72)
                    .padding(.bottom, 22)
                Text(L10n.text("连接电脑上的 DSH"))
                    .font(.system(size: 23, weight: .semibold))
                    .foregroundStyle(DSBotStyle.ink)
                    .padding(.bottom, 7)
            }

            VStack(spacing: 12) {
                Button {
                    DSBotLog.record("pairing.scan")
                    isScannerPresented = true
                } label: {
                    DSBotLabel(L10n.text("扫描配对码"), icon: .scan)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 50)
                        .background(DSBotStyle.blue, in: Capsule())
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
                        errorMessage = nil
                        DSBotLog.record("pairing.manual")
                    } label: {
                        Text(L10n.text("粘贴配对链接"))
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(DSBotStyle.ink)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("pairing.manual")
                }
            }
            .padding(.horizontal, 20)

            Spacer(minLength: 30)
        }
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                pairingContent
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(DSBotStyle.sheet.ignoresSafeArea())
        .navigationTitle(embeddedInSettings ? L10n.text("添加电脑") : "")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if embeddedInSettings && showsCancelButton {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(L10n.text("取消")) { dismiss() }
                        .foregroundStyle(DSBotStyle.ink)
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
                computerName = pairingName(from: scannedLink)
                Task { await pairComputer(scannedLink) }
            }
        }
        .onChange(of: initialLink) { _, value in
            guard let value, !value.isEmpty else { return }
            link = value
            computerName = pairingName(from: value)
            isManualEntry = true
            errorMessage = nil
        }
    }

    private var manualForm: some View {
        VStack(alignment: .leading, spacing: 15) {
            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.text("配对链接"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSBotStyle.ink)
                TextField(L10n.text("粘贴电脑生成的完整链接"), text: $link, axis: .vertical)
                    .focused($activeField, equals: .link)
                    .font(.system(size: 15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .lineLimit(2...4)
                    .padding(13)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 13))
                    .overlay(RoundedRectangle(cornerRadius: 13).stroke(DSBotStyle.line, lineWidth: 1))
                    .accessibilityIdentifier("pairing.link")
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(L10n.text("电脑名称"))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSBotStyle.ink)
                TextField(L10n.text("选填"), text: $computerName)
                    .focused($activeField, equals: .name)
                    .submitLabel(.done)
                    .onSubmit { activeField = nil }
                    .font(.system(size: 15))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(13)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 13))
                    .overlay(RoundedRectangle(cornerRadius: 13).stroke(DSBotStyle.line, lineWidth: 1))
            }

            if let errorMessage, !errorMessage.isEmpty {
                Text(errorMessage)
                    .font(.system(size: 13))
                    .foregroundStyle(Color(red: 0.71, green: 0.31, blue: 0.29))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isStaticText)
            }

            Button {
                Task { await pairComputer(link) }
            } label: {
                HStack(spacing: 9) {
                    if isPairing { ProgressView().tint(.white) }
                    Text(L10n.text("添加并连接"))
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(DSBotStyle.blue, in: Capsule())
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
        guard !trimmed.isEmpty else {
            errorMessage = L10n.text("请输入配对链接")
            return
        }

        isPairing = true
        activeField = nil
        errorMessage = nil
        DSBotLog.record("pairing.connect")
        do {
            try await store.pair(link: trimmed, name: computerName.trimmingCharacters(in: .whitespacesAndNewlines))
            DSBotLog.record("pairing.success")
            onPaired?()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isPairing = false
    }
}

private func pairingName(from value: String) -> String {
    guard let components = URLComponents(string: value) else { return "" }
    return components.queryItems?.first(where: { $0.name == "name" })?.value ?? ""
}
