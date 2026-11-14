import Foundation

/// iOS resolves the App's preferred language, including its per-App language setting.
/// This is presentation state only: never use it to rewrite stored or user-supplied content.
enum L10n {
    static let language = resolve(Bundle.main.preferredLocalizations)
    static var acceptLanguage: String { language == "zh-Hans" ? "zh-CN" : "en" }
    private static let resourceBundle = Bundle.main.path(forResource: language, ofType: "lproj")
        .flatMap(Bundle.init(path:)) ?? .main
    static let locale: Locale = {
        let region = Locale.current.region?.identifier ?? (language == "en" ? "US" : "CN")
        return Locale(identifier: "\(language)_\(region)")
    }()

    static func resolve(_ preferences: [String]) -> String {
        for tag in preferences {
            let base = tag.replacingOccurrences(of: "_", with: "-").lowercased()
            if base == "en" || base.hasPrefix("en-") { return "en" }
            if base == "zh" || base.hasPrefix("zh-") { return "zh-Hans" }
        }
        return "zh-Hans"
    }

    static func text(_ key: String, _ values: String...) -> String {
        render(resourceBundle.localizedString(forKey: key, value: key, table: "Localizable"), values: values)
    }

    static func plural(_ value: String.LocalizationValue) -> String {
        String(localized: value, bundle: resourceBundle, locale: locale)
    }

    /// Substitute in one pass, so braces in a title, prompt or remote error remain literal.
    static func render(_ template: String, values: [String]) -> String {
        let pattern = #/\{([0-9]+)\}/#
        return template.replacing(pattern) { match in
            guard let index = Int(match.1), values.indices.contains(index) else { return String(match.0) }
            return values[index]
        }
    }

    static func list(_ values: [String]) -> String {
        let formatter = ListFormatter()
        formatter.locale = locale
        return formatter.string(from: values) ?? values.joined(separator: ", ")
    }

    static func date(_ value: Date, template: String, timezone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timezone
        formatter.setLocalizedDateFormatFromTemplate(template)
        return formatter.string(from: value)
    }
}
