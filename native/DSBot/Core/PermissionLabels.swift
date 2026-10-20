import Foundation

/// DSH shows its built-in permission presets under Chinese names while the host reports the raw
/// ids ("read-only"). This applies the same names, and the same risk gate DSH puts in front of the
/// two presets that run with fewer confirmations.
enum PermissionLabels {
    private static let builtIn: [String: (zh: String, english: String)] = [
        "read-only": ("仅可查看", "Read Only"),
        "workspace-write": ("工作区内修改", "Workspace Write"),
        "danger-full-access": ("完全权限", "Full access"),
        "auto": ("自动审查", "Auto review")
    ]

    /// The choice under DSH's own name: a built-in preset whose name is still the machine value (or
    /// its stock English label) gets the Chinese label, any other host-supplied name is kept, and a
    /// kebab-case name is title-cased.
    static func localized(_ choice: Choice) -> Choice {
        var result = choice
        if let label = builtIn[choice.id], choice.name == choice.id || choice.name == label.english {
            result.name = label.zh
        } else if choice.name.range(of: #"^[a-z0-9]+(-[a-z0-9]+)*$"#, options: .regularExpression) != nil {
            result.name = choice.name.split(separator: "-").map { $0.prefix(1).uppercased() + $0.dropFirst() }
                .joined(separator: " ")
        }
        return result
    }

    struct Confirmation: Equatable {
        let title: String
        let message: String
        let action: String
    }

    /// The warning DSH shows before enabling a preset that reduces confirmation steps.
    static func confirmation(for presetID: String) -> Confirmation? {
        switch presetID {
        case "danger-full-access":
            return Confirmation(
                title: "确认启用完全权限？",
                message: "启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。",
                action: "启用完全权限"
            )
        case "auto":
            return Confirmation(
                title: "确认启用自动审查（实验）？",
                message: "自动审查不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型进行审查；审查拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。",
                action: "启用自动审查"
            )
        default:
            return nil
        }
    }
}
