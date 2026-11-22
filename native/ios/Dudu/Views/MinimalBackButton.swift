import SwiftUI
import UIKit

/// A pushed settings page keeps the system's glass back button with the chevron alone and has its title in the middle of the bar (owner, 2026-11-21: 「各种设置顶部的这个标题要居中」).
/// `.toolbarRole(.editor)` gave the chevron alone but led the title; SwiftUI has no modifier for the back button's mode, so the page sets UIKit's `.minimal` on its own navigation item and on
/// the item it was pushed from (UIKit takes the mode from the item whose back button it draws, and the page cannot tell which of the two that is). The system back button stays, not a button
/// of our own, so the edge swipe keeps working.
private struct MinimalBackButton: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> Controller { Controller() }

    func updateUIViewController(_ controller: Controller, context: Context) { controller.apply() }

    final class Controller: UIViewController {
        override func loadView() {
            view = UIView()
            view.isUserInteractionEnabled = false
            view.backgroundColor = .clear
        }

        override func didMove(toParent parent: UIViewController?) {
            super.didMove(toParent: parent)
            apply()
        }

        override func viewWillAppear(_ animated: Bool) {
            super.viewWillAppear(animated)
            apply()
        }

        func apply() {
            // The page is the ancestor the navigation controller holds; before it is pushed, the topmost one.
            var page: UIViewController = self
            while let parent = page.parent, !(parent is UINavigationController) { page = parent }
            Self.minimal(page.navigationItem)
            guard let stack = page.parent as? UINavigationController,
                  let index = stack.viewControllers.firstIndex(of: page), index > 0 else { return }
            Self.minimal(stack.viewControllers[index - 1].navigationItem)
        }

        private static func minimal(_ item: UINavigationItem) {
            if item.backButtonDisplayMode != .minimal { item.backButtonDisplayMode = .minimal }
        }
    }
}

extension View {
    /// The back button of this page (and of the pages pushed from it) is the chevron alone, with the title centred; use it in place of `.toolbarRole(.editor)`, which leads the title.
    func minimalBackButton() -> some View {
        background {
            MinimalBackButton()
                .frame(width: 0, height: 0)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}
