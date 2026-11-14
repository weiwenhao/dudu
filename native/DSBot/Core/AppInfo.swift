import Foundation

/// What the settings' 隐私政策, 关于 and 版本信息 rows show (owner, 2026-11-12: "隐私策略，关于，版本信息都放设置里面吧").
enum AppInfo {
    /// The privacy policy page, the one the App Store listing names too. Change the address here only.
    static let privacyPolicyURL = URL(string: "https://github.com/weiwenhao/dudu/blob/main/docs/privacy.md")!

    /// The product's one line, the owner's own (the README's and the GitHub About's).
    static let tagline = L10n.text("基于 DSH 的多 Agent 高效协作助手")

    /// "0.3.0 (94)": the version and the build of the running app, as the App Store and TestFlight name them.
    static var versionText: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "—"
        let build = info?["CFBundleVersion"] as? String ?? "—"
        return "\(version) (\(build))"
    }
}
