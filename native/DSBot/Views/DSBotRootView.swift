import SwiftUI
import UIKit

/// Which part of the app an entry was chosen from; the sidebar highlights only its own.
enum NavigationArea: Equatable {
    case sidebar, view
}

/// What fills the main area: the conversation, a screen of the app's own, or an embedded DSH page.
struct MainDestination: Equatable {
    var id: String
    var area: NavigationArea
    var target: NavigationTarget
    var title: String

    static let conversation = MainDestination(id: "chat", area: .view, target: .chat, title: "对话")
    /// The page the app opens on (owner, 2026-11-07): the board. The conversation is one level down from it.
    static let board = MainDestination(id: "dudu.board", area: .sidebar, target: .board, title: "看板")

    var showsChat: Bool { target == .chat }
    /// The conversation, the board and the Collector are drawn by the app itself, on the canvas; every other page is white.
    var onCanvas: Bool {
        if target.settingsSection != nil { return true }
        return [.chat, .board, .collector, .tasks].contains(target)
    }

    /// A short, log-safe name for the target.
    var logState: String {
        switch target {
        case .chat: return "conversation"
        case .assistant: return "assistant"
        case .board: return "board"
        case .collector: return "collector"
        case .tasks: return "tasks"
        case .dshSettings: return "dshSettings"
        case .duduSettings: return "duduSettings"
        case .files: return "files"
        case .schedule: return "schedule"
        case let .web(page, _): return page.rawValue
        case .unsupported: return "unsupported"
        }
    }
}

@MainActor
struct DSBotRootView: View {
    @ObservedObject private var store: DSBotStore
    @State private var isSidebarOpen = false
    @State private var sidebarNavigationRevision = 0
    @State private var presentedSheet: RootSheet?
    @State private var pendingPairingLink: String?
    @State private var destination = MainDestination.board
    /// The open conversation was chosen on the board: it has the way back to the board and the arrows between issues, and no views menu. A conversation chosen anywhere else
    /// (the sidebar, the Collector) is the app's own as it was: the sidebar button on the left, the views menu on the right (owner, 2026-11-07: the board is one page, it changes nothing else).
    @State private var conversationFromBoard = false
    /// An issue's conversation opened from 嘟嘟's chat (a row of a todo card) has the chrome of one opened on the board, but its way back is that chat, not the board
    /// (owner, 2026-11-10: "详情返回没有返回到聊天，而是返回到看板").
    @State private var returnsToAssistant = false
    @State private var boardMotion = BoardPageMotion()
    @State private var boardConversationPreparation: BoardConversationPreparation?
    @State private var boardTransitionMetrics = PageTransitionMetrics()
    @State private var showsConversationTitle = false
    /// The board and the Collector, kept while the app runs: going back to them shows what was there at once.
    @StateObject private var board = BoardModel()
    @StateObject private var collector = CollectorModel()
    @StateObject private var tasks = TasksModel()
    /// The subscription quota the gauge button at the top right of the board opens (read only when the sheet opens).
    @StateObject private var quota = QuotaModel()
    @State private var showsQuota = false
    /// 嘟嘟's own settings, drawn by the app: the pages of the one that is open.
    @StateObject private var settingsNav = SettingsNavigator()
    @State private var isMakingIssue = false
    @State private var issueDetail: BoardIssue?
    /// The result of an action on a page of the app's own (a mark on records, with its Undo), under the toolbar.
    @State private var pageToast: DSBotToastMessage?
    @State private var isSearchActive = false
    @State private var conversationSearch = SessionSearchModel()
    /// The home indicator's inset, read once the window exists. UIKit is never asked while SwiftUI lays out:
    /// reading a window's safe area inside a layout closure leaves the root view stale (the card stops
    /// following the drawer).
    @State private var homeInset: CGFloat = 0
    #if DEBUG && targetEnvironment(simulator)
    /// A review launch flag builds the conversation view again, as leaving a page used to.
    @State private var reviewChatEpoch = 0
    private var chatIdentity: Int { reviewChatEpoch }
    #else
    private var chatIdentity: Int { 0 }
    #endif
    /// A request from the toolbar's "+" to the plugin page.
    @State private var pageCommand: PageCommand?
    @State private var drawerMotion = DrawerMotion()
    /// DSH pages stay loaded for a few minutes after the user leaves them.
    @StateObject private var pagePool = EmbeddedPagePool()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(store: DSBotStore) {
        self.store = store
    }

    var body: some View {
        Group {
            if store.showsConnectionGuide {
                ConnectionGuideView(
                    store: store,
                    onManualEntry: {
                        pendingPairingLink = nil
                        presentedSheet = .pairing
                        DSBotLog.record("pairing.manual")
                    },
                    onOpenComputers: {
                        presentedSheet = .computers
                        DSBotLog.record("computers.open")
                    }
                )
                .accessibilityHidden(presentedSheet != nil)
            } else {
                GeometryReader { geometry in
                    drawerStack(in: geometry)
                }
                .accessibilityHidden(presentedSheet != nil)
                .sheet(isPresented: $isMakingIssue) {
                    NewIssueSheet(board: board, store: store)
                }
                .sheet(isPresented: $showsQuota) {
                    QuotaSheet(model: quota, store: store)
                        .presentationDetents([.height(QuotaSheet.Layout.height(for: quota.blocks))])
                        .presentationDragIndicator(.hidden)
                        .presentationBackground(ComposerAttachmentSheet.background)
                }
                .sheet(item: $issueDetail) { issue in
                    IssueDetailSheet(issue: issue, board: board, store: store)
                }
            }
        }
        // No primary colour: system controls (menu icons, buttons, alerts) follow the same ink as every icon.
        .tint(DSBotStyle.ink)
        .sheet(
            item: $presentedSheet,
            onDismiss: {
                if presentedSheet == nil {
                    pendingPairingLink = nil
                }
            }
        ) { sheet in
            Group {
                switch sheet {
                case .settings:
                    NavigationStack {
                        SettingsView(store: store)
                    }
                case .computers:
                    NavigationStack {
                        ComputerListView(store: store, onClose: { presentedSheet = nil })
                    }
                case .pairing:
                    NavigationStack {
                        PairingView(
                            store: store,
                            embeddedInSettings: true,
                            initialLink: pendingPairingLink,
                            onPaired: { pendingPairingLink = nil },
                            startsWithManualEntry: true
                        )
                    }
                }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.hidden)
            .presentationCornerRadius(32)
            .presentationBackground(DSBotStyle.settingsBackground)
        }
        .environment(\.homeIndicatorInset, homeInset)
        .task {
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-open-sidebar") {
                try? await Task.sleep(nanoseconds: 800_000_000)
                openSidebar()
            }
            if let spec = reviewArgument("-dsbot-review-open-item") {
                // "sidebar:insight", "view:notes": open that DSH entry.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                // A view page belongs to a conversation: wait until the fixture has opened one.
                for _ in 0..<40 where store.selectedSession == nil {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
                openReviewItem(spec)
                if ProcessInfo.processInfo.arguments.contains("-dsbot-review-board-conversation") {
                    conversationFromBoard = true
                    boardMotion.reset(showingConversation: true)
                }
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-open-settings") {
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                presentedSheet = .settings
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-open-trace") {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                openReviewView("trace")
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-new-task") {
                try? await Task.sleep(nanoseconds: 600_000_000)
                store.beginNewTask()
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-new-task-pick") {
                // New-task home, then a workspace: the conversation opens with project and mode chips.
                try? await Task.sleep(nanoseconds: 600_000_000)
                store.beginNewTask()
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                await store.startTask(in: "notes")
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-open-tasks") {
                // The tasks page, as the sidebar's fourth row opens it.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                conversationFromBoard = false
                destination = MainDestination(id: "dudu.tasks", area: .sidebar, target: .tasks, title: "任务")
            }
            if let seconds = reviewArgument("-dsbot-review-press-back").flatMap(Double.init) {
                // The back button, once, after that many seconds: what a tap on it does (the simulator has no finger).
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                goBack()
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-open-assistant") {
                // What the sidebar's 嘟嘟 row does once the plugin has named its fixed conversation (the review's navigation has no such row): open that conversation as the plain one.
                for _ in 0..<60 where !store.sessions.contains(where: { $0.isAssistant == true }) {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
                if let session = store.sessions.first(where: { $0.isAssistant == true }) {
                    conversationFromBoard = false
                    destination = .conversation
                    await store.selectSession(session)
                }
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-page-switch") {
                // Trace, context, team and trace again: each page owns its session, none reopens.
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                for page in ["trace", "context", "team", "trace", "context"] {
                    openReviewView(page)
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                }
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-page-roundtrip") {
                // Trace page, back to the chat, trace page again: the second visit must not reopen it.
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                openReviewView("trace")
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                showConversation()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                openReviewView("trace")
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-rebuild-chat") {
                // The conversation view is built again with its history already there.
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                reviewChatEpoch += 1
            }
            if ProcessInfo.processInfo.arguments.contains("-dsbot-review-page-cycles") {
                // Trace and back, trace again (the pool kept it) and back, context and back.
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                for page in ["trace", "trace", "context"] {
                    openReviewView(page)
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    showConversation()
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                }
            }
            #endif
            let info = Bundle.main.infoDictionary ?? [:]
            let version = (info["CFBundleShortVersionString"] as? String ?? "unknown")
                .replacingOccurrences(of: #"[^A-Za-z0-9.-]"#, with: "_", options: .regularExpression)
            let build = (info["CFBundleVersion"] as? String ?? "unknown")
                .replacingOccurrences(of: #"[^A-Za-z0-9.-]"#, with: "_", options: .regularExpression)
            DSBotLog.record("app.start.v\(version).b\(build)")
        }
        .onChange(of: store.activeComputer?.id) { _, _ in
            isSidebarOpen = false
            drawerMotion.reset()
            conversationFromBoard = false
            resetBoardTransition(showingBoard: true)
            destination = .board
            board.reset()
            collector.reset()
            tasks.reset()
            quota.reset()
            showsQuota = false
            isSearchActive = false
            conversationSearch.reset()
        }
        .onChange(of: pageConnectionKey, initial: true) { _, key in
            pagePool.connectionChanged(to: key)
        }
        .onAppear {
            collector.report = { toast in pageToast = toast }
            tasks.report = { toast in pageToast = toast }
            board.report = { toast in pageToast = toast }
        }
        .onChange(of: store.isBlankSession) { _, isBlank in
            // DSH shows no conversation views for a conversation that has not started.
            if isBlank, destination.area == .view, !destination.showsChat { destination = .conversation }
        }
        .task(id: SidebarRefresh(active: sidebarIsActive, connected: store.status == .connected)) {
            guard sidebarIsActive, store.status == .connected else { return }
            async let navigation: Void = store.refreshNavigation()
            async let count: Void = collector.refreshCount(using: store)
            async let taskList: Void = tasks.refresh(using: store)
            _ = await (navigation, count, taskList)
        }
        .onChange(of: store.showsConnectionGuide) { _, showsGuide in
            if showsGuide {
                closeSidebar()
                if presentedSheet == .settings || presentedSheet == .computers {
                    presentedSheet = nil
                }
            }
        }
        .onChange(of: destination) { _, next in
            DSBotLog.record("conversation.mode", state: next.logState)
            if let section = next.target.settingsSection { settingsNav.reset(section: section) }
            if !next.showsChat || !conversationFromBoard {
                resetBoardTransition(showingBoard: next.target == .board)
            }
        }
        .onChange(of: store.isRestoring) { _, isRestoring in
            if !isRestoring,
                pendingPairingLink != nil,
                presentedSheet == nil
            {
                presentedSheet = .pairing
            }
        }
        .onOpenURL(perform: handlePairingURL)
    }

    // MARK: Drawer

    private struct SidebarRefresh: Equatable {
        let active: Bool
        let connected: Bool
    }

    private var sidebarIsActive: Bool { isSidebarOpen && !drawerMotion.isMoving }

    private var isBoardTransitioning: Bool { boardMotion.isAnimating }

    private var boardPagePosition: BoardPagePosition {
        if destination.target == .board { return .board }
        return destination.showsChat && conversationFromBoard ? .issue : .other
    }

    private struct BoardConversationPreparation {
        let id = UUID()
        let target: DraftTarget
        let navigationRevision: Int
    }

    private func drawerStack(in geometry: GeometryProxy) -> some View {
        let width = DSBotLayout.drawerWidth(in: geometry.size.width)
        return ZStack(alignment: .leading) {
            DSBotStyle.canvas.ignoresSafeArea()
            sidebarLayer(width: width)
                .accessibilityHidden(!isSidebarOpen || isSearchActive)
                .zIndex(0)
            cardLayer(in: geometry, drawerWidth: width)
                .accessibilityHidden(isSidebarOpen && isSearchActive)
                .zIndex(1)
            if isSidebarOpen {
                DrawerBackdrop(
                    motion: drawerMotion, isOpen: isSidebarOpen, width: width,
                    pageWidth: geometry.size.width, pageHeight: geometry.size.height,
                    safeBottom: geometry.safeAreaInsets.bottom,
                    animation: drawerAnimation, onClose: closeSidebar
                )
                .accessibilityHidden(isSidebarOpen && isSearchActive)
                .zIndex(2)
            }
            edgeStripLayer(drawerWidth: width, pageWidth: geometry.size.width).zIndex(3)
            if isSearchActive {
                ConversationSearchView(
                    store: store, search: conversationSearch,
                    onBack: {
                        dismissKeyboard()
                        isSearchActive = false
                        conversationSearch.reset()
                    },
                    onOpen: { session in
                        showConversation()
                        Task { await store.selectSession(session) }
                    }
                )
                .opacity(isSidebarOpen ? 1 : 0)
                .allowsHitTesting(isSidebarOpen)
                .accessibilityHidden(!isSidebarOpen)
                .transition(.move(edge: .trailing))
                .zIndex(4)
            }
        }
        .animation(drawerAnimation, value: isSearchActive)
        // At launch and after a rotation (the width changes), ask the window once it has settled.
        .task(id: geometry.size.width) { await readHomeInset() }
    }

    private func readHomeInset() async {
        for pause in [0, 60, 340, 600] as [UInt64] {
            try? await Task.sleep(nanoseconds: pause * 1_000_000)
            guard !Task.isCancelled else { return }
            let inset = DSBotLayout.windowSafeAreaBottom
            if inset != homeInset { homeInset = inset }
        }
    }

    private func sidebarLayer(width: CGFloat) -> some View {
        SidebarView(
            store: store,
            onChooseItem: { open($0, in: .sidebar) },
            onChooseConversation: showConversation,
            onOpenComputers: {
                dismissKeyboard()
                presentedSheet = .computers
                DSBotLog.record("computers.open")
            },
            onOpenSettings: {
                dismissKeyboard()
                presentedSheet = .settings
                DSBotLog.record("settings.open")
            },
            onSearch: {
                isSearchActive = true
                DSBotLog.record("sidebar.search.open")
            },
            onClose: closeSidebar,
            selectedItemID: destination.area == .sidebar ? destination.id : nil,
            itemCounts: sidebarCounts,
            isActive: sidebarIsActive
        )
        .id(store.activeComputer?.id)
        .environment(\.conversationIsCovered, !sidebarIsActive)
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .allowsHitTesting(isSidebarOpen)
        .accessibilityHidden(!isSidebarOpen)
    }

    /// The conversation card: it slides aside, rounds its corners, dims and casts a soft shadow on
    /// the sidebar as the drawer opens. The toolbar rides along and fades with it.
    private func cardLayer(in geometry: GeometryProxy, drawerWidth: CGFloat) -> some View {
        let safeTop = geometry.safeAreaInsets.top
        let safeBottom = geometry.safeAreaInsets.bottom
        return ZStack(alignment: .top) {
            boardLayer(in: geometry, drawerWidth: drawerWidth)
            cardContent(in: geometry, drawerWidth: drawerWidth)
                .modifier(DSBotScrollEdgeBar(edge: .top) {
                    toolbar
                        .frame(width: geometry.size.width, height: DSBotLayout.toolbarHeight)
                        .background {
                            if DSBotScrollEdges.usesSystemEffect, boardConversationTitle != nil {
                                DSBotToolbarTitleBackdrop(safeAreaTop: safeTop)
                            }
                        }
                        .modifier(DrawerToolbarEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
                })
                .modifier(BoardConversationMotion(
                    motion: boardMotion, position: boardPagePosition,
                    width: geometry.size.width, reduceMotion: reduceMotion
                ))
                .allowsHitTesting(destination.target != .board && !isBoardTransitioning)
                .accessibilityHidden(destination.target == .board || isBoardTransitioning)
            // The result of an action on the board or the Collector, under the toolbar; the conversation has its own.
            DSBotToastOverlay(message: destination.showsChat ? nil : pageToast) { dismissed in
                if pageToast?.id == dismissed.id { pageToast = nil }
            }
            .padding(.top, safeTop + DSBotLayout.toolbarHeight + 8)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .zIndex(3)
        }
        .frame(width: geometry.size.width, height: geometry.size.height, alignment: .top)
        .modifier(DrawerCardMotion(
            motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth,
            safeTop: safeTop, safeBottom: safeBottom, background: cardBackground
        ))
    }

    /// Keep the board's ScrollView alive behind the conversation, including its toolbar.
    private func boardLayer(in geometry: GeometryProxy, drawerWidth: CGFloat) -> some View {
        let isBoard = destination.target == .board
        let isActive = isBoard && !isSidebarOpen && !drawerMotion.isMoving && boardConversationPreparation == nil
        let safeTop = geometry.safeAreaInsets.top
        return BoardView(
            board: board, store: store,
            topInset: DSBotScrollEdges.usesSystemEffect ? 0 : DSBotLayout.toolbarHeight,
            isActive: isActive
        ) { issue in
            Task { await openIssue(issue) }
        }
        .id(store.activeComputer?.id)
        .environment(\.conversationIsCovered, !isActive)
        .modifier(DrawerPageEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
        .overlay(alignment: .top) {
            if !DSBotScrollEdges.usesSystemEffect {
                DSBotEdgeBlur(edge: .top, height: safeTop + DSBotLayout.toolbarHeight, strength: 0.8)
                    .offset(y: -safeTop)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .modifier(DSBotScrollEdgeBar(edge: .top) {
            boardToolbar
                .frame(width: geometry.size.width, height: DSBotLayout.toolbarHeight)
                .modifier(DrawerToolbarEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
        })
        .modifier(BoardBackgroundMotion(
            motion: boardMotion, position: boardPagePosition,
            width: geometry.size.width, reduceMotion: reduceMotion
        ))
        .opacity(isBoard || conversationFromBoard ? 1 : 0)
        .allowsHitTesting(isBoard && !isSidebarOpen && !isBoardTransitioning)
        .accessibilityHidden(!isBoard || isSidebarOpen || isBoardTransitioning)
    }

    /// Every page below the conversation (DSH's web pages, files, automations) is white; the card around
    /// it must be too, or a band of the canvas shows above and below, where the status bar and the back
    /// button sit. Only the conversation is canvas.
    private var cardBackground: Color {
        destination.onCanvas ? DSBotStyle.canvas : .white
    }

    private func cardContent(in geometry: GeometryProxy, drawerWidth: CGFloat) -> some View {
        let safeTop = geometry.safeAreaInsets.top
        let conversationIsMoving = boardMotion.isMoving
        return ZStack(alignment: .top) {
            // The conversation stays mounted under every page, from the status bar to the bottom of the
            // screen. Coming back shows it as it was left (scroll position, draft) instead of building a
            // long history again, which could land scrolled past its end: a white screen.
            ChatView(
                store: store,
                isOverlayOpen: isSidebarOpen || drawerMotion.isMoving || presentedSheet != nil || !destination.showsChat || conversationIsMoving,
                historyTopInset: DSBotScrollEdges.usesSystemEffect ? 0 : safeTop + DSBotLayout.toolbarHeight,
                isPageTransitioning: conversationIsMoving || drawerMotion.isMoving,
                presentationRequest: boardConversationPreparation?.id,
                onPresentationLayout: presentPreparedBoardConversation
            )
            .id(chatIdentity)
            // Keep the toolbar's native safe area: ignoring the top also discards its scroll edge.
            .ignoresSafeArea(.container, edges: DSBotScrollEdges.usesSystemEffect ? .bottom : .all)
            .allowsHitTesting(destination.showsChat)
            .accessibilityHidden(!destination.showsChat)
            .environment(\.conversationIsCovered, isSidebarOpen || drawerMotion.isMoving || !destination.showsChat || conversationIsMoving)
            // A row of a todo card in 嘟嘟's chat opens its issue, as a row of the board does.
            .environment(\.openQuickCardIssue, { issue in Task { await openIssue(issue) } })
            // The picture of an issue in the thread, and 打开会话 under a row of the todo card, open that issue's own conversation, one to one; 信息 and 定时任务 open their pages.
            .environment(\.openIssueConversation, { id in Task { await openIssueConversation(id: id) } })
            .environment(\.openQuickPage, { kind in openQuickPage(kind) })

            if !destination.showsChat, destination.target != .board {
                pageContent(safeAreaTop: safeTop)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(destination.onCanvas ? DSBotStyle.canvas : Color.white)
            }
        }
        .modifier(DrawerPageEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
        .allowsHitTesting(!isSidebarOpen)
        .accessibilityHidden(isSidebarOpen)
        .overlay(alignment: .top) {
            statusBarFrost(safeAreaTop: safeTop)
        }
    }

    /// Swiping in from the left screen edge pulls the card aside like the menu button does.
    @ViewBuilder
    private func edgeStripLayer(drawerWidth: CGFloat, pageWidth: CGFloat) -> some View {
        if !isSidebarOpen && presentedSheet == nil && !isBoardTransitioning {
            // The edge pulls the drawer out on the board and on a conversation of the sidebar's; on every page, and on a conversation opened from the board, it is the way back.
            if destination.target == .board || (destination.showsChat && !conversationFromBoard) {
                Color.clear
                    .frame(width: DSBotLayout.edgeSwipeWidth)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .modifier(DrawerDragGesture(
                        motion: drawerMotion, opening: true, width: drawerWidth,
                        animation: drawerAnimation,
                        onBegin: {
                            dismissKeyboard()
                            DSBotLog.record("sidebar.edge.begin")
                        },
                        onComplete: openSidebar
                    ))
                    .accessibilityHidden(true)
            } else if destination.showsChat && conversationFromBoard && !returnsToAssistant {
                Color.clear
                    .frame(width: DSBotLayout.edgeSwipeWidth)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .modifier(BoardBackGesture(
                        motion: boardMotion, width: pageWidth,
                        onBegin: {
                            dismissKeyboard()
                            showsConversationTitle = false
                            boardTransitionMetrics.start(direction: "drag")
                            DSBotLog.record("board.back.drag")
                        },
                        onComplete: {
                            DSBotLog.record("page.back.edge")
                            returnToBoard()
                        },
                        onCancel: cancelBoardBackGesture
                    ))
                    .accessibilityHidden(true)
            } else {
                Color.clear
                    .frame(width: DSBotLayout.edgeSwipeWidth)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(edgeBackGesture())
                    .accessibilityHidden(true)
            }
        }
    }

    private func cancelBoardBackGesture() {
        guard boardMotion.isInteracting else { return }
        boardTransitionMetrics.start(direction: "cancel")
        boardMotion.animate(showingConversation: true, animation: boardTransitionAnimation, completion: {
            boardTransitionMetrics.finish()
        })
    }

    private func edgeBackGesture() -> some Gesture {
        DragGesture(minimumDistance: 16)
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                if value.translation.width > 70 || value.predictedEndTranslation.width > 140 {
                    DSBotLog.record("page.back.edge")
                    goBack()
                }
            }
    }


    /// The app opens on the board (owner, 2026-11-07), a page like the Collector that the sidebar's list leads to: the sidebar on the left, a new issue on the right.
    /// Nothing else is the board's. The conversation has the sidebar button and the views menu as it always had, and every other page (DSH's web pages, files, automations,
    /// the Collector) has its way back and its own action (the Collector's choosing, the plugin page's "+"). Only a conversation chosen on the board has the way back to
    /// the board and the arrows to the issue before and after, in place of the views menu.
    private var toolbar: some View {
        ZStack {
            HStack(spacing: boardConversationTitle == nil ? 8 : 12) {
                toolbarLeading
                if let title = boardConversationTitle {
                    conversationTitle(title)
                } else {
                    Spacer(minLength: 0)
                }
                toolbarTrailing
            }
            if toolbarDestination.target == .board {
                BoardScopeMenu(board: board)
            } else if boardConversationTitle == nil, let title = toolbarTitle {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                    .padding(.horizontal, DSBotLayout.toolbarButtonSize * 2 + 24)
                    .allowsHitTesting(false)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .padding(.horizontal, DSBotLayout.toolbarHorizontalPadding)
        .frame(height: DSBotLayout.toolbarHeight, alignment: .top)
    }

    private var boardToolbar: some View {
        ZStack {
            HStack(spacing: 8) {
                sidebarButton
                Spacer(minLength: 0)
                boardTrailing
            }
            BoardScopeMenu(board: board)
        }
        .padding(.horizontal, DSBotLayout.toolbarHorizontalPadding)
        .frame(height: DSBotLayout.toolbarHeight, alignment: .top)
    }

    /// The owner's reference (2026-11-08): a compact title after the back button, without the issue ID.
    /// Let the actual controls bound its width so long titles have all the remaining room.
    private func conversationTitle(_ title: String) -> some View {
        Button {
            showsConversationTitle = true
        } label: {
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(DSBotStyle.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: DSBotLayout.toolbarHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(DSBotQuietPressStyle())
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("issue.title")
        .popover(isPresented: $showsConversationTitle, arrowEdge: .top) {
            Text(title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(DSBotStyle.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(16)
                .frame(idealWidth: 280, maxWidth: 320)
                .presentationCompactAdaptation(.popover)
        }
        .onChange(of: title) { _, _ in showsConversationTitle = false }
        .onDisappear { showsConversationTitle = false }
    }

    private var boardConversationTitle: String? {
        guard toolbarDestination.showsChat, conversationChromeIsFromBoard else { return nil }
        return board.openedIssue(for: store.selectedSession)?.title ?? store.selectedSession?.title
    }

    private var toolbarDestination: MainDestination {
        boardConversationPreparation == nil ? destination : .conversation
    }

    private var conversationChromeIsFromBoard: Bool {
        conversationFromBoard || boardConversationPreparation != nil
    }

    private var toolbarTitle: String? {
        switch toolbarDestination.target {
        case .collector: return collector.isSelecting ? "已选 \(collector.selection.count) 条" : toolbarDestination.title
        case .tasks: return toolbarDestination.title
        case .duduSettings: return settingsNav.title
        default: return nil
        }
    }

    @ViewBuilder
    private var toolbarLeading: some View {
        switch toolbarDestination.target {
        case .board:
            sidebarButton
        case .chat where !conversationChromeIsFromBoard:
            sidebarButton
        case .collector where collector.isSelecting:
            Button {
                collector.stopSelecting()
            } label: {
                DSBotIcon(.close, size: 20)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
                    .contentShape(Circle())
            }
            .buttonStyle(DSBotGlassButtonStyle())
            .accessibilityLabel("取消选择")
            .accessibilityIdentifier("collector.selection.cancel")
        default:
            backButton
        }
    }

    @ViewBuilder
    private var toolbarTrailing: some View {
        switch toolbarDestination.target {
        case .board:
            boardTrailing
        case .chat:
            // An issue's conversation has the arrows to the issue before and after where the views menu would be (owner, 2026-11-07:
            // "只有在看板进入会话界面右上角三个点才删掉，现在是上一个下一个。其他页面的三个点不用删"); any other conversation keeps the menu.
            if conversationChromeIsFromBoard && hasIssuePager {
                issuePager
            } else {
                conversationMenu
            }
        case .collector:
            if collector.isSelecting {
                if !collector.allSelected {
                    Button {
                        collector.selectAll()
                    } label: {
                        Text("全选")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(DSBotStyle.ink)
                            .padding(.horizontal, 18)
                            .frame(height: DSBotLayout.toolbarButtonSize)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(DSBotGlassCapsuleButtonStyle())
                    .accessibilityIdentifier("collector.selectAll")
                }
            } else if !collector.items.isEmpty {
                Button {
                    collector.startSelecting()
                } label: {
                    DSBotIcon(.selectRows, size: 22)
                        .foregroundStyle(DSBotStyle.ink)
                        .frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
                        .contentShape(Circle())
                }
                .buttonStyle(DSBotGlassButtonStyle())
                .accessibilityLabel("选择")
                .accessibilityIdentifier("collector.select")
            }
        case .tasks:
            newTaskButton
        case .duduSettings:
            NativeSettingsSaveButton(navigator: settingsNav, store: store) { pageToast = $0 }
                .buttonStyle(DSBotGlassCapsuleButtonStyle())
        default:
            if isPluginPage { addPluginButton }
        }
    }

    /// The board's two buttons (owner, 2026-11-11: the quota beside the new issue, 44pt glass circles 8pt apart).
    private var boardTrailing: some View {
        HStack(spacing: 8) {
            quotaButton
            newIssueButton
        }
    }

    private var quotaButton: some View {
        Button {
            dismissKeyboard()
            showsQuota = true
        } label: {
            DSBotIcon(.quota, size: 22)
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
                .contentShape(Circle())
        }
        .buttonStyle(DSBotGlassButtonStyle())
        .accessibilityLabel("额度")
        .accessibilityIdentifier("board.quota")
    }

    private var newIssueButton: some View {
        Button {
            dismissKeyboard()
            isMakingIssue = true
        } label: {
            DSBotIcon(.plus, size: 22)
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
                .contentShape(Circle())
        }
        .buttonStyle(DSBotGlassButtonStyle())
        .accessibilityLabel("新建事项")
        .accessibilityIdentifier("board.new")
    }

    /// The tasks page's "+": the editor of a new task, which the page presents.
    private var newTaskButton: some View {
        Button {
            dismissKeyboard()
            tasks.isMaking = true
        } label: {
            DSBotIcon(.plus, size: 22)
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
                .contentShape(Circle())
        }
        .buttonStyle(DSBotGlassButtonStyle())
        .accessibilityLabel("新建任务")
        .accessibilityIdentifier("tasks.new")
    }

    /// The numbers behind the sidebar's rows: what waits in the Collector, and the tasks that are on.
    private var sidebarCounts: [String: Int] {
        var counts: [String: Int] = [:]
        if collector.waiting > 0 { counts["dudu.collector"] = collector.waiting }
        if tasks.enabled > 0 { counts["dudu.tasks"] = tasks.enabled }
        return counts
    }

    /// The open conversation is an issue's, one of the board's rows.
    private var hasIssuePager: Bool { board.openedIssue(for: store.selectedSession) != nil }

    /// The arrows to the issue before and after the one whose conversation is open, in the order of the board (the desktop's "上一条事项" and "下一条事项").
    private var issuePager: some View {
        HStack(spacing: 0) {
            pagerButton(.up, offset: -1, label: "上一条事项")
            Rectangle().fill(DSBotStyle.ink.opacity(0.12)).frame(width: DSBotLayout.issuePagerDividerWidth, height: 20)
            pagerButton(.down, offset: 1, label: "下一条事项")
        }
        .frame(height: DSBotLayout.toolbarButtonSize)
        .dsbotGlass(in: Capsule())
    }

    private func pagerButton(_ glyph: DSBotGlyph, offset: Int, label: String) -> some View {
        let target = board.neighbor(of: store.selectedSession, offset: offset)
        return Button {
            guard let target else { return }
            DSBotLog.record("issue.pager")
            Task { await openIssue(target) }
        } label: {
            DSBotIcon(glyph, size: 20)
                .foregroundStyle(DSBotStyle.ink.opacity(target == nil ? 0.3 : 1))
                .frame(width: DSBotLayout.issuePagerButtonWidth, height: DSBotLayout.toolbarButtonSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(DSBotIconButtonStyle())
        .disabled(target == nil)
        .accessibilityLabel(label)
        .accessibilityIdentifier("issue.pager.\(offset < 0 ? "previous" : "next")")
    }

    private var sidebarButton: some View {
        Button {
            if isSidebarOpen {
                closeSidebar()
            } else {
                openSidebar()
            }
        } label: {
            DSBotIcon(.menu)
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
                .contentShape(Circle())
        }
        .buttonStyle(DSBotGlassButtonStyle())
        .accessibilityLabel(isSidebarOpen ? "关闭会话列表" : "打开会话列表")
        .accessibilityIdentifier("sidebar.toggle")
    }

    /// Back to where the page was opened from: the board, or the conversation for a page of that conversation.
    private var backButton: some View {
        Button {
            DSBotLog.record("page.back")
            goBack()
        } label: {
            DSBotIcon(.back)
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
                .contentShape(Circle())
        }
        .buttonStyle(DSBotGlassButtonStyle())
        .accessibilityLabel("返回")
        .accessibilityIdentifier("page.back")
    }

    /// The pages that stay valid for as long as this connection lives.
    private var pageConnectionKey: String {
        "\(store.activeComputer?.id ?? "")/\(store.connectionRevision)"
    }

    /// The plugin manager is on screen: the toolbar's right button adds a plugin instead of opening the menu.
    private var isPluginPage: Bool {
        if case .web(.plugins, _) = destination.target { return true }
        return false
    }

    /// Stands in for DSH's black "添加插件" button, which is hidden on the phone along with refresh.
    private var addPluginButton: some View {
        Button {
            pageCommand = PageCommand(name: "add")
        } label: {
            DSBotIcon(.plus, size: 22)
                .foregroundStyle(DSBotStyle.ink)
                .frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
                .contentShape(Circle())
        }
        .buttonStyle(DSBotGlassButtonStyle())
        .accessibilityLabel("添加插件")
        .accessibilityIdentifier("plugins.add")
    }

    @ViewBuilder
    private var conversationMenu: some View {
        let views = menuViews
        if !views.isEmpty {
            Menu {
                if !views.isEmpty {
                    Picker("会话视图", selection: viewSelection(of: views)) {
                        ForEach(views) { Text($0.title).tag($0.id) }
                    }
                }
            } label: {
                DSBotIcon(.options, size: 22)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
                    .dsbotGlass(in: Circle(), interactive: true)
                    .contentShape(Circle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .accessibilityLabel("更多")
            .accessibilityIdentifier("conversation.menu")
        } else {
            Color.clear.frame(width: DSBotLayout.toolbarButtonSize, height: DSBotLayout.toolbarButtonSize)
        }
    }

    /// DSH shows its tabs only when a started conversation has more than one view.
    private var menuViews: [NavigationItem] {
        guard store.selectedSession != nil, !store.isBlankSession else { return [] }
        let views = store.activeNavigation.views
        return views.count > 1 ? views : []
    }

    private func viewSelection(of views: [NavigationItem]) -> Binding<String> {
        Binding(
            get: {
                if destination.showsChat { return views.first { $0.target == .chat }?.id ?? "" }
                return destination.area == .view ? destination.id : ""
            },
            set: { id in
                if let item = views.first(where: { $0.id == id }) { open(item, in: .view) }
            }
        )
    }

    @ViewBuilder
    private func statusBarFrost(safeAreaTop: CGFloat) -> some View {
        let toolbarBottom = safeAreaTop + DSBotLayout.toolbarHeight
        let hasTitle = toolbarDestination.showsChat && conversationChromeIsFromBoard
        if !DSBotScrollEdges.usesSystemEffect {
            DSBotEdgeBlur(
                edge: .top,
                height: hasTitle ? toolbarBottom + 20 : toolbarBottom,
                strength: hasTitle ? 1.4 : 0.8,
                fullStrengthHeight: hasTitle ? toolbarBottom - 4 : 0
            )
            .offset(y: -safeAreaTop)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    /// What covers the conversation while a page of DSH or of the app's own is open.
    @ViewBuilder
    private func pageContent(safeAreaTop: CGFloat) -> some View {
        let toolbarInset: CGFloat = DSBotScrollEdges.usesSystemEffect ? 0 : DSBotLayout.toolbarHeight
        switch destination.target {
        case .chat, .assistant, .unsupported, .dshSettings:
            EmptyView()
        case .board:
            EmptyView()
        case .collector:
            CollectorView(model: collector, board: board, store: store, topInset: toolbarInset) { id in
                Task { await openIssue(id: id) }
            }
        case .files:
            WorkPanelView(store: store)
                .padding(.top, DSBotScrollEdges.usesSystemEffect ? 0 : safeAreaTop)
        case .tasks:
            TasksView(model: tasks, store: store, topInset: toolbarInset) { sessionID in
                guard let session = store.sessions.first(where: { $0.id == sessionID }) else { return }
                showConversation()
                Task { await store.selectSession(session) }
            }
        case .schedule:
            LibraryView(section: "schedule", store: store) { sessionID in
                guard let session = store.sessions.first(where: { $0.id == sessionID }) else { return }
                showConversation()
                Task { await store.selectSession(session) }
            }
            .padding(.top, DSBotScrollEdges.usesSystemEffect ? 0 : safeAreaTop)
        case .duduSettings:
            NativeSettingsView(navigator: settingsNav, store: store, topInset: toolbarInset) { pageToast = $0 }
        case let .web(page, target):
            let sessionID = page.needsSession ? store.selectedSession?.id : nil
            EmbeddedPageView(
                store: store, page: page, target: target, sessionID: sessionID, pool: pagePool,
                command: page == .plugins ? pageCommand : nil,
                commandDelivered: { pageCommand = nil }
            )
                // Pages of plugins this app has no layout for start below the toolbar buttons.
                .padding(.top, [.panel, .view].contains(page) ? toolbarInset : 0)
                // One view identity per page and conversation, so each owns its own session and web view.
                .id("\(page.rawValue)/\(target ?? "")/\(sessionID ?? "")")
        }
    }

    /// Show an entry of DSH's sidebar or conversation views, the way the plugin says to open it.
    private func open(_ item: NavigationItem, in area: NavigationArea) {
        let target = item.target
        if target == .assistant && store.isOpeningAssistant { return }
        DSBotLog.record("navigation.open", state: "page")
        sidebarNavigationRevision &+= 1
        guard target != .unsupported else {
            store.notice = "手机端暂不支持「\(item.title)」"
            return
        }
        if case let .web(page, _) = target, page.needsSession, store.selectedSession == nil {
            store.notice = "先打开一个会话"
            return
        }
        if target == .assistant {
            let revision = sidebarNavigationRevision
            Task {
                guard let session = await store.assistantSession(),
                      revision == sidebarNavigationRevision,
                      isSidebarOpen, !isSearchActive, presentedSheet == nil else { return }
                closeSidebar()
                dismissKeyboard()
                conversationFromBoard = false
                destination = MainDestination(id: item.id, area: area, target: .chat, title: item.title)
                await store.selectSession(session)
            }
            return
        }
        closeSidebar()
        dismissKeyboard()
        destination = target == .chat
            ? .conversation
            : MainDestination(id: item.id, area: area, target: target, title: item.title)
    }

    private func showConversation() {
        conversationFromBoard = false
        returnsToAssistant = false
        destination = .conversation
        closeSidebar()
    }

    /// One level up: a page goes back to the conversation, as it always did; a conversation opened from the board goes back to the board.
    private func goBack() {
        guard !isBoardTransitioning else { return }
        collector.stopSelecting()
        // A page of 嘟嘟's settings opened from another one (a status, a collector) goes back to that one first.
        if destination.target.settingsSection != nil, settingsNav.canPop {
            settingsNav.pop()
            return
        }
        if destination.showsChat {
            if returnsToAssistant { returnToAssistant() } else { returnToBoard() }
            return
        } else {
            destination = .conversation
        }
        closeSidebar()
    }

    private var boardTransitionAnimation: Animation {
        reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.34, dampingFraction: 1)
    }

    private func resetBoardTransition(showingBoard: Bool) {
        boardConversationPreparation = nil
        boardTransitionMetrics.cancel()
        boardMotion.reset(showingConversation: !showingBoard)
    }

    private func presentBoardConversation() {
        closeSidebar()
        boardTransitionMetrics.start(direction: "enter")
        boardMotion.animate(showingConversation: true, animation: boardTransitionAnimation, updates: {
            boardConversationPreparation = nil
            conversationFromBoard = true
            returnsToAssistant = false
            destination = .conversation
        }, completion: {
            boardTransitionMetrics.finish()
        })
    }

    private func presentPreparedBoardConversation(_ request: UUID, target: DraftTarget?) -> Bool {
        guard let preparation = boardConversationPreparation, preparation.id == request else { return false }
        guard target == preparation.target, store.selectedSession?.id == target?.sessionID,
              store.activeComputer?.id == target?.computerID, destination.target == .board,
              preparation.navigationRevision == sidebarNavigationRevision,
              !isSidebarOpen, presentedSheet == nil, !isBoardTransitioning else {
            boardConversationPreparation = nil
            return false
        }
        presentBoardConversation()
        return true
    }

    private func returnToBoard() {
        guard !isBoardTransitioning, destination.showsChat, conversationFromBoard else { return }
        closeSidebar()
        showsConversationTitle = false
        let computer = store.activeComputer?.id
        boardTransitionMetrics.start(direction: "return")
        boardMotion.animate(showingConversation: false, animation: boardTransitionAnimation, completion: {
            guard computer == store.activeComputer?.id,
                  destination.showsChat, conversationFromBoard else { return }
            boardTransitionMetrics.finish()
            conversationFromBoard = false
            destination = .board
        })
    }

    /// The way back from an issue's conversation that was opened from 嘟嘟's chat: that chat again, with no board in between. The chat comes back as it was left (its draft is kept by the store).
    private func returnToAssistant() {
        guard !isBoardTransitioning, destination.showsChat, conversationFromBoard, returnsToAssistant else { return }
        closeSidebar()
        dismissKeyboard()
        showsConversationTitle = false
        conversationFromBoard = false
        returnsToAssistant = false
        Task {
            if let session = await store.assistantSession() { await store.selectSession(session) }
        }
    }

    /// The conversation of an issue, over the board. A session the phone already lists opens at once; one that DSH folded away is put back first.
    /// An issue nobody has yet has no conversation: what it says is shown instead.
    private func openIssue(_ issue: BoardIssue) async {
        guard !isBoardTransitioning else { return }
        dismissKeyboard()
        let origin = destination
        // Opened from 嘟嘟's chat, or paged on from an issue that was: the way back is that chat.
        let fromAssistant = conversationFromBoard ? returnsToAssistant : (destination.showsChat && store.isAssistantConversation)
        let navigationRevision = sidebarNavigationRevision
        let computer = store.activeComputer?.id
        if issue.sessionId == nil {
            issueDetail = issue
            return
        }
        let session: SessionSummary?
        if let id = issue.sessionId, let known = store.sessions.first(where: { $0.id == id }) {
            session = known
        } else {
            session = await board.session(of: issue, using: store)
        }
        guard origin == destination, navigationRevision == sidebarNavigationRevision,
              computer == store.activeComputer?.id, !isBoardTransitioning else { return }
        guard let session else {
            issueDetail = issue
            return
        }
        await selectIssueSession(session, returningToAssistant: fromAssistant)
    }

    /// The conversation of an issue known by its number, opened from 嘟嘟's chat: the way back is that chat (the same chrome as one opened from a card).
    private func openIssueConversation(id: Int) async {
        guard !isBoardTransitioning else { return }
        dismissKeyboard()
        let fromAssistant = conversationFromBoard ? returnsToAssistant : (destination.showsChat && store.isAssistantConversation)
        let origin = destination
        let navigationRevision = sidebarNavigationRevision
        let computer = store.activeComputer?.id
        guard let session = await board.session(ofIssue: id, using: store) else { return }
        guard origin == destination, navigationRevision == sidebarNavigationRevision,
              computer == store.activeComputer?.id, !isBoardTransitioning else { return }
        await selectIssueSession(session, returningToAssistant: fromAssistant)
    }

    private func selectIssueSession(_ session: SessionSummary, returningToAssistant: Bool) async {
        if destination.target == .board {
            let navigationRevision = sidebarNavigationRevision
            let computer = store.activeComputer?.id
            await store.selectSession(session) {
                guard destination.target == .board, navigationRevision == sidebarNavigationRevision,
                      let computer, computer == store.activeComputer?.id, !isBoardTransitioning else { return }
                // Prepare the history and its actual bars while the board still covers the page.
                boardConversationPreparation = BoardConversationPreparation(
                    target: DraftTarget(computerID: computer, sessionID: session.id),
                    navigationRevision: navigationRevision
                )
            }
        } else {
            showConversation()
            conversationFromBoard = true
            returnsToAssistant = returningToAssistant
            await store.selectSession(session)
        }
    }

    /// 信息 and 任务 above the input of 嘟嘟's chat: their pages, with the back button every page has (it leads to the conversation).
    private func openQuickPage(_ kind: QuickCardKind) {
        dismissKeyboard()
        switch kind {
        case .info: destination = MainDestination(id: "dudu.collector", area: .sidebar, target: .collector, title: "信息")
        case .task: destination = MainDestination(id: "dudu.tasks", area: .sidebar, target: .tasks, title: "任务")
        case .todo: break
        }
    }

    /// The same for an issue known by its number (a record that went to it).
    private func openIssue(id: Int) async {
        guard let session = await board.session(ofIssue: id, using: store) else { return }
        showConversation()
        await store.selectSession(session)
    }

#if DEBUG && targetEnvironment(simulator)
    private func reviewArgument(_ name: String) -> String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    private func openReviewItem(_ spec: String) {
        guard let split = spec.firstIndex(of: ":") else { return }
        let id = String(spec[spec.index(after: split)...])
        let navigation = store.activeNavigation
        switch spec[..<split] {
        case "sidebar":
            if let item = navigation.sidebar.first(where: { $0.id == id }) { open(item, in: .sidebar) }
        case "view":
            if let item = navigation.views.first(where: { $0.id == id }) { open(item, in: .view) }
        default:
            break
        }
    }

    /// Open the conversation view that shows this DSH page, as a review launch flag asks.
    private func openReviewView(_ page: String) {
        if let item = store.activeNavigation.views.first(where: { $0.open.web?.page == page }) {
            open(item, in: .view)
        }
    }
#endif

    private func closeSidebar() {
        sidebarNavigationRevision &+= 1
        dismissKeyboard()
        guard isSidebarOpen || drawerMotion.isInteracting else { return }
        if isSidebarOpen { DSBotLog.record("sidebar.close") }
        drawerMotion.settle(animation: drawerAnimation) { isSidebarOpen = false }
    }

    private func openSidebar() {
        dismissKeyboard()
        DSBotLog.record("sidebar.open")
        drawerMotion.settle(animation: drawerAnimation) { isSidebarOpen = true }
    }

    private var drawerAnimation: Animation {
        reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.38, dampingFraction: 0.88)
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(
            #selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func handlePairingURL(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(),
            ["dsbot", "harness-mobile"].contains(scheme),
            url.host?.lowercased() == "connect",
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let link = components.queryItems?.first(where: { $0.name == "url" })?.value,
            !link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }

        pendingPairingLink = link
        DSBotLog.record("pairing.link.prefill")
        presentedSheet = .pairing
    }
}

func libraryTitle(for section: String) -> String {
    switch section {
    case "plugins": return "插件"
    case "schedule": return "任务"
    default: return section
    }
}

private enum RootSheet: String, Identifiable {
    case settings
    case computers
    case pairing

    var id: String { rawValue }
}
