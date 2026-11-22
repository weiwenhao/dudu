import Foundation

/// The settings' privacy and About entries, and the version footer.
enum AppInfo {
    /// The privacy policy page, the one the App Store listing names too. Change the address here only.
    static let privacyPolicyURL = URL(string: "https://github.com/weiwenhao/dudu/blob/main/docs/privacy.md")!

    /// The product's one line, the owner's own (the README's and the GitHub About's).
    static let tagline = L10n.text("基于 DSH 的多 Agent 高效协作助手")

    /// The settings footer: the release version and the build number, without the app's name (owner, 2026-11-21: "不需要显示 app 名称，只需要版本号和构建号就行了").
    static var versionText: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "—"
        guard let build = info?["CFBundleVersion"] as? String, !build.isEmpty else { return "v\(version)" }
        return "v\(version) (\(build))"
    }
}
