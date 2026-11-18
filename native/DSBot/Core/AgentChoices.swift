import Foundation

/// The agents an issue can be given to, as the Desktop lists them: DSH's own (DeepSeek) and each harness the plugin found and has switched on. The providers the plugin sends are
/// exactly those (a harness that is off has no provider), so the list follows Settings > Providers on the computer, a harness the app has never heard of included. Until the
/// providers have come, the usual agents are offered (`usual`), so that a list that has not loaded never takes the choice away. `keeping` is an agent already chosen: it stays.
enum AgentChoices {
    /// Every agent the Desktop lists, in its order (AgentNames.swift): Claude, ChatGPT, Pi, the other harnesses, DeepSeek last.
    static let known: [SessionAgent] = SessionAgent.listed.compactMap { SessionAgent(rawValue: $0.id) }
    /// The agents offered while the computer has not said which harnesses it has (`USUAL_AGENTS` on the Desktop). The harnesses added on 2026-11-19 are not among them: most
    /// computers have none of them, so they appear only once the computer says they can be used.
    static let usual: Set<SessionAgent> = [.claude, .codex, .pi, .deepseek]

    static func of(_ providers: [SessionProvider], keeping current: SessionAgent? = nil) -> [SessionAgent] {
        guard !providers.isEmpty else { return known.filter { usual.contains($0) || $0 == current } }
        var found = Set(providers.compactMap(\.agent))
        found.insert(.deepseek)
        if let current { found.insert(current) }
        let order = known.filter { found.contains($0) }
        return order + found.subtracting(known).sorted { $0.rawValue < $1.rawValue }
    }
}

extension DSBotStore {
    func agentChoices(keeping current: SessionAgent? = nil) -> [SessionAgent] { AgentChoices.of(providers, keeping: current) }
}
