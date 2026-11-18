import SwiftUI

/// 转发: where a collected record, or the chosen records, can go (owner, 2026-11-18, the inbox redesign; the drawings are `.local/designs/inbox-forward-2026-11-18/`): the conversations of the open issues that
/// have a session, the one touched last first, in one white card (a 48pt tile in the colour of the title, "REF title", the Agent's logo); a box finds one by its number or its words. One conversation only
/// (owner: "我们的转发不需要多选"). A tap asks once more, in a card over the list (转发给, the conversation, what goes); 转发 sends it and the sheet goes, 取消 puts the card away.
struct ForwardPickerSheet: View {
    let records: [CollectorRecord]
    @ObservedObject var board: BoardModel
    @ObservedObject var store: DSBotStore
    /// Sends the records to the conversation of the issue; whether they went.
    let onForward: (BoardIssue) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var issues: [BoardIssue]?
    @State private var failed = false
    @State private var query = ""
    @State private var chosen: BoardIssue?
    @State private var sending = false
    @State private var sendFailed = false

    private var shown: [BoardIssue] {
        let words = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let issues else { return [] }
        return words.isEmpty ? issues : issues.filter { $0.title.localizedCaseInsensitiveContains(words) || $0.reference.localizedCaseInsensitiveContains(words) }
    }

    var body: some View {
        QuickSheetPage(title: L10n.text("转发"), onClose: { dismiss() }, centersTitle: true, actions: {}, filters: {
            searchField.padding(.bottom, 6)
        }) {
            list
        } footer: {}
        .overlay {
            if let chosen {
                confirmation(chosen)
                    .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.18), value: chosen?.id)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(DSBotStyle.sheet)
        .interactiveDismissDisabled(sending)
        .task {
            if let found = await board.openIssues(withSession: true, using: store) { issues = found } else { failed = true }
        }
    }

    // MARK: The list

    /// The glass field of the sidebar's search, in 40pt (owner's drawing): the words are typed here.
    private var searchField: some View {
        HStack(spacing: 10) {
            DSBotIcon(.search, size: 18).foregroundStyle(DSBotStyle.muted)
            TextField(L10n.text("搜索"), text: $query)
                .font(.system(size: 16))
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .accessibilityIdentifier("picker.query")
            if !query.isEmpty {
                Button { query = "" } label: {
                    DSBotIcon(.close, size: 14)
                        .foregroundStyle(DSBotStyle.muted)
                        .frame(width: 32, height: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L10n.text("清除搜索"))
            }
        }
        .padding(.leading, 14)
        .padding(.trailing, query.isEmpty ? 14 : 4)
        .frame(height: 40)
        .dsbotGlass(in: Capsule())
        .padding(.horizontal, DSBotLayout.sidebarPadding)
    }

    @ViewBuilder
    private var list: some View {
        if let issues {
            if shown.isEmpty {
                Text(issues.isEmpty ? L10n.text("没有事项") : L10n.text("没有找到事项"))
                    .font(.system(size: 15))
                    .foregroundStyle(DSBotStyle.muted)
                    .frame(maxWidth: .infinity, minHeight: 160)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text(L10n.text("最近会话"))
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.muted)
                        .padding(.leading, 2)
                        .padding(.top, 16)
                    VStack(spacing: 0) {
                        ForEach(shown) { issue in
                            row(issue)
                            if issue.id != shown.last?.id { QuickTodoSeparator(leading: 74) }
                        }
                    }
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                }
            }
        } else if failed {
            Text(L10n.text("事项没能加载"))
                .font(.system(size: 15))
                .foregroundStyle(DSBotStyle.muted)
                .frame(maxWidth: .infinity, minHeight: 160)
        } else {
            ProgressView().tint(DSBotStyle.muted).frame(maxWidth: .infinity, minHeight: 160)
        }
    }

    /// A conversation as the home list draws it: its tile, "REF title" in one line, the Agent's logo at the right.
    private func row(_ issue: BoardIssue) -> some View {
        Button {
            sendFailed = false
            chosen = issue
        } label: {
            HStack(spacing: 12) {
                ConversationTile(title: issue.title, size: 48)
                Text(verbatim: "\(issue.reference) \(issue.title)")
                    .font(.system(size: 16))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let agent = issue.sessionAgent { AgentLogo(agent: agent, size: 16) }
            }
            .padding(.horizontal, 14)
            .frame(height: 66)
            .contentShape(Rectangle())
        }
        .buttonStyle(DSBotRowButtonStyle())
        .accessibilityIdentifier("picker.issue.\(issue.id)")
    }

    // MARK: The card that asks once more

    private func confirmation(_ issue: BoardIssue) -> some View {
        ZStack {
            Color.black.opacity(0.32)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture { if !sending { chosen = nil } }
            VStack(alignment: .leading, spacing: 0) {
                Text(L10n.text("转发给"))
                    .font(.system(size: 13))
                    .foregroundStyle(DSBotStyle.muted)
                HStack(spacing: 12) {
                    ConversationTile(title: issue.title, size: 40)
                    Text(verbatim: "\(issue.reference) \(issue.title)")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(DSBotStyle.ink)
                        .lineLimit(1)
                }
                .padding(.top, 6)
                preview
                    .padding(.top, 18)
                if sendFailed {
                    Text(L10n.text("更改没能保存"))
                        .font(.system(size: 13))
                        .foregroundStyle(DSBotStyle.chatError)
                        .padding(.top, 12)
                        .accessibilityIdentifier("picker.failed")
                }
                HStack(spacing: 12) {
                    Button { chosen = nil } label: {
                        Text(L10n.text("取消"))
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(DSBotStyle.ink)
                            .frame(maxWidth: .infinity)
                            .frame(height: 46)
                            .contentShape(Capsule())
                    }
                    .buttonStyle(DSBotGlassCapsuleButtonStyle())
                    .disabled(sending)
                    .accessibilityIdentifier("picker.cancel")
                    Button { send(to: issue) } label: {
                        Group {
                            if sending {
                                ProgressView().tint(.white)
                            } else {
                                Text(L10n.text("转发")).font(.system(size: 16, weight: .medium))
                            }
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 46)
                        .background(DSBotStyle.ink, in: Capsule())
                        .contentShape(Capsule())
                    }
                    .buttonStyle(DSBotQuietPressStyle())
                    .disabled(sending)
                    .accessibilityIdentifier("picker.forward")
                }
                .padding(.top, sendFailed ? 14 : 30)
            }
            .padding(24)
            .frame(width: 321)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .shadow(color: .black.opacity(0.13), radius: 14, y: 3)
        }
    }

    /// What goes, as the list shows it: the title of the record and its number, who and where; for several, the first one's title and how many are chosen.
    private var preview: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(records.first?.title ?? "")
                .font(.system(size: 15, weight: .medium))
                .lineSpacing(2)
                .foregroundStyle(DSBotStyle.ink)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Text(previewLine)
                .font(.system(size: 12))
                .foregroundStyle(DSBotStyle.muted)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(DSBotStyle.selected, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var previewLine: String {
        guard records.count == 1, let record = records.first else { return L10n.text("已选 {0} 条", "\(records.count)") }
        return [record.ref ?? "", record.byLine].filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func send(to issue: BoardIssue) {
        guard !sending else { return }
        sending = true
        sendFailed = false
        Task {
            let went = await onForward(issue)
            sending = false
            if went { dismiss() } else { sendFailed = true }
        }
    }
}
