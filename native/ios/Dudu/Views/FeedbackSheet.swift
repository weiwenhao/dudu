import SwiftUI

/// The feedback popup of the settings (owner, 2026-11-27: 「反馈放在设置页……隐私条款下面放一个反馈弹窗」, 「只需要让用户填一个回信邮箱，其他的都不需要」): a form sheet built as 新建事项 is (the bar with the round ✕ and the
/// round action, a description field and a one-line field in the same cards), with two fields only. The recent log, the phone's model and where it goes are not on it (`FeedbackReport`, `FeedbackChannel`).
struct FeedbackSheet: View {
    let onSent: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var email = ""
    @State private var isSending = false
    @State private var formHeight: CGFloat = 0
    @State private var formTopInset: CGFloat = 0
    @State private var detent: PresentationDetent = .height(300)
    @FocusState private var focus: Field?

    private enum Field { case text, email }

    /// The form, the bar above it and the home indicator below it, as the new-issue sheet fits its own.
    private var formDetent: PresentationDetent { .height(formHeight > 0 ? formHeight + formTopInset + DuduLayout.windowSafeAreaBottom : 300) }
    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && FeedbackEmail.isValid(email) && !isSending
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    TextField(L10n.text("请描述遇到的问题"), text: $text, axis: .vertical)
                        .font(.system(size: 16))
                        .foregroundStyle(DuduStyle.chatInk)
                        .lineLimit(4...8)
                        .focused($focus, equals: .text)
                        .padding(16)
                        .background(DuduStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityIdentifier("userfeedback.text")
                    TextField(L10n.text("回信邮箱"), text: $email)
                        .font(.system(size: 16))
                        .foregroundStyle(DuduStyle.chatInk)
                        .keyboardType(.emailAddress)
                        .textContentType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.send)
                        .focused($focus, equals: .email)
                        .onSubmit { if canSend { send() } }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .background(DuduStyle.sheet, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .accessibilityIdentifier("userfeedback.email")
                }
                .disabled(isSending)
                .padding(20)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
                    if height > 0, abs(formHeight - height) > 0.5 { formHeight = height }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)
            .background(DuduStyle.canvas)
            .onGeometryChange(for: CGFloat.self) { $0.safeAreaInsets.top } action: { inset in
                if abs(formTopInset - inset) > 0.5 { formTopInset = inset }
            }
            .navigationTitle(L10n.text("反馈"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    SheetCloseButton(label: L10n.text("取消")) { dismiss() }
                        .disabled(isSending)
                        .accessibilityIdentifier("userfeedback.cancel")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: send) {
                        if isSending {
                            ProgressView()
                        } else {
                            Image(systemName: "checkmark")
                                .font(.system(size: 13, weight: .medium))
                                .frame(width: 20, height: 20)
                        }
                    }
                    .controlSize(.small)
                    .buttonBorderShape(.circle)
                    .disabled(!canSend)
                    .accessibilityLabel(L10n.text("发送"))
                    .accessibilityIdentifier("userfeedback.send")
                }
            }
        }
        .background {
            SheetOutsideTapDismiss(isEnabled: !isSending) { dismiss() }
        }
        // The caret and the round button take the app's ink, also when the settings themselves are in a sheet (as the other popups do).
        .tint(DuduStyle.ink)
        .presentationDetents([formDetent], selection: $detent)
        .onChange(of: formDetent, initial: true) { _, new in detent = new }
        .presentationCornerRadius(32)
        .interactiveDismissDisabled(isSending)
        .task { focus = .text }
    }

    private func send() {
        guard canSend else { return }
        focus = nil
        isSending = true
        let message = text, address = email
        Task {
            // The log is read off the main thread: it can be a few hundred kilobytes.
            let report = await Task.detached { FeedbackReport.make(message: message, email: address) }.value
            do {
                try await FeedbackSender().send(report)
                DuduLog.record("feedback.sent")
                isSending = false
                onSent()
                dismiss()
            } catch {
                DuduLog.networkFailure("feedback.failed", error: error)
                isSending = false
                // At the top of the screen, above the popup, for a second, with no ✕ (owner, 2026-11-27: 「C 可以，但是需要在顶部…不要超过 1 秒就自动关闭，也不需要右侧的叉掉」, 「我选位置一」); what was written stays and ✓ sends again.
                TopToast.shared.show(DuduToastMessage(text: L10n.text("发送失败"), kind: .error, duration: .seconds(1), showsClose: false))
            }
        }
    }
}
