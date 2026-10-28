import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ChatView: View {
    @ObservedObject var store: DSBotStore
    var isOverlayOpen = false
    var historyTopInset: CGFloat = 0

    @Environment(\.scenePhase) private var scenePhase
    @State private var speechCapture = NativeSpeechCapture()
    @State private var voicePress = VoicePressState()
    @State private var draft = ""
    @State private var draftRevision = 0
    @State private var previousDraftTarget: DraftTarget?
    @State private var preparedPhotos: [PreparedPhotoAttachment] = []
    @State private var sendingPhotoIDs: Set<String> = []
    @State private var compressedPhotoBytes = 0
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var isPhotoPickerPresented = false
    @State private var photoNotice: String?
    @State private var commandResult: DSBotToastMessage?
    @State private var photoLoadGeneration = 0
    @State private var followsLatestMessage = true
    @State private var awayFromLatest = false
    @State private var latestJump = 0
    @State private var historyFailure: String?
    @State private var isVoiceMode = false
    /// The open "+" sheet. The page rides along in the item so presentation and page cannot disagree.
    @State private var attachmentSheetRequest: AttachmentSheetRequest?
    @State private var pendingSheetAction: PendingSheetAction?
    @State private var isFileImporterPresented = false
    @State private var composerIntent = ComposerIntent.message
    @State private var isGoalWorking = false
    @State private var goalEditor: GoalEditorRequest?
    @State private var goalEditorError: String?
    @State private var isCompacting = false
    @State private var planPreview: Approval?
    @State private var preparedFiles: [UploadedFile] = []
    @State private var uploadingFileName: String?
    @State private var chromeHeight: CGFloat = 0
    @State private var taskOverlayHeight: CGFloat = 0
    @State private var goalOverlayHeight: CGFloat = 0
    @State private var queueOverlayHeight: CGFloat = 0
    @State private var queueEditor: QueuedMessage?
    @State private var contextPicker: ContextPicker?
    @State private var keyboardVisible = false
    @State private var composerFocused = false

    var body: some View {
        messageHistory
            .environment(\.conversationAccess, conversationAccess)
            .environment(\.conversationMarkdown, store.conversationMarkdown)
            .background(DSBotStyle.canvas)
            .coordinateSpace(name: "dsbot.chat")
            .sheet(item: $attachmentSheetRequest, onDismiss: handleAttachmentSheetDismiss) { request in
                attachmentSheet(for: request.page)
            }
            .sheet(item: $contextPicker) { picker in
                contextPickerSheet(picker)
            }
            .sheet(item: $planPreview) { approval in
                PlanFullSheet(approval: approval, onClose: { planPreview = nil })
                    .presentationDetents([.large])
                    .presentationDragIndicator(.hidden)
                    .presentationBackground(ComposerAttachmentSheet.background)
            }
            .sheet(item: $goalEditor) { request in
                GoalEditorSheet(
                    objective: request.objective,
                    isSaving: isGoalWorking,
                    error: goalEditorError,
                    onSave: { saveEditedGoal($0, request: request) },
                    onClose: { goalEditor = nil }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(DSBotStyle.canvas)
            }
            .sheet(item: $queueEditor) { message in
                QueuedMessageEditor(
                    message: message, isSaving: store.updatingQueueItemID != nil,
                    onSave: { updateQueue(message, action: "edit", text: $0) },
                    onCancel: { queueEditor = nil }
                )
                .presentationDetents([.medium, .large])
            }
            .onChange(of: store.queuedMessages) { _, messages in
                if let editing = queueEditor, !messages.contains(where: { $0.id == editing.id }) {
                    queueEditor = nil
                }
            }
            .fileImporter(
                isPresented: $isFileImporterPresented,
                allowedContentTypes: [.item],
                allowsMultipleSelection: false
            ) { result in
                handleFileImport(result)
            }
        .photosPicker(
            isPresented: $isPhotoPickerPresented,
            selection: $selectedPhotos,
            maxSelectionCount: max(1, PhotoAttachments.maximumPhotoCount - preparedPhotos.count),
            matching: .images
        )
        .overlay(alignment: .bottom) {
            VoiceCaptureLayer(capture: speechCapture, press: voicePress, isVoiceMode: isVoiceMode)
        }
        .overlay(alignment: .top) {
            ChatFeedbackOverlay(
                store: store, capture: speechCapture, commandResult: $commandResult, photoNotice: $photoNotice,
                onDismissVoiceNotice: cancelVoiceCapture
            )
            .padding(.horizontal, 24)
            .padding(.top, historyTopInset + 8)
            .opacity(isOverlayOpen ? 0 : 1)
            .accessibilityHidden(isOverlayOpen)
        }
        .onChange(of: isVoiceMode) { _, isOn in
            // Build the recognizer now, off the main thread, so the first press does not wait for it.
            if isOn { speechCapture.prepare() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
            trackKeyboard(note)
        }
        .onAppear {
            restoreDraft()
            #if DEBUG && targetEnvironment(simulator)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                applyReviewLaunchState()
            }
            #endif
            speechCapture.onRecognition = { text in
                sendVoiceTranscript(text, sessionID: voicePress.sessionID, computerID: voicePress.computerID)
            }
            speechCapture.onDraft = { text in
                preserveVoiceTranscriptAsDraft(text, sessionID: voicePress.sessionID, computerID: voicePress.computerID)
            }
        }
        .onChange(of: draftTarget) { _, _ in
            restoreDraft()
            followsLatestMessage = true
            awayFromLatest = false
            historyFailure = nil
        }
        .onDisappear {
            saveDraft()
            cancelVoiceCapture()
            speechCapture.onRecognition = nil
            speechCapture.onDraft = nil
        }
        .onChange(of: selectedPhotos) { _, items in
            guard !items.isEmpty else { return }
            DSBotLog.record("photos.select")
            photoLoadGeneration += 1
            let loadGeneration = photoLoadGeneration
            let sessionID = store.selectedSession?.id
            let computerID = store.activeComputer?.id
            let existingCount = preparedPhotos.count
            let existingBytes = compressedPhotoBytes
            Task {
                let result = await PhotoAttachments.load(
                    items,
                    existingCount: existingCount,
                    existingBytes: existingBytes
                )
                guard loadGeneration == photoLoadGeneration,
                      sessionID == store.selectedSession?.id,
                      computerID == store.activeComputer?.id else { return }
                preparedPhotos.append(contentsOf: result.photos)
                compressedPhotoBytes = result.totalBytes
                if result.rejectedCount > 0 {
                    photoNotice = "部分照片未添加"
                }
                selectedPhotos = []
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase != .active else { return }
            cancelVoiceCapture()
        }
        .onChange(of: store.selectedSession?.id) { _, _ in
            goalEditor = nil
            queueEditor = nil
            photoLoadGeneration += 1
            preparedPhotos = []
            preparedFiles = []
            uploadingFileName = nil
            composerIntent = .message
            sendingPhotoIDs = []
            compressedPhotoBytes = 0
            photoNotice = nil
            selectedPhotos = []
            composerFocused = false
            cancelVoiceCapture()
        }
        .onChange(of: store.activeComputer?.id) { _, _ in
            goalEditor = nil
            queueEditor = nil
            photoLoadGeneration += 1
            preparedPhotos = []
            preparedFiles = []
            uploadingFileName = nil
            sendingPhotoIDs = []
            compressedPhotoBytes = 0
            photoNotice = nil
            selectedPhotos = []
            composerFocused = false
            cancelVoiceCapture()
        }
        .onChange(of: composerFocused) { _, focused in
            DSBotLog.record(focused ? "keyboard.focus" : "keyboard.dismiss")
        }
        .onChange(of: store.goal?.id) { _, _ in
            goalEditor = nil
        }
        .onChange(of: isOverlayOpen) { _, isOpen in
            guard isOpen else { return }
            composerFocused = false
            cancelVoiceCapture()
        }
    }

    private var hasConversationContent: Bool {
        store.transcript != nil ? !store.transcriptRows.isEmpty : !store.messages.isEmpty
    }

    private var sessionApprovals: [Approval] {
        guard let sessionID = store.selectedSession?.id else { return [] }
        return store.approvals.filter { $0.sessionId == sessionID }
    }

    private var draftTarget: DraftTarget? {
        guard let computerID = store.activeComputer?.id,
              let sessionID = store.selectedSession?.id else { return nil }
        return DraftTarget(computerID: computerID, sessionID: sessionID)
    }

    private var conversationAccess: ConversationAccess? {
        guard let target = draftTarget else { return nil }
        return ConversationAccess(
            target: target, connected: store.status == .connected,
            request: { method, parameters in
                try await store.conversationRequest(method, parameters: parameters, target: target)
            },
            fork: { seq in try await store.forkConversation(at: seq, target: target) },
            loadImage: { attachment, target, fullSize in
                await store.conversationImage(attachment, target: target, fullSize: fullSize)
            }
        )
    }

    private var draftBinding: Binding<String> {
        Binding(
            get: { draft },
            set: { updateDraft($0) }
        )
    }

    private func updateDraft(_ value: String) {
        guard draft != value else { return }
        draft = value
        draftRevision &+= 1
        saveDraft()
    }

    private func restoreDraft() {
        guard previousDraftTarget != draftTarget else { return }
        if let previousDraftTarget {
            store.messageDrafts[previousDraftTarget] = draft.isEmpty ? nil : draft
        }
        previousDraftTarget = draftTarget
        draftRevision &+= 1
        updateDraft(draftTarget.flatMap { store.messageDrafts[$0] } ?? "")
    }

    private func saveDraft() {
        guard let previousDraftTarget else { return }
        store.messageDrafts[previousDraftTarget] = draft.isEmpty ? nil : draft
    }

    private var messageHistory: some View {
        let items = historyItems
        let target = draftTarget
        let canLoadAttachments = store.status == .connected && !store.isLoadingSession
        let emptyStateVisible = showsEmptyState
        let loadingStateVisible = showsLoadingState
        let access = conversationAccess
        return ZStack(alignment: .bottom) {
            ConversationHistoryView(
                items: items, target: target,
                topInset: historyTopInset + 7, bottomInset: chromeHeight + 11,
                canLoadAttachments: canLoadAttachments, keyboardVisible: keyboardVisible,
                isCovered: isOverlayOpen, followsLatest: $followsLatestMessage,
                awayFromLatest: $awayFromLatest, jumpToken: latestJump
            ) { item in
                historyContent(item, target: target, canLoadAttachments: canLoadAttachments)
                    .environment(\.conversationAccess, access)
                    .environment(\.conversationIsCovered, isOverlayOpen)
                    .tint(DSBotStyle.ink)
            }
            .id(target)
            bottomChrome()
        }
        .overlay {
            if emptyStateVisible {
                ConversationEmptyState()
                    .padding(.top, historyTopInset)
                    .padding(.bottom, chromeHeight)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            } else if loadingStateVisible {
                ConversationLoadingState()
                    .padding(.top, historyTopInset)
                    .padding(.bottom, chromeHeight)
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
    }

    private var historyItems: [ConversationHistoryItem] {
        guard hasConversationContent else { return [] }
        guard store.transcript != nil else { return store.messages.map(ConversationHistoryItem.message) }
        var items: [ConversationHistoryItem] = [
            .controls(
                hasEarlier: store.transcript?.hasMore == true,
                isLoading: store.historyLoadTarget == draftTarget && draftTarget != nil,
                failure: historyFailure
            )
        ]
        for row in store.transcriptRows {
            items.append(.transcript(row, store.transcriptTimeSeparators[row.id]))
            if case let .turn(turn) = row, turn.outcome == .running {
                items.append(.running(turnID: turn.id, startedAt: turn.startedAt))
            }
        }
        items += sessionApprovals.map { .approval($0, isResponding: store.isRespondingApprovals.contains($0.id)) }
        if draftTarget != nil {
            items += store.questions.map(ConversationHistoryItem.questions)
        }
        return items
    }

    @ViewBuilder
    private func historyContent(
        _ item: ConversationHistoryItem, target: DraftTarget?, canLoadAttachments: Bool
    ) -> some View {
        switch item {
        case let .transcript(row, timeSeparator):
            TranscriptRowView(
                row: row, timeSeparator: timeSeparator, attachmentTarget: target,
                canLoadAttachments: canLoadAttachments, showsRunningStatus: false
            ) { attachment, target, fullSize in
                await store.conversationImage(attachment, target: target, fullSize: fullSize)
            }
            .equatable()
        case let .running(_, startedAt):
            RunningStatusView(startedAt: startedAt)
                .padding(.top, 2)
        case let .message(message):
            ChatMessageRow(message: message).equatable()
        case let .controls(hasEarlier, isLoading, failure):
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    if hasEarlier, let target {
                        Button {
                            loadEarlierHistory(target: target)
                        } label: {
                            HStack(spacing: 6) {
                                if isLoading { ProgressView().controlSize(.small) }
                                else { Text("加载更早") }
                            }
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .disabled(isLoading || !canLoadAttachments)
                        .accessibilityIdentifier("chat.history.older")
                    }
                    Spacer()
                    ConversationPerformanceButton()
                }
                .font(.system(size: 13))
                .foregroundStyle(DSBotStyle.chatTertiary)
                if let failure { ConversationFailureView(message: failure) }
            }
        case let .approval(approval, isResponding):
            PlanReviewCard(
                approval: approval, isResponding: isResponding,
                onApprove: { respond(to: approval, allow: true) },
                onRevise: { revise(approval) }, onOpenFull: { planPreview = approval }
            )
        case let .questions(batch):
            if let target {
                ConversationQuestionsView(batch: batch, connected: canLoadAttachments) { answers in
                    try await store.answerQuestions(batch, answers: answers, target: target)
                }
            }
        }
    }

    private func loadEarlierHistory(target: DraftTarget) {
        guard store.historyLoadTarget != target else { return }
        followsLatestMessage = false
        historyFailure = nil
        Task { @MainActor in
            do {
                try await store.loadEarlierHistory(target: target)
            } catch {
                if draftTarget == target { historyFailure = error.localizedDescription }
            }
        }
    }

    @ViewBuilder
    private var approvalCards: some View {
        if let sessionID = store.selectedSession?.id {
            let approvals = store.approvals.filter { $0.sessionId == sessionID }
            if !approvals.isEmpty {
                ScrollView(.vertical, showsIndicators: false) {
                    LazyVStack(spacing: 8) {
                        ForEach(approvals) { approval in
                            approvalCard(approval)
                        }
                    }
                    .padding(.vertical, 2)
                }
                .frame(maxHeight: 156)
                .accessibilityElement(children: .contain)
            }
        }
    }

    private func approvalCard(_ approval: Approval) -> some View {
        let isResponding = store.isRespondingApprovals.contains(approval.id)
        return VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .top, spacing: 8) {
                Text(approval.title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(DSBotStyle.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if isResponding { ProgressView().tint(DSBotStyle.muted) }
            }

            if let detail = approval.detail, !detail.isEmpty {
                DisclosureGroup {
                    Text(detail)
                        .font(.system(size: 12))
                        .foregroundStyle(DSBotStyle.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 4)
                } label: {
                    Text("查看详情")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(DSBotStyle.muted)
                }
            }

            HStack(spacing: 9) {
                Button(role: .destructive) {
                    respond(to: approval, allow: false)
                } label: {
                    Text("拒绝")
                        .font(.system(size: 13, weight: .medium))
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(DSBotStyle.sheet, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isResponding)

                Button {
                    respond(to: approval, allow: true)
                } label: {
                    Text("允许")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(DSBotStyle.blue, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isResponding)
            }
        }
        .padding(11)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(DSBotStyle.line, lineWidth: 1)
        }
    }

    /// "要求修改": decline the plan, then let the user say what to change.
    private func revise(_ approval: Approval) {
        guard !store.isRespondingApprovals.contains(approval.id) else { return }
        Task {
            await store.respondToApproval(approval, allow: false)
            composerIntent = .message
            composerFocused = true
        }
    }

    private func respond(to approval: Approval, allow: Bool) {
        guard !store.isRespondingApprovals.contains(approval.id) else { return }
        Task { await store.respondToApproval(approval, allow: allow) }
    }

    // MARK: Bottom chrome

    /// Everything that floats above the history: the jump-to-latest button, approvals,
    /// photo chips and the glass composer. The history scrolls beneath it behind a progressive blur.
    private func bottomChrome() -> some View {
        let gap = composerFocused ? DSBotLayout.composerKeyboardGap : DSBotLayout.composerBottomMargin
        return VStack(spacing: 8) {
            if store.transcript == nil { approvalCards }
            taskPanel
                .offset(y: -goalOverlayHeight - queueOverlayHeight)
                .animation(.easeOut(duration: 0.18), value: goalOverlayHeight)
            VStack(spacing: 8) {
                goalBanner
                    .offset(y: -queueOverlayHeight)
                queuedMessagesPanel
                contextChips
                composerCapsule
            }
            .background {
                if store.goal != nil || !store.queuedMessages.isEmpty {
                    DSBotPanelBackdrop()
                        .padding(.top, -goalOverlayHeight - queueOverlayHeight)
                        .animation(.easeOut(duration: 0.18), value: goalOverlayHeight)
                }
            }
        }
        .overlay(alignment: .top) {
            latestButton()
                .offset(y: -52 - taskOverlayHeight - goalOverlayHeight - queueOverlayHeight)
                .animation(.easeOut(duration: 0.18), value: taskOverlayHeight)
                .animation(.easeOut(duration: 0.18), value: goalOverlayHeight)
        }
        .padding(.horizontal, DSBotLayout.composerSideMargin)
        .padding(.top, 6)
        .padding(.bottom, gap)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
            if abs(chromeHeight - height) > 0.5 { chromeHeight = height }
        }
        .background(alignment: .bottom) {
            bottomEdge(height: DSBotLayout.composerHeight + gap + 8)
        }
    }

    /// The history blurs away at the bottom edge of the screen, and only there: a strip as tall as the
    /// composer and the gap under it, however much else (the jump button, notices, chips) stands above.
    private func bottomEdge(height: CGFloat) -> some View {
        ZStack(alignment: .bottom) {
            DSBotEdgeBlur(edge: .bottom, height: height, strength: 0.8)
            LinearGradient(
                colors: [DSBotStyle.canvas.opacity(0), DSBotStyle.canvas.opacity(0.55)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
        .frame(height: height, alignment: .bottom)
        .allowsHitTesting(false)
    }

    /// Stays mounted and only fades: inserting or removing a glass view in the middle of a scroll
    /// leaves its old frame composited behind. Shown to a reader who has scrolled well above the end,
    /// never to one the history is following.
    private func latestButton() -> some View {
        let shows = awayFromLatest && !followsLatestMessage
        return Button {
            DSBotLog.record("chat.latest")
            latestJump &+= 1
        } label: {
            DSBotIcon(.down, size: 20)
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(DSBotGlassButtonStyle())
        .opacity(shows ? 1 : 0)
        .scaleEffect(shows ? 1 : 0.85)
        .animation(.easeOut(duration: 0.2), value: shows)
        .allowsHitTesting(shows)
        .accessibilityLabel("回到最新消息")
        // While it is faded out the glass is still in the hierarchy; XCUITest finds it under another name.
        .accessibilityIdentifier(shows ? "chat.latest" : "chat.latest.faded")
        .accessibilityHidden(!shows)
    }

    /// DSH's task list for this conversation, when it has one.
    @ViewBuilder
    private var taskPanel: some View {
        if store.selectedSession != nil, !store.isChoosingWorkspace, !store.todos.isEmpty {
            TaskPanel(todos: store.todos) { taskOverlayHeight = $0 }
                .transition(.opacity)
        }
    }

    @ViewBuilder
    private var goalBanner: some View {
        if let goal = store.goal {
            GoalBanner(
                goal: goal,
                isWorking: isGoalWorking,
                onPauseResume: { runGoalCommand(goal.isPaused ? "resume" : "pause") },
                onEdit: { presentGoalEditor(goal) },
                onClear: { runGoalCommand("clear") },
                onOverlayHeightChange: { goalOverlayHeight = $0 }
            )
            .transition(.opacity)
        }
    }

    @ViewBuilder
    private var queuedMessagesPanel: some View {
        if !store.queuedMessages.isEmpty {
            QueuedMessagesPanel(
                messages: store.queuedMessages,
                isRunning: store.selectedSession?.status == "running",
                isConnected: store.status == .connected,
                busyItemID: store.updatingQueueItemID,
                onEdit: { composerFocused = false; queueEditor = $0 },
                onRemove: { updateQueue($0, action: "remove") },
                onSteer: { updateQueue($0, action: "steer") },
                onOverlayHeightChange: { queueOverlayHeight = $0 }
            )
        }
    }

    private func updateQueue(_ message: QueuedMessage, action: String, text: String? = nil) {
        let target = draftTarget
        Task {
            do {
                try await store.updateQueuedMessage(message, action: action, text: text)
                guard target == draftTarget else { return }
                if action == "edit" { queueEditor = nil }
            } catch {
                guard target == draftTarget else { return }
                let failure = action == "edit" ? "编辑失败：这条消息可能已经开始发送。"
                    : action == "remove" ? "删除失败：这条消息可能已经开始发送。" : "插话发送失败，请重试。"
                commandResult = DSBotToastMessage(text: failure, kind: .error)
            }
        }
    }

    // MARK: Empty conversation and keyboard

    /// A conversation with nothing in it yet (and the new-task home) shows DSH's hero instead of a blank page.
    private var showsEmptyState: Bool {
        if store.isChoosingWorkspace { return true }
        return !store.isRestoring && !hasConversationContent && sessionApprovals.isEmpty && !store.isLoadingSession
            && !(store.selectedSession == nil && store.isLoading)
    }

    /// Nothing to show yet because the conversation (or the first one, right after connecting) is on its way.
    private var showsLoadingState: Bool {
        !hasConversationContent && !store.isChoosingWorkspace
            && (store.isRestoring || store.isLoadingSession || (store.selectedSession == nil && store.isLoading))
    }

    private func trackKeyboard(_ note: Notification) {
        guard let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let visible = KeyboardAvoidance.isVisible(endFrameMinY: end.minY, screenHeight: DSBotLayout.screenHeight)
        if keyboardVisible != visible { keyboardVisible = visible }
    }

    // MARK: Project and mode above the composer

    @ViewBuilder
    private var contextChips: some View {
        // Project and mode are chosen once, on the new-task page. A conversation that has begun has them
        // fixed, so the row is gone.
        if store.isChoosingWorkspace || (store.selectedSession != nil && store.isBlankSession && hasContextChips) {
            // The row scrolls, with a soft fade at the edge, only when both names are long.
            ViewThatFits(in: .horizontal) {
                contextChipRow
                ScrollView(.horizontal, showsIndicators: false) { contextChipRow }
                    .mask(
                        LinearGradient(
                            stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.93),
                                    .init(color: .clear, location: 1)],
                            startPoint: .leading, endPoint: .trailing
                        )
                    )
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("context.chips")
        }
    }

    /// DSH's two hero selectors: the workspace and the working mode (标准模式, 极简模式 ...).
    private var contextChipRow: some View {
        HStack(spacing: 8) {
            if let project = store.currentWorkspaceName ?? (store.isChoosingWorkspace ? "选择工作区" : nil) {
                ContextChip(
                    glyph: .folder, title: project, showsChevron: !store.workspaces.isEmpty,
                    identifier: "context.project", maxTextWidth: 150
                ) {
                    composerFocused = false
                    contextPicker = .project
                }
            }
            if let preset = store.currentPreset {
                let canChange = (store.isChoosingWorkspace || store.isBlankSession) && store.presets.count > 1
                ContextChip(
                    glyph: .mode, title: preset.name, showsChevron: canChange,
                    identifier: "context.mode", maxTextWidth: 110
                ) {
                    if canChange {
                        composerFocused = false
                        contextPicker = .mode
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 2)
    }

    private var hasContextChips: Bool {
        store.currentWorkspaceName != nil || store.currentPreset != nil
    }

    @ViewBuilder
    private func contextPickerSheet(_ picker: ContextPicker) -> some View {
        switch picker {
        case .project:
            let rows = store.workspaces.map {
                ContextPickerSheet.Row(
                    id: $0.id, title: $0.name, subtitle: nil, isSelected: $0.id == store.selectedSession?.workspaceId
                )
            }
            ContextPickerSheet(
                title: "项目", footnote: nil, rows: rows, emptyText: "暂无已登记的项目",
                identifierPrefix: "context.project."
            ) { chooseProject($0) }
            .presentationDetents([.height(ContextPickerSheet.height(rows: rows.count, hasFootnote: false))])
            .presentationDragIndicator(.hidden)
            .presentationBackground(ComposerAttachmentSheet.background)
        case .mode:
            let rows = store.presets.map {
                ContextPickerSheet.Row(
                    id: $0.id, title: $0.name, subtitle: $0.description, isSelected: $0.id == store.currentPreset?.id
                )
            }
            ContextPickerSheet(
                title: "模式", footnote: "模式在会话开始前选择，之后不能更改。", rows: rows, emptyText: "暂无可选模式",
                identifierPrefix: "context.mode."
            ) { chooseMode($0) }
            .presentationDetents([.height(ContextPickerSheet.height(rows: rows.count, hasFootnote: true) + 40)])
            .presentationDragIndicator(.hidden)
            .presentationBackground(ComposerAttachmentSheet.background)
        }
    }

    private func chooseProject(_ workspaceId: String) {
        contextPicker = nil
        if store.isChoosingWorkspace {
            DSBotLog.record("context.project.select")
            Task { await store.startTask(in: workspaceId) }
            return
        }
        guard workspaceId != store.selectedSession?.workspaceId else { return }
        DSBotLog.record("context.project.select")
        // An empty conversation keeps its mode and is reused by the host when it can be.
        let blank = store.isBlankSession
        let session = store.selectedSession?.id
        let preset = blank ? store.selectedPresetId : nil
        Task { await store.createSession(workspaceId: workspaceId, agentPreset: preset, reusing: blank ? session : nil) }
    }

    private func chooseMode(_ presetId: String) {
        contextPicker = nil
        guard presetId != store.currentPreset?.id else { return }
        DSBotLog.record("context.mode.select")
        if store.isChoosingWorkspace {
            store.chooseDraftPreset(presetId)
        } else {
            Task { await store.configure(agentPreset: presetId) }
        }
    }

    // MARK: Composer


    private var hasAttachmentTiles: Bool {
        !preparedPhotos.isEmpty || !preparedFiles.isEmpty || uploadingFileName != nil
    }

    private var hasSendableContent: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !preparedPhotos.isEmpty
            || !preparedFiles.isEmpty
    }

    /// One glass capsule shared with the toolbar buttons: "+" on the left, the text field (or the
    /// hold-to-talk bar) in the middle and a single voice / keyboard / send control on the right.
    @ViewBuilder
    private var composerCapsule: some View {
        if store.isChoosingWorkspace {
            inertComposer
        } else {
            activeComposer
        }
    }

    /// Before a workspace is chosen DSH's composer is inert; tapping it asks for the workspace.
    private var inertComposer: some View {
        Button {
            composerFocused = false
            contextPicker = .project
        } label: {
            HStack(spacing: 0) {
                DSBotIcon(.plus, size: 24, strokeWidth: 1.5)
                    .foregroundStyle(DSBotStyle.ink.opacity(0.3))
                    .frame(width: DSBotLayout.composerHeight, height: DSBotLayout.composerHeight)
                Text("选择一个工作区开始")
                    .font(.system(size: 16))
                    .foregroundStyle(DSBotStyle.muted)
                Spacer(minLength: 0)
            }
            .frame(minHeight: DSBotLayout.composerHeight)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .dsbotGlass(in: Capsule())
        .overlay {
            Capsule()
                .strokeBorder(DSBotStyle.chatDivider, style: StrokeStyle(lineWidth: 1, dash: [5, 4]))
                .allowsHitTesting(false)
        }
        .accessibilityLabel("选择一个工作区开始")
        .accessibilityIdentifier("composer.inert")
    }

    private var activeComposer: some View {
        VStack(spacing: 0) {
            if hasAttachmentTiles {
                ComposerAttachmentTiles(
                    photos: preparedPhotos,
                    files: preparedFiles,
                    uploadingFileName: uploadingFileName,
                    onRemovePhoto: { photo in
                        DSBotLog.record("photos.remove")
                        preparedPhotos.removeAll { $0.id == photo.id }
                        compressedPhotoBytes = max(0, compressedPhotoBytes - photo.compressedBytes)
                    },
                    onRemoveFile: { file in
                        DSBotLog.record("files.remove")
                        preparedFiles.removeAll { $0.id == file.id }
                    }
                )
                .transition(.opacity)
            }
            HStack(alignment: .bottom, spacing: 0) {
                plusButton
                if isVoiceMode {
                    holdToTalkBar
                } else {
                    textInput
                }
                trailingControl
            }
            .frame(minHeight: DSBotLayout.composerHeight)
        }
        .background {
            Color.clear
                .dsbotGlass(in: RoundedRectangle(
                    cornerRadius: hasAttachmentTiles ? 28 : DSBotLayout.composerHeight / 2, style: .continuous
                ))
                .allowsHitTesting(false)
        }
        .animation(.easeOut(duration: 0.18), value: hasAttachmentTiles)
        .modifier(VoiceComposerVisibility(capture: speechCapture, press: voicePress))
        .overlay(alignment: .bottom) {
            if isVoiceMode {
                // Keep the touch owner mounted and fully interactive while the visible composer fades.
                VoicePressSurface(
                    onBegan: beginVoicePress,
                    onMoved: moveVoicePress,
                    onEnded: endVoicePress,
                    onCancelled: cancelVoiceCapture
                )
                .frame(height: DSBotLayout.composerHeight)
                .padding(.horizontal, DSBotLayout.composerHeight)
            }
        }
    }

    private var plusButton: some View {
        Button {
            composerFocused = false
            DSBotLog.record("composer.plus")
            presentAttachmentSheet(.root)
        } label: {
            DSBotIcon(.plus, size: 24, strokeWidth: 1.5)
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: DSBotLayout.composerHeight, height: DSBotLayout.composerHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("添加")
        .accessibilityIdentifier("composer.plus")
    }

    private var placeholder: String {
        switch composerIntent {
        case .goal: return "输入目标，智能体将持续执行"
        case .message: return store.planMode ? "描述你的任务以生成计划" : "发消息"
        }
    }

    private var textInput: some View {
        // `.top`, not a baseline alignment: a vertical-axis TextField has no usable first baseline,
        // so the token and the placeholder drifted apart and stretched the capsule.
        HStack(alignment: .top, spacing: 6) {
            if case .goal = composerIntent {
                Button {
                    composerIntent = .message
                } label: {
                    Text("/目标")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(DSBotStyle.blue)
                        .padding(.vertical, 12.5)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("目标指令，点按取消")
                .accessibilityIdentifier("composer.goal.token")
            }
            ComposerTextView(text: draftBinding, isFocused: $composerFocused, placeholder: placeholder)
                .id(draftTarget)
        }
        .padding(.leading, 1)
        .frame(minHeight: DSBotLayout.composerHeight)
    }

    private var holdToTalkBar: some View {
        Text("按住说话")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(DSBotStyle.ink)
            .frame(maxWidth: .infinity, minHeight: DSBotLayout.composerHeight)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var trailingControl: some View {
        if !hasSendableContent,
           store.selectedSession?.status == "running" || store.isSending || isCompacting {
            Button {
                DSBotLog.record("session.stop")
                Task { await store.stopSession() }
            } label: {
                Group {
                    if store.isStoppingSession {
                        ProgressView().tint(DSBotStyle.ink)
                    } else {
                        RoundedRectangle(cornerRadius: 3).fill(DSBotStyle.ink).frame(width: 14, height: 14)
                    }
                }
                .frame(width: 34, height: 34)
                .background(DSBotStyle.composerAction, in: Circle())
                .frame(width: DSBotLayout.composerHeight, height: DSBotLayout.composerHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(store.isStoppingSession || store.status != .connected)
            .accessibilityLabel("停止任务")
            .accessibilityIdentifier("composer.stop")
        } else if isVoiceMode && !hasSendableContent {
            Button(action: showKeyboard) {
                DSBotKeyboardGlyph(size: 25)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: DSBotLayout.composerHeight, height: DSBotLayout.composerHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("切换到键盘")
            .accessibilityIdentifier("composer.keyboard")
        } else if hasSendableContent {
            Button(action: send) {
                Group {
                    if store.isSending {
                        ProgressView().tint(DSBotStyle.ink)
                    } else {
                        DSBotIcon(.send, size: 20)
                    }
                }
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: 34, height: 34)
                .background(DSBotStyle.composerAction, in: Circle())
                .overlay {
                    if isGoalWorking { ProgressView().tint(DSBotStyle.ink) }
                }
                .frame(width: DSBotLayout.composerHeight, height: DSBotLayout.composerHeight)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(store.isSending || isGoalWorking || store.selectedSession == nil || uploadingFileName != nil)
            .accessibilityLabel("发送")
            .accessibilityIdentifier("composer.send")
        } else {
            Button(action: showVoiceMode) {
                DSBotVoiceGlyph(size: 25)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: DSBotLayout.composerHeight, height: DSBotLayout.composerHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("语音输入")
            .accessibilityIdentifier("composer.voice")
        }
    }

    private func showVoiceMode() {
        DSBotLog.record("composer.voice.mode")
        composerIntent = .message
        composerFocused = false
        withAnimation(.easeOut(duration: 0.16)) { isVoiceMode = true }
    }

    private func showKeyboard() {
        DSBotLog.record("composer.keyboard.mode")
        withAnimation(.easeOut(duration: 0.16)) { isVoiceMode = false }
        DispatchQueue.main.async { composerFocused = true }
    }

    // MARK: Attachment sheet

    private func presentAttachmentSheet(_ page: ComposerAttachmentSheet.Page) {
        attachmentSheetRequest = AttachmentSheetRequest(page: page)
    }

    private func attachmentSheet(for page: ComposerAttachmentSheet.Page) -> some View {
        let rows = ComposerAttachmentSheet.commandRowCount(
            isTaskRunning: store.selectedSession?.status == "running",
            hasReasoningLevels: !store.currentEfforts.isEmpty
        )
        return ComposerAttachmentSheet(
            store: store,
            initialPage: page,
            canAddPhotos: preparedPhotos.count < PhotoAttachments.maximumPhotoCount,
            canAddFiles: preparedFiles.count < FileAttachments.maximumCount && uploadingFileName == nil,
            onAddPhotos: { dismissAttachmentSheet(then: .photos) },
            onAddFiles: { dismissAttachmentSheet(then: .files) },
            onGoal: { dismissAttachmentSheet(then: .goal) },
            onPlan: { dismissAttachmentSheet(then: .plan) },
            onCompact: { dismissAttachmentSheet(then: .compact) },
            onStopTask: { Task { await store.stopSession() } },
            onClose: { attachmentSheetRequest = nil }
        )
        .presentationDetents([.height(
            page == .modelSettings
                ? ComposerAttachmentSheet.Layout.height(modelRows: store.models.count, effortRows: store.currentEfforts.count)
                : ComposerAttachmentSheet.Layout.height(commandRows: rows)
        )])
        .presentationDragIndicator(.hidden)
        .presentationBackground(ComposerAttachmentSheet.background)
    }

    private func dismissAttachmentSheet(then action: PendingSheetAction) {
        pendingSheetAction = action
        attachmentSheetRequest = nil
    }

    /// Pickers and the goal sheet open only after the "+" sheet has finished dismissing.
    private func handleAttachmentSheetDismiss() {
        guard let action = pendingSheetAction else { return }
        pendingSheetAction = nil
        switch action {
        case .photos:
            guard preparedPhotos.count < PhotoAttachments.maximumPhotoCount else { return }
            DSBotLog.record("photos.open")
            isPhotoPickerPresented = true
        case .files:
            DSBotLog.record("files.open")
            isFileImporterPresented = true
        case .goal:
            DSBotLog.record("goal.open")
            enterGoalMode()
        case .plan:
            runPlanCommand(argument: store.planMode ? "off" : nil)
        case .compact:
            compactConversation()
        }
    }

    // MARK: DSH commands from the composer

    private func enterGoalMode() {
        if let goal = store.goal {
            presentGoalEditor(goal)
            return
        }
        voiceModeOff()
        composerIntent = .goal
        DispatchQueue.main.async { composerFocused = true }
    }

    private func presentGoalEditor(_ goal: SessionGoal) {
        guard let target = draftTarget, !isGoalWorking else { return }
        voiceModeOff()
        composerFocused = false
        goalEditorError = nil
        goalEditor = GoalEditorRequest(goalID: goal.id, objective: goal.objective, target: target)
    }

    private func saveEditedGoal(_ objective: String, request: GoalEditorRequest) {
        let text = objective.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isGoalWorking, draftTarget == request.target,
              goalEditor?.id == request.id, store.goal?.id == request.goalID else { return }
        isGoalWorking = true
        goalEditorError = nil
        Task {
            let argument = "edit \(text)"
            let outcome = await store.runCommand(.goal, argument: argument)
            isGoalWorking = false
            guard draftTarget == request.target, goalEditor?.id == request.id else { return }
            guard let outcome else {
                goalEditorError = store.error
                return
            }
            if outcome.isError {
                goalEditorError = CommandText.message(for: .goal, argument: argument, outcome: outcome)
            } else {
                goalEditor = nil
                reportCommand(.goal, argument: argument, outcome: outcome)
            }
        }
    }

    private func voiceModeOff() {
        if isVoiceMode { isVoiceMode = false }
    }

    private func runGoalCommand(_ argument: String) {
        guard !isGoalWorking else { return }
        isGoalWorking = true
        Task {
            let outcome = await store.runCommand(.goal, argument: argument)
            isGoalWorking = false
            reportCommand(.goal, argument: argument, outcome: outcome)
        }
    }

    private func runPlanCommand(argument: String?) {
        guard !store.isChangingPlanMode else { return }
        Task {
            let outcome = await store.runCommand(.plan, argument: argument)
            if outcome?.isError == true { reportCommand(.plan, argument: argument, outcome: outcome) }
        }
    }

    private func compactConversation() {
        guard store.selectedSession?.status != "running", !isCompacting else { return }
        isCompacting = true
        Task {
            let outcome = await store.runCommand(.compact)
            isCompacting = false
            // A transcript-capable desktop shows a real compaction as a chat row; "nothing to compact",
            // refusals and older desktops still need the notice.
            if let outcome, !outcome.isError, outcome.text.hasPrefix("Compacted "), store.transcript != nil { return }
            reportCommand(.compact, argument: nil, outcome: outcome)
        }
    }

    private func reportCommand(_ command: SessionCommand, argument: String?, outcome: CommandOutcome?) {
        guard let outcome else { return }
        let message = CommandText.message(for: command, argument: argument, outcome: outcome)
        if outcome.isError {
            store.error = message
        } else {
            commandResult = DSBotToastMessage(text: message, kind: .success)
        }
    }

    private func sendGoal() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isGoalWorking else { return }
        isGoalWorking = true
        Task {
            let argument = text
            let outcome = await store.runCommand(.goal, argument: argument)
            isGoalWorking = false
            guard let outcome else { return }
            reportCommand(.goal, argument: argument, outcome: outcome)
            if !outcome.isError {
                updateDraft("")
                composerIntent = .message
                composerFocused = false
            }
        }
    }

    private func handleFileImport(_ result: Result<[URL], Error>) {
        guard case let .success(urls) = result, let url = urls.first else { return }
        guard preparedFiles.count < FileAttachments.maximumCount else { return }
        let sessionID = store.selectedSession?.id
        let computerID = store.activeComputer?.id
        uploadingFileName = url.lastPathComponent
        Task {
            do {
                let picked = try await FileAttachments.load(url)
                let uploaded = try await store.uploadFile(name: picked.name, data: picked.data)
                guard sessionID == store.selectedSession?.id,
                      computerID == store.activeComputer?.id else { return }
                preparedFiles.append(uploaded)
                uploadingFileName = nil
            } catch let error as FileAttachments.LoadError {
                uploadingFileName = nil
                store.error = FileAttachments.message(for: error)
            } catch {
                // `store.uploadFile` already published a safe message.
                uploadingFileName = nil
            }
        }
    }

    // MARK: Hold to talk

    private func beginVoicePress(location: CGPoint, timestamp: TimeInterval) -> Bool {
        guard !voicePress.isActive,
              let sessionID = store.selectedSession?.id,
              let computerID = store.activeComputer?.id else { return false }
        DSBotLog.record("voice.press", elapsedMs: max(0, (ProcessInfo.processInfo.systemUptime - timestamp) * 1_000))
        voicePress.startedAt = timestamp
        voicePress.sessionID = sessionID
        voicePress.computerID = computerID
        voicePress.touch.location = location
        voicePress.isCancelling = false
        voicePress.isActive = true
        if composerFocused { composerFocused = false }
        Task {
            await Task.yield()
            guard voicePress.isActive, voicePress.startedAt == timestamp else { return }
            await speechCapture.begin()
            guard voicePress.startedAt == timestamp else { return }
            if !voicePress.isActive { cancelVoiceCapture() }
        }
        voicePress.timeoutTask?.cancel()
        voicePress.timeoutTask = Task {
            try? await Task.sleep(nanoseconds: 60_000_000_000)
            guard !Task.isCancelled, voicePress.isActive else { return }
            voicePress.isActive = false
            if speechCapture.isRecording {
                DSBotLog.record("voice.timeout")
                speechCapture.finish()
            } else {
                cancelVoiceCapture()
            }
        }
        return true
    }

    private func moveVoicePress(location: CGPoint, translation: CGFloat) {
        voicePress.touch.location = location
        let cancelling = translation < -160
        if cancelling != voicePress.isCancelling { voicePress.isCancelling = cancelling }
    }

    private func endVoicePress() {
        voicePress.timeoutTask?.cancel()
        voicePress.timeoutTask = nil
        voicePress.isActive = false
        if voicePress.isCancelling {
            cancelVoiceCapture()
        } else if voicePress.sessionID == store.selectedSession?.id,
                  voicePress.computerID == store.activeComputer?.id,
                  speechCapture.isRecording {
            DSBotLog.record("voice.release")
            speechCapture.finish()
        } else {
            cancelVoiceCapture()
        }
    }

    private func send() {
        if case .goal = composerIntent {
            sendGoal()
            return
        }
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let attachments = preparedPhotos.map(\.attachment)
        guard let sessionID = store.selectedSession?.id,
              let computerID = store.activeComputer?.id,
              !text.isEmpty || !attachments.isEmpty || !preparedFiles.isEmpty,
              !store.isSending else { return }

        DSBotLog.record("message.send")
        let submittedDraftRevision = draftRevision
        let sentPhotoIDs = Set(preparedPhotos.map(\.id))
        let files = preparedFiles
        let sentFileIDs = Set(files.map(\.id))
        sendingPhotoIDs.formUnion(sentPhotoIDs)
        Task {
            do {
                try await store.send(text: text, attachments: attachments, files: files)
                sendingPhotoIDs.subtract(sentPhotoIDs)
                guard store.selectedSession?.id == sessionID,
                      store.activeComputer?.id == computerID else { return }
                if draftRevision == submittedDraftRevision {
                    updateDraft("")
                }
                preparedPhotos.removeAll { sentPhotoIDs.contains($0.id) }
                preparedFiles.removeAll { sentFileIDs.contains($0.id) }
                compressedPhotoBytes = preparedPhotos.reduce(0) { $0 + $1.compressedBytes }
                composerFocused = false
            } catch {
                sendingPhotoIDs.subtract(sentPhotoIDs)
                // DSBotStore exposes a safe, user-facing error in its published state.
            }
        }
    }

    private func sendVoiceTranscript(_ transcript: String, sessionID: String?, computerID: String?) {
        guard let sessionID,
              let computerID,
              store.selectedSession?.id == sessionID,
              store.activeComputer?.id == computerID,
              !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !store.isSending else {
            preserveVoiceTranscriptAsDraft(text, sessionID: sessionID, computerID: computerID)
            return
        }
        DSBotLog.record("voice.send")
        Task {
            guard store.selectedSession?.id == sessionID,
                  store.activeComputer?.id == computerID else { return }
            guard !store.isSending else {
                preserveVoiceTranscriptAsDraft(text, sessionID: sessionID, computerID: computerID)
                return
            }
            try? await store.send(text: text)
        }
    }

    private func preserveVoiceTranscriptAsDraft(
        _ transcript: String,
        sessionID: String?,
        computerID: String?
    ) {
        guard let sessionID,
              let computerID,
              store.selectedSession?.id == sessionID,
              store.activeComputer?.id == computerID else { return }
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let separator = draft.isEmpty || draft.hasSuffix("\n") ? "" : "\n"
        updateDraft(draft.isEmpty ? text : draft + separator + text)
        isVoiceMode = false
        composerFocused = false
        DSBotLog.record("voice.draft")
    }

    private func cancelVoiceCapture() {
        let hadPendingCapture = voicePress.isActive || voicePress.sessionID != nil || speechCapture.isRecording
        voicePress.timeoutTask?.cancel()
        voicePress.timeoutTask = nil
        voicePress.isActive = false
        voicePress.isCancelling = false
        voicePress.sessionID = nil
        voicePress.computerID = nil
        voicePress.startedAt = nil
        voicePress.touch.location = nil
        speechCapture.cancel()
        if hadPendingCapture {
            DSBotLog.record("voice.cancel")
        }
    }

    #if DEBUG && targetEnvironment(simulator)
    /// Launch arguments used by simulator reviews to open a composer state without UI scripting.
    private func applyReviewLaunchState() {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-dsbot-review-voice-mode") { isVoiceMode = true }
        if arguments.contains("-dsbot-review-attachment-sheet") { attachmentSheetRequest = AttachmentSheetRequest(page: .root) }
        if arguments.contains("-dsbot-review-goal-mode") { composerIntent = .goal }
        if arguments.contains("-dsbot-review-focus-composer") { composerFocused = true }
        if arguments.contains("-dsbot-review-model-chip") {
            attachmentSheetRequest = AttachmentSheetRequest(page: .modelSettings)
        }
        if arguments.contains("-dsbot-review-project-picker") { contextPicker = .project }
        if arguments.contains("-dsbot-review-mode-picker") { contextPicker = .mode }
        if arguments.contains("-dsbot-review-typing-sheet-goal") {
            // Typing first, then "+" (which drops focus while the sheet rises), then 目标.
            composerFocused = true
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                composerFocused = false
                attachmentSheetRequest = AttachmentSheetRequest(page: .root)
                try? await Task.sleep(nanoseconds: 1_800_000_000)
                dismissAttachmentSheet(then: .goal)
            }
        }
        if arguments.contains("-dsbot-review-sheet-goal") {
            // The real flow: "+" sheet, tap 目标, sheet closes, composer takes focus.
            attachmentSheetRequest = AttachmentSheetRequest(page: .root)
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                dismissAttachmentSheet(then: .goal)
            }
        }
        if arguments.contains("-dsbot-review-photo-tiles") {
            func swatch(_ top: UIColor, _ bottom: UIColor) -> PreparedPhotoImage {
                let size = CGSize(width: 260, height: 260)
                let image = UIGraphicsImageRenderer(size: size).image { context in
                    let colors = [top.cgColor, bottom.cgColor] as CFArray
                    let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors, locations: [0, 1])!
                    context.cgContext.drawLinearGradient(
                        gradient, start: .zero, end: CGPoint(x: size.width, y: size.height), options: []
                    )
                }
                return PreparedPhotoImage(image: image)
            }
            preparedPhotos = [
                PreparedPhotoAttachment(
                    attachment: UploadAttachment(id: "review-photo-1", name: "photo-3EADA264.jpg", mimeType: "image/jpeg", dataBase64: ""),
                    compressedBytes: 1_000, thumbnailImage: swatch(.systemTeal, .systemIndigo)
                ),
                PreparedPhotoAttachment(
                    attachment: UploadAttachment(id: "review-photo-2", name: "photo-7B1F.jpg", mimeType: "image/jpeg", dataBase64: ""),
                    compressedBytes: 1_000, thumbnailImage: swatch(.systemOrange, .systemPink)
                )
            ]
        }
        if arguments.contains("-dsbot-review-file-chips") {
            preparedFiles = [
                UploadedFile(receiptId: "review-1", name: "季度报告.pdf", bytes: 2_411_000),
                UploadedFile(receiptId: "review-2", name: "data.csv", bytes: 18_200)
            ]
        }
        if arguments.contains("-dsbot-review-voice-press") || arguments.contains("-dsbot-review-voice-cancel") {
            isVoiceMode = true
            voicePress.isActive = true
            voicePress.isCancelling = arguments.contains("-dsbot-review-voice-cancel")
            voicePress.touch.location = CGPoint(x: 210, y: 843)
        }
    }
    #endif
}

private enum PendingSheetAction {
    case photos, files, goal, plan, compact
}


private struct AttachmentSheetRequest: Identifiable, Equatable {
    let id = UUID()
    let page: ComposerAttachmentSheet.Page
}

private enum ComposerIntent: Equatable {
    case message
    case goal
}

private struct GoalEditorRequest: Identifiable {
    let id = UUID()
    let goalID: String
    let objective: String
    let target: DraftTarget
}

private struct ChatMessageRow: View, Equatable {
    let message: ChatMessage
    @State private var isToolExpanded = false
    @State private var isReasoningExpanded = false

    static func == (lhs: ChatMessageRow, rhs: ChatMessageRow) -> Bool {
        lhs.message == rhs.message
    }

    var body: some View {
        HStack(alignment: .top) {
            if message.role == "user" { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 6) {
                if message.role == "notice" {
                    Text(message.text)
                        .font(.system(size: 12))
                        .foregroundStyle(DSBotStyle.muted)
                } else if message.role == "tool" {
                    Button {
                        isToolExpanded.toggle()
                    } label: {
                        HStack(spacing: 7) {
                            DSBotIcon(.terminal, size: 16, scalesStroke: true)
                            Text(message.toolName.flatMap { $0.isEmpty ? nil : $0 } ?? "工具输出")
                                .font(.system(size: 12, weight: .medium))
                                .lineLimit(1)
                            DSBotIcon(isToolExpanded ? .up : .down, size: 14, scalesStroke: true)
                        }
                        .foregroundStyle(DSBotStyle.muted)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isToolExpanded ? "收起工具输出" : "展开工具输出")
                    if isToolExpanded {
                        messageText(message.text)
                    }
                } else {
                    messageText(message.text)
                }

                if let process = message.process, !process.isEmpty {
                    DisclosureGroup(isExpanded: $isReasoningExpanded) {
                        messageText(process)
                            .padding(.top, 5)
                        if let reasoning = message.reasoning, !reasoning.isEmpty {
                            messageText(reasoning)
                                .padding(.top, 5)
                        }
                    } label: {
                        Text("处理过程")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DSBotStyle.muted)
                    }
                    .accessibilityIdentifier("chat.process.\(message.id)")
                } else if let reasoning = message.reasoning, !reasoning.isEmpty {
                    DisclosureGroup(isExpanded: $isReasoningExpanded) {
                        messageText(reasoning)
                            .padding(.top, 5)
                    } label: {
                        Text("思考过程")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DSBotStyle.muted)
                    }
                }
            }
            .padding(message.role == "user" ? 12 : 0)
            .background(
                message.role == "user"
                    ? Color(red: 237.0 / 255, green: 243.0 / 255, blue: 1)
                    : Color.clear,
                in: RoundedRectangle(cornerRadius: 17, style: .continuous)
            )
            if message.role != "user" { Spacer(minLength: 18) }
        }
        .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
        .accessibilityIdentifier("chat.message.\(message.id)")
    }

    @ViewBuilder
    private func messageText(_ value: String) -> some View {
        if message.status == "streaming" {
            Text(value)
                .font(.system(size: 16))
                .foregroundStyle(DSBotStyle.ink)
                .textSelection(.disabled)
                .fixedSize(horizontal: false, vertical: true)
                .messageActions(text: value, isUser: message.role == "user")
        } else {
            MessageMarkdown(text: value, allowsTextSelection: false)
                .messageActions(text: value, isUser: message.role == "user")
        }
    }
}
