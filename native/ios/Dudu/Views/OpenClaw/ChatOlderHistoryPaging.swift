// Copied from OpenClaw, apps/shared/OpenClawKit/Sources/OpenClawChatUI/ChatOlderHistoryPaging.swift at d595ba38e95b272c2f5f62bbcdd617c3b8fc602a
// (MIT License, Copyright (c) 2026 OpenClaw Foundation: licenses/openclaw.txt).
// Changed for Dudu:
// - the trigger asks `canLoad()` instead of OpenClaw's view model; loading itself is the chat's (`ChatView.loadEarlierHistory`, which calls `olderPageWillPrepend` just before the rows are published).
// - `ChatOlderHistoryReader.load` and the boundary row are left out: the history's first row (`.controls`) is ours.

#if os(iOS)
import SwiftUI

/// Reader-driven older history for the iOS transcript List (web `ui/src/pages/chat/chat-pane-history.ts:292-381`).
/// It only loads; `ChatReadingPosition` keeps the rows on screen still while the page is prepended.
@MainActor
final class ChatOlderHistoryReader {
    /// Web `CHAT_HISTORY_PREFETCH_EDGE_PX` (`chat-pane-shared.ts:128`).
    static let prefetchEdge: CGFloat = 1200

    private var lastTopDistance: CGFloat?

    /// True when the reader's own upward scroll moves within the prefetch edge. Layout-driven
    /// offset changes (prepends, keyboard, following) never count as intent.
    func observe(topDistance: CGFloat, readerScrolling: Bool) -> Bool {
        defer { self.lastTopDistance = topDistance }
        guard readerScrolling, let last = self.lastTopDistance else { return false }
        return topDistance < last && topDistance <= Self.prefetchEdge
    }

    func reset() {
        self.lastTopDistance = nil
    }
}

extension View {
    /// Requests the next older page after an upward reader scroll near the top of the transcript.
    func chatOlderHistoryTrigger(
        _ reader: ChatOlderHistoryReader,
        canLoad: @escaping @MainActor () -> Bool,
        scroll: ChatScrollFollowState,
        load: @escaping @MainActor () -> Void) -> some View
    {
        self.onScrollGeometryChange(for: CGFloat.self) { geometry in
            geometry.contentOffset.y + geometry.contentInsets.top
        } action: { _, topDistance in
            // A failed read stays manual until "Show earlier" succeeds (web `chat-pane-history.ts:332-337`).
            guard reader.observe(topDistance: topDistance, readerScrolling: scroll.isUserScrolling),
                  canLoad() else { return }
            load()
        }
    }
}
#endif
