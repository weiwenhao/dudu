import SwiftUI

/// Metadata rows in the native conversation's existing panel style. The editor keeps focus while
/// this list is open; selection inserts a token, never sends the message.
struct AssistantSuggestions: View {
    @ObservedObject var completion: AssistantCompletions
    let onSelect: (AssistantCompletions.Candidate) -> Void

    var body: some View {
        ScrollViewReader { reader in
            ScrollView {
                LazyVStack(spacing: 0) {
                    if completion.candidates.isEmpty {
                        if completion.status == .loading {
                            ProgressView().tint(DSBotStyle.muted)
                                .frame(maxWidth: .infinity, minHeight: 60)
                        } else {
                            Text(completion.status == .failed ? "连接暂时不可用。" : completion.query?.kind == .issue ? "没有事项" : "还没有技能")
                                .font(.system(size: 14))
                                .foregroundStyle(DSBotStyle.muted)
                                .frame(maxWidth: .infinity, minHeight: 60)
                        }
                    }
                    ForEach(Array(completion.candidates.enumerated()), id: \.element.id) { index, item in
                        Button { onSelect(item) } label: {
                            candidate(item)
                                .padding(.horizontal, 12)
                                .frame(minHeight: 48)
                                .contentShape(Rectangle())
                                .background(index == completion.selected ? DSBotStyle.selected : .clear,
                                            in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        .buttonStyle(DSBotRowButtonStyle())
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
        .background(DSBotStyle.chatPanel, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(DSBotStyle.chatBorder, lineWidth: 0.5)
                .allowsHitTesting(false)
        }
        .accessibilityIdentifier("assistant.suggestions")
    }

    @ViewBuilder
    private func candidate(_ candidate: AssistantCompletions.Candidate) -> some View {
        switch candidate {
        case .issue(let issue):
            HStack(spacing: 8) {
                if let agent = issue.agent { AgentLogo(agent: agent, size: 20) }
                Text(issue.address)
                    .font(.system(size: 12))
                    .foregroundStyle(DSBotStyle.muted)
                    .fixedSize()
                Text(issue.title)
                    .font(.system(size: 14))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let name = issue.project?.name {
                    HStack(spacing: 4) {
                        DSBotIcon(.workspace, size: 14, scalesStroke: true)
                        Text(name).lineLimit(1)
                    }
                    .font(.system(size: 12))
                    .foregroundStyle(DSBotStyle.muted)
                    .frame(maxWidth: 96, alignment: .trailing)
                }
            }
        case .skill(let skill):
            HStack(spacing: 10) {
                DSBotIcon(.skills, size: 20).foregroundStyle(DSBotStyle.muted)
                VStack(alignment: .leading, spacing: 2) {
                    Text("/\(skill.name)").font(.system(size: 14)).foregroundStyle(DSBotStyle.ink)
                    if !skill.description.isEmpty {
                        Text(skill.description).font(.system(size: 12)).foregroundStyle(DSBotStyle.muted).lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
