import SwiftUI
import WebKit

func embeddedResourceRequestPath(from url: URL) -> String? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.percentEncodedPath.hasPrefix("/") else {
        return nil
    }
    var path = components.percentEncodedPath
    if let query = components.percentEncodedQuery {
        path += "?\(query)"
    }
    return path
}

enum EmbeddedExternalLinkDisposition: Equatable {
    case reject
    case openInSystem
    case handleNewWindowInSystem
}

func embeddedExternalURL(from url: URL) -> URL? {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          let scheme = components.scheme?.lowercased(),
          scheme == "http" || scheme == "https",
          components.user == nil,
          components.password == nil,
          let host = components.host,
          isValidEmbeddedExternalHost(host),
          components.port.map({ (1...65_535).contains($0) }) ?? true else {
        return nil
    }
    return url
}

func embeddedExternalLinkDisposition(
    url: URL,
    isUserActivated: Bool,
    targetFrameIsNil: Bool
) -> EmbeddedExternalLinkDisposition {
    guard isUserActivated, embeddedExternalURL(from: url) != nil else {
        return .reject
    }
    return targetFrameIsNil ? .handleNewWindowInSystem : .openInSystem
}

private func isValidEmbeddedExternalHost(_ host: String) -> Bool {
    guard !host.isEmpty,
          !host.unicodeScalars.contains(where: {
              CharacterSet.whitespacesAndNewlines.contains($0)
                  || CharacterSet.controlCharacters.contains($0)
                  || "/\\@%?#[]".unicodeScalars.contains($0)
          }) else {
        return false
    }

    if host.contains(":") {
        return URLComponents(string: "https://[\(host)]")?.host?.lowercased() == host.lowercased()
    }

    var labels = host.split(separator: ".", omittingEmptySubsequences: false)
    if labels.last?.isEmpty == true {
        labels.removeLast()
    }
    guard !labels.isEmpty,
          labels.allSatisfy({ label in
              !label.isEmpty
                  && label.first != "-"
                  && label.last != "-"
                  && label.unicodeScalars.allSatisfy {
                      CharacterSet.alphanumerics.contains($0) || $0 == "-"
                  }
          }) else {
        return false
    }

    if labels.allSatisfy({ $0.allSatisfy { $0.isNumber } }) {
        return labels.count == 4 && labels.allSatisfy {
            Int(String($0)).map { (0...255).contains($0) } == true
        }
    }
    return true
}

/// Something a native button asks the embedded page to do, such as "add" on the plugin page.
struct PageCommand: Equatable {
    let id = UUID()
    let name: String
}

struct EmbeddedPageView: View {
    @ObservedObject var store: DuduStore
    let page: EmbeddedDSHPage
    /// The panel, view or settings section a plugin named, for pages that need one.
    var target: String?
    var sessionID: String?
    var retryToken: Int
    let isVisible: Bool
    let isInteractive: Bool
    /// When set, leaving the page keeps it loaded for a few minutes instead of closing it.
    var pool: EmbeddedPagePool?
    /// A pending request from the toolbar; it waits for the page to be ready, then `commandDelivered` runs.
    var command: PageCommand?
    var commandDelivered: () -> Void = {}
    @StateObject private var session: EmbeddedPageSession
    @State private var retry = 0

    init(
        store: DuduStore,
        page: EmbeddedDSHPage,
        target: String? = nil,
        sessionID: String? = nil,
        session: EmbeddedPageSession? = nil,
        pool: EmbeddedPagePool? = nil,
        command: PageCommand? = nil,
        commandDelivered: @escaping () -> Void = {},
        retryToken: Int = 0,
        isVisible: Bool = true,
        isInteractive: Bool = true
    ) {
        self.store = store
        self.page = page
        self.target = target
        self.sessionID = sessionID
        self.pool = pool
        self.command = command
        self.commandDelivered = commandDelivered
        self.retryToken = retryToken
        self.isVisible = isVisible
        self.isInteractive = isInteractive
        _session = StateObject(
            wrappedValue: session ?? pool?.session(page: page, target: target, sessionID: sessionID) ?? EmbeddedPageSession()
        )
    }

    private var location: String {
        EmbeddedPageRoute(page: page, target: target, sessionID: sessionID).location(
            computerID: store.activeComputer?.id, revision: store.connectionRevision,
            status: store.status.rawValue, retry: retry + retryToken
        )
    }

    private var isCurrentPage: Bool {
        session.location == location && session.isCurrent
    }

    var body: some View {
        ZStack {
            Color.white
            if isCurrentPage, session.hasPage {
                EmbeddedWebSurface(
                    session: session,
                    page: page,
                    settingsSelection: session.selectedSettingsCategoryID,
                    command: command,
                    commandDelivered: commandDelivered,
                    isVisible: isVisible,
                    isInteractive: isInteractive && !session.isLoading && session.error == nil
                )
                    .opacity(1)
                    .allowsHitTesting(!session.isLoading && session.error == nil)
                    .accessibilityHidden(session.isLoading || session.error != nil)
            }
            if !isCurrentPage || !session.hasPage || (session.isLoading && session.error == nil) {
                // The page is still being opened, or DSH's frontend is booting behind this overlay.
                Color.white
                    .overlay {
                        ProgressView().tint(DuduStyle.muted)
                            .accessibilityIdentifier("embedded.loading")
                    }
            } else if let error = session.error {
                Color.white
                    .overlay {
                        VStack(spacing: 14) {
                            Text(error)
                                .font(.system(size: 14))
                                .foregroundStyle(DuduStyle.muted)
                                .multilineTextAlignment(.center)
                            Button(L10n.text("重试")) { retry += 1 }
                                .font(.system(size: 14, weight: .medium))
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("embedded.retry")
                        }
                        .padding(24)
                    }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("embedded.\(page.rawValue)")
        .task(id: location) {
            // A retained or still-preparing page already owns this open operation.
            if session.isPooled, session.location == location,
               session.isCurrent, session.error == nil {
                return
            }
            await session.open(page: page, target: target, sessionID: sessionID, store: store, location: location)
        }
        .onAppear { pool?.markInUse(page: page, target: target, sessionID: sessionID) }
        .onDisappear {
            if let pool {
                pool.release(page: page, target: target, sessionID: sessionID)
            } else {
                session.close()
            }
        }
    }
}

private struct EmbeddedWebSurface: UIViewRepresentable {
    @ObservedObject var session: EmbeddedPageSession
    let page: EmbeddedDSHPage
    let settingsSelection: String?
    let command: PageCommand?
    let commandDelivered: () -> Void
    let isVisible: Bool
    let isInteractive: Bool

    func makeCoordinator() -> Coordinator {
        // A destroyed coordinator has lost its web view and its page; never hand it out again.
        if session.isPooled, let kept = session.surfaceHost as? Coordinator, !kept.isDestroyed { return kept }
        let coordinator = Coordinator(session: session, page: page)
        if session.isPooled { session.surfaceHost = coordinator }
        return coordinator
    }

    func makeUIView(context: Context) -> WKWebView {
        // Coming back to a page the pool kept: hand SwiftUI the web view that already holds it.
        if let kept = context.coordinator.webView, !context.coordinator.isDestroyed {
            updateVisibility(in: kept)
            context.coordinator.load(session, in: kept)
            return kept
        }
        let view = Self.makeWebView(coordinator: context.coordinator)
        updateVisibility(in: view)
        context.coordinator.load(session, in: view)
        return view
    }

    @MainActor
    private static func makeWebView(coordinator: Coordinator) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.inactiveSchedulingPolicy = .none
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.userContentController.addScriptMessageHandler(
            coordinator, contentWorld: .page, name: "dudu"
        )
        configuration.setURLSchemeHandler(coordinator, forURLScheme: "dudu-ui")
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        view.isOpaque = false
        view.backgroundColor = .white
        view.scrollView.backgroundColor = .white
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false
        if #available(iOS 26.0, *) {
            // This page has no bottom native controls; DSH owns its content to the lower edge.
            view.scrollView.bottomEdgeEffect.isHidden = true
        }
        view.allowsBackForwardNavigationGestures = false
        view.allowsLinkPreview = false
        DuduLog.record("web.view.mount")
        coordinator.webView = view
        coordinator.session.teardownSurface = { [weak view, weak coordinator] in
            guard let view, let coordinator else { return }
            Self.destroy(view, coordinator: coordinator)
        }
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        updateVisibility(in: view)
        context.coordinator.load(session, in: view)
        context.coordinator.updateVisibility(isVisible, in: view)
        context.coordinator.updateSettingsSelection(settingsSelection, in: view)
        if context.coordinator.deliver(command, to: view) { commandDelivered() }
    }

    private func updateVisibility(in view: WKWebView) {
        view.configuration.preferences.inactiveSchedulingPolicy = session.isLoading || isVisible ? .none : .throttle
        view.isHidden = !isVisible
        view.isUserInteractionEnabled = isInteractive
        view.accessibilityElementsHidden = !isInteractive
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        // A pooled page that is still open keeps its web view for the next visit.
        if coordinator.keepsPageAlive {
            view.isHidden = true
            view.isUserInteractionEnabled = false
            view.accessibilityElementsHidden = true
            coordinator.updateVisibility(false, in: view)
            return
        }
        destroy(view, coordinator: coordinator)
    }

    private static func destroy(_ view: WKWebView, coordinator: Coordinator) {
        guard !coordinator.isDestroyed else { return }
        coordinator.isDestroyed = true
        view.stopLoading()
        view.navigationDelegate = nil
        view.uiDelegate = nil
        view.configuration.userContentController.removeScriptMessageHandler(forName: "dudu", contentWorld: .page)
        coordinator.cancel()
        coordinator.webView = nil
        coordinator.forgetHost()
        DuduLog.record("web.view.unmount")
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKURLSchemeHandler, WKScriptMessageHandlerWithReply {
        let session: EmbeddedPageSession
        private let page: EmbeddedDSHPage
        /// The web view this coordinator drives; a pooled page keeps it between visits.
        var webView: WKWebView?
        var isDestroyed = false
        private var loadedID: String?
        private var lastSettingsSelection: String?
        private var didDispatchSettingsSelection = false
        private var lastVisibility: Bool?
        private var resourceTasks: [ObjectIdentifier: Task<Void, Never>] = [:]
        private var bridgeTasks: [UUID: Task<Void, Never>] = [:]
        private var loadTask: Task<Void, Never>?
        private var activeCookieStore: WKHTTPCookieStore?
        private var installedPageCookie: HTTPCookie?
        private var recentlyOpenedExternalURLs: [String: TimeInterval] = [:]
        private var navigationStartedAt: TimeInterval?

        init(session: EmbeddedPageSession, page: EmbeddedDSHPage) {
            self.session = session
            self.page = page
        }

        /// The page is pooled and still open, so leaving the screen must not close it.
        var keepsPageAlive: Bool {
            !isDestroyed && session.isPooled && session.hasPage && session.isCurrent && session.error == nil
        }

        /// The session must not hand this coordinator to a later web view once it is destroyed.
        func forgetHost() {
            if session.surfaceHost === self { session.surfaceHost = nil }
        }

        func load(_ session: EmbeddedPageSession, in view: WKWebView) {
            guard let pageID = session.pageID, loadedID != pageID else { return }
            cancel()
            loadedID = pageID
            lastSettingsSelection = nil
            didDispatchSettingsSelection = false
            view.configuration.userContentController.removeAllUserScripts()
            view.configuration.userContentController.addUserScript(
                WKUserScript(source: session.bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
            if let openedPage = session.openedHTTPPage {
                guard let cookie = EmbeddedHTTPPageClient.cookie(
                    for: openedPage,
                    origin: openedPage.url
                ) else {
                    session.fail()
                    return
                }
                let cookieStore = view.configuration.websiteDataStore.httpCookieStore
                activeCookieStore = cookieStore
                installedPageCookie = cookie
                loadTask = Task { @MainActor [weak self, weak view] in
                    await withCheckedContinuation { continuation in
                        cookieStore.setCookie(cookie) {
                            continuation.resume()
                        }
                    }
                    guard !Task.isCancelled,
                          let self, let view,
                          self.loadedID == openedPage.id,
                          session.isCurrent,
                          session.openedHTTPPage?.id == openedPage.id else {
                        await cookieStore.deleteCookie(cookie)
                        return
                    }
                    var request = URLRequest(url: openedPage.url)
                    request.httpMethod = "GET"
                    request.cachePolicy = .reloadIgnoringLocalCacheData
                    request.timeoutInterval = 30
                    self.navigationStartedAt = ProcessInfo.processInfo.systemUptime
                    view.load(request)
                }
            } else if let document = session.document,
                      let base = URL(string: "dudu-ui://\(document.id)/") {
                navigationStartedAt = ProcessInfo.processInfo.systemUptime
                view.loadHTMLString(document.html, baseURL: base)
            } else {
                session.fail()
            }
        }

        private var lastCommandID: UUID?

        func updateVisibility(_ isVisible: Bool, in view: WKWebView) {
            guard loadedID == session.pageID, !session.isLoading, session.error == nil,
                  lastVisibility != isVisible else { return }
            view.configuration.preferences.inactiveSchedulingPolicy = isVisible ? .none : .throttle
            lastVisibility = isVisible
            if isVisible { didDispatchSettingsSelection = false }
            view.evaluateJavaScript("window.dispatchEvent(new CustomEvent('dudu:visibility',{detail:\(isVisible)}));")
        }

        /// Hand a toolbar request to the page once it is ready; true when it was sent.
        func deliver(_ command: PageCommand?, to view: WKWebView) -> Bool {
            guard let command, command.id != lastCommandID,
                  let pageID = session.pageID, loadedID == pageID,
                  !session.isLoading, session.error == nil,
                  let encoded = try? JSONEncoder().encode(command.name),
                  let literal = String(data: encoded, encoding: .utf8) else { return false }
            lastCommandID = command.id
            view.evaluateJavaScript("window.dispatchEvent(new CustomEvent('dudu:command',{detail:\(literal)}));")
            return true
        }

        func updateSettingsSelection(_ selection: String?, in view: WKWebView) {
            guard page == .settings, session.hasReceivedSettingsCategories,
                  let pageID = session.pageID, loadedID == pageID,
                  !didDispatchSettingsSelection || lastSettingsSelection != selection else {
                return
            }
            guard let encoded = try? JSONEncoder().encode(selection),
                  let literal = String(data: encoded, encoding: .utf8) else {
                return
            }
            let script = "window.dispatchEvent(new CustomEvent('dudu:settings-select',{detail:\(literal)}));"
            view.evaluateJavaScript(script)
            lastSettingsSelection = selection
            didDispatchSettingsSelection = true
        }

        func cancel() {
            lastVisibility = nil
            loadTask?.cancel()
            loadTask = nil
            if let installedPageCookie {
                activeCookieStore?.delete(installedPageCookie, completionHandler: nil)
            }
            installedPageCookie = nil
            activeCookieStore = nil
            resourceTasks.values.forEach { $0.cancel() }
            resourceTasks.removeAll()
            bridgeTasks.values.forEach { $0.cancel() }
            bridgeTasks.removeAll()
        }

        private func endpointState(_ endpoint: String?) -> String {
            guard let endpoint else { return "unknown" }
            if endpoint == "$events" { return "events" }
            let state = endpoint.replacingOccurrences(of: "/", with: ".")
            guard state.count <= 32,
                  state.range(of: #"^[A-Za-z0-9._-]{1,32}$"#, options: .regularExpression) != nil else {
                return "unknown"
            }
            return state
        }

        private func recordRPCFailure(_ endpoint: String?) {
            DuduLog.record("web.rpc.fail", level: "warn", state: endpointState(endpoint))
        }

        private func recordBootstrapFailure(_ state: String) {
            DuduLog.record("web.bootstrap.fail", level: "warn", state: state)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = navigationAction.request.url else { return .cancel }
            if url.absoluteString == "about:blank" { return .allow }
            if let openedPage = session.openedHTTPPage,
               let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
               let pageComponents = URLComponents(url: openedPage.url, resolvingAgainstBaseURL: false),
               components.scheme?.lowercased() == pageComponents.scheme?.lowercased(),
               components.host?.lowercased() == pageComponents.host?.lowercased(),
               components.port == pageComponents.port,
               components.user == nil, components.password == nil,
               components.percentEncodedPath.hasPrefix(openedPage.path) {
                return .allow
            }
            if url.scheme == "dudu-ui", url.host == loadedID { return .allow }
            switch embeddedExternalLinkDisposition(
                url: url,
                isUserActivated: navigationAction.navigationType == .linkActivated,
                targetFrameIsNil: navigationAction.targetFrame == nil
            ) {
            case .openInSystem:
                await openExternalURLIfNeeded(url)
                return .cancel
            case .handleNewWindowInSystem:
                // Let WKUIDelegate handle target=_blank so the same request is opened once.
                return .allow
            case .reject:
                break
            }
            return .cancel
        }

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard navigationAction.targetFrame == nil,
                  let url = navigationAction.request.url,
                  embeddedExternalLinkDisposition(
                    url: url,
                    isUserActivated: navigationAction.navigationType == .linkActivated,
                    targetFrameIsNil: true
                  ) == .handleNewWindowInSystem else {
                return nil
            }
            guard reserveExternalURL(url) else { return nil }
            Task { @MainActor in
                await UIApplication.shared.open(url)
            }
            return nil
        }

        private func openExternalURLIfNeeded(_ url: URL) async {
            guard reserveExternalURL(url) else { return }
            await UIApplication.shared.open(url)
        }

        @discardableResult
        private func reserveExternalURL(_ url: URL) -> Bool {
            let now = ProcessInfo.processInfo.systemUptime
            recentlyOpenedExternalURLs = recentlyOpenedExternalURLs.filter { now - $0.value < 1 }
            let key = url.absoluteString
            guard recentlyOpenedExternalURLs[key] == nil else { return false }
            recentlyOpenedExternalURLs[key] = now
            return true
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            recordBootstrapFailure("navigation")
            session.fail()
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            navigationStartedAt = ProcessInfo.processInfo.systemUptime
            DuduLog.record("web.navigation.start", state: page.rawValue)
        }

        func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
            DuduLog.record(
                "web.navigation.commit",
                elapsedMs: navigationElapsed,
                state: page.rawValue
            )
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DuduLog.record(
                "web.navigation.finish",
                elapsedMs: navigationElapsed,
                state: page.rawValue
            )
        }

        private var navigationElapsed: Double? {
            guard let navigationStartedAt else { return nil }
            return max(0, (ProcessInfo.processInfo.systemUptime - navigationStartedAt) * 1_000)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            recordBootstrapFailure("navigation")
            session.fail()
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            cancel()
            recordBootstrapFailure("process")
            session.fail()
        }

        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage,
            replyHandler: @escaping (Any?, String?) -> Void
        ) {
            guard message.frameInfo.isMainFrame,
                  let source = message.body as? String,
                  source.utf8.count <= 1_024 * 1_024,
                  let pageID = loadedID,
                  session.pageID == pageID,
                  session.isCurrent else {
                replyHandler(nil, "PAGE_CLOSED")
                return
            }
            let operation = UUID()
            bridgeTasks[operation] = Task {
                defer { bridgeTasks[operation] = nil }
                do {
                    let call = try await EmbeddedPageCodec.shared.call(source)
                    guard !Task.isCancelled,
                          pageID == loadedID,
                          session.pageID == pageID,
                          session.isCurrent else {
                        throw CancellationError()
                    }
                    switch call.method {
                    case "ready":
                        session.ready()
                        replyHandler("true", nil)
                        if let view = webView { updateVisibility(!view.isHidden, in: view) }
                    case "interaction":
                        guard let params = call.params, params.count == 1,
                              let action = params["action"]?.stringValue,
                              ["search", "expand", "collapse", "detail", "back", "tab", "change"].contains(action) else {
                            throw DuduFailure.unsupportedRequest
                        }
                        DuduLog.record("web.interaction", state: "\(page.rawValue).\(action)")
                        replyHandler("true", nil)
                    case "error":
                        recordBootstrapFailure("page")
                        session.fail()
                        replyHandler("true", nil)
                    case "bootstrap.failure":
                        guard let params = call.params, params.count == 1,
                              let kind = params["kind"]?.stringValue,
                              ["page", "script", "resource"].contains(kind) else {
                            throw DuduFailure.unsupportedRequest
                        }
                        recordBootstrapFailure(kind)
                        session.fail()
                        replyHandler("true", nil)
                    case "rpc.failure":
                        guard let params = call.params, params.count == 1,
                              let failedEndpoint = params["endpoint"]?.stringValue else {
                            throw DuduFailure.unsupportedRequest
                        }
                        recordRPCFailure(failedEndpoint)
                        replyHandler("true", nil)
#if DEBUG && targetEnvironment(simulator)
                    case "review.diagnostic":
                        let allowedKeys: Set<String> = [
                            "stage", "message", "filename", "stack", "endpoint"
                        ]
                        let allowedStages: Set<String> = [
                            "boot.open.begin", "boot.open.complete", "boot.transport.injected",
                            "boot.transport.ready", "boot.ready", "boot.fail",
                            "resource.scheme.start", "resource.scheme.reject",
                            "resource.fetch.start", "resource.fetch.complete", "resource.fetch.fail",
                            "script.error", "script.resource.error", "unhandledrejection",
                            "transport.error", "rpc.failure", "rpc.missing"
                        ]
                        guard ReviewWebDiagnostics.isEnabled,
                              let params = call.params,
                              params.keys.allSatisfy(allowedKeys.contains),
                              params.values.allSatisfy({ $0.stringValue != nil }),
                              let stage = params["stage"]?.stringValue,
                              allowedStages.contains(stage) else {
                            throw DuduFailure.unsupportedRequest
                        }
                        ReviewWebDiagnostics.record(
                            stage: stage,
                            pageKind: page.rawValue,
                            message: params["message"]?.stringValue,
                            filename: params["filename"]?.stringValue,
                            stack: params["stack"]?.stringValue,
                            endpoint: params["endpoint"]?.stringValue
                        )
                        replyHandler("true", nil)
#endif
                    case "settings.categories":
                        guard page == .settings, let params = call.params else {
                            throw DuduFailure.unsupportedRequest
                        }
                        try await session.receiveSettingsCategories(params, documentID: pageID)
                        guard !Task.isCancelled,
                              pageID == loadedID,
                              session.pageID == pageID,
                              session.isCurrent else {
                            throw CancellationError()
                        }
                        replyHandler("true", nil)
                    case "settings.mutated":
                        guard page == .settings,
                              call.params == nil || call.params?.isEmpty == true else {
                            throw DuduFailure.unsupportedRequest
                        }
                        session.recordSettingsMutation()
                        replyHandler("true", nil)
                    case "web.invoke", "web.stream.open", "web.stream.next", "web.stream.close":
                        guard !session.usesHTTPTransport else {
                            throw DuduFailure.unsupportedRequest
                        }
                        let result = try await session.request(call.method, params: call.params ?? [:])
                        if call.method == "web.invoke", page == .settings,
                           let params = call.params,
                           let endpoint = params["endpoint"]?.stringValue,
                           Self.settingsWriteEndpoints.contains(endpoint),
                           result["ok"]?.boolValue == true {
                            session.recordSettingsMutation()
                        }
                        let encoded = try await EmbeddedPageCodec.shared.reply(result)
                        guard !Task.isCancelled,
                              pageID == loadedID,
                              session.pageID == pageID,
                              session.isCurrent else {
                            throw CancellationError()
                        }
                        replyHandler(encoded, nil)
                    default:
                        replyHandler(nil, "UNSUPPORTED")
                    }
                } catch {
                    replyHandler(nil, (error as? DuduFailure)?.logCode ?? "PAGE_CLOSED")
                }
            }
        }

        private static let settingsWriteEndpoints: Set<String> = [
            "settings/mutate", "settings/update", "settings/replace",
            "credentials/set", "credentials/unset",
            "pluginManager/setPluginEnabled", "pluginManager/setBundleEnabled",
            "pluginManager/installBundle", "pluginManager/removeBundle",
            "pluginManager/cancelInstall", "pluginManager/waitForInstall",
            "pluginManager/setVersionExemption", "pluginMarket/setIndexes",
        ]

        func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
            let identifier = ObjectIdentifier(urlSchemeTask)
            guard let url = urlSchemeTask.request.url,
                  url.scheme == "dudu-ui", url.host == loadedID,
                  url.user == nil, url.password == nil else {
                recordBootstrapFailure("resource")
#if DEBUG && targetEnvironment(simulator)
                ReviewWebDiagnostics.record(stage: "resource.scheme.reject", pageKind: page.rawValue)
#endif
                urlSchemeTask.didFailWithError(DuduFailure.unsupportedRequest)
                return
            }
            let pageID = loadedID
            let requestPath = embeddedResourceRequestPath(from: url)
            resourceTasks[identifier] = Task {
                defer { resourceTasks[identifier] = nil }
#if DEBUG && targetEnvironment(simulator)
                if let requestPath {
                    ReviewWebDiagnostics.record(
                        stage: "resource.scheme.start",
                        pageKind: page.rawValue,
                        filename: requestPath
                    )
                }
#endif
                do {
                    guard let requestPath else {
                        throw DuduFailure.protocolError
                    }
                    let resource = try await session.resource(path: requestPath)
                    guard !Task.isCancelled, loadedID == pageID, resourceTasks[identifier] != nil else { return }
                    guard let response = HTTPURLResponse(
                        url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                        headerFields: [
                            "Content-Type": resource.mimeType,
                            "Content-Length": "\(resource.data.count)",
                            "Access-Control-Allow-Origin": "*",
                            "Cache-Control": "no-store"
                        ]
                    ) else { throw DuduFailure.protocolError }
                    urlSchemeTask.didReceive(response)
                    if !resource.data.isEmpty { urlSchemeTask.didReceive(resource.data) }
                    urlSchemeTask.didFinish()
                } catch {
                    guard !Task.isCancelled, loadedID == pageID, resourceTasks[identifier] != nil else { return }
                    DuduLog.record("web.resource.fail", level: "warn", state: "fetch")
#if DEBUG && targetEnvironment(simulator)
                    let nativeError = error as NSError
                    ReviewWebDiagnostics.record(
                        stage: "resource.fetch.fail",
                        pageKind: page.rawValue,
                        message: "\(String(reflecting: type(of: error))): \(nativeError.domain) (\(nativeError.code)): \(nativeError.localizedDescription)",
                        filename: requestPath
                    )
#endif
                    urlSchemeTask.didFailWithError(error)
                }
            }
        }

        func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
            resourceTasks.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancel()
        }
    }
}
