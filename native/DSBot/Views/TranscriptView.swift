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
                    .foregroundStyle(DSBotStyle.chatTertiary)
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

    var body: some View {
        VStack(alignment: .trailing, spacing: 6) {
            ForEach(Array(row.attachments.enumerated()).filter { $0.element.kind == "image" }, id: \.offset) { index, attachment in
                ConversationImageThumbnail(
                    attachment: attachment, target: attachmentTarget, canLoadAttachment: canLoadAttachments,
                    identifier: "chat.image.\(row.id).\(index)", loadImage: loadAttachment
                )
                .messageActions(text: "", isUser: true, seq: row.seq)
            }
            if !row.text.isEmpty {
                Text(row.text)
                    .font(.system(size: 16))
                    .lineSpacing(3)
                    .foregroundStyle(DSBotStyle.chatInk)
                    .textSelection(.disabled)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(DSBotStyle.chatBubble, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .messageActions(text: row.text, isUser: true, seq: row.seq)
                    .containerRelativeFrame(.horizontal, alignment: .trailing) { width, _ in width * 0.82 }
            }
            if row.attachments.contains(where: { $0.kind != "image" }) {
                HStack(spacing: 6) {
                    ForEach(Array(row.attachments.enumerated()).filter { $0.element.kind != "image" }, id: \.offset) { _, attachment in
                        HStack(spacing: 5) {
                            DSBotIcon(attachment.kind == "image" ? .image : .attach, size: 13, scalesStroke: true)
                            Text(attachment.name).lineLimit(1).frame(maxWidth: 120)
                        }
                        .font(.system(size: 12))
                        .foregroundStyle(DSBotStyle.chatSecondary)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 5)
                        .background(DSBotStyle.chatPanel, in: Capsule())
                        .overlay(Capsule().stroke(DSBotStyle.chatDivider, lineWidth: 0.5))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("chat.message.\(row.id)")
    }
}

// MARK: - Turn

private struct TurnRowView: View {
    let row: TurnRow
    let showsRunningStatus: Bool
    @State private var processOpen = Self.startsOpen
    @AppStorage("conversation.performance.detailed") private var detailedPerformance = false

    private static var startsOpen: Bool {
        #if DEBUG && targetEnvironment(simulator)
        return ProcessInfo.processInfo.arguments.contains("-dsbot-review-process-open")
        #else
        return false
        #endif
    }

    private var showsHeader: Bool { row.summaryTitle != nil }
    private var bodyVisible: Bool { row.outcome == .running || row.staysOpen || processOpen }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if row.hasProcess {
                VStack(alignment: .leading, spacing: 10) {
                    if let title = row.summaryTitle {
                        ProcessHeader(title: title, isOpen: bodyVisible, isEnabled: !row.staysOpen) {
                            withAnimation(.easeOut(duration: 0.18)) { processOpen.toggle() }
                        }
                    }
                    if bodyVisible {
                        processBody
                            .transition(.opacity)
                    }
                }
            }
            if let answer = row.answer {
                MessageMarkdown(text: answer, allowsTextSelection: false)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .messageActions(text: answer, seq: row.answerSeq)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("chat.message.\(row.answerID ?? row.id)")
            }
            ForEach(row.notices) { TurnNoticeView(notice: $0) }
            if row.changesSeq != nil || row.files.contains(where: { $0.kind == "presented" }) {
                TurnFilesView(files: row.files, changesSeq: row.changesSeq)
            }
            if detailedPerformance, row.outcome != .running, let turn = row.turn, let seq = row.performanceSeq {
                ConversationPerformanceButton(turn: turn, seq: seq)
            }
            if row.outcome == .running && showsRunningStatus {
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
                    ProcessGroupView(
                        group: group,
                        live: group.isRunning ? row.live : nil,
                        startsOpen: row.outcome != .running
                    )
                case let .reply(id, text):
                    if id.hasPrefix("live:") {
                        StreamingReplyText(text: text)
                            .messageActions(text: text, seq: row.messageSequences[id])
                    } else {
                        MessageMarkdown(text: text, allowsTextSelection: false)
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
                    DSBotIcon(.down, size: 14, scalesStroke: true)
                        .rotationEffect(.degrees(isOpen ? 180 : 0))
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(DSBotStyle.chatTertiary)
            .frame(height: 33, alignment: .center)
            .padding(.bottom, 8)
            .overlay(alignment: .bottom) {
                Rectangle().fill(DSBotStyle.chatDivider).frame(height: 0.5)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .accessibilityIdentifier("chat.process.header")
        .accessibilityValue(isOpen ? "已展开" : "已收起")
    }
}

private extension ActivityKind {
    var glyph: DSBotGlyph {
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

    private var glyph: DSBotGlyph { (group.isRunning ? live?.activity : nil)?.glyph ?? group.leadingKind.glyph }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { isOpen = !open }
            } label: {
                HStack(spacing: 6) {
                    ZStack {
                        DSBotIcon(glyph, size: 14, scalesStroke: true).opacity(open ? 0 : 1)
                        DSBotIcon(.down, size: 14, scalesStroke: true).rotationEffect(.degrees(180)).opacity(open ? 1 : 0)
                    }
                    .frame(width: 16, height: 16)
                    PulsingText(active: group.isRunning) {
                        Text(title).font(.system(size: 15)).lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(DSBotStyle.chatTertiary)
                .frame(minHeight: 24)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chat.process.group")
            .accessibilityValue(open ? "已展开" : "已收起")

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
                    DSBotIcon(.think, size: 14, scalesStroke: true)
                    Text("思考")
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
                .foregroundStyle(DSBotStyle.chatTertiary)
                .frame(minHeight: 24)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chat.process.thought")
            if expanded {
                Text(thought.text)
                    .font(.system(size: 14))
                    .lineSpacing(3)
                    .foregroundStyle(DSBotStyle.chatSecondary)
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
            DSBotIcon(ActivityKind(wire: call.activity).glyph, size: 14, scalesStroke: true)
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
        .foregroundStyle(isError ? DSBotStyle.chatError : DSBotStyle.chatTertiary)
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
            .fill(DSBotStyle.chatCaption)
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
        return ProcessInfo.processInfo.arguments.contains("-dsbot-review-compaction-open")
        #else
        return false
        #endif
    }

    private var isExpandable: Bool { row.detail != nil }

    var body: some View {
        if let detail = row.detail {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    withAnimation(.easeOut(duration: 0.18)) { open.toggle() }
                } label: {
                    header
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("chat.command.header")
                .accessibilityValue(open ? "已展开" : "已收起")
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
            DSBotIcon(row.isCompaction ? .compact : .terminal, size: 14, scalesStroke: true)
                .foregroundStyle(DSBotStyle.blue)
            Text(row.name)
                .font(.system(size: 15))
                .foregroundStyle(DSBotStyle.blue)
            if !row.summary.isEmpty {
                Separator()
                Text(row.summary)
                    .font(.system(size: 13))
                    .lineLimit(isExpandable ? 1 : 2)
                    .truncationMode(.tail)
                    .foregroundStyle(row.isError ? DSBotStyle.chatError : DSBotStyle.chatTertiary)
            }
            Spacer(minLength: 0)
            if isExpandable {
                DSBotIcon(.right, size: 14, scalesStroke: true)
                    .rotationEffect(.degrees(open ? 90 : 0))
            }
        }
        .foregroundStyle(DSBotStyle.chatTertiary)
        .frame(minHeight: 24)
        .opacity(row.isRunning ? 0.8 : 1)
        .contentShape(Rectangle())
    }
}

private struct TriggerRowView: View {
    let row: TriggerRow
    @State private var open = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { open.toggle() }
            } label: {
                HStack(spacing: 10) {
                    DSBotIcon(.goal, size: 16, scalesStroke: true)
                    Text(row.title)
                        .font(.system(size: 15))
                    Spacer(minLength: 8)
                    DSBotIcon(.down, size: 14, scalesStroke: true)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .foregroundStyle(DSBotStyle.chatTertiary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("chat.trigger.header")
            if open {
                VStack(alignment: .leading, spacing: 8) {
                    Text("这条通知触发了本轮回复。")
                        .font(.system(size: 12))
                        .foregroundStyle(DSBotStyle.chatSecondary)
                    if !row.text.isEmpty {
                        ScrollView {
                            Text(row.text)
                                .font(.system(size: 12))
                                .foregroundStyle(DSBotStyle.chatInk)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 240)
                    }
                }
                .padding(.leading, 42)
                .padding(.trailing, 16)
                .padding(.bottom, 12)
            }
        }
        .background(DSBotStyle.chatPanel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(DSBotStyle.chatBorder, lineWidth: 0.5))
        .accessibilityIdentifier("chat.trigger.\(row.id)")
    }
}

// MARK: - Running status

/// "深度求索中，用时 5分13秒 ···" with Dudu's logo, ticking once a second.
struct RunningStatusView: View {
    let startedAt: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(DSBotStyle.chatDivider).frame(height: 0.5)
            TimelineView(.periodic(from: .now, by: 1)) { timeline in
                let phase = timeline.date.timeIntervalSinceReferenceDate
                HStack(spacing: 6) {
                    DuduLogo(size: 18)
                        .opacity(0.7 + 0.3 * (0.5 + 0.5 * sin(phase * 2.4)))
                    Text(label(at: timeline.date))
                        .font(.system(size: 14))
                        .foregroundStyle(DSBotStyle.chatRunning)
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("深度求索中")
        .accessibilityIdentifier("chat.running")
    }

    private func label(at date: Date) -> String {
        guard let startedAt else { return "深度求索中 ···" }
        let elapsed = max(1_000, date.timeIntervalSince1970 * 1_000 - startedAt)
        return "深度求索中，用时 \(TranscriptTitles.duration(milliseconds: elapsed)) ···"
    }
}
