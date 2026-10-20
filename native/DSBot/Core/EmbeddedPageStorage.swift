import WebKit

/// Where an embedded page keeps what DSH keeps in the browser.
///
/// A dock page holds DSH's right dock: the layout, the terminal tabs it reattaches to, the browser tab's
/// address. DSH saves those in the page's storage so a reload finds them again, and a phone page is a
/// reload every time it opens. Without storage of its own each visit would start a new shell, and an
/// unused shell lives on the desktop for two hours — a few visits would fill the eight it allows. So a
/// dock page gets storage that lasts, one per computer. Every other page starts clean, as before.
@MainActor
enum EmbeddedPageStorage {
    private static var stores: [UUID: WKWebsiteDataStore] = [:]

    static func dataStore(for page: EmbeddedDSHPage, computerID: String?) -> WKWebsiteDataStore {
        guard page == .dock, let computerID else { return .nonPersistent() }
        let identifier = EmbeddedStorageIdentity.uuid(forComputer: computerID)
        if let store = stores[identifier] { return store }
        let store = WKWebsiteDataStore(forIdentifier: identifier)
        stores[identifier] = store
        return store
    }

    /// A computer that is forgotten takes its page storage with it. WebKit refuses while a web view still
    /// uses the store; what is left is a small amount of layout data that a later removal clears.
    static func remove(forComputer id: String) async {
        let identifier = EmbeddedStorageIdentity.uuid(forComputer: id)
        stores[identifier] = nil
        try? await WKWebsiteDataStore.remove(forIdentifier: identifier)
    }
}
