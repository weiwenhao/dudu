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
}
