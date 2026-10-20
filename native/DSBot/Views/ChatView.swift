import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct ChatView: View {
    @ObservedObject var store: DSBotStore
    var isOverlayOpen = false
    var historyTopInset: CGFloat = 0

    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var speechCapture = NativeSpeechCapture()
    @State private var draft = ""
    @State private var draftRevision = 0
    @State private var previousDraftTarget: DraftTarget?
    @State private var preparedPhotos: [PreparedPhotoAttachment] = []
    @State private var sendingPhotoIDs: Set<String> = []
    @State private var compressedPhotoBytes = 0
    @State private var selectedPhotos: [PhotosPickerItem] = []
    @State private var isPhotoPickerPresented = false
    @State private var photoNotice: String?
    @State private var photoLoadGeneration = 0
    @State private var isVoicePressActive = false
    @State private var cancelVoicePress = false
    @State private var voiceTimeoutTask: Task<Void, Never>?
    @State private var voiceSessionID: String?
    @State private var voiceComputerID: String?
    @State private var voicePressStartedAt: Date?
    /// Where the finger is while it holds the talk bar. Its own object, held without observing it: the
    /// position changes with every touch event, and the chat must not be rebuilt each time.
    @State private var voiceTouch = VoiceTouch()
    @State private var followsLatestMessage = true
    @State private var isDraggingHistory = false
    /// Where the history's end marker is in the scroll view; the preference's default while it is not on screen.
    @State private var historyBottomY: CGFloat = ChatBottomPreference.defaultValue
    @State private var lastMessageHeight: CGFloat = 0
    @State private var latestScrollScheduler = ChatLatestScrollScheduler()
    @State private var viewportScrollScheduler = ChatViewportScrollScheduler()
    @State private var isVoiceMode = false
    /// The open "+" sheet. The page rides along in the item so presentation and page cannot disagree.
    @State private var attachmentSheetRequest: AttachmentSheetRequest?
    @State private var pendingSheetAction: PendingSheetAction?
    @State private var isFileImporterPresented = false
    @State private var composerIntent = ComposerIntent.message
    @State private var isGoalWorking = false
    @State private var isCompacting = false
    @State private var planPreview: Approval?
    @State private var preparedFiles: [UploadedFile] = []
    @State private var uploadingFileName: String?
    @State private var chromeHeight: CGFloat = 0
    @State private var contextPicker: ContextPicker?
    /// Top edge of the keyboard once it has settled (screen coordinates); nil while it is hidden.
    @State private var keyboardTop: CGFloat?
    @State private var keyboardSettleTask: Task<Void, Never>?
    @FocusState private var composerFocused: Bool

    var body: some View {
        messageHistory
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
            // Mounted from the moment the talk bar is up and only faded in by a press, so its first
            // frame is drawn before anyone holds the bar rather than while they wait for it.
            if isVoiceMode || showsVoiceOverlay {
                GeometryReader { geometry in
                    let height = min(geometry.size.height * 0.32, 248)
                    // The chat reaches the bottom edge of the screen, which is where the glow is laid out to.
                    VoiceCaptureOverlay(
                        transcript: speechCapture.transcript,
                        meter: speechCapture.meter,
                        touch: voiceTouch,
                        touchOriginY: geometry.size.height - height,
                        isCancelling: cancelVoicePress,
                        isFinishing: speechCapture.isFinishing,
                        isActive: showsVoiceOverlay
                    )
                    .frame(height: height)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .offset(y: showsVoiceOverlay ? 0 : 24)
                    .opacity(showsVoiceOverlay ? 1 : 0.001)
                }
                .allowsHitTesting(false)
                .accessibilityHidden(!showsVoiceOverlay)
            }
        }
        .animation(.easeOut(duration: 0.22), value: showsVoiceOverlay)
        // A tap on the bar you can feel at once, whatever the screen is still drawing.
        .sensoryFeedback(trigger: isVoicePressActive) { _, pressed in pressed ? .impact(weight: .medium) : nil }
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
                sendVoiceTranscript(text, sessionID: voiceSessionID, computerID: voiceComputerID)
            }
            speechCapture.onDraft = { text in
                preserveVoiceTranscriptAsDraft(text, sessionID: voiceSessionID, computerID: voiceComputerID)
            }
        }
        .onChange(of: draftTarget) { _, _ in
            restoreDraft()
        }
        .onDisappear {
            latestScrollScheduler.cancel()
            cancelViewportScroll()
            saveDraft()
            voiceTimeoutTask?.cancel()
            voiceTimeoutTask = nil
            isVoicePressActive = false
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
            latestScrollScheduler.cancel()
            cancelViewportScroll()
            followsLatestMessage = true
            photoLoadGeneration += 1
            preparedPhotos = []
            preparedFiles = []
            uploadingFileName = nil
            composerIntent = .message
            sendingPhotoIDs = []
            compressedPhotoBytes = 0
            photoNotice = nil
            selectedPhotos = []
            lastMessageHeight = 0
            composerFocused = false
            cancelVoiceCapture()
        }
        .onChange(of: store.activeComputer?.id) { _, _ in
            latestScrollScheduler.cancel()
            cancelViewportScroll()
            photoLoadGeneration += 1
            preparedPhotos = []
            preparedFiles = []
            uploadingFileName = nil
            sendingPhotoIDs = []
            compressedPhotoBytes = 0
            photoNotice = nil
            selectedPhotos = []
            lastMessageHeight = 0
            composerFocused = false
            cancelVoiceCapture()
        }
        .onChange(of: composerFocused) { _, focused in
            DSBotLog.record(focused ? "keyboard.focus" : "keyboard.dismiss")
        }
        .onChange(of: speechCapture.isRecording) { _, recording in
            if !recording && !speechCapture.isFinishing {
                isVoicePressActive = false
            }
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
        GeometryReader { geometry in
            let visibleHeight = max(0, geometry.size.height - chromeHeight)
            // SwiftUI normally shrinks this view for the keyboard. If it did not (or not enough), lift
            // the composer by what still overlaps so it can never sit behind the keyboard.
            let keyboardLift = keyboardTop.map { max(0, geometry.frame(in: .global).maxY - $0) } ?? 0
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if !hasConversationContent {
                            // The hero and the loading state are overlays, centred in the free area.
                            if store.selectedSession == nil {
                                Text(" ")
                                    .frame(maxWidth: .infinity, minHeight: 24)
                            }
                        } else if store.transcript != nil {
                            ForEach(store.transcriptRows) { row in
                                TranscriptRowView(row: row)
                                    .equatable()
                                    .id(row.id)
                                    .background {
                                        if row.id == store.transcriptRows.last?.id {
                                            GeometryReader { row in
                                                Color.clear.preference(
                                                    key: ChatLastMessageHeightPreference.self,
                                                    value: row.size.height
                                                )
                                            }
                                        }
                                    }
                            }
                        } else {
                            ForEach(store.messages) { message in
                                ChatMessageRow(message: message)
                                    .equatable()
                                    .id(message.id)
                                    .background {
                                        if message.id == store.messages.last?.id {
                                            GeometryReader { row in
                                                Color.clear.preference(
                                                    key: ChatLastMessageHeightPreference.self,
                                                    value: row.size.height
                                                )
                                            }
                                        }
                                    }
                            }
                        }
                        if store.transcript != nil {
                            ForEach(sessionApprovals) { approval in
                                PlanReviewCard(
                                    approval: approval,
                                    isResponding: store.isRespondingApprovals.contains(approval.id),
                                    onApprove: { respond(to: approval, allow: true) },
                                    onRevise: { revise(approval) },
                                    onOpenFull: { planPreview = approval }
                                )
                                .id("approval:\(approval.id)")
                            }
                        }
                        Color.clear
                            .frame(height: 1)
                            .id("chat.bottom")
                            .background {
                                GeometryReader { bottom in
                                    Color.clear.preference(
                                        key: ChatBottomPreference.self,
                                        value: bottom.frame(in: .named("dsbot.history")).maxY
                                    )
                                }
                            }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, historyTopInset + 14)
                    .padding(.bottom, 18)
                    .frame(maxWidth: 760)
                    .frame(maxWidth: .infinity)
                }
                .coordinateSpace(name: "dsbot.history")
                .scrollDismissesKeyboard(.interactively)
                .background(DSBotStyle.canvas)
                .onPreferenceChange(ChatBottomPreference.self) { value in
                    historyBottomY = value
                    guard !isDraggingHistory, value != ChatBottomPreference.defaultValue else { return }
                    if followsLatestMessage && value > visibleHeight + 2 {
                        scheduleLatestScroll(using: proxy)
                    } else if value < visibleHeight + 64 {
                        followsLatestMessage = true
                    }
                }
                .onPreferenceChange(ChatLastMessageHeightPreference.self) { height in
                    guard height.isFinite, height > 0 else { return }
                    let changed = abs(height - lastMessageHeight) > 0.5
                    lastMessageHeight = height
                    guard changed, followsLatestMessage, !isDraggingHistory else { return }
                    scheduleLatestScroll(using: proxy)
                }
                .simultaneousGesture(
                    DragGesture(minimumDistance: 8)
                        .onChanged { _ in
                            if !isDraggingHistory {
                                latestScrollScheduler.cancel()
                                cancelViewportScroll()
                            }
                            isDraggingHistory = true
                            followsLatestMessage = false
                        }
                        .onEnded { _ in
                            isDraggingHistory = false
                            followsLatestMessage = historyBottomY < visibleHeight + 64
                            if followsLatestMessage {
                                scheduleLatestScroll(using: proxy)
                            }
                        }
                )
                .onChange(of: store.messages.count) { _, _ in
                    guard followsLatestMessage else { return }
                    scheduleLatestScroll(using: proxy)
                }
                .onChange(of: store.contentRevision) { _, _ in
                    guard followsLatestMessage else { return }
                    scheduleLatestScroll(using: proxy)
                }
                .onChange(of: store.approvals) { _, _ in
                    guard followsLatestMessage else { return }
                    scheduleLatestScroll(using: proxy)
                }
                .onChange(of: store.messages.last?.text) { _, _ in
                    guard followsLatestMessage else { return }
                    scheduleLatestScroll(using: proxy)
                }
                .onChange(of: geometry.size.height) { _, _ in
                    guard followsLatestMessage else { return }
                    scheduleViewportScroll(using: proxy)
                }
                .onChange(of: chromeHeight) { _, _ in
                    guard followsLatestMessage else { return }
                    scheduleViewportScroll(using: proxy)
                }
                .onAppear {
                    // A history that is already there (the app was rebuilt after a reconnect) has no change to
                    // trigger the scroll: ask for it, with the settling scrolls a long LazyVStack needs.
                    #if DEBUG && targetEnvironment(simulator)
                    if ProcessInfo.processInfo.arguments.contains("-dsbot-review-no-appear-scroll") { return }
                    #endif
                    scheduleLatestScroll(using: proxy)
                }
                .onChange(of: isOverlayOpen) { wasOpen, isOpen in
                    guard wasOpen, !isOpen else { return }
                    verifyHistoryEnd(using: proxy, visibleHeight: visibleHeight)
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    bottomChrome(using: proxy, visibleHeight: visibleHeight, keyboardLift: keyboardLift)
                }
                .overlay {
                    if showsEmptyState {
                        ConversationEmptyState()
                            .padding(.bottom, chromeHeight)
                            .allowsHitTesting(false)
                            .transition(.opacity)
                    } else if showsLoadingState {
                        // Centred between the toolbar and the composer.
                        ConversationLoadingState()
                            .padding(.top, historyTopInset)
                            .padding(.bottom, chromeHeight)
                            .allowsHitTesting(false)
                            .transition(.opacity)
                    }
                }

            }
        }
    }

    private func scheduleLatestScroll(using proxy: ScrollViewProxy) {
        guard followsLatestMessage, !isDraggingHistory else { return }
        #if DEBUG && targetEnvironment(simulator)
        // A review that wants the history where it starts, with text under the composer and the toolbar.
        if ProcessInfo.processInfo.arguments.contains("-dsbot-review-no-scroll") { return }
        #endif
        latestScrollScheduler.schedule(
            shouldScroll: { followsLatestMessage && !isDraggingHistory },
            action: { proxy.scrollTo("chat.bottom", anchor: .bottom) }
        )
    }

    private func scheduleViewportScroll(using proxy: ScrollViewProxy) {
        guard followsLatestMessage, !isDraggingHistory else { return }
        #if DEBUG && targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("-dsbot-review-no-scroll") { return }
        #endif
        viewportScrollScheduler.schedule(
            shouldScroll: { followsLatestMessage && !isDraggingHistory },
            action: { proxy.scrollTo("chat.bottom", anchor: .bottom) }
        )
    }

    private func cancelViewportScroll() {
        viewportScrollScheduler.cancel()
    }

    /// After the sidebar, a sheet or a page has covered a history that follows the latest message, its end must
    /// be where it was. A long history can come back scrolled past its end, which is a blank screen: the log
    /// says what it found, and the history is scrolled to its end again.
    private func verifyHistoryEnd(using proxy: ScrollViewProxy, visibleHeight: CGFloat) {
        Task { @MainActor in
            for delay in [350, 1_000] as [UInt64] {
                try? await Task.sleep(nanoseconds: delay * 1_000_000)
                guard followsLatestMessage, !isDraggingHistory else { return }
                let marker = historyBottomY
                let state: String
                if marker == ChatBottomPreference.defaultValue {
                    state = "lost"
                } else if marker < 0 {
                    state = "past"
                } else if marker > visibleHeight + 64 {
                    state = "short"
                } else {
                    state = "end"
                }
                DSBotLog.record(
                    "chat.resume",
                    counts: ["messageCount": store.transcriptRows.count + store.messages.count],
                    state: state
                )
                guard state != "end" else { return }
                scheduleLatestScroll(using: proxy)
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

    /// Everything that floats above the history: the jump-to-latest button, approvals, notices,
    /// photo chips and the glass composer. The history scrolls beneath it behind a progressive blur.
    private func bottomChrome(using proxy: ScrollViewProxy, visibleHeight: CGFloat, keyboardLift: CGFloat) -> some View {
        let gap = composerFocused ? DSBotLayout.composerKeyboardGap : DSBotLayout.composerBottomMargin
        return VStack(spacing: 8) {
            if !followsLatestMessage && historyBottomY > visibleHeight + 64 {
                HStack {
                    Spacer(minLength: 0)
                    latestButton(using: proxy)
                }
            }
            if store.transcript == nil { approvalCards }
            if let photoNotice {
                compactNotice(photoNotice) { self.photoNotice = nil }
            }
            if let notice = speechCapture.notice {
                compactNotice(notice) { cancelVoiceCapture() }
            }
            if let error = store.error {
                compactNotice(error) { store.error = nil }
            }
            if let notice = store.notice {
                compactNotice(notice, isInfo: true) { store.notice = nil }
                    .task(id: notice) {
                        try? await Task.sleep(nanoseconds: 5_000_000_000)
                        if store.notice == notice { store.notice = nil }
                    }
            }
            if isCompacting { compactingRow }
            taskPanel
            goalBanner
            chipStrip
            contextChips
            composerCapsule
        }
        .padding(.horizontal, DSBotLayout.composerSideMargin)
        .padding(.top, 6)
        .padding(.bottom, gap + keyboardLift)
        // A preference raised inside `safeAreaInset` never reaches the history, so read the size here.
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { chromeHeight = $0 }
        .background(alignment: .bottom) {
            bottomEdge(height: DSBotLayout.composerHeight + gap + keyboardLift + 8)
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

    private func latestButton(using proxy: ScrollViewProxy) -> some View {
        Button {
            latestScrollScheduler.cancel()
            cancelViewportScroll()
            followsLatestMessage = true
            withAnimation(.easeOut(duration: 0.18)) {
                proxy.scrollTo("chat.bottom", anchor: .bottom)
            }
        } label: {
            DSBotIcon(.down, size: 20)
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: 42, height: 42)
        }
        .buttonStyle(DSBotGlassButtonStyle())
        .accessibilityLabel("回到最新消息")
        .accessibilityIdentifier("chat.latest")
        .transition(.opacity)
    }

    /// DSH's task list for this conversation, when it has one.
    @ViewBuilder
    private var taskPanel: some View {
        if store.selectedSession != nil, !store.isChoosingWorkspace, !store.todos.isEmpty {
            TaskPanel(todos: store.todos)
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
                onEdit: { enterGoalMode() },
                onClear: { runGoalCommand("clear") }
            )
            .transition(.opacity)
        }
    }

    /// Plan mode is the only state that lives above the composer; attachments sit inside it.
    @ViewBuilder
    private var chipStrip: some View {
        if store.planMode {
            HStack {
                planChip
                Spacer(minLength: 0)
            }
        }
    }

    /// Plan mode is on for this session; tapping the chip leaves it (`/plan off`).
    private var planChip: some View {
        Button {
            runPlanCommand(argument: "off")
        } label: {
            HStack(spacing: 5) {
                DSBotIcon(.plan, size: 14)
                Text("计划")
                    .font(.system(size: 14, weight: .medium))
            }
            .foregroundStyle(DSBotStyle.chatRunning)
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(DSBotStyle.chatBubble, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("计划模式已开启，点按关闭")
        .accessibilityIdentifier("composer.plan.chip")
    }

    // MARK: Empty conversation and keyboard

    /// A conversation with nothing in it yet (and the new-task home) shows DSH's hero instead of a blank page.
    private var showsEmptyState: Bool {
        if store.isChoosingWorkspace { return true }
        return !hasConversationContent && sessionApprovals.isEmpty && !store.isLoadingSession
            && !(store.selectedSession == nil && store.isLoading)
    }

    /// Nothing to show yet because the conversation (or the first one, right after connecting) is on its way.
    private var showsLoadingState: Bool {
        !hasConversationContent && !store.isChoosingWorkspace
            && (store.isLoadingSession || (store.selectedSession == nil && store.isLoading))
    }

    private func trackKeyboard(_ note: Notification) {
        guard let end = note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect else { return }
        keyboardSettleTask?.cancel()
        switch KeyboardAvoidance.action(endFrameMinY: end.minY, screenHeight: DSBotLayout.screenHeight) {
        case .release:
            // Nothing is left to keep clear of: go down with the keyboard, in its own time, instead of
            // waiting for it to settle while the composer stays up where it was.
            let duration = note.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
            withAnimation(.easeOut(duration: duration)) { keyboardTop = nil }
        case let .settle(top):
            keyboardSettleTask = Task { @MainActor in
                // Let the keyboard's own animation and SwiftUI's avoidance finish, then correct any overlap.
                try? await Task.sleep(nanoseconds: KeyboardAvoidance.settleNanoseconds)
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.2)) { keyboardTop = top }
            }
        }
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

    private var showsVoiceOverlay: Bool { isVoicePressActive || speechCapture.isFinishing }

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
        .dsbotGlass(in: RoundedRectangle(
            cornerRadius: hasAttachmentTiles ? 28 : DSBotLayout.composerHeight / 2, style: .continuous
        ))
        .animation(.easeOut(duration: 0.18), value: hasAttachmentTiles)
        .opacity(showsVoiceOverlay ? 0 : 1)
        .animation(.easeOut(duration: 0.16), value: showsVoiceOverlay)
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
            if case let .goal(editing) = composerIntent {
                Button {
                    composerIntent = .message
                    if editing { updateDraft("") }
                } label: {
                    Text(editing ? "/目标 编辑" : "/目标")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(DSBotStyle.ink)
                        .padding(.vertical, 12.5)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("目标指令，点按取消")
                .accessibilityIdentifier("composer.goal.token")
            }
            TextField(
                placeholder,
                text: draftBinding,
                prompt: Text(placeholder).foregroundColor(DSBotStyle.muted),
                axis: .vertical
            )
            .font(.system(size: 16))
            .lineLimit(1...5)
            .focused($composerFocused)
            .textFieldStyle(.plain)
            .padding(.vertical, 12.5)
            .accessibilityIdentifier("composer.text")
        }
        .padding(.leading, 1)
        .frame(minHeight: DSBotLayout.composerHeight)
    }

    private var holdToTalkBar: some View {
        Text("按住说话")
            .font(.system(size: 17, weight: .semibold))
            .foregroundStyle(DSBotStyle.ink)
            .frame(maxWidth: .infinity, minHeight: DSBotLayout.composerHeight)
            .contentShape(Rectangle())
            .gesture(voicePressGesture)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("按住说话，上滑取消")
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("composer.hold")
    }

    @ViewBuilder
    private var trailingControl: some View {
        if isVoiceMode {
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
                        ProgressView().tint(.white)
                    } else {
                        DSBotIcon(.send, size: 20)
                    }
                }
                .foregroundStyle(.white)
                .frame(width: 34, height: 34)
                .background(DSBotStyle.blue, in: Circle())
                .overlay {
                    if isGoalWorking { ProgressView().tint(.white) }
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
        voiceModeOff()
        if let goal = store.goal {
            updateDraft(goal.objective)
            composerIntent = .goal(editing: true)
        } else {
            composerIntent = .goal(editing: false)
        }
        DispatchQueue.main.async { composerFocused = true }
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
        Task {
            let outcome = await store.runCommand(.plan, argument: argument)
            reportCommand(.plan, argument: argument, outcome: outcome)
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

    /// Success becomes a short notice above the composer; a refusal from DSH is shown as an error.
    private func reportCommand(_ command: SessionCommand, argument: String?, outcome: CommandOutcome?) {
        guard let outcome else { return }
        let message = CommandText.message(for: command, argument: argument, outcome: outcome)
        if outcome.isError {
            store.error = message
        } else {
            store.notice = message
        }
    }

    private func sendGoal(editing: Bool) {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isGoalWorking else { return }
        isGoalWorking = true
        Task {
            let argument = editing ? "edit \(text)" : text
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

    private var voicePressGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named("dsbot.chat"))
            .onChanged { value in
                if !isVoicePressActive {
                    guard let sessionID = store.selectedSession?.id,
                          let computerID = store.activeComputer?.id else { return }
                    // How long after the touch itself this handler ran: if the screen is slow to answer a press,
                    // this says whether the delay came before the app or inside it.
                    DSBotLog.record("voice.press", elapsedMs: max(0, Date().timeIntervalSince(value.time) * 1_000))
                    voicePressStartedAt = Date()
                    isVoicePressActive = true
                    cancelVoicePress = false
                    if composerFocused { composerFocused = false }
                    voiceSessionID = sessionID
                    voiceComputerID = computerID
                    Task {
                        await speechCapture.begin()
                        guard isVoicePressActive else {
                            cancelVoiceCapture()
                            return
                        }
                    }
                    voiceTimeoutTask?.cancel()
                    voiceTimeoutTask = Task {
                        try? await Task.sleep(nanoseconds: 60_000_000_000)
                        guard !Task.isCancelled, isVoicePressActive else { return }
                        isVoicePressActive = false
                        if speechCapture.isRecording {
                            DSBotLog.record("voice.timeout")
                            speechCapture.finish()
                        } else {
                            cancelVoiceCapture()
                        }
                    }
                }
                voiceTouch.location = value.location
                let cancelling = value.translation.height < -72
                if cancelling != cancelVoicePress { cancelVoicePress = cancelling }
            }
            .onEnded { _ in
                voiceTimeoutTask?.cancel()
                voiceTimeoutTask = nil
                isVoicePressActive = false
                if cancelVoicePress {
                    cancelVoiceCapture()
                } else if voiceSessionID == store.selectedSession?.id,
                          voiceComputerID == store.activeComputer?.id,
                          speechCapture.isRecording {
                    DSBotLog.record("voice.release")
                    speechCapture.finish()
                } else {
                    cancelVoiceCapture()
                }
            }
    }

    /// Compaction asks the model for a summary and can take a while, so the tap needs visible feedback.
    private var compactingRow: some View {
        HStack(spacing: 8) {
            ProgressView().controlSize(.mini)
            Text("正在压缩对话…")
        }
        .font(.system(size: 12))
        .foregroundStyle(DSBotStyle.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 6)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("composer.compacting")
    }

    private func compactNotice(_ message: String, isInfo: Bool = false, dismiss: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            Text(message)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: dismiss) {
                DSBotIcon(.close, size: 14)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("关闭提示")
        }
        .font(.system(size: 12))
        .foregroundStyle(isInfo ? DSBotStyle.ink : DSBotStyle.muted)
        .padding(.horizontal, 6)
    }

    private func send() {
        if case let .goal(editing) = composerIntent {
            sendGoal(editing: editing)
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
        let hadPendingCapture = isVoicePressActive || voiceSessionID != nil || speechCapture.isRecording
        voiceTimeoutTask?.cancel()
        voiceTimeoutTask = nil
        isVoicePressActive = false
        cancelVoicePress = false
        voiceSessionID = nil
        voiceComputerID = nil
        voicePressStartedAt = nil
        voiceTouch.location = nil
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
        if arguments.contains("-dsbot-review-goal-mode") { composerIntent = .goal(editing: false) }
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
            isVoicePressActive = true
            cancelVoicePress = arguments.contains("-dsbot-review-voice-cancel")
            voiceTouch.location = CGPoint(x: 210, y: 843)
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
    /// `/goal <objective>` (create) or `/goal edit <objective>`.
    case goal(editing: Bool)
}

private struct ChatBottomPreference: PreferenceKey {
    static var defaultValue: CGFloat = .greatestFiniteMagnitude
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct ChatLastMessageHeightPreference: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

@MainActor
final class ChatLatestScrollScheduler {
    private var pendingTask: Task<Void, Never>?
    private var settleTask: Task<Void, Never>?
    private var generation = 0

    /// A LazyVStack only knows estimated heights for rows it has not laid out, so one `scrollTo` can
    /// stop short of the real end of a long history (and nothing fires afterwards, because the end
    /// marker is not on screen to report anything). Scrolling again a few times while the rows
    /// settle lands on the end.
    private static let settleDelays: [UInt64] = [120, 260, 500, 900]

    func schedule(
        afterNanoseconds: UInt64 = 70_000_000,
        shouldScroll: @escaping @MainActor () -> Bool,
        action: @escaping @MainActor () -> Void
    ) {
        guard pendingTask == nil else { return }
        let scheduledGeneration = generation
        pendingTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(nanoseconds: afterNanoseconds)
            } catch {
                return
            }
            guard let self, self.generation == scheduledGeneration else { return }
            self.pendingTask = nil
            guard shouldScroll() else { return }
            action()
            self.settle(generation: scheduledGeneration, shouldScroll: shouldScroll, action: action)
        }
    }

    private func settle(
        generation scheduledGeneration: Int,
        shouldScroll: @escaping @MainActor () -> Bool,
        action: @escaping @MainActor () -> Void
    ) {
        settleTask?.cancel()
        settleTask = Task { @MainActor [weak self] in
            for delay in Self.settleDelays {
                do {
                    try await Task.sleep(nanoseconds: delay * 1_000_000)
                } catch {
                    return
                }
                guard let self, self.generation == scheduledGeneration, shouldScroll() else { return }
                action()
            }
        }
    }

    func cancel() {
        generation &+= 1
        pendingTask?.cancel()
        pendingTask = nil
        settleTask?.cancel()
        settleTask = nil
    }
}

@MainActor
final class ChatViewportScrollScheduler {
    private var pendingTask: Task<Void, Never>?
    private var generation = 0

    func schedule(
        afterNanoseconds: UInt64 = 120_000_000,
        shouldScroll: @escaping @MainActor () -> Bool,
        action: @escaping @MainActor () -> Void
    ) {
        generation &+= 1
        let scheduledGeneration = generation
        pendingTask?.cancel()
        pendingTask = Task { @MainActor [weak self] in
            do {
                try await Task.sleep(nanoseconds: afterNanoseconds)
            } catch {
                return
            }
            guard let self, self.generation == scheduledGeneration else { return }
            self.pendingTask = nil
            guard shouldScroll() else { return }
            action()
        }
    }

    func cancel() {
        generation &+= 1
        pendingTask?.cancel()
        pendingTask = nil
    }
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
        .contextMenu {
            Button {
                UIPasteboard.general.string = message.text
                DSBotLog.record("message.copy")
            } label: {
                DSBotLabel("复制", icon: .copy)
            }
        }
        .accessibilityIdentifier("chat.message.\(message.id)")
    }

    @ViewBuilder
    private func messageText(_ value: String) -> some View {
        if message.status == "streaming" {
            Text(value)
                .font(.system(size: 16))
                .foregroundStyle(DSBotStyle.ink)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            MessageMarkdown(text: value)
        }
    }
}
