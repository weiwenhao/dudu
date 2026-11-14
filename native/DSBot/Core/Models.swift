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
    var addresses: [ConnectionAddress]? = nil
    var probeId: String? = nil
    var addressesEdited: Bool? = nil

    var displayAddress: String {
        guard var components = URLComponents(string: url) else { return "" }
        components.user = nil
        components.password = nil
        components.query = nil
        components.fragment = nil
        if components.path == "/dsbot" { components.path = "" }
        return components.string ?? ""
    }

    var shortAddress: String {
        displayAddress.replacingOccurrences(of: #"^https?://"#, with: "", options: .regularExpression)
    }

    var connectionAddresses: [ConnectionAddress] {
        (try? ConnectionEndpoint.saved(self).addresses) ?? []
    }
}

struct SessionSummary: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var title: String
    var workspaceId: String?
    var workspaceName: String?
    var updatedAt: Double
    var status: String
    /// The plugin's fixed assistant, identified by the plugin rather than inferred from a title.
    var isAssistant: Bool? = nil
    /// The host has not seen a message in this conversation yet; it can be reused for a new task.
    var blank: Bool?
    /// DSH's archive and pin sets; the pin rank is the place in the pin set, most recently pinned first.
    var archived: Bool?
    var pinned: Bool?
    var pinRank: Int?
    var providerId: String?
    var agent: SessionAgent?
    var agentState: AgentWorkState?
    /// `agentState` is `blocked` because the run finished (the Desktop draws a green check, not red). Absent from a plugin that does not say.
    var agentFinished: Bool?
    /// The agent is in deep sleep: idle, and nobody has handled it for half an hour (the plugin says so; absent from one that does not, and when it is awake). The avatar's grey crescent takes the place of the idle ring.
    var deepSleep: Bool?
    /// A child history must retain DSH's parent address, including across cache restoration.
    var subagent: SubagentHistoryAddress? = nil
}

struct SubagentHistoryAddress: Codable, Sendable, Equatable {
    var parentSessionId: String
    var mode: String

    var json: JSONValue {
        .object(["parentSessionId": .string(parentSessionId), "mode": .string(mode)])
    }
}

extension SessionSummary {
    var historyParameters: [String: JSONValue] {
        var parameters: [String: JSONValue] = ["id": .string(id)]
        if let subagent { parameters["subagent"] = subagent.json }
        return parameters
    }
}

/// An agent of an issue or a session: the id the plugin names it by (`claude`, `codex`, `pi`, `deepseek`, and whatever it adds next). It is not a closed list: an id the app does not know
/// decodes and shows, under its own name, with its first letter for a mark, so that a plugin with one more harness does not break the lists it comes in.
struct SessionAgent: RawRepresentable, Codable, Hashable, Sendable {
    let rawValue: String

    init?(rawValue: String) {
        guard !rawValue.isEmpty else { return nil }
        self.rawValue = rawValue
    }

    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard let agent = SessionAgent(rawValue: raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "An agent has no name"))
        }
        self = agent
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    static let claude = SessionAgent(rawValue: "claude")!
    static let codex = SessionAgent(rawValue: "codex")!
    static let pi = SessionAgent(rawValue: "pi")!
    static let deepseek = SessionAgent(rawValue: "deepseek")!

    var name: String {
        switch rawValue {
        case "claude": return "Claude"
        case "codex": return "ChatGPT"
        case "pi": return "Pi"
        case "deepseek": return "DeepSeek"
        default: return rawValue.prefix(1).uppercased() + rawValue.dropFirst()
        }
    }
}

/// A question, a failure and a finished run are all `blocked`: it needs you (the owner merged "done" into it on 2026-11-03, and named it "需要你" on 2026-11-04).
enum AgentWorkState: String, Codable, Sendable {
    case idle, working, blocked

    /// A Desktop plugin that has not been updated yet still says "done" for a finished run.
    init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard let state = raw == "done" ? Self.blocked : Self(rawValue: raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Unknown agent state \(raw)"))
        }
        self = state
    }

    var name: String {
        switch self {
        case .idle: return L10n.text("空闲中")
        case .working: return L10n.text("工作中")
        case .blocked: return L10n.text("需要你")
        }
    }
}

struct SessionProvider: Codable, Identifiable, Sendable, Equatable {
    var id: String
    var name: String
    var modelIds: [String]
    var defaultModelId: String
    var isDefault: Bool?

    var agent: SessionAgent? { SessionAgent(rawValue: id) }
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
    /// The configured model source, distinct from its agent family. Optional for older catalogs and caches.
    var sourceID: String? = nil
    var sourceName: String? = nil

    var modelSourceID: String { sourceID ?? id.components(separatedBy: ":").first ?? id }
    var modelSourceName: String { sourceName ?? modelSourceID }
}

struct ModelSourceGroup: Identifiable {
    var id: String
    var name: String
    var models: [Choice]

    static func groups(_ models: [Choice]) -> [ModelSourceGroup] {
        var result: [ModelSourceGroup] = []
        var indexes: [String: Int] = [:]
        for model in models {
            if let index = indexes[model.modelSourceID] {
                result[index].models.append(model)
            } else {
                indexes[model.modelSourceID] = result.count
                result.append(ModelSourceGroup(id: model.modelSourceID, name: model.modelSourceName, models: [model]))
            }
        }
        let counts = Dictionary(grouping: result, by: \.name).mapValues(\.count)
        for index in result.indices where (counts[result[index].name] ?? 0) > 1 {
            result[index].name += " · \(result[index].id)"
        }
        return result
    }
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
    var requestId: String? = nil

    var presentationID: String { requestId.map { "submission:\($0)" } ?? id }
    var isSubmissionEcho: Bool { requestId.map { id == "submission:\($0)" } ?? false }
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
    var canceledRequestIds: [String]

    private enum CodingKeys: String, CodingKey {
        case session, messages, modelId, permissionId, context, trace, team, approvals
        case transcript, goal, todos, queuedMessages, questions, planMode, reasoningEffort, agentPreset
        case canceledRequestIds
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
        agentPreset: String? = nil,
        canceledRequestIds: [String] = []
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
        self.canceledRequestIds = canceledRequestIds
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
        canceledRequestIds = try container.decodeIfPresent([String].self, forKey: .canceledRequestIds) ?? []
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

    static func remoteCode(_ raw: String?) -> DSBotFailure {
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
