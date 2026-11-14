import Foundation

/// The agents an issue can be given to, as the Desktop lists them: DSH's own (DeepSeek) and each harness the plugin found and has switched on. The providers the plugin sends are
/// exactly those (a harness that is off has no provider), so the list follows Settings > Providers on the computer, a harness the app has never heard of included. Until the
/// providers have come, every agent the app knows is offered, so that a list that has not loaded never takes the choice away. `keeping` is an agent already chosen: it stays.
enum AgentChoices {
    static let known: [SessionAgent] = [.claude, .codex, .pi, .deepseek]

    static func of(_ providers: [SessionProvider], keeping current: SessionAgent? = nil) -> [SessionAgent] {
        guard !providers.isEmpty else { return known }
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
