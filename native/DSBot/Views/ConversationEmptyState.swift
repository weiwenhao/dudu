import SwiftUI

/// Dudu's logo and "探索未至之境". Shown while a conversation has nothing
/// in it yet, and on the new-task home before a workspace is chosen.
struct ConversationEmptyState: View {
    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            DuduLogo(size: 44)
            Text(L10n.text("探索未至之境"))
                .font(.system(size: 26, weight: .medium))
                .foregroundStyle(DSBotStyle.chatInk)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 24)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.text("探索未至之境"))
        .accessibilityIdentifier("chat.empty")
    }
}

/// The approved loading state keeps only a spinner where the history will appear.
struct ConversationLoadingState: View {
    var body: some View {
        DSBotLoadingRing()
            .accessibilityLabel(L10n.text("正在连接"))
            .accessibilityIdentifier("chat.loading")
    }
}
