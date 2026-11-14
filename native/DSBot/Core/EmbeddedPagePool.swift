import Combine
import Foundation

/// Keeps DSH pages (plugins, trace, context, team) loaded for a few minutes after the user leaves
/// them, so coming back shows the page at once instead of booting DSH's frontend again.
///
/// Preparation uses the same authenticated pages and capacity. Its selected pages remain warm
/// while the app is active; other released pages expire after `lifetime`.
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
    private var preloadTask: Task<Void, Never>?
    private var preloadGeneration = UUID()
    private var preloadAttempts: Set<Key> = []
    private var preloadTargets: Set<Key> = []
    /// Removed as soon as a screen claims the page, so cancelling preparation cannot close it.
    private var unclaimedPreloads: Set<Key> = []

    /// The session for a page, reusing one that was kept; it counts as in use again.
    func session(page: EmbeddedDSHPage, target: String? = nil, sessionID: String?) -> EmbeddedPageSession {
        let key = Key(page: page, target: target, sessionID: sessionID)
        if unclaimedPreloads.remove(key) != nil, let kept = sessions[key] {
            DSBotLog.record("web.preload.use", state: kept.isLoading ? "loading" : "ready")
        }
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
        unclaimedPreloads.remove(key)
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
        if !preloadTargets.contains(key) { expire(key) }
        for (oldest, _) in leftAt.sorted(by: { $0.value < $1.value }).dropLast(Self.capacity) {
            discard(oldest)
        }
    }

    /// The connection (computer or reconnect) changed: every page opened on the old one is stale.
    /// Kept pages are closed now; a page still on screen reopens itself and is closed once left.
    func connectionChanged(to next: String) {
        guard next != connection else { return }
        cancelPreloading()
        preloadAttempts.removeAll()
        connection = next
        for key in Array(leftAt.keys) { discard(key) }
        outdated = Set(sessions.keys)
    }

    /// Boot actual WebViews serially after native restoration, not just their HTTP page handles.
    func preload(_ routes: [EmbeddedPageRoute], using store: DSBotStore, viewport: CGSize) {
        cancelPreloading()
        let wanted = Set(routes)
        preloadAttempts.formIntersection(wanted)
        for key in Array(unclaimedPreloads) where !wanted.contains(key) { discard(key) }
        guard store.status == .connected, viewport.width > 0, viewport.height > 0 else { return }
        preloadTargets = wanted
        for key in wanted { expiries.removeValue(forKey: key)?.cancel() }
        let generation = preloadGeneration
        let revision = store.connectionRevision
        let computerID = store.activeComputer?.id
        preloadTask = Task { [weak self, weak store] in
            guard let self, let store else { return }
            for route in routes.prefix(Self.capacity) {
                guard !Task.isCancelled, generation == self.preloadGeneration,
                      store.status == .connected else { return }
                if let existing = self.sessions[route] {
                    if self.leftAt[route] == nil { continue }
                    if existing.isCurrent, existing.location != nil, existing.error == nil { continue }
                    self.discard(route)
                }
                guard self.preloadAttempts.insert(route).inserted else { continue }
                // Preparation never evicts a page that is on screen.
                if self.leftAt.count >= Self.capacity { continue }
                let session = EmbeddedPageSession()
                session.isPooled = true
                self.sessions[route]?.close()
                self.sessions[route] = session
                self.unclaimedPreloads.insert(route)
                self.release(page: route.page, target: route.target, sessionID: route.sessionID)
                DSBotLog.record("web.preload.begin", state: route.page.rawValue)
                let location = route.location(
                    computerID: computerID, revision: revision, status: store.status.rawValue
                )
                // A screen may claim this operation before its HTTP handle arrives.
                // Cancelling the speculative queue must not cancel that screen's open.
                let opening = Task {
                    guard self.sessions[route] === session,
                          store.connectionRevision == revision,
                          store.activeComputer?.id == computerID,
                          store.status == .connected else { return }
                    if session.isCurrent, session.location == location, session.error == nil { return }
                    await session.open(
                        page: route.page, target: route.target, sessionID: route.sessionID,
                        store: store, location: location
                    )
                }
                await opening.value
                guard !Task.isCancelled, generation == self.preloadGeneration,
                      self.sessions[route] === session else { return }
                if session.hasPage, session.error == nil {
                    EmbeddedPageView.preload(session: session, page: route.page, viewport: viewport)
                }
                if session.isCurrent, session.error == nil, session.isLoading {
                    for await loading in session.$isLoading.values {
                        if !loading || Task.isCancelled || generation != self.preloadGeneration { break }
                    }
                }
                guard !Task.isCancelled, generation == self.preloadGeneration else { return }
                if session.error != nil, self.unclaimedPreloads.contains(route) {
                    self.discard(route)
                }
            }
        }
    }

    func cancelPreloading() {
        preloadGeneration = UUID()
        preloadTask?.cancel()
        preloadTask = nil
        preloadTargets.removeAll()
        for key in Array(unclaimedPreloads) where sessions[key]?.isLoading == true {
            preloadAttempts.remove(key)
            discard(key)
        }
        for key in leftAt.keys { expire(key) }
    }

    /// A background app or memory warning keeps only pages actually owned by a visible screen.
    func discardReleasedPages() {
        cancelPreloading()
        for key in Array(leftAt.keys) { discard(key) }
        preloadAttempts.removeAll()
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
        unclaimedPreloads.remove(key)
        sessions.removeValue(forKey: key)?.close()
    }
}
