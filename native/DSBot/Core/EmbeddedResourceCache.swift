import Foundation

struct EmbeddedResourceData: Sendable {
    let mimeType: String
    let data: Data
}

actor EmbeddedResourceCache {
    static let shared = EmbeddedResourceCache()
    private var cached: [String: EmbeddedResourceData] = [:]
    private var recent: [String] = []
    private var byteCount = 0
    private var activeLoads = 0
    private var waiters: [(UUID, CheckedContinuation<Void, Error>)] = []

    func resource(
        key: String,
        fetch: @Sendable (Int) async throws -> JSONValue
    ) async throws -> EmbeddedResourceData {
        try Task.checkCancellation()
        if let value = hit(key) { return value }
        try await acquire()
        defer { release() }
        try Task.checkCancellation()
        if let value = hit(key) { return value }

        var data = Data()
        var mimeType: String?
        var expectedBytes: Int?
        while true {
            let value = try await fetch(data.count)
            let (chunk, decoded) = try await EmbeddedPageCodec.shared.resource(value)
            try Task.checkCancellation()
            if let expectedBytes {
                guard chunk.totalBytes == expectedBytes, chunk.mimeType == mimeType else {
                    throw DSBotFailure.protocolError
                }
            } else {
                expectedBytes = chunk.totalBytes
                mimeType = chunk.mimeType
                data.reserveCapacity(chunk.totalBytes)
            }
            guard data.count + decoded.count <= chunk.totalBytes else {
                throw DSBotFailure.protocolError
            }
            data.append(decoded)
            if chunk.eof {
                guard data.count == chunk.totalBytes else { throw DSBotFailure.protocolError }
                let result = EmbeddedResourceData(mimeType: chunk.mimeType, data: data)
                if data.count <= 16 * 1_024 * 1_024 {
                    while recent.count >= 96 || byteCount + data.count > 48 * 1_024 * 1_024 {
                        guard let oldest = recent.first else { break }
                        recent.removeFirst()
                        byteCount -= cached.removeValue(forKey: oldest)?.data.count ?? 0
                    }
                    cached[key] = result
                    recent.append(key)
                    byteCount += data.count
                }
                return result
            }
            guard !decoded.isEmpty, data.count < chunk.totalBytes else {
                throw DSBotFailure.protocolError
            }
        }
    }

    private func hit(_ key: String) -> EmbeddedResourceData? {
        guard let value = cached[key] else { return nil }
        recent.removeAll { $0 == key }
        recent.append(key)
        return value
    }

    // Leave socket capacity available for chat and the page's live subscriptions.
    private func acquire() async throws {
        if activeLoads < 3 {
            activeLoads += 1
            return
        }
        let id = UUID()
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                } else {
                    waiters.append((id, continuation))
                }
            }
        } onCancel: {
            Task { await self.cancelWaiter(id) }
        }
    }

    private func release() {
        if waiters.isEmpty {
            activeLoads -= 1
        } else {
            waiters.removeFirst().1.resume()
        }
    }

    private func cancelWaiter(_ id: UUID) {
        guard let index = waiters.firstIndex(where: { $0.0 == id }) else { return }
        waiters.remove(at: index).1.resume(throwing: CancellationError())
    }
}
