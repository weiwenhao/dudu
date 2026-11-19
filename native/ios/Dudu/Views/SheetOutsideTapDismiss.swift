import SwiftUI
import UIKit

/// Keep the native sheet and its dimming; only taps outside its presented frame dismiss it.
struct SheetOutsideTapDismiss: UIViewControllerRepresentable {
    var isEnabled = true
    let onDismiss: () -> Void

    func makeUIViewController(context: Context) -> Controller {
        let controller = Controller()
        controller.isEnabled = isEnabled
        controller.onDismiss = onDismiss
        return controller
    }

    func updateUIViewController(_ controller: Controller, context: Context) {
        controller.isEnabled = isEnabled
        controller.onDismiss = onDismiss
        controller.attach()
    }

    static func dismantleUIViewController(_ controller: Controller, coordinator: ()) {
        controller.detach()
        controller.onDismiss = {}
    }

    final class Controller: UIViewController, UIGestureRecognizerDelegate {
        var isEnabled = true
        var onDismiss: () -> Void = {}
        private weak var sheet: UIPresentationController?
        private var outsideTap: UITapGestureRecognizer?

        override func loadView() {
            view = UIView()
            view.isUserInteractionEnabled = false
            view.backgroundColor = .clear
        }

        override func viewDidAppear(_ animated: Bool) {
            super.viewDidAppear(animated)
            attach()
        }

        override func viewDidDisappear(_ animated: Bool) {
            super.viewDidDisappear(animated)
            detach()
        }

        func attach() {
            guard isViewLoaded, view.window != nil else { return }
            var host: UIViewController = self
            while let parent = host.parent { host = parent }
            guard host.presentingViewController != nil,
                  let presentation = host.presentationController,
                  let container = presentation.containerView else { return }
            guard outsideTap?.view !== container else { return }
            detach()
            sheet = presentation
            let tap = UITapGestureRecognizer(target: self, action: #selector(dismissFromOutside))
            tap.cancelsTouchesInView = false
            tap.delegate = self
            container.addGestureRecognizer(tap)
            outsideTap = tap
        }

        func detach() {
            if let outsideTap { outsideTap.view?.removeGestureRecognizer(outsideTap) }
            outsideTap = nil
            sheet = nil
        }

        private var canDismiss: Bool {
            guard isEnabled, let host = sheet?.presentedViewController else { return false }
            return !host.isModalInPresentation && !host.isBeingDismissed && host.presentedViewController == nil
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            guard canDismiss, let sheet, let container = sheet.containerView else { return false }
            let frame = sheet.frameOfPresentedViewInContainerView
            return !frame.isEmpty && !frame.contains(touch.location(in: container))
        }

        func gestureRecognizer(
            _ gestureRecognizer: UIGestureRecognizer,
            shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
        ) -> Bool { true }

        @objc private func dismissFromOutside() {
            guard canDismiss else { return }
            onDismiss()
        }
    }
}
