import Foundation

struct PickedFile: Sendable {
    let name: String
    let data: Data
}

/// Reads a file chosen in the system document picker. The work happens off the main actor and the
/// security-scoped access is released before returning.
enum FileAttachments {
    static let maximumBytes = 16 * 1_024 * 1_024
    static let maximumCount = 5

    enum LoadError: Error, Equatable {
        case tooLarge
        case empty
        case unreadable
    }

    static func load(_ url: URL) async throws -> PickedFile {
        try await Task.detached(priority: .userInitiated) { () throws -> PickedFile in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isDirectoryKey])
            if values?.isDirectory == true { throw LoadError.unreadable }
            if let size = values?.fileSize, size > maximumBytes { throw LoadError.tooLarge }
            guard let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { throw LoadError.unreadable }
            guard !data.isEmpty else { throw LoadError.empty }
            guard data.count <= maximumBytes else { throw LoadError.tooLarge }
            return PickedFile(name: url.lastPathComponent, data: data)
        }.value
    }

    static func message(for error: Error) -> String {
        switch error as? LoadError {
        case .tooLarge: return L10n.text("文件超过 16 MB，无法发送")
        case .empty: return L10n.text("这个文件是空的")
        default: return L10n.text("无法读取这个文件")
        }
    }

    static func sizeText(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
    }
}
