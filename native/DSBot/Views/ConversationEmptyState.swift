import SwiftUI

/// DSH's hero: the whale, "探索未至之境" and the preview badge. Shown while a conversation has nothing
/// in it yet, and on the new-task home before a workspace is chosen.
struct ConversationEmptyState: View {
    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            DeepSeekWhale()
                .fill(DSBotStyle.blue)
                .frame(width: 34, height: 34 / DeepSeekWhale.aspectRatio)
            HStack(alignment: .top, spacing: 7) {
                Text("探索未至之境")
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(DSBotStyle.chatInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text("预览版")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .foregroundStyle(DSBotStyle.chatRunning)
                    .padding(.horizontal, 7)
                    .frame(height: 19)
                    .background(DSBotStyle.chatBubble, in: Capsule())
                    .overlay(Capsule().stroke(DSBotStyle.chatBorder, lineWidth: 0.5))
                    .padding(.top, 3)
            }
        }
        .padding(.horizontal, 24)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("探索未至之境 预览版")
        .accessibilityIdentifier("chat.empty")
    }
}

/// The spinner and its caption, centred where the history will be, while the conversation (or the first one
/// after connecting) is on its way.
struct ConversationLoadingState: View {
    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(DSBotStyle.muted)
            Text("正在连接…")
                .font(.system(size: 14))
                .foregroundStyle(DSBotStyle.muted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("正在连接")
        .accessibilityIdentifier("chat.loading")
    }
}
