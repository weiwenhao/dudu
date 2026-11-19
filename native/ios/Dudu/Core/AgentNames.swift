// Written by scripts/sync-agent-assets.mjs from AGENT_NAMES in host/dudu-plugin/ui/issues/model.js. Do not edit: change that list and build again.

extension SessionAgent {
    /// The agents the Desktop names, in the order it offers them (the last is DSH's own).
    static let listed: [(id: String, name: String)] = [
        ("claude", "Claude"),
        ("codex", "ChatGPT"),
        ("pi", "Pi"),
        ("grok", "Grok"),
        ("kimi", "Kimi"),
        ("opencode", "OpenCode"),
        ("antigravity", "Antigravity"),
        ("codebuddy", "CodeBuddy"),
        ("devin", "Devin"),
        ("factory", "Factory"),
        ("qwen", "Qwen"),
        ("qoder", "Qoder"),
        ("deepseek", "DeepSeek"),
    ]

    /// The agents whose mark is a picture in its own colours; every other mark in the asset catalog is a template of one colour that the app tints.
    static let pictured: Set<String> = ["kimi", "antigravity", "devin"]
}
