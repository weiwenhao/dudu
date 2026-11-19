import Foundation
import UniformTypeIdentifiers

struct ConversationFilePayload: Codable, Sendable {
    var name: String
    var mediaType: String
    var dataBase64: String
}

actor ConversationFileStorage {
    static let shared = ConversationFileStorage()
    private let root = FileManager.default.temporaryDirectory.appendingPathComponent("conversation-previews", isDirectory: true)
    private var initialized = false

    func write(_ payload: ConversationFilePayload) throws -> URL {
        guard payload.dataBase64.utf8.count <= 24 * 1024 * 1024,
              let data = Data(base64Encoded: payload.dataBase64), data.count <= 16 * 1024 * 1024 else {
            throw DuduFailure.protocolError
        }
        if !initialized {
            try? FileManager.default.removeItem(at: root)
            initialized = true
        }
        let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var name = (payload.name as NSString).lastPathComponent
        if name.isEmpty || name == "." || name == ".." { name = "file" }
        if (name as NSString).pathExtension.isEmpty,
           let suffix = UTType(mimeType: payload.mediaType.components(separatedBy: ";")[0])?.preferredFilenameExtension {
            name += ".\(suffix)"
        }
        let url = directory.appendingPathComponent(name)
        do { try data.write(to: url, options: [.atomic, .completeFileProtection]) }
        catch {
            try? FileManager.default.removeItem(at: directory)
            throw error
        }
        return url
    }

    func remove(_ url: URL) {
        guard url.deletingLastPathComponent().deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL else { return }
        try? FileManager.default.removeItem(at: url.deletingLastPathComponent())
    }
}

extension ConversationDiff.Hunk {
    struct Line: Identifiable, Sendable {
        let id: Int
        let old: Int?
        let new: Int?
        let text: String
    }

    var numberedLines: [Line] {
        var old = oldStart
        var new = newStart
        return lines.enumerated().map { index, text in
            let addition = text.hasPrefix("+")
            let deletion = text.hasPrefix("-")
            let marker = text.hasPrefix("\\")
            let line = Line(id: index, old: addition || marker ? nil : old, new: deletion || marker ? nil : new, text: text)
            if !addition && !marker { old += 1 }
            if !deletion && !marker { new += 1 }
            return line
        }
    }
}

extension ConversationPerformance {
    struct Metric {
        var label: String
        var value: String
    }

    var metrics: [Metric] {
        var values: [Metric] = []
        if let turns = stats["turns"], let steps = stats["steps"] {
            values.append(Metric(label: L10n.text("会话统计"), value: L10n.text("{0} 轮 {1} 步", "\(Int(turns))", "\(Int(steps))")))
        }
        for (key, label) in [("llmMs", L10n.text("模型用时")), ("toolMs", L10n.text("工具调用用时"))] {
            if let value = stats[key] { values.append(Metric(label: label, value: TranscriptTitles.duration(milliseconds: value))) }
        }
        if let count = stats["ttftSteps"], count > 0, let time = stats["ttftMs"] {
            values.append(Metric(label: L10n.text("首 token 平均（TTFT）"), value: String(format: L10n.text("%.2f 秒"), time / count / 1000)))
        }
        if let time = stats["decodeMs"], time > 0, let tokens = stats["decodeTokens"] {
            values.append(Metric(label: L10n.text("输出速度（TPS）"), value: String(format: "%.1f tok/s", tokens * 1000 / time)))
        }
        return values
    }

    var tokenMetrics: [Metric] {
        let labels = [
            ("uncachedInputTokens", L10n.text("未缓存输入")), ("cacheReadTokens", L10n.text("缓存读取")),
            ("cacheWriteTokens", L10n.text("缓存写入")), ("outputTokens", L10n.text("输出")), ("reasoningTokens", L10n.text("推理")),
            ("totalTokens", L10n.text("Token 用量"))
        ]
        var values = labels.compactMap { key, label -> Metric? in
            guard let value = usage[key] else { return nil }
            return Metric(label: label, value: "\(Int(value).formatted()) tok")
        }
        let prompt = (usage["uncachedInputTokens"] ?? 0) + (usage["cacheReadTokens"] ?? 0) + (usage["cacheWriteTokens"] ?? 0)
        if prompt > 0, let read = usage["cacheReadTokens"] {
            values.insert(Metric(label: L10n.text("缓存命中"), value: String(format: "%.1f%%", read / prompt * 100)), at: 0)
        }
        return values
    }
}
