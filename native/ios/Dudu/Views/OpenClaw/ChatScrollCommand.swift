// Copied from OpenClaw, apps/shared/OpenClawKit/Sources/OpenClawChatUI/ChatScrollCommand.swift at d595ba38e95b272c2f5f62bbcdd617c3b8fc602a
// (MIT License, Copyright (c) 2026 OpenClaw Foundation: licenses/openclaw.txt).
// Changed for Dudu:
// - only `chatReaderScrollReleasesFollow`, `ScrollFollowTarget` and `ChatScrollFollowState` are taken; the rule of OpenClaw's jump button, the macOS anchor modifier, the jump slot and
//   the turn command are left out (Dudu's jump button keeps its own rule, `ChatScrollPosition.isAwayFromEnd`).
// - `ScrollFollowTarget.turn` takes our row id (`String`), and `.rowTop` is added.

import SwiftUI

/// Reader navigation releases following; keyboard avoidance alone keeps the live-edge pin.
func chatReaderScrollReleasesFollow(_ phase: ScrollPhase, keyboardTransition: Bool = false) -> Bool {
    switch phase {
    case .interacting:
        true
    case .animating:
        !keyboardTransition
    case .idle, .tracking, .decelerating:
        false
    @unknown default:
        false
    }
}

enum ScrollFollowTarget: Equatable {
    case latest
    case turn(String)
    /// Dudu: a row's top at the top of the viewport (`ChatReadingPolicy.layout`).
    case rowTop(String)
}

/// What the transcript follows. Held by reference and read only by the small views below, so
/// the start and end of a swipe do not re-evaluate the transcript and rebuild every row.
@MainActor
@Observable
final class ChatScrollFollowState {
    #if os(iOS)
    /// The iOS transcript's only offset writer. It owns the mode; reads here are not observed.
    @ObservationIgnored let readingPosition = ChatReadingPosition()
    var followTarget: ScrollFollowTarget? {
        get { self.readingPosition.mode }
        set { self.readingPosition.setMode(newValue) }
    }
    #else
    var followTarget: ScrollFollowTarget? = .latest
    #endif
    var isAtLiveEdge = true
    var isUserScrolling = false
    var hasNewerContentBelow = false
    #if os(iOS)
    var isKeyboardTransitioning = false
    #endif

    init() {
        #if os(iOS)
        self.readingPosition.follow = self
        #endif
    }
}

