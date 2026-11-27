import SwiftUI
import UIKit

/// A toast above everything, a presented sheet included (owner, 2026-11-27, on the feedback's 「发送失败」: 「我选位置一」, the top of the screen, where the toasts of the pages are). A sheet's dimming covers
/// the toast that a page holds, so this one lives in a window of its own, above the app's, that takes no touch: its toast has no ✕, and nothing under it is blocked.
@MainActor
final class TopToast: ObservableObject {
    static let shared = TopToast()

    @Published private(set) var message: DuduToastMessage?
    private var window: UIWindow?
    private var shownAt = Date.distantPast

    func show(_ message: DuduToastMessage) {
        // The same words twice within a moment are one event told from two places (a pairing that fails is told by the form and by the page behind it): one toast, not two on top of each other.
        if let current = self.message, current.text == message.text, current.kind == message.kind, Date().timeIntervalSince(shownAt) < 0.5 { return }
        shownAt = Date()
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else { return }
        if window == nil || window?.windowScene !== scene { window = makeWindow(in: scene) }
        window?.isHidden = false
        self.message = message
    }

    fileprivate func dismiss(_ dismissed: DuduToastMessage) {
        guard message?.id == dismissed.id else { return }
        message = nil
        // The toast leaves with its own animation; the window goes after it.
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            if message == nil { window?.isHidden = true }
        }
    }

    private func makeWindow(in scene: UIWindowScene) -> UIWindow {
        let window = PassthroughWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        window.backgroundColor = .clear
        let host = UIHostingController(rootView: TopToastHost(model: self))
        host.view.backgroundColor = .clear
        window.rootViewController = host
        return window
    }
}

/// A window whose empty parts are not there for a touch: it goes to the window under it.
private final class PassthroughWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === rootViewController?.view ? nil : hit
    }
}

private struct TopToastHost: View {
    @ObservedObject var model: TopToast

    var body: some View {
        // 6pt under the status bar (the Dynamic Island), where a system banner sits (owner, 2026-11-27: 「你这个弹的太低了吧，可以高一点么」; before it was 52pt, under the bar of a page).
        DuduToastOverlay(message: model.message) { model.dismiss($0) }
            .padding(.horizontal, 24)
            .padding(.top, 6)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}
