import Foundation

// The four types that the network client, the saved computers and the notification extension (`DuduNotificationService`) share, moved out of Models.swift unchanged so that the extension can
// compile them without the conversation models: a paired computer, a JSON value, the failures the App speaks of, and the decoder that turns an answer into a type.

struct Computer: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
    var url: String
    var computerId: String?
    var lastUsedAt: Double
    var addresses: [ConnectionAddress]? = nil
    var probeId: String? = nil
    var addressesEdited: Bool? = nil

    var displayAddress: String {
        guard var components = URLComponents(string: url) else { return "" }
        components.user = nil
        components.password = nil
        components.query = nil
        components.fragment = nil
        if components.path == "/" { components.path = "" }
        return components.string ?? ""
    }

    var shortAddress: String {
        displayAddress.replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression)
    }

    var connectionAddresses: [ConnectionAddress] {
        (try? ConnectionEndpoint.saved(self).addresses) ?? []
    }
}

enum JSONValue: Codable, Sendable, Equatable {
    case object([String: JSONValue])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    var objectValue: [String: JSONValue]? {
        guard case let .object(value) = self else { return nil }
        return value
    }

    var arrayValue: [JSONValue]? {
        guard case let .array(value) = self else { return nil }
        return value
    }

    var stringValue: String? {
        guard case let .string(value) = self else { return nil }
        return value
    }

    var numberValue: Double? {
        guard case let .number(value) = self else { return nil }
        return value
    }

    var boolValue: Bool? {
        guard case let .bool(value) = self else { return nil }
        return value
    }

    subscript(_ key: String) -> JSONValue? {
        objectValue?[key]
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .object(value): try container.encode(value)
        case let .array(value): try container.encode(value)
        case let .string(value): try container.encode(value)
        case let .number(value): try container.encode(value)
        case let .bool(value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

enum DuduFailure: Error, LocalizedError, Sendable, Equatable {
    case invalidLink
    case insecurePublicConnection
    case missingCredential
    case identityMismatch
    case connectionFailed
    case routesUnavailable(onlyLAN: Bool)
    case timedOut
    case resultUnknown
    case disconnected
    case protocolError
    case storage
    case unsupportedRequest
    case switchedComputer
    case remote(String)

    var requiresNewPairing: Bool {
        switch self {
        case .invalidLink, .insecurePublicConnection, .missingCredential, .identityMismatch:
            return true
        case .remote("AUTH_FAILED"), .remote("UNAUTHORIZED"):
            return true
        default:
            return false
        }
    }

    var shouldRetryConnection: Bool {
        switch self {
        case .invalidLink, .insecurePublicConnection, .missingCredential, .identityMismatch:
            return false
        case .remote("AUTH_FAILED"), .remote("UNAUTHORIZED"), .remote("AUTH_REQUIRED"):
            return false
        default:
            return true
        }
    }

    /// These failures leave an identified message waiting for the existing reconnect lifecycle.
    /// A server rejection still fails normally and restores the draft.
    var isConnectionInterruption: Bool {
        switch self {
        case .connectionFailed, .routesUnavailable, .timedOut, .resultUnknown, .disconnected:
            return true
        case .remote("DISCONNECTED"):
            return true
        default:
            return false
        }
    }

    var logCode: String {
        switch self {
        case .invalidLink: return "INVALID_LINK"
        case .insecurePublicConnection: return "INSECURE_PUBLIC"
        case .missingCredential: return "MISSING_CREDENTIAL"
        case .identityMismatch: return "IDENTITY_MISMATCH"
        case .connectionFailed: return "CONNECTION_FAILED"
        case .routesUnavailable: return "ROUTES_UNAVAILABLE"
        case .timedOut: return "TIMEOUT"
        case .resultUnknown: return "RESULT_UNKNOWN"
        case .disconnected: return "DISCONNECTED"
        case .protocolError: return "PROTOCOL_ERROR"
        case .storage: return "STORAGE"
        case .unsupportedRequest: return "UNSUPPORTED_REQUEST"
        case .switchedComputer: return "SWITCHED_COMPUTER"
        case let .remote(code):
            guard code.count <= 48,
                  code.range(of: #"^[A-Z0-9_]+$"#, options: .regularExpression) != nil else {
                return "REMOTE_ERROR"
            }
            return code
        }
    }

    var errorDescription: String? {
        switch self {
        case .invalidLink: return L10n.text("配对链接无效")
        case .insecurePublicConnection: return L10n.text("公网地址请使用 HTTPS")
        case .missingCredential: return L10n.text("请粘贴电脑生成的完整配对链接")
        case .identityMismatch: return L10n.text("配对信息与电脑不匹配，请重新配对")
        case .connectionFailed: return L10n.text("无法连接，请检查电脑和网络")
        case .routesUnavailable(let onlyLAN): return onlyLAN ? L10n.text("无法连接内网地址") : L10n.text("内网和公网都无法连接")
        case .timedOut: return L10n.text("连接超时")
        case .resultUnknown: return L10n.text("请求可能已在电脑执行，请查看会话状态后再操作。")
        case .disconnected: return L10n.text("连接已断开")
        case .protocolError: return L10n.text("电脑返回了无法识别的数据。")
        case .storage: return L10n.text("安全存储暂时不可用。")
        case .unsupportedRequest: return L10n.text("暂不支持此操作。")
        case .switchedComputer: return L10n.text("电脑已切换，请重试。")
        case let .remote(code): return Self.message(for: code)
        }
    }

    static func remoteCode(_ raw: String?) -> DuduFailure {
        guard let raw,
              raw.count <= 48,
              raw.range(of: #"^[A-Za-z0-9_]+$"#, options: .regularExpression) != nil
        else { return .remote("UNKNOWN") }
        return .remote(raw.uppercased())
    }

    private static func message(for code: String) -> String {
        switch code {
        case "UNAUTHORIZED", "AUTH_FAILED": return L10n.text("配对已失效，请生成新配对码")
        case "AUTH_REQUIRED": return L10n.text("请更新电脑端的 Dudu 插件")
        case "METHOD_NOT_ALLOWED": return L10n.text("请更新电脑端的手机控制插件")
        case "UNSUPPORTED": return L10n.text("暂不支持此操作。")
        case "NOT_FOUND": return L10n.text("请求的会话或资源已不存在。")
        case "INVALID_ARGUMENT", "BAD_REQUEST": return L10n.text("请求内容无效，请检查后重试。")
        case "FORBIDDEN": return L10n.text("电脑拒绝了此操作。")
        case "BUSY": return L10n.text("电脑正在处理其他操作，请稍后重试。")
        default: return L10n.text("电脑暂时无法完成请求。")
        }
    }
}

actor DuduJSON {
    func decode<Value: Decodable & Sendable>(_ type: Value.Type, from value: JSONValue) throws -> Value {
        do {
            let data = try JSONEncoder().encode(value)
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw DuduFailure.protocolError
        }
    }

    func encode<Value: Encodable & Sendable>(_ value: Value) throws -> JSONValue {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
}
