import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ChatView: View {
    @ObservedObject var store: DSBotStore
    var isOverlayOpen = false
    var historyTopInset: CGFloat = 0
    var isPageTransitioning = false
    var presentationRequest: UUID?
    var onPresentationLayout: (UUID, DraftTarget?) -> Bool = { _, _ in false }
    var replyRequest: GroupReplyRequest?

    @Environment(\.scenePhase) private var scenePhase
    @State private var speechCapture = NativeSpeechCapture()
    @State private var voicePress = VoicePressState()
    @State private var draft = ""
    @State private var previousDraftTarget: DraftTarget?
    @State private var preparedPhotos: [PreparedPhotoAttachment] = []
    @State private var failedAttachments: [DraftTarget: [SubmittedComposerAttachments]] = [:]
    @State private var compressedPhotoBytes = 0
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var isPhotoPickerPresented = false
    @State private var selectedVideo: PhotosPickerItem?
    @State private var isVideoPickerPresented = false
    @State private var photoNotice: String?
    @State private var commandResult: DSBotToastMessage?
    @State private var photoLoadGeneration = 0
    @State private var followsLatestMessage = true
    @State private var latestContentVisible = false
    @State private var readFrame = PagePresentationFrame()
    @State private var renderedLiveReplies: [String: String] = [:]
    @State private var awayFromLatest = false
    @State private var latestJump = 0
    /// The owner asked for a card (待办): while it is set, a card that ends the thread is shown from its top (`ConversationHistoryView.cardFromTop`).
    @State private var cardFromTop = false
    @State private var transitionHistory: HistoryPresentation?
    @State private var presentationFrame = PagePresentationFrame()
    @State private var historyFailure: String?
    @State private var historyRequestID: UUID?
    @State private var scrollGate = ScrollIdleGate()
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
    @State private var fileLoadID: UUID?
    @State private var fileLoadTask: Task<Void, Never>?
    @State private var chromeHeight: CGFloat = 0
    @State private var composerHeight: CGFloat = DSBotLayout.composerHeight
    @State private var taskOverlayHeight: CGFloat = 0
    @State private var goalOverlayHeight: CGFloat = 0
    @State private var queueOverlayHeight: CGFloat = 0
    @State private var queueEditor: QueuedMessage?
    @State private var queueEditorError: String?
    @State private var queueUpdate: QueueUpdate?
    @State private var contextPicker: ContextPicker?
    @State private var keyboardVisible = false
    @State private var composerFocused = false
    @StateObject private var assistantCompletion = AssistantCompletions()
    @State private var editorSelection: ComposerSelection?
    /// What 回复 put in the box and the title of the issue it is for: the title shows in grey after it for as long as nothing else is written.
    @State private var replyGhost: (draft: String, title: String)?
    @Environment(\.openIssueConversation) private var openIssueConversation
    @Environment(\.openQuickPage) private var openQuickPage

    private var presentedHistory: some View {
        messageHistory
            .environment(\.conversationAccess, conversationAccess)
            .environment(\.groupChat, groupChat)
            .environment(\.conversationMarkdown, transitionHistory?.markdown ?? store.conversationMarkdown)
            // The retained board and sidebar must stay covered during the keyboard's safe-area transition.
            .background(DSBotStyle.canvas.ignoresSafeArea(edges: .bottom))
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
                    message: message, isSaving: queueUpdate?.action == "edit",
                    error: queueEditorError,
                    onSave: { updateQueue(message, action: "edit", text: $0) },
                    onCancel: { queueEditor = nil }
                )
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
                .presentationBackground(DSBotStyle.canvas)
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
            isPresented: $isVideoPickerPresented,
            selection: $selectedVideo,
            matching: .videos,
            preferredItemEncoding: .current
        )
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
    }

    var body: some View {
        presentedHistory
        .onChange(of: isVoiceMode) { _, isOn in
            if isOn { assistantCompletion.close() }
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
            if transitionHistory?.target != draftTarget { transitionHistory = nil }
            assistantCompletion.reset()
            editorSelection = nil
            resetComposerAttachments()
            restoreDraft()
            if let target = draftTarget, let attachments = failedAttachments.removeValue(forKey: target) {
                for submitted in attachments.reversed() { restoreSubmittedAttachments(submitted) }
            }
            queueUpdate = nil
            queueEditorError = nil
            followsLatestMessage = true
            awayFromLatest = false
            cardFromTop = false
            historyFailure = nil
            historyRequestID = nil
        }
        .onChange(of: isPageTransitioning) { _, moving in
            // Keep the page's laid-out messages while it moves; the watch continues refreshing.
            if !moving {
                transitionHistory = nil
            } else if transitionHistory == nil {
                transitionHistory = currentHistoryPresentation
            }
        }
        .onDisappear {
            presentationFrame.cancel()
            readFrame.cancel()
            latestContentVisible = false
            assistantCompletion.close()
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
                compressedPhotoBytes = preparedPhotos.reduce(0) { $0 + $1.compressedBytes }
                if result.rejectedCount > 0 {
                    photoNotice = L10n.text("部分照片未添加")
                }
                selectedPhotos = []
            }
        }
        .onChange(of: selectedVideo) { _, item in
            guard let item else { return }
            selectedVideo = nil
            DSBotLog.record("videos.select")
            prepareFile(name: L10n.text("发送视频")) { try await VideoAttachments.load(item) }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase != .active else { return }
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
            assistantCompletion.close()
            composerFocused = false
            cancelVoiceCapture()
        }
        .onChange(of: visibleReadPosition, initial: true) { _, position in
            readFrame.cancel()
            guard let position, let target = draftTarget else { return }
            readFrame.afterLayout {
                guard visibleReadPosition == position, draftTarget == target else { return }
                Task { await store.acknowledgeVisibleConversation(position, target: target) }
            }
        }
        .onPreferenceChange(RenderedLiveReplies.self) { renderedLiveReplies = $0 }
        .onChange(of: replyRequest?.id) { _, _ in
            guard let replyRequest, replyRequest.target == draftTarget, !isOverlayOpen else { return }
            groupChat?.reply(replyRequest.issue)
        }
        #if DEBUG && targetEnvironment(simulator)
        // `-dsbot-review-tap-chip todo,task,info`: the simulator has no finger, so the review taps these quick buttons of 嘟嘟's chat one after the other (through the buttons' own handler).
        .task(id: store.isAssistantConversation) {
            let arguments = ProcessInfo.processInfo.arguments
            guard store.isAssistantConversation, let index = arguments.firstIndex(of: "-dsbot-review-tap-chip"), index + 1 < arguments.count else { return }
            for name in arguments[index + 1].split(separator: ",") {
                try? await Task.sleep(nanoseconds: 3_500_000_000)
                if let kind = QuickCardKind(rawValue: String(name)) { openQuickPage(kind) }
            }
        }
        // `-dsbot-review-reply DUD-9` (with `-dsbot-review-reply-title <title>`), `-dsbot-review-hide 101` and `-dsbot-review-tap-avatar DUD-9`: what 回复 in the menu, 删除 in the menu and a tap on an issue's picture do (the simulator has no finger).
        .task(id: store.isAssistantConversation) {
            let arguments = ProcessInfo.processInfo.arguments
            func value(_ flag: String) -> String? { arguments.firstIndex(of: flag).flatMap { $0 + 1 < arguments.count ? arguments[$0 + 1] : nil } }
            guard store.isAssistantConversation, let group = groupChat else { return }
            if let ref = value("-dsbot-review-reply") {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                group.reply(GroupIssue(id: 1, ref: ref, title: value("-dsbot-review-reply-title") ?? "", agent: nil))
            }
            if let seq = value("-dsbot-review-hide").flatMap(Double.init) {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                group.hide([seq])
            }
            if let ref = value("-dsbot-review-tap-avatar") {
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                group.openIssue(GroupIssue(id: 1, ref: ref, title: "", agent: nil))
            }
        }
        #endif
    }

    private var hasConversationContent: Bool {
        !store.displayedTranscriptRows.isEmpty || !store.messages.isEmpty
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
            target: target, connected: store.canReadConversation,
            request: { method, parameters in
                try await store.conversationRequest(method, parameters: parameters, target: target)
            },
            fork: { seq in try await store.forkConversation(at: seq, target: target) },
            loadImage: { attachment, target, fullSize in
                await store.conversationImage(attachment, target: target, fullSize: fullSize)
            },
            downloadVideo: { parameters in
                try await store.downloadConversationVideo(parameters, target: target)
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
        saveDraft()
    }

    private func restoreDraft() {
        guard previousDraftTarget != draftTarget else { return }
        if let previousDraftTarget {
            store.messageDrafts[previousDraftTarget] = draft.isEmpty ? nil : draft
        }
        previousDraftTarget = draftTarget
        updateDraft(draftTarget.flatMap { store.messageDrafts[$0] } ?? "")
    }

    private func saveDraft() {
        guard let previousDraftTarget else { return }
        store.messageDrafts[previousDraftTarget] = draft.isEmpty ? nil : draft
    }

    private func resetComposerAttachments() {
        goalEditor = nil
        queueEditor = nil
        photoLoadGeneration += 1
        fileLoadTask?.cancel()
        fileLoadTask = nil
        fileLoadID = nil
        preparedPhotos = []
        preparedFiles = []
        uploadingFileName = nil
        composerIntent = .message
        compressedPhotoBytes = 0
        photoNotice = nil
        selectedPhotos = []
        selectedVideo = nil
        isVideoPickerPresented = false
        composerFocused = false
        cancelVoiceCapture()
    }

    private func restoreSubmittedAttachments(_ submitted: SubmittedComposerAttachments) {
        let photoIDs = Set(preparedPhotos.map(\.id))
        let fileIDs = Set(preparedFiles.map(\.id))
        preparedPhotos.insert(contentsOf: submitted.photos.filter { !photoIDs.contains($0.id) }, at: 0)
        preparedFiles.insert(contentsOf: submitted.files.filter { !fileIDs.contains($0.id) }, at: 0)
        compressedPhotoBytes = preparedPhotos.reduce(0) { $0 + $1.compressedBytes }
    }

    private struct HistoryPresentation {
        let items: [ConversationHistoryItem]
        let target: DraftTarget?
        let canLoadAttachments: Bool
        let markdown: ConversationMarkdown
        let showsEmptyState: Bool
        let showsLoadingState: Bool
    }

    private var currentHistoryPresentation: HistoryPresentation {
        HistoryPresentation(
            items: historyItems, target: draftTarget, canLoadAttachments: store.canReadConversation,
            markdown: store.conversationMarkdown, showsEmptyState: showsEmptyState,
            showsLoadingState: showsLoadingState
        )
    }

    private struct PresentationLayout: Equatable {
        let request: UUID?
        let target: DraftTarget?
        let size: CGSize
    }

    private var messageHistory: some View {
        let presentation = transitionHistory ?? currentHistoryPresentation
        let items = presentation.items
        let target = presentation.target
        let canLoadAttachments = presentation.canLoadAttachments
        let emptyStateVisible = presentation.showsEmptyState
        let loadingStateVisible = presentation.showsLoadingState
        let access = conversationAccess
        return ZStack(alignment: .bottom) {
            ConversationHistoryView(
                items: items, target: target,
                topInset: historyTopInset + 7, bottomInset: chromeHeight + 11,
                canLoadAttachments: canLoadAttachments, keyboardVisible: keyboardVisible,
                isCovered: isOverlayOpen, isPreparingForPresentation: presentationRequest != nil,
                followsLatest: $followsLatestMessage,
                awayFromLatest: $awayFromLatest, jumpToken: latestJump, cardFromTop: $cardFromTop,
                onReachedStart: {
                    if let target { loadEarlierHistory(target: target) }
                },
                onLatestVisibilityChange: { latestContentVisible = $0 },
                scrollGate: scrollGate
            ) { item in
                historyContent(item, target: target, canLoadAttachments: canLoadAttachments)
                    .environment(\.conversationAccess, access)
                    .environment(\.conversationIsCovered, isOverlayOpen)
                    .tint(DSBotStyle.ink)
            }
            .transaction { transaction in
                if isPageTransitioning { transaction.animation = nil }
            }
            .id(target)
        }
        .modifier(DSBotScrollEdgeBar(edge: .bottom, underlapsBar: true, showsEffect: false) {
            if store.selectedSession?.subagent == nil {
                bottomChrome()
            } else {
                // Child histories retain DSH's parent address and are read-only on the phone.
                Color.clear.frame(height: 24)
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { chromeHeight = $0 }
            }
        })
        .overlay(alignment: .bottom) {
            // The jump button must not extend the native bottom edge into readable history.
            latestButton()
                .padding(.bottom, chromeHeight + 2 + taskOverlayHeight + goalOverlayHeight + queueOverlayHeight)
                .animation(.easeOut(duration: 0.18), value: taskOverlayHeight)
                .animation(.easeOut(duration: 0.18), value: goalOverlayHeight)
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
        .background {
            Color.clear
                .onGeometryChange(for: PresentationLayout.self) { geometry in
                    PresentationLayout(request: presentationRequest, target: target, size: geometry.size)
                } action: { layout in
                    presentationFrame.cancel()
                    guard let request = layout.request, layout.size.width > 0, layout.size.height > 0 else { return }
                    presentationFrame.afterLayout {
                        let prepared = currentHistoryPresentation
                        if onPresentationLayout(request, layout.target) { transitionHistory = prepared }
                    }
                }
                // Re-arm the layout notification even when reopening the same retained conversation.
                .id(presentationRequest)
        }
    }

    private var visibleReadPosition: SessionReadPosition? {
        guard scenePhase == .active, !isOverlayOpen, !isPageTransitioning, latestContentVisible,
              followsLatestMessage, store.canReadConversation else { return nil }
        guard var position = store.sessionReadPosition else { return nil }
        if position.stream != nil,
           store.transcript?.live.map({ renderedLiveReplies[$0.id] != $0.text }) ?? true {
            position.stream = nil
        }
        return position.seq >= 0 || position.stream != nil ? position : nil
    }

    private var historyItems: [ConversationHistoryItem] {
        guard hasConversationContent else { return [] }
        guard store.transcript != nil else {
            return store.messages.map(ConversationHistoryItem.message) +
                ConversationHistoryItem.transcriptItems(store.displayedTranscriptRows)
        }
        var items: [ConversationHistoryItem] = []
        let isLoadingHistory = historyRequestID != nil
            || (store.historyLoadTarget == draftTarget && draftTarget != nil)
        if isLoadingHistory || historyFailure != nil {
            items.append(.controls(isLoading: isLoadingHistory, failure: historyFailure))
        }
        var trailing: [ConversationHistoryItem] = sessionApprovals.map {
            .approval($0, isResponding: store.isRespondingApprovals.contains($0.id))
        }
        if draftTarget != nil {
            trailing += store.questions.map(ConversationHistoryItem.questions)
        }
        items += ConversationHistoryItem.transcriptItems(
            store.displayedTranscriptRows, timeSeparators: store.transcriptTimeSeparators, trailing: trailing
        )
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
        case let .controls(isLoading, failure):
            VStack(alignment: .leading, spacing: 14) {
                if isLoading {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity, minHeight: 28)
                        .accessibilityLabel(L10n.text("加载更早"))
                        .accessibilityIdentifier("chat.history.loading")
                }
                if let failure {
                    ConversationFailureView(message: failure) {
                        if let target { loadEarlierHistory(target: target) }
                    }
                }
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
        guard historyRequestID == nil, store.historyLoadTarget != target,
              store.transcript?.hasMore == true,
              store.status == .connected, !store.isLoadingSession else { return }
        let requestID = UUID()
        historyRequestID = requestID
        followsLatestMessage = false
        historyFailure = nil
        Task { @MainActor in
            defer { if historyRequestID == requestID { historyRequestID = nil } }
            do {
                try await store.loadEarlierHistory(
                    target: target, beforeApply: { await scrollGate.waitUntilIdle() },
                    willApply: { scrollGate.keepsReader = true }
                )
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
                    Text(L10n.text("查看详情"))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(DSBotStyle.muted)
                }
            }

            HStack(spacing: 9) {
                Button(role: .destructive) {
                    respond(to: approval, allow: false)
                } label: {
                    Text(L10n.text("拒绝"))
                        .font(.system(size: 13, weight: .medium))
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background(DSBotStyle.sheet, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isResponding)

                Button {
                    respond(to: approval, allow: true)
                } label: {
                    Text(L10n.text("允许"))
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

    /// Approvals, photo chips and the glass composer float above history.
    /// The bottom backdrop starts at the composer's own upper edge.
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
                if assistantCompletion.query != nil, !isVoiceMode, !isOverlayOpen {
                    AssistantSuggestions(completion: assistantCompletion, onSelect: chooseAssistantCompletion)
                }
                quickChips
                composerCapsule
                    .background(alignment: .top) {
                        if DSBotScrollEdges.usesSystemEffect {
                            DSBotComposerBackdrop(bottomGap: gap)
                        }
                    }
            }
            .background {
                if !DSBotScrollEdges.usesSystemEffect,
                   store.goal != nil || !store.displayedQueuedMessages.isEmpty {
                    DSBotPanelBackdrop()
                        .padding(.top, -goalOverlayHeight - queueOverlayHeight)
                        .animation(.easeOut(duration: 0.18), value: goalOverlayHeight)
                }
            }
        }
        .padding(.horizontal, DSBotLayout.composerSideMargin)
        .padding(.top, 6)
        .padding(.bottom, gap)
        .animation(.easeOut(duration: 0.18), value: showsQuickChips)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
            if abs(chromeHeight - height) > 0.5 { chromeHeight = height }
        }
        .background(alignment: .bottom) {
            if !DSBotScrollEdges.usesSystemEffect {
                bottomEdge(height: composerHeight + gap)
            }
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
            // Coming back from reading above is the end of the thread, also when a tall card ends it.
            cardFromTop = false
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
        .accessibilityLabel(L10n.text("回到最新消息"))
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
        if !store.displayedQueuedMessages.isEmpty {
            QueuedMessagesPanel(
                messages: store.displayedQueuedMessages,
                isRunning: store.selectedSession?.status == "running",
                isConnected: store.status == .connected,
                busyItemID: queueUpdate?.itemID ?? store.updatingQueueItemID,
                busyAction: queueUpdate?.action,
                onEdit: { composerFocused = false; queueEditorError = nil; queueEditor = $0 },
                onRemove: { updateQueue($0, action: "remove") },
                onSteer: { updateQueue($0, action: "steer") },
                onOverlayHeightChange: { queueOverlayHeight = $0 }
            )
        }
    }

    private func updateQueue(_ message: QueuedMessage, action: String, text: String? = nil) {
        guard queueUpdate == nil else { return }
        let target = draftTarget
        let update = QueueUpdate(itemID: message.id, action: action)
        queueUpdate = update
        queueEditorError = nil
        Task {
            defer { if queueUpdate?.id == update.id { queueUpdate = nil } }
            do {
                try await store.updateQueuedMessage(message, action: action, text: text)
                guard target == draftTarget else { return }
                if action == "edit" { queueEditor = nil }
            } catch {
                guard target == draftTarget else { return }
                let failure = action == "edit" ? L10n.text("编辑失败：这条消息可能已经开始发送。")
                    : action == "remove" ? L10n.text("删除失败：这条消息可能已经开始发送。") : L10n.text("插话发送失败，请重试。")
                if action == "edit", queueEditor?.id == message.id {
                    queueEditorError = failure
                } else {
                    commandResult = DSBotToastMessage(text: failure, kind: .error)
                }
            }
        }
    }

    private struct QueueUpdate {
        let id = UUID()
        let itemID: String
        let action: String
    }

    // MARK: Empty conversation and keyboard

    /// A conversation with nothing in it yet (and the new-task home) shows DSH's hero instead of a blank page.
    private var showsEmptyState: Bool {
        if store.isChoosingWorkspace { return true }
        return !store.isRestoring && !hasConversationContent && sessionApprovals.isEmpty && !store.isLoadingSession
            && store.status == .connected && !(store.selectedSession == nil && store.isLoading)
    }

    /// Nothing to show yet because the conversation (or the first one, right after connecting) is on its way.
    private var showsLoadingState: Bool {
        !hasConversationContent && !store.isChoosingWorkspace
            && (store.status != .connected || store.isRestoring || store.isLoadingSession
                || (store.selectedSession == nil && store.isLoading))
    }

    private func trackKeyboard(_ note: Notification) {
        guard let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        let visible = KeyboardAvoidance.isVisible(endFrameMinY: end.minY, screenHeight: DSBotLayout.screenHeight)
        if keyboardVisible != visible { keyboardVisible = visible }
    }

    // MARK: The thread of 嘟嘟's chat is a group chat

    /// What the lines of the thread can do (回复, 删除, a tap on a picture), only in 嘟嘟's own conversation. An answer puts the issue's @ in front of what is written, or in place of the one that starts it.
    private var groupChat: GroupChatContext? {
        guard store.isAssistantConversation else { return nil }
        return GroupChatContext(
            reply: { issue in
                let next = GroupChat.replyDraft(draftBinding.wrappedValue, to: issue)
                draftBinding.wrappedValue = next
                replyGhost = issue.title.isEmpty ? nil : (next, issue.title)
                // The caret goes behind the `@ID ` (the box keeps the old place of the caret when its text is set from outside: an empty box would leave it in front).
                editorSelection = ComposerSelection(range: NSRange(location: (next as NSString).length, length: 0))
                composerFocused = true
            },
            hide: { seqs in Task { await store.assistantHide(seqs) } },
            openIssue: { issue in if let id = issue.id { openIssueConversation(id) } }
        )
    }

    // MARK: Quick buttons of 嘟嘟's chat

    /// 待办、收件箱、任务 open their content in a native bottom sheet (owner, 2026-11-13). They stay while something is typed (the owner: "我一发消息，待办那个按钮就没了"),
    /// and give way to whatever else stands in their place (the owner: "排队时或者其他有占用这里的都隐藏吧"): a queued message, the goal bar, DSH's task list, an approval, a picture or file waiting in the box,
    /// the list of candidates, an upload, voice, or a goal command being written.
    private var showsQuickChips: Bool {
        store.isAssistantConversation && composerIntent == .message && !isVoiceMode && assistantCompletion.query == nil && !bottomChromeIsOccupied
    }

    private var bottomChromeIsOccupied: Bool {
        if !store.displayedQueuedMessages.isEmpty || store.goal != nil { return true }
        if store.selectedSession != nil, !store.isChoosingWorkspace, !store.todos.isEmpty { return true }
        if store.transcript == nil, let sessionID = store.selectedSession?.id, store.approvals.contains(where: { $0.sessionId == sessionID }) { return true }
        return !preparedPhotos.isEmpty || !preparedFiles.isEmpty || uploadingFileName != nil
    }

    @ViewBuilder
    private var quickChips: some View {
        if showsQuickChips {
            QuickChipsRow(onOpen: openQuickPage)
                .transition(.opacity)
        }
    }

    // MARK: Project and mode above the composer

    @ViewBuilder
    private var contextChips: some View {
        // Project and mode are chosen once, on the new-task page. A conversation that has begun has them
        // fixed, so the row is gone.
        if store.status == .connected,
           store.isChoosingWorkspace || (store.selectedSession != nil && store.isBlankSession && hasContextChips) {
            ViewThatFits(in: .horizontal) {
                contextChipRow(compactMode: false)
                    .fixedSize(horizontal: true, vertical: false)
                contextChipRow(compactMode: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 2)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("context.chips")
        }
    }

    private func contextChipRow(compactMode: Bool) -> some View {
        HStack(spacing: 8) {
            projectContextChip
            providerContextChip
                .layoutPriority(1)
            Spacer(minLength: 0)
            modeContextChip(iconOnly: compactMode)
                .fixedSize(horizontal: true, vertical: false)
        }
    }

    /// DSH's new-task selectors, in the existing native chip and sheet styles.
    @ViewBuilder
    private var projectContextChip: some View {
        if let project = store.currentWorkspaceName ?? (store.isChoosingWorkspace ? L10n.text("选择工作区") : nil) {
            ContextChip(
                glyph: store.currentWorkspaceName == nil ? .workspace : .workspaceOpen,
                title: project, showsChevron: !store.workspaces.isEmpty,
                identifier: "context.project", maxTextWidth: 150
            ) {
                composerFocused = false
                contextPicker = .project
            }
        }
    }

    @ViewBuilder
    private func modeContextChip(iconOnly: Bool) -> some View {
        if store.usesAgentPresets, let preset = store.currentPreset {
            let canChange = (store.isChoosingWorkspace || store.isBlankSession) && store.presets.count > 1
            ContextChip(
                glyph: .mode, title: preset.name, showsChevron: canChange,
                identifier: "context.mode", maxTextWidth: 110, iconOnly: iconOnly
            ) {
                if canChange {
                    composerFocused = false
                    contextPicker = .mode
                }
            }
        }
    }

    @ViewBuilder
    private var providerContextChip: some View {
        if let provider = store.currentProvider, store.providers.count > 1 {
            ContextChip(
                glyph: .model, title: provider.name, showsChevron: true,
                identifier: "context.provider", maxTextWidth: 90, agent: provider.agent
            ) {
                composerFocused = false
                contextPicker = .provider
            }
            .disabled(store.isChoosingProvider || store.isSending)
        }
    }

    private var hasContextChips: Bool {
        store.currentWorkspaceName != nil || (store.usesAgentPresets && store.currentPreset != nil) || store.currentProvider != nil
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
                title: L10n.text("项目"), rows: rows, emptyText: L10n.text("暂无已登记的项目"),
                identifierPrefix: "context.project."
            ) { chooseProject($0) }
            .presentationDetents([.height(ContextPickerSheet.height(rows: rows.count))])
            .presentationDragIndicator(.hidden)
            .presentationBackground(ComposerAttachmentSheet.background)
        case .mode:
            let rows = store.presets.map {
                ContextPickerSheet.Row(
                    id: $0.id, title: $0.name, subtitle: $0.description, isSelected: $0.id == store.currentPreset?.id
                )
            }
            ContextPickerSheet(
                title: L10n.text("模式"), rows: rows, emptyText: L10n.text("暂无可选模式"),
                identifierPrefix: "context.mode."
            ) { chooseMode($0) }
            .presentationDetents([.height(ContextPickerSheet.height(rows: rows.count))])
            .presentationDragIndicator(.hidden)
            .presentationBackground(ComposerAttachmentSheet.background)
        case .provider:
            let rows = store.providers.map {
                ContextPickerSheet.Row(
                    id: $0.id, title: $0.name, subtitle: nil, isSelected: $0.id == store.currentProvider?.id,
                    agent: $0.agent
                )
            }
            ContextPickerSheet(
                title: L10n.text("供应商"), rows: rows, emptyText: "", identifierPrefix: "context.provider."
            ) { id in
                contextPicker = nil
                Task { await store.chooseProvider(id) }
            }
            .presentationDetents([.height(ContextPickerSheet.height(rows: rows.count))])
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
        let preset = blank && store.usesAgentPresets ? store.selectedPresetId : nil
        let model = blank ? store.selectedModelId : nil
        Task { await store.createSession(workspaceId: workspaceId, agentPreset: preset, reusing: blank ? session : nil, modelId: model) }
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

    /// One glass capsule shared with the toolbar buttons. A running session keeps input-mode switching
    /// beside Send/Stop, so a primary action never prevents using the other input mode.
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
                Text(L10n.text("选择工作区"))
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
        .accessibilityLabel(L10n.text("选择工作区"))
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
            ComposerLayout(hasAttachments: hasAttachmentTiles, isVoiceMode: isVoiceMode) {
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
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height in
            if abs(composerHeight - height) > 0.5 { composerHeight = height }
        }
        .background {
            Color.clear
                .dsbotGlass(in: RoundedRectangle(
                    cornerRadius: DSBotLayout.composerCornerRadius, style: .continuous
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
                .padding(.leading, DSBotLayout.composerHeight)
                .padding(.trailing, trailingControlWidth)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("composer.container")
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
        .accessibilityLabel(L10n.text("添加"))
        .accessibilityIdentifier("composer.plus")
    }

    private var placeholder: String {
        switch composerIntent {
        case .goal: return L10n.text("输入目标，智能体将持续执行")
        case .message: return store.planMode ? L10n.text("描述你的任务以生成计划") : L10n.text("发消息")
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
                    Text(L10n.text("/目标"))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(DSBotStyle.blue)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.text("目标指令，点按取消"))
                .accessibilityIdentifier("composer.goal.token")
            }
            ComposerTextView(
                text: draftBinding, isFocused: $composerFocused, placeholder: placeholder,
                selectionRequest: editorSelection,
                highlights: store.isAssistantConversation ? AssistantCompletion.highlights(draft, skills: assistantCompletion.skills) : [],
                ghost: replyGhost.flatMap { $0.draft == draft ? $0.title : nil },
                completionActive: assistantCompletion.query != nil,
                onEditingChange: { edit in
                    guard store.isAssistantConversation else { return }
                    assistantCompletion.inspect(edit, store: store,
                                                enabled: !isVoiceMode && !isOverlayOpen && composerIntent == .message)
                },
                onCompletionKey: handleAssistantCompletionKey,
                onTapEditor: { assistantCompletion.reopen() }
            )
                .id(draftTarget)
        }
        .padding(.leading, 1)
        .padding(.vertical, 12.5)
        .frame(minHeight: DSBotLayout.composerHeight)
        .contentShape(Rectangle())
        .simultaneousGesture(TapGesture().onEnded { composerFocused = true })
    }

    private func chooseAssistantCompletion(_ item: AssistantCompletions.Candidate) {
        guard let (text, range) = assistantCompletion.choose(item, in: draft) else { return }
        updateDraft(text)
        editorSelection = ComposerSelection(range: range)
        composerFocused = true
    }

    private func handleAssistantCompletionKey(_ key: String) -> Bool {
        guard assistantCompletion.query != nil else { return false }
        if key == UIKeyCommand.inputEscape { assistantCompletion.close(); return true }
        let count = assistantCompletion.candidates.count
        if key == UIKeyCommand.inputUpArrow || key == UIKeyCommand.inputDownArrow {
            if count > 0 {
                assistantCompletion.selected = (assistantCompletion.selected + (key == UIKeyCommand.inputUpArrow ? -1 : 1) + count) % count
            }
            return true
        }
        if key == "choose" {
            if assistantCompletion.status == .loading { return true }
            if count > 0 {
                chooseAssistantCompletion(assistantCompletion.candidates[min(count - 1, assistantCompletion.selected)])
                return true
            }
        }
        return false
    }

    private var holdToTalkBar: some View {
        Text(L10n.text("按住说话"))
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(DSBotStyle.ink)
            .frame(maxWidth: .infinity, minHeight: DSBotLayout.composerHeight)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var isProcessingMessage: Bool {
        store.selectedSession?.status == "running" || store.isSending || isCompacting
    }

    private var showsInputModeToggle: Bool {
        isProcessingMessage || isVoiceMode || !hasSendableContent
    }

    private var trailingControlWidth: CGFloat {
        let controls = (showsInputModeToggle ? 1 : 0) + (hasSendableContent || isProcessingMessage ? 1 : 0)
        return CGFloat(controls) * DSBotLayout.composerHeight
    }

    private var trailingControl: some View {
        HStack(spacing: 0) {
            if showsInputModeToggle { inputModeToggle }
            primaryComposerAction
        }
        .frame(width: trailingControlWidth, height: DSBotLayout.composerHeight)
    }

    private var inputModeToggle: some View {
        Button(action: isVoiceMode ? showKeyboard : showVoiceMode) {
            Group {
                if isVoiceMode { DSBotKeyboardGlyph(size: 25) }
                else { DSBotVoiceGlyph(size: 25) }
            }
            .foregroundStyle(DSBotStyle.ink)
            .frame(width: DSBotLayout.composerHeight, height: DSBotLayout.composerHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isVoiceMode ? L10n.text("切换到键盘") : L10n.text("语音输入"))
        .accessibilityIdentifier(isVoiceMode ? "composer.keyboard" : "composer.voice")
    }

    @ViewBuilder
    private var primaryComposerAction: some View {
        if !hasSendableContent, isProcessingMessage {
            Button {
                DSBotLog.record("session.stop")
                Task { await store.stopSession() }
            } label: {
                Group {
                    if store.isStoppingSession || store.isSending {
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
            .disabled(store.isStoppingSession || store.isSending || store.status != .connected)
            .accessibilityLabel(L10n.text("停止任务"))
            .accessibilityIdentifier("composer.stop")
        } else if hasSendableContent {
            Button(action: send) {
                Group {
                    if store.isSending {
                        ProgressView().tint(DSBotStyle.ink)
                            .accessibilityIdentifier("composer.sending")
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
            .disabled(store.isSending || store.isChoosingProvider || isGoalWorking || store.selectedSession == nil || uploadingFileName != nil)
            .accessibilityLabel(L10n.text("发送"))
            .accessibilityIdentifier("composer.send")
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
            canAddVideos: preparedFiles.count < FileAttachments.maximumCount && uploadingFileName == nil,
            canAddFiles: preparedFiles.count < FileAttachments.maximumCount && uploadingFileName == nil,
            onAddPhotos: { dismissAttachmentSheet(then: .photos) },
            onAddVideos: { dismissAttachmentSheet(then: .videos) },
            onAddFiles: { dismissAttachmentSheet(then: .files) },
            onGoal: { dismissAttachmentSheet(then: .goal) },
            onPlan: { dismissAttachmentSheet(then: .plan) },
            onCompact: { dismissAttachmentSheet(then: .compact) },
            onStopTask: { Task { await store.stopSession() } },
            onClose: { attachmentSheetRequest = nil }
        )
        .presentationDetents([.height(
            page == .modelSettings
                ? ComposerAttachmentSheet.Layout.height(
                    modelRows: store.currentProviderModels.count, effortRows: store.currentEfforts.count,
                    modelGroups: store.currentModelGroups.count
                )
                : ComposerAttachmentSheet.Layout.height(commandRows: rows, primaryRows: store.isAssistantConversation ? 0 : 2)
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
        case .videos:
            guard preparedFiles.count < FileAttachments.maximumCount, uploadingFileName == nil else { return }
            DSBotLog.record("videos.open")
            isVideoPickerPresented = true
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
            let outcome = await store.runCommand(.goal, argument: argument) { message in
                guard draftTarget == request.target, goalEditor?.id == request.id else { return }
                goalEditorError = message
            }
            isGoalWorking = false
            guard draftTarget == request.target, goalEditor?.id == request.id else { return }
            guard let outcome else { return }
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
        prepareFile(name: url.lastPathComponent) { try await FileAttachments.load(url) }
    }

    /// Photos' videos and document files use the same authenticated upload and draft path.
    private func prepareFile(name: String, load: @escaping () async throws -> PickedFile) {
        guard let target = draftTarget, preparedFiles.count < FileAttachments.maximumCount,
              uploadingFileName == nil else { return }
        let request = UUID()
        fileLoadID = request
        uploadingFileName = name
        fileLoadTask = Task {
            defer {
                if fileLoadID == request {
                    uploadingFileName = nil
                    fileLoadID = nil
                    fileLoadTask = nil
                }
            }
            do {
                let picked = try await load()
                defer { Task { await FileAttachments.remove(picked) } }
                guard !Task.isCancelled, fileLoadID == request, draftTarget == target else { return }
                uploadingFileName = picked.name
                var uploaded = try await store.uploadFile(picked)
                if VideoPreviewStorage.isVideo(name: picked.name) {
                    uploaded.video = try await VideoPreviewStorage.shared.store(
                        picked.url, name: picked.name,
                        for: ConversationVideoKey(target: target, attachmentID: uploaded.id)
                    )
                }
                guard !Task.isCancelled, fileLoadID == request, draftTarget == target else { return }
                preparedFiles.append(uploaded)
            } catch let error as FileAttachments.LoadError {
                guard !Task.isCancelled, fileLoadID == request, draftTarget == target else { return }
                store.error = FileAttachments.message(for: error)
            } catch {
                guard !Task.isCancelled, fileLoadID == request, draftTarget == target else { return }
                // Upload failures already have a safe message. A picker/provider failure uses
                // the same existing unreadable-file message, without leaking provider details.
                if !(error is DSBotFailure) { store.error = FileAttachments.message(for: error) }
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
        let target = DraftTarget(computerID: computerID, sessionID: sessionID)
        let submittedText = draft
        let submitted = SubmittedComposerAttachments(
            photos: preparedPhotos, files: preparedFiles
        )
        let forwarding = store.isAssistantConversation && text.hasPrefix("@")
        if !forwarding { followSentMessage() }
        assistantCompletion.close()
        let files = preparedFiles
        let recipient = assistantCompletion.recipient
        Task {
            guard draftTarget == target else { return }
            var handedOff = false
            do {
                try await store.send(
                    text: text, attachments: attachments, files: files,
                    assistantRecipient: recipient,
                    draftText: submittedText
                ) {
                    handedOff = true
                    updateDraft("")
                    preparedPhotos = []
                    preparedFiles = []
                    compressedPhotoBytes = 0
                    composerFocused = false
                }
            } catch {
                guard handedOff else { return }
                if draftTarget == target, previousDraftTarget == target {
                    updateDraft(store.messageDrafts[target] ?? "")
                    restoreSubmittedAttachments(submitted)
                } else {
                    failedAttachments[target, default: []].append(submitted)
                }
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
            followSentMessage()
            try? await store.send(text: text)
        }
    }

    private func followSentMessage() {
        cardFromTop = false
        followsLatestMessage = true
        latestJump &+= 1
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
        if arguments.contains("-dsbot-review-provider-picker") { contextPicker = .provider }
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
    case photos, videos, files, goal, plan, compact
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

private struct SubmittedComposerAttachments {
    let photos: [PreparedPhotoAttachment]
    let files: [UploadedFile]
}

private struct ChatMessageRow: View, Equatable {
    let message: ChatMessage
    @State private var isToolExpanded = false
    @State private var isReasoningExpanded = false

    static func == (lhs: ChatMessageRow, rhs: ChatMessageRow) -> Bool {
        lhs.message == rhs.message
    }

    @ViewBuilder
    var body: some View {
        if message.role == "user" {
            UserMessageBubble(text: message.text)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .accessibilityIdentifier("chat.message.\(message.id)")
        } else {
            agentMessage
        }
    }

    private var agentMessage: some View {
        HStack(alignment: .top) {
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
                            Text(message.toolName.flatMap { $0.isEmpty ? nil : $0 } ?? L10n.text("工具输出"))
                                .font(.system(size: 12, weight: .medium))
                                .lineLimit(1)
                            DSBotIcon(isToolExpanded ? .up : .down, size: 14, scalesStroke: true)
                        }
                        .foregroundStyle(DSBotStyle.muted)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isToolExpanded ? L10n.text("收起工具输出") : L10n.text("展开工具输出"))
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
                        Text(L10n.text("处理过程"))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DSBotStyle.muted)
                    }
                    .accessibilityIdentifier("chat.process.\(message.id)")
                } else if let reasoning = message.reasoning, !reasoning.isEmpty {
                    DisclosureGroup(isExpanded: $isReasoningExpanded) {
                        messageText(reasoning)
                            .padding(.top, 5)
                    } label: {
                        Text(L10n.text("思考过程"))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DSBotStyle.muted)
                    }
                }
            }
            Spacer(minLength: 18)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
