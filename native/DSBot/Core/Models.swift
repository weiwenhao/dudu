import Foundation

enum ConnectionStatus: String, Codable, Sendable {
    case disconnected
    case connecting
    case connected
}

struct Computer: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
    var url: String
    var computerId: String?
    var lastUsedAt: Double

    var displayAddress: String {
        guard var components = URLComponents(string: url) else { return "" }
        components.user = nil
        components.password = nil
        components.query = nil
        components.fragment = nil
        return components.string ?? ""
    }
}

struct SessionSummary: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var title: String
    var workspaceId: String?
    var workspaceName: String?
    var updatedAt: Double
    var status: String
    /// The host has not seen a message in this conversation yet; it can be reused for a new task.
    var blank: Bool?
    /// DSH's archive and pin sets; the pin rank is the place in the pin set, most recently pinned first.
    var archived: Bool?
    var pinned: Bool?
    var pinRank: Int?
}

struct WorkspaceSummary: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
    var path: String?
}

struct DraftTarget: Hashable, Sendable {
    let computerID: String
    let sessionID: String
}

struct ChatMessage: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var role: String
    var text: String
    var reasoning: String?
    var status: String?
    var toolName: String?
    var process: String?
}

struct LibraryEntry: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
    var subtitle: String?
    var enabled: Bool?
    var detail: String?
    var schedule: LibraryScheduleInfo? = nil
}

struct LibraryScheduleInfo: Codable, Sendable, Equatable {
    var sessionId: String
    var rule: LibraryScheduleRule
    var lastDelivery: LibraryScheduleDelivery?
}

struct LibraryScheduleRule: Codable, Sendable, Equatable {
    var kind: String
    var afterSeconds: Int?
    var everySeconds: Int?
    var time: String?
    var timeZone: String?
    var weekdays: [Int]?
    var expression: String?
}

struct LibraryScheduleDelivery: Codable, Sendable, Equatable {
    var scheduledAt: String?
    var deliveredAt: String?
    var messageId: String?
}

struct Choice: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
    /// One line about the choice (agent presets).
    var description: String? = nil
    /// Reasoning levels a model offers, named by the host ("High", "Max").
    var efforts: [Choice]? = nil
    var defaultEffort: String? = nil
    /// The host's default agent preset.
    var isDefault: Bool? = nil
}

struct UploadAttachment: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
    var mimeType: String
    var dataBase64: String
}

struct ProjectFileEntry: Codable, Identifiable, Sendable, Equatable {
    let name: String
    let path: String
    let isDirectory: Bool
    let size: Int?

    var id: String { path }
}

struct ProjectDirectory: Codable, Sendable {
    let name: String
    let path: String
    let entries: [ProjectFileEntry]
    let truncated: Bool
}

struct ProjectFileContent: Codable, Sendable {
    let name: String
    let path: String
    let text: String
    let truncated: Bool
}

struct QueuedMessage: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var text: String
    var editable: Bool
    var attachments: [TranscriptAttachment]?
}

struct SessionDetail: Codable, Sendable, Equatable {
    var session: SessionSummary
    var messages: [ChatMessage]
    var modelId: String?
    var permissionId: String?
    var context: [LibraryEntry]
    var trace: [LibraryEntry]
    var team: [LibraryEntry]
    var approvals: [Approval]
    /// Structured chat entries; present when the desktop plugin supports the transcript format.
    var transcript: Transcript?
    var goal: SessionGoal?
    /// DSH's task list for this conversation; nil when it has none.
    var todos: [TodoItem]?
    var queuedMessages: [QueuedMessage]
    var questions: [ConversationQuestions]
    var planMode: Bool
    /// Reasoning level in use and the agent preset ("mode") the session started with.
    var reasoningEffort: String?
    var agentPreset: String?

    private enum CodingKeys: String, CodingKey {
        case session, messages, modelId, permissionId, context, trace, team, approvals
        case transcript, goal, todos, queuedMessages, questions, planMode, reasoningEffort, agentPreset
    }

    init(
        session: SessionSummary,
        messages: [ChatMessage],
        modelId: String? = nil,
        permissionId: String? = nil,
        context: [LibraryEntry] = [],
        trace: [LibraryEntry] = [],
        team: [LibraryEntry] = [],
        approvals: [Approval] = [],
        transcript: Transcript? = nil,
        goal: SessionGoal? = nil,
        todos: [TodoItem]? = nil,
        queuedMessages: [QueuedMessage] = [],
        questions: [ConversationQuestions] = [],
        planMode: Bool = false,
        reasoningEffort: String? = nil,
        agentPreset: String? = nil
    ) {
        self.session = session
        self.messages = messages
        self.modelId = modelId
        self.permissionId = permissionId
        self.context = context
        self.trace = trace
        self.team = team
        self.approvals = approvals
        self.transcript = transcript
        self.goal = goal
        self.todos = todos
        self.queuedMessages = queuedMessages
        self.questions = questions
        self.planMode = planMode
        self.reasoningEffort = reasoningEffort
        self.agentPreset = agentPreset
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        session = try container.decode(SessionSummary.self, forKey: .session)
        messages = try container.decodeIfPresent([ChatMessage].self, forKey: .messages) ?? []
        modelId = try container.decodeIfPresent(String.self, forKey: .modelId)
        permissionId = try container.decodeIfPresent(String.self, forKey: .permissionId)
        context = try container.decodeIfPresent([LibraryEntry].self, forKey: .context) ?? []
        trace = try container.decodeIfPresent([LibraryEntry].self, forKey: .trace) ?? []
        team = try container.decodeIfPresent([LibraryEntry].self, forKey: .team) ?? []
        approvals = try container.decodeIfPresent([Approval].self, forKey: .approvals) ?? []
        transcript = try container.decodeIfPresent(Transcript.self, forKey: .transcript)
        goal = try container.decodeIfPresent(SessionGoal.self, forKey: .goal)
        todos = try container.decodeIfPresent([TodoItem].self, forKey: .todos)
        queuedMessages = try container.decodeIfPresent([QueuedMessage].self, forKey: .queuedMessages) ?? []
        questions = try container.decodeIfPresent([ConversationQuestions].self, forKey: .questions) ?? []
        planMode = try container.decodeIfPresent(Bool.self, forKey: .planMode) ?? false
        reasoningEffort = try container.decodeIfPresent(String.self, forKey: .reasoningEffort)
        agentPreset = try container.decodeIfPresent(String.self, forKey: .agentPreset)
    }
}

struct Approval: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var sessionId: String
    var title: String
    var detail: String?
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

enum DSBotFailure: Error, LocalizedError, Sendable, Equatable {
    case invalidLink
    case insecurePublicConnection
    case missingCredential
    case identityMismatch
    case connectionFailed
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

    var logCode: String {
        switch self {
        case .invalidLink: return "INVALID_LINK"
        case .insecurePublicConnection: return "INSECURE_PUBLIC"
        case .missingCredential: return "MISSING_CREDENTIAL"
        case .identityMismatch: return "IDENTITY_MISMATCH"
        case .connectionFailed: return "CONNECTION_FAILED"
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
        case .invalidLink: return "配对链接无效"
        case .insecurePublicConnection: return "公网地址请使用 HTTPS"
        case .missingCredential: return "请粘贴电脑生成的完整配对链接"
        case .identityMismatch: return "配对信息与电脑不匹配，请重新配对"
        case .connectionFailed: return "无法连接，请检查电脑和网络"
        case .timedOut: return "连接超时"
        case .resultUnknown: return "请求可能已在电脑执行，请查看会话状态后再操作。"
        case .disconnected: return "连接已断开"
        case .protocolError: return "电脑返回了无法识别的数据。"
        case .storage: return "安全存储暂时不可用。"
        case .unsupportedRequest: return "暂不支持此操作。"
        case .switchedComputer: return "电脑已切换，请重试。"
        case let .remote(code): return Self.message(for: code)
        }
    }

    static func remoteCode(_ raw: String?) -> DSBotFailure {
        guard let raw,
              raw.count <= 48,
              raw.range(of: #"^[A-Za-z0-9_]+$"#, options: .regularExpression) != nil
        else { return .remote("UNKNOWN") }
        return .remote(raw.uppercased())
    }

    private static func message(for code: String) -> String {
        switch code {
        case "UNAUTHORIZED", "AUTH_FAILED": return "配对已失效，请生成新配对码"
        case "AUTH_REQUIRED": return "请更新电脑端的 dsbot 插件"
        case "METHOD_NOT_ALLOWED": return "请更新电脑端的手机控制插件"
        case "UNSUPPORTED": return "暂不支持此操作。"
        case "NOT_FOUND": return "请求的会话或资源已不存在。"
        case "INVALID_ARGUMENT", "BAD_REQUEST": return "请求内容无效，请检查后重试。"
        case "FORBIDDEN": return "电脑拒绝了此操作。"
        case "BUSY": return "电脑正在处理其他操作，请稍后重试。"
        default: return "电脑暂时无法完成请求。"
        }
    }
}

actor DSBotJSON {
    func decode<Value: Decodable & Sendable>(_ type: Value.Type, from value: JSONValue) throws -> Value {
        do {
            let data = try JSONEncoder().encode(value)
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw DSBotFailure.protocolError
        }
    }

    func encode<Value: Encodable & Sendable>(_ value: Value) throws -> JSONValue {
        let data = try JSONEncoder().encode(value)
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }
}
