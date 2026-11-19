#if DEBUG && targetEnvironment(simulator)
import Foundation

enum ReviewWebDiagnostics {
    static let launchArgument = "-dudu-review-real-pages"

    static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains(launchArgument)
    }

    static func record(
        stage: String,
        pageKind: String,
        message: String? = nil,
        filename: String? = nil,
        stack: String? = nil,
        endpoint: String? = nil
    ) {
        guard isEnabled else { return }
        let entry = ReviewWebDiagnosticEntry(
            timestamp: ISO8601DateFormatter().string(from: Date()),
            source: "webkit-review",
            pageKind: pageKind,
            stage: stage,
            message: message,
            filename: filename,
            stack: stack,
            endpoint: endpoint
        )
        Task(priority: .utility) {
            await ReviewWebDiagnosticWriter.shared.append(entry)
        }
    }
}

private struct ReviewWebDiagnosticEntry: Encodable, Sendable {
    let timestamp: String
    let source: String
    let pageKind: String
    let stage: String
    let message: String?
    let filename: String?
    let stack: String?
    let endpoint: String?
}

private actor ReviewWebDiagnosticWriter {
    static let shared = ReviewWebDiagnosticWriter()

    private let stages: Set<String> = [
        "boot.open.begin", "boot.open.complete", "boot.transport.ready", "boot.ready", "boot.fail",
        "boot.transport.injected",
        "resource.scheme.start", "resource.scheme.reject",
        "resource.fetch.start", "resource.fetch.complete", "resource.fetch.fail",
        "script.error", "script.resource.error", "unhandledrejection", "transport.error",
        "rpc.failure", "rpc.missing"
    ]
    private let pageKinds: Set<String> = ["plugins", "trace", "context", "team", "tools", "settings"]
    private let maxRecords = 2_000
    private let maxFileBytes = 16 * 1_024 * 1_024
    private var recordCount = 0

    func append(_ entry: ReviewWebDiagnosticEntry) {
        guard recordCount < maxRecords,
              stages.contains(entry.stage), pageKinds.contains(entry.pageKind) else {
            return
        }
        var safeEntry = entry
        safeEntry = ReviewWebDiagnosticEntry(
            timestamp: entry.timestamp,
            source: entry.source,
            pageKind: entry.pageKind,
            stage: entry.stage,
            message: Self.safeText(entry.message, limit: 4_096),
            filename: Self.safeText(entry.filename, limit: 16_384),
            stack: Self.safeStack(entry.stack),
            endpoint: Self.safeEndpoint(entry.endpoint)
        )
        guard let documents = FileManager.default.urls(
            for: .documentDirectory, in: .userDomainMask
        ).first else { return }

        do {
            let directory = documents.appendingPathComponent("full-page-review", isDirectory: true)
            try FileManager.default.createDirectory(
                at: directory, withIntermediateDirectories: true
            )
            let file = directory.appendingPathComponent("diagnostics.jsonl")
            var data = try JSONEncoder().encode(safeEntry)
            data.append(0x0A)
            let existingBytes = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? NSNumber)?
                .intValue ?? 0
            guard existingBytes + data.count <= maxFileBytes else { return }

            if FileManager.default.fileExists(atPath: file.path) {
                let handle = try FileHandle(forWritingTo: file)
                defer { try? handle.close() }
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } else {
                try data.write(to: file, options: .atomic)
            }
            recordCount += 1
        } catch {
            // Review diagnostics must never affect page loading.
        }
    }

    private static func safeEndpoint(_ value: String?) -> String? {
        guard let value, value.utf8.count <= 128,
              value.range(of: #"^[A-Za-z0-9._/$-]+$"#, options: .regularExpression) != nil else {
            return nil
        }
        return value
    }

    private static func safeStack(_ value: String?) -> String? {
        guard let value else { return nil }
        let lines = value.split(whereSeparator: \.isNewline).prefix(12)
            .map { safeText(String($0), limit: 1_024) ?? "" }
        return safeText(lines.joined(separator: "\n"), limit: 12 * 1_024)
    }

    private static func safeText(_ value: String?, limit: Int) -> String? {
        guard let value, !value.isEmpty else { return nil }
        var text = redactURLs(value)
        let redactions: [(String, String)] = [
            (#"(?i)\b(bearer\s+)[A-Za-z0-9._~+/-]+"#, "$1[REDACTED]"),
            (
                #"(?i)(["']?(?:message|content|prompt|transcript|draft|body)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}&]+)"#,
                "$1[REDACTED]"
            ),
            (
                #"(?i)(["']?(?:authorization|access[_-]?token|refresh[_-]?token|token|api[_-]?key|password|passwd|cookie|secret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}&]+)"#,
                "$1[REDACTED]"
            )
        ]
        for (pattern, replacement) in redactions {
            text = text.replacingOccurrences(
                of: pattern, with: replacement, options: .regularExpression
            )
        }
        return String(decoding: text.utf8.prefix(limit), as: UTF8.self)
    }

    private static func redactURLs(_ value: String) -> String {
        let pattern = #"(?i)\b(?:https?|wss?)://[^\s"'<>]+"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return value }
        let nsValue = value as NSString
        let result = NSMutableString(string: value)
        for match in regex.matches(in: value, range: NSRange(location: 0, length: nsValue.length)).reversed() {
            let raw = nsValue.substring(with: match.range)
            let replacement: String
            if var components = URLComponents(string: raw) {
                components.user = nil
                components.password = nil
                components.query = nil
                components.fragment = nil
                replacement = components.string ?? "[URL]"
            } else {
                replacement = "[URL]"
            }
            result.replaceCharacters(in: match.range, with: replacement)
        }
        return result as String
    }
}
#endif
