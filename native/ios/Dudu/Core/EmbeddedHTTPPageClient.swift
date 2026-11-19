import Foundation

private struct OpenPageRequest: Encodable {
    let page: String
    let sessionId: String?
    let target: String?

    enum CodingKeys: String, CodingKey {
        case page, sessionId, target
    }
}

private struct OpenPageResponse: Decodable, Sendable {
    let id: String
    let path: String
    let cookie: String
    let computerId: String
}

private struct ClosePageRequest: Encodable {
    let method = "web.close"
    let params: [String: String] = [:]
}

struct OpenedHTTPPage: Sendable {
    let id: String
    let path: String
    let basePath: String
    let url: URL
    let cookie: String
    let computerID: String
}

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

final class EmbeddedHTTPPageClient: @unchecked Sendable {
    private let endpoint: ConnectionEndpoint
    private let expectedComputerID: String
    private let session: URLSession
    private let delegate: NoRedirectDelegate

    init(
        endpoint: ConnectionEndpoint,
        expectedComputerID: String,
        configuration suppliedConfiguration: URLSessionConfiguration = .ephemeral
    ) {
        self.endpoint = endpoint
        self.expectedComputerID = expectedComputerID
        let configuration = (suppliedConfiguration.copy() as? URLSessionConfiguration)
            ?? suppliedConfiguration
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        delegate = NoRedirectDelegate()
        session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }

    func open(page: EmbeddedDSHPage, target: String? = nil, sessionID: String?) async throws -> OpenedHTTPPage {
        let url = try endpointURL(path: "/web/open")
        let body = try JSONEncoder().encode(OpenPageRequest(page: page.rawValue, sessionId: sessionID, target: target))
        var request = makeRequest(url: url, body: body, timeout: 20)
        request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await perform(request)
        guard response.statusCode == 200 else {
            throw failure(for: response.statusCode)
        }
        guard data.count <= 64 * 1_024,
              let opened = try? await Task.detached(priority: .utility, operation: {
                  try JSONDecoder().decode(OpenPageResponse.self, from: data)
              }).value,
              UUID(uuidString: opened.id) != nil,
              opened.computerId == expectedComputerID,
              opened.cookie.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil
        else {
            throw DuduFailure.protocolError
        }

        let scopedPath = "/ui/\(opened.id)/"
        guard opened.path == scopedPath,
              let pageURL = try? endpointURL(path: scopedPath) else {
            throw DuduFailure.protocolError
        }
        return OpenedHTTPPage(
            id: opened.id,
            path: scopedPath,
            basePath: scopedPath,
            url: pageURL,
            cookie: opened.cookie,
            computerID: opened.computerId
        )
    }

    func close(_ page: OpenedHTTPPage) async {
        defer { session.finishTasksAndInvalidate() }
        guard page.computerID == expectedComputerID,
              UUID(uuidString: page.id) != nil,
              page.path == "/ui/\(page.id)/",
              page.basePath == page.path,
              page.cookie.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil,
              let url = try? endpointURL(path: page.basePath + "rpc"),
              let body = try? JSONEncoder().encode(ClosePageRequest()) else {
            return
        }
        var request = makeRequest(url: url, body: body, timeout: 3)
        request.setValue("1", forHTTPHeaderField: "X-Dudu-Page")
        request.setValue("dudu_ui=\(page.cookie)", forHTTPHeaderField: "Cookie")
        do {
            let (_, response) = try await perform(request)
            guard response.statusCode == 200 else { return }
        } catch {
            // Closing is best effort; the server expires abandoned page scopes.
        }
    }

    static func cookie(for page: OpenedHTTPPage, origin: URL) -> HTTPCookie? {
        guard let host = origin.host,
              UUID(uuidString: page.id) != nil,
              page.cookie.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil,
              page.path == "/ui/\(page.id)/",
              page.url.scheme?.lowercased() == origin.scheme?.lowercased(),
              page.url.host?.lowercased() == host.lowercased(),
              page.url.port == origin.port else { return nil }
        var properties: [HTTPCookiePropertyKey: Any] = [
            .domain: host,
            .path: page.path,
            .name: "dudu_ui",
            .value: page.cookie,
            .version: "0",
            HTTPCookiePropertyKey("HttpOnly"): "TRUE"
        ]
        if origin.scheme?.lowercased() == "https" {
            properties[.secure] = "TRUE"
        }
        return HTTPCookie(properties: properties)
    }

    private func makeRequest(url: URL, body: Data, timeout: TimeInterval) -> URLRequest {
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: timeout
        )
        request.httpMethod = "POST"
        request.httpBody = body
        request.httpShouldHandleCookies = false
        request.setValue(L10n.acceptLanguage, forHTTPHeaderField: "Accept-Language")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        return request
    }

    private func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else {
                throw DuduFailure.protocolError
            }
            return (data, response)
        } catch let failure as DuduFailure {
            throw failure
        } catch let error as URLError where error.code == .timedOut {
            throw DuduFailure.timedOut
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw DuduFailure.connectionFailed
        }
    }

    private func endpointURL(path: String) throws -> URL {
        guard var components = URLComponents(url: endpoint.httpURL, resolvingAgainstBaseURL: false) else {
            throw DuduFailure.invalidLink
        }
        components.path = path
        components.query = nil
        components.fragment = nil
        guard let url = components.url,
              url.scheme == endpoint.httpURL.scheme,
              url.host == endpoint.httpURL.host,
              url.port == endpoint.httpURL.port else {
            throw DuduFailure.invalidLink
        }
        return url
    }

    private func failure(for status: Int) -> DuduFailure {
        switch status {
        case 400: return .remote("BAD_REQUEST")
        case 401: return .remote("AUTH_FAILED")
        case 409, 429: return .remote("BUSY")
        case 410: return .disconnected
        default: return .connectionFailed
        }
    }
}
