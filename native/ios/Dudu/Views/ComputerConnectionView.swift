import SwiftUI

struct ComputerConnectionView: View {
    @ObservedObject var store: DuduStore
    let computerID: String
    @State private var drafts: [AddressDraft]?
    @State private var isSaving = false
    @FocusState private var focusedAddress: Int?

    private struct AddressDraft: Equatable {
        let kind: ConnectionAddressKind
        var value: String
    }

    private var computer: Computer? { store.computers.first { $0.id == computerID } }
    private var isActive: Bool { store.activeComputer?.id == computerID }
    private var status: ConnectionStatus { isActive ? store.status : .disconnected }
    private var canEditAddresses: Bool {
        guard let computer, let endpoint = try? ConnectionEndpoint.saved(computer) else { return false }
        return endpoint.probeId != nil
    }
    private var isBusy: Bool { isSaving || status == .connecting }

    var body: some View {
        ScrollView {
            if let computer {
                VStack(spacing: 22) {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) {
                            Text(L10n.text("连接状态"))
                            Spacer(minLength: 8)
                            connectionState(computer).fixedSize()
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text(L10n.text("连接状态"))
                            connectionState(computer)
                        }
                    }
                    .padding(.vertical, 16)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .accessibilityIdentifier("computer.connection.state")

                    addressesCard(computer)

                    Button {
                        focusedAddress = nil
                        Task {
                            if isActive {
                                await store.reconnect()
                                if let failure = store.connectionFailure {
                                    TopToast.shared.showConnectionFailure(failure.localizedDescription)
                                }
                            } else { await store.selectComputer(computer) }
                        }
                    } label: {
                        HStack(spacing: 12) {
                            if status == .connecting {
                                ProgressView().controlSize(.small).tint(DuduStyle.muted)
                                    .frame(width: 22, height: 22)
                            } else {
                                DuduIcon(.reconnect, size: 22)
                            }
                            Text(status == .connecting ? L10n.text("正在连接…") : L10n.text("重新连接"))
                            Spacer()
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 58)
                        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    }
                    .buttonStyle(DuduRowButtonStyle())
                    .disabled(isBusy || drafts != nil)
                    .accessibilityIdentifier("computer.connection.reconnect")
                }
                .font(.system(size: 15))
                .foregroundStyle(DuduStyle.ink)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 18)
                .padding(.top, 16)
                .padding(.bottom, 28)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .background(DuduStyle.settingsBackground.ignoresSafeArea())
        .navigationBarBackButtonHidden(false)
        .minimalBackButton()
        .tint(DuduStyle.ink)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(DuduStyle.settingsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(computer?.name ?? "").font(.system(size: 16, weight: .semibold))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: saveAddresses) {
                    Group {
                        if isSaving {
                            ProgressView().controlSize(.small).tint(DuduStyle.muted)
                        } else {
                            Image(systemName: "checkmark")
                                .font(.system(size: 16, weight: .semibold))
                        }
                    }
                    .frame(width: 20, height: 20)
                }
                .controlSize(.small)
                .labelStyle(.iconOnly)
                .buttonBorderShape(.circle)
                .disabled(drafts == nil || isBusy)
                .accessibilityLabel(L10n.text("保存"))
                .accessibilityIdentifier("computer.edit.save")
            }
        }
    }

    private func connectionState(_ computer: Computer) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if status != .connecting {
                Circle().fill(status == .connected ? Color.green : DuduStyle.muted).frame(width: 6, height: 6)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
            }
            Text(status == .connected ? L10n.text("已连接 · {0}", "\(computer.shortAddress)")
                 : status == .connecting ? L10n.text("正在连接…") : L10n.text("未连接"))
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 13))
        .foregroundStyle(DuduStyle.muted)
    }

    private func addressesCard(_ computer: Computer) -> some View {
        let original = addressFields(for: computer)
        let fields = drafts ?? original
        return VStack(alignment: .leading, spacing: 8) {
            Text(L10n.text("连接地址"))
                .font(.system(size: 12))
                .foregroundStyle(DuduStyle.muted)
                .padding(.leading, 16)
            VStack(spacing: 0) {
                ForEach(fields.indices, id: \.self) { index in
                    if index > 0 { Divider().overlay(DuduStyle.line) }
                    addressRow(fields[index], index: index, original: original, computer: computer)
                }
            }
            .padding(.horizontal, 16)
            .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
    }

    private func addressFields(for computer: Computer) -> [AddressDraft] {
        var fields = computer.connectionAddresses.map { AddressDraft(kind: $0.kind, value: $0.url) }
        if canEditAddresses {
            if !fields.contains(where: { $0.kind == .lan }) { fields.insert(AddressDraft(kind: .lan, value: ""), at: 0) }
            if !fields.contains(where: { $0.kind == .internet }) { fields.append(AddressDraft(kind: .internet, value: "")) }
        }
        return fields
    }

    private func addressRow(_ field: AddressDraft, index: Int, original: [AddressDraft], computer: Computer) -> some View {
        let title = field.kind == .lan ? L10n.text("内网地址") : L10n.text("公网地址")
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(title)
                Spacer(minLength: 8)
                if status == .connected, field.value == computer.displayAddress {
                    Text(L10n.text("使用中")).font(.system(size: 12))
                        .accessibilityIdentifier("computer.connection.in-use")
                }
            }
            if canEditAddresses {
                TextField(L10n.text("选填"), text: Binding {
                    field.value
                } set: { value in
                    var updated = drafts ?? original
                    updated[index].value = value
                    drafts = updated == original ? nil : updated
                })
                .focused($focusedAddress, equals: index)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textContentType(.URL)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(focusedAddress == index ? DuduStyle.ink : DuduStyle.muted)
                .accessibilityLabel(title)
                .accessibilityIdentifier(field.kind == .lan ? "computer.edit.lan" : "computer.edit.public")
                .disabled(isBusy)
            } else {
                Text(field.value).font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(DuduStyle.muted)
                    .textSelection(.enabled)
            }
        }
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func saveAddresses() {
        guard !isBusy, let computer, let drafts else { return }
        isSaving = true
        focusedAddress = nil
        Task {
            defer { isSaving = false }
            do {
                let routes = try drafts.filter { !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    .map { try ConnectionAddress.normalized($0.value, kind: $0.kind) }
                try await store.updateConnectionAddresses(computer, addresses: routes)
                self.drafts = nil
            } catch is CancellationError {
                return
            } catch {
                TopToast.shared.showConnectionFailure(error.localizedDescription)
            }
        }
    }
}
