import Foundation
import Security

actor KeychainVault {
    private let nativeService = "com.harnessmobile.app.dsbot"
    private let legacyServices = ["app:no-auth", "app"]

    func get(_ key: String) throws -> Data? {
        try read(key, service: nativeService)
    }

    func getLegacy(_ key: String) throws -> Data? {
        for service in legacyServices {
            if let value = try read(key, service: service) { return value }
        }
        return nil
    }

    func set(_ data: Data, for key: String) throws {
        let query = itemQuery(key, service: nativeService)
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly

        let status = SecItemAdd(attributes as CFDictionary, nil)
        if status == errSecSuccess { return }
        guard status == errSecDuplicateItem else { throw DSBotFailure.storage }

        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]
        guard SecItemUpdate(query as CFDictionary, update as CFDictionary) == errSecSuccess else {
            throw DSBotFailure.storage
        }
    }

    func remove(_ key: String) throws {
        let status = SecItemDelete(itemQuery(key, service: nativeService) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw DSBotFailure.storage
        }
    }

    private func read(_ key: String, service: String) throws -> Data? {
        var query = itemQuery(key, service: service)
        query[kSecReturnData as String] = kCFBooleanTrue
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw DSBotFailure.storage
        }
        return data
    }

    private func itemQuery(_ key: String, service: String) -> [String: Any] {
        let keyData = Data(key.utf8)
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: keyData,
            kSecAttrGeneric as String: keyData
        ]
    }
}

struct ComputerLibrary: Sendable {
    var computers: [Computer]
    var activeId: String?
}

private struct ComputerIndex: Codable {
    var version: Int
    var activeId: String?
    var ids: [String]
    var pendingDeletes: [String]?

    init(activeId: String?, ids: [String], pendingDeletes: [String]? = nil) {
        version = 2
        self.activeId = activeId
        self.ids = ids
        self.pendingDeletes = pendingDeletes
    }
}

private struct LegacyConnection: Decodable {
    var url: String
    var name: String?
}

protocol DSBotComputerStorage: Actor {
    func load() async throws -> ComputerLibrary
    func pairAuthenticated(endpoint: ConnectionEndpoint, readyId: String) async throws -> ComputerLibrary
    func activateAuthenticated(localId: String, readyId: String) async throws -> ComputerLibrary
    func activateAuthenticated(localId: String, readyId: String, endpoint: ConnectionEndpoint) async throws -> ComputerLibrary
    func updateAddresses(localId: String, endpoint: ConnectionEndpoint) async throws -> ComputerLibrary
    func remove(_ localId: String) async throws -> ComputerLibrary
}

extension DSBotComputerStorage {
    func activateAuthenticated(localId: String, readyId: String, endpoint: ConnectionEndpoint) async throws -> ComputerLibrary {
        try await activateAuthenticated(localId: localId, readyId: readyId)
    }

    func updateAddresses(localId: String, endpoint: ConnectionEndpoint) async throws -> ComputerLibrary {
        throw DSBotFailure.storage
    }
}

actor ComputerRepository: DSBotComputerStorage {
    private static let indexKey = "dsbot.computers.v2"
    private static let legacyKey = "dsbot.connection.v1"
    private static let recordPrefix = "dsbot.computer."

    private let vault = KeychainVault()
    private var cachedLibrary: ComputerLibrary?
    private var mutationHeld = false
    private var mutationWaiters: [CheckedContinuation<Void, Never>] = []

    func load() async throws -> ComputerLibrary {
        await acquireMutation()
        defer { releaseMutation() }
        return try await loadUnlocked()
    }

    private func loadUnlocked() async throws -> ComputerLibrary {
        if let cachedLibrary { return cachedLibrary }

        if let indexData = try await vault.get(Self.indexKey) {
            let library = try await readNativeLibrary(indexData)
            cachedLibrary = library
            return library
        }

        if try await importLegacyV2() {
            let indexData = try await vault.get(Self.indexKey)
            guard let indexData else { throw DSBotFailure.storage }
            let library = try await readNativeLibrary(indexData)
            cachedLibrary = library
            return library
        }

        if let legacyData = try await vault.getLegacy(Self.legacyKey) {
            guard let legacy = try? JSONDecoder().decode(LegacyConnection.self, from: legacyData),
                  !legacy.url.isEmpty else { throw DSBotFailure.storage }
            let now = Date().timeIntervalSince1970 * 1_000
            let computer = Computer(
                id: UUID().uuidString,
                name: String((legacy.name?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                    ? legacy.name! : "Dudu").prefix(80)),
                url: legacy.url,
                computerId: Self.computerId(in: legacy.url),
                lastUsedAt: now
            )
            let library = ComputerLibrary(computers: [computer], activeId: computer.id)
            try await persistNewLibrary(library)
            cachedLibrary = library
            return library
        }

        let empty = ComputerLibrary(computers: [], activeId: nil)
        try await writeIndex(empty)
        cachedLibrary = empty
        return empty
    }

    func pairAuthenticated(
        endpoint: ConnectionEndpoint,
        readyId: String
    ) async throws -> ComputerLibrary {
        await acquireMutation()
        defer { releaseMutation() }
        var library = try await loadUnlocked()
        let credentialIdentity = Self.credentialIdentity(endpoint.originalURL)
        let existing = library.computers.first { computer in
            if computer.computerId == readyId { return true }
            return computer.computerId == nil
                && Self.credentialIdentity(computer.url) == credentialIdentity
        }
        let computer = Computer(
            id: existing?.id ?? UUID().uuidString,
            name: endpoint.name,
            url: endpoint.originalURL,
            computerId: readyId,
            lastUsedAt: Date().timeIntervalSince1970 * 1_000,
            addresses: endpoint.addresses, probeId: endpoint.probeId, addressesEdited: endpoint.addressesEdited
        )
        library.computers = existing == nil
            ? library.computers + [computer]
            : library.computers.map { $0.id == existing?.id ? computer : $0 }
        library.activeId = computer.id
        try await persist(computer: computer, library: library)
        cachedLibrary = library
        return library
    }

    func activateAuthenticated(localId: String, readyId: String) async throws -> ComputerLibrary {
        try await activateAuthenticated(localId: localId, readyId: readyId, connection: nil)
    }

    func activateAuthenticated(localId: String, readyId: String, endpoint: ConnectionEndpoint) async throws -> ComputerLibrary {
        try await activateAuthenticated(localId: localId, readyId: readyId, connection: endpoint)
    }

    private func activateAuthenticated(localId: String, readyId: String, connection: ConnectionEndpoint?) async throws -> ComputerLibrary {
        await acquireMutation()
        defer { releaseMutation() }
        var library = try await loadUnlocked()
        guard let index = library.computers.firstIndex(where: { $0.id == localId }) else {
            throw DSBotFailure.switchedComputer
        }
        var computer = library.computers[index]
        if let savedId = computer.computerId, savedId != readyId {
            throw DSBotFailure.identityMismatch
        }
        computer.computerId = readyId
        if let connection {
            computer.url = connection.originalURL
            computer.addresses = connection.addresses
            computer.probeId = connection.probeId
            computer.addressesEdited = connection.addressesEdited
        }
        computer.lastUsedAt = Date().timeIntervalSince1970 * 1_000
        library.computers[index] = computer
        library.activeId = localId
        try await persist(computer: computer, library: library)
        cachedLibrary = library
        return library
    }

    func updateAddresses(localId: String, endpoint: ConnectionEndpoint) async throws -> ComputerLibrary {
        await acquireMutation()
        defer { releaseMutation() }
        var library = try await loadUnlocked()
        guard let index = library.computers.firstIndex(where: { $0.id == localId }) else {
            throw DSBotFailure.switchedComputer
        }
        var computer = library.computers[index]
        guard computer.computerId == endpoint.computerId else { throw DSBotFailure.identityMismatch }
        computer.addresses = try ConnectionAddress.validated(endpoint.addresses)
        computer.addressesEdited = true
        library.computers[index] = computer
        try await persist(computer: computer, library: library)
        cachedLibrary = library
        return library
    }

    func remove(_ localId: String) async throws -> ComputerLibrary {
        await acquireMutation()
        defer { releaseMutation() }
        var library = try await loadUnlocked()
        guard library.computers.contains(where: { $0.id == localId }) else { return library }
        library.computers.removeAll { $0.id == localId }
        if library.activeId == localId {
            library.activeId = library.computers.max(by: { $0.lastUsedAt < $1.lastUsedAt })?.id
        }

        var tombstone = ComputerIndex(
            activeId: library.activeId,
            ids: library.computers.map(\.id),
            pendingDeletes: [localId]
        )
        try await writeIndex(tombstone)
        cachedLibrary = library

        do {
            try await vault.remove(Self.recordKey(localId))
            tombstone.pendingDeletes = nil
            try await writeIndex(tombstone)
        } catch {
            // The committed tombstone hides the removed credential and retries cleanup on next load.
        }
        return library
    }

    private func importLegacyV2() async throws -> Bool {
        guard let indexData = try await vault.getLegacy(Self.indexKey) else { return false }
        let index: ComputerIndex
        do {
            index = try JSONDecoder().decode(ComputerIndex.self, from: indexData)
        } catch {
            throw DSBotFailure.storage
        }
        guard index.version == 2,
              index.ids.count <= 256,
              index.ids.allSatisfy(Self.validId)
        else { throw DSBotFailure.storage }

        var imported: Set<String> = []
        for id in index.ids where imported.insert(id).inserted {
            let key = Self.recordKey(id)
            guard let data = try await vault.getLegacy(key) else { continue }
            try await writeAndVerify(data, key: key)
        }
        try await writeAndVerify(indexData, key: Self.indexKey)
        return true
    }

    private func readNativeLibrary(_ indexData: Data) async throws -> ComputerLibrary {
        let index: ComputerIndex
        do {
            index = try JSONDecoder().decode(ComputerIndex.self, from: indexData)
        } catch {
            throw DSBotFailure.storage
        }
        guard index.version == 2,
              index.ids.count <= 256,
              index.ids.allSatisfy(Self.validId)
        else { throw DSBotFailure.storage }

        let pending = Set(index.pendingDeletes ?? [])
        for id in pending where Self.validId(id) {
            try? await vault.remove(Self.recordKey(id))
        }

        var computers: [Computer] = []
        var seen: Set<String> = []
        for id in index.ids where !pending.contains(id) && seen.insert(id).inserted {
            guard let data = try await vault.get(Self.recordKey(id)),
                  let computer = try? JSONDecoder().decode(Computer.self, from: data),
                  computer.id == id else { continue }
            computers.append(computer)
        }
        let ordered = computers.sorted {
            if $0.id == index.activeId { return true }
            if $1.id == index.activeId { return false }
            return $0.lastUsedAt > $1.lastUsedAt
        }
        computers = []
        for computer in ordered {
            if let desktopID = computer.computerId,
               let index = computers.firstIndex(where: { $0.computerId == desktopID }) {
                // Old builds could save this computer once per origin. Keep the selected credential
                // and local identity, and bring the other origins into its verified route set.
                var routes = computers[index].connectionAddresses
                for route in computer.connectionAddresses where !routes.contains(where: { $0.url == route.url }) {
                    if routes.count < 32 { routes.append(route) }
                }
                computers[index].addresses = routes
            } else {
                computers.append(computer)
            }
        }
        let activeId = computers.contains(where: { $0.id == index.activeId })
            ? index.activeId
            : computers.max(by: { $0.lastUsedAt < $1.lastUsedAt })?.id
        return ComputerLibrary(computers: computers, activeId: activeId)
    }

    private func persistNewLibrary(_ library: ComputerLibrary) async throws {
        guard let computer = library.computers.first else {
            try await writeIndex(library)
            return
        }
        try await persist(computer: computer, library: library)
    }

    private func persist(
        computer: Computer,
        library: ComputerLibrary
    ) async throws {
        let recordData: Data
        let indexData: Data
        do {
            recordData = try JSONEncoder().encode(computer)
            indexData = try JSONEncoder().encode(ComputerIndex(
                activeId: library.activeId,
                ids: library.computers.map(\.id)
            ))
        } catch {
            throw DSBotFailure.storage
        }

        let key = Self.recordKey(computer.id)
        let oldData = try await vault.get(key)
        let oldIndexData = try await vault.get(Self.indexKey)
        do {
            try await writeAndVerify(recordData, key: key)
            try await writeAndVerify(indexData, key: Self.indexKey)
        } catch {
            if let oldData {
                try? await vault.set(oldData, for: key)
            } else {
                try? await vault.remove(key)
            }
            if let oldIndexData {
                try? await writeAndVerify(oldIndexData, key: Self.indexKey)
            } else {
                try? await vault.remove(Self.indexKey)
            }
            throw DSBotFailure.storage
        }
    }

    private func writeIndex(_ library: ComputerLibrary) async throws {
        let index = ComputerIndex(activeId: library.activeId, ids: library.computers.map(\.id))
        try await writeIndex(index)
    }

    private func writeIndex(_ index: ComputerIndex) async throws {
        let data: Data
        do { data = try JSONEncoder().encode(index) }
        catch { throw DSBotFailure.storage }
        try await writeAndVerify(data, key: Self.indexKey)
    }

    private func writeAndVerify(_ data: Data, key: String) async throws {
        try await vault.set(data, for: key)
        guard try await vault.get(key) == data else { throw DSBotFailure.storage }
    }

    private static func recordKey(_ id: String) -> String {
        recordPrefix + id
    }

    private static func validId(_ id: String) -> Bool {
        id.range(of: #"^[A-Za-z0-9_-]{1,100}$"#, options: .regularExpression) != nil
    }

    private static func computerId(in rawURL: String) -> String? {
        guard let url = URLComponents(string: rawURL),
              let values = url.queryItems?.filter({ $0.name == "computer" }),
              values.count == 1,
              let value = values[0].value,
              validId(value) else { return nil }
        return value
    }

    private static func credentialIdentity(_ rawURL: String) -> String? {
        guard var components = URLComponents(string: rawURL),
              let scheme = components.scheme,
              let host = components.host else { return nil }
        components.scheme = scheme.lowercased()
        components.host = host.lowercased()
        components.fragment = nil
        var items = (components.queryItems ?? []).filter { $0.name != "computer" && $0.name != "name" }
        items.sort {
            if $0.name == $1.name { return ($0.value ?? "") < ($1.value ?? "") }
            return $0.name < $1.name
        }
        components.queryItems = items.isEmpty ? nil : items
        return components.string
    }

    private func acquireMutation() async {
        if !mutationHeld {
            mutationHeld = true
            return
        }
        await withCheckedContinuation { continuation in
            mutationWaiters.append(continuation)
        }
    }

    private func releaseMutation() {
        if mutationWaiters.isEmpty {
            mutationHeld = false
        } else {
            mutationWaiters.removeFirst().resume()
        }
    }
}
