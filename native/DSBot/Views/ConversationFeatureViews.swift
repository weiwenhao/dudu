import SwiftUI
import QuickLook
import UniformTypeIdentifiers
import UIKit

struct ConversationAccess {
    let target: DraftTarget
    let connected: Bool
    var request: @MainActor (String, [String: JSONValue]) async throws -> JSONValue
    var fork: @MainActor (Double) async throws -> Void
    var loadImage: @MainActor (TranscriptAttachment, DraftTarget, Bool) async -> PreparedPhotoImage?

    private static let json = DSBotJSON()

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
            Text(message).foregroundStyle(DSBotStyle.chatError).textSelection(.enabled)
            if let retry { Button("重试", action: retry) }
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
        case "AUTH": return "API 密钥无效"
        case "ACCOUNT_SIGNED_OUT": return "任务已因退出 DeepSeek 登录而停止。"
        case "INTERRUPTED": return "DSH 进程在本轮完成前退出（例如被强制结束、崩溃或关闭超时），重新启动后本轮已中止。未完成的工具调用结果未知。"
        case "ACCOUNT_SIGN_IN_REQUIRED": return "请先登录 DeepSeek，并确认请求地址支持账号认证。"
        case "QUOTA", "ACCOUNT_QUOTA": return "当前请求的额度已用尽"
        default: return notice.message
        }
    }

    var body: some View {
        Group {
            if notice.kind == "retry" {
                DisclosureGroup(isExpanded: $expanded) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("重试延迟：\(Int(notice.delayMs ?? 0)) ms")
                        Text("失败原因：\(failure)").textSelection(.enabled)
                        if let code = notice.code { Text(code).font(.system(.caption, design: .monospaced)) }
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
                    Text("已达到输出 token 上限").foregroundStyle(.orange)
                    Text("回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。")
                }
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    Text(["INTERRUPTED", "ACCOUNT_SIGNED_OUT"].contains(notice.code ?? "") ? "任务已停止" : "本轮运行失败")
                        .foregroundStyle(DSBotStyle.chatError)
                    Text(failure).textSelection(.enabled)
                    if let code = notice.code, code != "INTERRUPTED" {
                        Text(code).font(.system(.caption, design: .monospaced)).textSelection(.enabled)
                    }
                }
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(DSBotStyle.chatSecondary)
        .accessibilityIdentifier("chat.notice.\(notice.id)")
    }

    private func retryTitle(at date: Date) -> String {
        let title: String
        switch notice.state {
        case "cancelled": title = "模型请求重试已取消"
        case "started": title = "已重试模型请求"
        default: title = "正在重试模型请求"
        }
        let delay = notice.delayMs ?? 0
        let remaining = notice.state == "scheduled"
            ? (notice.time ?? date.timeIntervalSince1970 * 1000) + delay - date.timeIntervalSince1970 * 1000 : delay
        return "\(title)（\(notice.retry ?? 1)/\(notice.maximum.map(String.init) ?? "∞")） · \(max(1, Int(ceil(remaining / 1000))))s"
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
                        textSection("输入", text: input, page: detail.input, field: "input")
                        textSection("输出", text: output, page: detail.output, field: "output")
                        if !metadata.isEmpty { textSection("元数据", text: metadata, page: detail.metadata, field: "metadata") }
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
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
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
                Button("加载更多") { Task { await load(field: field, offset: offset) } }
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
        view.textColor = UIColor(DSBotStyle.chatInk)
        view.tintColor = UIColor(DSBotStyle.blue)
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

struct TurnFilesView: View {
    let files: [DeliveredFile]
    let changesSeq: Double?
    @Environment(\.conversationAccess) private var access
    @State private var changes: ConversationChanges?
    @State private var expanded = false
    @State private var loading = false
    @State private var failure: String?
    @State private var selectedDiff: SelectedDiff?
    @State private var changesLoadID: UUID?
    @State private var loadingSeq: Double?

    private struct SelectedDiff: Identifiable {
        let id: Int
        let seq: Double
        let name: String
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if changesSeq != nil {
                DisclosureGroup(isExpanded: $expanded) {
                    if let changes {
                        ForEach(Array(changes.files.enumerated()), id: \.offset) { index, file in
                            Button {
                                if let changesSeq { selectedDiff = SelectedDiff(id: index, seq: changesSeq, name: file.display) }
                            } label: {
                                HStack {
                                    Text(file.display).lineLimit(2).multilineTextAlignment(.leading)
                                    Spacer()
                                    Text("+\(file.added)").foregroundStyle(.green)
                                    Text("−\(file.deleted)").foregroundStyle(DSBotStyle.chatError)
                                }
                                .padding(.vertical, 8)
                                .frame(minHeight: 44)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("changes.file.\(index)")
                        }
                    }
                    if loading { ProgressView() }
                    if let failure { ConversationFailureView(message: failure) { Task { await loadChanges() } } }
                } label: {
                    HStack(spacing: 8) {
                        DSBotIcon(.file, size: 16, scalesStroke: true)
                        Text(changes.map { "已编辑 \($0.total) 个文件" } ?? "文件改动")
                        if let changes {
                            Text("+\(changes.added)").foregroundStyle(.green)
                            Text("−\(changes.deleted)").foregroundStyle(DSBotStyle.chatError)
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("changes.toggle")
            }
            let presentedPaths = Set(files.filter { $0.kind == "presented" }.map(\.path))
            ForEach(files.filter { $0.kind != "produced" || !presentedPaths.contains($0.path) }) { file in
                DeliveredFileCard(file: file)
            }
        }
        .font(.system(size: 13))
        .foregroundStyle(DSBotStyle.chatSecondary)
        .onChange(of: expanded) { _, open in if open { Task { await loadChanges() } } }
        .onChange(of: changesSeq) { _, _ in
            changes = nil
            if expanded { Task { await loadChanges() } }
        }
        .sheet(item: $selectedDiff) { selection in
            ConversationDiffSheet(seq: selection.seq, index: selection.id, name: selection.name)
        }
    }

    @MainActor private func loadChanges() async {
        guard let access, let changesSeq, changes == nil,
              !loading || loadingSeq != changesSeq else { return }
        let loadID = UUID()
        changesLoadID = loadID
        loadingSeq = changesSeq
        loading = true
        failure = nil
        defer {
            if changesLoadID == loadID {
                loading = false
                loadingSeq = nil
                changesLoadID = nil
            }
        }
        do {
            let result: ConversationChanges = try await access.read("session.changes", ["seq": .number(changesSeq)])
            try Task.checkCancellation()
            if changesLoadID == loadID, self.changesSeq == changesSeq { changes = result }
        } catch is CancellationError {
        } catch {
            if changesLoadID == loadID, self.changesSeq == changesSeq { failure = error.localizedDescription }
        }
    }
}

private struct DeliveredFileCard: View {
    let file: DeliveredFile
    @Environment(\.conversationAccess) private var access
    @State private var preview: URL?
    @State private var loading = false
    @State private var failure: String?
    @State private var temporaryFile: URL?
    @State private var openTask: Task<Void, Never>?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { openTask = Task { await open() } } label: {
                HStack(spacing: 12) {
                    if loading { ProgressView() } else { DSBotIcon(.file, size: 26) }
                    VStack(alignment: .leading, spacing: 3) {
                        Text(file.name).font(.system(size: 14, weight: .medium)).foregroundStyle(DSBotStyle.chatInk).lineLimit(2)
                        if let description = file.description, !description.isEmpty {
                            Text(description).font(.system(size: 12)).lineLimit(3)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(12)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .background(DSBotStyle.chatPanel, in: RoundedRectangle(cornerRadius: 16))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(DSBotStyle.chatBorder, lineWidth: 0.5))
            }
            .buttonStyle(.plain)
            .disabled(loading || access?.connected != true)
            .accessibilityIdentifier("chat.file.\(file.id)")
            if let failure { ConversationFailureView(message: failure) }
        }
        .quickLookPreview($preview)
        .onChange(of: preview) { old, new in
            if new == nil, let old { Task { await ConversationFileStorage.shared.remove(old) } }
        }
        .onDisappear {
            if preview == nil {
                openTask?.cancel()
                if let temporaryFile { Task { await ConversationFileStorage.shared.remove(temporaryFile) } }
            }
        }
    }

    @MainActor private func open() async {
        guard let access, !loading else { return }
        loading = true
        failure = nil
        defer {
            loading = false
            openTask = nil
        }
        do {
            let payload: ConversationFilePayload = try await access.read("session.file", file.parameters)
            let url = try await ConversationFileStorage.shared.write(payload)
            if Task.isCancelled {
                await ConversationFileStorage.shared.remove(url)
                return
            }
            temporaryFile = url
            preview = url
        } catch { failure = error.localizedDescription }
    }
}

private struct ConversationDiffSheet: View {
    let seq: Double
    let index: Int
    let name: String
    @Environment(\.conversationAccess) private var access
    @Environment(\.dismiss) private var dismiss
    @State private var diff: ConversationDiff?
    @State private var failure: String?
    @State private var loading = false

    var body: some View {
        NavigationStack {
            ScrollView([.vertical, .horizontal]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if let diff {
                        if diff.kind == "binary" { Text("二进制文件，无法显示改动").padding() }
                        else if diff.kind == "oversized" { Text("文件过大，无法显示改动").padding() }
                        else {
                            if diff.coarse == true { Text("逐行对比超时，按整个文件替换显示").padding() }
                            if diff.before == false { Text("本轮新建的文件").padding() }
                            if diff.after == false { Text("本轮删除的文件").padding() }
                            ForEach(Array((diff.hunks ?? []).enumerated()), id: \.offset) { _, hunk in
                                Text("@@ −\(hunk.oldStart),\(hunk.oldLines) +\(hunk.newStart),\(hunk.newLines) @@")
                                    .foregroundStyle(DSBotStyle.chatSecondary).padding(.vertical, 10)
                                ForEach(hunk.numberedLines) { line in
                                    HStack(alignment: .top, spacing: 12) {
                                        Text(line.old.map(String.init) ?? "").frame(width: 42, alignment: .trailing)
                                        Text(line.new.map(String.init) ?? "").frame(width: 42, alignment: .trailing)
                                        Text(line.text).fixedSize(horizontal: true, vertical: false)
                                    }
                                    .foregroundStyle(line.text.hasPrefix("-") ? DSBotStyle.chatError : DSBotStyle.chatInk)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 2)
                                    .background(line.text.hasPrefix("+") ? Color.green.opacity(0.10)
                                                : line.text.hasPrefix("-") ? Color.red.opacity(0.08) : Color.clear)
                                }
                            }
                            if diff.hunks?.isEmpty == true { Text("两侧内容相同").padding() }
                        }
                    }
                    if loading { ProgressView().padding() }
                    if let failure { ConversationFailureView(message: failure) { Task { await load() } }.padding() }
                }
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .padding(16)
            }
            .navigationTitle(name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
        .task { await load() }
    }

    @MainActor private func load() async {
        guard let access, !loading else { return }
        loading = true
        failure = nil
        defer { loading = false }
        do { diff = try await access.read("session.diff", ["seq": .number(seq), "index": .number(Double(index))]) }
        catch { failure = error.localizedDescription }
    }
}

struct ConversationPerformanceButton: View {
    var turn: Int?
    var seq: Double?
    @State private var presented = false

    var body: some View {
        Button { presented = true } label: {
            Text(turn == nil ? "性能与用量" : "本轮用量")
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
            .font(.system(size: 12))
            .foregroundStyle(DSBotStyle.chatTertiary)
            .accessibilityIdentifier(turn == nil ? "chat.performance" : "chat.performance.turn")
            .sheet(isPresented: $presented) { ConversationPerformanceSheet(turn: turn, seq: seq) }
    }
}

private struct ConversationPerformanceSheet: View {
    let turn: Int?
    let seq: Double?
    @Environment(\.conversationAccess) private var access
    @Environment(\.dismiss) private var dismiss
    @AppStorage("conversation.performance.detailed") private var detailed = false
    @State private var performance: ConversationPerformance?
    @State private var failure: String?
    @State private var loading = false

    var body: some View {
        NavigationStack {
            Form {
                if turn == nil {
                    Section("性能与用量") {
                        Picker("性能与用量", selection: $detailed) {
                            Text("简洁").tag(false)
                            Text("详细").tag(true)
                        }.pickerStyle(.segmented)
                    }
                }
                if let performance {
                    if !performance.metrics.isEmpty {
                        Section(turn == nil ? "会话统计" : "本轮用量") {
                            ForEach(performance.metrics, id: \.label) { metric in
                                LabeledContent(metric.label, value: metric.value)
                            }
                        }
                    }
                    if !performance.tokenMetrics.isEmpty {
                        Section("Token 用量") {
                            ForEach(performance.tokenMetrics, id: \.label) { metric in
                                LabeledContent(metric.label, value: metric.value)
                            }
                        }
                    }
                }
                if loading { ProgressView() }
                if let failure { ConversationFailureView(message: failure) { Task { await load() } } }
            }
            .navigationTitle(turn == nil ? "性能与用量" : "本轮用量")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("完成") { dismiss() } } }
        }
        .task { await load() }
    }

    @MainActor private func load() async {
        guard let access, !loading else { return }
        loading = true
        failure = nil
        defer { loading = false }
        var params: [String: JSONValue] = [:]
        if let turn, let seq { params = ["turn": .number(Double(turn)), "seq": .number(seq)] }
        do { performance = try await access.read("session.performance", params) }
        catch { failure = error.localizedDescription }
    }
}
