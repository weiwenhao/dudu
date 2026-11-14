import Foundation

/// One presentation, retained only when its explicit Open conversation action needs a way back.
@MainActor
final class AssistantQuickSheetState: ObservableObject, Identifiable {
    let id = UUID()
    let kind: QuickCardKind
    let target: DraftTarget
    let todos = AssistantTodoModel()
    @Published var scrollID: String?
    @Published var task: ScheduledTask?
    @Published var record: CollectorRecord?
    private let images = ConversationImageCache()
    private let json = DSBotJSON()

    init(kind: QuickCardKind, target: DraftTarget) {
        self.kind = kind
        self.target = target
    }

    func isCurrent(_ store: DSBotStore) -> Bool {
        target.computerID == store.activeComputer?.id && target.sessionID == store.selectedSession?.id
    }

    func image(_ attachment: TranscriptAttachment, of issue: BoardIssue, fullSize: Bool, using store: DSBotStore) async -> PreparedPhotoImage? {
        guard isCurrent(store), let session = issue.sessionId else { return nil }
        let recipient = DraftTarget(computerID: target.computerID, sessionID: session)
        guard let key = ConversationImageKey(target: recipient, attachment: attachment) else { return nil }
        do {
            if let image = try await images.load(key, fullSize: fullSize) { return image }
            var params: [String: JSONValue] = [
                "sessionId": .string(target.sessionID), "id": .number(Double(issue.id)),
                "session": .string("dsh:\(session)"),
            ]
            if attachment.kind == "markdown" { params["source"] = .string(attachment.id ?? "") }
            else { params["attachmentId"] = .string(attachment.id ?? "") }
            if let seq = attachment.seq { params["seq"] = .number(seq) }
            let value = try await store.request("assistant.reply.image", params)
            let payload = try await json.decode(ConversationImagePayload.self, from: value)
            guard !Task.isCancelled, isCurrent(store) else { return nil }
            return try await images.store(payload, for: key, fullSize: fullSize)
        } catch {
            if !Task.isCancelled { DSBotLog.networkFailure("assistant.reply.image.fail", error: error) }
            return nil
        }
    }
}

private struct AssistantTodosAnswer: Decodable, Sendable {
    let outcome: String
    let rows: [BoardIssue]
    let total: Int
    let nextCursor: String?
}

struct AssistantReplySnapshot: Decodable, Sendable {
    let session: SessionSummary
    let messages: [AssistantReplyMessage]
    let queuedMessages: [QueuedMessage]
    let acceptedRequestIds: [String]
    let canceledRequestIds: [String]
}

struct AssistantReplyMessage: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let role: String
    let text: String
    let status: String?
    let seq: Double?
    let time: Double?
    let attachments: [TranscriptAttachment]?

    var hasContent: Bool { !text.isEmpty || !(attachments ?? []).isEmpty }
}

@MainActor
final class AssistantTodoModel: ObservableObject {
    @Published private(set) var issues: [BoardIssue] = []
    @Published private(set) var total = 0
    @Published private(set) var loading = true
    @Published private(set) var loadingMore = false
    @Published private(set) var failure: String?
    @Published private(set) var fullLatest: [Int: AssistantReplyMessage] = [:]
    @Published var expandedID: Int?
    private(set) var nextCursor: String?
    private let json = DSBotJSON()
    private var reading = false

    func expand(_ issue: BoardIssue, in sheet: AssistantQuickSheetState, using store: DSBotStore) async {
        guard issue.sessionId != nil, sheet.isCurrent(store) else { return }
        do {
            let value = try await store.request("assistant.reply.read", [
                "sessionId": .string(sheet.target.sessionID), "id": .number(Double(issue.id)),
                "session": .string("dsh:\(issue.sessionId!)"),
            ])
            let answer = try await json.decode(AssistantReplySnapshot.self, from: value)
            guard !Task.isCancelled, sheet.isCurrent(store), expandedID == issue.id,
                  let index = issues.firstIndex(where: { $0.id == issue.id }),
                  let message = answer.messages.last(where: { $0.hasContent && $0.status != "streaming" }) else { return }
            fullLatest[issue.id] = message
            issues[index].latest = IssueLatest(
                who: message.role == "user" ? "me" : "agent", text: message.text,
                at: message.time ?? issues[index].latest?.at ?? issue.updatedAt
            )
        } catch {
            guard !Task.isCancelled, sheet.isCurrent(store) else { return }
            // Keep the immediately available latest message readable, and report a failed refresh.
            failure = error.localizedDescription
        }
    }

    func refresh(_ sheet: AssistantQuickSheetState, using store: DSBotStore, more: Bool = false) async {
        guard !reading, sheet.isCurrent(store), !more || nextCursor != nil else { return }
        guard store.status == .connected else {
            loading = false
            failure = DSBotFailure.disconnected.localizedDescription
            return
        }
        reading = true
        if more { loadingMore = true } else { loading = issues.isEmpty }
        failure = nil
        defer { reading = false; loading = false; loadingMore = false }
        do {
            var params: [String: JSONValue] = ["sessionId": .string(sheet.target.sessionID)]
            if more, let nextCursor { params["cursor"] = .string(nextCursor) }
            let value = try await store.request("assistant.todos", params)
            let answer = try await json.decode(AssistantTodosAnswer.self, from: value)
            guard !Task.isCancelled, sheet.isCurrent(store) else { return }
            guard answer.outcome == "success" else { throw DSBotFailure.protocolError }
            if more {
                let known = Set(issues.map(\.id))
                issues += answer.rows.filter { !known.contains($0.id) }
            } else {
                issues = answer.rows
            }
            total = answer.total
            nextCursor = answer.nextCursor
        } catch {
            guard !Task.isCancelled, sheet.isCurrent(store) else { return }
            failure = error.localizedDescription
            DSBotLog.networkFailure("assistant.todos.fail", error: error)
        }
    }
}
