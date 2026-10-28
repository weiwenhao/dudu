import Foundation

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
}

private struct HTTPReadyResponse: Decodable, Sendable {
    struct Computer: Decodable, Sendable {
        let id: String
        let name: String
    }

    let type: String
    let protocolVersion: Int
    let computer: Computer

    enum CodingKeys: String, CodingKey {
        case type, computer
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
        let startedAt = Date()
        let response: HTTPURLResponse
        let data: Data
        do {
            (data, response) = try await perform(endpoint: endpoint, route: "connect", body: nil, timeout: 15)
        } catch {
            DSBotLog.networkFailure("http.connect.fail", error: error, elapsedMs: elapsed(since: startedAt))
            // A timed-out response may still have created a server-side connection.
            if generation == latestGeneration {
                _ = try? await perform(endpoint: endpoint, route: "disconnect", body: Data("{}".utf8), timeout: 5)
            }
            throw error
        }
        guard response.statusCode == 200 else {
            let failure = remoteFailure(data: data, status: response.statusCode)
            DSBotLog.networkFailure("http.connect.fail", error: failure, elapsedMs: elapsed(since: startedAt))
            throw failure
        }
        guard let ready = try? decoder.decode(HTTPReadyResponse.self, from: data),
              ready.type == "ready", ready.protocolVersion == 1,
              !ready.computer.id.isEmpty, !ready.computer.name.isEmpty else {
            throw DSBotFailure.protocolError
        }
        guard generation == latestGeneration else {
            _ = try? await perform(endpoint: endpoint, route: "disconnect", body: Data("{}".utf8), timeout: 5)
            throw DSBotFailure.switchedComputer
        }
        if let expectedComputerId, expectedComputerId != ready.computer.id {
            _ = try? await perform(endpoint: endpoint, route: "disconnect", body: Data("{}".utf8), timeout: 5)
            throw DSBotFailure.identityMismatch
        }

        active = ActiveConnection(
            endpoint: endpoint,
            generation: generation,
            onEvent: onEvent,
            onDisconnect: onDisconnect
        )
        let eventsTask = Task { [weak self] in
            guard let self else { return }
            await self.pollEvents(generation: generation)
        }
        active?.eventsTask = eventsTask
        DSBotLog.record("http.connect.ready", elapsedMs: elapsed(since: startedAt), state: "connected")
        return (ready.computer.id, ready.computer.name)
    }

    func request(_ method: String, params: [String: JSONValue], timeoutSeconds: UInt64) async throws -> JSONValue {
        guard let connection = active, connection.generation == latestGeneration else {
            throw DSBotFailure.disconnected
        }
        let requestID = UUID().uuidString.lowercased()
        let body = try encoder.encode(HTTPRequest(id: requestID, method: method, params: params))
        let startedAt = Date()
        do {
            let (data, response) = try await perform(
                endpoint: connection.endpoint,
                route: "request",
                body: body,
                timeout: TimeInterval(max(1, min(timeoutSeconds, 300)))
            )
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
        } catch {
            let failure = normalizedFailure(error, method: method)
            DSBotLog.networkFailure(
                "http.request.fail", error: failure, method: method, requestId: requestID,
                elapsedMs: elapsed(since: startedAt)
            )
            if isTerminalConnectionFailure(failure) {
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
        } catch let error as URLError where error.code == .timedOut {
            throw DSBotFailure.timedOut
        } catch let error as URLError where error.code == .cancelled && Task.isCancelled {
            throw CancellationError()
        } catch {
            throw DSBotFailure.connectionFailed
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
            if failure == .timedOut && ["session.send", "session.create", "approval.respond"].contains(method) {
                return .resultUnknown
            }
            return failure
        }
        if error is CancellationError { return .disconnected }
        return .connectionFailed
    }

    private func isTerminalConnectionFailure(_ failure: DSBotFailure) -> Bool {
        switch failure {
        case .disconnected, .identityMismatch, .protocolError:
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
