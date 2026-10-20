import XCTest
@testable import dsbot

final class CoreHTTPClientTests: XCTestCase {
    func testAuthenticatedHTTPRPCAndLongPollEventsUseOnlyHTTPRequests() async throws {
        let router = NativeHTTPStubRouter.shared
        await router.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeHTTPStubURLProtocol.self]
        let client = DSBotHTTPClient(configuration: configuration)
        let token = String(repeating: "a", count: 43)
        let endpoint = try ConnectionEndpoint.parse(
            "http://127.0.0.1:3170/dsbot?pair=\(token)&computer=fixture"
        )
        let event = expectation(description: "HTTP long poll delivers native events")

        let ready = try await client.connect(
            endpoint: endpoint,
            expectedComputerId: "fixture",
            generation: 1,
            onEvent: { value in
                if value["topic"]?.stringValue == "session.snapshot" { event.fulfill() }
            },
            onDisconnect: {}
        )
        XCTAssertEqual(ready.id, "fixture")
        XCTAssertEqual(ready.name, "Desk")

        let result = try await client.request("session.list", params: [:], timeoutSeconds: 3)
        XCTAssertEqual(result["count"]?.numberValue, 1)
        await fulfillment(of: [event], timeout: 3)
        await client.disconnect(throughGeneration: 1)

        let requests = await router.requests
        XCTAssertTrue(requests.contains { $0.path == "/dsbot/api/v1/connect" })
        XCTAssertTrue(requests.contains { $0.path == "/dsbot/api/v1/request" })
        XCTAssertTrue(requests.contains { $0.path == "/dsbot/api/v1/events" })
        XCTAssertTrue(requests.contains { $0.path == "/dsbot/api/v1/disconnect" })
        XCTAssertTrue(requests.allSatisfy { $0.method == "POST" })
        XCTAssertTrue(requests.allSatisfy { $0.authorization == "Bearer \(token)" })
        XCTAssertTrue(requests.allSatisfy { $0.query == nil })
    }
}

private final class NativeHTTPStubURLProtocol: URLProtocol, @unchecked Sendable {
    private var responseTask: Task<Void, Never>?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let request = self.request
        responseTask = Task { [weak self] in
            let (status, body) = await NativeHTTPStubRouter.shared.response(for: request)
            guard !Task.isCancelled, let self,
                  let url = request.url,
                  let response = HTTPURLResponse(
                    url: url,
                    statusCode: status,
                    httpVersion: "HTTP/1.1",
                    headerFields: ["Content-Type": "application/json"]
                  ) else { return }
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: body)
            self.client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {
        responseTask?.cancel()
    }
}

private actor NativeHTTPStubRouter {
    struct RecordedRequest: Sendable {
        let path: String?
        let method: String?
        let authorization: String?
        let query: String?
    }

    static let shared = NativeHTTPStubRouter()
    private(set) var requests: [RecordedRequest] = []
    private var eventPollCount = 0

    func reset() {
        requests = []
        eventPollCount = 0
    }

    func response(for request: URLRequest) async -> (Int, Data) {
        requests.append(RecordedRequest(
            path: request.url?.path,
            method: request.httpMethod,
            authorization: request.value(forHTTPHeaderField: "Authorization"),
            query: request.url?.query
        ))

        switch request.url?.path {
        case "/dsbot/api/v1/connect":
            return (200, Data(#"{"type":"ready","protocol":1,"computer":{"id":"fixture","name":"Desk"}}"#.utf8))
        case "/dsbot/api/v1/request":
            guard let body = requestBody(request),
                  let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let id = object["id"] as? String else {
                return (400, Data(#"{"error":{"code":"BAD_REQUEST"}}"#.utf8))
            }
            let encoded = try? JSONSerialization.data(withJSONObject: [
                "id": id, "ok": true, "result": ["count": 1],
            ])
            return (200, encoded ?? Data("{}".utf8))
        case "/dsbot/api/v1/events":
            eventPollCount += 1
            if eventPollCount == 1 {
                return (200, Data(#"{"cursor":1,"events":[{"id":1,"topic":"session.snapshot","params":{"session":{"id":"s1"}}}]}"#.utf8))
            }
            try? await Task.sleep(for: .seconds(30))
            return (200, Data(#"{"cursor":1,"events":[]}"#.utf8))
        case "/dsbot/api/v1/disconnect":
            return (200, Data(#"{"ok":true,"result":{}}"#.utf8))
        default:
            return (404, Data(#"{"error":{"code":"NOT_FOUND"}}"#.utf8))
        }
    }

    private func requestBody(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data.isEmpty ? nil : data
    }
}
