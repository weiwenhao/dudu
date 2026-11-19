import SwiftUI

struct ConversationQuestionsView: View {
    let batch: ConversationQuestions
    let connected: Bool
    let submit: ([ConversationAnswer]) async throws -> Void
    @State private var expanded = true
    @State private var index = 0
    @State private var selections: [String: Set<String>] = [:]
    @State private var custom: [String: String] = [:]
    @State private var completed: Set<String> = []
    @State private var submitting = false
    @State private var failure: String?

    private var question: ConversationQuestion? {
        batch.questions.indices.contains(index) ? batch.questions[index] : nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button { expanded.toggle() } label: {
                HStack(spacing: 8) {
                    DuduIcon(.question, size: 16, scalesStroke: true)
                    Text(question?.header ?? L10n.text("等待你的操作")).font(.system(size: 14, weight: .medium))
                    Spacer()
                    Text("\(index + 1)/\(batch.questions.count)").font(.system(size: 12)).monospacedDigit()
                    DuduIcon(.down, size: 14, scalesStroke: true).rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if expanded, let question {
                Text(question.question).font(.system(size: 16, weight: .medium))
                if let detail = question.detail, !detail.isEmpty {
                    MessageMarkdown(text: detail, compact: true)
                }
                if batch.state == "continued" {
                    Text(L10n.text("已继续工作，仍可回答")).font(.system(size: 12)).foregroundStyle(DuduStyle.chatSecondary)
                }
                ForEach(question.options, id: \.label) { option in
                    Button { toggle(option.label, question: question) } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: symbol(option.label, question: question))
                                .frame(width: 20)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(option.label).font(.system(size: 15))
                                if let description = option.description, !description.isEmpty {
                                    Text(description).font(.system(size: 13)).foregroundStyle(DuduStyle.chatSecondary)
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).stroke(DuduStyle.chatBorder, lineWidth: 0.5))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("question.option.\(question.id).\(option.label)")
                    .accessibilityAddTraits((selections[question.id] ?? []).contains(option.label) ? .isSelected : [])
                }
                TextField(L10n.text("输入你的答案"), text: Binding(
                    get: { custom[question.id] ?? "" },
                    set: {
                        custom[question.id] = $0
                        if !question.multiSelect { selections[question.id] = [] }
                        completed.remove(question.id)
                        failure = nil
                    }
                ), axis: .vertical)
                .lineLimit(2...8)
                .padding(12)
                .background(Color.white, in: RoundedRectangle(cornerRadius: 12))
                .accessibilityIdentifier("question.custom.\(question.id)")
                if let failure { ConversationFailureView(message: failure) }
                HStack {
                    if index > 0 {
                        answerAction(L10n.text("上一题")) { index -= 1; failure = nil }
                    }
                    Spacer()
                    answerAction(L10n.text("跳过")) { advance(skipping: true) }
                    answerAction(index == batch.questions.count - 1 ? L10n.text("提交") : L10n.text("下一题")) { advance(skipping: false) }
                        .fontWeight(.medium)
                        .accessibilityIdentifier("question.submit")
                    if submitting { ProgressView().controlSize(.small) }
                }
                .font(.system(size: 14))
            }
        }
        .foregroundStyle(DuduStyle.chatInk)
        .padding(16)
        .background(DuduStyle.chatPanel, in: RoundedRectangle(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).stroke(DuduStyle.chatBorder, lineWidth: 0.5))
        .disabled(submitting || !connected)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.questions.\(batch.id)")
    }

    private func answerAction(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .padding(.horizontal, 4)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func symbol(_ label: String, question: ConversationQuestion) -> String {
        let selected = (selections[question.id] ?? []).contains(label)
        return question.multiSelect ? (selected ? "checkmark.square.fill" : "square")
            : (selected ? "largecircle.fill.circle" : "circle")
    }

    private func toggle(_ label: String, question: ConversationQuestion) {
        var selected = selections[question.id] ?? []
        if selected.contains(label) { selected.remove(label) }
        else if question.multiSelect { selected.insert(label) }
        else { selected = [label]; custom[question.id] = "" }
        selections[question.id] = selected
        completed.remove(question.id)
        failure = nil
    }

    private func advance(skipping: Bool) {
        guard let question, !submitting else { return }
        if skipping {
            selections[question.id] = []
            custom[question.id] = ""
        } else if (selections[question.id] ?? []).isEmpty,
                  (custom[question.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            failure = L10n.text("请选择一个选项或填写自定义答案。")
            return
        }
        completed.insert(question.id)
        failure = nil
        if index + 1 < batch.questions.count { index += 1; return }
        if let missing = batch.questions.firstIndex(where: { !completed.contains($0.id) }) {
            index = missing
            failure = L10n.text("请先完成这道问题。")
            return
        }
        let answers = batch.questions.map { question in
            let text = (custom[question.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return ConversationAnswer(
                id: question.id,
                selected: question.options.map(\.label).filter { (selections[question.id] ?? []).contains($0) },
                custom: text.isEmpty ? nil : text
            )
        }
        submitting = true
        Task { @MainActor in
            defer { submitting = false }
            do { try await submit(answers) }
            catch { failure = error.localizedDescription }
        }
    }
}
