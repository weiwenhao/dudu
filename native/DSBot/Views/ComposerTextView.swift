import SwiftUI
import UIKit

struct ComposerTextView: UIViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    let placeholder: String
    var selectionRequest: ComposerSelection? = nil
    var highlights: [NSRange] = []
    /// Grey words after what is written, while they are all that is there: the title of the issue whose `@ID` the owner chose to answer (the group chat's reply). They give way to the first letter.
    var ghost: String? = nil
    var completionActive = false
    var onEditingChange: ((ComposerEditingState) -> Void)? = nil
    var onCompletionKey: ((String) -> Bool)? = nil
    var onTapEditor: (() -> Void)? = nil

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> UITextView {
        let view = ComposerEditorView()
        view.delegate = context.coordinator
        view.backgroundColor = .clear
        view.font = .systemFont(ofSize: 16)
        view.textColor = UIColor(DSBotStyle.ink)
        view.tintColor = UIColor(DSBotStyle.ink)
        // The SwiftUI wrapper owns vertical padding so it stays visible while the text scrolls.
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        view.contentInsetAdjustmentBehavior = .never
        view.automaticallyAdjustsScrollIndicatorInsets = false
        // Keep UIKit's scrolling/caret machinery enabled even while the field fits one line.
        // Toggling this from sizeThatFits invalidates text layout during marked-text input.
        view.isScrollEnabled = true
        view.showsHorizontalScrollIndicator = false
        view.showsVerticalScrollIndicator = false
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        view.accessibilityIdentifier = "composer.text"
        context.coordinator.installPlaceholder(in: view)
        return view
    }

    func updateUIView(_ view: UITextView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.isUpdating = true
        defer { context.coordinator.isUpdating = false }
        if view.markedTextRange == nil, view.text != text {
            let selection = view.selectedRange
            view.text = text
            view.selectedRange = NSRange(
                location: min(selection.location, view.text.utf16.count),
                length: min(selection.length, max(0, view.text.utf16.count - selection.location))
            )
            view.invalidateIntrinsicContentSize()
        }
        context.coordinator.applySelection(in: view)
        context.coordinator.applyHighlights(in: view)
        if let editor = view as? ComposerEditorView {
            editor.completionActive = completionActive
            editor.onCompletionKey = onCompletionKey
            editor.onTapEditor = { [weak view, weak coordinator = context.coordinator] in
                coordinator?.parent.onTapEditor?()
                if let view { coordinator?.reportEditing(view) }
            }
        }
        context.coordinator.updatePlaceholder(in: view)
        context.coordinator.updateFocus(in: view)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0 else { return nil }
        let lineHeight = uiView.font?.lineHeight ?? 19
        let maximum = ceil(lineHeight * 5)
        let ideal = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: min(maximum, max(ceil(lineHeight), ceil(ideal.height))))
    }

    static func dismantleUIView(_ view: UITextView, coordinator: Coordinator) {
        view.delegate = nil
        if view.isFirstResponder { view.resignFirstResponder() }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: ComposerTextView
        private let placeholderLabel = UILabel()
        private let ghostLabel = UILabel()
        private var focusRevision = 0
        var isUpdating = false
        private var appliedSelection: UUID?
        private var highlightedText: String?
        private var highlightedRanges: [NSRange] = []

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
                placeholderLabel.topAnchor.constraint(equalTo: view.frameLayoutGuide.topAnchor)
            ])
            ghostLabel.font = view.font
            ghostLabel.textColor = UIColor(DSBotStyle.muted)
            ghostLabel.lineBreakMode = .byTruncatingTail
            ghostLabel.isUserInteractionEnabled = false
            ghostLabel.isAccessibilityElement = false
            ghostLabel.isHidden = true
            view.addSubview(ghostLabel)
        }

        func updatePlaceholder(in view: UITextView) {
            placeholderLabel.text = parent.placeholder
            placeholderLabel.isHidden = !view.text.isEmpty
            view.accessibilityLabel = parent.placeholder
            placeGhost(in: view)
        }

        /// The grey words go where the caret is at the end of the text; the next layout puts them right if the text has not been laid out yet.
        private func placeGhost(in view: UITextView) {
            guard let ghost = parent.ghost, !view.text.isEmpty, view.markedTextRange == nil else {
                ghostLabel.isHidden = true
                return
            }
            ghostLabel.text = ghost
            ghostLabel.isHidden = false
            let place = { [weak self, weak view] in
                guard let self, let view, view.bounds.width > 0 else { return }
                let caret = view.caretRect(for: view.endOfDocument)
                let x = caret.maxX + 5
                self.ghostLabel.frame = CGRect(x: x, y: caret.minY, width: max(0, view.bounds.width - x), height: caret.height)
            }
            place()
            DispatchQueue.main.async(execute: place)
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
            guard !isUpdating else { return }
            parent.text = view.text
            updatePlaceholder(in: view)
            view.invalidateIntrinsicContentSize()
            reportEditing(view)
        }

        func textViewDidChangeSelection(_ view: UITextView) {
            if !isUpdating { reportEditing(view) }
        }

        func reportEditing(_ view: UITextView) {
            guard !isUpdating else { return }
            // Selection and end-editing callbacks may arrive before the text-change callback.
            // Publish the native draft before completion updates can redraw this wrapper.
            if parent.text != view.text { parent.text = view.text }
            parent.onEditingChange?(ComposerEditingState(
                text: view.text, selection: view.selectedRange, isComposing: view.markedTextRange != nil
            ))
        }

        func applySelection(in view: UITextView) {
            guard view.markedTextRange == nil, let request = parent.selectionRequest, request.id != appliedSelection else { return }
            appliedSelection = request.id
            let length = (view.text as NSString).length
            view.selectedRange = NSRange(location: min(length, request.range.location), length: 0)
        }

        func applyHighlights(in view: UITextView) {
            guard view.markedTextRange == nil,
                  highlightedText != view.text || highlightedRanges != parent.highlights else { return }
            let hadHighlights = !highlightedRanges.isEmpty
            highlightedText = view.text
            highlightedRanges = parent.highlights
            guard hadHighlights || !parent.highlights.isEmpty else { return }
            let selection = view.selectedRange
            let base: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 16), .foregroundColor: UIColor(DSBotStyle.ink)
            ]
            view.textStorage.beginEditing()
            view.textStorage.setAttributes(base, range: NSRange(location: 0, length: view.textStorage.length))
            for range in parent.highlights where range.location >= 0 && NSMaxRange(range) <= view.textStorage.length {
                view.textStorage.addAttribute(.foregroundColor, value: UIColor(DSBotStyle.blue), range: range)
            }
            view.textStorage.endEditing()
            view.selectedRange = selection
            view.typingAttributes = base
        }

        func textView(_ view: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
            guard view.markedTextRange == nil, parent.completionActive else { return true }
            if text == "\n" || text == "\t" { return !(parent.onCompletionKey?("choose") ?? false) }
            return true
        }

        func textViewDidBeginEditing(_ view: UITextView) {
            if !parent.isFocused { parent.isFocused = true }
            parent.onTapEditor?()
            reportEditing(view)
        }

        func textViewDidEndEditing(_ view: UITextView) {
            reportEditing(view)
            if parent.isFocused { parent.isFocused = false }
        }
    }
}

private final class ComposerEditorView: UITextView {
    var completionActive = false
    var onCompletionKey: ((String) -> Bool)?
    var onTapEditor: (() -> Void)?

    override var keyCommands: [UIKeyCommand]? {
        guard completionActive else { return super.keyCommands }
        return [UIKeyCommand.inputUpArrow, UIKeyCommand.inputDownArrow, UIKeyCommand.inputEscape].map { input in
            let command = UIKeyCommand(input: input, modifierFlags: [], action: #selector(completionKey(_:)))
            command.wantsPriorityOverSystemBehavior = true
            return command
        } + (super.keyCommands ?? [])
    }

    @objc private func completionKey(_ command: UIKeyCommand) {
        guard markedTextRange == nil else { return }
        _ = onCompletionKey?(command.input ?? "")
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesEnded(touches, with: event)
        onTapEditor?()
    }
}

/// Repositions the same native editor when it wraps; no reparenting or first-responder handoff.
/// A multiline draft gets the full text width and its own bottom row of actions, like Muse.
struct ComposerLayout: Layout {
    var hasAttachments: Bool
    var isVoiceMode: Bool

    private let actionSize: CGFloat = DSBotLayout.composerHeight
    private let textInset: CGFloat = 14
    /// Match the action centres to the expanded border's corner centres on both axes.
    private var actionInset: CGFloat { max(0, DSBotLayout.composerCornerRadius - actionSize / 2) }

    private func measurements(width: CGFloat, subviews: Subviews) -> (expanded: Bool, text: CGSize, trailingWidth: CGFloat) {
        let trailingWidth = subviews[2].sizeThatFits(.unspecified).width
        let compact = subviews[1].sizeThatFits(ProposedViewSize(width: max(1, width - actionSize - trailingWidth), height: nil))
        let expanded = !isVoiceMode && (hasAttachments || compact.height > 46)
        let text = expanded
            ? subviews[1].sizeThatFits(ProposedViewSize(width: max(1, width - textInset * 2), height: nil))
            : compact
        return (expanded, text, trailingWidth)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 300
        let measured = measurements(width: width, subviews: subviews)
        return CGSize(width: width, height: measured.expanded
            ? measured.text.height + actionSize + actionInset : max(actionSize, measured.text.height))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let measured = measurements(width: bounds.width, subviews: subviews)
        let inset = measured.expanded ? actionInset : 0
        let actionY = measured.expanded ? bounds.maxY - actionSize - inset : bounds.minY
        subviews[0].place(
            at: CGPoint(x: bounds.minX + inset, y: actionY), anchor: .topLeading,
            proposal: ProposedViewSize(width: actionSize, height: actionSize)
        )
        subviews[1].place(
            at: CGPoint(x: bounds.minX + (measured.expanded ? textInset : actionSize), y: bounds.minY),
            anchor: .topLeading, proposal: ProposedViewSize(measured.text)
        )
        subviews[2].place(
            at: CGPoint(x: bounds.maxX - measured.trailingWidth - inset, y: actionY), anchor: .topLeading,
            proposal: ProposedViewSize(width: measured.trailingWidth, height: actionSize)
        )
    }
}
