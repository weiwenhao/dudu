import Foundation

/// The settings' privacy and About entries, and the version footer.
enum AppInfo {
    /// The privacy policy page, the one the App Store listing names too. Change the address here only.
    static let privacyPolicyURL = URL(string: "https://github.com/weiwenhao/dudu/blob/main/docs/privacy.md")!

    /// The product's one line, the owner's own (the README's and the GitHub About's).
    static let tagline = L10n.text("基于 DSH 的多 Agent 高效协作助手")

    /// The owner's settings-footer reference (2026-11-15): the app name followed by its release version.
    static var versionText: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
        return "Dudu v\(version)"
    }
}
