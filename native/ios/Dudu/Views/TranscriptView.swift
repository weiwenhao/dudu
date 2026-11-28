import SwiftUI

struct TranscriptRowView: View, Equatable {
    let row: TranscriptRow
    let timeSeparator: Double?
    let attachmentTarget: DraftTarget?
    let canLoadAttachments: Bool
    var showsRunningStatus = true
    let loadAttachment: (TranscriptAttachment, DraftTarget, Bool) async -> PreparedPhotoImage?

    static func == (left: Self, right: Self) -> Bool {
        left.row == right.row && left.timeSeparator == right.timeSeparator
            && left.attachmentTarget == right.attachmentTarget
            && left.canLoadAttachments == right.canLoadAttachments
            && left.showsRunningStatus == right.showsRunningStatus
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if let timeSeparator {
                Text(TranscriptTitles.clock(timeSeparator))
                    .font(.system(size: 13))
                    .foregroundStyle(DuduStyle.chatTertiary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 10)
                    .padding(.bottom, 4)
                    .accessibilityIdentifier("chat.timestamp.\(row.id)")
            }
            messageRow
        }
    }

    @ViewBuilder
    private var messageRow: some View {
        switch row {
        case let .user(user): UserBubbleRow(
            row: user, attachmentTarget: attachmentTarget, canLoadAttachments: canLoadAttachments,
            loadAttachment: loadAttachment
        )
        case let .turn(turn):
            TurnRowView(row: turn, showsRunningStatus: showsRunningStatus).id(attachmentTarget)
        case let .command(command): CommandRowView(row: command)
        case let .trigger(trigger): TriggerRowView(row: trigger)
        case let .status(startedAt): RunningStatusView(startedAt: startedAt)
        }
    }
}

// MARK: - User

private struct UserBubbleRow: View {
    let row: UserRow
    let attachmentTarget: DraftTarget?
    let canLoadAttachments: Bool
    let loadAttachment: (TranscriptAttachment, DraftTarget, Bool) async -> PreparedPhotoImage?

    /// Render one indicator on the final visible attachment when there is no text bubble.
    private var pendingAttachmentIndex: Int? {
        guard row.isPending, row.text.isEmpty else { return nil }
        return row.attachments.lastIndex { $0.kind != "image" && $0.kind != "video" }
            ?? row.attachments.lastIndex { $0.kind == "video" }
            ?? row.attachments.lastIndex { $0.kind == "image" }
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ForEach(Array(row.attachments.enumerated()).filter { $0.element.kind == "image" }, id: \.offset) { index, attachment in
                ConversationImageThumbnail(
                    attachment: attachment, target: attachmentTarget, canLoadAttachment: canLoadAttachments,
                    identifier: "chat.image.\(row.id).\(index)", loadImage: loadAttachment,
                    isPending: pendingAttachmentIndex == index
                )
                .messageActions(text: "", isUser: true, seq: row.seq)
            }
            ForEach(Array(row.attachments.enumerated()).filter { $0.element.kind == "video" }, id: \.offset) { index, attachment in
                ConversationVideoThumbnail(
                    attachment: attachment, target: attachmentTarget, canLoadAttachment: canLoadAttachments,
                    isPending: pendingAttachmentIndex == index
                )
                    .id(attachmentTarget)
            }
            if !row.text.isEmpty {
                UserMessageBubble(text: row.text, seq: row.seq, isPending: row.isPending)
            }
            if row.attachments.contains(where: { $0.kind != "image" && $0.kind != "video" }) {
                HStack(spacing: 6) {
                    ForEach(Array(row.attachments.enumerated()).filter { $0.element.kind != "image" && $0.element.kind != "video" }, id: \.offset) { _, attachment in
                        HStack(spacing: 5) {
                            DuduIcon(attachment.kind == "image" ? .image : .attach, size: 13, scalesStroke: true)
                            Text(attachment.name).lineLimit(1).frame(maxWidth: 120)
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(DuduStyle.chatSecondary)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(DuduStyle.chatPanel, in: Capsule())
                        .overlay(Capsule().stroke(DuduStyle.chatDivider, lineWidth: 0.5))
                    }
                }
                .modifier(MessagePendingIndicator(isPending: row.isPending && row.text.isEmpty))
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.message.\(row.id)")
    }
}

struct UserMessageBubble: View {
    let text: String
    var seq: Double?
    var isPending = false

    var body: some View {
        Text(text)
            .font(.system(size: 17))
            .lineSpacing(6)
            .foregroundStyle(DuduStyle.chatInk)
            .textSelection(.disabled)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                DuduStyle.chatBubble,
                in: UnevenRoundedRectangle(
                    topLeadingRadius: 24, bottomLeadingRadius: 24,
                    bottomTrailingRadius: 4, topTrailingRadius: 24, style: .continuous
                )
            )
            .modifier(MessagePendingIndicator(isPending: isPending))
            .messageActions(text: text, isUser: true, seq: seq)
            .containerRelativeFrame(.horizontal, alignment: .trailing) { width, _ in width * 0.82 }
    }
}

/// An overlay on the actual bubble or tile, before its outer trailing-alignment frame.
/// Changing admission state must not resize or reposition the message.
struct MessagePendingIndicator: ViewModifier {
    let isPending: Bool

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottomLeading) {
            if isPending {
                DuduLoadingRing(size: 15, color: DuduStyle.chatSending)
                    .offset(x: -25, y: -6)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }
}

// MARK: - Turn

private struct TurnRowView: View {
    let row: TurnRow
    let showsRunningStatus: Bool
    @State private var processOpen = Self.startsOpen

    private static var startsOpen: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("-dudu-review-process-open")
        #else
        return false
        #endif
    }

    private var showsHeader: Bool { row.summaryTitle != nil }
    /// What 删除 hides of 嘟嘟's turn: every message of it (the steps and the answer), so that no half of it is left in the thread.
    private var lineSequences: [Double] { Array(Set(Array(row.messageSequences.values) + (row.answerSeq.map { [$0] } ?? []))) }
    private var bodyVisible: Bool { !row.isLastFragment || row.outcome == .running || row.staysOpen || processOpen }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if row.hasProcess {
                VStack(alignment: .leading, spacing: 10) {
                    if let title = row.summaryTitle {
                        ProcessHeader(title: title, isOpen: bodyVisible, isEnabled: !row.staysOpen && row.hasFoldableProcess) {
                            withAnimation(.easeOut(duration: 0.18)) { processOpen.toggle() }
                        }
                    }
                    // Folding hides the thinking and tool groups only; the replies between them stay (DSH's default 「全部回复」).
                    if bodyVisible || row.hasReplies { processBody }
                }
            }
            if let answer = row.answer {
                MessageMarkdown(text: answer, allowsTextSelection: false, sourceSequence: row.answerSeq)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .messageActions(text: answer, seq: row.answerSeq, seqs: lineSequences)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("chat.message.\(row.answerID ?? row.id)")
            }
            ForEach(row.notices) { TurnNoticeView(notice: $0) }
            if row.changesSeq != nil || row.files.contains(where: { $0.kind == "presented" }) {
                TurnFilesView(files: row.files, changesSeq: row.changesSeq, changesSummary: row.changesSummary)
            }
            if row.isLastFragment && row.outcome == .running && showsRunningStatus {
                RunningStatusView(startedAt: row.startedAt)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.turn.\(row.id)")
    }

    private var processBody: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(row.segments) { segment in
                switch segment {
                case let .group(group):
                    if bodyVisible {
                        ProcessGroupView(
                            group: group,
                            live: group.isRunning ? row.live : nil,
                            startsOpen: row.isLastFragment && row.outcome != .running
                        )
                        .transition(.opacity)
                    }
                case let .reply(id, text):
                    let isLive = id.hasPrefix("live:")
                    if isLive && !row.liveTextComplete {
                        StreamingReplyText(text: text, id: id, sourceSequence: row.messageSequences[id])
                            .messageActions(text: text, seq: row.messageSequences[id])
                    } else {
                        // Text the host says is finished is a message already, though it has not recorded it yet (that can be minutes late): Markdown, not the plain streaming text.
                        // Its read receipt waits for what was drawn, as for the streaming text.
                        MessageMarkdown(text: text, allowsTextSelection: false, sourceSequence: row.messageSequences[id],
                                        waitsForSourceSequence: isLive)
                            .preference(key: RenderedLiveReplies.self, value: isLive ? [id: text] : [:])
                            .messageActions(text: text, seq: row.messageSequences[id])
                    }
                }
            }
        }
    }
}

private struct ProcessHeader: View {
    let title: String
    let isOpen: Bool
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 15))
                    .lineLimit(1)
                if isEnabled {
                    DuduIcon(.down, size: 14, scalesStroke: true)
                        .rotationEffect(.degrees(isOpen ? 180 : 0))
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(DuduStyle.chatTertiary)
            .frame(height: 33, alignment: .center)
            .padding(.bottom, 8)
            .overlay(alignment: .bottom) {
                Rectangle().fill(DuduStyle.chatDivider).frame(height: 0.5)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityIdentifier("chat.process.header")
        .accessibilityValue(isOpen ? L10n.text("已展开") : L10n.text("已收起"))
    }
}

private extension ActivityKind {
    var glyph: DuduGlyph {
        switch self {
        case .thinking: return .think
        case .read, .readImage, .webFetch: return .browse
        case .search: return .search
        case .edit, .write: return .compose
        case .commands: return .terminal
        case .code: return .code
        case .webSearch: return .globe
        case .subagents: return .model
        case .plan: return .plan
        case .questions: return .question
        case .tools: return .skills
        }
    }
}

private struct ProcessGroupView: View {
    let group: ProcessGroup
    let live: LiveStatus?
    let startsOpen: Bool
    @State private var isOpen: Bool?

    private var open: Bool { isOpen ?? startsOpen }

    private var title: String {
        guard group.isRunning, let live else { return group.title }
        let label = live.activity.runningTitle
        return live.detail.isEmpty ? label : "\(label) · \(live.detail)"
    }

    private var glyph: DuduGlyph { (group.isRunning ? live?.activity : nil)?.glyph ?? group.leadingKind.glyph }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { isOpen = !open }
            } label: {
                HStack(spacing: 6) {
                    ZStack {
                        DuduIcon(glyph, size: glyph == .think ? 16 : 14, scalesStroke: true).opacity(open ? 0 : 1)
                        DuduIcon(.down, size: 14, scalesStroke: true).rotationEffect(.degrees(180)).opacity(open ? 1 : 0)
                    }
                    .frame(width: 16, height: 16)
                    PulsingText(active: group.isRunning) {
                        Text(title).font(.system(size: 15)).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(DuduStyle.chatTertiary)
                .frame(minHeight: 24)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chat.process.group")
            .accessibilityValue(open ? L10n.text("已展开") : L10n.text("已收起"))

            if open {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(group.order) { member in
                        switch member {
                        case let .thought(id):
                            if let thought = group.thoughts.first(where: { $0.id == id }) {
                                ThoughtRow(thought: thought, isStreaming: group.isRunning && id.hasPrefix("live:"))
                            }
                        case let .call(id):
                            if let call = group.calls.first(where: { $0.id == id }) {
                                CallRow(call: call)
                            }
                        }
                    }
                }
                .padding(.leading, 2)
                .transition(.opacity)
            }
        }
    }
}

private struct ThoughtRow: View {
    let thought: ProcessThought
    let isStreaming: Bool
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    DuduIcon(.think, size: 16, scalesStroke: true)
                    Text(L10n.text("思考"))
                        .font(.system(size: 15))
                    if !expanded, !thought.summary.isEmpty {
                        Separator()
                        Text(thought.summary)
                            .font(.system(size: 13))
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(DuduStyle.chatTertiary)
                .frame(minHeight: 24)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chat.process.thought")
            if expanded {
                Text(thought.text)
                    .font(.system(size: 14))
                    .lineSpacing(3)
                    .foregroundStyle(DuduStyle.chatSecondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 22)
                    .padding(.vertical, 2)
            }
        }
    }
}

private struct CallRow: View {
    let call: TranscriptCall
    @State private var showingDetail = false
    @Environment(\.conversationAccess) private var access

    private var isError: Bool { call.status == "error" }
    private var isRunning: Bool { (call.status ?? "running") == "running" }

    var body: some View {
        Button { showingDetail = true } label: {
            label
        }
        .buttonStyle(.plain)
        .disabled(call.seq == nil || access?.connected != true)
        .sheet(isPresented: $showingDetail) { ConversationToolSheet(call: call) }
    }

    private var label: some View {
        HStack(spacing: 6) {
            DuduIcon(ActivityKind(wire: call.activity).glyph, size: 14, scalesStroke: true)
            Text(TranscriptTitles.rowTitle(forTool: call.name))
                .font(.system(size: 15))
            if !call.detail.isEmpty {
                Separator()
                Text(call.detail)
                    .font(.system(size: 13))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(isError ? DuduStyle.chatError : DuduStyle.chatTertiary)
        .opacity(isRunning ? 0.8 : 1)
        .frame(minHeight: 24)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("chat.process.call")
    }
}

private struct Separator: View {
    var body: some View {
        Circle()
            .fill(DuduStyle.chatCaption)
            .frame(width: 2, height: 2)
            .padding(.horizontal, 2)
    }
}

/// Soft pulse used while something is running, a cheap stand-in for DSH's text shimmer.
private struct PulsingText<Content: View>: View {
    let active: Bool
    @ViewBuilder var content: () -> Content
    @Environment(\.conversationIsCovered) private var isCovered

    var body: some View {
        if active && !isCovered {
            TimelineView(.animation(minimumInterval: 1.0 / 20)) { timeline in
                let phase = timeline.date.timeIntervalSinceReferenceDate
                content().opacity(0.68 + 0.32 * (0.5 + 0.5 * sin(phase * 3.2)))
            }
        } else {
            content()
        }
    }
}

// MARK: - Command and trigger rows

private struct CommandRowView: View {
    let row: CommandRow
    @State private var open = Self.startsOpen

    private static var startsOpen: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("-dudu-review-compaction-open")
        #else
        return false
        #endif
    }

    private var isExpandable: Bool { row.detail != nil }

    var body: some View {
        if row.group != nil {
            // A line of 嘟嘟's group chat: the owner's @ message to an issue, its answer, the dots while it is on its way.
            GroupLineView(row: row)
                .padding(.vertical, 2)
        } else if let card = row.card {
            // A card of 嘟嘟's chat (a quick button's), not a command line.
            QuickCardView(card: card, seq: row.seq)
                .padding(.vertical, 4)
                .accessibilityIdentifier("chat.command.\(row.id)")
        } else if let detail = row.detail {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    withAnimation(.easeOut(duration: 0.18)) { open.toggle() }
                } label: {
                    header
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("chat.command.header")
                .accessibilityValue(open ? L10n.text("已展开") : L10n.text("已收起"))
                if open {
                    // DSH renders the compaction summary as quiet Markdown, indented under the title.
                    MessageMarkdown(text: detail, compact: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 22)
                        .padding(.vertical, 4)
                        .transition(.opacity)
                        .accessibilityIdentifier("chat.command.detail")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("chat.command.\(row.id)")
        } else {
            header
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("chat.command.\(row.id)")
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            DuduIcon(row.isCompaction ? .compact : .terminal, size: 14, scalesStroke: true)
                .foregroundStyle(DuduStyle.blue)
            Text(row.name)
                .font(.system(size: 15))
                .foregroundStyle(DuduStyle.blue)
            if !row.summary.isEmpty {
                Separator()
                Text(row.summary)
                    .font(.system(size: 13))
                    .lineLimit(isExpandable ? 1 : 2)
                    .truncationMode(.tail)
                    .foregroundStyle(row.isError ? DuduStyle.chatError : DuduStyle.chatTertiary)
            }
            Spacer(minLength: 0)
            if isExpandable {
                DuduIcon(.right, size: 14, scalesStroke: true)
                    .rotationEffect(.degrees(open ? 90 : 0))
            }
        }
        .foregroundStyle(DuduStyle.chatTertiary)
        .frame(minHeight: 24)
        .opacity(row.isRunning ? 0.8 : 1)
        .contentShape(Rectangle())
    }
}

private struct TriggerRowView: View {
    let row: TriggerRow
    @State private var open = false

    private var canExpand: Bool {
        !row.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { open.toggle() }
            } label: {
                HStack(spacing: 10) {
                    DuduIcon(.goal, size: 16, scalesStroke: true)
                    Text(row.title)
                        .font(.system(size: 15))
                    Spacer(minLength: 8)
                    if canExpand {
                        DuduIcon(.down, size: 14, scalesStroke: true)
                            .rotationEffect(.degrees(open ? 180 : 0))
                    }
                }
                .foregroundStyle(DuduStyle.chatTertiary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!canExpand)
            .accessibilityIdentifier("chat.trigger.header")
            if open && canExpand {
                ScrollView {
                    Text(row.text)
                        .font(.system(size: 12))
                        .foregroundStyle(DuduStyle.chatInk)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: 240)
                .padding(.leading, 42)
                .padding(.trailing, 16)
                .padding(.bottom, 12)
            }
        }
        .background(DuduStyle.chatPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(DuduStyle.chatBorder, lineWidth: 0.5))
        .accessibilityIdentifier("chat.trigger.\(row.id)")
    }
}

// MARK: - Running status

/// "深度求索中，用时 5分13秒 ···" as DSH draws it (owner, 2026-11-23: 「鲸鱼尾巴会晃动，并且有一个光效。手机端也按照这个实现吧，图标也换成和 dsh 一样的鲸鱼尾巴」): DSH's whale tail,
/// which moves, and a highlight that sweeps over the words; the clock ticks once a second.
struct RunningStatusView: View {
    let startedAt: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(DuduStyle.chatDivider).frame(height: 0.5)
            TimelineView(.periodic(from: .now, by: 1)) { timeline in
                HStack(spacing: 6) {
                    WhaleTailMark(color: DuduStyle.chatRunning)
                    ShimmerText(text: label(at: timeline.date), color: DuduStyle.chatRunning, highlight: DuduStyle.chatRunningHighlight)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(L10n.text("深度求索中"))
        .accessibilityIdentifier("chat.running")
    }

    private func label(at date: Date) -> String {
        guard let startedAt else { return L10n.text("深度求索中 ···") }
        let elapsed = max(1_000, date.timeIntervalSince1970 * 1_000 - startedAt)
        return L10n.text("深度求索中，用时 {0} ···", "\(TranscriptTitles.duration(milliseconds: elapsed))")
    }
}

/// The frames of DSH's whale tail: 60 pictures in one strip (`WhaleTailStrip`, as high as one picture is wide), cut out of the animation DSH uses (28 × 28, 20 a second, 3 seconds for the round).
/// DSH shows it as a mask over the text colour, so only its transparency counts. The strip holds the pictures made four times as large (Lanczos, then the edge of the stroke made firm
/// again), because on a 3x screen the 28-pixel pictures were stretched by half again and looked soft (owner, 2026-11-23: 「有一些模糊」).
private enum WhaleTailFrames {
    static let secondsPerFrame = 0.05
    static let all: [CGImage] = {
        guard let strip = UIImage(named: "WhaleTailStrip")?.cgImage, strip.height > 0 else { return [] }
        let side = strip.height
        return (0..<strip.width / side).compactMap { strip.cropping(to: CGRect(x: $0 * side, y: 0, width: side, height: side)) }
    }()
}

/// DSH's whale tail in the colour of the words, 16 pt for the 14 pt words (DSH: 14 for 12). The frames run in a `UIImageView` (Core Animation turns them), not in a `TimelineView`: a view that
/// SwiftUI is asked to draw again 20 times a second sits in the last row of the scrolling history, and it was suspected of making the history jump when the owner dragged it to the bottom
/// (2026-11-23, build 155; the logs did not confirm it: the same jumps are in the logs from before). It stands still on the first frame when motion is reduced and while the conversation is covered.
private struct WhaleTailMark: View {
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationIsCovered) private var isCovered

    var body: some View {
        WhaleTailImage(color: UIColor(color), moving: !reduceMotion && !isCovered)
            .frame(width: 16, height: 16)
            .accessibilityHidden(true)
    }
}

private struct WhaleTailImage: UIViewRepresentable {
    let color: UIColor
    let moving: Bool
    @Environment(\.displayScale) private var displayScale

    /// The pictures are drawn once, 16 pt at the screen's scale and in the colour of the words: a `UIImageView` does not tint the pictures of an animation (they came out black, the colour of
    /// the strip), and a picture that is stretched on the screen is soft.
    private static var made: [String: [UIImage]] = [:]

    private static func pictures(color: UIColor, scale: CGFloat) -> [UIImage] {
        let key = "\(scale)-\(color.description)"
        if let kept = made[key] { return kept }
        let size = CGSize(width: 16, height: 16)
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        let rect = CGRect(origin: .zero, size: size)
        let pictures = WhaleTailFrames.all.map { frame in
            renderer.image { context in
                let canvas = context.cgContext
                canvas.interpolationQuality = .high
                UIImage(cgImage: frame, scale: 1, orientation: .up).draw(in: rect)
                canvas.setBlendMode(.sourceIn)
                color.setFill()
                canvas.fill(rect)
            }
        }
        made[key] = pictures
        return pictures
    }

    final class Coordinator { var key = "" }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UIImageView {
        let view = UIImageView()
        view.contentMode = .center
        view.isAccessibilityElement = false
        view.setContentCompressionResistancePriority(.required, for: .horizontal)
        return view
    }

    func updateUIView(_ view: UIImageView, context: Context) {
        let key = "\(displayScale)-\(color.description)"
        if context.coordinator.key != key {
            context.coordinator.key = key
            let pictures = Self.pictures(color: color, scale: displayScale)
            view.stopAnimating()
            view.animationImages = pictures
            view.animationDuration = Double(pictures.count) * WhaleTailFrames.secondsPerFrame
            view.image = pictures.first
        }
        if moving, view.animationImages?.isEmpty == false {
            if !view.isAnimating { view.startAnimating() }
        } else if view.isAnimating {
            view.stopAnimating()
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UIImageView, context: Context) -> CGSize? {
        CGSize(width: 16, height: 16)
    }
}

/// The words with DSH's highlight (its `TextShimmer`): a copy of the words in the highlight colour, seen through a soft band that crosses them from left to right in 1 s, rests for 0.5 s and
/// starts again; the first sweep begins 0.3 s after the line appears. The band moves by one repeating animation of its offset (one width to the left of the words to two widths to the right
/// in 1.5 s, the last third of it off the words), so that SwiftUI is not asked to draw the line again for every frame (see `WhaleTailMark`). Still when motion is reduced and while the
/// conversation is covered.
private struct ShimmerText: View {
    let text: String
    let color: Color
    let highlight: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.conversationIsCovered) private var isCovered
    @State private var phase = 0.0

    var body: some View {
        label(color)
            .overlay {
                if !reduceMotion && !isCovered {
                    label(highlight)
                        .mask { band }
                        .accessibilityHidden(true)
                        .task {
                            phase = 0
                            try? await Task.sleep(for: .milliseconds(300))
                            guard !Task.isCancelled else { return }
                            withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) { phase = 1 }
                        }
                }
            }
    }

    private func label(_ color: Color) -> some View {
        // DSH sets the words in tabular figures, so the clock does not shift the line every second.
        Text(text).font(.system(size: 14).monospacedDigit()).foregroundStyle(color)
    }

    /// CSS `linear-gradient(105deg, transparent 0%, black 40% 60%, transparent 100%)` over a box as wide as the words.
    private var band: some View {
        GeometryReader { proxy in
            let width = proxy.size.width, height = proxy.size.height
            let angle = 105.0 * Double.pi / 180
            let dx = sin(angle), dy = -cos(angle)
            let length = abs(width * dx) + abs(height * dy)
            LinearGradient(
                stops: [.init(color: .clear, location: 0), .init(color: .black, location: 0.4), .init(color: .black, location: 0.6), .init(color: .clear, location: 1)],
                startPoint: UnitPoint(x: (width / 2 - dx * length / 2) / width, y: (height / 2 - dy * length / 2) / height),
                endPoint: UnitPoint(x: (width / 2 + dx * length / 2) / width, y: (height / 2 + dy * length / 2) / height)
            )
            .frame(width: width, height: height)
            .offset(x: -width + phase * 3 * width)
        }
    }
}
