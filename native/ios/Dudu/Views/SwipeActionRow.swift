import SwiftUI

/// One thing a swiped row can do: a block with an icon over its word.
struct SwipeAction: Identifiable {
    let id: String
    let title: String
    /// An SF Symbol, as the computers list draws its trash can.
    let symbol: String
    let color: Color
    let run: () -> Void

    /// The red of the delete block in the computers list.
    static let red = Color(red: 0.88, green: 0.20, blue: 0.24)
    /// A quiet grey for the block that puts a thing aside (white text on it reads at 4.5 : 1, which the app's muted grey does not give).
    static let grey = Color(red: 0.42, green: 0.43, blue: 0.46)
}

/// The swipe to the left of this app (the computers list's, owner 2026-11-07: "这个才是我们左滑的风格"). A swipe left of more than 36 points that is mostly
/// horizontal makes the row narrower and puts its actions at its trailing end, each a block 82 points wide with its icon over its word in white, the last one
/// round at the row's outer corners; a swipe right, a tap on the row, or anything else the page does (a tab, choosing rows) puts them away. The page keeps which
/// row is open (`isRevealed`: one at a time). The system's `swipeActions` are not used: they draw something else.
/// The actions are also what VoiceOver offers on the row, open or not.
struct SwipeActionRow<Content: View>: View {
    static var blockWidth: CGFloat { 82 }

    let actions: [SwipeAction]
    var cornerRadius: CGFloat = 11
    let isRevealed: Bool
    let onReveal: (Bool) -> Void
    @ViewBuilder let content: () -> Content

    private var shown: Bool { isRevealed && !actions.isEmpty }

    var body: some View {
        HStack(spacing: 0) {
            content()
                .frame(maxWidth: .infinity)
                .simultaneousGesture(swipe)
                .accessibilityActions {
                    ForEach(actions) { action in
                        Button(action.title, action: action.run)
                    }
                }
            if shown {
                HStack(spacing: 0) {
                    ForEach(Array(actions.enumerated()), id: \.element.id) { index, action in
                        block(action, isLast: index == actions.count - 1)
                    }
                }
                .transition(.move(edge: .trailing))
            }
        }
        .animation(.snappy(duration: 0.22), value: shown)
    }

    private var swipe: some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                let across = value.translation.width
                // Mostly sideways only: an up or down drag is the list's to scroll.
                guard abs(across) > 36, abs(across) > abs(value.translation.height) * 1.25 else { return }
                if across < 0 {
                    if !actions.isEmpty { onReveal(true) }
                } else {
                    onReveal(false)
                }
            }
    }

    private func block(_ action: SwipeAction, isLast: Bool) -> some View {
        Button {
            onReveal(false)
            action.run()
        } label: {
            VStack(spacing: 6) {
                Image(systemName: action.symbol)
                    .font(.system(size: 20, weight: .regular))
                Text(action.title)
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(.white)
            .frame(width: Self.blockWidth)
            .frame(maxHeight: .infinity)
            .background(
                action.color,
                in: UnevenRoundedRectangle(
                    cornerRadii: RectangleCornerRadii(
                        topLeading: 0, bottomLeading: 0,
                        bottomTrailing: isLast ? cornerRadius : 0, topTrailing: isLast ? cornerRadius : 0
                    ),
                    style: .continuous
                )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHidden(true) // VoiceOver has them as the row's actions
        .accessibilityIdentifier("swipe.action.\(action.id)")
    }
}
