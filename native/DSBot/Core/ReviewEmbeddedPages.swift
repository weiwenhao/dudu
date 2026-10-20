#if DEBUG && targetEnvironment(simulator)
import Foundation

actor ReviewEmbeddedPages {
    private struct Stream {
        let pageID: String
        let endpoint: String
        var items: [JSONValue]
        var waiter: CheckedContinuation<JSONValue, Error>?
        var timer: Task<Void, Never>?
    }

    private var manifest: JSONValue?
    private var folder: URL?
    private var pages: [String: String] = [:]
    private var streams: [String: Stream] = [:]
    private var settingsDescribeResult: JSONValue?
    private var settingsBaseByNamespace: [String: JSONValue] = [:]

    func request(_ method: String, params: [String: JSONValue]) async throws -> JSONValue {
        try load()
        switch method {
        case "web.open":
            let kind = params["page"]?.stringValue ?? ""
            guard let html = manifest?["documents"]?[kind]?.stringValue else {
                throw DSBotFailure.unsupportedRequest
            }
            let id = UUID().uuidString.lowercased()
            pages[id] = kind
            return .object(["id": .string(id), "html": .string(html)])
        case "web.close":
            let id = params["id"]?.stringValue ?? ""
            pages[id] = nil
            for (streamID, stream) in streams where stream.pageID == id { closeStream(streamID) }
            return .object([:])
        case "web.resource":
            try requirePage(params)
            guard let path = params["path"]?.stringValue,
                  let info = manifest?["resources"]?[path],
                  let filename = info["file"]?.stringValue,
                  filename.range(of: #"^[a-f0-9]{64}\.bin$"#, options: .regularExpression) != nil,
                  let mimeType = info["mimeType"]?.stringValue,
                  let folder else { throw DSBotFailure.unsupportedRequest }
            let data = try Data(contentsOf: folder.appendingPathComponent("resources").appendingPathComponent(filename))
            let offset = Int(params["offset"]?.numberValue ?? 0)
            guard offset >= 0, offset <= data.count else { throw DSBotFailure.protocolError }
            let end = min(data.count, offset + 192 * 1_024)
            return .object([
                "mimeType": .string(mimeType),
                "dataBase64": .string(data.subdata(in: offset..<end).base64EncodedString()),
                "totalBytes": .number(Double(data.count)), "eof": .bool(end == data.count)
            ])
        case "web.invoke":
            try requirePage(params)
            let endpoint = params["endpoint"]?.stringValue ?? ""
            let args = params["args"] ?? .object([:])
            let pageID = params["id"]?.stringValue ?? ""
            return try invoke(endpoint, args: args, pageKind: pages[pageID])
        case "web.stream.open":
            try requirePage(params)
            let endpoint = params["endpoint"]?.stringValue ?? ""
            let args = params["args"] ?? .object([:])
            let candidates = manifest?["streams"]?.arrayValue ?? []
            let source = candidates.first { $0["endpoint"]?.stringValue == endpoint && streamMatches($0["args"], args) }
                ?? candidates.first { $0["endpoint"]?.stringValue == endpoint }
            let id = UUID().uuidString.lowercased()
            streams[id] = Stream(
                pageID: params["id"]?.stringValue ?? "",
                endpoint: endpoint,
                items: source?["items"]?.arrayValue ?? []
            )
            return .object(["streamId": .string(id)])
        case "web.stream.next":
            try requirePage(params)
            let id = params["streamId"]?.stringValue ?? ""
            guard var stream = streams[id], stream.pageID == params["id"]?.stringValue else {
                throw DSBotFailure.unsupportedRequest
            }
            if !stream.items.isEmpty {
                let item = stream.items.removeFirst()
                streams[id] = stream
                return .object(["items": .array([item]), "done": .bool(false)])
            }
            guard stream.waiter == nil else { throw DSBotFailure.protocolError }
            return try await withCheckedThrowingContinuation { continuation in
                stream.waiter = continuation
                stream.timer = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(20))
                    guard !Task.isCancelled else { return }
                    await self?.pollTimeout(id)
                }
                streams[id] = stream
            }
        case "web.stream.close":
            try requirePage(params)
            closeStream(params["streamId"]?.stringValue ?? "")
            return .object([:])
        default:
            throw DSBotFailure.unsupportedRequest
        }
    }

    func disconnect() {
        for id in Array(streams.keys) { closeStream(id) }
        pages.removeAll()
        settingsDescribeResult = nil
        settingsBaseByNamespace.removeAll()
    }

    private func load() throws {
        guard manifest == nil else { return }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let source = documents.appendingPathComponent("full-page-review", isDirectory: true)
        let data = try Data(contentsOf: source.appendingPathComponent("manifest.json"))
        manifest = try JSONDecoder().decode(JSONValue.self, from: data)
        folder = source
    }

    private func requirePage(_ params: [String: JSONValue]) throws {
        guard let id = params["id"]?.stringValue, pages[id] != nil else {
            throw DSBotFailure.unsupportedRequest
        }
    }

    private func pollTimeout(_ id: String) {
        guard var stream = streams[id], let waiter = stream.waiter else { return }
        stream.waiter = nil
        stream.timer = nil
        streams[id] = stream
        waiter.resume(returning: .object(["items": .array([]), "done": .bool(false)]))
    }

    private func closeStream(_ id: String) {
        guard let stream = streams.removeValue(forKey: id) else { return }
        stream.timer?.cancel()
        stream.waiter?.resume(returning: .object(["items": .array([]), "done": .bool(true)]))
    }

    private func streamMatches(_ expected: JSONValue?, _ args: JSONValue) -> Bool {
        guard let expected else { return false }
        if expected == args { return true }
        return expected["request"]?["address"] == args["request"]?["address"]
    }

    private func invoke(_ endpoint: String, args: JSONValue, pageKind: String?) throws -> JSONValue {
        if endpoint == "productAnalytics/enabled" || endpoint == "session/canOpenWorkspacePath" {
            return .object(["ok": .bool(true), "value": .bool(false)])
        }
        let candidates = manifest?["calls"]?.arrayValue ?? []

        if endpoint == "settings/describe" {
            if let settingsDescribeResult { return settingsDescribeResult }
            let call = candidates.last {
                $0["endpoint"]?.stringValue == endpoint && $0["args"] == args
            } ?? candidates.last { $0["endpoint"]?.stringValue == endpoint }
            guard let result = call?["result"] else { return missingResult(endpoint) }
            settingsDescribeResult = result
            seedSettingsBases(from: result)
            return result
        }

        if Self.settingsWriteEndpoints.contains(endpoint) {
            guard pageKind == "settings" || pageKind == "plugins" else {
                return reviewFailure("review/page-not-allowed", "此审核操作不适用于当前页面")
            }
            return simulateSettingsWrite(endpoint, args: args)
        }

        if let call = candidates.last(where: { $0["endpoint"]?.stringValue == endpoint && $0["args"] == args }),
           let result = call["result"] { return result }
        if endpoint == "credentials/describe" {
            let refs = args["refs"]?.arrayValue ?? []
            var values: [String: JSONValue] = [:]
            for ref in refs {
                guard let key = ref.stringValue else { continue }
                values[key] = .object(["configured": .bool(false), "writable": .bool(false)])
            }
            return .object(["ok": .bool(true), "value": .object(values)])
        }
        if let call = candidates.last(where: { $0["endpoint"]?.stringValue == endpoint }),
           let result = call["result"],
           ![
            "session/projections", "session/page",
            "dshContext/detail", "dshContext/fleet", "dshContext/skills"
           ].contains(endpoint) {
            return result
        }
        return missingResult(endpoint)
    }

    private static let settingsWriteEndpoints: Set<String> = [
        "settings/mutate", "settings/update", "settings/replace"
    ]

    private func missingResult(_ endpoint: String) -> JSONValue {
        let state = endpoint.replacingOccurrences(of: "/", with: ".")
        DSBotLog.record("review.rpc.missing", level: "warn", state: String(state.prefix(32)))
        return reviewFailure("review/missing", "缺少此操作的审核数据")
    }

    private func simulateSettingsWrite(_ endpoint: String, args: JSONValue) -> JSONValue {
        guard var response = settingsDescribeResult,
              response["ok"]?.boolValue == true,
              let namespace = args["ns"]?.stringValue,
              var describe = response["value"],
              var describeFields = describe.objectValue,
              var namespaces = describe["namespaces"]?.arrayValue,
              let index = namespaces.firstIndex(where: { $0["ns"]?.stringValue == namespace }) else {
            return reviewFailure("review/missing", "缺少此操作的审核数据")
        }

        var view = namespaces[index]
        let revision = view["revision"]?.numberValue ?? 0
        if let expected = args["expectedRevision"]?.numberValue, expected != revision {
            return reviewFailure("settings/revision-conflict", "设置已更新，请重新载入后再试")
        }
        guard describe["writable"]?.boolValue != false else {
            return reviewFailure("settings/read-only", "此审核配置为只读")
        }

        let secretPaths = view["secrets"]?.arrayValue?.compactMap { item -> [String]? in
            item["path"]?.arrayValue?.compactMap(\.stringValue)
        } ?? []
        var user = view["user"] ?? .object([:])
        guard user.objectValue != nil else {
            return reviewFailure("settings/bad-request", "设置内容格式无效")
        }

        switch endpoint {
        case "settings/mutate":
            guard let operations = args["ops"]?.arrayValue, operations.count <= 256 else {
                return reviewFailure("settings/bad-request", "设置操作格式无效")
            }
            for operation in operations {
                guard let rawPath = operation["path"]?.arrayValue,
                      rawPath.allSatisfy({ $0.stringValue != nil }) else {
                    return reviewFailure("settings/bad-request", "设置操作格式无效")
                }
                let path = rawPath.compactMap(\.stringValue)
                guard let fields = operation.objectValue,
                      let kind = operation["op"]?.stringValue,
                      !path.isEmpty, path.count <= 32,
                      path.allSatisfy(isSafeSettingsPathComponent),
                      !touchesSecret(path, secretPaths: secretPaths) else {
                    return reviewFailure("settings/bad-request", "设置操作格式无效")
                }
                switch kind {
                case "set":
                    guard fields.count == 3, let value = operation["value"],
                          setValue(&user, path: path[...], value: value) else {
                        return reviewFailure("settings/bad-request", "设置操作格式无效")
                    }
                case "unset":
                    guard fields.count == 2, unsetValue(&user, path: path[...]) else {
                        return reviewFailure("settings/bad-request", "设置操作格式无效")
                    }
                default:
                    return reviewFailure("settings/bad-request", "设置操作格式无效")
                }
            }
        case "settings/update":
            guard let patch = args["patch"]?.objectValue,
                  !touchesSecret(patch, at: [], secretPaths: secretPaths) else {
                return reviewFailure("settings/bad-request", "设置内容格式无效")
            }
            user = mergeJSON(user, with: .object(patch))
        case "settings/replace":
            guard let section = args["section"]?.objectValue,
                  !touchesSecret(section, at: [], secretPaths: secretPaths) else {
                return reviewFailure("settings/bad-request", "设置内容格式无效")
            }
            user = .object(section)
        default:
            return reviewFailure("review/missing", "缺少此操作的审核数据")
        }

        let base = settingsBaseByNamespace[namespace] ?? view["base"] ?? .object([:])
        let resolved = mergeJSON(base, with: user)
        var viewFields = view.objectValue ?? [:]
        viewFields["user"] = user
        viewFields["value"] = resolved
        viewFields["revision"] = .number(revision + 1)
        view = .object(viewFields)
        namespaces[index] = view
        describeFields["namespaces"] = .array(namespaces)
        describe = .object(describeFields)
        var responseFields = response.objectValue ?? [:]
        responseFields["value"] = describe
        response = .object(responseFields)
        settingsDescribeResult = response

        emitSettingsDocumentUpdated(namespace)
        return .object(["ok": .bool(true), "value": view])
    }

    private func seedSettingsBases(from result: JSONValue) {
        guard result["ok"]?.boolValue == true,
              let namespaces = result["value"]?["namespaces"]?.arrayValue else { return }
        var bases: [String: JSONValue] = [:]
        for view in namespaces {
            guard let namespace = view["ns"]?.stringValue,
                  let value = view["value"] else { continue }
            if let base = view["base"] {
                bases[namespace] = base
            } else {
                bases[namespace] = removingOverrides(value, from: view["user"] ?? .object([:]))
            }
        }
        settingsBaseByNamespace = bases
    }

    private func emitSettingsDocumentUpdated(_ namespace: String) {
        let frame = JSONValue.object([
            "type": .string("emit"),
            "event": .string("settings/document-updated"),
            "args": .array([.string(namespace)])
        ])
        for id in Array(streams.keys) {
            guard var stream = streams[id], stream.endpoint == "$events" else { continue }
            if let waiter = stream.waiter {
                stream.waiter = nil
                stream.timer?.cancel()
                stream.timer = nil
                streams[id] = stream
                waiter.resume(returning: .object([
                    "items": .array([frame]),
                    "done": .bool(false)
                ]))
            } else {
                stream.items.append(frame)
                streams[id] = stream
            }
        }
    }

    private func reviewFailure(_ code: String, _ message: String) -> JSONValue {
        .object([
            "ok": .bool(false),
            "error": .object([
                "code": .string(code),
                "message": .string(message),
                "details": .object([:])
            ])
        ])
    }

    private func mergeJSON(_ base: JSONValue, with overlay: JSONValue) -> JSONValue {
        guard let baseFields = base.objectValue, let overlayFields = overlay.objectValue else {
            return overlay
        }
        var result = baseFields
        for (key, value) in overlayFields {
            result[key] = result[key].map { mergeJSON($0, with: value) } ?? value
        }
        return .object(result)
    }

    private func removingOverrides(_ value: JSONValue, from user: JSONValue) -> JSONValue {
        guard var valueFields = value.objectValue, let userFields = user.objectValue else {
            return value
        }
        for (key, userValue) in userFields {
            if let existing = valueFields[key], userValue.objectValue != nil {
                valueFields[key] = removingOverrides(existing, from: userValue)
            } else {
                valueFields[key] = nil
            }
        }
        return .object(valueFields)
    }

    private func touchesSecret(_ path: [String], secretPaths: [[String]]) -> Bool {
        secretPaths.contains { secret in
            path.starts(with: secret) || secret.starts(with: path)
        }
    }

    private func touchesSecret(
        _ fields: [String: JSONValue],
        at path: [String],
        secretPaths: [[String]]
    ) -> Bool {
        fields.contains { key, value in
            let nextPath = path + [key]
            if touchesSecret(nextPath, secretPaths: secretPaths) { return true }
            guard let nested = value.objectValue else { return false }
            return touchesSecret(nested, at: nextPath, secretPaths: secretPaths)
        }
    }

    private func isSafeSettingsPathComponent(_ component: String) -> Bool {
        !component.isEmpty
            && component.rangeOfCharacter(from: .controlCharacters) == nil
            && !["__proto__", "prototype", "constructor"].contains(component)
    }

    private func setValue(_ root: inout JSONValue, path: ArraySlice<String>, value: JSONValue) -> Bool {
        guard let component = path.first else {
            root = value
            return true
        }
        let remainder = path.dropFirst()
        switch root {
        case .object(var fields):
            if remainder.isEmpty {
                fields[component] = value
            } else {
                var child = fields[component] ?? .object([:])
                guard setValue(&child, path: remainder, value: value) else { return false }
                fields[component] = child
            }
            root = .object(fields)
            return true
        case .array(var values):
            guard let index = arrayIndex(component, count: values.count) else { return false }
            if remainder.isEmpty {
                values[index] = value
            } else {
                var child = values[index]
                guard setValue(&child, path: remainder, value: value) else { return false }
                values[index] = child
            }
            root = .array(values)
            return true
        default:
            return false
        }
    }

    private func unsetValue(_ root: inout JSONValue, path: ArraySlice<String>) -> Bool {
        guard let component = path.first else { return false }
        let remainder = path.dropFirst()
        switch root {
        case .object(var fields):
            if remainder.isEmpty {
                fields[component] = nil
            } else if var child = fields[component] {
                guard unsetValue(&child, path: remainder) else { return false }
                fields[component] = child
            }
            root = .object(fields)
            return true
        case .array(var values):
            guard let index = arrayIndex(component, count: values.count) else { return false }
            if remainder.isEmpty {
                values.remove(at: index)
            } else {
                var child = values[index]
                guard unsetValue(&child, path: remainder) else { return false }
                values[index] = child
            }
            root = .array(values)
            return true
        default:
            return false
        }
    }

    private func arrayIndex(_ component: String, count: Int) -> Int? {
        guard let index = Int(component), String(index) == component, (0..<count).contains(index) else {
            return nil
        }
        return index
    }
}
#endif
