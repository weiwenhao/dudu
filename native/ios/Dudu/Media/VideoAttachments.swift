import CoreTransferable
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

enum VideoAttachments {
    static func load(_ item: PhotosPickerItem) async throws -> PickedFile {
        guard let video = try await item.loadTransferable(type: SelectedVideo.self) else {
            throw FileAttachments.LoadError.unreadable
        }
        return try video.file.get()
    }
}

private struct SelectedVideo: Transferable, Sendable {
    let file: Result<PickedFile, FileAttachments.LoadError>

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            // The provider's URL is valid only inside this import. Copy it off the main actor;
            // URLSession uploads that file directly, without a whole-video read or Base64 copy.
            do { return SelectedVideo(file: .success(try await FileAttachments.load(received.file))) }
            catch let error as FileAttachments.LoadError { return SelectedVideo(file: .failure(error)) }
            catch { return SelectedVideo(file: .failure(.unreadable)) }
        }
    }
}
