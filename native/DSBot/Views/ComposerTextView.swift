import SwiftUI
import UIKit

struct ComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    let placeholder: String

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> UITextView {
        let view = UITextView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = .systemFont(ofSize: 16)
        view.textColor = UIColor(DSBotStyle.ink)
        view.tintColor = UIColor(DSBotStyle.ink)
        view.textContainerInset = UIEdgeInsets(top: 12.5, left: 0, bottom: 12.5, right: 0)
        view.textContainer.lineFragmentPadding = 0
        view.contentInsetAdjustmentBehavior = .never
        view.automaticallyAdjustsScrollIndicatorInsets = false
        view.isScrollEnabled = false
        view.showsHorizontalScrollIndicator = false
        view.showsVerticalScrollIndicator = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.accessibilityIdentifier = "composer.text"
        context.coordinator.installPlaceholder(in: view)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        if view.markedTextRange == nil, view.text != text {
            let selection = view.selectedRange
            view.text = text
            view.selectedRange = NSRange(
                location: min(selection.location, view.text.utf16.count),
                length: min(selection.length, max(0, view.text.utf16.count - selection.location))
            )
            view.invalidateIntrinsicContentSize()
        }
        context.coordinator.updatePlaceholder(in: view)
        context.coordinator.updateFocus(in: view)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let maximum = ceil((uiView.font?.lineHeight ?? 19) * 5 + 25)
        let ideal = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let needsScrolling = ideal.height > maximum + 0.5
        if uiView.isScrollEnabled != needsScrolling { uiView.isScrollEnabled = needsScrolling }
        return CGSize(width: width, height: min(maximum, max(44, ceil(ideal.height))))
    }

    static func dismantleUIView(_ view: UITextView, coordinator: Coordinator) {
        view.delegate = nil
        if view.isFirstResponder { view.resignFirstResponder() }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextView
        private let placeholderLabel = UILabel()
        private var focusRevision = 0

        init(_ parent: ComposerTextView) {
            self.parent = parent
        }

        func installPlaceholder(in view: UITextView) {
            placeholderLabel.font = view.font
            placeholderLabel.textColor = UIColor(DSBotStyle.muted)
            placeholderLabel.isUserInteractionEnabled = false
            placeholderLabel.isAccessibilityElement = false
            placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(placeholderLabel)
            NSLayoutConstraint.activate([
                placeholderLabel.leadingAnchor.constraint(equalTo: view.frameLayoutGuide.leadingAnchor),
                placeholderLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.frameLayoutGuide.trailingAnchor),
                placeholderLabel.topAnchor.constraint(equalTo: view.frameLayoutGuide.topAnchor, constant: 12.5)
            ])
        }

        func updatePlaceholder(in view: UITextView) {
            placeholderLabel.text = parent.placeholder
            placeholderLabel.isHidden = !view.text.isEmpty
            view.accessibilityLabel = parent.placeholder
        }

        func updateFocus(in view: UITextView) {
            focusRevision &+= 1
            let revision = focusRevision
            guard parent.isFocused != view.isFirstResponder else { return }
            DispatchQueue.main.async { [weak self, weak view] in
                guard let self, let view, self.focusRevision == revision, view.window != nil else { return }
                if self.parent.isFocused {
                    if !view.isFirstResponder { view.becomeFirstResponder() }
                } else if view.isFirstResponder {
                    view.resignFirstResponder()
                }
            }
        }

        func textViewDidChange(_ view: UITextView) {
            parent.text = view.text
            updatePlaceholder(in: view)
            view.invalidateIntrinsicContentSize()
        }

        func textViewDidBeginEditing(_ view: UITextView) {
            if !parent.isFocused { parent.isFocused = true }
        }

        func textViewDidEndEditing(_ view: UITextView) {
            if parent.isFocused { parent.isFocused = false }
        }
    }
}
