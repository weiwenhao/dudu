import Combine
import Foundation

// 嘟嘟's own settings, drawn by the app (owner, 2026-11-07: "嘟嘟自己的设置不用 webview 用原生实现"). The plugin describes a page (`host/native-settings.mjs`), the app draws it with its own
// controls, and what the person changes goes back as an act the plugin turns into the desktop interface's own action. The words are the plugin's, which are the desktop's.

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

struct SettingsOption: Codable, Equatable, Sendable, Identifiable {
    var id: String
    var title: String
    var subtitle: String?
    var color: String?
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

    var id: String { rawID ?? "\(kind):\(title)" }

    enum CodingKeys: String, CodingKey {
        case rawID = "id"
        case kind, title, subtitle, detail, mono, tone, color, icon, on, options, selected, key, value, placeholder, multiline, secret, button, notification, to, swipe, act
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
}

struct SettingsToast: Codable, Equatable, Sendable {
    var message: String
}

struct SettingsAnswer: Codable, Sendable {
    var outcome: String
    var message: String?
    var page: SettingsPage?
    var back: Bool?
    var toast: SettingsToast?
}

typealias SettingsReport = @MainActor (DSBotToastMessage) -> Void

/// One page of the settings on its way: read from the plugin, kept while the app runs, and told what the person does on it.
@MainActor
final class SettingsPageModel: ObservableObject, Identifiable {
    enum LoadState { case loading, loaded, failed }

    let id = UUID()
    let location: SettingsLocation
    @Published private(set) var page: SettingsPage?
    @Published private(set) var state: LoadState = .loading
    /// What the fields and choices of a form hold now, by their key.
    @Published var values: [String: String] = [:]
    @Published private(set) var busy = false
    @Published private(set) var isPreviewing = false
    /// What the plugin refused, in its own words.
    @Published var problem: String?
    private let json = DSBotJSON()
    private var seeded = false
    private var computerID: String?
    private var loadID: UUID?
    private var revision = 0
    private var previewID: UUID?
    private var previewedValue: String?
    private var suggestedName: String?

    var canSave: Bool {
        guard page?.save != nil, !busy, !isPreviewing else { return false }
        guard let preview = page?.preview else { return true }
        let text = values[preview.key, default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
        return !text.isEmpty && previewedValue == text
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
    func load(using store: DSBotStore) async {
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
            let value = try await store.request("settings.page", params)
            let answer = try await json.decode(SettingsAnswer.self, from: value)
            guard !Task.isCancelled, loadID == readID, revision == readRevision,
                  computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
            guard answer.outcome == "success", let page = answer.page else { throw DSBotFailure.protocolError }
            apply(page)
        } catch {
            guard !Task.isCancelled, loadID == readID, revision == readRevision,
                  computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
            DSBotLog.networkFailure("settings.page.fail", error: error)
            if page == nil { state = .failed }
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
                values = values.filter { !$0.key.hasPrefix("envName") && !$0.key.hasPrefix("envValue") }
            }
        }
    }

    /// Recognize a custom connector through the same bounded settings action, without blocking typing.
    func preview(using store: DSBotStore) async {
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
            guard answer.outcome == "success", let page = answer.page else { throw DSBotFailure.protocolError }
            apply(page)
            previewedValue = value
            problem = nil
        } catch {
            guard !Task.isCancelled, previewID == readID, revision == readRevision,
                  computerID == store.activeComputer?.id, connection == store.connectionRevision else { return }
            DSBotLog.networkFailure("settings.preview.fail", error: error)
            problem = L10n.text("更改没能保存")
        }
    }

    /// Do what a row, a swipe or the save button asks. Returns whether to go back, and says what the plugin said.
    func act(
        _ act: SettingsAct, value: String? = nil, form: Bool = false,
        using store: DSBotStore, report: @escaping SettingsReport
    ) async -> Bool {
        guard !busy, !form || canSave, computerID != nil, computerID == store.activeComputer?.id else { return false }
        busy = true
        problem = nil
        revision &+= 1
        loadID = nil
        let connection = store.connectionRevision
        defer { busy = false }
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
                if form { problem = words } else { report(DSBotToastMessage(text: words, kind: .error)) }
                return false
            }
            if let toast = answer.toast { report(DSBotToastMessage(text: toast.message, kind: .success)) }
            if let page = answer.page { apply(page) }
            return answer.back == true
        } catch {
            guard computerID == store.activeComputer?.id, connection == store.connectionRevision else { return false }
            DSBotLog.networkFailure("settings.act.fail", error: error)
            if form { problem = L10n.text("更改没能保存") } else { report(DSBotToastMessage(text: L10n.text("更改没能保存"), kind: .error)) }
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
        "general": L10n.text("通用"), "statuses": L10n.text("状态"), "connectors": L10n.text("连接器"), "collectors": L10n.text("收集器"), "rules": L10n.text("规则"), "memory": L10n.text("记忆"), "skills": L10n.text("技能"),
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

    private func observeCurrent() {
        currentChanges = current?.objectWillChange.sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }
}
