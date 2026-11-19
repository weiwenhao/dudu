import Combine
import Foundation

/// Keeps DSH pages (plugins, trace, context, team) loaded for a few minutes after the user leaves
/// them, so coming back shows the page at once instead of booting DSH's frontend again.
/// Only pages the person actually opened are created; chats do not speculatively boot WebViews.
@MainActor
final class EmbeddedPagePool: ObservableObject {
    static let lifetime: Duration = .seconds(300)
    static let capacity = 3

    private typealias Key = EmbeddedPageRoute

    private var sessions: [Key: EmbeddedPageSession] = [:]
    private var expiries: [Key: Task<Void, Never>] = [:]
    private var leftAt: [Key: ContinuousClock.Instant] = [:]
    /// Pages on screen when the connection changed. They reopen themselves in place, so they are
    /// closed rather than kept once the user leaves them.
    private var outdated: Set<Key> = []
    private var connection = ""
    /// The session for a page, reusing one that was kept; it counts as in use again.
    func session(page: EmbeddedDSHPage, target: String? = nil, sessionID: String?) -> EmbeddedPageSession {
        let key = Key(page: page, target: target, sessionID: sessionID)
        expiries.removeValue(forKey: key)?.cancel()
        leftAt[key] = nil
        if let existing = sessions[key] { return existing }
        let session = EmbeddedPageSession()
        session.isPooled = true
        sessions[key] = session
        return session
    }

    /// The page is on screen again (or never really left): cancel any pending expiry.
    func markInUse(page: EmbeddedDSHPage, target: String? = nil, sessionID: String?) {
        let key = Key(page: page, target: target, sessionID: sessionID)
        expiries.removeValue(forKey: key)?.cancel()
        leftAt[key] = nil
    }

    /// The user left the page: keep it warm for a while.
    func release(page: EmbeddedDSHPage, target: String? = nil, sessionID: String?) {
        let key = Key(page: page, target: target, sessionID: sessionID)
        guard sessions[key] != nil else { return }
        if outdated.remove(key) != nil {
            discard(key)
            return
        }
        leftAt[key] = ContinuousClock.now
        expiries[key]?.cancel()
        expire(key)
        for (oldest, _) in leftAt.sorted(by: { $0.value < $1.value }).dropLast(Self.capacity) {
            discard(oldest)
        }
    }

    /// The connection (computer or reconnect) changed: every page opened on the old one is stale.
    /// Kept pages are closed now; a page still on screen reopens itself and is closed once left.
    func connectionChanged(to next: String) {
        guard next != connection else { return }
        connection = next
        for key in Array(leftAt.keys) { discard(key) }
        outdated = Set(sessions.keys)
    }

    /// A background app or memory warning keeps only pages actually owned by a visible screen.
    func discardReleasedPages() {
        for key in Array(leftAt.keys) { discard(key) }
    }

    var keptPageCount: Int { leftAt.count }

    private func expire(_ key: Key) {
        expiries[key]?.cancel()
        expiries[key] = Task { [weak self] in
            try? await Task.sleep(for: Self.lifetime)
            guard !Task.isCancelled else { return }
            self?.discard(key)
        }
    }

    private func discard(_ key: Key) {
        expiries.removeValue(forKey: key)?.cancel()
        leftAt[key] = nil
        outdated.remove(key)
        sessions.removeValue(forKey: key)?.close()
    }
}
