import SwiftUI
import UIKit

// 嘟嘟's conversation as a group chat (owner, 2026-11-10; `Core/GroupChat.swift`, the drawings: `.local/designs/group-chat-2026-11-10/`).
//
// A line of an issue is a bubble on the left with its agent's logo for the picture, its ID for the name and its title after the time for the signature; the owner's own @ line is a bubble on the
// right, as every message of theirs is; while an answer is on its way the issue has three dots. Pulling an agent's bubble to the right brings the circle with the reply arrow
// (measured from the owner's own recording, `swipe.png`); a long press brings the menu of the thread: 回复, 复制, 删除. The result of a scheduled task that 嘟嘟 did itself is 嘟嘟's own words, not a bubble
// (`GroupTaskLine`): nothing to answer, so its menu is 复制 and 删除.

/// Delivered after a quick sheet has closed, to the still-mounted assistant composer.
struct GroupReplyRequest: Identifiable {
    let id = UUID()
    let target: DraftTarget
    let issue: GroupIssue
}

/// What the thread of 嘟嘟's chat can do for its lines; set by the chat, read by the rows and by the long-press menu.
struct GroupChatContext {
    /// The owner chose to answer this issue: its @ goes into the box.
    var reply: (GroupIssue) -> Void
    /// Hide these lines (by the sequence number of their event).
    var hide: ([Double]) -> Void
    /// Open the issue's own conversation, one to one.
    var openIssue: (GroupIssue) -> Void
}

private struct GroupChatKey: EnvironmentKey {
    static let defaultValue: GroupChatContext? = nil
}

extension EnvironmentValues {
    /// Set only in 嘟嘟's own conversation: the thread there is a group chat, and a message has the menu of one.
    var groupChat: GroupChatContext? {
        get { self[GroupChatKey.self] }
        set { self[GroupChatKey.self] = newValue }
    }
}

private struct OpenIssueConversationKey: EnvironmentKey {
    static let defaultValue: (Int) -> Void = { _ in }
}

private struct OpenQuickPageKey: EnvironmentKey {
    static let defaultValue: (QuickCardKind) -> Void = { _ in }
}

extension EnvironmentValues {
    /// Opens the conversation of an issue, by its number, over 嘟嘟's chat: the back button there leads back to this chat (set by the root).
    var openIssueConversation: (Int) -> Void {
        get { self[OpenIssueConversationKey.self] }
        set { self[OpenIssueConversationKey.self] = newValue }
    }

    /// The three quick entries open the approved native bottom sheets; set by the root.
    var openQuickPage: (QuickCardKind) -> Void {
        get { self[OpenQuickPageKey.self] }
        set { self[OpenQuickPageKey.self] = newValue }
    }
}

// MARK: - Rows

struct GroupLineView: View {
    let row: CommandRow

    var body: some View {
        if let line = row.group {
            if row.isTyping {
                GroupTypingBubble(issue: line.issue)
                    .accessibilityIdentifier("chat.group.typing.\(row.commandId ?? row.id)")
            } else if line.kind == .at {
                GroupAtBubble(line: line, seq: row.seq)
                    .accessibilityIdentifier("chat.group.at.\(row.commandId ?? row.id)")
            } else if line.kind == .task {
                GroupTaskLine(line: line, seq: row.seq)
                    .accessibilityIdentifier("chat.group.task.\(row.commandId ?? row.id)")
            } else {
                GroupGuestBubble(line: line, seq: row.seq, isRunning: row.isRunning)
                    .accessibilityIdentifier("chat.group.reply.\(row.commandId ?? row.id)")
            }
        }
    }
}

/// The owner's @ line: their bubble with the issue's `@ID` in blue. No tick under it and no notice when it goes (owner, 2026-11-11: "不需要").
private struct GroupAtBubble: View {
    let line: GroupLine
    let seq: Double?

    private var text: AttributedString {
        var token = AttributedString("@\(line.issue.name)")
        token.foregroundColor = DuduStyle.blue
        var rest = AttributedString(" \(line.text ?? "")")
        rest.foregroundColor = DuduStyle.chatInk
        return token + rest
    }

    var body: some View {
        Text(text)
            .font(.system(size: 17))
            .lineSpacing(6)
            .textSelection(.disabled)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                DuduStyle.chatBubble,
                in: UnevenRoundedRectangle(topLeadingRadius: 24, bottomLeadingRadius: 24, bottomTrailingRadius: 4, topTrailingRadius: 24, style: .continuous)
            )
            .messageActions(
                text: "@\(line.issue.name) \(line.text ?? "")", isUser: true, seq: seq,
                reply: line.issue, seqs: seq.map { [$0] } ?? []
            )
            .containerRelativeFrame(.horizontal, alignment: .trailing) { width, _ in width * 0.82 }
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// The answer of an issue's agent: its logo, its ID, the time and its title; the bubble is white with a hairline edge, as a card is.
/// Only answers longer than 1,000 characters fold (owner, 2026-11-13). A larger version of the existing capsule expands them once.
/// Only the capsule opens it; tapping the words does nothing, and expansion issues no scroll command.
private struct GroupGuestBubble: View {
    let line: GroupLine
    let seq: Double?
    let isRunning: Bool
    @Environment(\.groupChat) private var group
    @State private var expanded = false

    /// Eight lines of the answer's 23pt line.
    private static let clampedHeight: CGFloat = 184
    private var text: String { line.text ?? "" }
    /// Stop counting at the threshold, including for very long answers. Swift characters keep Chinese and composed emoji intact.
    private var isLong: Bool { !text.dropFirst(1_000).isEmpty }
    private var isClosed: Bool { isLong && !expanded }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            avatar
            VStack(alignment: .leading, spacing: 4) {
                signature
                bubble
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .swipeToReply(enabled: group != nil, initialPull: Self.reviewPull(for: line)) { group?.reply(line.issue) }
    }

    private static func reviewPull(for line: GroupLine) -> CGFloat {
        #if DEBUG && targetEnvironment(simulator)
        let arguments = ProcessInfo.processInfo.arguments
        guard line.issue.ref == "DUD-9", let index = arguments.firstIndex(of: "-dudu-review-swipe-pull"), index + 1 < arguments.count,
              let points = Double(arguments[index + 1]) else { return 0 }
        return CGFloat(points)
        #else
        return 0
        #endif
    }

    @ViewBuilder
    private var avatar: some View {
        Button { group?.openIssue(line.issue) } label: {
            if let agent = line.issue.sessionAgent {
                AgentLogo(agent: agent, size: 26)
            } else {
                BoardNoAgentMark()
            }
        }
        .buttonStyle(.plain)
        .frame(width: 26, height: 26)
        .accessibilityLabel("\(line.issue.name)")
        .accessibilityHint(L10n.text("打开会话"))
        .accessibilityIdentifier("chat.group.avatar.\(line.issue.name)")
    }

    /// The ID is the name, then the time, then the title as the signature (owner, 2026-11-10: "签名放在时间的后面").
    private var signature: some View {
        HStack(spacing: 8) {
            Text(line.issue.name)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DuduStyle.chatSecondary)
                .lineLimit(1)
                .fixedSize()
            if let at = line.at {
                Text(TranscriptTitles.clock(at))
                    .font(.system(size: 12))
                    .foregroundStyle(DuduStyle.muted)
                    .fixedSize()
            }
            Text(line.issue.title)
                .font(.system(size: 13))
                .foregroundStyle(DuduStyle.muted)
                .lineLimit(1)
        }
        .frame(height: 26, alignment: .leading)
    }

    private func expand() {
        guard !expanded else { return }
        var transaction = Transaction(animation: nil)
        transaction.disablesAnimations = true
        withTransaction(transaction) { expanded = true }
        DuduLog.record("chat.group.fold", state: "expanded")
    }

    private var bubble: some View {
        let shape = UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 18, bottomTrailingRadius: 18, topTrailingRadius: 18, style: .continuous)
        return VStack(alignment: .leading, spacing: 0) {
            // The line's own sequence number is what lets a picture in the answer be fetched (`session.attachment` names the line that grants it); without it the pictures stay grey boxes marked 图片 (owner, 2026-11-11).
            MessageMarkdown(text: text, allowsTextSelection: false, sourceSequence: seq)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxHeight: isClosed ? Self.clampedHeight : nil, alignment: .top)
                .clipped()
                .overlay(alignment: .bottom) {
                    if isClosed {
                        // The fade is a band of the bubble's own white laid over the cut, not a `.mask`: a mask renders what it covers offscreen.
                        LinearGradient(colors: [Color.white.opacity(0), .white], startPoint: .top, endPoint: .bottom)
                            .frame(height: 76)
                            .allowsHitTesting(false)
                    }
                }
                .overlay(alignment: .bottom) {
                    if isClosed { FoldCapsule(action: expand).padding(.bottom, -2) }
                }
            if isRunning {
                // The run can still be using tools after its latest text; keep its dots outside the fold.
                GroupReplyDots()
                    .frame(height: 14)
                    .padding(.top, 8)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.white, in: shape)
        .overlay(shape.strokeBorder(Color.black.opacity(0.08), lineWidth: 0.75))
        .contentShape(shape)
        .messageActions(text: text, seq: seq, reply: line.issue, seqs: seq.map { [$0] } ?? [])
    }
}

/// The owner's existing white capsule, enlarged from 28pt to 36pt with 16pt text and a 52pt touch area (2026-11-13).
private struct FoldCapsule: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(L10n.text("展开"))
                .font(.system(size: 16))
                .foregroundStyle(DuduStyle.chatInk)
                .padding(.horizontal, 20)
                .frame(height: 36)
                .background(Color.white, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.black.opacity(0.08), lineWidth: 0.75))
                .shadow(color: .black.opacity(0.08), radius: 6, y: 2)
                .padding(8)
                .contentShape(Rectangle())
        }
        .buttonStyle(DuduQuietPressStyle())
        .accessibilityIdentifier("chat.group.fold")
    }
}

/// The result of a scheduled task that 嘟嘟 did itself (2026-11-11): 嘟嘟's own words, so there is no bubble and no picture. A small line over them says which task it was and when: a clock, the task's name and the
/// time (the drawing: `.local/designs/scheduled-tasks-fresh-session-2026-11-11/chat.png`); under it the text is drawn as 嘟嘟's messages are (`MessageMarkdown`, as a turn's answer). A run that failed says 运行失败
/// and the reason (`GroupLine.taskText`). It is no message of an issue, so there is nothing to answer: the long-press menu has 复制 and 删除, and a pull to the right does nothing.
private struct GroupTaskLine: View {
    let line: GroupLine
    let seq: Double?

    private var text: String { line.taskText }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            header
            if !text.isEmpty {
                MessageMarkdown(text: text, allowsTextSelection: false, sourceSequence: seq)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .messageActions(text: text, seq: seq, seqs: seq.map { [$0] } ?? [])
        .accessibilityElement(children: .contain)
    }

    /// The clock, the task's name (13pt semibold secondary, as the name over an issue's answer) and the time (12pt muted, as that one's time).
    private var header: some View {
        HStack(spacing: 6) {
            DuduIcon(.schedule, size: 13, scalesStroke: true)
                .foregroundStyle(DuduStyle.muted)
            HStack(spacing: 8) {
                Text(line.task?.title ?? "")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(DuduStyle.chatSecondary)
                    .lineLimit(1)
                if let at = line.at {
                    Text(TranscriptTitles.clock(at))
                        .font(.system(size: 12))
                        .foregroundStyle(DuduStyle.muted)
                        .fixedSize()
                }
            }
        }
        .frame(height: 20, alignment: .leading)
    }
}

/// The dots of an issue that has been written to and has not answered yet.
private struct GroupTypingBubble: View {
    let issue: GroupIssue

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Group {
                if let agent = issue.sessionAgent { AgentLogo(agent: agent, size: 26) } else { BoardNoAgentMark() }
            }
            .frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(issue.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DuduStyle.chatSecondary)
                        .fixedSize()
                    Text(issue.title)
                        .font(.system(size: 13))
                        .foregroundStyle(DuduStyle.muted)
                        .lineLimit(1)
                }
                .frame(height: 26, alignment: .leading)
                GroupReplyDots()
                .padding(.horizontal, 14)
                .frame(height: 34)
                .background(
                    Color.white,
                    in: UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 18, bottomTrailingRadius: 18, topTrailingRadius: 18, style: .continuous)
                )
                .overlay(
                    UnevenRoundedRectangle(topLeadingRadius: 4, bottomLeadingRadius: 18, bottomTrailingRadius: 18, topTrailingRadius: 18, style: .continuous)
                        .strokeBorder(Color.black.opacity(0.08), lineWidth: 0.75)
                )
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Shared by the empty waiting bubble and a reply whose run has not ended.
private struct GroupReplyDots: View {
    @State private var phase = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationIsCovered) private var covered
    @Environment(\.scenePhase) private var scenePhase

    private var animates: Bool { !reduceMotion && !covered && scenePhase == .active }

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(DuduStyle.muted)
                    .frame(width: 6, height: 6)
                    .opacity(animates ? (phase ? 1 : 0.35) : 0.7)
                    .animation(animates ? .easeInOut(duration: 0.6).repeatForever(autoreverses: true).delay(Double(index) * 0.2) : nil, value: phase)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onChange(of: animates, initial: true) { _, active in phase = active }
    }
}

// MARK: - Shared reply gesture and feedback

enum ReplySwipeDirection {
    case left, right

    var sign: CGFloat { self == .right ? 1 : -1 }
    var alignment: Alignment { self == .right ? .leading : .trailing }
}

extension View {
    /// Pulling a message to the right shows the circle with the reply arrow and, past the threshold, answers it: the owner's own recording of the thread of a chat app, measured frame by frame
    /// (`.local/designs/group-chat-2026-11-10/swipe.png`): the row follows the finger one to one up to 88pt; the circle is 32pt, centred where the picture of the row is, white with a hairline
    /// until 76pt and then flat grey, popping to 37pt and back with a ring that spreads to 63pt; on release the circle fades and the row is back in about 0.17 seconds, with no bounce.
    func swipeToReply(
        enabled: Bool = true, direction: ReplySwipeDirection = .right,
        initialPull: CGFloat = 0, onReply: @escaping () -> Void
    ) -> some View {
        modifier(SwipeToReply(enabled: enabled, direction: direction, initialPull: initialPull, onReply: onReply))
    }
}

private struct SwipeToReply: ViewModifier {
    let enabled: Bool
    let direction: ReplySwipeDirection
    var initialPull: CGFloat = 0
    let onReply: () -> Void
    @State private var pull: CGFloat = 0
    @State private var active = false
    @State private var pop = false
    @State private var ripple = false
    @State private var fading = false
    @State private var feedbackTask: Task<Void, Never>?

    private static let maxPull: CGFloat = 88
    private static let threshold: CGFloat = 76
    private static let circle: CGFloat = 32

    func body(content: Content) -> some View {
        content
            .offset(x: direction.sign * pull)
            .background(alignment: direction.alignment) { replyCircle }
            .gesture(ReplyPanGesture(enabled: enabled, direction: direction, onChanged: updatePull, onEnded: finishPull))
            .task {
                // `-dudu-review-swipe-pull 76` shows the row pulled that far (the simulator has no finger).
                guard initialPull > 0 else { return }
                pull = min(initialPull, Self.maxPull)
                active = pull >= Self.threshold
            }
            .onDisappear { finishPull(false) }
    }

    /// 0 at the start of the pull, 1 when the circle is all there (60pt).
    private var shown: CGFloat { min(1, max(0, (pull - 14) / 46)) }

    private var replyCircle: some View {
        ZStack {
            Circle()
                .strokeBorder(Color.black.opacity(0.12), lineWidth: 1)
                .frame(width: Self.circle, height: Self.circle)
                .scaleEffect(ripple ? 63.0 / 32 : 1)
                .opacity(active ? (ripple ? 0 : 0.5) : 0)
            Circle()
                .fill(active ? Color(white: 228.0 / 255) : .white)
                .overlay(Circle().strokeBorder(Color.black.opacity(active ? 0 : 0.08), lineWidth: 1))
                .frame(width: Self.circle, height: Self.circle)
                .scaleEffect(pop ? 37.0 / 32 : 1)
            DuduIcon(.reply, size: 18, scalesStroke: true)
                .foregroundStyle(Color(red: 0x59 / 255, green: 0x5e / 255, blue: 0x67 / 255))
        }
        .frame(width: Self.circle, height: Self.circle)
        // The picture of a row is 26 wide: the circle is centred on it.
        .offset(x: direction.sign * (-3 - (1 - shown) * 14), y: 0)
        .opacity(fading ? 0 : Double(shown))
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private func updatePull(_ distance: CGFloat) {
        fading = false
        var transaction = Transaction()
        transaction.animation = nil
        withTransaction(transaction) { pull = min(max(0, distance), Self.maxPull) }
        if pull >= Self.threshold, !active {
            active = true
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            withAnimation(.spring(response: 0.16, dampingFraction: 0.55)) { pop = true }
            feedbackTask?.cancel()
            feedbackTask = Task { @MainActor in
                do {
                    // The ripple spreads from the circle's own size after the circle has taken its grey.
                    try await Task.sleep(nanoseconds: 16_000_000)
                    guard active else { return }
                    withAnimation(.easeOut(duration: 0.15)) { ripple = true }
                    try await Task.sleep(nanoseconds: 80_000_000)
                    withAnimation(.spring(response: 0.2, dampingFraction: 0.8)) { pop = false }
                } catch {}
            }
        } else if pull < Self.threshold, active {
            feedbackTask?.cancel()
            active = false
            ripple = false
            pop = false
        }
    }

    private func finishPull(_ completed: Bool) {
        let answered = completed && active
        feedbackTask?.cancel()
        feedbackTask = nil
        withAnimation(.easeOut(duration: 0.1)) { fading = true }
        withAnimation(.spring(response: 0.2, dampingFraction: 1)) { pull = 0 }
        active = false
        ripple = false
        pop = false
        if answered { onReply() }
    }
}

/// Reject vertical movement and the direction opposite to this reply before recognition.
/// A tall expanded answer can fill the viewport; its reply recognizer must leave that whole area available to the history's native scroll.
private struct ReplyPanGesture: UIGestureRecognizerRepresentable {
    let enabled: Bool
    let direction: ReplySwipeDirection
    let onChanged: (CGFloat) -> Void
    let onEnded: (Bool) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator(direction: direction) }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.maximumNumberOfTouches = 1
        pan.delaysTouchesBegan = false
        pan.delaysTouchesEnded = false
        pan.delegate = context.coordinator
        pan.isEnabled = enabled
        return pan
    }

    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        context.coordinator.direction = direction
        recognizer.isEnabled = enabled
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        // Window coordinates do not move with the bubble's offset.
        let translation = pan.translation(in: nil)
        switch pan.state {
        case .began:
            context.coordinator.isTracking = true
            DuduLog.record("chat.reply.begin")
            onChanged(direction.sign * translation.x)
        case .changed:
            onChanged(direction.sign * translation.x)
        case .ended, .cancelled, .failed:
            guard context.coordinator.isTracking else { return }
            context.coordinator.isTracking = false
            let completed = pan.state == .ended
            DuduLog.record(
                "chat.reply.end", geometry: ["dragX": translation.x, "dragY": translation.y],
                state: completed ? "ended" : "cancelled"
            )
            if completed { onChanged(direction.sign * translation.x) }
            onEnded(completed)
        default:
            break
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var isTracking = false
        var direction: ReplySwipeDirection

        init(direction: ReplySwipeDirection) {
            self.direction = direction
            super.init()
        }

        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: nil)
            let accepted = direction.sign * velocity.x > abs(velocity.y) * 1.5
            if !accepted {
                DuduLog.record(
                    "chat.reply.reject", geometry: ["dragVelocityX": velocity.x, "dragVelocityY": velocity.y],
                    state: "direction"
                )
            }
            return accepted
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            // Code blocks and tables have their own horizontal scrolling. Let a touch starting inside them stay there.
            var current = touch.view
            while let view = current, view !== gestureRecognizer.view {
                if let scroll = view as? UIScrollView {
                    let width = scroll.bounds.width - scroll.adjustedContentInset.left - scroll.adjustedContentInset.right
                    if scroll.isScrollEnabled && scroll.contentSize.width > width + 1 { return false }
                }
                current = view.superview
            }
            return true
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool {
            otherGestureRecognizer.view is UIScrollView
        }
    }
}
