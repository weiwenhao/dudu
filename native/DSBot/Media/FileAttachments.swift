import Foundation

struct PickedFile: Sendable {
    let name: String
    let url: URL
    let bytes: Int
}

/// Stages a file chosen in the system document picker. The copy happens off the main actor and the
/// security-scoped access is released before returning.
enum FileAttachments {
    static let maximumCount = 5
    private static var root: URL { FileManager.default.temporaryDirectory.appendingPathComponent("DuduUploads", isDirectory: true) }

    enum LoadError: Error, Equatable {
        case empty
        case unreadable
    }

    static func load(_ url: URL) async throws -> PickedFile {
        let reading = Task.detached(priority: .userInitiated) { () throws -> PickedFile in
            try Task.checkCancellation()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isDirectoryKey])
            if values?.isDirectory == true { throw LoadError.unreadable }
            let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
            do {
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let local = directory.appendingPathComponent(url.lastPathComponent)
                try FileManager.default.copyItem(at: url, to: local)
                try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: local.path)
                let bytes = try local.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                guard bytes > 0 else { throw LoadError.empty }
                try Task.checkCancellation()
                return PickedFile(name: url.lastPathComponent, url: local, bytes: bytes)
            } catch {
                try? FileManager.default.removeItem(at: directory)
                if error is CancellationError || error is LoadError { throw error }
                throw LoadError.unreadable
            }
        }
        return try await withTaskCancellationHandler {
            try await reading.value
        } onCancel: { reading.cancel() }
    }

    static func remove(_ file: PickedFile) async {
        await Task.detached(priority: .utility) {
            let directory = file.url.deletingLastPathComponent()
            guard directory.deletingLastPathComponent().standardizedFileURL == root.standardizedFileURL else { return }
            try? FileManager.default.removeItem(at: directory)
        }.value
    }

    static func message(for error: Error) -> String {
        switch error as? LoadError {
        case .empty: return L10n.text("这个文件是空的")
        default: return L10n.text("无法读取这个文件")
        }
    }

    static func sizeText(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
