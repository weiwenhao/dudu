import CryptoKit
import Foundation

/// Names the browser storage that one computer's dock pages keep (see `EmbeddedPageStorage`).
enum EmbeddedStorageIdentity {
    /// A stable UUID for a computer's id: the id itself when it already is one, otherwise a name-based
    /// UUID (version 5 layout over SHA-256), so a different computer never shares storage with this one.
    static func uuid(forComputer id: String) -> UUID {
        if let uuid = UUID(uuidString: id) { return uuid }
        var bytes = Array(SHA256.hash(data: Data("dsbot.page-storage.\(id)".utf8)).prefix(16))
        bytes[6] = (bytes[6] & 0x0F) | 0x50
        bytes[8] = (bytes[8] & 0x3F) | 0x80
        return UUID(uuid: (
            bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
            bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
        ))
    }
}
