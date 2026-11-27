import Foundation
import UIKit

/// The feedback of the settings (owner, 2026-11-27: 「可以把最近的日志，用户机型，和用户反馈内容一起发过来」, then 「只需要让用户填一个回信邮箱，其他的都不需要。你不需要显示出来我的邮箱，这都是我的隐私信息」):
/// the person writes what went wrong and where to answer; the App sends that with the recent diagnostics log and the phone's model, and shows none of the last two nor where it goes.
///
/// It goes to a form service that forwards it to the developer's mailbox (Web3Forms: one POST, JSON; the access key is public by the service's design and says only which mailbox), so that no address is in
/// the App, the repository or the interface, and the phone needs no mail account. The key is not there yet (the owner has to ask the service for it): until it is, nothing is sent and the send fails.
enum FeedbackChannel {
    static var endpoint = URL(string: "https://api.web3forms.com/submit")!
    static var accessKey = ""
    static let timeout: TimeInterval = 20
    /// The newest part of the log that goes along, cut at a whole line.
    static let maximumLogBytes = 150_000

    #if DEBUG && targetEnvironment(simulator)
    /// For the simulator: `-dudu-feedback-endpoint <url> -dudu-feedback-key <key>` points the send at a local server, so that the request can be looked at without the real service.
    static func applyReviewOverrides(_ arguments: [String] = ProcessInfo.processInfo.arguments) {
        if let index = arguments.firstIndex(of: "-dudu-feedback-endpoint"), arguments.indices.contains(index + 1),
           let url = URL(string: arguments[index + 1]) { endpoint = url }
        if let index = arguments.firstIndex(of: "-dudu-feedback-key"), arguments.indices.contains(index + 1) { accessKey = arguments[index + 1] }
    }
    #endif
}

enum FeedbackEmail {
    /// Something, an @, something, a dot and something, with no space: the address is only where an answer goes, a typo shows when it bounces.
    static func isValid(_ text: String) -> Bool {
        let address = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty, address.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else { return false }
        let parts = address.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let domain = parts[1].split(separator: ".", omittingEmptySubsequences: false)
        return domain.count >= 2 && domain.allSatisfy { !$0.isEmpty }
    }
}

enum FeedbackLogs {
    static let leftOutLine = "(earlier lines left out)"

    /// The newest lines of the log that fit in `limit` bytes, oldest first; `files` are the log's files, the newest first, and a line is kept whole or not at all. When older lines were left out, the first line says so.
    static func recent(newestFirst files: [Data], limit: Int) -> String {
        var kept: [Substring] = []
        var used = 0
        var leftOut = false
        scan: for file in files {
            guard let text = String(data: file, encoding: .utf8) else { continue }
            for line in text.split(separator: "\n", omittingEmptySubsequences: true).reversed() {
                let cost = line.utf8.count + 1
                if used + cost > limit { leftOut = true; break scan }
                kept.append(line)
                used += cost
            }
        }
        if leftOut {
            let markerCost = leftOutLine.utf8.count + 1
            while used + markerCost > limit, !kept.isEmpty {
                let oldest = kept.removeLast()
                used -= oldest.utf8.count + 1
            }
            guard markerCost <= limit else { return "" }
        }
        let body = kept.reversed().joined(separator: "\n")
        return leftOut ? leftOutLine + "\n" + body : body
    }

    /// The log of this phone: the files are read newest first and only as far as the limit needs.
    static func recentFromDevice(limit: Int = FeedbackChannel.maximumLogBytes) -> String {
        DuduLog.flush()
        guard let directory = DuduLog.logDirectory() else { return "" }
        var files: [Data] = []
        var total = 0
        for name in ["events.jsonl", "events.1.jsonl", "events.2.jsonl", "events.3.jsonl", "events.4.jsonl"] {
            guard let data = try? Data(contentsOf: directory.appendingPathComponent(name)) else { continue }
            files.append(data)
            total += data.count
            if total > limit { break }
        }
        return recent(newestFirst: files, limit: limit)
    }
}

struct FeedbackReport: Equatable {
    let message: String
    let email: String
    let app: String
    let device: String
    let language: String
    let logs: String

    /// What the phone is: "iPhone18,1 · iOS 26.3" (the model's identifier, as the system gives it; the simulator says which model it stands for).
    static func deviceDescription() -> String {
        var info = utsname()
        uname(&info)
        let machine = withUnsafePointer(to: &info.machine) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
        }
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine
        return "\(model) · \(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
    }

    /// "Dudu iOS 0.3.0 (169)".
    static func appDescription() -> String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "Dudu iOS \(version) (\(build))"
    }

    static func make(message: String, email: String) -> FeedbackReport {
        FeedbackReport(
            message: message.trimmingCharacters(in: .whitespacesAndNewlines),
            email: email.trimmingCharacters(in: .whitespacesAndNewlines),
            app: appDescription(), device: deviceDescription(),
            language: Locale.preferredLanguages.first ?? "", logs: FeedbackLogs.recentFromDevice()
        )
    }

    /// The fields of the one request (the form service mails every field it is given, as it is).
    func body(accessKey: String) -> [String: String] {
        [
            "access_key": accessKey,
            "subject": "Dudu 反馈 · " + app.replacingOccurrences(of: "Dudu ", with: "", options: .anchored),
            "from_name": "Dudu iOS",
            "email": email,
            "message": message,
            "app": app,
            "device": device,
            "language": language,
            "logs": logs,
        ]
    }
}

enum FeedbackError: Error { case notConfigured, failed }

struct FeedbackSender {
    var session: URLSession = .shared

    /// Whether the service says it sent the mail: 200 and `success: true`.
    static func succeeded(status: Int?, data: Data) -> Bool {
        guard status == 200, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return object["success"] as? Bool == true
    }

    static func request(for report: FeedbackReport, accessKey: String, endpoint: URL = FeedbackChannel.endpoint) throws -> URLRequest {
        var request = URLRequest(url: endpoint, timeoutInterval: FeedbackChannel.timeout)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONSerialization.data(withJSONObject: report.body(accessKey: accessKey))
        return request
    }

    /// Sends the report. Nothing leaves the phone while the channel has no access key.
    func send(_ report: FeedbackReport, accessKey: String = FeedbackChannel.accessKey) async throws {
        guard !accessKey.isEmpty else { throw FeedbackError.notConfigured }
        let (data, response) = try await session.data(for: Self.request(for: report, accessKey: accessKey))
        guard Self.succeeded(status: (response as? HTTPURLResponse)?.statusCode, data: data) else { throw FeedbackError.failed }
    }
}
