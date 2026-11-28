import SwiftUI
import UIKit

@MainActor
struct DuduRootView: View {
    @ObservedObject private var store: DuduStore
    @ObservedObject private var notifications = AppNotifications.shared
    @State private var handlingNotificationID: UUID?
    @State private var isSidebarOpen = false
    @State private var sidebarNavigationRevision = 0
    @State private var presentedSheet: RootSheet?
    @State private var pendingPairingLink: String?
    @State private var navigation = MainNavigation()
    @State private var homeTab: HomeTab = .board
    @State private var settingsIsAtRoot = true
    @State private var conversationHomeReturn: MainNavigation?
    @State private var pageMotion = BoardPageMotion()
    /// The open conversation was chosen on the board: it has the way back to the board and the arrows between issues, and no views menu. A conversation chosen anywhere else
    /// (the sidebar, the Collector) is the app's own as it was: the sidebar button on the left, the views menu on the right (owner, 2026-11-07: the board is one page, it changes nothing else).
    @State private var conversationFromBoard = false
    /// An issue's conversation opened from 嘟嘟's chat (a row of a todo card) has the chrome of one opened on the board, but its way back is that chat, not the board
    /// (owner, 2026-11-10: "详情返回没有返回到聊天，而是返回到看板").
    @State private var returnsToAssistant = false
    /// Keep Home → Dudu → issue → Dudu → Home on the existing native return path.
    @State private var assistantReturnsToBoard = false
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
    @State private var activityRequest: SessionActivityRequest?
    @State private var quickSheetRequest: AssistantQuickSheetState?
    @State private var returningQuickSheet: AssistantQuickSheetState?
    @State private var composerReply: GroupReplyRequest?
    @State private var quickSheetMaximumHeight: CGFloat = 600
    @State private var quickNavigation: QuickNavigation?
    private enum QuickNavigation {
        case issue(BoardIssue), issueID(Int), session(String), reply(GroupIssue)
    }
    @State private var subagentParents: [SessionSummary] = []
    /// 嘟嘟's own settings, drawn by the app: the pages of the one that is open.
    @StateObject private var settingsNav = SettingsNavigator()
    @State private var isMakingIssue = false
    @State private var issueDetail: BoardIssue?
    /// The result of an action on a page of the app's own (a mark on records), under the toolbar.
    @State private var pageToast: DuduToastMessage?
    @State private var isSearchActive = false
    @State private var conversationSearch = SessionSearchModel()
    /// The board's search page (owner, 2026-11-27, Lark's): over everything, from the magnifier at the top right of the board.
    @State private var isBoardSearching = false
    @StateObject private var boardSearch = SearchModel()
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
    @State private var drawerMotion = DrawerMotion()
    /// DSH pages stay loaded for a few minutes after the user leaves them.
    @StateObject private var pagePool = EmbeddedPagePool()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    init(store: DuduStore) {
        self.store = store
    }

    private var destination: MainDestination { navigation.destination }

    var body: some View {
        Group {
            if store.showsConnectionGuide {
                ConnectionGuideView(
                    store: store,
                    onManualEntry: {
                        pendingPairingLink = nil
                        presentedSheet = .pairing
                        DuduLog.record("pairing.manual")
                    },
                    onOpenComputers: {
                        presentedSheet = .computers
                        DuduLog.record("computers.open")
                    }
                )
                .accessibilityHidden(presentedSheet != nil)
            } else {
                GeometryReader { geometry in
                    drawerStack(in: geometry)
                        .onGeometryChange(for: CGFloat.self) {
                            ($0.size.height + $0.safeAreaInsets.top + $0.safeAreaInsets.bottom) * 0.75 - $0.safeAreaInsets.bottom
                        } action: { quickSheetMaximumHeight = $0 }
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
                .sheet(item: $issueDetail, onDismiss: restoreQuickSheet) { issue in
                    IssueDetailSheet(issue: issue, board: board, store: store)
                }
                .sheet(item: $activityRequest) { request in
                    if request.panel == .tasks {
                        SessionTasksSheet(request: request, model: tasks, store: store, toast: $pageToast)
                    } else {
                        SessionActivitySheet(request: request, store: store) { child in
                            openSubagent(child, from: request)
                        }
                    }
                }
                .sheet(item: $quickSheetRequest, onDismiss: finishQuickSheetDismissal) { request in
                    AssistantQuickSheet(
                        state: request, store: store, board: board, collector: collector, tasks: tasks,
                        maximumHeight: quickSheetMaximumHeight,
                        onOpenIssue: { leaveQuickSheet(request, for: .issue($0)) },
                        onOpenIssueID: { leaveQuickSheet(request, for: .issueID($0)) },
                        onOpenSession: { leaveQuickSheet(request, for: .session($0)) },
                        onReply: { leaveQuickSheet(request, for: .reply($0)) },
                        toast: $pageToast
                    )
                }
            }
        }
        // No primary colour: system controls (menu icons, buttons, alerts) follow the same ink as every icon.
        .tint(DuduStyle.ink)
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
                        SettingsView(store: store, pagePool: pagePool)
                    }
                case .dshSettings:
                    NavigationStack {
                        SettingsView(store: store, pagePool: pagePool, showsOnlyDSHSettings: true)
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
            .presentationDetents(sheet == .pairing ? PairingView.detents : [.large])
            .presentationDragIndicator(.hidden)
            .presentationCornerRadius(32)
            .presentationBackground(DuduStyle.settingsBackground)
        }
        .environment(\.homeIndicatorInset, homeInset)
        #if DEBUG && targetEnvironment(simulator)
        .modifier(SimulatorSheetReview(store: store, board: board, collector: collector, tasks: tasks, maximumHeight: quickSheetMaximumHeight))
        #endif
        .task {
            #if DEBUG && targetEnvironment(simulator)
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-open-sidebar") {
                try? await Task.sleep(nanoseconds: 800_000_000)
                openSidebar()
            }
            if let spec = reviewArgument("-dudu-review-open-item") {
                // "sidebar:insight", "view:notes": open that DSH entry.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                // A view page belongs to a conversation: wait until the fixture has opened one.
                for _ in 0..<40 where store.selectedSession == nil {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
                openReviewItem(spec)
                if ProcessInfo.processInfo.arguments.contains("-dudu-review-board-conversation") {
                    conversationFromBoard = true
                    boardMotion.reset(showingConversation: true)
                }
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-open-settings") {
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                presentedSheet = .settings
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-open-trace") {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                openReviewView("trace")
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-new-task") {
                try? await Task.sleep(nanoseconds: 600_000_000)
                store.beginNewTask()
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-new-task-pick") {
                // New-task home, then a workspace: the conversation opens with project and mode chips.
                try? await Task.sleep(nanoseconds: 600_000_000)
                store.beginNewTask()
                try? await Task.sleep(nanoseconds: 1_200_000_000)
                await store.startTask(in: "notes")
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-open-tasks") {
                // The tasks page, as the sidebar's fourth row opens it.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                conversationFromBoard = false
                openPage(MainDestination(id: "dudu.tasks", area: .sidebar, target: .tasks, title: L10n.text("任务")))
            }
            if let spec = reviewArgument("-dudu-review-search-open") {
                // "<words>|<range>": the search page with the words typed and the range picked (`sessions`, `inbox` or `tasks`; none for the three together). `-dudu-review-search-history a,b,c`
                // seeds the history, `-dudu-review-search-choose agent:claude` chooses one filter of the range.
                try? await Task.sleep(nanoseconds: 1_800_000_000)
                // The page is reset when the computer changes (nil → the fixture's at launch): open it once there is one.
                for _ in 0..<40 where store.activeComputer == nil { try? await Task.sleep(nanoseconds: 250_000_000) }
                try? await Task.sleep(nanoseconds: 600_000_000)
                if let words = reviewArgument("-dudu-review-search-history") {
                    var history = SearchHistory()
                    for word in words.split(separator: ",").reversed() { history.add(String(word)) }
                    SearchMemory.shared.history = history
                }
                let parts = spec.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
                boardSearch.query = parts.first ?? ""
                if parts.count > 1, let scope = SearchScope(rawValue: parts[1]) { boardSearch.select(scope) }
                if let choice = reviewArgument("-dudu-review-search-choose")?.split(separator: ":").map(String.init), choice.count == 2,
                   let field = SearchFilterField(rawValue: choice[0]) { boardSearch.toggle(choice[1], in: field) }
                isBoardSearching = true
            }
            if let seconds = reviewArgument("-dudu-review-press-back").flatMap(Double.init) {
                // The back button, once, after that many seconds: what a tap on it does (the simulator has no finger).
                try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                goBack()
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-open-assistant") {
                // What the sidebar's 嘟嘟 row does once the plugin has named its fixed conversation (the review's navigation has no such row): open that conversation as the plain one.
                for _ in 0..<60 where !store.sessions.contains(where: { $0.isAssistant == true }) {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
                if let session = store.sessions.first(where: { $0.isAssistant == true }) {
                    conversationFromBoard = false
                    resetNavigation(to: .conversation)
                    await store.selectSession(session)
                }
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-page-switch") {
                // Trace, context, team and trace again: each page owns its session, none reopens.
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                for page in ["trace", "context", "team", "trace", "context"] {
                    openReviewView(page)
                    try? await Task.sleep(nanoseconds: 2_500_000_000)
                }
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-page-roundtrip") {
                // Trace page, back to the chat, trace page again: the second visit must not reopen it.
                try? await Task.sleep(nanoseconds: 2_500_000_000)
                openReviewView("trace")
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                showConversation()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                openReviewView("trace")
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-rebuild-chat") {
                // The conversation view is built again with its history already there.
                try? await Task.sleep(nanoseconds: 4_000_000_000)
                reviewChatEpoch += 1
            }
            if ProcessInfo.processInfo.arguments.contains("-dudu-review-page-cycles") {
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
            DuduLog.record("app.start.v\(version).b\(build)")
        }
        .onChange(of: store.activeComputer?.id, initial: true) { _, _ in
            isSidebarOpen = false
            drawerMotion.reset()
            conversationFromBoard = false
            assistantReturnsToBoard = false
            resetBoardTransition(showingBoard: true)
            resetNavigation(to: .board)
            homeTab = .board
            settingsIsAtRoot = true
            conversationHomeReturn = nil
            board.reset(for: store.activeComputer?.id)
            collector.reset()
            tasks.reset()
            quota.reset()
            showsQuota = false
            activityRequest = nil
            quickSheetRequest = nil
            returningQuickSheet = nil
            composerReply = nil
            quickNavigation = nil
            subagentParents = []
            isSearchActive = false
            conversationSearch.reset()
            isBoardSearching = false
            boardSearch.reset()
        }
        .onChange(of: "\(notifications.target?.id.uuidString ?? "")/\(store.isRestoring)/\(store.status)/\(store.navigationAvailability)/\(store.navigation.sidebar.count)", initial: true) { _, _ in
            Task { await openCollectorNotification() }
        }
        .onChange(of: pageConnectionKey, initial: true) { _, key in
            pagePool.connectionChanged(to: key)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background { pagePool.discardReleasedPages() }
            // A board the phone wrote while it was woken in the background (`BoardWake`) is shown at once, before the connection is back.
            if phase == .active { Task { await board.adoptNewerSnapshot() } }
        }
        .onChange(of: store.status) { _, status in
            if status != .connected { pagePool.discardReleasedPages() }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            pagePool.discardReleasedPages()
        }
        .onChange(of: store.selectedSession?.id) { _, id in
            if activityRequest?.session.id != id { activityRequest = nil }
            if quickSheetRequest?.target.sessionID != id { quickSheetRequest = nil }
            if composerReply?.target.sessionID != id { composerReply = nil }
            if store.selectedSession?.subagent == nil { subagentParents = [] }
        }
        .onAppear {
            collector.report = { toast in pageToast = toast }
            tasks.report = { toast in pageToast = toast }
            board.report = { toast in pageToast = toast }
        }
        // The result of an action is told once, on the page where it was done. The toast layer is hidden while a conversation shows and its timer stops with it, so the
        // message stayed and came up again, with a new timer, on the way back (owner, 2026-11-23: 转发 之后「提示好像重复弹出了，而且持续的时间很久」).
        .onChange(of: destination.showsChat) { _, shows in
            if shows { pageToast = nil }
            // Back from a conversation to the search page: what its rows say (a red dot, the time) may have changed while it was read.
            else if isBoardSearching { boardSearch.retry() }
        }
        .onReceive(store.visibleSessionReads) { receipt in
            board.receiveVisibleRead(receipt, using: store)
        }
        .onReceive(store.watchedSessionActivity) { activity in
            board.receiveSessionActivity(activity, using: store)
        }
        .onChange(of: store.isBlankSession) { _, isBlank in
            // DSH shows no conversation views for a conversation that has not started.
            if isBlank, destination.area == .view, !destination.showsChat { resetNavigation(to: .conversation) }
        }
        .task(id: SidebarRefresh(active: sidebarIsActive, connected: store.status == .connected)) {
            guard sidebarIsActive, store.status == .connected else { return }
            async let navigation: Void = store.refreshNavigation()
            async let count: Void = collector.refreshCount(using: store)
            async let taskList: Void = tasks.refresh(using: store)
            _ = await (navigation, count, taskList)
        }
        // A native TabView covers inactive roots. Keep shared badge facts current
        // outside those roots' appearance-scoped tasks.
        .task(id: scenePhase == .active && store.status == .connected ? store.connectionRevision : nil) {
            guard scenePhase == .active, store.status == .connected else { return }
            var firstRead = true
            while !Task.isCancelled {
                async let inbox: Void = collector.refreshCount(using: store)
                // The computer says when the board changes (`board.changed`, below); once it has, this is only the safety net, asked for when nothing has read the board for 30 s.
                // Until then, and with a computer that does not say so, it is the timer of old: every 5 s.
                if firstRead || Date().timeIntervalSince(board.lastRefreshAt) >= (store.boardPushSeen ? 30 : 5) - 0.5 {
                    firstRead = false
                    await board.refresh(using: store)
                }
                await inbox
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
            }
        }
        .onReceive(store.boardChanges) { _ in
            guard scenePhase == .active, store.status == .connected else { return }
            Task { await board.refresh(using: store) }
        }
        .onChange(of: store.showsConnectionGuide) { _, showsGuide in
            if showsGuide {
                closeSidebar()
                if presentedSheet == .settings || presentedSheet == .dshSettings || presentedSheet == .computers {
                    presentedSheet = nil
                }
            }
        }
        .onChange(of: destination) { _, next in
            DuduLog.record("conversation.mode", state: next.logState)
            if navigation.pages.isEmpty, !next.showsChat || !conversationFromBoard {
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

    private var isBoardTransitioning: Bool { boardMotion.isAnimating || pageMotion.isAnimating }

    private var boardPagePosition: BoardPagePosition {
        if HomeTab(target: navigation.root.target) != nil { return .board }
        return navigation.root.showsChat && conversationFromBoard ? .issue : .other
    }

    private struct BoardConversationPreparation {
        let id = UUID()
        let target: DraftTarget
        let navigationRevision: Int
        var trace: BoardOpenTrace?
    }

    private func drawerStack(in geometry: GeometryProxy) -> some View {
        let width = DuduLayout.drawerWidth(in: geometry.size.width)
        return ZStack(alignment: .leading) {
            DuduStyle.canvas.ignoresSafeArea()
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
                        showDrawerConversation()
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
            let inset = DuduLayout.windowSafeAreaBottom
            if inset != homeInset { homeInset = inset }
        }
    }

    private func sidebarLayer(width: CGFloat) -> some View {
        SidebarView(
            store: store,
            onChooseItem: { open($0, in: .sidebar) },
            onChooseConversation: showDrawerConversation,
            onOpenComputers: {
                dismissKeyboard()
                presentedSheet = .computers
                DuduLog.record("computers.open")
            },
            // DSH's own settings (owner, 2026-11-21); 嘟嘟's are the bottom bar's 设置.
            onOpenSettings: {
                dismissKeyboard()
                presentedSheet = .dshSettings
                DuduLog.record("settings.dsh.open")
            },
            onSearch: {
                isSearchActive = true
                DuduLog.record("sidebar.search.open")
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
            ZStack(alignment: .top) {
                HomeTabs(
                    selection: Binding(get: { homeTab }, set: { selectHomeTab($0) }),
                    boardUnread: board.unreadCount, inboxUnread: collector.unreadCount,
                    hidesBar: homeTab == .inbox && collector.isSelecting || isBoardSearching,
                    board: { boardLayer(in: geometry, drawerWidth: drawerWidth) },
                    inbox: { homePage(.inbox, in: geometry, drawerWidth: drawerWidth) },
                    tasks: { homePage(.tasks, in: geometry, drawerWidth: drawerWidth) },
                    settings: { homeSettings(in: geometry, drawerWidth: drawerWidth) }
                )
                .modifier(BoardBackgroundMotion(
                    motion: boardMotion, position: boardPagePosition,
                    width: geometry.size.width, reduceMotion: reduceMotion
                ))
                .allowsHitTesting(HomeTab(target: destination.target) != nil && navigation.pages.isEmpty &&
                    !isSidebarOpen && !isBoardTransitioning)
                .accessibilityHidden(HomeTab(target: destination.target) == nil || !navigation.pages.isEmpty || isSidebarOpen)
                cardContent(in: geometry, drawerWidth: drawerWidth)
                    .modifier(DuduScrollEdgeBar(edge: .top) {
                        toolbar(for: .conversation)
                            .frame(width: geometry.size.width, height: DuduLayout.toolbarHeight)
                            .background {
                                if DuduScrollEdges.usesSystemEffect, conversationHasTitle {
                                    DuduToolbarTitleBackdrop(safeAreaTop: safeTop)
                                }
                            }
                            .modifier(DrawerToolbarEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
                    })
                    // The status bar and the translucent top bar have nothing of their own behind them: the board, kept mounted under the
                    // conversation, showed through (its quota and + buttons, the edge of its page) (owner, 2026-11-20). Back the whole page with the canvas,
                    // and let it move with the page.
                    .background { DuduStyle.canvas.ignoresSafeArea() }
                    .modifier(BoardConversationMotion(
                        motion: boardMotion, position: boardPagePosition,
                        width: geometry.size.width, reduceMotion: reduceMotion
                    ))
                    .allowsHitTesting(destination.showsChat && !isBoardTransitioning)
                    .accessibilityHidden(!destination.showsChat || isBoardTransitioning)
            }
            .modifier(BoardBackgroundMotion(
                motion: pageMotion, position: navigation.pages.count == 1 ? .issue : .board,
                width: geometry.size.width, reduceMotion: reduceMotion
            ))
            .opacity(navigation.pages.count < 2 ? 1 : 0)

            ForEach(navigation.pages) { page in
                let isCurrent = page.id == navigation.pages.last?.id
                let isPrevious = page.id == navigation.pages.dropLast().last?.id
                auxiliaryPage(page.destination, in: geometry, drawerWidth: drawerWidth)
                .modifier(BoardBackgroundMotion(
                    motion: pageMotion, position: isPrevious ? .issue : .board,
                    width: geometry.size.width, reduceMotion: reduceMotion
                ))
                .modifier(BoardConversationMotion(
                    motion: pageMotion, position: isCurrent ? .issue : .other,
                    width: geometry.size.width, reduceMotion: reduceMotion
                ))
                .opacity(isCurrent || isPrevious ? 1 : 0)
                .allowsHitTesting(isCurrent && !isSidebarOpen && !isBoardTransitioning)
                .accessibilityHidden(!isCurrent || isSidebarOpen || isBoardTransitioning)
                .transition(reduceMotion ? .opacity : .asymmetric(insertion: .move(edge: .trailing), removal: .identity))
            }
            // The result of an action on the board or the Collector, under the toolbar; the conversation has its own. This layer already starts below the status bar, so the
            // toolbar's own height is all that is added: with the status bar's height too the toast sat a whole bar too low, on top of the first rows (owner, 2026-11-21: "太低了").
            DuduToastOverlay(message: destination.showsChat ? nil : pageToast) { dismissed in
                if pageToast?.id == dismissed.id { pageToast = nil }
            }
            .padding(.top, DuduLayout.toolbarHeight + 8)
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
        let isBoard = navigation.root.target == .board
        let isVisible = destination.target == .board
        let isActive = isVisible && !isSidebarOpen && !drawerMotion.isMoving && boardConversationPreparation == nil && !pageMotion.isMoving
        let safeTop = geometry.safeAreaInsets.top
        return BoardView(
            board: board, store: store,
            topInset: DuduScrollEdges.usesSystemEffect ? 0
                : DuduLayout.toolbarHeight + (showsBoardConnectionNotice
                    ? BoardConnectionNotice.toolbarSpacing + BoardConnectionNotice.height : 0),
            isActive: isActive,
            onOpen: { issue, trace in await openIssue(issue, trace: trace) },
            onOpenAssistant: { trace in await openHomeAssistant(trace: trace) },
            onDetail: { issue in issueDetail = issue }
        )
        .id(store.activeComputer?.id)
        .environment(\.conversationIsCovered, !isActive)
        .modifier(DrawerPageEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
        .overlay(alignment: .top) {
            if !DuduScrollEdges.usesSystemEffect {
                DuduEdgeBlur(edge: .top, height: safeTop + DuduLayout.toolbarHeight, strength: 0.8)
                    .offset(y: -safeTop)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .modifier(DuduScrollEdgeBar(edge: .top) {
            VStack(spacing: 0) {
                boardToolbar
                    .frame(height: DuduLayout.toolbarHeight)
                if showsBoardConnectionNotice {
                    BoardConnectionNotice()
                        .padding(.top, BoardConnectionNotice.toolbarSpacing)
                }
            }
            .frame(width: geometry.size.width)
            .modifier(DrawerToolbarEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
        })
        // The search page is a layer of the board (owner, 2026-11-27: 「点返回的时候都应该返回到上一页，而不是返回到主页，并且是滑动的效果」): a conversation chosen on it slides in over it as one chosen
        // on the board does, and its way back (the button, the swipe from the left edge) shows the page as it was left.
        .overlay { boardSearchLayer }
        .animation(.easeOut(duration: 0.18), value: isBoardSearching)
        .opacity(homeTab == .board && (isBoard || conversationFromBoard) ? 1 : 0)
        .allowsHitTesting(isVisible && !isSidebarOpen && !isBoardTransitioning)
        .accessibilityHidden(!isVisible || isSidebarOpen || isBoardTransitioning)
    }

    /// All roots stay in the tree, keeping their native list and filter state.
    private func homePage(_ tab: HomeTab, in geometry: GeometryProxy, drawerWidth: CGFloat) -> some View {
        let visible = destination == tab.destination
        return auxiliaryPage(tab.destination, in: geometry, drawerWidth: drawerWidth)
            .id("\(store.activeComputer?.id ?? "")/\(tab.rawValue)")
            .opacity(homeTab == tab ? 1 : 0)
            .allowsHitTesting(visible && !isSidebarOpen && !isBoardTransitioning)
            .accessibilityHidden(!visible || isSidebarOpen || isBoardTransitioning)
    }

    private func homeSettings(in geometry: GeometryProxy, drawerWidth: CGFloat) -> some View {
        NavigationStack {
            SettingsView(
                store: store, pagePool: pagePool,
                isHome: true, isActive: homeTab == .settings && destination.target == .settingsHome,
                onOpenSidebar: openSidebar,
                onRootVisibility: { settingsIsAtRoot = $0 }
            )
        }
        .id(store.activeComputer?.id)
        .environment(\.conversationIsCovered, destination.target != .settingsHome || isSidebarOpen)
        .modifier(DrawerPageEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
        .opacity(homeTab == .settings ? 1 : 0)
        .allowsHitTesting(destination.target == .settingsHome && !isSidebarOpen && !isBoardTransitioning)
        .accessibilityHidden(destination.target != .settingsHome || isSidebarOpen)
    }

    private func selectHomeTab(_ tab: HomeTab) {
        guard !isBoardTransitioning else { return }
        sidebarNavigationRevision &+= 1
        closeSidebar()
        dismissKeyboard()
        collector.stopSelecting()
        conversationFromBoard = false
        returnsToAssistant = false
        assistantReturnsToBoard = false
        conversationHomeReturn = nil
        subagentParents = []
        homeTab = tab
        resetBoardTransition(showingBoard: true)
        resetNavigation(to: tab.destination)
        DuduLog.record("home.tab.select", state: tab.rawValue)
    }

    private var showsBoardConnectionNotice: Bool {
        scenePhase == .active && store.isComputerUnavailable
    }

    /// Every page below the conversation (DSH's web pages, files, automations) is white; the card around
    /// it must be too, or a band of the canvas shows above and below, where the status bar and the back
    /// button sit. Only the conversation is canvas.
    private var cardBackground: Color {
        if destination.target == .board { return .white }
        if destination.target == .settingsHome { return DuduStyle.settingsBackground }
        return destination.onCanvas ? DuduStyle.canvas : .white
    }

    private func cardContent(in geometry: GeometryProxy, drawerWidth: CGFloat) -> some View {
        let safeTop = geometry.safeAreaInsets.top
        let conversationIsMoving = boardMotion.isMoving || pageMotion.isMoving
        return ZStack(alignment: .top) {
            // The conversation stays mounted under every page, from the status bar to the bottom of the
            // screen. Coming back shows it as it was left (scroll position, draft) instead of building a
            // long history again, which could land scrolled past its end: a white screen.
            ChatView(
                store: store,
                isOverlayOpen: isSidebarOpen || drawerMotion.isMoving || presentedSheet != nil || activityRequest != nil || quickSheetRequest != nil || !destination.showsChat || conversationIsMoving,
                historyTopInset: DuduScrollEdges.usesSystemEffect ? 0 : safeTop + DuduLayout.toolbarHeight,
                isPageTransitioning: conversationIsMoving || drawerMotion.isMoving,
                presentationRequest: boardConversationPreparation?.id,
                onPresentationLayout: presentPreparedBoardConversation,
                replyRequest: composerReply
            )
            .id(chatIdentity)
            // Keep history and drafts mounted without composing its glass over another page.
            .opacity(navigation.root.showsChat ? 1 : 0)
            // Keep the toolbar's native safe area: ignoring the top also discards its scroll edge.
            .ignoresSafeArea(.container, edges: DuduScrollEdges.usesSystemEffect ? .bottom : .all)
            .allowsHitTesting(destination.showsChat)
            .accessibilityHidden(!destination.showsChat)
            .environment(\.conversationIsCovered, isSidebarOpen || drawerMotion.isMoving || quickSheetRequest != nil || !destination.showsChat || conversationIsMoving)
            // A row of a todo card in 嘟嘟's chat opens its issue, as a row of the board does.
            .environment(\.openQuickCardIssue, { issue in Task { await openIssue(issue) } })
            // The issue's explicit conversation action opens its ordinary session; the three shortcuts present sheets.
            .environment(\.openIssueConversation, { id in Task { await openIssueConversation(id: id) } })
            .environment(\.openQuickPage, { kind in openQuickPage(kind) })
        }
        .modifier(DrawerPageEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
        .allowsHitTesting(!isSidebarOpen)
        .accessibilityHidden(isSidebarOpen)
        .overlay(alignment: .top) {
            statusBarFrost(safeAreaTop: safeTop)
        }
    }

    /// Each page owns its toolbar and stays mounted while covered by another page. The immediate
    /// predecessor, including the board or the retained chat, is revealed by the same board motion.
    private func auxiliaryPage(_ page: MainDestination, in geometry: GeometryProxy, drawerWidth: CGFloat) -> some View {
        pageContent(for: page, safeAreaTop: geometry.safeAreaInsets.top)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(page.onCanvas ? DuduStyle.canvas : Color.white)
            .environment(\.conversationIsCovered, page != destination || isSidebarOpen || pageMotion.isMoving)
            .modifier(DrawerPageEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
            .overlay(alignment: .top) {
                if !DuduScrollEdges.usesSystemEffect {
                    DuduEdgeBlur(edge: .top, height: geometry.safeAreaInsets.top + DuduLayout.toolbarHeight, strength: 0.8)
                        .offset(y: -geometry.safeAreaInsets.top)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            .modifier(DuduScrollEdgeBar(edge: .top) {
                toolbar(for: page)
                    .frame(width: geometry.size.width, height: DuduLayout.toolbarHeight)
                    .modifier(DrawerToolbarEffect(motion: drawerMotion, isOpen: isSidebarOpen, width: drawerWidth))
            })
    }

    /// Swiping in from the left screen edge pulls the card aside like the menu button does.
    @ViewBuilder
    private func edgeStripLayer(drawerWidth: CGFloat, pageWidth: CGFloat) -> some View {
        if !isSidebarOpen && presentedSheet == nil && !isBoardTransitioning &&
            (destination.target != .settingsHome || settingsIsAtRoot) {
            // The edge pulls the drawer out on the board and on a conversation of the sidebar's; on every page, and on a conversation opened from the board, it is the way back.
            if isBoardSearching, !destination.showsChat {
                // The search page covers the board: the edge is its way back (the page leaves as it came, with no drawer behind it).
                Color.clear
                    .frame(width: DuduLayout.edgeSwipeWidth)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 16).onEnded { value in
                        guard abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                        if value.translation.width > 70 || value.predictedEndTranslation.width > 140 { closeBoardSearch() }
                    })
                    .accessibilityHidden(true)
            } else if HomeTab(target: destination.target) != nil && !collector.isSelecting ||
                (destination.showsChat && !conversationFromBoard && store.selectedSession?.subagent == nil) {
                Color.clear
                    .frame(width: DuduLayout.edgeSwipeWidth)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .modifier(DrawerDragGesture(
                        motion: drawerMotion, opening: true, width: drawerWidth,
                        animation: drawerAnimation,
                        onBegin: {
                            dismissKeyboard()
                            DuduLog.record("sidebar.edge.begin")
                        },
                        onComplete: openSidebar
                    ))
                    .accessibilityHidden(true)
            } else if navigation.previous != nil && !(destination.target.settingsSection != nil && settingsNav.canPop) {
                Color.clear
                    .frame(width: DuduLayout.edgeSwipeWidth)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .modifier(BoardBackGesture(
                        motion: pageMotion, width: pageWidth,
                        onBegin: {
                            dismissKeyboard()
                            DuduLog.record("page.back.drag", state: destination.logState)
                        },
                        onComplete: {
                            DuduLog.record("page.back.edge")
                            returnFromPage()
                        },
                        onCancel: cancelPageBackGesture
                    ))
                    .accessibilityHidden(true)
            } else if destination.showsChat && conversationFromBoard && !returnsToAssistant && store.selectedSession?.subagent == nil {
                Color.clear
                    .frame(width: DuduLayout.edgeSwipeWidth)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .modifier(BoardBackGesture(
                        motion: boardMotion, width: pageWidth,
                        onBegin: {
                            dismissKeyboard()
                            showsConversationTitle = false
                            boardTransitionMetrics.start(direction: "drag")
                            DuduLog.record("board.back.drag")
                        },
                        onComplete: {
                            DuduLog.record("page.back.edge")
                            returnToBoard()
                        },
                        onCancel: cancelBoardBackGesture
                    ))
                    .accessibilityHidden(true)
            } else {
                Color.clear
                    .frame(width: DuduLayout.edgeSwipeWidth)
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

    private func cancelPageBackGesture() {
        guard pageMotion.isInteracting else { return }
        pageMotion.animate(showingConversation: true, animation: boardTransitionAnimation)
    }

    private func edgeBackGesture() -> some Gesture {
        DragGesture(minimumDistance: 16)
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                if value.translation.width > 70 || value.predictedEndTranslation.width > 140 {
                    DuduLog.record("page.back.edge")
                    goBack()
                }
            }
    }


    /// The app opens on the board (owner, 2026-11-07), a page like the Collector that the sidebar's list leads to: the sidebar on the left, a new issue on the right.
    /// Nothing else is the board's. The conversation has the sidebar button and the views menu as it always had, and every other page (DSH's web pages, files, automations,
    /// the Collector) has its way back and its own action (the Collector's choosing, the plugin page's "+"). Only a conversation chosen on the board has the way back to
    /// the board and the arrows to the issue before and after, in place of the views menu.
    private func toolbar(for page: MainDestination) -> some View {
        let title = boardConversationTitle(for: page)
        return ZStack {
            HStack(spacing: title == nil ? 8 : 12) {
                toolbarLeading(for: page)
                if let title {
                    conversationTitle(title)
                } else {
                    Spacer(minLength: 0)
                }
                toolbarTrailing(for: page)
            }
            if title == nil, let title = toolbarTitle(for: page) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                    .lineLimit(1)
                    .padding(.horizontal, DuduLayout.toolbarButtonSize * 2 + 24)
                    .allowsHitTesting(false)
                    .accessibilityAddTraits(.isHeader)
            }
        }
        .padding(.horizontal, DuduLayout.toolbarHorizontalPadding)
        .frame(height: DuduLayout.toolbarHeight, alignment: .top)
    }

    private var boardToolbar: some View {
        HStack(spacing: 8) {
            sidebarButton
            Spacer(minLength: 0)
            boardTrailing
        }
        .padding(.horizontal, DuduLayout.toolbarHorizontalPadding)
        .frame(height: DuduLayout.toolbarHeight, alignment: .top)
    }

    /// The owner's reference (2026-11-08): a compact title after the back button, without the issue ID.
    /// Let the actual controls bound its width so long titles have all the remaining room.
    /// A title that fits is plain text, so a tap on the bar does nothing (owner, 2026-11-20: a tap on the blurred top opened a popup that only said the title again).
    /// A title that is cut at the end opens whole in a native popover on tap (owner, 2026-11-08).
    private func conversationTitle(_ title: String) -> some View {
        ViewThatFits(in: .horizontal) {
            conversationTitleText(title)
                .fixedSize(horizontal: true, vertical: false)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: DuduLayout.toolbarHeight)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("issue.title")
            Button {
                showsConversationTitle = true
            } label: {
                conversationTitleText(title)
                    .truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(height: DuduLayout.toolbarHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(DuduQuietPressStyle())
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("issue.title")
            .popover(isPresented: $showsConversationTitle, arrowEdge: .top) {
                Text(title)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(16)
                    .frame(idealWidth: 280, maxWidth: 320)
                    .presentationCompactAdaptation(.popover)
            }
        }
        .onChange(of: title) { _, _ in showsConversationTitle = false }
        .onDisappear { showsConversationTitle = false }
    }

    private func conversationTitleText(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(DuduStyle.ink)
            .lineLimit(1)
    }

    private func boardConversationTitle(for page: MainDestination) -> String? {
        if page.showsChat, store.selectedSession?.subagent != nil { return store.selectedSession?.title }
        guard page.showsChat, conversationChromeIsFromBoard else { return nil }
        guard !store.isAssistantConversation else { return nil }
        return board.openedIssue(for: store.selectedSession)?.title ?? store.selectedSession?.title
    }

    private var conversationChromeIsFromBoard: Bool {
        conversationFromBoard || boardConversationPreparation != nil
    }

    private func toolbarTitle(for page: MainDestination) -> String? {
        switch page.target {
        case .chat: return store.isAssistantConversation ? L10n.text("嘟嘟") : nil
        case .collector: return collector.isSelecting ? L10n.text("已选 {0} 条", "\(collector.selection.count)") : page.title
        case .tasks: return page.title
        case .duduSettings: return settingsNav.title
        default: return nil
        }
    }

    /// Both inline issue titles and the centered assistant title use the same readable backing.
    private var conversationHasTitle: Bool {
        boardConversationTitle(for: .conversation) != nil || toolbarTitle(for: .conversation) != nil
    }

    @ViewBuilder
    private func toolbarLeading(for page: MainDestination) -> some View {
        switch page.target {
        case .board:
            sidebarButton
        case .chat where !conversationChromeIsFromBoard && store.selectedSession?.subagent == nil:
            sidebarButton
        case .collector where collector.isSelecting:
            Button {
                collector.stopSelecting()
            } label: {
                DuduBarGlyph(.close)
                    .frame(width: DuduLayout.toolbarButtonSize, height: DuduLayout.toolbarButtonSize)
                    .contentShape(Circle())
            }
            .buttonStyle(DuduGlassButtonStyle())
            .accessibilityLabel(L10n.text("取消选择"))
            .accessibilityIdentifier("collector.selection.cancel")
        case .collector where navigation.pages.isEmpty, .tasks where navigation.pages.isEmpty:
            sidebarButton
        default:
            backButton
        }
    }

    @ViewBuilder
    private func toolbarTrailing(for page: MainDestination) -> some View {
        switch page.target {
        case .board:
            boardTrailing
        case .chat:
            conversationMenu
        case .collector:
            if collector.isSelecting {
                if !collector.allSelected {
                    Button {
                        collector.selectAll()
                    } label: {
                        Text(L10n.text("全选"))
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(DuduStyle.ink)
                            .padding(.horizontal, 18)
                            .frame(height: DuduLayout.toolbarButtonSize)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(DuduGlassCapsuleButtonStyle())
                    .accessibilityIdentifier("collector.selectAll")
                }
            }
        case .tasks:
            newTaskButton
        case .duduSettings:
            NativeSettingsToolbarActions(navigator: settingsNav, store: store, usesGlass: true) { pageToast = $0 }
        default:
            EmptyView()
        }
    }

    /// The board's two buttons in one glass capsule (owner, 2026-11-27, after the Lark search): the magnifier, and "···" with 新建事项 and 额度 in its menu (the system menu, as the conversation's).
    private var boardTrailing: some View {
        HStack(spacing: 0) {
            searchButton
            boardMenu
        }
        .duduGlass(in: Capsule())
        .overlay {
            Rectangle()
                .fill(DuduStyle.chatDivider)
                .frame(width: 0.7, height: 18)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    private var searchButton: some View {
        Button {
            dismissKeyboard()
            isBoardSearching = true
            DuduLog.record("board.search.open")
        } label: {
            DuduIcon(.search, size: 22)
                .foregroundStyle(DuduStyle.ink)
                .frame(width: DuduLayout.toolbarButtonSize, height: DuduLayout.toolbarButtonSize)
                .contentShape(Rectangle())
        }
        .buttonStyle(DuduQuietPressStyle())
        .accessibilityLabel(L10n.text("搜索"))
        .accessibilityIdentifier("board.search")
    }

    private var boardMenu: some View {
        Menu {
            Button {
                dismissKeyboard()
                isMakingIssue = true
            } label: {
                DuduLabel(L10n.text("事项"), icon: .plus, ink: 17)
            }
            .accessibilityIdentifier("board.new")
            Button {
                dismissKeyboard()
                showsQuota = true
            } label: {
                DuduLabel(L10n.text("额度"), icon: .quota, ink: 17)
            }
            .accessibilityIdentifier("board.quota")
        } label: {
            DuduIcon(.options, size: 22)
                .foregroundStyle(DuduStyle.ink)
                .frame(width: DuduLayout.toolbarButtonSize, height: DuduLayout.toolbarButtonSize)
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(DuduQuietPressStyle())
        .menuIndicator(.hidden)
        .accessibilityLabel(L10n.text("更多"))
        .accessibilityIdentifier("board.menu")
    }

    @ViewBuilder private var boardSearchLayer: some View {
        if isBoardSearching {
            SearchView(
                model: boardSearch, board: board, collector: collector, tasks: tasks, store: store,
                onClose: closeBoardSearch,
                onOpenConversation: openSearchedConversation,
                onOpenIssue: { id in Task { await openIssueConversation(id: id) } },
                onOpenSession: { sessionID in
                    guard let session = store.sessions.first(where: { $0.id == sessionID }) else { return }
                    showConversation(returningToHome: true)
                    Task { await store.selectSession(session) }
                }
            )
            .transition(.opacity)
        }
    }

    private func closeBoardSearch() {
        dismissKeyboard()
        isBoardSearching = false
        boardSearch.reset()
    }

    /// A conversation chosen on the search page opens as one chosen on the board does (an issue nobody has yet says so instead); the page stays under it.
    private func openSearchedConversation(_ entry: BoardConversation) {
        dismissKeyboard()
        guard let issue = entry.issue else {
            Task { await openHomeAssistant(trace: BoardOpenTrace()) }
            return
        }
        if issue.agent == nil {
            board.report?(DuduToastMessage(text: L10n.text("请分配智能体"), kind: .information))
            return
        }
        Task { await openIssue(issue, trace: BoardOpenTrace()) }
    }

    /// The tasks page's "+": the editor of a new task, which the page presents.
    private var newTaskButton: some View {
        Button {
            dismissKeyboard()
            tasks.isMaking = true
        } label: {
            DuduIcon(.plus, size: 22)
                .foregroundStyle(DuduStyle.ink)
                .frame(width: DuduLayout.toolbarButtonSize, height: DuduLayout.toolbarButtonSize)
                .contentShape(Circle())
        }
        .buttonStyle(DuduGlassButtonStyle())
        .accessibilityLabel(L10n.text("新建任务"))
        .accessibilityIdentifier("tasks.new")
    }

    /// The numbers behind the sidebar's rows: what waits in the Collector, and the tasks that are on.
    private var sidebarCounts: [String: Int] {
        var counts: [String: Int] = [:]
        if collector.waiting > 0 { counts["dudu.collector"] = collector.waiting }
        if tasks.enabled > 0 { counts["dudu.tasks"] = tasks.enabled }
        return counts
    }

    private var sidebarButton: some View {
        Button {
            if isSidebarOpen {
                closeSidebar()
            } else {
                openSidebar()
            }
        } label: {
            DuduIcon(.menu)
                .foregroundStyle(DuduStyle.ink)
                .frame(width: DuduLayout.toolbarButtonSize, height: DuduLayout.toolbarButtonSize)
                .contentShape(Circle())
        }
        .buttonStyle(DuduGlassButtonStyle())
        .accessibilityLabel(isSidebarOpen ? L10n.text("关闭会话列表") : L10n.text("打开会话列表"))
        .accessibilityIdentifier("sidebar.toggle")
    }

    /// Back to where the page was opened from: the board, or the conversation for a page of that conversation.
    private var backButton: some View {
        Button {
            DuduLog.record("page.back")
            goBack()
        } label: {
            DuduBarGlyph(.back)
                .frame(width: DuduLayout.toolbarButtonSize, height: DuduLayout.toolbarButtonSize)
                .contentShape(Circle())
        }
        .buttonStyle(DuduGlassButtonStyle())
        .accessibilityLabel(L10n.text("返回"))
        .accessibilityIdentifier("page.back")
    }

    /// The pages that stay valid for as long as this connection lives.
    private var pageConnectionKey: String {
        "\(store.activeComputer?.id ?? "")/\(store.connectionRevision)"
    }

    @ViewBuilder
    private var conversationMenu: some View {
        if store.selectedSession != nil, !store.isBlankSession {
            Menu {
                Button {
                    openActivity(.team)
                } label: {
                    Label { Text(L10n.text("智能体团队")) } icon: { DuduIcon(.team, size: 20) }
                }
                Button {
                    openActivity(.jobs)
                } label: {
                    Label { Text(L10n.text("后台任务")) } icon: { DuduIcon(.stateWorking, size: 20) }
                }
                Button {
                    openActivity(.tasks)
                } label: {
                    Label { Text(L10n.text("定时任务")) } icon: { DuduIcon(.schedule, size: 20) }
                }
            } label: {
                DuduIcon(.options, size: 22)
                    .foregroundStyle(DuduStyle.ink)
                    .frame(width: DuduLayout.toolbarButtonSize, height: DuduLayout.toolbarButtonSize)
                    .duduGlass(in: Circle(), interactive: true)
                    .contentShape(Circle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .accessibilityLabel(L10n.text("更多"))
            .accessibilityIdentifier("conversation.menu")
        } else {
            Color.clear.frame(width: DuduLayout.toolbarButtonSize, height: DuduLayout.toolbarButtonSize)
        }
    }

    private func openActivity(_ panel: SessionActivityPanel) {
        guard let session = store.selectedSession, let computer = store.activeComputer else { return }
        dismissKeyboard()
        activityRequest = SessionActivityRequest(panel: panel, computerID: computer.id, session: session)
    }

    private func openSubagent(_ child: SessionSummary, from request: SessionActivityRequest) {
        guard store.activeComputer?.id == request.computerID, store.selectedSession?.id == request.session.id,
              child.subagent?.parentSessionId == request.session.id else { return }
        activityRequest = nil
        subagentParents.append(request.session)
        dismissKeyboard()
        Task { await store.selectSession(child) }
    }

    private func returnFromSubagent() {
        guard let address = store.selectedSession?.subagent else { return }
        guard store.status == .connected else {
            store.error = DuduFailure.disconnected.localizedDescription
            return
        }
        let parent = subagentParents.popLast() ?? store.sessions.first { $0.id == address.parentSessionId }
        guard let parent else {
            store.error = DuduFailure.remote("NOT_FOUND").localizedDescription
            return
        }
        dismissKeyboard()
        Task { await store.selectSession(parent) }
    }

    @ViewBuilder
    private func statusBarFrost(safeAreaTop: CGFloat) -> some View {
        let toolbarBottom = safeAreaTop + DuduLayout.toolbarHeight
        let hasTitle = conversationHasTitle
        if !DuduScrollEdges.usesSystemEffect {
            DuduEdgeBlur(
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
    private func pageContent(for page: MainDestination, safeAreaTop: CGFloat) -> some View {
        let toolbarInset: CGFloat = DuduScrollEdges.usesSystemEffect ? 0 : DuduLayout.toolbarHeight
        switch page.target {
        case .chat, .assistant, .unsupported, .dshSettings, .settingsHome:
            EmptyView()
        case .board:
            EmptyView()
        case .collector:
            CollectorView(model: collector, board: board, store: store, topInset: toolbarInset) { id in
                Task { await openIssueConversation(id: id) }
            }
        case .files:
            WorkPanelView(store: store)
                .padding(.top, DuduScrollEdges.usesSystemEffect ? 0 : safeAreaTop)
        case .tasks:
            TasksView(model: tasks, store: store, topInset: toolbarInset) { sessionID in
                guard let session = store.sessions.first(where: { $0.id == sessionID }) else { return }
                showConversation(returningToHome: true)
                Task { await store.selectSession(session) }
            }
        case .duduSettings:
            NativeSettingsView(navigator: settingsNav, store: store, topInset: toolbarInset) { pageToast = $0 }
        case let .web(page, target):
            let sessionID = page.needsSession ? store.selectedSession?.id : nil
            EmbeddedPageView(
                store: store, page: page, target: target, sessionID: sessionID, pool: pagePool
            )
                // Pages of plugins this app has no layout for start below the toolbar buttons.
                .padding(.top, toolbarInset)
                // One view identity per page and conversation, so each owns its own session and web view.
                .id("\(page.rawValue)/\(target ?? "")/\(sessionID ?? "")")
        }
    }

    /// Show an entry of DSH's sidebar or conversation views, the way the plugin says to open it.
    private func open(_ item: NavigationItem, in area: NavigationArea) {
        let target = item.target
        if target == .assistant && store.isOpeningAssistant { return }
        DuduLog.record("navigation.open", state: "page")
        sidebarNavigationRevision &+= 1
        guard target != .unsupported else {
            store.notice = L10n.text("手机端暂不支持「{0}」", "\(item.title)")
            return
        }
        if case let .web(page, _) = target, page.needsSession, store.selectedSession == nil {
            store.notice = L10n.text("先打开一个会话")
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
                assistantReturnsToBoard = false
                returnsToAssistant = false
                resetNavigation(to: MainDestination(id: item.id, area: area, target: .chat, title: item.title))
                await store.selectSession(session)
            }
            return
        }
        closeSidebar()
        dismissKeyboard()
        if target == .chat {
            showConversation()
        } else if let tab = HomeTab(target: target) {
            selectHomeTab(tab)
        } else {
            openPage(MainDestination(id: item.id, area: area, target: target, title: item.title))
        }
    }

    private func resetNavigation(to next: MainDestination) {
        pageMotion.reset(showingConversation: true)
        navigation.reset(to: next)
    }

    private func openPage(_ next: MainDestination) {
        guard next != destination else { return }
        boardConversationPreparation = nil
        if let section = next.target.settingsSection { settingsNav.reset(section: section) }
        DuduLog.record("navigation.push", state: "\(destination.logState)_\(next.logState)")
        pageMotion.animate(showingConversation: true, animation: boardTransitionAnimation, updates: {
            navigation.open(next)
        })
    }

    private func returnFromPage() {
        guard !pageMotion.isAnimating, let page = navigation.pages.last else { return }
        let computer = store.activeComputer?.id
        collector.stopSelecting()
        closeSidebar()
        pageMotion.animate(showingConversation: false, animation: boardTransitionAnimation, completion: {
            guard computer == store.activeComputer?.id, navigation.pop(expected: page.id) else { return }
            pageMotion.reset(showingConversation: true)
            DuduLog.record("navigation.return", state: destination.logState)
        })
    }

    private func showConversation() {
        showConversation(returningToHome: false)
    }

    /// A conversation chosen in the drawer, or found by its search, comes from the home page that was open: its back button and the swipe in from the left edge return there, as they do for a conversation opened from the board (owner, 2026-11-21: "从侧边栏点会话进去之后…左上角竟然不是返回按钮，点一下应该直接能返回到首页，或者左滑也能返回到首页"). It used to become a root of its own, with the menu button in place of the back arrow.
    private func showDrawerConversation() {
        showConversation(returningToHome: !destination.showsChat && HomeTab(target: navigation.root.target) != nil)
    }

    private func showConversation(returningToHome: Bool) {
        let origin = navigation
        subagentParents = []
        conversationFromBoard = returningToHome
        conversationHomeReturn = returningToHome ? origin : nil
        returnsToAssistant = false
        assistantReturnsToBoard = false
        resetNavigation(to: .conversation)
        if returningToHome { boardMotion.reset(showingConversation: true) }
        closeSidebar()
    }

    private func openCollectorNotification() async {
        guard let target = notifications.target, !store.isRestoring,
              handlingNotificationID != target.id else { return }
        handlingNotificationID = target.id
        defer { if handlingNotificationID == target.id { handlingNotificationID = nil } }
        guard let computer = store.computers.first(where: { $0.computerId == target.computerID }) else {
            notifications.consumed(target.id)
            return
        }
        if store.activeComputer?.id != computer.id { await store.selectComputer(computer) }
        guard !Task.isCancelled, notifications.target?.id == target.id,
              store.activeComputer?.id == computer.id, store.status == .connected,
              let item = store.navigation.sidebar.first(where: { $0.target == .collector }) else { return }
        presentedSheet = nil
        quickSheetRequest = nil
        returningQuickSheet = nil
        isSearchActive = false
        collector.stopSelecting()
        open(item, in: .sidebar)
        notifications.consumed(target.id)
        await collector.refresh(using: store)
    }

    /// A page returns to its actual predecessor. The retained conversation is independent of this path.
    private func goBack() {
        guard !isBoardTransitioning else { return }
        collector.stopSelecting()
        // A page of 嘟嘟's settings opened from another one (a status, a collector) goes back to that one first.
        if destination.target.settingsSection != nil, settingsNav.canPop {
            settingsNav.pop()
            return
        }
        if destination.showsChat {
            if store.selectedSession?.subagent != nil { returnFromSubagent(); return }
            if returnsToAssistant { returnToAssistant() } else { returnToBoard() }
            return
        }
        returnFromPage()
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
        let trace = boardConversationPreparation?.trace
        trace?.record("transition_begin")
        closeSidebar()
        boardTransitionMetrics.start(direction: "enter")
        boardMotion.animate(showingConversation: true, animation: boardTransitionAnimation, updates: {
            conversationHomeReturn = navigation
            boardConversationPreparation = nil
            conversationFromBoard = true
            returnsToAssistant = false
            resetNavigation(to: .conversation)
        }, completion: {
            boardTransitionMetrics.finish()
            trace?.record("visible")
        })
    }

    private func presentPreparedBoardConversation(_ request: UUID, target: DraftTarget?) -> Bool {
        guard let preparation = boardConversationPreparation, preparation.id == request else { return false }
        guard target == preparation.target, store.selectedSession?.id == target?.sessionID,
              store.activeComputer?.id == target?.computerID, destination.target == .board,
              preparation.navigationRevision == sidebarNavigationRevision,
              !isSidebarOpen, presentedSheet == nil, !isBoardTransitioning else {
            preparation.trace?.record("blocked", state: "layout_stale")
            boardConversationPreparation = nil
            return false
        }
        preparation.trace?.record("layout_ready")
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
            assistantReturnsToBoard = false
            let returning = conversationHomeReturn
            conversationHomeReturn = nil
            pageMotion.reset(showingConversation: true)
            if let returning {
                navigation = returning
                if let tab = HomeTab(target: returning.root.target) { homeTab = tab }
            } else {
                resetNavigation(to: homeTab.destination)
            }
        })
    }

    /// The way back from an issue's conversation that was opened from 嘟嘟's chat: that chat again, with no board in between. The chat comes back as it was left (its draft is kept by the store).
    private func returnToAssistant() {
        guard !isBoardTransitioning, destination.showsChat, conversationFromBoard, returnsToAssistant else { return }
        closeSidebar()
        dismissKeyboard()
        showsConversationTitle = false
        conversationFromBoard = assistantReturnsToBoard
        returnsToAssistant = false
        resetBoardTransition(showingBoard: !assistantReturnsToBoard)
        let computer = store.activeComputer?.id
        let revision = sidebarNavigationRevision
        Task {
            if let session = await store.assistantSession(), computer == store.activeComputer?.id,
               revision == sidebarNavigationRevision, destination.showsChat, !returnsToAssistant {
                await store.selectSession(session)
                if let sheet = returningQuickSheet, sheet.isCurrent(store), store.isAssistantConversation {
                    returningQuickSheet = nil
                    quickSheetRequest = sheet
                }
            }
        }
    }

    private func openHomeAssistant(trace: BoardOpenTrace? = nil) async {
        guard destination.target == .board, !isBoardTransitioning else {
            trace?.record("blocked", state: "transition_or_page"); return
        }
        trace?.record("resolve", state: "assistant")
        let computer = store.activeComputer?.id
        let revision = sidebarNavigationRevision
        guard let session = await store.assistantSession(), computer == store.activeComputer?.id,
              revision == sidebarNavigationRevision, destination.target == .board, !isBoardTransitioning else {
            trace?.record("blocked", state: "resolve_unavailable"); return
        }
        assistantReturnsToBoard = true
        SearchMemory.shared.recordOpen("assistant", computer: computer)
        await selectIssueSession(session, returningToAssistant: false, trace: trace)
    }

    /// The conversation of an issue, over the board. A session the phone already lists opens at once; one that DSH folded away is put back first.
    /// An issue nobody has yet has no conversation: what it says is shown instead.
    private func openIssue(_ issue: BoardIssue, trace: BoardOpenTrace? = nil) async {
        guard !isBoardTransitioning else { trace?.record("blocked", state: "transition"); return }
        dismissKeyboard()
        let origin = destination
        // Opened from 嘟嘟's chat, or paged on from an issue that was: the way back is that chat.
        let fromAssistant = destination.showsChat && (store.isAssistantConversation || (conversationFromBoard && returnsToAssistant))
        let navigationRevision = sidebarNavigationRevision
        let computer = store.activeComputer?.id
        if issue.sessionId == nil {
            trace?.record("detail", state: "no_session")
            issueDetail = issue
            return
        }
        let session: SessionSummary?
        if let id = issue.sessionId, let known = store.sessions.first(where: { $0.id == id }) {
            trace?.record("resolve", state: "listed_session")
            session = known
        } else {
            trace?.record("resolve", state: "remote_session")
            session = await board.session(of: issue, using: store)
        }
        guard origin == destination, navigationRevision == sidebarNavigationRevision,
              computer == store.activeComputer?.id, !isBoardTransitioning else {
            trace?.record("blocked", state: "origin_changed"); return
        }
        guard let session else {
            trace?.record("detail", state: "resolve_unavailable")
            issueDetail = issue
            return
        }
        SearchMemory.shared.recordOpen("issue:\(issue.id)", computer: computer)
        await selectIssueSession(session, returningToAssistant: fromAssistant, trace: trace)
    }

    /// The conversation of an issue known by its number, opened from 嘟嘟's chat: the way back is that chat (the same chrome as one opened from a card).
    private func openIssueConversation(id: Int) async {
        guard !isBoardTransitioning else { return }
        dismissKeyboard()
        let fromAssistant = destination.showsChat && (store.isAssistantConversation || (conversationFromBoard && returnsToAssistant))
        let origin = destination
        let navigationRevision = sidebarNavigationRevision
        let computer = store.activeComputer?.id
        guard let session = await board.session(ofIssue: id, using: store) else { return }
        guard origin == destination, navigationRevision == sidebarNavigationRevision,
              computer == store.activeComputer?.id, !isBoardTransitioning else { return }
        SearchMemory.shared.recordOpen("issue:\(id)", computer: computer)
        await selectIssueSession(session, returningToAssistant: fromAssistant)
    }

    private func selectIssueSession(_ session: SessionSummary, returningToAssistant: Bool, trace: BoardOpenTrace? = nil) async {
        trace?.record("select_begin")
        if destination.target == .board {
            let navigationRevision = sidebarNavigationRevision
            let computer = store.activeComputer?.id
            await store.selectSession(session) {
                guard destination.target == .board, navigationRevision == sidebarNavigationRevision,
                      let computer, computer == store.activeComputer?.id, !isBoardTransitioning else {
                    trace?.record("blocked", state: "preparation_stale"); return
                }
                // Prepare the history and its actual bars while the board still covers the page.
                boardConversationPreparation = BoardConversationPreparation(
                    target: DraftTarget(computerID: computer, sessionID: session.id),
                    navigationRevision: navigationRevision, trace: trace
                )
                trace?.record("layout_wait")
            }
        } else {
            let assistantOrigin = returningToAssistant && assistantReturnsToBoard
            let fromHome = !destination.showsChat && HomeTab(target: navigation.root.target) != nil
            showConversation(returningToHome: fromHome)
            assistantReturnsToBoard = assistantOrigin
            conversationFromBoard = true
            returnsToAssistant = returningToAssistant
            await store.selectSession(session)
        }
        trace?.record("select_finished")
    }

    /// Present before requesting data; the main conversation and its draft stay mounted beneath.
    private func openQuickPage(_ kind: QuickCardKind) {
        guard quickSheetRequest == nil, let computer = store.activeComputer?.id,
              let session = store.selectedSession, session.isAssistant == true else { return }
        dismissKeyboard()
        returningQuickSheet = nil
        quickSheetRequest = AssistantQuickSheetState(kind: kind, target: DraftTarget(computerID: computer, sessionID: session.id))
    }

    private func leaveQuickSheet(_ sheet: AssistantQuickSheetState, for destination: QuickNavigation) {
        returningQuickSheet = sheet
        quickNavigation = destination
        quickSheetRequest = nil
    }

    private func finishQuickSheetDismissal() {
        collector.stopSelecting()
        guard let navigation = quickNavigation, let sheet = returningQuickSheet else { return }
        quickNavigation = nil
        Task {
            guard sheet.isCurrent(store) else { returningQuickSheet = nil; return }
            switch navigation {
            case .reply(let issue):
                // Focus only after UIKit has dismissed the sheet. Use the group's existing reply action.
                returningQuickSheet = nil
                composerReply = GroupReplyRequest(target: sheet.target, issue: issue)
                return
            case .issue(let issue):
                await openIssue(issue)
            case .issueID(let id):
                await openIssueConversation(id: id)
            case .session(let id):
                if !store.sessions.contains(where: { $0.id == id }) { await store.refreshSessions() }
                guard sheet.isCurrent(store) else { return }
                if let session = store.sessions.first(where: { $0.id == id }) {
                    await selectIssueSession(session, returningToAssistant: true)
                } else {
                    store.error = DuduFailure.remote("NOT_FOUND").localizedDescription
                }
            }
            restoreQuickSheet()
        }
    }

    private func restoreQuickSheet() {
        guard let sheet = returningQuickSheet, sheet.isCurrent(store), issueDetail == nil, quickNavigation == nil else { return }
        returningQuickSheet = nil
        quickSheetRequest = sheet
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
        if isSidebarOpen { DuduLog.record("sidebar.close") }
        drawerMotion.settle(animation: drawerAnimation) { isSidebarOpen = false }
    }

    private func openSidebar() {
        dismissKeyboard()
        DuduLog.record("sidebar.open")
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
            ["dudu", "harness-mobile"].contains(scheme),
            url.host?.lowercased() == "connect",
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
            let link = components.queryItems?.first(where: { $0.name == "url" })?.value,
            !link.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { return }

        pendingPairingLink = link
        DuduLog.record("pairing.link.prefill")
        presentedSheet = .pairing
    }
}

func libraryTitle(for section: String) -> String {
    switch section {
    case "plugins": return L10n.text("插件")
    case "schedule": return L10n.text("任务")
    default: return section
    }
}

private enum RootSheet: String, Identifiable {
    case settings
    case dshSettings
    case computers
    case pairing

    var id: String { rawValue }
}
