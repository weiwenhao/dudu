import SwiftUI
import QuickLook
import UIKit

#if DEBUG && targetEnvironment(simulator)
struct SimulatorFileBrowserReview: View {
    let delivered: Bool
    @State private var changes: ConversationChanges? = ConversationParityFixture.changes

    var body: some View {
        if delivered { DeliveredFilesBrowser(files: ConversationParityFixture.presentedFiles) }
        else { ChangedFilesBrowser(changes: $changes, seq: 109) }
    }
}
#endif

struct TurnFilesView: View {
    let files: [DeliveredFile]
    let changesSeq: Double?
    let changesSummary: ConversationChangeSummary?

    var body: some View {
        let collection = TurnFileCollection(files)
        VStack(alignment: .leading, spacing: 10) {
            if let changesSeq {
                TurnChangesCard(seq: changesSeq, summary: changesSummary)
                    .id(changesSeq)
            }
            if !collection.presented.isEmpty {
                TurnDeliveredFiles(files: collection.presented)
            }
        }
        .foregroundStyle(DSBotStyle.chatSecondary)
    }
}

private struct TurnChangesCard: View {
    let seq: Double
    let summary: ConversationChangeSummary?
    @Environment(\.conversationAccess) private var access
    @State private var changes: ConversationChanges?
    @State private var showingFiles = false

    var body: some View {
        let counts = changes?.summary ?? summary
        Button { showingFiles = true } label: {
            HStack(spacing: 12) {
                Image("ChangedFiles")
                    .resizable()
                    .renderingMode(.original)
                    .frame(width: 24, height: 24)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text(counts.map { L10n.plural("已编辑 \($0.total) 个文件") } ?? L10n.text("已编辑文件"))
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(DSBotStyle.chatInk)
                        .lineLimit(1)
                    // Keep the loaded card's existing two-line layout stable while its
                    // details are unknown. Loading and failure belong to the opened sheet.
                    FileChangeCounts(added: counts?.added ?? 0, deleted: counts?.deleted ?? 0)
                        .opacity(counts == nil ? 0 : 1)
                        .accessibilityHidden(counts == nil)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                FileDisclosure()
            }
            .padding(14)
            .frame(minHeight: 56)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(access?.connected != true)
        .accessibilityIdentifier("changes.toggle")
        .modifier(TurnFileSurface())
        .sheet(isPresented: $showingFiles) {
            ChangedFilesBrowser(changes: $changes, seq: seq)
        }
    }
}

private struct TurnDeliveredFiles: View {
    let files: [DeliveredFile]
    @State private var showingFiles = false
    @State private var preview = TurnFilePreview()

    var body: some View {
        let names = TurnFileCollection.displayNames(files)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(files.prefix(TurnFileCollection.previewLimit))) { file in
                if file.id != files.first?.id { fileDivider }
                DeliveredFileRow(file: file, title: names[file.id] ?? file.name, preview: preview)
            }
            if files.count > TurnFileCollection.previewLimit {
                fileDivider
                Button { showingFiles = true } label: {
                    HStack(spacing: 10) {
                        Text(L10n.plural("全部 \(files.count) 个文件"))
                            .font(.subheadline)
                        Spacer(minLength: 8)
                        FileDisclosure()
                    }
                    .foregroundStyle(DSBotStyle.chatSecondary)
                    .padding(.horizontal, 14)
                    .frame(minHeight: 48)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("files.presented.all")
            }
        }
        .modifier(TurnFileSurface())
        .modifier(TurnFilePreviewPresentation(preview: preview))
        .sheet(isPresented: $showingFiles) {
            DeliveredFilesBrowser(files: files)
        }
    }

    private var fileDivider: some View {
        Rectangle().fill(DSBotStyle.chatBorder).frame(height: 0.5).padding(.leading, 48)
    }
}

private struct TurnFileSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(DSBotStyle.chatPanel, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(DSBotStyle.chatBorder, lineWidth: 0.5))
    }
}

private struct FileDisclosure: View {
    var body: some View {
        DSBotIcon(.right, size: 14, scalesStroke: true)
            .foregroundStyle(DSBotStyle.chatTertiary)
            .accessibilityHidden(true)
    }
}

private struct FileChangeCounts: View {
    let added: Int
    let deleted: Int

    var body: some View {
        HStack(spacing: 8) {
            Text("+\(added)").foregroundStyle(.green)
            Text("-\(deleted)").foregroundStyle(DSBotStyle.chatError)
        }
        .font(.caption.monospacedDigit())
        .fixedSize(horizontal: true, vertical: false)
    }
}

private struct DeliveredFileRow: View {
    let file: DeliveredFile
    let title: String
    let preview: TurnFilePreview
    @Environment(\.conversationAccess) private var access

    var body: some View {
        Button {
            if let access { preview.open(file, access: access) }
        } label: {
            HStack(spacing: 12) {
                if preview.loadingID == file.id {
                    ProgressView().controlSize(.small).frame(width: 22)
                } else {
                    DSBotIcon(.file, size: 22).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(DSBotStyle.chatInk)
                        .lineLimit(2)
                        .truncationMode(.middle)
                    if let description = file.description, !description.isEmpty {
                        Text(description).font(.caption).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                FileDisclosure()
            }
            .multilineTextAlignment(.leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 52)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(preview.loadingID != nil || access?.connected != true)
        .accessibilityIdentifier("chat.file.\(file.id)")
        .contextMenu {
            Button(L10n.text("复制路径")) { UIPasteboard.general.string = file.path }
        }
    }
}

private struct DeliveredFilesBrowser: View {
    let files: [DeliveredFile]
    @State private var query = ""
    @State private var preview = TurnFilePreview()

    var body: some View {
        let names = TurnFileCollection.displayNames(files)
        let matching = TurnFileCollection.matching(files, query: query)
        NavigationStack {
            List {
                ForEach(matching) { file in
                    DeliveredFileRow(file: file, title: names[file.id] ?? file.name, preview: preview)
                        .listRowInsets(EdgeInsets())
                }
            }
            .listStyle(.plain)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L10n.text("搜索文件"))
            .searchPresentationToolbarBehavior(.avoidHidingContent)
            .navigationTitle(L10n.plural("全部 \(files.count) 个文件"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { FileBrowserClose() }
            .modifier(TurnFilePreviewPresentation(preview: preview))
            .accessibilityIdentifier("files.browser")
        }
        .foregroundStyle(DSBotStyle.chatSecondary)
        .modifier(FileBrowserPresentation(rowCount: matching.count))
    }
}

private struct ChangedFilesBrowser: View {
    @Binding var changes: ConversationChanges?
    let seq: Double
    @Environment(\.conversationAccess) private var access
    @State private var query = ""
    @State private var failure: String?
    @State private var requestID: UUID?

    var body: some View {
        let matching = changes.map { TurnFileCollection.matchingChanges($0.files, query: query) } ?? []
        NavigationStack {
            List {
                if let changes {
                    ForEach(matching, id: \.self) { index in
                        let file = changes.files[index]
                        NavigationLink {
                            ConversationDiffContent(seq: seq, index: index, name: file.display)
                        } label: {
                            VStack(alignment: .leading, spacing: 5) {
                                Text(file.display)
                                    .font(.subheadline)
                                    .foregroundStyle(DSBotStyle.chatInk)
                                    .lineLimit(2)
                                    .truncationMode(.middle)
                                FileChangeCounts(added: file.added, deleted: file.deleted)
                            }
                            .padding(.vertical, 10)
                            .frame(minHeight: 56, alignment: .leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
                        .disabled(access?.connected != true)
                        .accessibilityIdentifier("changes.file.\(index)")
                        .contextMenu {
                            Button(L10n.text("复制路径")) { UIPasteboard.general.string = file.path }
                        }
                    }
                } else if let failure {
                    ConversationFailureView(message: failure) { Task { await loadChanges() } }
                        .listRowBackground(Color.clear)
                } else {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                }
            }
            .listStyle(.plain)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L10n.text("搜索文件"))
            .searchPresentationToolbarBehavior(.avoidHidingContent)
            .navigationTitle(changes.map { L10n.plural("已编辑 \($0.total) 个文件") } ?? L10n.text("已编辑文件"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { FileBrowserClose() }
            .accessibilityIdentifier("changes.browser")
        }
        .modifier(FileBrowserPresentation(rowCount: matching.count))
        .task(id: access?.connected) { await loadChanges() }
    }

    @MainActor private func loadChanges() async {
        guard let access, access.connected, changes == nil else { return }
        let id = UUID()
        requestID = id
        failure = nil
        do {
            let result: ConversationChanges = try await access.read("session.changes", ["seq": .number(seq)])
            try Task.checkCancellation()
            guard requestID == id else { return }
            changes = result
        } catch is CancellationError {
        } catch {
            if requestID == id, !Task.isCancelled { failure = error.localizedDescription }
        }
    }
}

/// The same compact start as the other App lists; a full-height view remains an explicit drag.
private struct FileBrowserPresentation: ViewModifier {
    let rowCount: Int
    @ScaledMetric(relativeTo: .subheadline) private var rowHeight: CGFloat = 56
    @State private var expanded = false

    private var height: CGFloat { min(600, max(188, 144 + CGFloat(rowCount) * rowHeight)) }
    private var fitted: PresentationDetent { .height(height) }

    func body(content: Content) -> some View {
        content
            .presentationDetents([fitted, .large], selection: Binding(
                get: { expanded ? .large : fitted },
                set: { expanded = $0 == .large }
            ))
            .presentationDragIndicator(.visible)
            .presentationCornerRadius(28)
    }
}

private struct FileBrowserClose: ToolbarContent {
    @Environment(\.dismiss) private var dismiss

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            SheetCloseButton { dismiss() }
            .accessibilityIdentifier("files.browser.close")
        }
    }
}

@MainActor @Observable private final class TurnFilePreview {
    var url: URL?
    var loadingID: String?
    var failure: String?
    private var task: Task<Void, Never>?
    private var requestID: UUID?

    func open(_ file: DeliveredFile, access: ConversationAccess) {
        guard access.connected, loadingID == nil else { return }
        let id = UUID()
        requestID = id
        loadingID = file.id
        failure = nil
        task = Task {
            defer {
                if requestID == id { loadingID = nil; task = nil }
            }
            do {
                let payload: ConversationFilePayload = try await access.read("session.file", file.parameters)
                try Task.checkCancellation()
                let fileURL = try await ConversationFileStorage.shared.write(payload)
                guard !Task.isCancelled, requestID == id else {
                    await ConversationFileStorage.shared.remove(fileURL)
                    return
                }
                url = fileURL
            } catch is CancellationError {
            } catch {
                if requestID == id, !Task.isCancelled { failure = error.localizedDescription }
            }
        }
    }

    func cancelPending() {
        task?.cancel()
        task = nil
        requestID = nil
        loadingID = nil
    }
}

private struct TurnFilePreviewPresentation: ViewModifier {
    @Bindable var preview: TurnFilePreview

    func body(content: Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            content
            if let failure = preview.failure { ConversationFailureView(message: failure) }
        }
        .quickLookPreview($preview.url)
        .onChange(of: preview.url) { old, new in
            if let old, old != new { Task { await ConversationFileStorage.shared.remove(old) } }
        }
        .onDisappear { preview.cancelPending() }
    }
}
