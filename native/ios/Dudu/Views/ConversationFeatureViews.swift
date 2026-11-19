import SwiftUI
import UIKit

struct ConversationAccess {
    let target: DraftTarget
    let connected: Bool
    var request: @MainActor (String, [String: JSONValue]) async throws -> JSONValue
    var fork: @MainActor (Double) async throws -> Void
    var loadImage: @MainActor (TranscriptAttachment, DraftTarget, Bool) async -> PreparedPhotoImage?
    var downloadVideo: @MainActor ([String: JSONValue]) async throws -> URL = { _ in throw DuduFailure.remote("UNSUPPORTED") }

    private static let json = DuduJSON()

    func read<Value: Decodable & Sendable>(
        _ method: String, _ parameters: [String: JSONValue] = [:], as type: Value.Type = Value.self
    ) async throws -> Value {
        let value = try await request(method, parameters)
        return try await Self.json.decode(type, from: value)
    }
}

private struct ConversationAccessKey: EnvironmentKey {
    static let defaultValue: ConversationAccess? = nil
}

extension EnvironmentValues {
    var conversationAccess: ConversationAccess? {
        get { self[ConversationAccessKey.self] }
        set { self[ConversationAccessKey.self] = newValue }
    }
}

struct ConversationFailureView: View {
    let message: String
    var retry: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(message).foregroundStyle(DuduStyle.chatError).textSelection(.enabled)
            if let retry { Button(L10n.text("重试"), action: retry) }
        }
        .font(.system(size: 14))
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct TurnNoticeView: View {
    let notice: TurnNotice
    @State private var expanded = false

    private var failure: String {
        switch notice.code {
        case "AUTH": return L10n.text("API 密钥无效")
        case "ACCOUNT_SIGNED_OUT": return L10n.text("任务已因退出 DeepSeek 登录而停止。")
        case "INTERRUPTED": return L10n.text("DSH 进程在本轮完成前退出（例如被强制结束、崩溃或关闭超时），重新启动后本轮已中止。未完成的工具调用结果未知。")
        case "ACCOUNT_SIGN_IN_REQUIRED": return L10n.text("请先登录 DeepSeek，并确认请求地址支持账号认证。")
        case "QUOTA", "ACCOUNT_QUOTA": return L10n.text("当前请求的额度已用尽")
        default: return notice.message
        }
    }

    private var failureCode: String? {
        guard let code = notice.code, !code.isEmpty, code != "INTERRUPTED" else { return nil }
        func normalized(_ text: String) -> String {
            text.replacingOccurrences(of: "_", with: " ")
                .split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased()
        }
        return normalized(code) == normalized(failure) ? nil : code
    }

    var body: some View {
        Group {
            if notice.kind == "retry" {
                DisclosureGroup(isExpanded: $expanded) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(L10n.text("重试延迟：{0} ms", "\(Int(notice.delayMs ?? 0))"))
                        Text(L10n.text("失败原因：{0}", "\(failure)")).textSelection(.enabled)
                        if let code = failureCode { Text(code).font(.system(.caption, design: .monospaced)) }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } label: {
                    if notice.state == "scheduled" {
                        TimelineView(.periodic(from: .now, by: 1)) { timeline in
                            Text(retryTitle(at: timeline.date))
                        }
                    } else {
                        Text(retryTitle(at: .now))
                    }
                }
            } else if notice.kind == "max-tokens" {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L10n.text("已达到输出 token 上限")).foregroundStyle(.orange)
                    Text(L10n.text("回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。"))
                }
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    Text(["INTERRUPTED", "ACCOUNT_SIGNED_OUT"].contains(notice.code ?? "") ? L10n.text("任务已停止") : L10n.text("本轮运行失败"))
                        .foregroundStyle(DuduStyle.chatError)
                    Text(failure).textSelection(.enabled)
                    if let code = failureCode {
                        Text(code).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    }
                }
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(DuduStyle.chatSecondary)
        .accessibilityIdentifier("chat.notice.\(notice.id)")
    }

    private func retryTitle(at date: Date) -> String {
        let title: String
        switch notice.state {
        case "cancelled": title = L10n.text("模型请求重试已取消")
        case "started": title = L10n.text("已重试模型请求")
        default: title = L10n.text("正在重试模型请求")
        }
        let attempt = L10n.text("{0}（{1}/{2}）", "\(title)", "\(notice.retry ?? 1)", "\(notice.maximum.map(String.init) ?? "∞")")
        guard notice.state == "scheduled" else { return attempt }
        let delay = notice.delayMs ?? 0
        let remaining = (notice.time ?? date.timeIntervalSince1970 * 1000) + delay - date.timeIntervalSince1970 * 1000
        return "\(attempt) · \(max(0, Int(ceil(remaining / 1000))))s"
    }
}

struct ConversationToolSheet: View {
    let call: TranscriptCall
    @Environment(\.conversationAccess) private var access
    @Environment(\.dismiss) private var dismiss
    @State private var detail: ConversationToolDetail?
    @State private var input = ""
    @State private var output = ""
    @State private var metadata = ""
    @State private var failure: String?
    @State private var loading = false

    private var parameters: [String: JSONValue] {
        var values: [String: JSONValue] = ["callId": .string(call.id)]
        if let seq = call.seq { values["seq"] = .number(seq) }
        if let resultSeq = call.resultSeq { values["resultSeq"] = .number(resultSeq) }
        return values
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let detail {
                        textSection(L10n.text("输入"), text: input, page: detail.input, field: "input")
                        textSection(L10n.text("输出"), text: output, page: detail.output, field: "output")
                        if !metadata.isEmpty { textSection(L10n.text("元数据"), text: metadata, page: detail.metadata, field: "metadata") }
                        ForEach(detail.images, id: \.id) { image in
                            if let access {
                                ConversationImageThumbnail(
                                    attachment: image, target: access.target, canLoadAttachment: access.connected,
                                    identifier: "tool.image.\(image.id ?? "")", loadImage: access.loadImage
                                )
                            }
                        }
                    }
                    if loading { ProgressView().frame(maxWidth: .infinity) }
                    if let failure { ConversationFailureView(message: failure) { Task { await load() } } }
                }
                .padding(20)
            }
            .navigationTitle(call.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L10n.text("完成")) { dismiss() } } }
        }
        .task { await load() }
    }

    private func textSection(_ title: String, text: String, page: ConversationTextPage, field: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.headline)
            if text.count > 2000 {
                ConversationToolText(text: text, identifier: "tool.text.\(field)")
                    .frame(height: 280)
            } else {
                Text(text.isEmpty ? "—" : text)
                    .font(.system(size: 13, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if let offset = page.nextOffset {
                Button(L10n.text("加载更多")) { Task { await load(field: field, offset: offset) } }
                    .disabled(loading)
                    .accessibilityIdentifier("tool.more.\(field)")
            }
        }
    }

    @MainActor private func load(field: String? = nil, offset: Int = 0) async {
        guard let access, !loading else { return }
        loading = true
        failure = nil
        defer { loading = false }
        do {
            var params = parameters
            if let field { params["\(field)Offset"] = .number(Double(offset)) }
            let result: ConversationToolDetail = try await access.read("session.tool", params)
            try Task.checkCancellation()
            if field == nil {
                detail = result
                input = result.input.text
                output = result.output.text
                metadata = result.metadata.text
            } else if field == "input" {
                input += result.input.text
                detail?.input = result.input
            } else if field == "output" {
                output += result.output.text
                detail?.output = result.output
            } else {
                metadata += result.metadata.text
                detail?.metadata = result.metadata
            }
        } catch is CancellationError {
        } catch { failure = error.localizedDescription }
    }
}

private final class ConversationToolTextView: UITextView {
    override var accessibilityValue: String? {
        get { text }
        set {}
    }

    override var accessibilityAttributedValue: NSAttributedString? {
        get { nil }
        set {}
    }
}

private struct ConversationToolText: UIViewRepresentable {
    let text: String
    let identifier: String

    func makeUIView(context: Context) -> UITextView {
        let view = ConversationToolTextView()
        view.isEditable = false
        view.isSelectable = true
        view.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
        view.adjustsFontForContentSizeCategory = true
        view.textColor = UIColor(DuduStyle.chatInk)
        view.tintColor = UIColor(DuduStyle.blue)
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.layoutManager.allowsNonContiguousLayout = true
        view.accessibilityIdentifier = identifier
        view.text = text
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        guard view.text != text else { return }
        let offset = view.contentOffset
        view.text = text
        view.setContentOffset(offset, animated: false)
    }
}

struct ConversationDiffContent: View {
    let seq: Double
    let index: Int
    let name: String
    @Environment(\.conversationAccess) private var access
    @Environment(\.dismiss) private var dismiss
    @State private var diff: ConversationDiff?
    @State private var layout: ConversationDiffLayout?
    @State private var failure: String?
    @State private var loading = false

    var body: some View {
        GeometryReader { viewport in
            ScrollView([.vertical, .horizontal]) {
                diffContent
                    .frame(width: max(layout?.width ?? 0, viewport.size.width - 32), alignment: .leading)
                    .frame(minHeight: max(0, viewport.size.height - 32), alignment: .topLeading)
                    .padding(16)
            }
            .defaultScrollAnchor(.topLeading, for: .initialOffset)
            .defaultScrollAnchor(.topLeading, for: .alignment)
            .accessibilityIdentifier("changes.diff")
        }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                SheetCloseButton { dismiss() }
                .accessibilityIdentifier("changes.diff.close")
            }
        }
        .task { await load() }
    }

    private var diffContent: some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            if let diff {
                if diff.kind == "binary" { Text(L10n.text("二进制文件，无法显示改动")).padding() }
                else if diff.kind == "oversized" { Text(L10n.text("文件过大，无法显示改动")).padding() }
                else {
                    if diff.coarse == true { Text(L10n.text("逐行对比超时，按整个文件替换显示")).padding() }
                    if diff.before == false { Text(L10n.text("本轮新建的文件")).padding() }
                    if diff.after == false { Text(L10n.text("本轮删除的文件")).padding() }
                    if let layout {
                        ForEach(layout.rows) { row in
                            diffRow(row, layout: layout)
                        }
                    }
                    if diff.hunks?.isEmpty == true { Text(L10n.text("两侧内容相同")).padding() }
                }
            }
            if loading { ProgressView().padding() }
            if let failure { ConversationFailureView(message: failure) { Task { await load() } }.padding() }
        }
        .font(.system(size: 12, design: .monospaced))
        .textSelection(.enabled)
    }

    @ViewBuilder
    private func diffRow(_ row: ConversationDiffLayout.Row, layout: ConversationDiffLayout) -> some View {
        if let line = row.line {
            HStack(alignment: .top, spacing: 8) {
                Text(line.old.map(String.init) ?? "").frame(width: layout.lineNumberWidth, alignment: .trailing)
                Text(line.new.map(String.init) ?? "").frame(width: layout.lineNumberWidth, alignment: .trailing)
                Text(verbatim: row.text)
                    .fixedSize()
                    .accessibilityIdentifier("changes.diff.\(row.id)")
            }
            .foregroundStyle(row.text.hasPrefix("-") ? DuduStyle.chatError : DuduStyle.chatInk)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: layout.lineHeight + 4, alignment: .center)
            .background(row.text.hasPrefix("+") ? Color.green.opacity(0.10)
                        : row.text.hasPrefix("-") ? Color.red.opacity(0.08) : Color.clear)
        } else {
            Text(verbatim: row.text)
                .foregroundStyle(DuduStyle.chatSecondary)
                .fixedSize()
                .frame(height: layout.lineHeight + 20, alignment: .center)
                .accessibilityIdentifier("changes.diff.\(row.id)")
        }
    }

    @MainActor private func load() async {
        guard let access, !loading else { return }
        loading = true
        failure = nil
        defer { loading = false }
        do {
            let result: ConversationDiff = try await access.read("session.diff", ["seq": .number(seq), "index": .number(Double(index))])
            let prepared = await Task.detached(priority: .userInitiated) { ConversationDiffLayout(result) }.value
            try Task.checkCancellation()
            diff = result
            layout = prepared
        } catch is CancellationError {
        } catch {
            if !Task.isCancelled { failure = error.localizedDescription }
        }
    }
}
