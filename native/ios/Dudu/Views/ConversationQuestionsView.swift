import SwiftUI
import UIKit

/// The questions whose sheet has already opened by itself (owner, 2026-11-21: 「提问框没有默认弹出来啊，还要我自己去点开」): a question opens its sheet once, the first time the chat shows it and nothing is in the way;
/// closing the sheet hides it for good, and the 「回答问题」 line opens it again. Kept outside the view, which is made again whenever the history list recycles its row.
final class QuestionAutoOpen: @unchecked Sendable {
    static let shared = QuestionAutoOpen()
    private let lock = NSLock()
    private var opened: [String] = []

    /// True once for each question.
    func claim(_ id: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !opened.contains(id) else { return false }
        opened.append(id)
        if opened.count > 100 { opened.removeFirst(opened.count - 100) }
        return true
    }
}

struct ConversationQuestionsView: View {
    let batch: ConversationQuestions
    let connected: Bool
    /// The chat is in front, the app is active and no other sheet is open: the question may open its sheet by itself now.
    var autoOpen = false
    var onPresentationChange: (Bool) -> Void = { _ in }
    let submit: ([ConversationAnswer]) async throws -> Void
    @State private var presented = false
    @State private var index = 0
    @State private var selections: [String: Set<String>] = [:]
    @State private var custom: [String: String] = [:]
    @State private var completed: Set<String> = []
    @State private var submitting = false
    @State private var failure: String?
    @State private var sheetHeight: CGFloat = 344
    @State private var sheetWidth: CGFloat = 393
    @FocusState private var answerFocused: Bool

    private var question: ConversationQuestion? {
        batch.questions.indices.contains(index) ? batch.questions[index] : nil
    }

    var body: some View {
        if !batch.questions.isEmpty {
            Button {
                openSheet()
            } label: {
                HStack(spacing: 14) {
                    Text(L10n.text("回答问题"))
                        .font(.system(size: 15, weight: .medium))
                    progress.font(.system(size: 12))
                    DuduIcon(.right, size: 14)
                }
                .foregroundStyle(DuduStyle.blue)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("chat.questions.\(batch.id)")
            .sheet(isPresented: $presented, onDismiss: {
                answerFocused = false
                DuduLog.record("question.sheet.close")
            }) { answerSheet }
            .onChange(of: presented) { _, value in
                onPresentationChange(value)
                if value { DuduLog.record("question.sheet.open") }
            }
            .onDisappear { onPresentationChange(false) }
            .onAppear { openAutomatically() }
            .onChange(of: autoOpen) { _, _ in openAutomatically() }
            .onChange(of: connected) { _, _ in openAutomatically() }
        }
    }

    private func openSheet() {
        sheetHeight = fittedHeight(64 + CGFloat(question?.options.count ?? 0) * 52
            + ((question?.options.isEmpty ?? true) ? 112 : 52) + 68)
        presented = true
    }

    /// The first time the question is shown and the sheet can open, it does; later the person opens it with the line.
    private func openAutomatically() {
        guard autoOpen, connected, !presented, QuestionAutoOpen.shared.claim(batch.id) else { return }
        openSheet()
    }

    private var progress: some View {
        Text(verbatim: "\(index + 1) / \(batch.questions.count)")
            .monospacedDigit()
            .foregroundStyle(DuduStyle.muted)
    }

    /// Short questions are the sheet title, as in the approved drawing. A long
    /// question stays readable in the scrolling content rather than being cut by a toolbar.
    private var questionFitsTitle: Bool {
        guard let question, !question.question.contains("\n") else { return false }
        let width = (question.question as NSString).size(withAttributes: [
            .font: UIFont.systemFont(ofSize: 16, weight: .semibold)
        ]).width
        return width <= max(0, sheetWidth - 112)
    }

    private var answerSheet: some View {
        QuickSheetPage(
            title: questionFitsTitle ? (question?.question ?? "") : (question?.header ?? L10n.text("回答问题")),
            onClose: { presented = false },
            centersTitle: true,
            actions: {}, filters: {}
        ) {
            if let question {
                VStack(alignment: .leading, spacing: 12) {
                    if !questionFitsTitle {
                        Text(question.question).font(.system(size: 16, weight: .medium))
                    }
                    if let detail = question.detail, !detail.isEmpty {
                        MessageMarkdown(text: detail, compact: true)
                    }
                    if batch.state == "continued" {
                        Text(L10n.text("已继续工作，仍可回答"))
                            .font(.system(size: 12))
                            .foregroundStyle(DuduStyle.chatSecondary)
                    }
                    answerGroup(question)
                    if let failure { ConversationFailureView(message: failure) }
                }
                .foregroundStyle(DuduStyle.chatInk)
            }
        } footer: {
            answerFooter
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { sheetWidth = $0 }
        .onPreferenceChange(QuickSheetMetricsKey.self) { metrics in
            if let metrics { sheetHeight = fittedHeight(metrics.height) }
        }
        .presentationDetents([.height(sheetHeight)])
        .presentationDragIndicator(.hidden)
        .presentationCornerRadius(28)
        .presentationBackground(DuduStyle.sheet)
        .background(SheetOutsideTapDismiss { presented = false })
        .accessibilityIdentifier("question.sheet.\(batch.id)")
    }

    private func fittedHeight(_ height: CGFloat) -> CGFloat {
        min(max(188, height), max(188, DuduLayout.screenHeight * 0.75))
    }

    private func answerGroup(_ question: ConversationQuestion) -> some View {
        VStack(spacing: 0) {
            ForEach(question.options, id: \.label) { option in
                Button { toggle(option.label, question: question) } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(option.label).font(.system(size: 16))
                            if let description = option.description, !description.isEmpty {
                                Text(description).font(.system(size: 13)).foregroundStyle(DuduStyle.chatSecondary)
                            }
                        }
                        Spacer(minLength: 0)
                        Image(systemName: symbol(option.label, question: question))
                            .font(.system(size: 18))
                            .frame(width: 20, height: 20)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DuduQuietPressStyle())
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
            .id(question.id)
            .font(.system(size: 16))
            .focused($answerFocused)
            .lineLimit(question.options.isEmpty ? 3...8 : 1...8)
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: question.options.isEmpty ? 112 : 52, alignment: .topLeading)
            .accessibilityIdentifier("question.custom.\(question.id)")
        }
        .background(Color.white, in: RoundedRectangle(cornerRadius: 16))
        .disabled(submitting)
    }

    private var answerFooter: some View {
        HStack(spacing: 0) {
            if index > 0 {
                Button {
                    answerFocused = false
                    index -= 1
                    failure = nil
                } label: {
                    Text(L10n.text("上一题"))
                        .frame(minWidth: 82, minHeight: 44)
                        .background(Color.white, in: Capsule())
                        .overlay(Capsule().stroke(DuduStyle.line, lineWidth: 0.7))
                }
                .buttonStyle(DuduQuietPressStyle())
                .accessibilityIdentifier("question.previous")
                .padding(.trailing, 20)
            }
            progress.font(.system(size: 13))
            Spacer(minLength: 0)
            Button { advance(skipping: true) } label: {
                Text(L10n.text("跳过"))
                    .foregroundStyle(DuduStyle.chatSecondary)
                    .frame(minWidth: 44, minHeight: 44)
            }
            .buttonStyle(DuduQuietPressStyle())
            .padding(.trailing, 16)
            Button { advance(skipping: false) } label: {
                ZStack {
                    Text(index == batch.questions.count - 1 ? L10n.text("提交") : L10n.text("下一题"))
                        .opacity(submitting ? 0 : 1)
                    if submitting { ProgressView().tint(.white) }
                }
                .foregroundStyle(.white)
                .frame(minWidth: 103, minHeight: 44)
                .background(DuduStyle.chatInk, in: Capsule())
            }
            .buttonStyle(DuduQuietPressStyle())
            .accessibilityIdentifier("question.submit")
        }
        .font(.system(size: 15, weight: .medium))
        .foregroundStyle(DuduStyle.chatInk)
        .padding(.horizontal, 20)
        .padding(.bottom, 16)
        .disabled(submitting || !connected)
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
        answerFocused = false
    }

    private func advance(skipping: Bool) {
        guard let question, !submitting, connected else { return }
        answerFocused = false
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
        DuduLog.record("question.answer.begin", counts: ["rowCount": answers.count])
        Task { @MainActor in
            defer { submitting = false }
            do {
                try await submit(answers)
                presented = false
                DuduLog.record("question.answer.complete")
            }
            catch {
                failure = error.localizedDescription
                DuduLog.networkFailure("question.answer.fail", error: error, method: "question.answer")
            }
        }
    }
}
