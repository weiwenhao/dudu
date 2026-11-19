import XCTest
import CryptoKit
@testable import Dudu

final class CoreHTTPClientTests: XCTestCase {
    private func routeClient() -> DuduHTTPClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeHTTPStubURLProtocol.self]
        return DuduHTTPClient(configuration: configuration)
    }

    private func multiAddressEndpoint() throws -> ConnectionEndpoint {
        var parts = URLComponents(string: "http://lan.fixture.invalid:3170/")!
        parts.queryItems = [
            .init(name: "pair", value: String(repeating: "a", count: 43)),
            .init(name: "computer", value: "fixture"), .init(name: "device", value: "phone"),
            .init(name: "lan", value: "http://lan.fixture.invalid:3170"),
            .init(name: "public", value: "https://public.fixture.invalid"),
        ]
        return try ConnectionEndpoint.parse(parts.string!)
    }

    func testVerifiedLANIsPreferredAndUnusedPublicRouteReceivesNoRequests() async throws {
        let router = NativeHTTPStubRouter.shared
        await router.reset()
        let client = routeClient()
        _ = try await client.connect(endpoint: multiAddressEndpoint(), expectedComputerId: "fixture", generation: 1,
                                     onEvent: { _ in }, onDisconnect: {})
        let resolved = await client.resolvedEndpoint()
        XCTAssertEqual(resolved?.httpURL.host, "lan.fixture.invalid")
        let requests = await router.requests
        XCTAssertFalse(requests.contains { $0.host == "public.fixture.invalid" })
        XCTAssertTrue(requests.filter { $0.path?.hasSuffix("/probe") == true }.allSatisfy { $0.authorization == nil && $0.query == nil })
        await client.disconnect()
    }

    func testMismatchedLANFallsBackToPublicWithoutSendingItTheCredential() async throws {
        let router = NativeHTTPStubRouter.shared
        await router.reset()
        await router.rejectLANProof()
        let client = routeClient()
        _ = try await client.connect(endpoint: multiAddressEndpoint(), expectedComputerId: "fixture", generation: 1,
                                     onEvent: { _ in }, onDisconnect: {})
        let resolved = await client.resolvedEndpoint()
        XCTAssertEqual(resolved?.httpURL.host, "public.fixture.invalid")
        let requests = await router.requests
        XCTAssertTrue(requests.filter { $0.host == "lan.fixture.invalid" }.allSatisfy { $0.authorization == nil })
        XCTAssertTrue(requests.contains { $0.host == "public.fixture.invalid" && $0.path?.hasSuffix("/connect") == true })
        await client.disconnect()
    }

    func testBothMismatchedRoutesFailWithoutAnyCredentialDisclosure() async throws {
        let router = NativeHTTPStubRouter.shared
        await router.reset()
        await router.rejectAllProofs()
        let client = routeClient()
        do {
            _ = try await client.connect(endpoint: multiAddressEndpoint(), expectedComputerId: "fixture", generation: 1,
                                         onEvent: { _ in }, onDisconnect: {})
            XCTFail("An unrelated server cannot receive a credential")
        } catch {
            XCTAssertEqual(error as? DuduFailure, .identityMismatch)
        }
        let requests = await router.requests
        XCTAssertTrue(requests.allSatisfy { $0.authorization == nil })
        XCTAssertFalse(requests.contains { $0.path?.hasSuffix("/connect") == true })
    }

    func testReadyUpgradesSingleAddressPairingAndUserEditsSurviveServerMetadata() async throws {
        let router = NativeHTTPStubRouter.shared
        await router.reset()
        let client = routeClient()
        let legacy = try ConnectionEndpoint.parse("https://public.fixture.invalid/?pair=\(String(repeating: "a", count: 43))&computer=fixture")
        _ = try await client.connect(endpoint: legacy, expectedComputerId: "fixture", generation: 1,
                                     onEvent: { _ in }, onDisconnect: {})
        let resolved = await client.resolvedEndpoint()
        var upgraded = try XCTUnwrap(resolved)
        XCTAssertEqual(upgraded.probeId, "phone")
        XCTAssertEqual(upgraded.addresses.count, 2)
        XCTAssertEqual(upgraded.httpURL.host, "lan.fixture.invalid")
        upgraded.addresses = upgraded.addresses.filter { $0.kind == .internet }
        upgraded.addressesEdited = true
        _ = try await client.connect(endpoint: upgraded, expectedComputerId: "fixture", generation: 2,
                                     onEvent: { _ in }, onDisconnect: {})
        let edited = await client.resolvedEndpoint()
        XCTAssertEqual(edited?.addresses.count, 1)
        XCTAssertEqual(edited?.addresses.first?.kind, .internet)
        await client.disconnect()
    }

    func testUnavailableRoutesDescribeOnlyConfiguredAddressKinds() async throws {
        let router = NativeHTTPStubRouter.shared
        let scenarios: [Set<ConnectionAddressKind>] = [[.lan], [.lan, .internet], [.internet]]
        for kinds in scenarios {
            await router.reset()
            await router.rejectAllConnections()
            let client = routeClient()
            var endpoint = try multiAddressEndpoint()
            endpoint.addresses = endpoint.addresses.filter { kinds.contains($0.kind) }
            do {
                _ = try await client.connect(
                    endpoint: endpoint, expectedComputerId: "fixture", generation: 1,
                    onEvent: { _ in }, onDisconnect: {}
                )
                XCTFail("Unreachable addresses cannot establish a connection")
            } catch {
                let expected: DuduFailure = kinds.contains(.lan)
                    ? .routesUnavailable(onlyLAN: !kinds.contains(.internet)) : .connectionFailed
                XCTAssertEqual(error as? DuduFailure, expected)
            }
            let requests = await router.requests
            XCTAssertTrue(requests.allSatisfy { $0.authorization == nil })
        }
    }

    func testCancellingAHistoryRequestKeepsTheConnectionUsable() async throws {
        let router = NativeHTTPStubRouter.shared
        await router.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeHTTPStubURLProtocol.self]
        let client = DuduHTTPClient(configuration: configuration)
        let endpoint = try ConnectionEndpoint.parse(
            "http://127.0.0.1:3170/?pair=\(String(repeating: "a", count: 43))&computer=fixture"
        )
        let disconnected = expectation(description: "Cancellation must not disconnect")
        disconnected.isInverted = true
        _ = try await client.connect(
            endpoint: endpoint, expectedComputerId: "fixture", generation: 1,
            onEvent: { _ in }, onDisconnect: { disconnected.fulfill() }
        )
        let request = Task { try await client.request("session.changes", params: [:], timeoutSeconds: 30) }
        await router.waitForChangesRequest()
        request.cancel()
        do {
            _ = try await request.value
            XCTFail("The cancelled history request must throw CancellationError")
        } catch is CancellationError {
        }
        let next = try await client.request("session.list", params: [:], timeoutSeconds: 3)
        XCTAssertEqual(next["count"]?.numberValue, 1)
        await fulfillment(of: [disconnected], timeout: 0.1)
        await client.disconnect(throughGeneration: 1)
    }

    func testReadTransportTimeoutInvalidatesTheRouteAndAllowsReconnect() async throws {
        try await assertTransportTimeout("session.list", expectedFailure: .timedOut)
    }

    func testSendTransportTimeoutKeepsTheResultUnknownAndDoesNotResend() async throws {
        try await assertTransportTimeout("session.send", expectedFailure: .resultUnknown)
    }

    private func assertTransportTimeout(_ method: String, expectedFailure: DuduFailure) async throws {
        let router = NativeHTTPStubRouter.shared
        await router.reset()
        let client = routeClient()
        let endpoint = try multiAddressEndpoint()
        let disconnected = expectation(description: "A transport timeout invalidates the stalled route")
        _ = try await client.connect(
            endpoint: endpoint, expectedComputerId: "fixture", generation: 1,
            onEvent: { _ in }, onDisconnect: { disconnected.fulfill() }
        )
        await router.failNextRequest(method, with: .transportTimeout)

        do {
            _ = try await client.request(method, params: [:], timeoutSeconds: 30)
            XCTFail("A stalled request must report its timeout")
        } catch {
            XCTAssertEqual(error as? DuduFailure, expectedFailure)
        }

        await fulfillment(of: [disconnected], timeout: 1)
        let resolved = await client.resolvedEndpoint()
        XCTAssertNil(resolved)
        let requests = await router.requests
        XCTAssertEqual(requests.filter { $0.path == "/api/v1/request" }.count, 1)

        _ = try await client.connect(
            endpoint: endpoint, expectedComputerId: "fixture", generation: 2,
            onEvent: { _ in }, onDisconnect: {}
        )
        let next = try await client.request("session.list", params: [:], timeoutSeconds: 3)
        XCTAssertEqual(next["count"]?.numberValue, 1)
        await client.disconnect()
    }

    func testServerRPCTimeoutKeepsTheConnectionUsable() async throws {
        let router = NativeHTTPStubRouter.shared
        await router.reset()
        let client = routeClient()
        let disconnected = expectation(description: "A server's operation timeout keeps its route")
        disconnected.isInverted = true
        _ = try await client.connect(
            endpoint: multiAddressEndpoint(), expectedComputerId: "fixture", generation: 1,
            onEvent: { _ in }, onDisconnect: { disconnected.fulfill() }
        )
        await router.failNextRequest("session.list", with: .rpcTimeout)
        do {
            _ = try await client.request("session.list", params: [:], timeoutSeconds: 30)
            XCTFail("The server's timeout must reach the caller")
        } catch {
            XCTAssertEqual(error as? DuduFailure, .remote("TIMEOUT"))
        }
        let next = try await client.request("session.list", params: [:], timeoutSeconds: 3)
        XCTAssertEqual(next["count"]?.numberValue, 1)
        await fulfillment(of: [disconnected], timeout: 0.1)
        await client.disconnect()
    }

    func testAuthenticatedHTTPRPCAndLongPollEventsUseOnlyHTTPRequests() async throws {
        let router = NativeHTTPStubRouter.shared
        await router.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NativeHTTPStubURLProtocol.self]
        let client = DuduHTTPClient(configuration: configuration)
        let token = String(repeating: "a", count: 43)
        let endpoint = try ConnectionEndpoint.parse(
            "http://127.0.0.1:3170/?pair=\(token)&computer=fixture"
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
        XCTAssertTrue(requests.contains { $0.path == "/api/v1/connect" })
        XCTAssertTrue(requests.contains { $0.path == "/api/v1/request" })
        XCTAssertTrue(requests.contains { $0.path == "/api/v1/events" })
        XCTAssertTrue(requests.contains { $0.path == "/api/v1/disconnect" })
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
            if status == -1004 || status == -1001 {
                guard !Task.isCancelled, let self else { return }
                let code: URLError.Code = status == -1001 ? .timedOut : .cannotConnectToHost
                self.client?.urlProtocol(self, didFailWithError: URLError(code))
                return
            }
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
    enum RequestFailure {
        case transportTimeout, rpcTimeout
    }

    struct RecordedRequest: Sendable {
        let path: String?
        let method: String?
        let authorization: String?
        let query: String?
        let host: String?
    }

    static let shared = NativeHTTPStubRouter()
    private(set) var requests: [RecordedRequest] = []
    private var eventPollCount = 0
    private var changesStarted = false
    private var changesWaiter: CheckedContinuation<Void, Never>?
    private var badLANProof = false
    private var badAllProofs = false
    private var connectionsUnavailable = false
    private var requestFailures: [String: RequestFailure] = [:]

    func reset() {
        requests = []
        eventPollCount = 0
        changesStarted = false
        changesWaiter = nil
        badLANProof = false
        badAllProofs = false
        connectionsUnavailable = false
        requestFailures = [:]
    }

    func rejectLANProof() { badLANProof = true }
    func rejectAllProofs() { badAllProofs = true }
    func rejectAllConnections() { connectionsUnavailable = true }
    func failNextRequest(_ method: String, with failure: RequestFailure) { requestFailures[method] = failure }

    func waitForChangesRequest() async {
        if changesStarted { return }
        await withCheckedContinuation { changesWaiter = $0 }
    }

    func response(for request: URLRequest) async -> (Int, Data) {
        requests.append(RecordedRequest(
            path: request.url?.path,
            method: request.httpMethod,
            authorization: request.value(forHTTPHeaderField: "Authorization"),
            query: request.url?.query,
            host: request.url?.host
        ))
        if connectionsUnavailable { return (-1004, Data()) }

        switch request.url?.path {
        case "/api/v1/probe":
            guard let body = requestBody(request),
                  let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let nonce = object["nonce"] as? String,
                  let device = object["deviceId"] as? String else { return (400, Data()) }
            let key = SymmetricKey(data: Data(SHA256.hash(data: Data(String(repeating: "a", count: 43).utf8))))
            let wrong = badAllProofs || (badLANProof && request.url?.host == "lan.fixture.invalid")
            let message = Data("dudu-route:v1:\(nonce):fixture:\(device)".utf8)
            let proof = wrong ? Data(repeating: 0, count: 32) : Data(HMAC<SHA256>.authenticationCode(for: message, using: key))
            let value: [String: Any] = [
                "protocol": 1, "computerId": "fixture", "deviceId": device,
                "deviceProof": proof.base64EncodedString().replacingOccurrences(of: "+", with: "-")
                    .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: ""),
            ]
            return (200, try! JSONSerialization.data(withJSONObject: value))
        case "/api/v1/connect" where request.url?.host?.hasSuffix("fixture.invalid") == true:
            return (200, Data(#"{"type":"ready","protocol":1,"deviceId":"phone","computer":{"id":"fixture","name":"Desk","addresses":[{"kind":"lan","url":"http://lan.fixture.invalid:3170"},{"kind":"public","url":"https://public.fixture.invalid"}]}}"#.utf8))
        case "/api/v1/connect":
            return (200, Data(#"{"type":"ready","protocol":1,"computer":{"id":"fixture","name":"Desk"}}"#.utf8))
        case "/api/v1/request":
            guard let body = requestBody(request),
                  let object = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
                  let id = object["id"] as? String else {
                return (400, Data(#"{"error":{"code":"BAD_REQUEST"}}"#.utf8))
            }
            if let method = object["method"] as? String,
               let failure = requestFailures.removeValue(forKey: method) {
                switch failure {
                case .transportTimeout:
                    return (-1001, Data())
                case .rpcTimeout:
                    return (200, try! JSONSerialization.data(withJSONObject: [
                        "id": id, "ok": false, "error": ["code": "TIMEOUT"],
                    ]))
                }
            }
            if object["method"] as? String == "session.changes" {
                changesStarted = true
                changesWaiter?.resume()
                changesWaiter = nil
                try? await Task.sleep(for: .seconds(30))
            }
            let encoded = try? JSONSerialization.data(withJSONObject: [
                "id": id, "ok": true, "result": ["count": 1],
            ])
            return (200, encoded ?? Data("{}".utf8))
        case "/api/v1/events":
            eventPollCount += 1
            if eventPollCount == 1 {
                return (200, Data(#"{"cursor":1,"events":[{"id":1,"topic":"session.snapshot","params":{"session":{"id":"s1"}}}]}"#.utf8))
            }
            try? await Task.sleep(for: .seconds(30))
            return (200, Data(#"{"cursor":1,"events":[]}"#.utf8))
        case "/api/v1/disconnect":
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
