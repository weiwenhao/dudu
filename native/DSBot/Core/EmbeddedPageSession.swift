import Combine
import Foundation

enum EmbeddedDSHPage: String, Codable, Sendable {
    case plugins, trace, context, team, tools, settings
    /// A sidebar panel or a conversation view that a plugin added to DSH; the
    /// `target` names it.
    case panel, view
}

struct EmbeddedSettingsCategory: Decodable, Identifiable, Sendable, Equatable {
    let id: String
    let label: String
}

struct EmbeddedPageDocument: Decodable, Sendable {
    let id: String
    let html: String
}

struct EmbeddedPageResource: Decodable, Sendable {
    let mimeType: String
    let dataBase64: String
    let totalBytes: Int
    let eof: Bool
}

struct EmbeddedPageCall: Decodable, Sendable {
    let method: String
    let params: [String: JSONValue]?
}

private struct EmbeddedPageConfiguration: Encodable, Sendable {
    let id: String
    let kind: EmbeddedDSHPage
    let sessionId: String?
    let target: String?
    let transport: String?
    let basePath: String?
#if DEBUG && targetEnvironment(simulator)
    let reviewDiagnostics: Bool
#endif
}

actor EmbeddedPageCodec {
    static let shared = EmbeddedPageCodec()
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()
    private var transportScript: String?

    func decode<T: Decodable & Sendable>(_ type: T.Type, value: JSONValue) throws -> T {
        try decoder.decode(type, from: encoder.encode(value))
    }

    func call(_ source: String) throws -> EmbeddedPageCall {
        try decoder.decode(EmbeddedPageCall.self, from: Data(source.utf8))
    }

    func reply(_ value: JSONValue) throws -> String {
        String(decoding: try encoder.encode(value), as: UTF8.self)
    }

    func resource(_ value: JSONValue) throws -> (EmbeddedPageResource, Data) {
        let resource = try decode(EmbeddedPageResource.self, value: value)
        guard let data = Data(base64Encoded: resource.dataBase64),
              data.count <= 256 * 1_024,
              (0...40 * 1_024 * 1_024).contains(resource.totalBytes) else {
            throw DSBotFailure.protocolError
        }
        return (resource, data)
    }

    func bootstrap(
        id: String,
        page: EmbeddedDSHPage,
        target: String? = nil,
        sessionID: String?,
        transport: String? = nil,
        basePath: String? = nil
    ) throws -> String {
        if transportScript == nil {
            guard let url = Bundle.main.url(forResource: "EmbeddedTransport", withExtension: "js") else {
                throw DSBotFailure.protocolError
            }
            transportScript = try String(contentsOf: url, encoding: .utf8)
        }
#if DEBUG && targetEnvironment(simulator)
        let configuration = EmbeddedPageConfiguration(
            id: id, kind: page, sessionId: sessionID, target: target,
            transport: transport, basePath: basePath,
            reviewDiagnostics: ReviewWebDiagnostics.isEnabled
        )
#else
        let configuration = EmbeddedPageConfiguration(
            id: id, kind: page, sessionId: sessionID, target: target, transport: transport, basePath: basePath
        )
#endif
        let json = String(decoding: try encoder.encode(configuration), as: UTF8.self)
        return "window.__DSBOT_PAGE__=\(json);\n\(transportScript ?? "")"
    }
}

#if DEBUG && targetEnvironment(simulator)
private func makeHTTPPageReviewConnection(origin: String) throws -> (ConnectionEndpoint, String) {
    guard var components = URLComponents(string: origin),
          let scheme = components.scheme?.lowercased(),
          scheme == "http" || scheme == "https",
          let host = components.host?.lowercased(),
          ["127.0.0.1", "localhost", "::1"].contains(host),
          components.user == nil,
          components.password == nil,
          components.query == nil,
          components.fragment == nil,
          components.path.isEmpty || components.path == "/",
          components.port.map({ (1...65_535).contains($0) }) ?? true else {
        throw DSBotFailure.invalidLink
    }
    components.path = "/"
    components.queryItems = [
        URLQueryItem(name: "pair", value: String(repeating: "A", count: 43)),
        URLQueryItem(name: "computer", value: "review-desktop"),
    ]
    guard let link = components.string else { throw DSBotFailure.invalidLink }
    return (try ConnectionEndpoint.parse(link), "review-desktop")
}
#endif

@MainActor
final class EmbeddedPageSession: ObservableObject {
    @Published private(set) var location: String?
    @Published private(set) var document: EmbeddedPageDocument?
    @Published private(set) var bootstrap = ""
    @Published private(set) var isLoading = true
    @Published private(set) var error: String?
    @Published private(set) var settingsCategories: [EmbeddedSettingsCategory] = []
    @Published private(set) var hasReceivedSettingsCategories = false
    @Published private(set) var selectedSettingsCategoryID: String?
    private var hasPendingSettingsMutation = false
    private var httpClient: EmbeddedHTTPPageClient?
    @Published private(set) var openedHTTPPage: OpenedHTTPPage?

    /// Set for pages kept in `EmbeddedPagePool`: the web view outlives the screen showing it.
    var isPooled = false
    /// The pooled page's web view host, so the next visit can reuse the loaded page.
    var surfaceHost: AnyObject?
    /// Tears the web view down; run when the page is closed for good.
    var teardownSurface: (() -> Void)?

    private(set) var revision = -1
    private(set) var computerID: String?
    private(set) var page: EmbeddedDSHPage?
    private weak var store: DSBotStore?
    private var openID = UUID()
    private var readyTimeout: Task<Void, Never>?
    private var openStartedAt: TimeInterval?

    var pageID: String? {
        openedHTTPPage?.id ?? document?.id
    }

    var hasPage: Bool {
        pageID != nil
    }

    var usesHTTPTransport: Bool {
        openedHTTPPage != nil
    }

    var isCurrent: Bool {
        guard let store else { return false }
        return store.status == .connected && store.connectionRevision == revision
            && store.activeComputer?.id == computerID
    }

    func open(page: EmbeddedDSHPage, target: String? = nil, sessionID: String?, store: DSBotStore, location: String) async {
        close()
        self.store = store
        self.page = page
        revision = store.connectionRevision
        computerID = store.activeComputer?.id
        settingsCategories = []
        hasReceivedSettingsCategories = false
        selectedSettingsCategoryID = nil
        let operation = UUID()
        openID = operation
        openStartedAt = ProcessInfo.processInfo.systemUptime
        isLoading = true
        error = nil
        self.location = location
        let openingRevision = revision
        let openingComputer = computerID
        var unpublishedDocumentID: String?
        var unpublishedHTTPClient: EmbeddedHTTPPageClient?
        var unpublishedHTTPPage: OpenedHTTPPage?
        defer {
            if let id = unpublishedDocumentID {
                Task {
                    guard store.connectionRevision == openingRevision,
                          store.activeComputer?.id == openingComputer else { return }
                    _ = try? await store.request("web.close", ["id": .string(id)])
                }
            }
            if let client = unpublishedHTTPClient, let opened = unpublishedHTTPPage {
                Task { await client.close(opened) }
            }
        }
        DSBotLog.record("web.page.open", state: page.rawValue)
#if DEBUG && targetEnvironment(simulator)
        ReviewWebDiagnostics.record(stage: "boot.open.begin", pageKind: page.rawValue)
#endif
        do {
            var nextDocument: EmbeddedPageDocument?
            var nextHTTPClient: EmbeddedHTTPPageClient?
            var nextHTTPPage: OpenedHTTPPage?
            let nextID: String
            let transport: String?
            let basePath: String?

#if DEBUG && targetEnvironment(simulator)
            let isReviewApp = ProcessInfo.processInfo.arguments.contains("-dsbot-ui-review")
            let reviewOrigin = isReviewApp
                ? ProcessInfo.processInfo.environment["DSBOT_HTTP_PAGE_REVIEW_ORIGIN"]
                : nil
            let useLegacyReviewPages = isReviewApp && reviewOrigin == nil
#else
            let reviewOrigin: String? = nil
            let useLegacyReviewPages = false
#endif

            if useLegacyReviewPages {
                var params: [String: JSONValue] = ["page": .string(page.rawValue)]
                if let sessionID { params["sessionId"] = .string(sessionID) }
                if let target { params["target"] = .string(target) }
                let value = try await store.request("web.open", params)
                let next = try await EmbeddedPageCodec.shared.decode(
                    EmbeddedPageDocument.self, value: value
                )
                guard UUID(uuidString: next.id) != nil else { throw DSBotFailure.protocolError }
                unpublishedDocumentID = next.id
                nextDocument = next
                nextID = next.id
                transport = nil
                basePath = nil
            } else {
                let savedURL = store.activeComputer?.url
                let savedComputerID = store.activeComputer?.computerId
                let (endpoint, expectedComputerID) = try await Task.detached(priority: .userInitiated) {
#if DEBUG && targetEnvironment(simulator)
                    if let reviewOrigin {
                        return try makeHTTPPageReviewConnection(origin: reviewOrigin)
                    }
#endif
                    guard let savedURL, let savedComputerID, !savedComputerID.isEmpty else {
                        throw DSBotFailure.identityMismatch
                    }
                    let endpoint = try ConnectionEndpoint.parse(savedURL)
                    if let endpointComputerID = endpoint.computerId,
                       endpointComputerID != savedComputerID {
                        throw DSBotFailure.identityMismatch
                    }
                    return (endpoint, savedComputerID)
                }.value
                guard openID == operation, isCurrent, !Task.isCancelled else { return }

                let client = EmbeddedHTTPPageClient(
                    endpoint: endpoint,
                    expectedComputerID: expectedComputerID
                )
                unpublishedHTTPClient = client
                let opened = try await client.open(page: page, target: target, sessionID: sessionID)
                DSBotLog.record(
                    "web.page.handle",
                    elapsedMs: elapsedSinceOpen,
                    state: page.rawValue
                )
                unpublishedHTTPPage = opened
                guard openID == operation, isCurrent, !Task.isCancelled else { return }
                nextHTTPClient = client
                nextHTTPPage = opened
                nextID = opened.id
                transport = "http"
                basePath = opened.basePath
            }
            guard openID == operation, isCurrent, !Task.isCancelled else { return }
#if DEBUG && targetEnvironment(simulator)
            ReviewWebDiagnostics.record(stage: "boot.open.complete", pageKind: page.rawValue)
#endif
            let script = try await EmbeddedPageCodec.shared.bootstrap(
                id: nextID,
                page: page,
                target: target,
                sessionID: sessionID,
                transport: transport,
                basePath: basePath
            )
            guard openID == operation, isCurrent, !Task.isCancelled else { return }
            bootstrap = script
            document = nextDocument
            httpClient = nextHTTPClient
            openedHTTPPage = nextHTTPPage
            unpublishedDocumentID = nil
            unpublishedHTTPClient = nil
            unpublishedHTTPPage = nil
#if DEBUG && targetEnvironment(simulator)
            ReviewWebDiagnostics.record(stage: "boot.transport.injected", pageKind: page.rawValue)
#endif
            readyTimeout = Task { [weak self] in
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled, let self, self.openID == operation, self.isLoading else { return }
                self.fail()
            }
        } catch is CancellationError {
            return
        } catch {
            guard openID == operation else { return }
            self.error = (error as? DSBotFailure)?.localizedDescription ?? "页面未能打开"
            isLoading = false
            DSBotLog.record("web.page.fail", level: "warn", elapsedMs: elapsedSinceOpen, state: page.rawValue)
            openStartedAt = nil
#if DEBUG && targetEnvironment(simulator)
            ReviewWebDiagnostics.record(
                stage: "boot.fail",
                pageKind: page.rawValue,
                message: String(describing: error)
            )
#endif
        }
    }

    func receiveSettingsCategories(_ params: [String: JSONValue], documentID: String) async throws {
        guard page == .settings, pageID == documentID, isCurrent,
              params.count == 1, let value = params["categories"] else {
            throw DSBotFailure.unsupportedRequest
        }
        let categories = try await EmbeddedPageCodec.shared.decode(
            [EmbeddedSettingsCategory].self, value: value
        )
        guard page == .settings, pageID == documentID, isCurrent else {
            throw CancellationError()
        }
        let identifiers = categories.map(\.id)
        guard categories.count <= 100,
              Set(identifiers).count == identifiers.count,
              categories.allSatisfy({ category in
                  (1...128).contains(category.id.count)
                      && category.id == category.id.trimmingCharacters(in: .whitespacesAndNewlines)
                      && category.id.rangeOfCharacter(from: .controlCharacters) == nil
                      && (1...160).contains(category.label.count)
                      && category.label == category.label.trimmingCharacters(in: .whitespacesAndNewlines)
                      && category.label.rangeOfCharacter(from: .controlCharacters) == nil
              }) else {
            throw DSBotFailure.protocolError
        }
        settingsCategories = categories
        hasReceivedSettingsCategories = true
        if let selectedSettingsCategoryID,
           !categories.contains(where: { $0.id == selectedSettingsCategoryID }) {
            self.selectedSettingsCategoryID = nil
        }
    }

    /// The category is chosen from the host's list, so it may be picked before the page itself has
    /// published its categories; the page switches once it is ready.
    func selectSettingsCategory(_ id: String?) {
        guard page == .settings, isCurrent else { return }
        selectedSettingsCategoryID = id
    }

    func recordSettingsMutation() {
        guard page == .settings, isCurrent else { return }
        hasPendingSettingsMutation = true
    }

    func consumeSettingsMutation() -> Bool {
        defer { hasPendingSettingsMutation = false }
        return hasPendingSettingsMutation
    }

    func ready() {
        guard hasPage, isCurrent else { return }
        readyTimeout?.cancel()
        readyTimeout = nil
        isLoading = false
        error = nil
        DSBotLog.record("web.page.ready", elapsedMs: elapsedSinceOpen, state: page?.rawValue)
        openStartedAt = nil
#if DEBUG && targetEnvironment(simulator)
        if let page {
            ReviewWebDiagnostics.record(stage: "boot.ready", pageKind: page.rawValue)
        }
#endif
    }

    func fail() {
        readyTimeout?.cancel()
        readyTimeout = nil
        isLoading = false
        error = "页面未能打开"
        DSBotLog.record("web.page.fail", level: "warn", elapsedMs: elapsedSinceOpen, state: page?.rawValue)
        openStartedAt = nil
#if DEBUG && targetEnvironment(simulator)
        if let page {
            ReviewWebDiagnostics.record(stage: "boot.fail", pageKind: page.rawValue)
        }
#endif
    }

    func request(_ method: String, params: [String: JSONValue]) async throws -> JSONValue {
        guard !usesHTTPTransport,
              let store, let document, isCurrent else {
            throw DSBotFailure.disconnected
        }
        var scoped = params
        scoped["id"] = .string(document.id)
        let result = try await store.request(method, scoped)
        guard isCurrent, self.document?.id == document.id else { throw CancellationError() }
        return result
    }

    func resource(path: String) async throws -> EmbeddedResourceData {
        guard !usesHTTPTransport, isCurrent, let computerID else {
            throw DSBotFailure.disconnected
        }
        let key = "\(computerID)/\(revision)/\(path)"
        let pageID = document?.id
#if DEBUG && targetEnvironment(simulator)
        if let page {
            ReviewWebDiagnostics.record(
                stage: "resource.fetch.start", pageKind: page.rawValue, filename: path
            )
        }
#endif
        let resource = try await EmbeddedResourceCache.shared.resource(key: key) { [weak self] offset in
            guard let self else { throw CancellationError() }
            return try await self.request("web.resource", params: [
                "path": .string(path), "offset": .number(Double(offset))
            ])
        }
        guard isCurrent, document?.id == pageID else { throw CancellationError() }
#if DEBUG && targetEnvironment(simulator)
        if let page {
            ReviewWebDiagnostics.record(
                stage: "resource.fetch.complete",
                pageKind: page.rawValue,
                filename: path
            )
        }
#endif
        return resource
    }

    func close() {
        teardownSurface?()
        teardownSurface = nil
        surfaceHost = nil
        let oldDocumentID = document?.id
        let oldHTTPClient = httpClient
        let oldHTTPPage = openedHTTPPage
        let canCloseLegacyPage = isCurrent
        readyTimeout?.cancel()
        readyTimeout = nil
        openID = UUID()
        openStartedAt = nil
        location = nil
        document = nil
        httpClient = nil
        openedHTTPPage = nil
        bootstrap = ""
        page = nil
        settingsCategories = []
        hasReceivedSettingsCategories = false
        selectedSettingsCategoryID = nil
        isLoading = true
        error = nil
        if let oldHTTPClient, let oldHTTPPage {
            Task { await oldHTTPClient.close(oldHTTPPage) }
            DSBotLog.record("web.page.close")
        } else if let oldDocumentID, let store, canCloseLegacyPage {
            Task { _ = try? await store.request("web.close", ["id": .string(oldDocumentID)]) }
            DSBotLog.record("web.page.close")
        }
    }

    private var elapsedSinceOpen: Double? {
        guard let openStartedAt else { return nil }
        return max(0, (ProcessInfo.processInfo.systemUptime - openStartedAt) * 1_000)
    }
}
