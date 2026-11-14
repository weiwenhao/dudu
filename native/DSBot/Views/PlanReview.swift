import SwiftUI

/// "计划待审" card for the model's plan (DSH's plan-review question), with the full text one tap away.
struct PlanReviewCard: View {
    let approval: Approval
    let isResponding: Bool
    let onApprove: () -> Void
    let onRevise: () -> Void
    let onOpenFull: () -> Void

    /// Two plain-text lines of the plan body, without markdown markers.
    private var summary: String {
        guard let detail = approval.detail else { return "" }
        let lines = detail.split(whereSeparator: \.isNewline).map { line -> String in
            var text = String(line).trimmingCharacters(in: .whitespaces)
            while text.hasPrefix("#") { text.removeFirst() }
            return text.replacingOccurrences(of: "**", with: "").replacingOccurrences(of: "`", with: "")
                .trimmingCharacters(in: .whitespaces)
        }.filter { !$0.isEmpty }
        return lines.joined(separator: " ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                if isResponding {
                    ProgressView().controlSize(.mini)
                } else {
                    Circle().fill(DSBotStyle.chatWarning).frame(width: 8, height: 8)
                }
                Text(L10n.text("计划待审"))
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(DSBotStyle.chatWarning)
                Spacer(minLength: 8)
                if approval.detail?.isEmpty == false {
                    Button(action: onOpenFull) {
                        HStack(spacing: 2) {
                            Text(L10n.text("查看全文"))
                            DSBotIcon(.right, size: 14)
                        }
                        .font(.system(size: 15))
                        .foregroundStyle(DSBotStyle.chatSecondary)
                        .frame(minHeight: 32)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("plan.full")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(DSBotStyle.chatWarning.opacity(0.11))

            VStack(alignment: .leading, spacing: 6) {
                Text(approval.title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(DSBotStyle.chatInk)
                    .fixedSize(horizontal: false, vertical: true)
                if !summary.isEmpty {
                    Text(summary)
                        .font(.system(size: 15))
                        .lineSpacing(3)
                        .lineLimit(3)
                        .foregroundStyle(DSBotStyle.chatTertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.top, 14)

            HStack(spacing: 10) {
                Spacer(minLength: 0)
                Button(action: onRevise) {
                    Text(L10n.text("要求修改"))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(DSBotStyle.chatInk)
                        .padding(.horizontal, 20)
                        .frame(height: 44)
                        .overlay {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(DSBotStyle.chatDivider, lineWidth: 1)
                                .allowsHitTesting(false)
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isResponding)
                .accessibilityIdentifier("plan.revise")
                Button(action: onApprove) {
                    Text(L10n.text("同意执行"))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 22)
                        .frame(height: 44)
                        .background(DSBotStyle.chatInk, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isResponding)
                .accessibilityIdentifier("plan.approve")
            }
            .padding(14)
        }
        .opacity(isResponding ? 0.7 : 1)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(DSBotStyle.chatDivider, lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("plan.review")
    }
}

/// The whole plan as markdown, opened from "查看全文".
struct PlanFullSheet: View {
    let approval: Approval
    let onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(L10n.text("计划"))
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Color(white: 0.4))
                Spacer()
                Button(L10n.text("完成"), action: onClose)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(DSBotStyle.ink)
                    .accessibilityIdentifier("plan.full.close")
            }
            .padding(.horizontal, 28)
            .frame(height: 64)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(approval.title)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(DSBotStyle.chatInk)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail = approval.detail {
                        MessageMarkdown(text: detail)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.bottom, 32)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ComposerAttachmentSheet.background)
    }
}
