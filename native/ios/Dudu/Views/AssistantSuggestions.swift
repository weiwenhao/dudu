import SwiftUI
import UIKit

/// Metadata rows in the native conversation's existing panel style. The editor keeps focus while
/// this list is open; selection inserts a token, never sends the message.
struct AssistantSuggestions: View {
    @ObservedObject var completion: AssistantCompletions
    let onSelect: (AssistantCompletions.Candidate) -> Void

    /// Where the titles start: every row leaves the room of the widest ID in the list (measured in the ID's own font, so it does not move while the list scrolls) and of an agent's
    /// logo when any row has one, so that the titles stand in one column (owner, 2026-11-22: 「这里参差不齐啊，title 应该对齐吧」).
    private struct Columns {
        var address: CGFloat = 0
        var logo = false
    }

    private var columns: Columns {
        let font = UIFont.systemFont(ofSize: 12)
        return completion.candidates.reduce(into: Columns()) { columns, candidate in
            guard case .issue(let issue) = candidate else { return }
            columns.address = max(columns.address, ceil((issue.address as NSString).size(withAttributes: [.font: font]).width))
            if issue.agent != nil { columns.logo = true }
        }
    }

    var body: some View {
        let columns = columns
        ScrollViewReader { reader in
            ScrollView {
                LazyVStack(spacing: 0) {
                    if completion.candidates.isEmpty {
                        if completion.status == .loading {
                            ProgressView().tint(DuduStyle.muted)
                                .frame(maxWidth: .infinity, minHeight: 60)
                        } else {
                            Text(completion.status == .failed ? L10n.text("连接暂时不可用。") : completion.query?.kind == .issue ? L10n.text("没有事项") : L10n.text("还没有技能"))
                                .font(.system(size: 14))
                                .foregroundStyle(DuduStyle.muted)
                                .frame(maxWidth: .infinity, minHeight: 60)
                        }
                    }
                    ForEach(Array(completion.candidates.enumerated()), id: \.element.id) { index, item in
                        Button { onSelect(item) } label: {
                            candidate(item, columns: columns)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 48)
                                .contentShape(Rectangle())
                                .background(index == completion.selected ? DuduStyle.selected : .clear,
                                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(DuduRowButtonStyle())
                        .id(item.id)
                    }
                }
                .padding(4)
            }
            .frame(height: min(240, max(68, CGFloat(completion.candidates.count) * 48 + 8)))
            .scrollBounceBehavior(.basedOnSize)
            .onChange(of: completion.selected) { _, index in
                if completion.candidates.indices.contains(index) { reader.scrollTo(completion.candidates[index].id) }
            }
        }
        .background(DuduStyle.chatPanel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(DuduStyle.chatBorder, lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .accessibilityIdentifier("assistant.suggestions")
    }

    @ViewBuilder
    private func candidate(_ candidate: AssistantCompletions.Candidate, columns: Columns) -> some View {
        switch candidate {
        case .issue(let issue):
            HStack(spacing: 8) {
                if let agent = issue.agent { AgentLogo(agent: agent, size: 20) }
                else if columns.logo { Color.clear.frame(width: 20, height: 20) }
                Text(issue.address)
                    .font(.system(size: 12))
                    .foregroundStyle(DuduStyle.muted)
                    .fixedSize()
                    .frame(minWidth: columns.address, alignment: .leading)
                Text(issue.title)
                    .font(.system(size: 14))
                    .foregroundStyle(DuduStyle.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let name = issue.project?.name {
                    HStack(spacing: 4) {
                        DuduIcon(.workspace, size: 14, scalesStroke: true)
                        Text(name).lineLimit(1)
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(DuduStyle.muted)
                    .frame(maxWidth: 96, alignment: .trailing)
                }
            }
        case .skill(let skill):
            HStack(spacing: 10) {
                DuduIcon(.skills, size: 20).foregroundStyle(DuduStyle.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text("/\(skill.name)").font(.system(size: 14)).foregroundStyle(DuduStyle.ink)
                    if !skill.description.isEmpty {
                        Text(skill.description).font(.system(size: 12)).foregroundStyle(DuduStyle.muted).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
