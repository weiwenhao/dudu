import SwiftUI

/// One block at the end of a swiped row, drawn as the board list draws its own (`BoardConversationSwipeRow`): 84 points wide, a 22 point glyph over a 14 point word, white on its colour.
struct RevealSwipeAction: Identifiable {
    enum Glyph {
        /// A white template image of the asset catalog (the board list's own glyphs).
        case asset(String)
        case icon(DSBotGlyph)
    }

    let id: String
    let title: String
    let glyph: Glyph
    let color: Color
    let run: () -> Void

    static let width: CGFloat = 84
    /// The board list's colours: the teal of 完成 and the blue of 置顶. Android's `SwipeColors` are the same numbers.
    static let teal = Color(red: 39.0 / 255, green: 179.0 / 255, blue: 160.0 / 255)
    static let blue = Color(red: 51.0 / 255, green: 109.0 / 255, blue: 244.0 / 255)
}

/// What a swipe to the right does. A tap on its block, or a swipe past two thirds of the row, runs it once the row has slid away and closed; a row that is still there afterwards
/// (the change did not go through) comes back as it was.
struct RevealSwipeCompletion {
    let title: String
    let asset: String
    let color: Color
    let run: () async -> Void
}

/// The board list's swipe for a row of any height (owner, 2026-11-19, on the inbox: "右滑已处理，左滑点击转发，参考看板列表"): the row keeps its width and slides over its blocks; to the
/// right is one thing that is done at once, to the left the blocks to tap. The page keeps which row is open (`isRevealed`: one at a time). A block shows only where the row has left:
/// a row with no ground of its own lets nothing through.
struct RevealSwipeRow<Content: View>: View {
    let completion: RevealSwipeCompletion?
    let trailing: [RevealSwipeAction]
    let enabled: Bool
    let isRevealed: Bool
    let onReveal: (Bool) -> Void
    var event = "row.swipe"
    @ViewBuilder let content: () -> Content

    @State private var offset: CGFloat = 0
    @State private var start: CGFloat = 0
    @State private var size: CGSize = .zero
    @State private var isCompleting = false
    @State private var collapsed = false
    @State private var completionArmed = false
    @State private var completionLabelVisible = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var actionWidth: CGFloat { RevealSwipeAction.width }
    private var trailingWidth: CGFloat { actionWidth * CGFloat(trailing.count) }
    private var armingOffset: CGFloat { size.width * 2 / 3 }

    var body: some View {
        content()
            .compositingGroup()
            .offset(x: offset)
            .background { blocks }
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .gesture(SwipeRowPanGesture(
                event: event, enabled: enabled && !isCompleting && (completion != nil || !trailing.isEmpty),
                allowsCompletion: completion != nil || isRevealed,
                onBegan: { start = offset },
                onChanged: { translation in
                    offset = min(size.width, max(-trailingWidth, start + translation))
                    if completion == nil { offset = min(0, offset) }
                    completionArmed = completion != nil && start >= 0 && size.width > 0 && offset >= armingOffset
                    if abs(offset) > 8, !isRevealed { onReveal(true) }
                }, onEnded: { completed, velocity in
                    guard completed else { close(); return }
                    if completion != nil, start >= 0, size.width > 0, offset >= armingOffset { complete() }
                    else {
                        let end = BoardSwipe.destination(start: start, offset: offset, velocity: velocity, actionWidth: actionWidth, trailingWidth: trailingWidth)
                        settle(end)
                        onReveal(end != 0)
                    }
                }))
            // The row keeps its own height while its band closes over it, towards the middle.
            .fixedSize(horizontal: false, vertical: true)
            .frame(height: isCompleting ? (collapsed ? 0 : size.height) : nil, alignment: .center)
            .clipped()
            .allowsHitTesting(!isCompleting)
            .accessibilityActions {
                if enabled {
                    if let completion { Button(completion.title) { complete() } }
                    ForEach(trailing) { action in Button(action.title, action: action.run) }
                }
            }
            .onChange(of: isRevealed) { _, open in if !open, !isCompleting { settle(0) } }
            .onChange(of: enabled) { _, value in if !value, !isCompleting { close() } }
            .onDisappear {
                if !isCompleting { offset = 0 }
                onReveal(false)
            }
    }

    @ViewBuilder
    private var blocks: some View {
        if offset > 0, let completion {
            Button { complete() } label: {
                block(completion.title, glyph: .asset(completion.asset))
                    .frame(width: actionWidth)
                    .opacity(completionLabelVisible ? 1 : 0)
                    // Past two thirds the word goes to the row's edge: letting go there does it.
                    .offset(x: completionArmed ? max(0, offset - actionWidth) : 0)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: completionArmed)
                    .frame(width: max(actionWidth, offset), alignment: .leading)
                    .background(completion.color.opacity(collapsed ? 0 : 1))
            }
            .buttonStyle(.plain)
            .frame(width: offset, alignment: .leading)
            .clipped()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        } else if offset < 0 {
            HStack(spacing: 0) {
                ForEach(trailing) { action in
                    Button { close(); action.run() } label: {
                        block(action.title, glyph: action.glyph).background(action.color)
                    }
                    .frame(width: actionWidth)
                }
            }
            .buttonStyle(.plain)
            .frame(width: -offset, alignment: .trailing)
            .clipped()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
        }
    }

    private func block(_ title: String, glyph: RevealSwipeAction.Glyph) -> some View {
        VStack(spacing: 4) {
            switch glyph {
            case .asset(let name): Image(name).resizable().renderingMode(.template).frame(width: 22, height: 22)
            case .icon(let icon): DSBotIcon(icon, size: 22)
            }
            Text(title).font(.system(size: 14)).lineLimit(1).frame(height: 18)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .contentShape(Rectangle())
    }

    private func settle(_ value: CGFloat) {
        withAnimation(reduceMotion ? nil : .snappy(duration: 0.22)) { offset = value; completionArmed = false }
    }

    private func close() { settle(0); onReveal(false) }

    /// The board list's completion: the row goes off to the right, the word fades, the band closes towards its middle and its colour with it; then the thing is done.
    private func complete() {
        guard enabled, let completion, !isCompleting, size.width > 0 else { return }
        isCompleting = true
        onReveal(false)
        completionArmed = true
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18), completionCriteria: .logicallyComplete) {
            offset = size.width
        } completion: {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.06), completionCriteria: .logicallyComplete) {
                completionLabelVisible = false
            } completion: {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22), completionCriteria: .logicallyComplete) {
                    collapsed = true
                } completion: {
                    Task { @MainActor in
                        await completion.run()
                        // A change that did not go through keeps the row: it is back as it was, at once.
                        var transaction = Transaction()
                        transaction.disablesAnimations = true
                        withTransaction(transaction) {
                            offset = 0
                            collapsed = false
                            completionArmed = false
                            completionLabelVisible = true
                            isCompleting = false
                        }
                    }
                }
            }
        }
    }
}
