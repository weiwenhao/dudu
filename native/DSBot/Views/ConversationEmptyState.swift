import SwiftUI

/// Dudu's logo and "探索未至之境". Shown while a conversation has nothing
/// in it yet, and on the new-task home before a workspace is chosen.
struct ConversationEmptyState: View {
    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            DuduLogo(size: 44)
            Text("探索未至之境")
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(DSBotStyle.chatInk)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 24)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("探索未至之境")
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
