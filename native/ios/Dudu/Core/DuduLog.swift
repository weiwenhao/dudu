import Foundation

/// One ephemeral interaction ID follows a homepage press through session preparation and navigation.
/// It contains no issue, session, computer or content identity, and never leaves diagnostics.
struct BoardOpenTrace {
    private let id = UUID().uuidString
    private let started = ProcessInfo.processInfo.systemUptime
    private let rowToken: String?

    init(rowToken: UUID? = nil) { self.rowToken = rowToken?.uuidString }

    func record(_ stage: String, state: String? = nil) {
        DuduLog.record("board.open.\(stage)", requestId: id,
                        historyId: rowToken,
                        elapsedMs: (ProcessInfo.processInfo.systemUptime - started) * 1_000, state: state)
    }
}

enum DuduLog {
    private static let queue = DispatchQueue(label: "com.harnessmobile.dudu.diagnostics")
    private static let maximumFileBytes = 512 * 1_024
    private static let retainedFiles = 4
    private static let allowedMethods: Set<String> = [
        "workspace.list", "session.list", "session.create", "session.open",
        "session.watch", "session.unwatch", "session.read", "session.send", "session.stop", "file.upload",
        "session.rename", "session.pin", "session.archive", "session.unarchive", "session.configure",
        "catalog.get", "navigation.get", "plugins.list", "assistant.open",
        "schedule.list", "approval.respond", "files.list", "files.read",
        "web.open", "web.close", "web.resource", "web.invoke",
        "web.stream.open", "web.stream.next", "web.stream.close",
        "session.search", "session.queue.update", "session.page", "session.tool",
        "session.changes", "session.diff", "session.file",
        "session.performance", "session.attachment", "question.answer",
        "session.team", "session.jobs", "session.job.output", "session.job.stop",
        "board.list", "issue.get", "issue.open", "issue.pick", "issue.create", "issue.update", "issue.assign",
        "inbox.list", "inbox.get", "inbox.read", "inbox.mark", "inbox.share", "inbox.complete"
    ]
    private static let allowedCountKeys: Set<String> = [
        "payloadBytes", "computerCount", "sessionCount", "workspaceCount", "rowCount",
        "attachmentCount", "messageCount", "pendingCount", "realizedCount", "visibleCount",
        "registeredCount", "latestRealizedCount", "followingCount", "scrollCommandCount",
        "frameCount", "lateFrameCount",
        "lanAddressCount", "publicAddressCount",
        // Where the single running indicator landed, when it is not the history's own last item (2026-11-20).
        "runningIndex", "itemCount",
        // How many points two rows of the history are drawn over each other (`chat.layout.overlap`, 2026-11-24): a number, never which rows.
        "overlapPoints",
        // How many of the App's Keychain items there are and how many of them can be read after the first unlock (2026-11-22): numbers only.
        "keychainItems", "keychainAfterFirstUnlock"
    ]
    private static let allowedGeometryKeys: Set<String> = [
        "bottomY", "viewportHeight", "lastRowHeight", "contentHeight", "contentOffset", "topInset", "bottomInset",
        "latestTopY", "latestBottomY", "latestRowHeight",
        // Where the history's offset was and where it landed when SwiftUI's List threw it to the top (`chat.scroll.teleport`, 2026-11-24).
        "offsetFrom", "offsetTo",
        "longestFrameMs",
        // Touch geometry only, never content or conversation identity. Drags record one release, not every frame.
        "tapX", "tapY", "screenWidth", "screenHeight",
        "dragX", "dragY", "dragTravel", "dragVelocityX", "dragVelocityY"
    ]

    /// Waits until what was recorded so far is written (the notification extension is stopped right after it answers).
    static func flush() { queue.sync {} }

    static func networkFailure(
        _ event: String, error: Error, method: String? = nil,
        requestId: String? = nil, elapsedMs: Double? = nil
    ) {
        #if !DUDU_APP_EXTENSION
        if let failure = error as? ConversationStorageError {
            record(event, level: "warn", method: method, requestId: requestId, elapsedMs: elapsedMs, code: failure.logCode)
            return
        }
        #endif
        if let failure = error as? DuduFailure {
            record(event, level: "warn", method: method, requestId: requestId, elapsedMs: elapsedMs, code: failure.logCode)
            return
        }
        let native = error as NSError
        let domain: String
        switch native.domain {
        case NSURLErrorDomain: domain = "url"
        case NSPOSIXErrorDomain: domain = "posix"
        case NSOSStatusErrorDomain: domain = "osstatus"
        default: domain = "other"
        }
        record(
            event, level: "warn", method: method, requestId: requestId, elapsedMs: elapsedMs,
            state: "\(domain).\(max(-100_000, min(100_000, native.code)))"
        )
    }

    static func record(
        _ event: String,
        level: String = "info",
        method: String? = nil,
        requestId: String? = nil,
        historyId: String? = nil,
        elapsedMs: Double? = nil,
        counts: [String: Int]? = nil,
        geometry: [String: Double]? = nil,
        state: String? = nil,
        code: String? = nil
    ) {
        guard event.range(of: #"^[A-Za-z0-9._-]{1,48}$"#, options: .regularExpression) != nil else {
            return
        }
        let timestamp = Date().timeIntervalSince1970 * 1_000
        var record: [String: Any] = [
            "source": "native-swiftui",
            "timestamp": timestamp,
            "level": ["debug", "info", "warn", "error"].contains(level) ? level : "info",
            "event": event
        ]
        if let method, allowedMethods.contains(method) { record["method"] = method }
        if let requestId, UUID(uuidString: requestId) != nil { record["requestId"] = requestId }
        if let historyId, UUID(uuidString: historyId) != nil { record["historyId"] = historyId }
        if let elapsedMs, elapsedMs.isFinite, elapsedMs >= 0 {
            record["elapsedMs"] = min(elapsedMs, 86_400_000)
        }
        if let counts {
            let safeCounts = counts.filter { allowedCountKeys.contains($0.key) && $0.value >= 0 }
            if !safeCounts.isEmpty { record["counts"] = safeCounts }
        }
        if let geometry {
            let safeGeometry = geometry.filter {
                allowedGeometryKeys.contains($0.key) && $0.value.isFinite && abs($0.value) <= 10_000_000
            }
            if !safeGeometry.isEmpty { record["geometry"] = safeGeometry }
        }
        if let state, state.range(of: #"^[A-Za-z0-9._-]{1,32}$"#, options: .regularExpression) != nil {
            record["state"] = state
        }
        if let code, code.count <= 48,
           code.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil {
            record["code"] = code.uppercased()
        }
        queue.async {
            append(record)
        }
    }

    private static func append(_ record: [String: Any]) {
        guard let directory = logDirectory() else { return }
        let file = directory.appendingPathComponent("events.jsonl")
        guard var data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else {
            return
        }
        data.append(0x0A)
        rotateIfNeeded(file: file, directory: directory, incomingBytes: data.count)

        if FileManager.default.fileExists(atPath: file.path) {
            guard let handle = try? FileHandle(forWritingTo: file) else { return }
            defer { try? handle.close() }
            do {
                try handle.seekToEnd()
                try handle.write(contentsOf: data)
            } catch {
                return
            }
        } else {
            try? data.write(to: file, options: .atomic)
        }
    }

    private static func rotateIfNeeded(file: URL, directory: URL, incomingBytes: Int) {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path),
              let size = attributes[.size] as? NSNumber,
              size.intValue + incomingBytes > maximumFileBytes else { return }

        for index in stride(from: retainedFiles - 1, through: 1, by: -1) {
            let source = directory.appendingPathComponent("events.\(index).jsonl")
            let destination = directory.appendingPathComponent("events.\(index + 1).jsonl")
            try? FileManager.default.removeItem(at: destination)
            if FileManager.default.fileExists(atPath: source.path) {
                try? FileManager.default.moveItem(at: source, to: destination)
            }
        }
        let firstArchive = directory.appendingPathComponent("events.1.jsonl")
        try? FileManager.default.removeItem(at: firstArchive)
        try? FileManager.default.moveItem(at: file, to: firstArchive)
    }

    private static func logDirectory() -> URL? {
        guard let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return nil
        }
        let directory = documents.appendingPathComponent("diagnostics/native-swiftui", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            return directory
        } catch {
            return nil
        }
    }
}
