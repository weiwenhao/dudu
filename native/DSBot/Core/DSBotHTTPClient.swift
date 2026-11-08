import Foundation
import CryptoKit

protocol DSBotTransport: Sendable {
    func connect(
        endpoint: ConnectionEndpoint,
        expectedComputerId: String?,
        generation: Int,
        onEvent: @escaping @Sendable (JSONValue) async -> Void,
        onDisconnect: @escaping @Sendable () async -> Void
    ) async throws -> (id: String, name: String)
    func request(_ method: String, params: [String: JSONValue], timeoutSeconds: UInt64) async throws -> JSONValue
    func disconnect() async
    func disconnect(throughGeneration: Int) async
    func resolvedEndpoint() async -> ConnectionEndpoint?
    func verifyEndpoint(_ endpoint: ConnectionEndpoint) async throws -> ConnectionEndpoint
}

extension DSBotTransport {
    func resolvedEndpoint() async -> ConnectionEndpoint? { nil }
    func verifyEndpoint(_ endpoint: ConnectionEndpoint) async throws -> ConnectionEndpoint {
        throw DSBotFailure.remote("AUTH_REQUIRED")
    }
}

private struct HTTPReadyResponse: Decodable, Sendable {
    struct Computer: Decodable, Sendable {
        let id: String
        let name: String
        let addresses: [ConnectionAddress]?
    }

    let type: String
    let protocolVersion: Int
    let computer: Computer
    let deviceId: String?

    enum CodingKeys: String, CodingKey {
        case type, computer, deviceId
        case protocolVersion = "protocol"
    }
}

private struct HTTPRouteProbe: Codable {
    let nonce: String
    let deviceId: String
}

private struct HTTPRouteIdentity: Decodable {
    let protocolVersion: Int
    let computerId: String
    let deviceId: String
    let deviceProof: String

    enum CodingKeys: String, CodingKey {
        case computerId, deviceId, deviceProof
        case protocolVersion = "protocol"
    }
}

private struct HTTPRequest: Encodable {
    let id: String
    let method: String
    let params: [String: JSONValue]
}

private struct HTTPRPCError: Decodable {
    let code: String
}

private struct HTTPRPCResponse: Decodable {
    let id: String
    let ok: Bool
    let result: JSONValue?
    let error: HTTPRPCError?
}

private struct HTTPErrorResponse: Decodable {
    let error: HTTPRPCError?
}

private struct HTTPEvent: Decodable {
    let id: Int
    let topic: String
    let params: JSONValue
}

private struct HTTPEventBatch: Decodable {
    let cursor: Int
    let events: [HTTPEvent]
}

private struct HTTPEventsRequest: Encodable {
    let cursor: Int
    let waitMs: Int
}

private final class NativeHTTPNoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
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

actor DSBotHTTPClient: DSBotTransport {
    private struct ActiveConnection {
        let endpoint: ConnectionEndpoint
        let generation: Int
        let onEvent: @Sendable (JSONValue) async -> Void
        let onDisconnect: @Sendable () async -> Void
        var eventsTask: Task<Void, Never>?
    }

    private let session: URLSession
    private let redirectDelegate: NativeHTTPNoRedirectDelegate
    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private var active: ActiveConnection?
    private var latestGeneration = 0
    private var connectGateHeld = false
    private var connectWaiters: [CheckedContinuation<Void, Never>] = []

    init(configuration suppliedConfiguration: URLSessionConfiguration = .ephemeral) {
        let configuration = (suppliedConfiguration.copy() as? URLSessionConfiguration)
            ?? suppliedConfiguration
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 35
        redirectDelegate = NativeHTTPNoRedirectDelegate()
        session = URLSession(configuration: configuration, delegate: redirectDelegate, delegateQueue: nil)
    }

    func connect(
        endpoint: ConnectionEndpoint,
        expectedComputerId: String?,
        generation: Int,
        onEvent: @escaping @Sendable (JSONValue) async -> Void,
        onDisconnect: @escaping @Sendable () async -> Void
    ) async throws -> (id: String, name: String) {
        guard generation >= latestGeneration else { throw DSBotFailure.switchedComputer }
        latestGeneration = generation
        await acquireConnectGate()
        defer { releaseConnectGate() }
        guard generation == latestGeneration else { throw DSBotFailure.switchedComputer }

        if let previous = active {
            active = nil
            previous.eventsTask?.cancel()
            _ = try? await perform(endpoint: previous.endpoint, route: "disconnect", body: Data("{}".utf8), timeout: 5)
        }
        guard generation == latestGeneration else { throw DSBotFailure.switchedComputer }

        DSBotLog.record("http.connect.begin", state: "connecting")
        DSBotLog.record(
            "http.routes",
            counts: [
                "lanAddressCount": endpoint.addresses.filter { $0.kind == .lan }.count,
                "publicAddressCount": endpoint.addresses.filter { $0.kind == .internet }.count
            ],
            state: endpoint.probeId == nil ? "legacy" : "verified"
        )
        let startedAt = Date()
        let selected: (ConnectionEndpoint, HTTPReadyResponse)
        do {
            selected = try await establish(endpoint, expectedComputerId: expectedComputerId, generation: generation)
        } catch {
            DSBotLog.networkFailure("http.connect.fail", error: error, elapsedMs: elapsed(since: startedAt))
            throw error
        }
        let (selectedEndpoint, ready) = selected
        guard generation == latestGeneration else {
            _ = try? await perform(endpoint: selectedEndpoint, route: "disconnect", body: Data("{}".utf8), timeout: 2)
            throw DSBotFailure.switchedComputer
        }

        active = ActiveConnection(
            endpoint: selectedEndpoint,
            generation: generation,
            onEvent: onEvent,
            onDisconnect: onDisconnect
        )
        let eventsTask = Task { [weak self] in
            guard let self else { return }
            await self.pollEvents(generation: generation)
        }
        active?.eventsTask = eventsTask
        if let origin = try? ConnectionAddress.normalized(selectedEndpoint.httpURL.absoluteString),
           let route = selectedEndpoint.addresses.first(where: { $0.url == origin.url }) {
            DSBotLog.record("http.route.selected", state: route.kind.rawValue)
        }
        DSBotLog.record("http.connect.ready", elapsedMs: elapsed(since: startedAt), state: "connected")
        return (ready.computer.id, ready.computer.name)
    }

    func resolvedEndpoint() async -> ConnectionEndpoint? { active?.endpoint }

    /// Used by the address editor too. It verifies identity without changing the active connection.
    func verifyEndpoint(_ endpoint: ConnectionEndpoint) async throws -> ConnectionEndpoint {
        guard endpoint.probeId != nil, endpoint.computerId != nil else {
            throw DSBotFailure.remote("AUTH_REQUIRED")
        }
        var failure = DSBotFailure.connectionFailed
        for kind in [ConnectionAddressKind.lan, .internet] {
            let routes = endpoint.addresses.filter { $0.kind == kind }
            guard !routes.isEmpty else { continue }
            do { return try endpoint.selecting(await firstVerified(routes, endpoint: endpoint)) }
            catch is CancellationError { throw CancellationError() }
            catch { failure = preferredFailure(failure, error) }
        }
        throw routeFailure(failure, endpoint: endpoint)
    }

    private func establish(
        _ endpoint: ConnectionEndpoint,
        expectedComputerId: String?,
        generation: Int
    ) async throws -> (ConnectionEndpoint, HTTPReadyResponse) {
        // Old pairings may authenticate only at their already saved origin. The ready response
        // upgrades them with a probe ID and routes before a different origin may receive a credential.
        if endpoint.probeId == nil {
            let upgraded = try await connectCandidate(
                endpoint, expectedComputerId: expectedComputerId, generation: generation
            )
            let current = try ConnectionAddress.normalized(endpoint.httpURL.absoluteString)
            guard upgraded.0.probeId != nil, current.kind != .lan,
                  upgraded.0.addresses.contains(where: { $0.kind == .lan }) else { return upgraded }
            return try await establish(upgraded.0, expectedComputerId: expectedComputerId, generation: generation)
        }
        guard endpoint.computerId != nil else { throw DSBotFailure.invalidLink }
        var failure = DSBotFailure.connectionFailed
        for kind in [ConnectionAddressKind.lan, .internet] {
            var remaining = endpoint.addresses.filter { $0.kind == kind }
            while !remaining.isEmpty {
                try Task.checkCancellation()
                guard generation == latestGeneration else { throw DSBotFailure.switchedComputer }
                let route: ConnectionAddress
                do { route = try await firstVerified(remaining, endpoint: endpoint) }
                catch is CancellationError { throw CancellationError() }
                catch { failure = preferredFailure(failure, error); break }
                remaining.removeAll { $0.url == route.url }
                do {
                    return try await connectCandidate(
                        endpoint.selecting(route), expectedComputerId: expectedComputerId, generation: generation
                    )
                } catch is CancellationError { throw CancellationError() }
                catch let error as DSBotFailure where !error.shouldRetryConnection { throw error }
                catch { failure = preferredFailure(failure, error) }
            }
        }
        throw routeFailure(failure, endpoint: endpoint)
    }

    private func connectCandidate(
        _ endpoint: ConnectionEndpoint,
        expectedComputerId: String?,
        generation: Int
    ) async throws -> (ConnectionEndpoint, HTTPReadyResponse) {
        try Task.checkCancellation()
        guard generation == latestGeneration else { throw DSBotFailure.switchedComputer }
        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await perform(endpoint: endpoint, route: "connect", body: nil, timeout: 12)
        } catch {
            if generation == latestGeneration {
                // Finish cleanup before trying another route of this same device.
                _ = try? await perform(endpoint: endpoint, route: "disconnect", body: Data("{}".utf8), timeout: 2)
            }
            throw error
        }
        guard response.statusCode == 200 else { throw remoteFailure(data: data, status: response.statusCode) }
        guard data.count <= 128 * 1024,
              let ready = try? decoder.decode(HTTPReadyResponse.self, from: data),
              ready.type == "ready", ready.protocolVersion == 1,
              ConnectionEndpoint.validIdentity(ready.computer.id), !ready.computer.name.isEmpty else {
            throw DSBotFailure.protocolError
        }
        if let expectedComputerId, expectedComputerId != ready.computer.id {
            _ = try? await perform(endpoint: endpoint, route: "disconnect", body: Data("{}".utf8), timeout: 2)
            throw DSBotFailure.identityMismatch
        }
        if let expectedDevice = endpoint.probeId, ready.deviceId != expectedDevice {
            throw DSBotFailure.identityMismatch
        }
        var resolved = endpoint
        resolved.computerId = ready.computer.id
        if let id = ready.deviceId {
            guard ConnectionEndpoint.validIdentity(id) else { throw DSBotFailure.protocolError }
            resolved.probeId = id
        }
        if !endpoint.addressesEdited, let routes = ready.computer.addresses {
            var known = try ConnectionAddress.validated(routes)
            let current = try ConnectionAddress.normalized(endpoint.httpURL.absoluteString)
            if !known.contains(where: { $0.url == current.url }) { known.append(current) }
            resolved.addresses = try ConnectionAddress.validated(known)
        }
        return (resolved, ready)
    }

    private func firstVerified(
        _ routes: [ConnectionAddress], endpoint: ConnectionEndpoint
    ) async throws -> ConnectionAddress {
        try Task.checkCancellation()
        return try await withThrowingTaskGroup(of: Result<ConnectionAddress, DSBotFailure>.self) { group in
            for route in routes {
                group.addTask { [self] in
                    do {
                        try await probe(route, endpoint: endpoint)
                        return .success(route)
                    } catch {
                        return .failure((error as? DSBotFailure) ?? .connectionFailed)
                    }
                }
            }
            var failure = DSBotFailure.connectionFailed
            while let result = try await group.next() {
                try Task.checkCancellation()
                switch result {
                case let .success(route):
                    group.cancelAll()
                    return route
                case let .failure(error):
                    failure = preferredFailure(failure, error)
                }
            }
            throw failure
        }
    }

    private func probe(_ route: ConnectionAddress, endpoint: ConnectionEndpoint) async throws {
        guard let deviceId = endpoint.probeId, let computerId = endpoint.computerId,
              var parts = URLComponents(string: route.url) else { throw DSBotFailure.invalidLink }
        parts.path = "/dsbot/api/v1/probe"
        guard let url = parts.url else { throw DSBotFailure.invalidLink }
        let nonce = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: route.kind == .lan ? 2 : 5)
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(HTTPRouteProbe(nonce: nonce, deviceId: deviceId))
        // This request intentionally has no Authorization header, pairing token or URL query.
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            if !Task.isCancelled {
                DSBotLog.networkFailure("http.probe.\(route.kind.rawValue).fail", error: error)
            }
            throw error
        }
        try Task.checkCancellation()
        guard let response = response as? HTTPURLResponse else { throw DSBotFailure.protocolError }
        if response.statusCode == 401 { throw DSBotFailure.remote("AUTH_FAILED") }
        guard response.statusCode == 200, data.count <= 4096,
              let identity = try? JSONDecoder().decode(HTTPRouteIdentity.self, from: data),
              identity.protocolVersion == 1 else { throw DSBotFailure.protocolError }
        guard identity.computerId == computerId, identity.deviceId == deviceId,
              identity.deviceProof.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil,
              let proof = Data(base64Encoded: identity.deviceProof.replacingOccurrences(of: "-", with: "+")
                .replacingOccurrences(of: "_", with: "/") + "=") else { throw DSBotFailure.identityMismatch }
        let key = SymmetricKey(data: Data(SHA256.hash(data: Data(endpoint.token.utf8))))
        let message = Data("dsbot-route:v1:\(nonce):\(computerId):\(deviceId)".utf8)
        guard HMAC<SHA256>.isValidAuthenticationCode(proof, authenticating: message, using: key) else {
            throw DSBotFailure.identityMismatch
        }
    }

    private func preferredFailure(_ previous: DSBotFailure, _ error: Error) -> DSBotFailure {
        let next = (error as? DSBotFailure) ?? .connectionFailed
        if !next.shouldRetryConnection { return next }
        return previous.shouldRetryConnection ? next : previous
    }

    private func routeFailure(_ failure: DSBotFailure, endpoint: ConnectionEndpoint) -> DSBotFailure {
        if failure == .connectionFailed || failure == .timedOut {
            guard endpoint.addresses.contains(where: { $0.kind == .lan }) else { return failure }
            return .routesUnavailable(onlyLAN: !endpoint.addresses.contains(where: { $0.kind == .internet }))
        }
        return failure
    }

    func request(_ method: String, params: [String: JSONValue], timeoutSeconds: UInt64) async throws -> JSONValue {
        try Task.checkCancellation()
        guard let connection = active, connection.generation == latestGeneration else {
            throw DSBotFailure.disconnected
        }
        let requestID = UUID().uuidString.lowercased()
        let body = try encoder.encode(HTTPRequest(id: requestID, method: method, params: params))
        let startedAt = Date()
        var receivedResponse = false
        do {
            let (data, response) = try await perform(
                endpoint: connection.endpoint,
                route: "request",
                body: body,
                timeout: TimeInterval(max(1, min(timeoutSeconds, 300)))
            )
            receivedResponse = true
            guard response.statusCode == 200 else {
                let failure = remoteFailure(data: data, status: response.statusCode)
                if isTerminalConnectionFailure(failure) {
                    await failConnection(generation: connection.generation)
                }
                throw failure
            }
            guard let envelope = try? decoder.decode(HTTPRPCResponse.self, from: data),
                  envelope.id == requestID else {
                throw DSBotFailure.protocolError
            }
            guard envelope.ok else {
                throw DSBotFailure.remoteCode(envelope.error?.code)
            }
            guard let result = envelope.result else { throw DSBotFailure.protocolError }
            guard active?.generation == connection.generation,
                  latestGeneration == connection.generation else {
                throw DSBotFailure.switchedComputer
            }
            DSBotLog.record(
                "http.request.complete", method: method, requestId: requestID,
                elapsedMs: elapsed(since: startedAt)
            )
            return result
        } catch is CancellationError {
            // A disappearing history row cancels its own file/image request, not the connection.
            throw CancellationError()
        } catch {
            try Task.checkCancellation()
            let failure = normalizedFailure(error, method: method)
            DSBotLog.networkFailure(
                "http.request.fail", error: failure, method: method, requestId: requestID,
                elapsedMs: elapsed(since: startedAt)
            )
            // A stalled cellular route need not change NWPath. Retry the connection
            // after a transport timeout, while keeping a server's RPC timeout local.
            let routeTimedOut = !receivedResponse && (failure == .timedOut || failure == .resultUnknown)
            if isTerminalConnectionFailure(failure) || routeTimedOut {
                await failConnection(generation: connection.generation)
            }
            throw failure
        }
    }

    func disconnect() async {
        let nextGeneration = latestGeneration == Int.max ? Int.max : latestGeneration + 1
        await disconnect(throughGeneration: nextGeneration)
    }

    func disconnect(throughGeneration generation: Int) async {
        latestGeneration = max(latestGeneration, generation)
        guard let connection = active, connection.generation <= generation else { return }
        active = nil
        connection.eventsTask?.cancel()
        _ = try? await perform(
            endpoint: connection.endpoint, route: "disconnect", body: Data("{}".utf8), timeout: 5
        )
        DSBotLog.record("http.disconnect", state: "disconnected")
    }

    private func acquireConnectGate() async {
        if !connectGateHeld {
            connectGateHeld = true
            return
        }
        await withCheckedContinuation { connectWaiters.append($0) }
    }

    private func releaseConnectGate() {
        if connectWaiters.isEmpty {
            connectGateHeld = false
        } else {
            connectWaiters.removeFirst().resume()
        }
    }

    private func pollEvents(generation: Int) async {
        var cursor = 0
        var failures = 0
        while !Task.isCancelled, active?.generation == generation, latestGeneration == generation {
            guard let connection = active else { return }
            do {
                let body = try encoder.encode(HTTPEventsRequest(cursor: cursor, waitMs: 25_000))
                let (data, response) = try await perform(
                    endpoint: connection.endpoint, route: "events", body: body, timeout: 35
                )
                guard response.statusCode == 200 else {
                    let failure = remoteFailure(data: data, status: response.statusCode)
                    if isTerminalConnectionFailure(failure) {
                        await failConnection(generation: generation)
                        return
                    }
                    throw failure
                }
                guard let batch = try? decoder.decode(HTTPEventBatch.self, from: data),
                      batch.cursor >= cursor,
                      batch.events.allSatisfy({ $0.id > cursor && $0.id <= batch.cursor }) else {
                    await failConnection(generation: generation)
                    return
                }
                cursor = batch.cursor
                failures = 0
                for item in batch.events {
                    guard active?.generation == generation, latestGeneration == generation,
                          !Task.isCancelled else { return }
                    await connection.onEvent(.object([
                        "type": .string("event"),
                        "topic": .string(item.topic),
                        "params": item.params
                    ]))
                }
            } catch is CancellationError {
                return
            } catch {
                if Task.isCancelled { return }
                failures += 1
                let failure = normalizedFailure(error, method: "session.watch")
                DSBotLog.networkFailure("http.events.fail", error: failure)
                if isTerminalConnectionFailure(failure) || failures >= 3 {
                    await failConnection(generation: generation)
                    return
                }
                try? await Task.sleep(for: .seconds(min(1 << failures, 4)))
            }
        }
    }

    private func failConnection(generation: Int) async {
        guard let connection = active, connection.generation == generation else { return }
        active = nil
        connection.eventsTask?.cancel()
        await connection.onDisconnect()
    }

    private func perform(
        endpoint: ConnectionEndpoint,
        route: String,
        body: Data?,
        timeout: TimeInterval
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = endpointURL(endpoint, route: route) else { throw DSBotFailure.invalidLink }
        var request = URLRequest(
            url: url,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: timeout
        )
        request.httpMethod = "POST"
        request.httpShouldHandleCookies = false
        request.setValue("Bearer \(endpoint.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw DSBotFailure.protocolError }
            return (data, response)
        } catch let failure as DSBotFailure {
            throw failure
        } catch is CancellationError {
            throw CancellationError()
        } catch let error as URLError where error.code == .cancelled && Task.isCancelled {
            throw CancellationError()
        } catch {
            DSBotLog.networkFailure("http.\(route).transport.fail", error: error)
            throw (error as? URLError)?.code == .timedOut ? DSBotFailure.timedOut : .connectionFailed
        }
    }

    private func endpointURL(_ endpoint: ConnectionEndpoint, route: String) -> URL? {
        guard ["connect", "disconnect", "events", "request"].contains(route),
              var components = URLComponents(url: endpoint.httpURL, resolvingAgainstBaseURL: false),
              components.query == nil, components.fragment == nil,
              components.user == nil, components.password == nil,
              components.scheme == "http" || components.scheme == "https" else { return nil }
        components.path = "/dsbot/api/v1/\(route)"
        return components.url
    }

    private func remoteFailure(data: Data, status: Int) -> DSBotFailure {
        if let response = try? decoder.decode(HTTPErrorResponse.self, from: data),
           let code = response.error?.code {
            return .remoteCode(code)
        }
        switch status {
        case 401: return .remote("AUTH_FAILED")
        case 409: return .disconnected
        case 429: return .remote("TOO_MANY_REQUESTS")
        default: return .connectionFailed
        }
    }

    private func normalizedFailure(_ error: Error, method: String) -> DSBotFailure {
        if let failure = error as? DSBotFailure {
            if failure == .timedOut && ["session.send", "assistant.forward", "session.create", "approval.respond"].contains(method) {
                return .resultUnknown
            }
            return failure
        }
        if error is CancellationError { return .disconnected }
        return .connectionFailed
    }

    private func isTerminalConnectionFailure(_ failure: DSBotFailure) -> Bool {
        switch failure {
        case .disconnected, .identityMismatch, .protocolError, .connectionFailed:
            return true
        case .remote("AUTH_FAILED"), .remote("UNAUTHORIZED"), .remote("DISCONNECTED"):
            return true
        default:
            return false
        }
    }

    private func elapsed(since start: Date) -> Double {
        max(0, Date().timeIntervalSince(start) * 1_000)
    }
}
