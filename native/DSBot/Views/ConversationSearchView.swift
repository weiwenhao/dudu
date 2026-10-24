import SwiftUI

struct ConversationSearchView: View {
    @ObservedObject var store: DSBotStore
    @ObservedObject var search: SessionSearchModel
    let onBack: () -> Void
    let onOpen: (SessionSummary) -> Void
    @FocusState private var isFocused: Bool

    private struct RequestKey: Equatable {
        var query: String
        var computerID: String?
        var revision: Int
        var status: String
    }

    var body: some View {
        VStack(spacing: 0) {
            searchBar
                .padding(.horizontal, 12)
                .padding(.bottom, 8)

            ScrollView {
                LazyVStack(spacing: 0) {
                    if let error = search.error {
                        Text(error)
                            .font(.system(size: 13))
                            .foregroundStyle(DSBotStyle.muted)
                            .padding(20)
                    }
                    ForEach(search.results) { hit in
                        resultRow(hit)
                    }
                    if search.isLoading {
                        ProgressView()
                            .tint(DSBotStyle.muted)
                            .padding(24)
                    } else if !search.query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                              search.results.isEmpty, search.error == nil {
                        Text("没有匹配的会话")
                            .font(.system(size: 13))
                            .foregroundStyle(DSBotStyle.muted)
                            .padding(24)
                    }
                }
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Color.white.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("search.page")
        .overlay(alignment: .leading) {
            Color.clear
                .frame(width: 12)
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 24).onEnded { value in
                    if value.translation.width > 70, abs(value.translation.height) < value.translation.width {
                        onBack()
                    }
                })
                .accessibilityHidden(true)
        }
        .task {
            if search.query.isEmpty { isFocused = true }
        }
        .task(id: RequestKey(
            query: search.query, computerID: store.activeComputer?.id, revision: store.connectionRevision,
            status: store.status.rawValue
        )) {
            await search.load(using: store)
        }
    }

    private var searchBar: some View {
        HStack(spacing: 4) {
            Button(action: onBack) {
                DSBotIcon(.back, size: 22)
                    .foregroundStyle(DSBotStyle.ink)
                    .frame(width: 36, height: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("返回")
            .accessibilityIdentifier("search.back")

            HStack(spacing: 8) {
                DSBotIcon(.search, size: 17)
                    .foregroundStyle(DSBotStyle.muted)
                TextField("搜索对话内容…", text: $search.query)
                    .font(.system(size: 14))
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .focused($isFocused)
                    .submitLabel(.search)
                    .onSubmit { isFocused = false }
                    .accessibilityIdentifier("search.query")
                if !search.query.isEmpty {
                    Button {
                        search.reset()
                        isFocused = true
                    } label: {
                        DSBotIcon(.close, size: 14)
                            .foregroundStyle(DSBotStyle.muted)
                            .frame(width: 30, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("清除搜索")
                    .accessibilityIdentifier("search.clear")
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 4)
            .frame(height: 38)
            .background(DSBotStyle.sheet, in: Capsule())
        }
        .frame(height: DSBotLayout.toolbarHeight)
    }

    private func resultRow(_ hit: SessionSearchHit) -> some View {
        Button {
            isFocused = false
            onOpen(hit.session)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                DSBotIcon(.message, size: 16, strokeWidth: 1.5)
                    .foregroundStyle(DSBotStyle.muted)
                    .frame(width: 32, height: 32)
                    .overlay(Circle().stroke(DSBotStyle.line, lineWidth: 1))
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        highlighted(hit.session.title)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(DSBotStyle.ink)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text(Date(timeIntervalSince1970: hit.session.updatedAt / 1000), format: .dateTime.month().day())
                            .font(.system(size: 11))
                            .foregroundStyle(DSBotStyle.muted)
                    }
                    if !hit.snippet.isEmpty {
                        highlighted(hit.snippet)
                            .font(.system(size: 12))
                            .foregroundStyle(DSBotStyle.muted)
                            .lineLimit(2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("search.result.\(hit.id)")
    }

    private func highlighted(_ value: String) -> Text {
        let phrase = search.query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !phrase.isEmpty else { return Text(value) }
        var output = Text("")
        var cursor = value.startIndex
        while let range = value.range(of: phrase, options: [.caseInsensitive, .diacriticInsensitive], range: cursor..<value.endIndex) {
            output = output + Text(String(value[cursor..<range.lowerBound]))
                + Text(String(value[range])).foregroundColor(DSBotStyle.ink).bold()
            cursor = range.upperBound
        }
        return output + Text(String(value[cursor...]))
    }
}
