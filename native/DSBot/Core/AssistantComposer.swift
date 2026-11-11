import Foundation

struct AssistantRecipient: Decodable, Equatable, Sendable, Identifiable {
    struct Project: Decodable, Equatable, Sendable { var name: String }
    var id: Int
    var ref: String?
    var title: String
    var agent: SessionAgent?
    var project: Project?
    var session: String
    var address: String { ref ?? "#\(id)" }
}

struct AssistantRelayResult: Decodable, Sendable {
    struct Issue: Decodable, Sendable { var id: Int; var ref: String?; var title: String }
    var outcome: String
    var code: String?
    var saved: Bool?
    var entryId: Int?
    var issue: Issue?
    var succeeded: Bool { ["success", "no_op"].contains(outcome) }
    var errorText: String {
        // The desktop's approved delivery errors, kept verbatim.
        switch saved == true ? "delivery_failed" : code {
        case "empty_request": return "@ 后面还要写要说的话。"
        case "choose_agent": return "先选择智能体。"
        case "choose_project": return "先选项目，再把工作交给智能体。"
        case "recipient_unavailable": return "只能 @ 当前事项的处理者。"
        case "delivery_failed": return "留言已保存，请求没能送达。"
        case "invalid_message": return "先写点内容。"
        default: return "回复没能发给会话：连接暂时不可用。"
        }
    }
}
