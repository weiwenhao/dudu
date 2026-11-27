import SwiftUI
import UIKit

struct ComputerListView: View {
    @ObservedObject var store: DuduStore
    var onClose: (() -> Void)?

    @Environment(\.dismiss) private var dismiss
    @State private var isPairingPresented = false
    @State private var revealedDeleteID: String?
    @State private var detailComputerID: String?
    @State private var showsConnectionDetails = false
    private let deleteActionWidth: CGFloat = 82

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(store.computers) { computer in
                    swipeableComputerRow(computer)
                }

                if store.activeComputer != nil {
                    Button {
                        DuduLog.record("computer.reconnect")
                        Task { await store.reconnect() }
                    } label: {
                        HStack(spacing: 12) {
                            DuduIcon(.reconnect)
                                .foregroundStyle(DuduStyle.ink)
                                .frame(width: 28)
                            Text(store.status == .connecting ? L10n.text("正在连接…") : L10n.text("重新连接"))
                                .font(.system(size: 15, weight: .medium))
                                .foregroundStyle(DuduStyle.ink)
                            Spacer()
                            if store.status == .connecting {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(DuduStyle.muted)
                            }
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 58)
                        .frame(maxWidth: 640)
                        .background(.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(DuduRowButtonStyle())
                    .disabled(store.status == .connecting)
                    .accessibilityIdentifier("computers.reconnect")
                    .padding(.top, 14)
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 28)
        }
        .accessibilityIdentifier("computers.list")
        .background(DuduStyle.settingsBackground.ignoresSafeArea())
        .navigationBarBackButtonHidden(onClose != nil)
        .minimalBackButton()
        .tint(DuduStyle.ink)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .toolbarBackground(DuduStyle.settingsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.light, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                Text(L10n.text("电脑连接"))
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    isPairingPresented = true
                    DuduLog.record("pairing.add.open")
                } label: {
                    DuduIcon(.plus, size: 22)
                        .foregroundStyle(DuduStyle.ink)
                        .frame(width: DuduLayout.toolbarButtonSize, height: DuduLayout.toolbarButtonSize)
                        .contentShape(Circle())
                }
                .accessibilityLabel(L10n.text("添加电脑"))
                .accessibilityIdentifier("computers.add")
            }
            if onClose != nil {
                // Close sits last on the right, apart from the add button (the same spacing as QuickSheetPage).
                if #available(iOS 26.0, *) {
                    ToolbarSpacer(.fixed, placement: .topBarTrailing)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    SheetCloseButton(label: L10n.text("关闭电脑连接"), action: close)
                    .accessibilityIdentifier("computers.close")
                }
            }
        }
        .navigationDestination(isPresented: $isPairingPresented) {
            // Adding another computer is the connection guide again (owner, 2026-11-27, option A): the steps, scan and paste, and a way back.
            ConnectionGuideView(store: store, mode: .adding)
        }
        .navigationDestination(isPresented: $showsConnectionDetails) {
            if let detailComputerID { ComputerConnectionView(store: store, computerID: detailComputerID).hidesTabBarWhenPushed() }
        }
    }

    private func swipeableComputerRow(_ computer: Computer) -> some View {
        let isFirst = computer.id == store.computers.first?.id
        let isLast = computer.id == store.computers.last?.id
        let isDeleteRevealed = revealedDeleteID == computer.id

        return GeometryReader { geometry in
            HStack(spacing: 0) {
                computerRow(
                    computer,
                    isFirst: isFirst,
                    isLast: isLast,
                    deleteActionRevealed: isDeleteRevealed
                )
                .frame(width: geometry.size.width - (isDeleteRevealed ? deleteActionWidth : 0))

                if isDeleteRevealed {
                    deleteButton(for: computer, isFirst: isFirst, isLast: isLast)
                        .frame(width: deleteActionWidth)
                        .transition(.move(edge: .trailing))
                }
            }
            .animation(.snappy(duration: 0.22), value: isDeleteRevealed)
        }
        .frame(height: computer.id == store.computers.last?.id ? 66 : 67)
        .clipped()
    }

    private func deleteButton(for computer: Computer, isFirst: Bool, isLast: Bool) -> some View {
        Button {
            remove(computer)
        } label: {
            VStack(spacing: 6) {
                Image(systemName: "trash")
                    .font(.system(size: 20, weight: .regular))
                Text(L10n.text("删除"))
                    .font(.system(size: 12, weight: .medium))
            }
            .foregroundStyle(.white)
            .frame(width: deleteActionWidth)
            .frame(maxHeight: .infinity)
            .background(
                Color(red: 0.88, green: 0.20, blue: 0.24),
                in: UnevenRoundedRectangle(
                    cornerRadii: RectangleCornerRadii(
                        topLeading: 0,
                        bottomLeading: 0,
                        bottomTrailing: isLast ? 22 : 0,
                        topTrailing: isFirst ? 22 : 0
                    ),
                    style: .continuous
                )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .zIndex(2)
        .accessibilityLabel(L10n.text("删除"))
        .accessibilityIdentifier("computer.delete.\(computer.id)")
    }

    private func revealDeleteAction(for computer: Computer, translationX: CGFloat) {
        if translationX < -36 {
            revealedDeleteID = computer.id
        } else if translationX > 36, revealedDeleteID == computer.id {
            revealedDeleteID = nil
        }
    }

    private func computerRow(
        _ computer: Computer,
        isFirst: Bool,
        isLast: Bool,
        deleteActionRevealed: Bool
    ) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                DuduIcon(.computer)
                    .foregroundStyle(DuduStyle.ink)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 5) {
                    Text(computer.name)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(DuduStyle.ink)
                        .lineLimit(1)
                    Text(subtitle(for: computer))
                        .font(.system(size: 11))
                        .foregroundStyle(DuduStyle.muted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 4)
                if computer.id == store.activeComputer?.id {
                    DuduIcon(.check, size: 20)
                        .foregroundStyle(DuduStyle.ink)
                }
                Color.clear.frame(width: 32)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 66)
            .accessibilityHidden(true)

            if !isLast {
                Rectangle()
                    .fill(DuduStyle.line)
                    .frame(height: 1)
                    .padding(.leading, 58)
            }
        }
        .padding(.horizontal, 6)
        .frame(maxWidth: 640)
        .background(
            UnevenRoundedRectangle(
                cornerRadii: RectangleCornerRadii(
                    topLeading: isFirst ? 22 : 0,
                    bottomLeading: isLast ? 22 : 0,
                    bottomTrailing: deleteActionRevealed ? 0 : (isLast ? 22 : 0),
                    topTrailing: deleteActionRevealed ? 0 : (isFirst ? 22 : 0)
                ),
                style: .continuous
            )
            .fill(.white)
        )
        .frame(maxWidth: .infinity)
        .overlay {
            HStack(spacing: 0) {
              ComputerRowInteraction(
                identifier: "computer.row.\(computer.id)",
                label: "\(computer.name), \(subtitle(for: computer))",
                isSelected: computer.id == store.activeComputer?.id,
                onTap: {
                    if computer.id != store.activeComputer?.id {
                        DuduLog.record("computer.switch")
                        Task { await store.selectComputer(computer) }
                    }
                    close()
                },
                onSwipe: { translationX in
                    revealDeleteAction(for: computer, translationX: translationX)
                },
                onDelete: { remove(computer) }
              )
              Button {
                  detailComputerID = computer.id
                  showsConnectionDetails = true
              } label: {
                  DuduIcon(.info, size: 20)
                      .foregroundStyle(DuduStyle.ink)
                      .frame(width: 44, height: 44)
                      .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .accessibilityLabel(L10n.text("{0} 的连接详情", "\(computer.name)"))
              .accessibilityIdentifier("computer.info.\(computer.id)")
              .padding(.trailing, 8)
            }
        }
    }

    private func subtitle(for computer: Computer) -> String {
        computer.id == store.activeComputer?.id && store.status == .connected
            ? L10n.text("已连接 · {0}", "\(computer.shortAddress)") : computer.shortAddress
    }

    private func remove(_ computer: Computer) {
        revealedDeleteID = nil
        DuduLog.record("computer.remove")
        Task { await store.removeComputer(computer) }
    }

    private func close() {
        if let onClose {
            onClose()
        } else {
            dismiss()
        }
    }
}

private struct ComputerRowInteraction: UIViewRepresentable {
    let identifier: String
    let label: String
    let isSelected: Bool
    let onTap: () -> Void
    let onSwipe: (CGFloat) -> Void
    let onDelete: () -> Void

    func makeUIView(context: Context) -> ComputerRowTouchTarget {
        ComputerRowTouchTarget(frame: .zero)
    }

    func updateUIView(_ button: ComputerRowTouchTarget, context: Context) {
        button.accessibilityIdentifier = identifier
        button.accessibilityLabel = label
        button.accessibilityTraits = isSelected ? [.button, .selected] : [.button]
        button.onTap = onTap
        button.onSwipe = onSwipe
        button.onDelete = onDelete
    }
}

private final class ComputerRowTouchTarget: UIView {
    var onTap: (() -> Void)?
    var onSwipe: ((CGFloat) -> Void)?
    var onDelete: (() -> Void)?
    private let swipeDelegate = ComputerRowPanDelegate()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = true
        layer.cornerRadius = 12
        clipsToBounds = true
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(selectRow)))
        let pan = UIPanGestureRecognizer(target: self, action: #selector(handlePan(_:)))
        pan.maximumNumberOfTouches = 1
        pan.delegate = swipeDelegate
        addGestureRecognizer(pan)
        accessibilityCustomActions = [
            UIAccessibilityCustomAction(name: L10n.text("删除"), target: self, selector: #selector(deleteRow))
        ]
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesBegan(touches, with: event)
        backgroundColor = UIColor.black.withAlphaComponent(0.045)
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesEnded(touches, with: event)
        backgroundColor = .clear
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        super.touchesCancelled(touches, with: event)
        backgroundColor = .clear
    }

    override func accessibilityActivate() -> Bool {
        onTap?()
        return true
    }

    @objc private func selectRow() {
        onTap?()
    }

    @objc private func deleteRow() -> Bool {
        onDelete?()
        return true
    }

    @objc private func handlePan(_ pan: UIPanGestureRecognizer) {
        if pan.state == .began { backgroundColor = .clear }
        guard pan.state == .ended else { return }
        let translation = pan.translation(in: self)
        guard abs(translation.x) > 36, abs(translation.x) > abs(translation.y) * 1.25 else { return }
        onSwipe?(translation.x)
    }
}

private final class ComputerRowPanDelegate: NSObject, UIGestureRecognizerDelegate {
    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return true }
        let velocity = pan.velocity(in: pan.view)
        // Reject vertical drags before recognition so the scroll view can keep them.
        return abs(velocity.x) > abs(velocity.y) * 1.25
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        otherGestureRecognizer.view is UIScrollView
    }
}
