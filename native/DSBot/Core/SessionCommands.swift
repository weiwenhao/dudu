import Foundation

/// DSH commands the phone can run for the open session. The desktop plugin keeps the same
/// allowlist and rejects anything else, so no arbitrary command line ever reaches DSH.
enum SessionCommand: String, Sendable {
    case goal
    case plan
    case compact
}

struct CommandOutcome: Sendable, Equatable {
    let isError: Bool
    let text: String
}

/// A file staged on the desktop for the next prompt. `receiptId` is the opaque authority DSH
/// issued for this session; the bytes never come back to the phone.
struct UploadedFile: Identifiable, Sendable, Equatable {
    let receiptId: String
    let name: String
    let bytes: Int

    var id: String { receiptId }
}

/// DSH's command handlers answer in English; these turn the known replies into Chinese for the
/// notice shown in the chat, and fall back to the original text for anything unfamiliar.
enum CommandText {
    static func message(for command: SessionCommand, argument: String?, outcome: CommandOutcome) -> String {
        let text = outcome.text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch command {
        case .compact: return compact(text, isError: outcome.isError)
        case .plan: return plan(text, isError: outcome.isError)
        case .goal: return goal(text, argument: argument, isError: outcome.isError)
        }
    }

    private static func compact(_ text: String, isError: Bool) -> String {
        if text.hasPrefix("Compacted "),
           let numbers = numbers(in: text), numbers.count >= 2 {
            return "已压缩 \(numbers[0]) 条历史（约 \(numbers[1]) tokens）"
        }
        switch true {
        case text.hasPrefix("No compactable history"): return "暂无可压缩的历史"
        case text == "Compaction cancelled.": return "压缩已取消"
        case text.hasPrefix("Compaction is unavailable"): return "当前无法压缩，请等会话空闲后再试"
        case text.hasPrefix("The history selected for compaction changed"): return "压缩期间历史发生了变化，请重试"
        case text.hasPrefix("Compaction could not produce"): return "未能生成有效摘要，请稍后重试"
        case text.hasPrefix("Compaction did not finish cleanly"): return "压缩未能完整完成，请检查会话状态"
        case text.hasPrefix("Compaction finished, but"): return "压缩已完成，但会话保存失败"
        default: return text.isEmpty ? (isError ? "压缩失败" : "已压缩") : text
        }
    }

    private static func plan(_ text: String, isError: Bool) -> String {
        switch true {
        case text.hasPrefix("Plan mode on"), text.hasPrefix("Entering plan mode"): return "已进入计划模式"
        case text == "Plan mode off.": return "已退出计划模式"
        case text.hasPrefix("Leaving plan mode"): return "正在退出计划模式，下一步生效"
        case text.hasPrefix("Plan mode entry cancelled"): return "已取消进入计划模式"
        case text.hasPrefix("Plan mode is already inactive"): return "计划模式当前未开启"
        case text.hasPrefix("Attachments cannot"): return "退出计划模式时不能带附件"
        default: return text.isEmpty ? (isError ? "计划模式操作失败" : "完成") : text
        }
    }

    private static func goal(_ text: String, argument: String?, isError: Bool) -> String {
        switch true {
        case text.hasPrefix("Goal created"): return "已设置目标"
        case text.hasPrefix("Goal updated"): return "已更新目标"
        case text.hasPrefix("Goal paused"): return "目标已暂停"
        case text.hasPrefix("Goal resumed"): return "目标已继续"
        case text == "Goal cleared.": return "已清除目标"
        case text.hasPrefix("No goal to clear"): return "没有可清除的目标"
        case text.hasPrefix("No goal is currently set"): return isError ? "尚未设置目标" : "尚未设置目标"
        case text.hasPrefix("A goal is already"): return "已有进行中的目标，请使用「更新目标」"
        case text.hasPrefix("The goal command is not valid"): return "当前状态下无法执行此操作"
        case text.hasPrefix("Goal editing requires"): return "请输入新的目标内容"
        default: return text.isEmpty ? (isError ? "目标操作失败" : "完成") : text
        }
    }

    private static func numbers(in text: String) -> [Int]? {
        guard let regex = try? NSRegularExpression(pattern: #"\d+"#) else { return nil }
        return regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).compactMap {
            Range($0.range, in: text).flatMap { Int(text[$0]) }
        }
    }
}
