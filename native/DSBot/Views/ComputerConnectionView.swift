import SwiftUI

struct ComputerConnectionView: View {
    @ObservedObject var store: DSBotStore
    let computerID: String
    @Environment(\.dismiss) private var dismiss
    @State private var isEditing = false

    private var computer: Computer? { store.computers.first { $0.id == computerID } }
    private var isActive: Bool { store.activeComputer?.id == computerID }
    private var status: ConnectionStatus { isActive ? store.status : .disconnected }

    var body: some View {
        ScrollView {
            if let computer {
                VStack(spacing: 22) {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) {
                            Text("连接状态")
                            Spacer(minLength: 8)
                            connectionState(computer).fixedSize()
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("连接状态")
                            connectionState(computer)
                        }
                    }
                    .padding(.vertical, 16)
                    .padding(.horizontal, 16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .accessibilityIdentifier("computer.connection.state")

                    VStack(alignment: .leading, spacing: 8) {
                        Text("连接地址")
                            .font(.system(size: 12))
                            .foregroundStyle(DSBotStyle.muted)
                            .padding(.leading, 16)
                        VStack(spacing: 0) {
                            ForEach(Array(computer.connectionAddresses.enumerated()), id: \.element.id) { index, route in
                                if index > 0 { Divider().overlay(DSBotStyle.line) }
                                addressRow(route, computer: computer)
                            }
                        }
                        .padding(.horizontal, 16)
                        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    }

                    if isActive, status == .disconnected, let failure = store.connectionFailure {
                        Text(failure.localizedDescription)
                            .font(.system(size: 13))
                            .foregroundStyle(Color(red: 0.67, green: 0.29, blue: 0.27))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 16)
                            .accessibilityIdentifier("computer.connection.failure")
                    }

                    Button {
                        Task {
                            if isActive { await store.reconnect() }
                            else { await store.selectComputer(computer) }
                        }
                    } label: {
                        HStack(spacing: 12) {
                            DSBotIcon(.reconnect, size: 22)
                            Text(status == .connecting ? "正在连接…" : "重新连接")
                            Spacer()
                            if status == .connecting {
                                ProgressView().controlSize(.small).tint(DSBotStyle.muted)
                            }
                        }
                        .padding(.horizontal, 16)
                        .frame(minHeight: 58)
                        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    }
                    .buttonStyle(DSBotRowButtonStyle())
                    .disabled(status == .connecting)
                    .accessibilityIdentifier("computer.connection.reconnect")
                }
                .font(.system(size: 15))
                .foregroundStyle(DSBotStyle.ink)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 18)
                .padding(.top, 16)
                .padding(.bottom, 28)
            }
        }
        .background(DSBotStyle.settingsBackground.ignoresSafeArea())
        .navigationBarBackButtonHidden(true)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(DSBotStyle.settingsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button { dismiss() } label: { DSBotIcon(.back, size: 20) }
                    .accessibilityLabel("返回电脑连接")
            }
            ToolbarItem(placement: .principal) {
                Text(computer?.name ?? "").font(.system(size: 16, weight: .semibold))
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("编辑") { isEditing = true }
                    .disabled(computer == nil || status == .connecting)
                    .accessibilityIdentifier("computer.connection.edit")
            }
        }
        .sheet(isPresented: $isEditing) {
            if let computer { ConnectionAddressEditor(store: store, computer: computer) }
        }
    }

    private func connectionState(_ computer: Computer) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if status != .connecting {
                Circle().fill(status == .connected ? Color.green : DSBotStyle.muted).frame(width: 6, height: 6)
                    .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 2 }
            }
            Text(status == .connected ? "已连接 · \(computer.shortAddress)"
                 : status == .connecting ? "正在连接…" : "未连接")
                .fixedSize(horizontal: false, vertical: true)
        }
        .font(.system(size: 13))
        .foregroundStyle(DSBotStyle.muted)
    }

    private func addressRow(_ route: ConnectionAddress, computer: Computer) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(route.kind == .lan ? "内网地址" : "公网地址")
                Spacer(minLength: 8)
                if status == .connected, route.url == computer.displayAddress.trimmingCharacters(in: CharacterSet(charactersIn: "/")) {
                    Text("使用中").font(.system(size: 12))
                        .accessibilityIdentifier("computer.connection.in-use")
                }
            }
            Text(route.url).font(.system(size: 11, design: .monospaced))
                .foregroundStyle(DSBotStyle.muted)
                .textSelection(.enabled)
        }
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct ConnectionAddressEditor: View {
    struct Draft: Identifiable {
        let id = UUID()
        let kind: ConnectionAddressKind
        var value: String
    }

    @ObservedObject var store: DSBotStore
    let computer: Computer
    @Environment(\.dismiss) private var dismiss
    @State private var drafts: [Draft]
    @State private var saving = false
    @State private var failure: String?

    init(store: DSBotStore, computer: Computer) {
        self.store = store
        self.computer = computer
        var fields = computer.connectionAddresses.map { Draft(kind: $0.kind, value: $0.url) }
        if !fields.contains(where: { $0.kind == .lan }) { fields.insert(Draft(kind: .lan, value: ""), at: 0) }
        if !fields.contains(where: { $0.kind == .internet }) { fields.append(Draft(kind: .internet, value: "")) }
        _drafts = State(initialValue: fields)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 0) {
                        ForEach($drafts) { $draft in
                            VStack(alignment: .leading, spacing: 8) {
                                Text(draft.kind == .lan ? "内网地址" : "公网地址")
                                    .font(.system(size: 13)).foregroundStyle(DSBotStyle.muted)
                                TextField("选填", text: $draft.value)
                                    .font(.system(size: 16))
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled()
                                    .keyboardType(.URL)
                                    .accessibilityIdentifier(draft.kind == .lan ? "computer.edit.lan" : "computer.edit.public")
                                    .disabled(saving)
                            }
                            .padding(.vertical, 14)
                            if draft.id != drafts.last?.id { Divider() }
                        }
                    }
                    .padding(.horizontal, 16)
                    .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    if let failure {
                        Text(failure).font(.system(size: 13)).foregroundStyle(Color(red: 0.67, green: 0.29, blue: 0.27))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityIdentifier("computer.edit.failure")
                    }
                }
                .padding(18)
            }
            .background(DSBotStyle.settingsBackground.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("取消") { dismiss() }.disabled(saving) }
                ToolbarItem(placement: .principal) { Text("编辑").font(.system(size: 16, weight: .semibold)) }
                ToolbarItem(placement: .topBarTrailing) {
                    if saving {
                        ProgressView().controlSize(.small).tint(DSBotStyle.muted)
                    } else {
                        Button("保存", action: save).accessibilityIdentifier("computer.edit.save")
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(saving)
        .accessibilityLabel("编辑连接地址")
    }

    private func save() {
        guard !saving else { return }
        saving = true
        failure = nil
        Task {
            do {
                let routes = try drafts.filter { !$0.value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
                    .map { try ConnectionAddress.normalized($0.value, kind: $0.kind) }
                try await store.updateConnectionAddresses(computer, addresses: routes)
                dismiss()
            } catch {
                failure = error.localizedDescription
                saving = false
            }
        }
    }
}
