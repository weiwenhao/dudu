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

    func load(using store: DSBotStore) async {
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
            DSBotLog.record("session.search", counts: ["payloadBytes": phrase.utf8.count])
            let page = try await store.searchSessions(phrase)
            guard requestID == loadID, !Task.isCancelled else { return }
            results = SessionSearchResults.merge(query: phrase, sessions: store.sessions, hits: page.items)
            loadedQuery = phrase
            loadedComputerID = computerID
            loadedRevision = revision
        } catch is CancellationError {
            return
        } catch {
            guard requestID == loadID, !Task.isCancelled else { return }
            if let failure = error as? DSBotFailure, case let .remote(code) = failure,
               ["UNSUPPORTED", "METHOD_NOT_ALLOWED"].contains(code) {
                self.error = "请先在电脑上更新 Dudu 插件，再使用此功能。"
            } else {
                self.error = (error as? DSBotFailure ?? .connectionFailed).localizedDescription
            }
        }
    }
}
