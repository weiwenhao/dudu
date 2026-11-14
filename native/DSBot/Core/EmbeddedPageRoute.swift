import Foundation

struct EmbeddedPageRoute: Hashable, Sendable {
    let page: EmbeddedDSHPage
    let target: String?
    let sessionID: String?

    init(page: EmbeddedDSHPage, target: String? = nil, sessionID: String? = nil) {
        self.page = page
        self.target = target
        self.sessionID = sessionID
    }

    func location(computerID: String?, revision: Int, status: String, retry: Int = 0) -> String {
        "\(computerID ?? "")/\(revision)/\(status)/\(page.rawValue)/\(target ?? "")/\(sessionID ?? "")/\(retry)"
    }

    /// Only registered web routes are candidates; native screens and other conversations stay alone.
    static func preloadCandidates(navigation: NavigationCatalog, sessionID: String?) -> [Self] {
        guard navigation.available else { return [] }
        let sidebar = navigation.sidebar.compactMap { item -> Self? in
            guard case let .web(page, target) = item.target,
                  !page.needsSession, [.plugins, .panel].contains(page) else { return nil }
            return Self(page: page, target: target)
        }
        let context = sessionID.flatMap { sessionID in
            navigation.views.compactMap { item -> Self? in
                guard case let .web(page, target) = item.target, page == .context else { return nil }
                return Self(page: page, target: target, sessionID: sessionID)
            }.first
        }
        let ordered = sidebar.filter { $0.page == .plugins } + (context.map { [$0] } ?? []) + sidebar
        var seen: Set<Self> = []
        return Array(ordered.filter { seen.insert($0).inserted }.prefix(3))
    }
}
