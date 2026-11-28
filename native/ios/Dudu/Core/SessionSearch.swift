import Combine
import Foundation

struct SessionSearchHit: Codable, Identifiable, Sendable, Equatable {
    var session: SessionSummary
    var snippet: String

    var id: String { session.id }
}

struct SessionSearchPage: Codable, Sendable, Equatable {
    var items: [SessionSearchHit]
    var hasMore: Bool
    var indexing: Bool?
}

enum SessionSearchResults {
    static func merge(query: String, sessions: [SessionSummary], hits: [SessionSearchHit]) -> [SessionSearchHit] {
        let phrase = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !phrase.isEmpty else { return [] }
        var matches: [String: SessionSearchHit] = [:]
        for session in sessions where session.blank != true {
            if session.title.localizedCaseInsensitiveContains(phrase)
                || session.workspaceName?.localizedCaseInsensitiveContains(phrase) == true {
                matches[session.id] = SessionSearchHit(session: session, snippet: "")
            }
        }
        for hit in hits where hit.session.blank != true {
            matches[hit.id] = hit
        }
        return matches.values.sorted {
            if $0.session.updatedAt == $1.session.updatedAt { return $0.id < $1.id }
            return $0.session.updatedAt > $1.session.updatedAt
        }
    }
}

@MainActor
final class SessionSearchModel: ObservableObject {
    @Published var query = ""
    @Published private(set) var results: [SessionSearchHit] = []
    @Published private(set) var isLoading = false
    @Published private(set) var error: String?
    @Published private(set) var retryRevision = 0
    private var requestID = UUID()
    private var loadedQuery: String?
    private var loadedComputerID: String?
    private var loadedRevision: Int?

    func reset() {
        requestID = UUID()
        query = ""
        results = []
        isLoading = false
        error = nil
        loadedQuery = nil
        loadedComputerID = nil
        loadedRevision = nil
    }

    func retry() {
        loadedQuery = nil
        retryRevision &+= 1
    }

    func load(using store: DuduStore) async {
        let phrase = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let computerID = store.activeComputer?.id
        let revision = store.connectionRevision
        if loadedQuery == phrase, loadedComputerID == computerID, loadedRevision == revision { return }
        let loadID = UUID()
        requestID = loadID
        loadedQuery = nil
        error = nil
        guard !phrase.isEmpty else {
            results = []
            isLoading = false
            return
        }
        let localMatches = SessionSearchResults.merge(query: phrase, sessions: store.sessions, hits: [])
        results = localMatches
        isLoading = true
        defer {
            if requestID == loadID { isLoading = false }
        }
        do {
            try await Task.sleep(for: .milliseconds(200))
            try Task.checkCancellation()
            DuduLog.record("session.search", counts: ["payloadBytes": phrase.utf8.count])
            while !Task.isCancelled {
                let page = try await store.searchSessions(phrase)
                guard requestID == loadID, !Task.isCancelled else { return }
                results = SessionSearchResults.merge(query: phrase, sessions: store.sessions, hits: page.items)
                if page.indexing != true {
                    loadedQuery = phrase
                    loadedComputerID = computerID
                    loadedRevision = revision
                    return
                }
                // Keep partial results readable while the shared desktop index catches up.
                try await Task.sleep(for: .seconds(1))
            }
        } catch is CancellationError {
            return
        } catch {
            guard requestID == loadID, !Task.isCancelled else { return }
            if let failure = error as? DuduFailure, case let .remote(code) = failure,
               ["UNSUPPORTED", "METHOD_NOT_ALLOWED"].contains(code) {
                self.error = L10n.text("请更新电脑端的 Dudu 插件")
            } else {
                self.error = (error as? DuduFailure ?? .connectionFailed).localizedDescription
            }
        }
    }
}
