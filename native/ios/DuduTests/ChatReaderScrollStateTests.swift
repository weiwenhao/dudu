// Copied from OpenClaw, apps/shared/OpenClawKit/Tests/OpenClawKitTests/ChatReaderScrollStateTests.swift at d595ba38e95b272c2f5f62bbcdd617c3b8fc602a
// (MIT License, Copyright (c) 2026 OpenClaw Foundation: licenses/openclaw.txt).
// Changed for Dudu: only the tests of the rule taken (`chatReaderScrollReleasesFollow`).

import Foundation
import SwiftUI
import Testing
@testable import Dudu

struct ChatReaderScrollStateTests {
    @Test func `reader system navigation releases follow but keyboard animation does not`() {
        #expect(chatReaderScrollReleasesFollow(.interacting))
        #expect(chatReaderScrollReleasesFollow(.animating))
        #expect(!chatReaderScrollReleasesFollow(.animating, keyboardTransition: true))
        #expect(chatReaderScrollReleasesFollow(.interacting, keyboardTransition: true))
    }

    @Test func `idle, touch-down, and deceleration phases keep the follow target`() {
        #expect(!chatReaderScrollReleasesFollow(.idle))
        #expect(!chatReaderScrollReleasesFollow(.tracking))
        #expect(!chatReaderScrollReleasesFollow(.decelerating))
    }
}
