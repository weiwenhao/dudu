import SwiftUI
import UIKit

/// Which part of the app an entry was chosen from; the sidebar highlights only its own.
enum NavigationArea: Equatable {
    case sidebar, view, dock
}

/// What fills the main area: the conversation, a screen of the app's own, or an embedded DSH page.
struct MainDestination: Equatable {
    var id: String
    var area: NavigationArea
    var target: NavigationTarget
    var title: String

    static let conversation = MainDestination(id: "chat", area: .view, target: .chat, title: "对话")

    var showsChat: Bool { target == .chat }

    /// A short, log-safe name for the target.
    var logState: String {
        switch target {
        case .chat: return "conversation"
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
    @State private var presentedSheet: RootSheet?
    @State private var pendingPairingLink: String?
    @State private var destination = MainDestination.conversation
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
    @State private var edgeDragOffset: CGFloat = 0
    /// DSH pages stay loaded for a few minutes after the user leaves them.
    @StateObject private var pagePool = EmbeddedPagePool()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState(
        resetTransaction: Transaction(animation: .spring(response: 0.38, dampingFraction: 0.88))
    ) private var drawerDrag: CGFloat = 0

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
                isSidebarOpen = true
            }
            if let spec = reviewArgument("-dsbot-review-open-item") {
                // "sidebar:insight", "view:notes", "dock:files:workspace": open that DSH entry.
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                // A dock or view page belongs to a conversation: wait until the fixture has opened one.
                for _ in 0..<40 where store.selectedSession == nil {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                }
                openReviewItem(spec)
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
            destination = .conversation
        }
        .onChange(of: pageConnectionKey, initial: true) { _, key in
            pagePool.connectionChanged(to: key)
        }
        .onChange(of: store.isBlankSession) { _, isBlank in
            // DSH shows no conversation views for a conversation that has not started.
            if isBlank, destination.area == .view, !destination.showsChat { destination = .conversation }
        }
        .onChange(of: isSidebarOpen) { _, isOpen in
            // Pick up what plugins added to DSH since the app last asked.
            if isOpen { Task { await store.refreshNavigation() } }
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

    private struct DrawerMetrics {
        let width: CGFloat
        let offset: CGFloat
        let progress: CGFloat
        let isOpen: Bool
        /// How far the conversation reaches below the layout's bottom edge: the home-indicator strip while
        /// no keyboard is up, so the history runs to the bottom of the screen. It is gone once the keyboard
        /// has the strip, and eases out as the keyboard's inset grows.
        let chatBottomInset: CGFloat
    }

    private func drawerMetrics(in geometry: GeometryProxy) -> DrawerMetrics {
        let width = DSBotLayout.drawerWidth(in: geometry.size.width)
        let offset = drawerOffset(width: width)
        return DrawerMetrics(
            width: width,
            offset: offset,
            progress: width > 0 ? min(1, max(0, offset / width)) : 0,
            isOpen: isSidebarOpen,
            chatBottomInset: KeyboardAvoidance.bottomReach(
                homeInset: homeInset, safeAreaBottom: geometry.safeAreaInsets.bottom
            )
        )
    }

    private func drawerStack(in geometry: GeometryProxy) -> some View {
        let metrics = drawerMetrics(in: geometry)
        return ZStack(alignment: .leading) {
            DSBotStyle.canvas.ignoresSafeArea()
            sidebarLayer(metrics).zIndex(0)
            cardLayer(in: geometry, metrics).zIndex(1)
            backdropLayer(in: geometry, metrics).zIndex(2)
            edgeStripLayer(metrics).zIndex(3)
        }
        .animation(drawerAnimation, value: isSidebarOpen)
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

    @ViewBuilder
    private func sidebarLayer(_ metrics: DrawerMetrics) -> some View {
        if isSidebarOpen || edgeDragOffset > 0 {
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
                onClose: closeSidebar,
                selectedItemID: destination.area == .sidebar ? destination.id : nil
            )
            .frame(width: metrics.width)
            .frame(maxHeight: .infinity)
            .transition(.opacity)
        }
    }

    /// The conversation card: it slides aside, rounds its corners, dims and casts a soft shadow on
    /// the sidebar as the drawer opens. The toolbar rides along and fades with it.
    private func cardLayer(in geometry: GeometryProxy, _ metrics: DrawerMetrics) -> some View {
        let safeTop = geometry.safeAreaInsets.top
        let safeBottom = geometry.safeAreaInsets.bottom
        let radius = DSBotLayout.drawerCornerRadius * metrics.progress
        return ZStack(alignment: .top) {
            cardContent(in: geometry, metrics)
            toolbar
                .frame(width: geometry.size.width, height: DSBotLayout.toolbarHeight)
                .opacity(Double(1 - 0.4 * metrics.progress))
                .zIndex(2)
        }
        .frame(width: geometry.size.width, height: geometry.size.height, alignment: .top)
        .mask {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .padding(.top, -safeTop)
                .padding(.bottom, -safeBottom)
        }
        .background {
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .fill(cardBackground)
                .padding(.top, -safeTop)
                .padding(.bottom, -safeBottom)
                .shadow(color: .black.opacity(Double(0.22 * metrics.progress)), radius: 40 * metrics.progress, x: -3)
        }
        .offset(x: metrics.offset)
    }

    /// Every page below the conversation (DSH's web pages, files, automations) is white; the card around
    /// it must be too, or a band of the canvas shows above and below, where the status bar and the back
    /// button sit. Only the conversation is canvas.
    private var cardBackground: Color {
        destination.showsChat ? DSBotStyle.canvas : .white
    }

    private func cardContent(in geometry: GeometryProxy, _ metrics: DrawerMetrics) -> some View {
        let safeTop = geometry.safeAreaInsets.top
        return ZStack(alignment: .top) {
            // The conversation stays mounted under every page, from the status bar to the bottom of the
            // screen. Coming back shows it as it was left (scroll position, draft) instead of building a
            // long history again, which could land scrolled past its end: a white screen.
            ChatView(
                store: store,
                isOverlayOpen: isSidebarOpen || presentedSheet != nil || !destination.showsChat,
                historyTopInset: safeTop + DSBotLayout.toolbarHeight
            )
            .id(chatIdentity)
            .frame(width: geometry.size.width, height: geometry.size.height + safeTop + metrics.chatBottomInset)
            .offset(y: -safeTop)
            .opacity(destination.showsChat ? 1 : 0)
            .allowsHitTesting(destination.showsChat)
            .accessibilityHidden(!destination.showsChat)
            .environment(\.conversationIsCovered, !destination.showsChat)

            if !destination.showsChat {
                pageContent(safeAreaTop: safeTop)
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .background(Color.white)
            }
        }
        .overlay {
            Rectangle()
                .fill(Color(white: 0.96))
                .opacity(Double(0.4 * metrics.progress))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
        .blur(radius: 1.1 * metrics.progress)
        .allowsHitTesting(!metrics.isOpen)
        .accessibilityHidden(metrics.isOpen)
        .overlay(alignment: .top) {
            statusBarFrost(safeAreaTop: safeTop)
        }
    }

    /// Backdrop over the visible edge of the pushed card. It stops short of the toolbar row so the
    /// menu button keeps working, and never overlaps the sidebar.
    @ViewBuilder
    private func backdropLayer(in geometry: GeometryProxy, _ metrics: DrawerMetrics) -> some View {
        if metrics.isOpen {
            Button {
                closeSidebar()
            } label: {
                Color.black.opacity(0.01)
            }
            .buttonStyle(.plain)
            .contentShape(Rectangle())
            .accessibilityLabel("关闭侧边栏")
            .accessibilityIdentifier("sidebar.backdrop")
            .gesture(drawerDismissGesture(width: metrics.width))
            .frame(
                width: max(0, geometry.size.width - metrics.offset),
                height: max(0, geometry.size.height + geometry.safeAreaInsets.bottom - DSBotLayout.toolbarHeight)
            )
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .offset(y: geometry.safeAreaInsets.bottom)
        }
    }

    /// Swiping in from the left screen edge pulls the card aside like the menu button does.
    @ViewBuilder
    private func edgeStripLayer(_ metrics: DrawerMetrics) -> some View {
        if !metrics.isOpen && presentedSheet == nil {
            Color.clear
                .frame(width: DSBotLayout.edgeSwipeWidth)
                .frame(maxHeight: .infinity)
                .contentShape(Rectangle())
                .gesture(edgeOpenGesture(width: metrics.width))
                .accessibilityHidden(true)
        }
    }


    /// The conversation is home: the sidebar on the left, its views and the right dock on the right.
    /// Every other page (DSH's web pages, files, automations) is one level down, so it gets a way back
    /// and nothing that belongs to the conversation; a page's own action (the plugin page's "+") stays.
    private var toolbar: some View {
        HStack {
            if destination.showsChat {
                sidebarButton
            } else {
                backButton
            }

            Spacer(minLength: 0)

            if destination.showsChat {
                conversationMenu
            } else if isPluginPage {
                addPluginButton
            }
        }
        .padding(.horizontal, DSBotLayout.toolbarHorizontalPadding)
        .frame(height: DSBotLayout.toolbarHeight, alignment: .top)
    }

    private var sidebarButton: some View {
        Button {
            if isSidebarOpen {
                closeSidebar()
            } else {
                dismissKeyboard()
                isSidebarOpen = true
                DSBotLog.record("sidebar.open")
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

    /// Back to the conversation the page was opened from.
    private var backButton: some View {
        Button {
            DSBotLog.record("page.back")
            showConversation()
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

    /// DSH's conversation views, then its right-dock entries, as DSH lists them; the phone adds nothing.
    @ViewBuilder
    private var conversationMenu: some View {
        let views = menuViews
        let dock = menuDock
        if !views.isEmpty || !dock.isEmpty {
            Menu {
                if !views.isEmpty {
                    Section {
                        Picker("会话视图", selection: viewSelection(of: views)) {
                            ForEach(views) { Text($0.title).tag($0.id) }
                        }
                    }
                }
                if !dock.isEmpty {
                    Section {
                        ForEach(dock) { item in
                            Button(item.title) { open(item, in: .dock) }
                        }
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

    /// Dock entries belong to a conversation, as they do in DSH.
    private var menuDock: [NavigationItem] {
        store.selectedSession == nil ? [] : store.activeNavigation.dock
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

    private func statusBarFrost(safeAreaTop: CGFloat) -> some View {
        DSBotEdgeBlur(edge: .top, height: safeAreaTop + DSBotLayout.toolbarHeight + 20, strength: 0.8)
            .offset(y: -safeAreaTop)
    }

    /// What covers the conversation while a page of DSH or of the app's own is open.
    @ViewBuilder
    private func pageContent(safeAreaTop: CGFloat) -> some View {
        switch destination.target {
        case .chat, .unsupported:
            EmptyView()
        case .files:
            WorkPanelView(store: store)
                .padding(.top, safeAreaTop)
        case .schedule:
            LibraryView(section: "schedule", store: store) { sessionID in
                guard let session = store.sessions.first(where: { $0.id == sessionID }) else { return }
                showConversation()
                Task { await store.selectSession(session) }
            }
            .padding(.top, safeAreaTop)
        case let .web(page, target):
            let sessionID = page.needsSession ? store.selectedSession?.id : nil
            EmbeddedPageView(
                store: store, page: page, target: target, sessionID: sessionID, pool: pagePool,
                command: page == .plugins ? pageCommand : nil,
                commandDelivered: { pageCommand = nil }
            )
                // Pages of plugins this app has no layout for start below the toolbar buttons.
                .padding(.top, [.panel, .view, .dock].contains(page) ? DSBotLayout.toolbarHeight : 0)
                // One view identity per page and conversation, so each owns its own session and web view.
                .id("\(page.rawValue)/\(target ?? "")/\(sessionID ?? "")")
        }
    }

    /// Show an entry of DSH's sidebar, conversation views or right dock, the way the plugin says to open it.
    private func open(_ item: NavigationItem, in area: NavigationArea) {
        let target = item.target
        guard target != .unsupported else {
            store.notice = "手机端暂不支持「\(item.title)」"
            return
        }
        if case let .web(page, _) = target, page.needsSession, store.selectedSession == nil {
            store.notice = "先打开一个会话"
            return
        }
        closeSidebar()
        dismissKeyboard()
        destination = target == .chat
            ? .conversation
            : MainDestination(id: item.id, area: area, target: target, title: item.title)
    }

    private func showConversation() {
        destination = .conversation
        closeSidebar()
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
        case "dock":
            if let item = navigation.dock.first(where: { $0.id == id }) { open(item, in: .dock) }
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
        dismissKeyboard()
        if isSidebarOpen { DSBotLog.record("sidebar.close") }
        isSidebarOpen = false
    }

    private var drawerAnimation: Animation {
        reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.38, dampingFraction: 0.88)
    }

    private func drawerOffset(width: CGFloat) -> CGFloat {
        if isSidebarOpen { return width + min(0, max(-width, drawerDrag)) }
        return min(width, max(0, edgeDragOffset))
    }

    private func edgeOpenGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                guard edgeDragOffset > 0 || abs(value.translation.width) > abs(value.translation.height) else { return }
                if edgeDragOffset == 0 {
                    dismissKeyboard()
                    DSBotLog.record("sidebar.edge.begin")
                }
                edgeDragOffset = min(width, max(0.5, value.translation.width))
            }
            .onEnded { value in
                guard edgeDragOffset > 0 else { return }
                let shouldOpen = value.translation.width > width * 0.3
                    || value.predictedEndTranslation.width > width * 0.6
                withAnimation(drawerAnimation) {
                    edgeDragOffset = 0
                    if shouldOpen {
                        isSidebarOpen = true
                        DSBotLog.record("sidebar.open")
                    }
                }
            }
    }

    private func drawerDismissGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 12)
            .updating($drawerDrag) { value, state, transaction in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                transaction.animation = nil
                state = value.translation.width
            }
            .onEnded { value in
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                let travel = value.predictedEndTranslation.width
                if isSidebarOpen && travel < -width * 0.25 {
                    closeSidebar()
                }
            }
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
    case "schedule": return "定时任务"
    default: return section
    }
}

private enum RootSheet: String, Identifiable {
    case settings
    case computers
    case pairing

    var id: String { rawValue }
}
