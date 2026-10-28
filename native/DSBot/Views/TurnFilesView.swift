import SwiftUI
import QuickLook
import UIKit

struct TurnFilesView: View {
    let files: [DeliveredFile]
    let changesSeq: Double?

    var body: some View {
        let collection = TurnFileCollection(files)
        VStack(alignment: .leading, spacing: 10) {
            if let changesSeq {
                TurnChangesCard(seq: changesSeq)
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
    @Environment(\.conversationAccess) private var access
    @State private var changes: ConversationChanges?
    @State private var loading = false
    @State private var failure: String?
    @State private var showingFiles = false
    @State private var requestID: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if changes == nil || changes?.files.isEmpty == false {
                Button { showingFiles = true } label: {
                    HStack(spacing: 12) {
                        Image("ChangedFiles")
                            .resizable()
                            .renderingMode(.original)
                            .frame(width: 24, height: 24)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(changes.map { "已编辑 \($0.total) 个文件" } ?? "已编辑文件")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(DSBotStyle.chatInk)
                            if let changes {
                                FileChangeCounts(added: changes.added, deleted: changes.deleted)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if loading {
                            ProgressView().controlSize(.small)
                        } else {
                            FileDisclosure()
                        }
                    }
                    .padding(14)
                    .frame(minHeight: 56)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(changes == nil)
                .accessibilityIdentifier("changes.toggle")
                .modifier(TurnFileSurface())
            }
            if let failure {
                ConversationFailureView(message: failure) { Task { await loadChanges() } }
            }
        }
        .task(id: access?.connected) { await loadChanges() }
        .sheet(isPresented: $showingFiles) {
            if let changes {
                ChangedFilesBrowser(changes: changes, seq: seq)
            }
        }
    }

    @MainActor private func loadChanges() async {
        guard let access, access.connected, changes == nil else { return }
        let id = UUID()
        requestID = id
        loading = true
        failure = nil
        defer { if requestID == id { loading = false } }
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
                        Text("全部 \(files.count) 个文件")
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
            Button("复制路径") { UIPasteboard.general.string = file.path }
        }
    }
}

private struct DeliveredFilesBrowser: View {
    let files: [DeliveredFile]
    @State private var query = ""
    @State private var preview = TurnFilePreview()

    var body: some View {
        let names = TurnFileCollection.displayNames(files)
        NavigationStack {
            List {
                ForEach(TurnFileCollection.matching(files, query: query)) { file in
                    DeliveredFileRow(file: file, title: names[file.id] ?? file.name, preview: preview)
                        .listRowInsets(EdgeInsets())
                }
            }
            .listStyle(.plain)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索文件")
            .searchPresentationToolbarBehavior(.avoidHidingContent)
            .navigationTitle("全部 \(files.count) 个文件")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { FileBrowserClose() }
            .modifier(TurnFilePreviewPresentation(preview: preview))
            .accessibilityIdentifier("files.browser")
        }
        .foregroundStyle(DSBotStyle.chatSecondary)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

private struct ChangedFilesBrowser: View {
    let changes: ConversationChanges
    let seq: Double
    @Environment(\.conversationAccess) private var access
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                ForEach(TurnFileCollection.matchingChanges(changes.files, query: query), id: \.self) { index in
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
                        .padding(.vertical, 8)
                        .frame(minHeight: 52, alignment: .leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .disabled(access?.connected != true)
                    .accessibilityIdentifier("changes.file.\(index)")
                    .contextMenu {
                        Button("复制路径") { UIPasteboard.general.string = file.path }
                    }
                }
            }
            .listStyle(.plain)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索文件")
            .searchPresentationToolbarBehavior(.avoidHidingContent)
            .navigationTitle("已编辑 \(changes.total) 个文件")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { FileBrowserClose() }
            .accessibilityIdentifier("changes.browser")
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}

private struct FileBrowserClose: ToolbarContent {
    @Environment(\.dismiss) private var dismiss

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button { dismiss() } label: {
                DSBotIcon(.close, size: 20)
                    .frame(width: 44, height: 44)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("关闭")
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
