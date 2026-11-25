import SwiftUI
import UIKit
import LucideSwift

/// What the 连接 / 重新登录 of a connectors row offers (owner, 2026-11-23, after Muse's connectors; `.local/designs/connectors-muse-2026-11-23`): the item of the catalog (or a
/// server found in the owner's other tools) and how it connects; `reconnect` is a connector that was connected and must sign in again (no explanation first).
struct ConnectorOffer: Equatable, Sendable, Identifiable {
    let id: String
    let name: String
    let icon: String?
    let line: String
    /// `oauth` / `open` sign in on a page, `device` with a code, `cli` is a command on the computer, `local` a server started there.
    let how: String
    var reconnect = false

    var signsIn: Bool { ["oauth", "open", "device"].contains(how) }
}

/// Muse's card: what connecting means in three points and one button; then the one thing the connection waits for (the sign-in page, opened here on the phone; a code; a
/// command to run on the computer) until it is connected (the card closes and says so) or it did not work (it says why, with 重试). Closing it gives up a first connection:
/// the plugin keeps nothing of it (host/assistant/connectors/connections.mjs).
struct ConnectorSheet: View {
    let offer: ConnectorOffer
    @ObservedObject var store: DuduStore
    let report: SettingsReport
    let onChanged: () -> Void
    @Environment(\.dismiss) private var dismiss

    private enum Phase: Equatable {
        case intro
        case working
        case code(String, URL)
        case command(missing: Bool, command: String, line: String?)
        case failed(String)
    }

    @State private var phase: Phase = .intro
    @State private var busy = false
    @State private var connectorID: String?
    @State private var signIn: SignInPage?
    @State private var known: Set<String> = []
    @State private var finished = false
    @State private var polling: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            ConnectorAvatar(icon: offer.icon, name: offer.name, size: 60)
                .padding(.top, 26)
            Text(offer.name)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(DuduStyle.ink)
                .padding(.top, 12)
            if !offer.line.isEmpty {
                Text(offer.line)
                    .font(.system(size: 15))
                    .foregroundStyle(DuduStyle.chatSecondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .padding(.top, 4)
            }
            content
                .padding(.top, 22)
            if case .failed(let reason) = phase {
                Text(reason)
                    .font(.system(size: 14))
                    .foregroundStyle(SwipeAction.red)
                    .multilineTextAlignment(.center)
                    .padding(.top, 18)
            }
            if let title = primaryTitle {
                Button { primary() } label: {
                    ZStack {
                        if busy { ProgressView().tint(.white) } else { Text(title).font(.system(size: 17, weight: .semibold)) }
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(DuduStyle.blue.opacity(busy ? 0.6 : 1), in: Capsule())
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(busy)
                .padding(.top, 24)
                .accessibilityIdentifier("connector.sheet.primary")
            }
            Button(L10n.text("取消")) { close() }
                .font(.system(size: 16))
                .foregroundStyle(DuduStyle.blue)
                .frame(minHeight: 44)
                .padding(.top, 8)
        }
        .padding(.horizontal, 26)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity)
        .background(Color.white)
        .presentationDragIndicator(.visible)
        .presentationSizing(.fitted)
        .presentationCornerRadius(34)
        .sheet(item: $signIn) { page in
            SignInBrowser(page: page) { callback in
                signIn = nil
                Task { await finishSignIn(callback) }
            } onClose: {
                signIn = nil
                close()
            }
        }
        .onAppear { if offer.how == "cli" || offer.reconnect { primary() } }
        .onDisappear {
            polling?.cancel()
            if !finished { Task { await giveUp() } }
        }
    }

    // MARK: what the card shows

    @ViewBuilder private var content: some View {
        switch phase {
        case .code(let code, _):
            VStack(spacing: 14) {
                Text(code)
                    .font(.system(size: 34, weight: .semibold, design: .monospaced))
                    .tracking(4)
                    .foregroundStyle(DuduStyle.ink)
                    .textSelection(.enabled)
                HStack(spacing: 6) {
                    ProgressView().controlSize(.small)
                    Text(L10n.text("请在 {0} 输入此验证码", offer.name))
                        .font(.system(size: 14))
                        .foregroundStyle(DuduStyle.chatSecondary)
                }
            }
        case .command(let missing, let command, let line):
            VStack(alignment: .leading, spacing: 4) {
                Text(missing ? L10n.text("未找到 {0}", command) : L10n.text("{0} 未登录", command))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                if let line {
                    Text(missing ? L10n.text("请在电脑终端中运行以下命令安装") : L10n.text("请在电脑终端中运行以下命令登录"))
                        .font(.system(size: 14))
                        .foregroundStyle(DuduStyle.chatSecondary)
                    CommandLine(text: line)
                        .padding(.top, 14)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .intro, .working, .failed:
            if offer.how == "cli" {
                ProgressView().padding(.vertical, 12)
            } else {
                points
            }
        }
    }

    private var points: some View {
        let first: (LucideIconName, String, String) = offer.signsIn
            ? (.logIn, L10n.text("登录 {0}", offer.name), L10n.text("在手机上打开 {0} 登录页，授权后自动返回", offer.name))
            : (.squareTerminal, L10n.text("在这台电脑上运行"), L10n.text("嘟嘟将在电脑上启动 {0} 并读取其工具", offer.name))
        let all: [(LucideIconName, String, String)] = [
            first,
            (.sparkles, L10n.text("嘟嘟和智能体可用"), L10n.text("连接后，嘟嘟、收集器和会话中的智能体均可使用 {0} 的工具", offer.name)),
            (.unplug, L10n.text("可随时断开"), L10n.text("在连接器中打开 {0} 即可断开", offer.name)),
        ]
        return VStack(alignment: .leading, spacing: 16) {
            ForEach(all, id: \.1) { icon, title, text in
                HStack(alignment: .top, spacing: 14) {
                    LucideIcon(icon, size: 22, strokeWidth: 1.8, absoluteStrokeWidth: false)
                        .frame(width: 22, height: 22)
                        .foregroundStyle(DuduStyle.ink)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(title).font(.system(size: 16, weight: .semibold)).foregroundStyle(DuduStyle.ink)
                        Text(text).font(.system(size: 14)).foregroundStyle(DuduStyle.chatSecondary).fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var primaryTitle: String? {
        switch phase {
        case .intro: offer.how == "cli" ? nil : L10n.text("连接")
        case .working: L10n.text("连接")
        case .failed: L10n.text("重试")
        case .code: L10n.text("复制并打开")
        case .command: L10n.text("重新检查")
        }
    }

    private func primary() {
        switch phase {
        case .code(let code, let url):
            UIPasteboard.general.string = code
            UIApplication.shared.open(url)
        case .command:
            Task { await recheck() }
        case .intro, .failed, .working:
            Task { await start() }
        }
    }

    // MARK: what it asks of the computer

    private func act(_ name: String, _ args: [String: JSONValue]) async throws -> JSONValue {
        try await store.request("settings.act", [
            "section": .string("connectors"), "name": .string(name), "args": .object(args),
        ], timeoutSeconds: 45)
    }

    private func start() async {
        busy = true
        known = Set(await attempts().map(\.key))
        do {
            if offer.signsIn {
                let answer = try await act("signin", ["id": .string(connectorID ?? offer.id)])
                let signin = answer["signin"]
                if let id = signin?["id"]?.stringValue { connectorID = id }
                guard answer["outcome"]?.stringValue == "success" else { return fail() }
                if let page = signin?["url"]?.stringValue.flatMap(URL.init(string:)) {
                    if let code = signin?["code"]?.stringValue {
                        phase = .code(code, page)
                        busy = false
                        watch()
                    } else {
                        phase = .working
                        signIn = SignInPage(url: page)
                    }
                } else if signin?["status"]?.stringValue == "connected" {
                    done()
                } else {
                    fail(signin?["message"]?.stringValue)
                }
            } else {
                let answer = try await act("connect", ["id": .string(offer.id)])
                guard answer["outcome"]?.stringValue == "success" else { return fail(answer["message"]?.stringValue) }
                phase = .working
                watch()
            }
        } catch {
            fail()
        }
    }

    private func finishSignIn(_ callback: URL) async {
        guard let id = connectorID else { return fail() }
        busy = true
        do {
            let answer = try await act("signin-finish", ["id": .string(id), "url": .string(callback.absoluteString)])
            let status = answer["signin"]?["status"]?.stringValue
            if answer["outcome"]?.stringValue == "success", status == "connected" { done() }
            else if status == "waiting" { watch() }
            else { fail(answer["signin"]?["message"]?.stringValue) }
        } catch {
            fail()
        }
    }

    private func recheck() async {
        busy = true
        _ = try? await act("verb", ["id": .string(connectorID ?? offer.id), "verb": .string("retry")])
        watch()
    }

    /// Reads the connectors again every 1.5 s until this one is connected, waits for something of the owner, or did not work.
    private func watch() {
        polling?.cancel()
        polling = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard !Task.isCancelled, let list = await connectorsList() else { continue }
                let mine = (list["connectors"]?.arrayValue ?? []).first { connector in
                    let id = connector["id"]?.stringValue
                    return id == connectorID || id == offer.id || connector["from"]?.stringValue == offer.id
                }
                if let mine {
                    connectorID = mine["id"]?.stringValue ?? connectorID
                    let state = mine["state"]
                    let status = state?["status"]?.stringValue
                    if mine["fresh"]?.boolValue != true, status == nil { return done() }
                    if status == "needs-login" || status == "missing", let command = state?["command"]?.stringValue {
                        let missing = status == "missing"
                        phase = .command(missing: missing, command: command, line: (missing ? state?["install"] : state?["login"])?.stringValue)
                        busy = false
                    } else if status == "waiting", let code = state?["code"]?.stringValue, let page = state?["url"]?.stringValue.flatMap(URL.init(string:)) {
                        phase = .code(code, page)
                        busy = false
                    }
                } else if let attempt = attemptsIn(list).first(where: { !known.contains($0.key) && ($0.value["from"]?.stringValue == offer.id || $0.value["id"]?.stringValue == connectorID) }) {
                    return fail(attempt.value["message"]?.stringValue)
                }
            }
        }
    }

    private func connectorsList() async -> JSONValue? {
        guard let answer = try? await store.request("settings.data", ["section": .string("connectors")]) else { return nil }
        return answer["data"]?["connectors/list"]
    }

    private func attempts() async -> [(key: String, value: JSONValue)] {
        guard let list = await connectorsList() else { return [] }
        return attemptsIn(list)
    }

    private func attemptsIn(_ list: JSONValue) -> [(key: String, value: JSONValue)] {
        (list["attempts"]?.arrayValue ?? []).map { attempt in
            ("\(attempt["id"]?.stringValue ?? "")@\(attempt["at"]?.numberValue ?? 0)", attempt)
        }
    }

    // MARK: how it ends

    private func done() {
        polling?.cancel()
        finished = true
        busy = false
        report(DuduToastMessage(text: L10n.text("已连接 {0}", offer.name), kind: .success))
        onChanged()
        dismiss()
    }

    private func fail(_ message: String? = nil) {
        polling?.cancel()
        busy = false
        phase = .failed(offer.signsIn || message == nil ? L10n.text("连接失败：授权未完成") : L10n.text("连接失败：{0}", message ?? ""))
    }

    private func close() {
        polling?.cancel()
        dismiss()
    }

    /// A first connection the owner walks away from is given up: the plugin lets go of it, and the list is as it was.
    private func giveUp() async {
        if let id = connectorID ?? (offer.how == "cli" ? offer.id : nil) {
            _ = try? await act("verb", ["id": .string(id), "verb": .string("cancel")])
        }
        onChanged()
    }
}

/// A command to run on the computer, with its copy button.
private struct CommandLine: View {
    let text: String

    var body: some View {
        HStack(spacing: 10) {
            LucideIcon(.squareTerminal, size: 18, strokeWidth: 1.8, absoluteStrokeWidth: false)
                .frame(width: 18, height: 18)
                .foregroundStyle(DuduStyle.chatSecondary)
            Text(text)
                .font(.system(size: 14, design: .monospaced))
                .foregroundStyle(DuduStyle.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
            Button {
                UIPasteboard.general.string = text
            } label: {
                HStack(spacing: 4) {
                    LucideIcon(.copy, size: 15, strokeWidth: 2, absoluteStrokeWidth: false).frame(width: 15, height: 15)
                    Text(L10n.text("复制")).font(.system(size: 15))
                }
                .foregroundStyle(DuduStyle.blue)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 13)
        .background(Color(red: 244 / 255, green: 245 / 255, blue: 247 / 255), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
