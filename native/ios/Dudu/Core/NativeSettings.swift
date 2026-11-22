import Combine
import Foundation

// 嘟嘟's own settings, drawn by the app (owner, 2026-11-07: "嘟嘟自己的设置不用 webview 用原生实现"). Since 2026-11-21 the layout is the app's too (owner: 「从 api 获取的是值，而不是布局」):
// the plugin answers `settings.data` with the raw values of the desktop interface's own actions, `SettingsLayouts` lays the page out, the app draws it with its own controls, and what the
// person changes goes back as an act the plugin turns into the desktop interface's own action. A plugin that has no `settings.data` yet describes the page itself (`settings.page`,
// `host/native-settings.mjs`), and the page is that description, as it was before.

struct SettingsAct: Codable, Equatable, Sendable {
    var name: String
    var args: [String: JSONValue]?
}

struct SettingsConfirm: Codable, Equatable, Sendable {
    var title: String
    var message: String?
    var button: String
}

/// A button on a row, or the one that saves a form.
struct SettingsButton: Codable, Equatable, Sendable {
    var title: String
    var act: SettingsAct
    var role: String?
    var confirm: SettingsConfirm?
}

struct SettingsNotification: Codable, Equatable, Sendable {
    var title: String
    var on: Bool
    var act: SettingsAct
}

struct SettingsSwipe: Codable, Equatable, Sendable, Identifiable {
    var title: String
    var act: SettingsAct
    var role: String?
    var confirm: SettingsConfirm?
    var id: String { title }
}

/// Another page of the settings: a section, and what the section is asked to show.
struct SettingsLocation: Codable, Equatable, Hashable, Sendable {
    var section: String
    var target: String?
}

/// What a long press on a row offers (the `menu` of a phone that declared `settings.rich`): the acts the swipe had, the desktop's glyph for each, and the ones that cannot be done now shown grey.
struct SettingsMenuItem: Codable, Equatable, Sendable, Identifiable {
    var title: String
    var glyph: String?
    var act: SettingsAct?
    var to: SettingsLocation?
    var role: String?
    var confirm: SettingsConfirm?
    var enabled: Bool?
    var id: String { title }
}

/// A status icon as the plugin describes it: its type, its colour and, for a started one, how far it is filled.
struct SettingsStatus: Codable, Equatable, Sendable {
    var type: String
    var color: String?
    var progress: Double?
}

/// The "+" at the end of a group's strip.
struct SettingsAdd: Codable, Equatable, Sendable {
    var title: String
    var to: SettingsLocation
}

struct SettingsOption: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String
    var subtitle: String?
    var color: String?
    var status: SettingsStatus?
}

struct SettingsItem: Codable, Equatable, Sendable, Identifiable {
    var rawID: String?
    var kind: String
    var title: String
    var subtitle: String?
    var detail: String?
    var mono: Bool?
    var tone: String?
    var color: String?
    var icon: String?
    var on: Bool?
    var options: [SettingsOption]?
    var selected: String?
    var key: String?
    var value: String?
    var placeholder: String?
    var multiline: Bool?
    var secret: Bool?
    var button: SettingsButton?
    var notification: SettingsNotification?
    var to: SettingsLocation?
    var swipe: [SettingsSwipe]?
    var act: SettingsAct?
    /// A phone that declared `settings.rich` is given these (host/native-settings.mjs): the long-press menu, the strip's "+", the status tile, the word after the title, the style of a choice, a field with its title beside it, and the keys the status preview follows.
    var menu: [SettingsMenuItem]?
    var add: SettingsAdd?
    var status: SettingsStatus?
    var tag: String?
    var style: String?
    var inline: Bool?
    var colorKey: String?
    var progressKey: String?

    var id: String { rawID ?? "\(kind):\(title)" }

    /// Route metadata stays stable when the computer changes the page's language.
    var isAdditionLink: Bool {
        guard let target = to?.target else { return false }
        return target == "add" || target.hasPrefix("add:")
    }

    enum CodingKeys: String, CodingKey {
        case rawID = "id"
        case kind, title, subtitle, detail, mono, tone, color, icon, on, options, selected, key, value, placeholder, multiline, secret, button, notification, to, swipe, act
        case menu, add, status, tag, style, inline, colorKey, progressKey
    }
}

struct SettingsSection: Codable, Equatable, Sendable {
    var header: String?
    var footer: String?
    var rows: [SettingsItem]
}

struct SettingsPage: Codable, Equatable, Sendable {
    struct Preview: Codable, Equatable, Sendable {
        var key: String
        var act: SettingsAct
    }

    var title: String
    var sections: [SettingsSection]
    var save: SettingsButton?
    var preview: Preview?
    /// Read again every this many seconds while the page is on screen (a connector waits for the browser).
    var poll: Double?

    var isForm: Bool { save != nil }

    var additionLinks: [SettingsItem] { sections.flatMap(\.rows).filter(\.isAdditionLink) }
    var environmentItem: SettingsItem? { sections.flatMap(\.rows).first { $0.kind == "environment" } }
}

struct SettingsToast: Codable, Equatable, Sendable {
    var message: String
}

/// What `settings.act` answers.
struct SettingsAnswer: Codable, Sendable {
    var outcome: String
    var message: String?
    /// The page an older plugin draws; a phone that reads `settings.data` lays its own out and leaves this alone.
    var page: SettingsPage?
    var back: Bool?
    var toast: SettingsToast?
    /// What the plugin recognized in a custom connector's text (`connectors/recognize`): the add form is laid out from it.
    var recognized: JSONValue?

    private enum CodingKeys: String, CodingKey { case outcome, message, page, back, toast, recognized }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        outcome = try values.decode(String.self, forKey: .outcome)
        message = (try? values.decodeIfPresent(String.self, forKey: .message)) ?? nil
        // A page this app cannot read does not make the action a failure: the plugin has said it succeeded.
        page = (try? values.decodeIfPresent(SettingsPage.self, forKey: .page)) ?? nil
        back = (try? values.decodeIfPresent(Bool.self, forKey: .back)) ?? nil
        toast = (try? values.decodeIfPresent(SettingsToast.self, forKey: .toast)) ?? nil
        recognized = (try? values.decodeIfPresent(JSONValue.self, forKey: .recognized)) ?? nil
    }
}

/// What `settings.data` answers: the raw answer of each action the page is laid out from, by the action's name (`SettingsLayouts`).
struct SettingsDataAnswer: Decodable, Sendable {
    var outcome: String
    var message: String?
    var data: [String: JSONValue]?
}

extension DuduFailure {
    /// An older plugin answers a method it does not know with one of these codes.
    var isUnknownMethod: Bool {
        if case let .remote(code) = self { return ["UNSUPPORTED", "METHOD_NOT_ALLOWED"].contains(code) }
        return false
    }
}

/// Whether the computer's plugin answers `settings.data`, kept for the connection it was learned on (a new connection may be to a plugin that was updated).
@MainActor
enum SettingsDataSupport {
    private static var known: (computer: String?, connection: Int, available: Bool)?

    static func available(for store: DuduStore) -> Bool? {
        guard let known, known.computer == store.activeComputer?.id, known.connection == store.connectionRevision else { return nil }
        return known.available
    }

    static func note(_ available: Bool, for store: DuduStore) {
        known = (store.activeComputer?.id, store.connectionRevision, available)
    }
}

typealias SettingsReport = @MainActor (DuduToastMessage) -> Void

/// One page of the settings on its way: read from the plugin, kept while the app runs, and told what the person does on it.
@MainActor
final class SettingsPageModel: ObservableObject, Identifiable, Hashable {
    enum LoadState { case loading, loaded, failed }

    let id = UUID()
    let location: SettingsLocation
    @Published private(set) var page: SettingsPage?
    @Published private(set) var state: LoadState = .loading
    /// What the fields and choices of a form hold now, by their key.
    @Published var values: [String: String] = [:]
    @Published private(set) var environmentRows: [Int] = []
    @Published private(set) var busy = false
    @Published private(set) var isPreviewing = false
    @Published private(set) var notificationValues: [String: Bool] = [:]
    /// What the plugin refused, in its own words.
    @Published var problem: String?
    private let json = DuduJSON()
    private var seeded = false
    private var computerID: String?
    private var loadID: UUID?
    private var revision = 0
    private var previewID: UUID?
    private var previewedValue: String?
    private var suggestedName: String?
    private var savingNotifications: [String: Int] = [:]
    /// Where the page on screen came from: values the app laid out (`settings.data`), or the page an older plugin describes (`settings.page`).
    private enum Source { case data, descriptor }
    private var source: Source?

    var canSave: Bool {
        guard page?.save != nil, !busy, !isPreviewing else { return false }
        guard let preview = page?.preview else { return true }
        let text = values[preview.key, default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
        return !text.isEmpty && previewedValue == text
    }

    var hasToolbarActions: Bool {
        page?.save != nil || busy || page?.additionLinks.isEmpty == false || page?.environmentItem != nil
    }

    nonisolated static func == (lhs: SettingsPageModel, rhs: SettingsPageModel) -> Bool { lhs.id == rhs.id }
    nonisolated func hash(into hasher: inout Hasher) { hasher.combine(id) }

    /// Add routes are drawn by the toolbar, not duplicated as empty list cards.
    var contentSections: [SettingsSection] {
        (page?.sections ?? []).compactMap { original in
            var section = original
            section.rows.removeAll { $0.isAdditionLink || ($0.kind == "environment" && environmentRows.isEmpty) }
            return section.rows.isEmpty ? nil : section
        }
    }

    func addEnvironmentRow() {
        guard page?.environmentItem != nil, !busy, !isPreviewing,
              let id = (0..<40).first(where: { !environmentRows.contains($0) }) else { return }
        environmentRows.append(id)
    }

    func removeEnvironmentRow(_ id: Int) {
        environmentRows.removeAll { $0 == id }
        values.removeValue(forKey: "envName\(id)")
        values.removeValue(forKey: "envValue\(id)")
    }

    init(location: SettingsLocation) {
        self.location = location
    }

    private var params: [String: JSONValue] {
        var value: [String: JSONValue] = ["section": .string(location.section)]
        if let target = location.target { value["target"] = .string(target) }
        return value
    }

    /// Read the page. A page that was read keeps what it shows when a later read fails.
    func load(using store: DuduStore) async {
        guard !busy, !Task.isCancelled else { return }
        if page?.preview != nil {
            await preview(using: store)
            return
        }
        if computerID == nil { computerID = store.activeComputer?.id }
        guard computerID != nil, computerID == store.activeComputer?.id else { return }
        let connection = store.connectionRevision
        let readRevision = revision
        let readID = UUID()
        loadID = readID
        defer { if loadID == readID { loadID = nil } }
        do {
            let (next, origin) = try await read(using: store)
            guard !Task.isCancelled, loadID == readID, revision == readRevision,
                  computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
            source = origin
            apply(next)
        } catch {
            guard !Task.isCancelled, loadID == readID, revision == readRevision,
                  computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
            DuduLog.networkFailure("settings.page.fail", error: error)
            if page == nil { state = .failed }
        }
    }

    /// The page, from the plugin's values laid out here; from a plugin that has no `settings.data` yet, as the page it describes. Nothing of a page's layout comes from a plugin that answers values.
    private func read(using store: DuduStore) async throws -> (SettingsPage, Source) {
        // The form that adds a connector is the app's alone: only what the plugin recognizes in its text changes it.
        if SettingsLayouts.isStatic(location) { return (SettingsLayouts.customConnector(), .data) }
        if SettingsLayouts.handles(location.section), SettingsDataSupport.available(for: store) != false {
            do {
                let value = try await store.request("settings.data", params)
                let answer = try await json.decode(SettingsDataAnswer.self, from: value)
                guard answer.outcome == "success", let data = answer.data else { throw DuduFailure.protocolError }
                SettingsDataSupport.note(true, for: store)
                return (try SettingsLayouts.page(for: location, values: data), .data)
            } catch let failure as DuduFailure where failure.isUnknownMethod {
                SettingsDataSupport.note(false, for: store)
            }
        }
        let value = try await store.request("settings.page", params)
        let answer = try await json.decode(SettingsAnswer.self, from: value)
        guard answer.outcome == "success", let page = answer.page else { throw DuduFailure.protocolError }
        return (page, .descriptor)
    }

    /// The values again, laid out again: what an action changed shows at once, as the page the plugin used to send back with its answer did.
    private func reread(using store: DuduStore, connection: Int) async -> Bool {
        do {
            let (next, origin) = try await read(using: store)
            guard computerID == store.activeComputer?.id, connection == store.connectionRevision else { return false }
            source = origin
            apply(next)
            return true
        } catch {
            guard computerID == store.activeComputer?.id, connection == store.connectionRevision else { return false }
            DuduLog.networkFailure("settings.page.fail", error: error)
            return false
        }
    }

    private func apply(_ next: SettingsPage) {
        if page != next { page = next }
        state = .loaded
        // A form's fields are filled once; what is typed in them is not written over by a later read.
        for row in next.sections.flatMap(\.rows) {
            if let key = row.key {
                if !seeded || values[key] == nil { values[key] = row.value ?? row.selected ?? "" }
                if next.preview != nil, key == "name" {
                    if values[key, default: ""].isEmpty || values[key] == suggestedName {
                        values[key] = row.value ?? ""
                    }
                    suggestedName = row.value
                }
            }
        }
        seeded = true
        if next.preview != nil {
            let rows = next.sections.flatMap(\.rows)
            if !rows.contains(where: { $0.key == "token" }) { values.removeValue(forKey: "token") }
            if !rows.contains(where: { $0.kind == "environment" }) {
                environmentRows.removeAll()
                values = values.filter { !$0.key.hasPrefix("envName") && !$0.key.hasPrefix("envValue") }
            }
        }
    }

    /// Recognize a custom connector through the same bounded settings action, without blocking typing.
    func preview(using store: DuduStore) async {
        guard let preview = page?.preview, !busy else { return }
        let value = values[preview.key, default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
        let readID = UUID()
        previewID = readID
        previewedValue = nil
        isPreviewing = !value.isEmpty
        defer { if previewID == readID { isPreviewing = false } }
        guard !value.isEmpty, computerID != nil, computerID == store.activeComputer?.id else { return }
        let connection = store.connectionRevision
        revision &+= 1
        let readRevision = revision
        var request = params
        request["name"] = .string(preview.act.name)
        request["values"] = .object([preview.key: .string(value)])
        do {
            try await Task.sleep(for: .milliseconds(400))
            try Task.checkCancellation()
            let reply = try await store.request("settings.act", request)
            let answer = try await json.decode(SettingsAnswer.self, from: reply)
            guard !Task.isCancelled, previewID == readID, revision == readRevision,
                  computerID == store.activeComputer?.id, connection == store.connectionRevision,
                  values[preview.key, default: ""].trimmingCharacters(in: .whitespacesAndNewlines) == value else { return }
            guard answer.outcome == "success" else { throw DuduFailure.protocolError }
            // What the plugin recognized is laid out here; an older plugin sends the page it describes.
            if let recognized = answer.recognized {
                apply(SettingsLayouts.customConnector(recognized: recognized))
            } else if let page = answer.page {
                apply(page)
            } else {
                throw DuduFailure.protocolError
            }
            previewedValue = value
            problem = nil
        } catch {
            guard !Task.isCancelled, previewID == readID, revision == readRevision,
                  computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
            DuduLog.networkFailure("settings.preview.fail", error: error)
            problem = L10n.text("更改没能保存")
        }
    }

    /// The bell changes immediately; its save neither locks the page nor changes its toolbar.
    func setNotification(
        _ notification: SettingsNotification, rowID: String, on: Bool,
        using store: DuduStore, report: @escaping SettingsReport
    ) {
        guard !busy, store.status == .connected,
              computerID != nil, computerID == store.activeComputer?.id else { return }
        notificationValues[rowID] = on
        revision &+= 1
        loadID = nil
        let connection = store.connectionRevision
        guard savingNotifications[rowID] != connection else { return }
        savingNotifications[rowID] = connection
        Task {
            await saveNotification(notification, rowID: rowID, connection: connection, using: store, report: report)
        }
    }

    private func saveNotification(
        _ notification: SettingsNotification, rowID: String, connection: Int,
        using store: DuduStore, report: @escaping SettingsReport
    ) async {
        var confirmed = notification.on
        defer {
            if savingNotifications[rowID] == connection {
                if computerID == store.activeComputer?.id, connection == store.connectionRevision {
                    updateNotification(rowID: rowID, on: confirmed)
                }
                notificationValues.removeValue(forKey: rowID)
                savingNotifications.removeValue(forKey: rowID)
                revision &+= 1
                loadID = nil
            }
        }
        // One request per collector at a time; rapid taps only change the next value to save.
        while let on = notificationValues[rowID] {
            guard computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
            do {
                if on {
                    let allowed = await AppNotifications.shared.authorize()
                    guard computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
                    guard notificationValues[rowID] == on else { continue }
                    guard allowed else { return }
                }
                var request = params
                request["name"] = .string(notification.act.name)
                if let args = notification.act.args { request["args"] = .object(args) }
                request["value"] = .string(on ? "true" : "false")
                DuduLog.record("settings.act")
                let reply = try await store.request("settings.act", request, timeoutSeconds: 30)
                let answer = try await json.decode(SettingsAnswer.self, from: reply)
                guard computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
                guard answer.outcome == "success" else {
                    if notificationValues[rowID] != on { continue }
                    report(DuduToastMessage(text: answer.message ?? L10n.text("更改没能保存"), kind: .error))
                    return
                }
                confirmed = on
                // The reply contains a whole page. Only this collector's saved bell belongs to this request.
                updateNotification(rowID: rowID, on: confirmed)
                if notificationValues[rowID] == on { return }
            } catch {
                guard computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
                DuduLog.networkFailure("settings.act.fail", error: error)
                if notificationValues[rowID] != on { continue }
                report(DuduToastMessage(text: L10n.text("更改没能保存"), kind: .error))
                return
            }
        }
    }

    private func updateNotification(rowID: String, on: Bool) {
        guard var next = page else { return }
        for section in next.sections.indices {
            for row in next.sections[section].rows.indices where next.sections[section].rows[row].id == rowID {
                next.sections[section].rows[row].notification?.on = on
            }
        }
        if page != next { page = next }
    }

    /// Do what a row, a swipe or the save button asks. Returns whether to go back, and says what the plugin said.
    func act(
        _ act: SettingsAct, value: String? = nil, form: Bool = false,
        using store: DuduStore, report: @escaping SettingsReport
    ) async -> Bool {
        guard !busy, !form || canSave, computerID != nil, computerID == store.activeComputer?.id else { return false }
        busy = true
        problem = nil
        revision &+= 1
        loadID = nil
        let actionRevision = revision
        let connection = store.connectionRevision
        var needsRefresh = false
        defer {
            busy = false
            if needsRefresh { Task { await load(using: store) } }
        }
        var request = params
        request["name"] = .string(act.name)
        if let args = act.args { request["args"] = .object(args) }
        if let value { request["value"] = .string(value) }
        if form { request["values"] = .object(values.mapValues { .string($0) }) }
        do {
            if location.section == "collectors", act.name == "notify", value == "true" {
                guard await AppNotifications.shared.authorize(),
                      computerID == store.activeComputer?.id, connection == store.connectionRevision else { return false }
            }
            // A first local MCP launch may spend the desktop's 60-second budget installing dependencies.
            let timeout: UInt64 = location.section == "connectors" && act.name == "add" ? 120 : 30
            let reply = try await store.request("settings.act", request, timeoutSeconds: timeout)
            let answer = try await json.decode(SettingsAnswer.self, from: reply)
            guard computerID == store.activeComputer?.id, connection == store.connectionRevision else { return false }
            guard answer.outcome == "success" else {
                let words = answer.message ?? L10n.text("更改没能保存")
                if form { problem = words } else { report(DuduToastMessage(text: words, kind: .error)) }
                return false
            }
            if let toast = answer.toast { report(DuduToastMessage(text: toast.message, kind: .success)) }
            if source == .data {
                // The answer may still carry the page the plugin would draw: the app reads the values again and lays out its own.
                if answer.back != true, !SettingsLayouts.isStatic(location) {
                    let shown = await reread(using: store, connection: connection)
                    if !shown || revision != actionRevision { needsRefresh = true }
                }
            } else if let page = answer.page {
                if revision == actionRevision { apply(page) }
                else { needsRefresh = true }
            } else if answer.back != true {
                // The plugin said it worked but sent no page this app could read: read the page again.
                needsRefresh = true
            }
            return answer.back == true
        } catch {
            guard computerID == store.activeComputer?.id, connection == store.connectionRevision else { return false }
            DuduLog.networkFailure("settings.act.fail", error: error)
            if form { problem = L10n.text("更改没能保存") } else { report(DuduToastMessage(text: L10n.text("更改没能保存"), kind: .error)) }
            return false
        }
    }

}

/// The pages of 嘟嘟's settings that are open, one over the other; the first is the section the person chose.
@MainActor
final class SettingsNavigator: ObservableObject {
    @Published private(set) var pages: [SettingsPageModel] = []
    /// What the toolbar says: the title of the page on top, once it has been read (the section's own name until then).
    @Published var title: String?
    private var currentChanges: AnyCancellable?

    private static let sectionTitles = [
        "general": L10n.text("常规"), "statuses": L10n.text("状态"), "connectors": L10n.text("连接器"), "collectors": L10n.text("收集器"), "rules": L10n.text("规则"), "memory": L10n.text("记忆"), "skills": L10n.text("技能"),
    ]

    var current: SettingsPageModel? { pages.last }
    var canPop: Bool { pages.count > 1 }

    init(section: String? = nil) {
        if let section { reset(section: section) }
    }

    func reset(section: String) {
        pages = [SettingsPageModel(location: SettingsLocation(section: section, target: nil))]
        title = Self.sectionTitles[section]
        observeCurrent()
    }

    func open(_ location: SettingsLocation) {
        pages.append(SettingsPageModel(location: location))
        title = nil
        observeCurrent()
    }

    func pop() {
        guard pages.count > 1 else { return }
        pages.removeLast()
        title = pages.last?.page?.title
        observeCurrent()
    }

    func page(after id: UUID) -> SettingsPageModel? {
        guard let index = pages.firstIndex(where: { $0.id == id }), pages.indices.contains(index + 1) else { return nil }
        return pages[index + 1]
    }

    /// SwiftUI updates this boundary after an interactive pop commits, not while the finger is dragging.
    func pop(to id: UUID) {
        guard let index = pages.firstIndex(where: { $0.id == id }), index + 1 < pages.count else { return }
        pages.removeSubrange((index + 1)...)
        title = pages.last?.page?.title
        observeCurrent()
    }

    private func observeCurrent() {
        currentChanges = current?.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }
}
