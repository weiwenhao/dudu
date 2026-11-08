import Foundation

struct MessageDraftRecovery: Sendable {
    let text: String

    /// Keep the failed submission before anything typed while its request was pending.
    func restoring(before newerDraft: String?) -> String? {
        let newer = newerDraft ?? ""
        guard !text.isEmpty else { return newer.isEmpty ? nil : newer }
        guard !newer.isEmpty else { return text }
        let separator = text.hasSuffix("\n") || newer.hasPrefix("\n") ? "" : "\n"
        return text + separator + newer
    }
}
