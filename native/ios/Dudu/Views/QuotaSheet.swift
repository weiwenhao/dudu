import SwiftUI

/// The subscription quota, from the gauge button at the top right of the board (owner, 2026-11-11: "手机就按你的设计"; drawing `.local/designs/quota-icon-2026-11-11/phone.png`, A).
/// A sheet like the composer's "+" sheet (dimmed page, a #F4F4F4 sheet, white rounded cards): a grey title with the time of the reading, then one card for each agent the plugin lists,
/// a row for each of its windows (the name, what is left with its number coloured as it runs low, a thin bar, when it starts over) or its balance. Opening it is the ask; nothing runs after it closes.
struct QuotaSheet: View {
    @ObservedObject var model: QuotaModel
    let store: DuduStore

    enum Layout {
        static let titleBlock: CGFloat = ComposerAttachmentSheet.Layout.titleBlock
        static let sideInset: CGFloat = ComposerAttachmentSheet.Layout.sideInset
        static let cardRadius: CGFloat = ComposerAttachmentSheet.Layout.cardRadius
        static let cardPadding: CGFloat = 18
        static let cardGap: CGFloat = 10
        static let headHeight: CGFloat = 26
        static let rowHeight: CGFloat = 54
        static let amountHeight: CGFloat = 24
        static let maximumHeight: CGFloat = 600

        /// The sheet's height for what it holds: the title, a card for each block, and the bottom inset; the sheet adds the safe area itself.
        static func height(for blocks: [QuotaProvider]) -> CGFloat {
            guard !blocks.isEmpty else { return 300 }
            let cards = blocks.reduce(CGFloat(0)) { sum, block in
                let body = block.amount != nil ? amountHeight : CGFloat(block.rows.count) * rowHeight
                return sum + cardPadding * 2 + headHeight + 8 + body
            }
            return min(titleBlock + cards + CGFloat(blocks.count - 1) * cardGap + 16, maximumHeight)
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            titleRow.frame(height: Layout.titleBlock, alignment: .top)
            ScrollView {
                content
                    .padding(.horizontal, Layout.sideInset)
                    .padding(.bottom, 8)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ComposerAttachmentSheet.background)
        .onAppear { model.open(using: store) }
        .onDisappear { model.close() }
        .accessibilityIdentifier("quota.sheet")
    }

    private var titleRow: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(L10n.text("额度"))
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color(white: 0.4))
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 12)
            HStack(spacing: 4) {
                if model.refreshing {
                    ProgressView().controlSize(.mini).accessibilityHidden(true)
                }
                if let updated = QuotaText.updated(model.readAt) {
                    Text(updated)
                        .font(.system(size: 12))
                        .monospacedDigit()
                        .foregroundStyle(DuduStyle.muted)
                }
            }
        }
        .padding(.leading, 40.5)
        .padding(.trailing, 40.5)
        .padding(.top, 22)
    }

    @ViewBuilder
    private var content: some View {
        let blocks = model.blocks
        if !blocks.isEmpty {
            VStack(spacing: Layout.cardGap) {
                ForEach(blocks) { block in QuotaCard(block: block) }
            }
        } else if model.state == .loading || model.state == .idle || model.refreshing {
            VStack(spacing: Layout.cardGap) {
                QuotaSkeletonCard()
                QuotaSkeletonCard()
            }
            .accessibilityHidden(true)
        } else {
            Text(model.state == .failed ? "—" : L10n.text("暂无用量"))
                .font(.system(size: 14))
                .foregroundStyle(DuduStyle.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
        }
    }
}

private struct QuotaCard: View {
    let block: QuotaProvider

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let agent = SessionAgent(rawValue: block.agent) {
                    AgentLogo(agent: agent, size: 20)
                }
                Text(block.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(DuduStyle.ink)
                Spacer(minLength: 8)
                if let planLine = block.planLine {
                    Text(planLine)
                        .font(.system(size: 13))
                        .foregroundStyle(DuduStyle.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
            }
            .frame(height: QuotaSheet.Layout.headHeight)
            if let amount = block.amount {
                HStack {
                    Text(L10n.text("余额"))
                        .font(.system(size: 14))
                        .foregroundStyle(DuduStyle.chatSecondary)
                    Spacer(minLength: 8)
                    Text(amount)
                        .font(.system(size: 16, weight: .semibold))
                        .monospacedDigit()
                        .foregroundStyle(DuduStyle.ink)
                }
                .frame(height: QuotaSheet.Layout.amountHeight)
            }
            ForEach(block.rows) { row in QuotaRowView(row: row) }
        }
        .padding(QuotaSheet.Layout.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ComposerAttachmentSheet.card, in: RoundedRectangle(cornerRadius: QuotaSheet.Layout.cardRadius, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(block.name)
    }
}

private struct QuotaRowView: View {
    let row: QuotaRow

    private var numberColor: Color {
        switch row.level {
        case .normal: return DuduStyle.ink
        case .warn: return DuduStyle.chatWarning
        case .hot: return Color(red: 185.0 / 255, green: 28.0 / 255, blue: 28.0 / 255)
        }
    }

    private var barColor: Color {
        switch row.level {
        case .normal: return DuduStyle.blue
        case .warn: return DuduStyle.chatWarning
        case .hot: return DuduStyle.chatError
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.label)
                    .font(.system(size: 14))
                    .foregroundStyle(DuduStyle.chatSecondary)
                Spacer(minLength: 8)
                if let phrase = row.phrase {
                    Text(phrase)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color(red: 185.0 / 255, green: 28.0 / 255, blue: 28.0 / 255))
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(L10n.text("剩余"))
                            .font(.system(size: 13))
                            .foregroundStyle(DuduStyle.muted)
                        Text("\(row.left)%")
                            .font(.system(size: 16, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(numberColor)
                    }
                }
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(white: 236.0 / 255))
                    if row.left > 0 {
                        Capsule().fill(barColor).frame(width: max(4, proxy.size.width * CGFloat(row.left) / 100))
                    }
                }
            }
            .frame(height: 4)
            if let reset = row.reset {
                Text(reset)
                    .font(.system(size: 12))
                    .foregroundStyle(DuduStyle.muted)
            }
        }
        .frame(minHeight: QuotaSheet.Layout.rowHeight - 8, alignment: .top)
        .padding(.bottom, 8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(row.phrase.map { L10n.text("{0}，{1}", "\(row.label)", "\($0)") } ?? L10n.text("{0}，剩余 {1}%{2}", "\(row.label)", "\(row.left)", "\(row.reset.map { L10n.text("，{0}", "\($0)") } ?? "")"))
    }
}

/// Grey bars where the first reading is still being made.
private struct QuotaSkeletonCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(Color(white: 238.0 / 255)).frame(width: 20, height: 20)
                RoundedRectangle(cornerRadius: 4).fill(Color(white: 238.0 / 255)).frame(width: 64, height: 12)
            }
            ForEach(0..<2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        RoundedRectangle(cornerRadius: 4).fill(Color(white: 238.0 / 255)).frame(width: 44, height: 11)
                        Spacer()
                        RoundedRectangle(cornerRadius: 4).fill(Color(white: 238.0 / 255)).frame(width: 64, height: 11)
                    }
                    Capsule().fill(Color(white: 241.0 / 255)).frame(height: 4)
                }
            }
        }
        .padding(QuotaSheet.Layout.cardPadding)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ComposerAttachmentSheet.card, in: RoundedRectangle(cornerRadius: QuotaSheet.Layout.cardRadius, style: .continuous))
    }
}
