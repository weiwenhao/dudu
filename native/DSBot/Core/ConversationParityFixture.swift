#if DEBUG && targetEnvironment(simulator)
import Foundation

enum ConversationParityFixture {
    static let transcript = Transcript(
        entries: [
            TranscriptEntry(type: "user", id: "parity-user", seq: 100, time: 1_792_800_000_000,
                            text: "生成文件并检查改动。"),
            TranscriptEntry(type: "assistant", id: "parity-process", seq: 103, text: "正在写入报告。", turn: 2, step: 1,
                            calls: [TranscriptCall(id: "parity-tool", name: "write", activity: "write",
                                                   detail: "report.txt", status: "done", seq: 104, resultSeq: 105)]),
            TranscriptEntry(type: "assistant", id: "parity-answer", seq: 108, text: "报告已生成，文件改动已保存。",
                            turn: 2, step: 2)
        ],
        turns: [
            TranscriptTurn(
                turn: 2, start: 1_792_800_001_000, end: 1_792_800_012_000, outcome: "done", lastSeq: 110,
                files: [DeliveredFile(id: "parity-file", kind: "presented", seq: 107, index: 0,
                                      path: "/workspace/report.txt", name: "report.txt")],
                changesSeq: 109,
                notices: [TurnNotice(id: "retry-parity", kind: "retry", seq: 102, message: "HTTP 502",
                                    code: "HTTP_502", retry: 1, maximum: 3, delayMs: 1000, state: "started")]
            )
        ],
        live: nil, beforeSeq: 100, throughSeq: 110, hasMore: true
    )

    static let older = ConversationPage(transcript: Transcript(
        entries: [
            TranscriptEntry(type: "user", id: "parity-older-user", seq: 1, text: "更早的问题"),
            TranscriptEntry(type: "assistant", id: "parity-older-answer", seq: 10, text: "更早的回复", turn: 1, step: 1)
        ],
        turns: [TranscriptTurn(turn: 1, start: 1000, end: 2000, outcome: "done", lastSeq: 11)],
        live: nil, beforeSeq: 0, throughSeq: 110, hasMore: false
    ))

    static let changes = ConversationChanges(
        turn: 2, files: [ConversationChanges.File(path: "/workspace/report.txt", display: "report.txt", added: 2, deleted: 1)],
        total: 1, added: 2, deleted: 1
    )

    static let diff = ConversationDiff(
        kind: "text", path: "/workspace/report.txt", display: "report.txt", before: true, after: true, coarse: false,
        hunks: [ConversationDiff.Hunk(oldStart: 1, oldLines: 2, newStart: 1, newLines: 3,
                                     lines: [" 报告", "-旧内容", "+新内容", "+已验证"])]
    )

    static let performance = ConversationPerformance(
        stats: ["turns": 2, "steps": 4, "llmMs": 8000, "toolMs": 3000, "ttftMs": 400, "ttftSteps": 2, "decodeMs": 7600, "decodeTokens": 400],
        usage: ["uncachedInputTokens": 100, "cacheReadTokens": 200, "cacheWriteTokens": 0, "outputTokens": 400, "totalTokens": 700]
    )

    static let questions = ConversationQuestions(
        id: "parity-questions", sessionId: "review-chat", state: "open",
        questions: [
            ConversationQuestion(id: "color", question: "选择颜色", multiSelect: false,
                                 options: [.init(label: "黑色"), .init(label: "白色")]),
            ConversationQuestion(id: "targets", question: "选择平台", multiSelect: true,
                                 options: [.init(label: "iOS"), .init(label: "Mac")]),
            ConversationQuestion(id: "name", question: "输入名称", multiSelect: false, options: [])
        ]
    )

    static func tool(_ params: [String: JSONValue]) -> ConversationToolDetail {
        let output = String(repeating: "完整工具输出\n", count: 5000)
        let offset = Int(params["outputOffset"]?.numberValue ?? 0)
        let start = output.index(output.startIndex, offsetBy: min(offset, output.count))
        let end = output.index(start, offsetBy: min(32000, output.distance(from: start, to: output.endIndex)))
        let next = output.distance(from: output.startIndex, to: end)
        return ConversationToolDetail(
            id: "parity-tool", name: "write", status: "done",
            input: ConversationTextPage(text: #"{"file_path":"/workspace/report.txt","content":"新内容"}"#, offset: 0, total: 53),
            output: ConversationTextPage(text: String(output[start..<end]), offset: offset, total: output.count,
                                         nextOffset: next < output.count ? next : nil),
            metadata: ConversationTextPage(text: #"{"path":"/workspace/report.txt"}"#, offset: 0, total: 32),
            images: [TranscriptAttachment(kind: "image", name: "工具图片", id: "parity-output-image", seq: 105)]
        )
    }
}
#endif
