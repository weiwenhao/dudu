import SwiftUI

struct WorkPanelView: View {
    @ObservedObject var store: DSBotStore

    @State private var path = ""
    @State private var directory: ProjectDirectory?
    @State private var isLoading = false
    @State private var error: String?
    @State private var loadID = UUID()
    @State private var preview: ProjectFileEntry?

    private var location: String {
        "\(store.activeComputer?.id ?? "")/\(store.selectedSession?.id ?? "")/\(path)"
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                DSBotLabel(L10n.text("文件"), icon: .folder)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(DSBotStyle.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(DSBotStyle.sheet, in: RoundedRectangle(cornerRadius: 6))
                Spacer()
                Button {
                    DSBotLog.record("files.refresh")
                    Task { await loadDirectory() }
                } label: {
                    DSBotIcon(.reconnect, size: 18)
                        .foregroundStyle(DSBotStyle.muted)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DSBotIconButtonStyle())
                .disabled(isLoading)
                .accessibilityLabel(L10n.text("刷新文件"))
                .accessibilityIdentifier("files.refresh")
            }
            .padding(.leading, 14)
            .padding(.trailing, 4)
            .frame(height: 46)

            HStack(spacing: 4) {
                if !path.isEmpty {
                    Button {
                        DSBotLog.record("files.parent")
                        path = path.split(separator: "/").dropLast().joined(separator: "/")
                    } label: {
                        DSBotIcon(.back, size: 18)
                            .foregroundStyle(DSBotStyle.ink)
                            .frame(width: 36, height: 36)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(DSBotIconButtonStyle())
                    .accessibilityLabel(L10n.text("返回上一级"))
                    .accessibilityIdentifier("files.parent")
                }
                Text(path.isEmpty ? (directory?.name ?? store.selectedSession?.workspaceName ?? L10n.text("项目")) : path)
                    .font(.system(size: 12))
                    .foregroundStyle(DSBotStyle.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
                    .accessibilityIdentifier("files.path")
            }
            .padding(.leading, path.isEmpty ? 16 : 4)
            .padding(.trailing, 16)

            Rectangle().fill(DSBotStyle.line).frame(height: 1)
            content
        }
        .background(Color.white)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("files.page")
        .task(id: location) { await loadDirectory() }
        .onChange(of: store.selectedSession?.id) { _, _ in
            path = ""
            directory = nil
            preview = nil
        }
        .sheet(item: $preview) { entry in
            NavigationStack {
                ProjectFilePreview(entry: entry, store: store)
            }
            .presentationDragIndicator(.visible)
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading && directory == nil {
            ProgressView()
                .tint(DSBotStyle.muted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            VStack(spacing: 12) {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(DSBotStyle.muted)
                    .multilineTextAlignment(.center)
                Button(L10n.text("重试")) { Task { await loadDirectory() } }
                    .font(.system(size: 14, weight: .medium))
                    .frame(minHeight: 44)
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(directory?.entries ?? []) { entry in
                        Button {
                            if entry.isDirectory {
                                DSBotLog.record("files.directory.open")
                                directory = nil
                                path = entry.path
                            } else {
                                DSBotLog.record("files.preview.open")
                                preview = entry
                            }
                        } label: {
                            HStack(spacing: 9) {
                                DSBotIcon(entry.isDirectory ? .folder : .file, size: 17)
                                    .foregroundStyle(DSBotStyle.muted)
                                    .frame(width: 22)
                                Text(entry.name)
                                    .font(.system(size: 14))
                                    .foregroundStyle(DSBotStyle.ink)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Spacer(minLength: 0)
                                if entry.isDirectory {
                                    DSBotIcon(.right, size: 12)
                                        .foregroundStyle(DSBotStyle.muted)
                                }
                            }
                            .padding(.horizontal, 14)
                            .frame(minHeight: 42)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(DSBotRowButtonStyle())
                        .accessibilityIdentifier("file.entry.\(entry.path)")
                    }
                    if directory?.entries.isEmpty == true {
                        Text(L10n.text("暂无文件"))
                            .font(.system(size: 13))
                            .foregroundStyle(DSBotStyle.muted)
                            .padding(20)
                    }
                    if directory?.truncated == true {
                        Text(L10n.text("文件过多，仅显示前 500 项"))
                            .font(.system(size: 12))
                            .foregroundStyle(DSBotStyle.muted)
                            .padding(16)
                    }
                }
                .padding(.top, 4)
                .padding(.bottom, 20)
            }
        }
    }

    @MainActor
    private func loadDirectory() async {
        let id = UUID()
        loadID = id
        isLoading = true
        error = nil
        defer { if loadID == id { isLoading = false } }
        guard store.selectedSession != nil else {
            error = L10n.text("打开会话后查看项目文件")
            return
        }
        do {
            let result = try await store.projectDirectory(path: path)
            guard loadID == id, !Task.isCancelled else { return }
            directory = result
        } catch is CancellationError {
            return
        } catch {
            guard loadID == id, !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }
}

#if DEBUG && targetEnvironment(simulator)
struct SimulatorProjectFileReview: View {
    @ObservedObject var store: DSBotStore

    var body: some View {
        NavigationStack {
            ProjectFilePreview(entry: ProjectFileEntry(name: "README.md", path: "README.md", isDirectory: false, size: nil), store: store)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }
}
#endif

private struct ProjectFilePreview: View {
    let entry: ProjectFileEntry
    @ObservedObject var store: DSBotStore
    @Environment(\.dismiss) private var dismiss
    @State private var content: ProjectFileContent?
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        Group {
            if let content {
                ScrollView([.vertical, .horizontal]) {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(content.text)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(DSBotStyle.ink)
                            .lineSpacing(4)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: true, vertical: true)
                        if content.truncated {
                            Text(L10n.text("文件较大，仅显示开头部分"))
                                .font(.system(size: 12))
                                .foregroundStyle(DSBotStyle.muted)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
                }
            } else if let error {
                Text(error)
                    .font(.system(size: 14))
                    .foregroundStyle(DSBotStyle.muted)
                    .padding(24)
            } else {
                ProgressView().tint(DSBotStyle.muted)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
        .navigationTitle(entry.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                SheetCloseButton(label: L10n.text("关闭文件")) { dismiss() }
                .accessibilityIdentifier("files.preview.close")
            }
            ToolbarItem(placement: .topBarTrailing) {
                if let content {
                    Button {
                        UIPasteboard.general.string = content.text
                        copied = true
                        DSBotLog.record("files.copy")
                    } label: {
                        DSBotIcon(copied ? .check : .copy, size: 20).frame(width: 36, height: 36)
                    }
                    .accessibilityLabel(L10n.text("复制文件内容"))
                }
            }
        }
        .task {
            do { content = try await store.projectFile(path: entry.path) }
            catch is CancellationError { return }
            catch { self.error = error.localizedDescription }
        }
    }
}
