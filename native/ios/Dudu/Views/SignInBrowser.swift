import SwiftUI
import WebKit
import LucideSwift

/// A sign-in page to open on the phone: the service's own authorization page, whose redirect goes back to the computer that asked for it.
struct SignInPage: Identifiable, Equatable {
    let id = UUID()
    let url: URL
}

/// The service's sign-in page in a browser view of the app (owner, 2026-11-23: 「在手机上点，就在手机上连接吧」). The plugin registered its redirect as the computer's own address
/// (`http://127.0.0.1:<port>/oauth/callback`, which the phone cannot reach): the view stops at it instead of loading it and hands the whole address to `onCallback`, which
/// gives it to the plugin; the plugin checks it and finishes the sign-in. × closes it and gives up.
struct SignInBrowser: View {
    let page: SignInPage
    let onCallback: (URL) -> Void
    let onClose: () -> Void
    @State private var loading = true

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Text(page.url.host() ?? "")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                    .lineLimit(1)
                    .padding(.horizontal, 56)
                HStack {
                    Button { onClose() } label: {
                        DuduBarGlyph(.close)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L10n.text("取消"))
                    Spacer()
                }
                .padding(.horizontal, 8)
            }
            .frame(height: 50)
            .overlay(alignment: .bottom) {
                if loading { ProgressView().progressViewStyle(.linear).tint(DuduStyle.blue) } else { Divider() }
            }
            SignInWebView(url: page.url, loading: $loading, onCallback: onCallback)
        }
        .background(Color.white)
        .interactiveDismissDisabled()
    }
}

private struct SignInWebView: UIViewRepresentable {
    let url: URL
    @Binding var loading: Bool
    let onCallback: (URL) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.parent = self }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: SignInWebView
        private var delivered = false

        init(_ parent: SignInWebView) { self.parent = parent }

        /// The computer's own redirect address: loopback, plain http, the callback path.
        static func isCallback(_ url: URL) -> Bool {
            guard url.scheme == "http", let host = url.host() else { return false }
            return ["127.0.0.1", "localhost"].contains(host) && url.path == "/oauth/callback"
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, Self.isCallback(url) else { return decisionHandler(.allow) }
            decisionHandler(.cancel)
            guard !delivered else { return }
            delivered = true
            parent.onCallback(url)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { parent.loading = true }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loading = false }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { parent.loading = false }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { parent.loading = false }
    }
}
