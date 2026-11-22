import Foundation

/// The layout of 嘟嘟's settings, written in the app (owner, 2026-11-21: 「整个嘟嘟设置，包括打开里面的都可以写死，包括里面的条目，从 api 获取的是值，而不是布局」).
///
/// The plugin answers `settings.data` with the raw answers of the desktop interface's own actions, and this file turns them into the `SettingsPage` that the generic renderer
/// (`NativeSettingsView`) draws: the sections, the rows and their kinds, their order, the words, the menus, the footnotes and the confirmations are all here. It is the port of the
/// plugin's builders for a phone that declared `settings.rich` (`host/native-settings.mjs`: the long-press menus, the 状态 page as ONE card of strips, the red 忘记 / 删除 rows).
/// What each page is built from is listed in `SettingsLayouts.actions(for:)`; the words are the plugin's own, with the English of `NATIVE_ENGLISH`, in the app's string catalog.
/// A plugin that has no `settings.data` yet describes the pages itself (`settings.page`): see `SettingsPageModel`.
enum SettingsLayouts {
    /// What a page is built from: the raw answer of each action it needs, by the action's name (`issues/statuses`, `connectors/list`…).
    typealias Values = [String: JSONValue]

    /// The sections this file lays out; any other section is the plugin's to describe.
    private static let laidOut: Set<String> = ["general", "statuses", "connectors", "collectors", "rules", "memory", "skills"]

    static func handles(_ section: String) -> Bool { laidOut.contains(section) }

    /// The page is the app's alone, with nothing to read: the add-a-connector form (what the plugin recognizes in the text is what changes it).
    static func isStatic(_ location: SettingsLocation) -> Bool {
        location.section == "connectors" && location.target == "add"
    }

    static func page(for location: SettingsLocation, values: Values) throws -> SettingsPage {
        switch location.section {
        case "general": return try general(values)
        case "statuses": return try statuses(location.target, values)
        case "connectors": return try connectors(location.target, values)
        case "collectors": return try collectors(location.target, values)
        case "rules": return try rules(location.target, values)
        case "memory": return try memory(location.target, values)
        case "skills": return try skills(location.target, values)
        default: throw DuduFailure.protocolError
        }
    }

    // MARK: Reading what the plugin sent (as tolerant as the plugin's own: a missing or mistyped field is nothing)

    private static func body(_ values: Values, _ action: String) throws -> JSONValue {
        guard let value = values[action], value.objectValue != nil else { throw DuduFailure.protocolError }
        return value
    }

    /// `edit:<id>` is the page `edit` of what `<id>` names.
    private static func parts(_ target: String?) -> (kind: String, subject: String) {
        let text = target ?? ""
        guard let colon = text.firstIndex(of: ":") else { return (text, "") }
        return (String(text[..<colon]), String(text[text.index(after: colon)...]))
    }

    /// An object or list that is there: the plugin's `null` is as good as nothing.
    private static func some(_ value: JSONValue?) -> JSONValue? {
        guard let value, value != .null else { return nil }
        return value
    }

    /// A string that says something (the plugin's `||` and `?` on a string: an empty one is nothing).
    private static func present(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }

    private static func joined(_ parts: [String?]) -> String {
        parts.compactMap(present).joined(separator: " · ")
    }

    private static func firstLine(_ value: String?) -> String {
        (value ?? "").components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty } ?? ""
    }

    private static func baseName(_ command: String) -> String {
        command.components(separatedBy: CharacterSet(charactersIn: "/\\")).last { !$0.isEmpty } ?? ""
    }

    /// A number or a string the plugin uses as an id, as the text the page's route and rows carry (`String(5)` is "5").
    private static func idText(_ value: JSONValue?) -> String? {
        switch value {
        case let .string(text)?: return text
        case let .number(number)?:
            return number == number.rounded() && abs(number) < 1e15 ? String(Int64(number)) : String(number)
        default: return nil
        }
    }

    /// The month, the day and the time, in the phone's language (the plugin's `when`).
    private static func when(_ at: Double?) -> String {
        guard let at, at.isFinite else { return "" }
        return L10n.date(Date(timeIntervalSince1970: at / 1_000), template: "MMMdHHmm")
    }

    private static func act(_ name: String, _ args: [String: JSONValue]? = nil) -> SettingsAct {
        SettingsAct(name: name, args: args)
    }

    /// The question before something is deleted, naming what goes.
    private static func confirmDelete(_ message: String) -> SettingsConfirm {
        SettingsConfirm(title: L10n.text("将要删除"), message: message, button: L10n.text("删除"))
    }

    /// A row of the card that is a button in the colour of what it does to what the page shows (删除, 忘记, 断开: red).
    private static func actionRow(_ id: String, title: String, tone: String? = nil, button: SettingsButton) -> SettingsItem {
        SettingsItem(rawID: id, kind: "action", title: title, tone: tone, button: button)
    }

    private static func destructive(title: String, act: SettingsAct, confirm: SettingsConfirm) -> SettingsButton {
        SettingsButton(title: title, act: act, role: "destructive", confirm: confirm)
    }

    // MARK: 常规

    private struct ConversationModel {
        var provider: String
        var id: String
        var name: String
        var group: String
        var defaultEffort: String?
        var efforts: [(id: String, name: String)]
    }

    private static func conversationModels(_ conversation: JSONValue) -> [ConversationModel] {
        let groups = conversation["groups"]?.arrayValue ?? []
        func groupName(_ group: JSONValue) -> String { present(group["name"]?.stringValue) ?? group["id"]?.stringValue ?? "" }
        return groups.flatMap { group -> [ConversationModel] in
            let provider = group["id"]?.stringValue ?? ""
            let name = groupName(group)
            // Two groups of one name are told apart by their id.
            let shown = groups.filter { groupName($0) == name }.count > 1 ? "\(name) · \(provider)" : name
            return (group["models"]?.arrayValue ?? []).compactMap { model -> ConversationModel? in
                guard let id = model["id"]?.stringValue else { return nil }
                let efforts = (model["reasoning"]?["efforts"]?.arrayValue ?? []).compactMap { effort -> (id: String, name: String)? in
                    guard let effortID = effort["id"]?.stringValue else { return nil }
                    return (effortID, effort["name"]?.stringValue ?? effortID)
                }
                return ConversationModel(provider: provider, id: id, name: model["name"]?.stringValue ?? id, group: shown,
                                         defaultEffort: model["reasoning"]?["defaultEffort"]?.stringValue, efforts: efforts)
            }
        }
    }

    /// `["provider","model"]`, the way the plugin reads a model back (`JSON.parse`).
    private static func modelChoiceID(_ model: ConversationModel) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        return (try? encoder.encode([model.provider, model.id])).flatMap { String(data: $0, encoding: .utf8) } ?? ""
    }

    private static func general(_ values: Values) throws -> SettingsPage {
        let state = try body(values, "assistant/state")
        let conversation = try body(values, "assistant/conversation-settings")
        let settings = try body(values, "assistant/settings")
        let models = conversationModels(conversation)
        let selectedModel = conversation["model"]
        let current = models.first { $0.provider == selectedModel?["provider"]?.stringValue && $0.id == selectedModel?["model"]?.stringValue }

        let folder = state["projectFolder"]?.stringValue
        let hasFolder = present(folder) != nil
        var folderRow = SettingsItem(rawID: "folder", kind: "text", title: folder ?? L10n.text("项目文件夹没能打开。"), mono: hasFolder)
        if state["isDefault"]?.boolValue == true { folderRow.detail = L10n.text("默认") }
        if !hasFolder { folderRow.tone = "bad" }

        let several = (conversation["groups"]?.arrayValue?.count ?? 0) > 1
        let modelOptions = models.map { SettingsOption(id: modelChoiceID($0), title: $0.name, subtitle: several ? $0.group : nil) }
        var defaults: [SettingsItem] = [
            SettingsItem(rawID: "model", kind: "choice", title: L10n.text("模型"), options: modelOptions,
                         selected: current.map(modelChoiceID) ?? "", act: act("conversation", ["field": .string("model")])),
        ]
        if let current, !current.efforts.isEmpty {
            var options: [SettingsOption] = []
            // A model with no default effort of its own has the choice of none.
            if present(current.defaultEffort) == nil { options.append(SettingsOption(id: "", title: L10n.text("默认"))) }
            options += current.efforts.map { SettingsOption(id: $0.id, title: $0.name) }
            defaults.append(SettingsItem(rawID: "effort", kind: "choice", title: L10n.text("推理等级"), options: options,
                                         selected: conversation["model"]?["reasoningEffort"]?.stringValue ?? current.defaultEffort ?? "",
                                         act: act("conversation", ["field": .string("effort")])))
        }
        let permissions = (conversation["permissions"]?.arrayValue ?? []).map {
            SettingsOption(id: $0["value"]?.stringValue ?? "", title: $0["name"]?.stringValue ?? "")
        }
        defaults.append(SettingsItem(rawID: "permission", kind: "choice", title: L10n.text("访问模式"), options: permissions,
                                     selected: conversation["settings"]?["permission"]?.stringValue ?? "",
                                     act: act("conversation", ["field": .string("permission")])))

        let tidy = some(state["lastIssueTidy"])
        let tidyRow = SettingsItem(rawID: "tidy", kind: "text", title: L10n.text("最近一次整理"),
                                   subtitle: tidy.map { when($0["at"]?.numberValue) } ?? L10n.text("还没有整理过"))
        let sleepRow = SettingsItem(rawID: "deepSleep", kind: "switch", title: L10n.text("深度睡眠"),
                                    on: settings["settings"]?["deepSleep"]?.boolValue != false, act: act("deepSleep"))
        return SettingsPage(title: L10n.text("常规"), sections: [
            SettingsSection(header: L10n.text("项目文件夹"), rows: [folderRow]),
            SettingsSection(header: L10n.text("嘟嘟 · 默认"), rows: defaults),
            SettingsSection(header: L10n.text("事项"), rows: [tidyRow, sleepRow]),
        ])
    }

    // MARK: 状态

    private static let categories = ["backlog", "unstarted", "started", "completed", "canceled"]
    private static let colors = ["#95a2b3", "#61666b", "#eb5757", "#f2994a", "#f2c94c", "#4cb782", "#26b5ce", "#5e6ad2", "#8f6bde"]
    /// How far a started status is filled, and the id the form keeps it under.
    private static let progressSteps: [(value: Double, id: String)] = [(0, "0"), (0.25, "0.25"), (0.5, "0.5"), (0.75, "0.75"), (1, "1")]

    private static func categoryName(_ category: String) -> String? {
        switch category {
        case "backlog": return L10n.text("待规划")
        case "unstarted": return L10n.text("未开始")
        case "started": return L10n.text("已开始")
        case "completed": return L10n.text("已完成")
        case "canceled": return L10n.text("已取消")
        default: return nil
        }
    }

    /// The icon a category's statuses have when a status does not say.
    private static func statusType(for category: String) -> String? {
        switch category {
        case "backlog": return "backlog"
        case "unstarted": return "todo"
        case "started": return "in_progress"
        case "completed": return "done"
        case "canceled": return "canceled"
        default: return nil
        }
    }

    /// The name of a status: its own, or the one the desktop gives the built-in ones.
    private static func statusName(_ status: JSONValue) -> String {
        if let name = present(status["name"]?.stringValue) { return name }
        let id = status["id"]?.stringValue ?? ""
        switch id {
        case "backlog": return L10n.text("待规划")
        case "todo": return L10n.text("待办")
        case "in_progress": return L10n.text("处理中")
        case "in_review": return L10n.text("待审核")
        case "done": return L10n.text("已完成")
        case "canceled": return L10n.text("已取消")
        default: return id
        }
    }

    private static func progressValue(_ value: JSONValue?) -> Double? {
        guard let number = value?.numberValue else { return nil }
        return progressSteps.first { $0.value == number }?.value
    }

    private static func progressID(_ value: Double) -> String {
        progressSteps.first { $0.value == value }?.id ?? String(value)
    }

    /// The form as the owner drew it (`.local/designs/phone-status-settings-2026-11-21/`): a tile that follows the colour and progress, the name and description beside their titles,
    /// the progress of a started status as five icons, the colour as dots.
    private static func statusForm(_ status: JSONValue?, category: String) -> [SettingsSection] {
        let type = status?["type"]?.stringValue ?? statusType(for: category) ?? "backlog"
        let color = status?["color"]?.stringValue ?? "#95a2b3"
        let progress: Double? = category == "started" ? (progressValue(status?["iconProgress"]) ?? (type == "in_review" ? 0.75 : 0.5)) : nil
        func shown(_ value: Double?) -> SettingsStatus { SettingsStatus(type: type, color: color, progress: value) }
        let name = status.map(statusName) ?? ""

        let preview = SettingsItem(rawID: "preview", kind: "statusPreview", title: name, status: shown(progress),
                                   colorKey: "color", progressKey: progress == nil ? nil : "progress")
        let nameField = SettingsItem(rawID: "name", kind: "field", title: L10n.text("名称"), key: "name", value: name,
                                     placeholder: L10n.text("名称"), inline: true)
        let descriptionField = SettingsItem(rawID: "description", kind: "field", title: L10n.text("描述"), key: "description",
                                            value: status?["description"]?.stringValue ?? "", placeholder: L10n.text("描述"), multiline: true, inline: true)
        var sections = [SettingsSection(rows: [preview]), SettingsSection(rows: [nameField, descriptionField])]
        if let progress {
            let options = progressSteps.map { SettingsOption(id: $0.id, title: "\(Int($0.value * 100))%", status: shown($0.value)) }
            sections.append(SettingsSection(header: L10n.text("完成度"), rows: [
                SettingsItem(rawID: "progress", kind: "choice", title: L10n.text("完成度"), options: options, selected: progressID(progress),
                             key: "progress", style: "icons", colorKey: "color"),
            ]))
        }
        let swatches = colors.map { SettingsOption(id: $0, title: $0, color: $0) }
        sections.append(SettingsSection(header: L10n.text("颜色"), rows: [
            SettingsItem(rawID: "color", kind: "choice", title: L10n.text("颜色"), options: swatches, selected: color, key: "color", style: "swatches"),
        ]))
        return sections
    }

    private static func statuses(_ target: String?, _ values: Values) throws -> SettingsPage {
        let data = try body(values, "issues/statuses")
        let all = (data["statuses"]?.arrayValue ?? []).filter { $0["archived"]?.boolValue != true }
        let (kind, subject) = parts(target)
        if kind == "edit" || kind == "add" {
            let status = kind == "edit" ? all.first { $0["id"]?.stringValue == subject } : nil
            let category = status?["category"]?.stringValue ?? subject
            let title = status.map(statusName) ?? L10n.text("在{0}中添加状态", categoryName(category) ?? category)
            var args: [String: JSONValue] = [:]
            if kind == "edit" { if let id = status?["id"]?.stringValue { args["id"] = .string(id) } } else { args["category"] = .string(category) }
            return SettingsPage(title: title, sections: statusForm(status, category: category),
                                save: SettingsButton(title: status == nil ? L10n.text("创建") : L10n.text("保存"), act: act("save", args)))
        }
        func edit(_ status: JSONValue) -> SettingsLocation {
            SettingsLocation(section: "statuses", target: "edit:\(status["id"]?.stringValue ?? "")")
        }
        func count(_ status: JSONValue) -> Int {
            Int(data["counts"]?[status["id"]?.stringValue ?? ""]?.numberValue ?? 0)
        }
        /// What a long press on a status offers (the owner's menu: 编辑 / 设为默认 / 上移 / 下移 / 删除).
        func menu(_ status: JSONValue, _ index: Int, _ entries: [JSONValue]) -> [SettingsMenuItem] {
            let id = status["id"]?.stringValue ?? ""
            let idArgs: [String: JSONValue] = ["id": .string(id)]
            var items = [SettingsMenuItem(title: L10n.text("编辑"), glyph: "pencil", to: edit(status))]
            if !["completed", "canceled"].contains(status["category"]?.stringValue ?? "") {
                items.append(SettingsMenuItem(title: L10n.text("设为默认"), glyph: "check", act: act("default", idArgs), enabled: status["isDefault"]?.boolValue != true))
            }
            items.append(SettingsMenuItem(title: L10n.text("上移"), glyph: "arrow-up", act: act("move", ["id": .string(id), "direction": .number(-1)]), enabled: index > 0))
            items.append(SettingsMenuItem(title: L10n.text("下移"), glyph: "arrow-down", act: act("move", ["id": .string(id), "direction": .number(1)]), enabled: index < entries.count - 1))
            if entries.count > 1 {
                let other = entries.first { $0["id"]?.stringValue != id }.map(statusName) ?? ""
                let moved = count(status) > 0 ? L10n.text("将事项移至：{0}", other) : nil
                items.append(SettingsMenuItem(title: L10n.text("删除"), glyph: "trash", act: act("remove", idArgs), role: "destructive",
                                              confirm: confirmDelete(joined([statusName(status), moved]))))
            }
            return items
        }
        // One card, a strip for each category with its "+", a tile and the name for each status (the owner's drawing, 2026-11-21).
        var rows: [SettingsItem] = []
        for category in categories {
            let entries = all.filter { $0["category"]?.stringValue == category }
            let name = categoryName(category) ?? category
            rows.append(SettingsItem(rawID: "group-\(category)", kind: "group", title: name,
                                     add: SettingsAdd(title: L10n.text("在{0}中添加状态", name), to: SettingsLocation(section: "statuses", target: "add:\(category)"))))
            for (index, status) in entries.enumerated() {
                let issues = count(status)
                rows.append(SettingsItem(
                    rawID: status["id"]?.stringValue, kind: "text", title: statusName(status),
                    subtitle: issues > 0 ? L10n.plural("\(issues) 条事项") : nil,
                    to: edit(status), menu: menu(status, index, entries),
                    status: SettingsStatus(type: status["type"]?.stringValue ?? statusType(for: category) ?? "backlog",
                                           color: present(status["color"]?.stringValue), progress: progressValue(status["iconProgress"])),
                    tag: status["isDefault"]?.boolValue == true ? L10n.text(" · 默认").trimmingCharacters(in: .whitespaces) : nil))
            }
        }
        return SettingsPage(title: L10n.text("状态"), sections: [SettingsSection(rows: rows)])
    }

    // MARK: 连接器

    /// What a connector says about its connection, in a row: the line under the name, the words by it, their tone, the one thing to do about it.
    struct ConnectorState: Equatable {
        var line: String
        var tone: String?
        var words: String?
        var verb: String?
    }

    private static func verbName(_ verb: String) -> String {
        switch verb {
        case "authorize": return L10n.text("授权")
        case "cancel": return L10n.text("取消")
        default: return L10n.text("重试")
        }
    }

    private static func verbGlyph(_ verb: String) -> String {
        switch verb {
        case "authorize": return "key-round"
        case "cancel": return "x"
        default: return "rotate-cw"
        }
    }

    private static let verbs: Set<String> = ["authorize", "cancel", "retry"]

    /// A connector is connected when it works: it is not busy and its state is `connected` (or it says none). Waiting for an authorization, needing a login or a command,
    /// failing (a timeout too) and anything else is not connected: the connector is among the available ones, with the words of its state (owner, 2026-11-21).
    static func isConnected(_ connector: JSONValue) -> Bool {
        guard connector["busy"]?.boolValue != true else { return false }
        guard let state = some(connector["state"]) else { return true }
        return state["status"]?.stringValue == "connected"
    }

    static func describeState(_ state: JSONValue?, line: String) -> ConnectorState {
        guard let state = some(state) else { return ConnectorState(line: line) }
        switch state["status"]?.stringValue {
        case "needs-auth":
            return ConnectorState(line: line, tone: "warn", words: L10n.text("需要授权"), verb: "authorize")
        case "waiting":
            // The browser is the computer's, not the phone's: the words say where to go.
            return ConnectorState(line: present(state["code"]?.stringValue) ?? line, tone: "warn", words: L10n.text("请在电脑上授权"), verb: "cancel")
        case "needs-login":
            let login = present(state["login"]?.stringValue)
            return ConnectorState(line: login.map { L10n.text("在终端运行 {0}，再点重试", $0) } ?? line, tone: "warn", words: L10n.text("需要登录"), verb: "retry")
        case "missing":
            var shown = line
            if let command = present(state["command"]?.stringValue) {
                let install = present(state["install"]?.stringValue).map { L10n.text("：{0}", $0) } ?? ""
                shown = L10n.text("没找到 {0}{1}", command, install)
            }
            return ConnectorState(line: shown, tone: "bad", words: L10n.text("没装"), verb: "retry")
        case "error":
            let message = state["message"]?.stringValue
            let words = message == "timeout" ? L10n.text("连接超时") : String((message ?? "").prefix(120))
            return ConnectorState(line: line, tone: "bad", words: words, verb: "retry")
        default:
            return ConnectorState(line: line)
        }
    }

    /// What a connector is, in one line: where it is and how many tools it has, the command, or the sentence.
    static func aboutLine(_ about: JSONValue?) -> String {
        guard let about = some(about) else { return "" }
        var tools: String?
        if let count = about["tools"]?.numberValue { tools = L10n.plural("\(Int(count)) 个工具") }
        switch about["kind"]?.stringValue {
        case "remote": return joined([about["host"]?.stringValue, tools])
        case "local":
            let command = present(about["command"]?.stringValue).map { L10n.text("本机 · {0}", baseName($0)) }
            return joined([command, tools])
        case "cli": return present(about["command"]?.stringValue).map { L10n.text("命令行 · {0}", $0) } ?? ""
        case "sentence": return firstLine(about["text"]?.stringValue)
        default: return ""
        }
    }

    private static func groupName(_ id: String) -> String {
        switch id {
        case "here": return L10n.text("这台电脑")
        case "work": return L10n.text("办公")
        case "projects": return L10n.text("项目")
        case "dev": return L10n.text("开发")
        case "web": return L10n.text("网页")
        default: return id
        }
    }

    private static func connectorText() -> String { L10n.text("粘贴地址或命令，或者写一句话说怎么读") }

    /// The form that adds a connector of one's own; `recognized` is what the plugin made of the text so far (`connectors/recognize`).
    static func customConnector(recognized: JSONValue? = nil) -> SettingsPage {
        let kind = recognized?["kind"]?.stringValue
        let auth = recognized?["auth"]?.stringValue
        let count = recognized?["count"]?.numberValue ?? 0
        let several = count > 1
        var how: String?
        if kind == "remote" {
            switch auth {
            case "oauth": how = L10n.text("在浏览器里授权")
            case "none": how = L10n.text("不用登录")
            case "token": how = L10n.text("需要令牌")
            default: how = nil
            }
        } else if kind == "local" {
            how = L10n.text("一条命令")
        } else if kind == "sentence" {
            how = L10n.text("就是这句话")
        }
        var rows = [SettingsItem(rawID: "text", kind: "field", title: connectorText(), mono: true, key: "text", value: "",
                                 placeholder: connectorText(), multiline: true)]
        if let kind, !kind.isEmpty {
            let title: String
            switch kind {
            case "remote": title = L10n.text("远程")
            case "local": title = L10n.text("本地")
            case "sentence": title = L10n.text("命令行")
            default: title = kind
            }
            rows.append(SettingsItem(rawID: "recognized", kind: "text", title: title, detail: several ? L10n.plural("\(Int(count)) 个连接器") : how))
        }
        if !several {
            rows.append(SettingsItem(rawID: "name", kind: "field", title: L10n.text("名称"), key: "name", value: recognized?["name"]?.stringValue ?? "", placeholder: L10n.text("名称")))
        }
        if kind == "remote", auth == "token", !several {
            rows.append(SettingsItem(rawID: "token", kind: "field", title: L10n.text("令牌"), key: "token", value: "", placeholder: L10n.text("令牌"), secret: true))
        }
        if kind == "local", !several {
            rows.append(SettingsItem(rawID: "env", kind: "environment", title: L10n.text("添加环境变量")))
        }
        return SettingsPage(title: L10n.text("添加自定义连接器"), sections: [SettingsSection(rows: rows)],
                            save: SettingsButton(title: L10n.text("保存"), act: act("add")),
                            preview: SettingsPage.Preview(key: "text", act: act("recognize")))
    }

    private static func connectors(_ target: String?, _ values: Values) throws -> SettingsPage {
        if target == "add" { return customConnector() }
        let detail = (target ?? "").hasPrefix("connector:")
        let catalog: JSONValue
        if detail { catalog = .object([:]) } else { catalog = try body(values, "connectors/catalog") }
        let list = try body(values, "connectors/list")
        let connected = list["connectors"]?.arrayValue ?? []
        let (kind, subject) = parts(target)
        if kind == "connector" {
            guard let connector = connected.first(where: { $0["id"]?.stringValue == subject }) else {
                return SettingsPage(title: L10n.text("连接器"), sections: [])
            }
            return connectorPage(connector)
        }
        let waiting = connected.contains { $0["state"]?["status"]?.stringValue == "waiting" || $0["busy"]?.boolValue == true }
        var sections = [SettingsSection(rows: [
            SettingsItem(rawID: "add", kind: "text", title: L10n.text("添加自定义连接器"), tone: "muted", to: SettingsLocation(section: "connectors", target: "add")),
        ])]
        func row(_ connector: JSONValue) -> SettingsItem {
            let id = connector["id"]?.stringValue ?? ""
            let name = connector["name"]?.stringValue ?? ""
            let shown = describeState(connector["state"], line: aboutLine(connector["about"]))
            var menu: [SettingsMenuItem] = []
            if let verb = shown.verb {
                menu.append(SettingsMenuItem(title: verbName(verb), glyph: verbGlyph(verb), act: act("verb", ["id": .string(id), "verb": .string(verb)])))
            }
            menu.append(SettingsMenuItem(title: L10n.text("断开"), glyph: "unplug", act: act("disconnect", ["id": .string(id)]), role: "destructive", confirm: confirmDelete(name)))
            return SettingsItem(rawID: id, kind: "text", title: name, subtitle: present(shown.line), detail: present(shown.words), tone: present(shown.words) == nil ? nil : shown.tone,
                                icon: connector["icon"]?.stringValue, to: SettingsLocation(section: "connectors", target: "connector:\(id)"), menu: menu)
        }
        // 已连接 is what works; the others are among the available ones, with the words of their state and the one thing to do about it.
        let working = connected.filter(isConnected)
        let unconnected = connected.filter { !isConnected($0) }
        if !working.isEmpty { sections.append(SettingsSection(header: L10n.text("已连接"), rows: working.map(row))) }
        if !unconnected.isEmpty { sections.append(SettingsSection(header: L10n.text("可用"), rows: unconnected.map(row))) }
        var groups: [(id: String, items: [JSONValue])] = []
        for group in catalog["groups"]?.arrayValue ?? [] {
            guard let id = group["id"]?.stringValue, !groups.contains(where: { $0.id == id }) else { continue }
            groups.append((id, group["items"]?.arrayValue ?? []))
        }
        let order = ["here", "work", "projects", "dev", "web"]
        for id in order + groups.map(\.id).filter({ !order.contains($0) }) {
            guard let group = groups.first(where: { $0.id == id }), !group.items.isEmpty else { continue }
            let items = group.items.map { item -> SettingsItem in
                let itemID = item["id"]?.stringValue ?? ""
                return SettingsItem(rawID: itemID, kind: "text", title: item["name"]?.stringValue ?? "", subtitle: present(item["line"]?.stringValue),
                                    icon: item["icon"]?.stringValue,
                                    button: SettingsButton(title: L10n.text("连接"), act: act("connect", ["id": .string(itemID)])))
            }
            sections.append(SettingsSection(header: groupName(id), rows: items))
        }
        return SettingsPage(title: L10n.text("连接器"), sections: sections, poll: waiting ? 1.5 : nil)
    }

    /// One connector: a card for it, a card for the one thing to do about its state (取消 / 授权 / 重试), a card for 断开 (the owner's drawing, 2026-11-21); one that waits says where the page is.
    private static func connectorPage(_ connector: JSONValue) -> SettingsPage {
        let id = connector["id"]?.stringValue ?? ""
        let name = connector["name"]?.stringValue ?? ""
        let custom = connector["custom"]?.boolValue == true
        let shown = describeState(connector["state"], line: aboutLine(connector["about"]))
        let waiting = connector["state"]?["status"]?.stringValue == "waiting"
        var about = [SettingsItem(rawID: "about", kind: "text", title: name, subtitle: present(shown.line), detail: present(shown.words),
                                  tone: present(shown.words) == nil ? nil : shown.tone, icon: connector["icon"]?.stringValue)]
        if custom {
            let text = connector["text"]?.stringValue ?? connector["about"]?["text"]?.stringValue ?? ""
            about.append(SettingsItem(rawID: "name", kind: "field", title: L10n.text("名称"), key: "name", value: name, placeholder: L10n.text("名称")))
            about.append(SettingsItem(rawID: "text", kind: "field", title: connectorText(), mono: true, key: "text", value: text,
                                      placeholder: connectorText(), multiline: true))
        }
        var sections = [SettingsSection(footer: waiting ? L10n.text("授权页面已在电脑的浏览器里打开。在电脑上完成后，这里会自动更新。") : nil, rows: about)]
        if let verb = shown.verb, verbs.contains(verb) {
            let title = verbName(verb)
            sections.append(SettingsSection(rows: [actionRow("verb", title: title, button: SettingsButton(title: title, act: act("verb", ["id": .string(id), "verb": .string(verb)])))]))
        }
        let disconnect = destructive(title: L10n.text("断开"), act: act("disconnect", ["id": .string(id)]), confirm: confirmDelete(name))
        sections.append(SettingsSection(rows: [actionRow("disconnect", title: L10n.text("断开"), tone: "bad", button: disconnect)]))
        let busy = connector["busy"]?.boolValue == true
        return SettingsPage(title: name, sections: sections,
                            save: custom ? SettingsButton(title: L10n.text("保存"), act: act("update", ["id": .string(id)])) : nil,
                            poll: waiting || busy ? 1.5 : nil)
    }

    // MARK: 收集器

    private static let presets = ["5m", "15m", "30m", "1h", "6h", "0 9 * * *", "0 9 * * 1-5", "0 9-18 * * 1-5"]

    private static func presetWords(_ preset: String) -> String? {
        switch preset {
        case "5m": return L10n.text("每 5 分钟")
        case "15m": return L10n.text("每 15 分钟")
        case "30m": return L10n.text("每 30 分钟")
        case "1h": return L10n.text("每小时")
        case "6h": return L10n.text("每 6 小时")
        case "0 9 * * *": return L10n.text("每天 09:00")
        case "0 9 * * 1-5": return L10n.text("周一至周五 09:00")
        case "0 9-18 * * 1-5": return L10n.text("周一至周五 9 至 18 点每小时")
        default: return nil
        }
    }

    /// How often a collector reads, in words: a common frequency by its name, `2h` as every 2 hours, anything else (a cron) as it was written.
    static func describeFrequency(_ value: String?) -> String {
        let one = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if one.isEmpty { return L10n.text("每 30 分钟") }
        if let words = presetWords(one) { return words }
        guard let every = one.wholeMatch(of: #/([0-9]{1,4})\s*([mhdMHD])/#), let n = Int(every.1) else { return one }
        switch every.2.lowercased() {
        case "m": return L10n.plural("每 \(n) 分钟")
        case "h": return n == 1 ? L10n.text("每小时") : L10n.plural("每 \(n) 小时")
        default: return n == 1 ? L10n.text("每天") : L10n.plural("每 \(n) 天")
        }
    }

    private static func collectorKind(_ kind: String?) -> String? {
        switch kind {
        case "prompt": return "Prompt"
        case "mcp": return "MCP"
        default: return nil
        }
    }

    private static func collectors(_ target: String?, _ values: Values) throws -> SettingsPage {
        let state = try body(values, "collectors/list")
        let access = try body(values, "connectors/list")
        let list = state["collectors"]?.arrayValue ?? []
        let available = access["connectors"]?.arrayValue ?? []
        let (kind, subject) = parts(target)
        if kind == "edit" || kind == "add" {
            let collector = kind == "edit" ? list.first { $0["id"]?.stringValue == subject } : nil
            let id = collector?["id"]?.stringValue
            var saveArgs: [String: JSONValue] = [:]
            if let id { saveArgs["id"] = .string(id) }
            let options = available.map { SettingsOption(id: $0["id"]?.stringValue ?? "", title: $0["name"]?.stringValue ?? "", subtitle: collectorKind($0["kind"]?.stringValue)) }
            let common = [SettingsOption(id: "", title: "—")] + presets.map { SettingsOption(id: $0, title: presetWords($0) ?? $0, subtitle: $0) }
            let frequency = L10n.text("频率，如 30m、2h、1d，或 cron")
            var sections = [SettingsSection(rows: [
                SettingsItem(rawID: "name", kind: "field", title: L10n.text("名称"), key: "name", value: collector?["name"]?.stringValue ?? "", placeholder: L10n.text("名称")),
                SettingsItem(rawID: "connector", kind: "choice", title: L10n.text("连接器"), options: options,
                             selected: collector?["connector"]?.stringValue ?? available.first?["id"]?.stringValue ?? "", key: "connector"),
                SettingsItem(rawID: "frequency", kind: "field", title: frequency, mono: true, key: "frequency", value: collector?["frequency"]?.stringValue ?? "", placeholder: frequency),
                SettingsItem(rawID: "common", kind: "choice", title: L10n.text("常用频率"), options: common, selected: "", key: "common"),
                SettingsItem(rawID: "prompt", kind: "field", title: L10n.text("收集什么"), key: "prompt", value: collector?["prompt"]?.stringValue ?? "",
                             placeholder: L10n.text("收集什么"), multiline: true),
            ])]
            // The delete is on the page of the collector too, not only a swipe or a long press away (owner, 2026-11-21).
            if let collector, let id {
                let name = collector["name"]?.stringValue ?? ""
                sections.append(SettingsSection(rows: [
                    actionRow("remove", title: L10n.text("删除"), tone: "bad", button: destructive(title: L10n.text("删除"), act: act("remove", ["id": .string(id)]), confirm: confirmDelete(name))),
                ]))
            }
            return SettingsPage(title: collector.map { $0["name"]?.stringValue ?? "" } ?? L10n.text("添加收集器"),
                                sections: sections,
                                save: SettingsButton(title: L10n.text("保存"), act: act("save", saveArgs)))
        }
        let collected = values["dispatch/state"] ?? .object([:])
        var reads: [String: JSONValue] = [:]
        for entry in collected["collectors"]?.arrayValue ?? [] {
            if let id = entry["id"]?.stringValue, let read = entry["lastRead"] { reads[id] = read }
        }
        func lastLine(_ read: JSONValue?) -> String {
            guard let read, let at = read["at"]?.numberValue, at.isFinite else { return "" }
            let time = when(at)
            guard read["ok"]?.boolValue == true else { return L10n.text("上次 {0} · 读取失败", time) }
            let items = Int(read["items"]?.numberValue ?? 0)
            return items > 0 ? L10n.plural("上次 \(time) · 新增 \(items) 条") : L10n.text("上次 {0} · 没有新的", time)
        }
        var sections: [SettingsSection] = []
        if available.isEmpty {
            sections.append(SettingsSection(rows: [SettingsItem(rawID: "needConnector", kind: "text", title: L10n.text("先添加一个连接器"), tone: "muted")]))
        } else {
            sections.append(SettingsSection(rows: [
                SettingsItem(rawID: "add", kind: "text", title: L10n.text("添加收集器"), tone: "muted", to: SettingsLocation(section: "collectors", target: "add")),
            ]))
        }
        if list.isEmpty {
            sections.append(SettingsSection(rows: [SettingsItem(rawID: "empty", kind: "text", title: L10n.text("没有收集器"), tone: "muted")]))
        } else {
            let rows = list.map { collector -> SettingsItem in
                let id = collector["id"]?.stringValue ?? ""
                let name = collector["name"]?.stringValue ?? ""
                let edit = SettingsLocation(section: "collectors", target: "edit:\(id)")
                let menu = [
                    SettingsMenuItem(title: L10n.text("编辑"), glyph: "pencil", to: edit),
                    SettingsMenuItem(title: L10n.text("删除"), glyph: "trash", act: act("remove", ["id": .string(id)]), role: "destructive", confirm: confirmDelete(name)),
                ]
                return SettingsItem(
                    rawID: id, kind: "text", title: name,
                    subtitle: joined([firstLine(collector["prompt"]?.stringValue), lastLine(reads[id])]),
                    detail: describeFrequency(collector["frequency"]?.stringValue),
                    icon: available.first { $0["id"]?.stringValue == collector["connector"]?.stringValue }?["icon"]?.stringValue,
                    notification: SettingsNotification(title: L10n.text("通知"), on: collector["notify"]?.boolValue == true, act: act("notify", ["id": .string(id)])),
                    to: edit, menu: menu)
            }
            sections.append(SettingsSection(header: L10n.text("收集器"), rows: rows))
        }
        return SettingsPage(title: L10n.text("收集器"), sections: sections)
    }

    // MARK: 规则

    /// The two files the rules are, and what each is about.
    private static let ruleFiles = ["TRIAGE.md", "ASSIGN.md"]

    private static func ruleTitle(_ file: String) -> String {
        file == "TRIAGE.md" ? L10n.text("影响、工作量和截止") : L10n.text("任务分配")
    }

    private static func rules(_ target: String?, _ values: Values) throws -> SettingsPage {
        let data = try body(values, "rules/get")
        let (kind, subject) = parts(target)
        if kind == "edit", ruleFiles.contains(subject) {
            let text = data["rules"]?[subject]?.stringValue
            let args: [String: JSONValue] = ["name": .string(subject), "previous": text.map(JSONValue.string) ?? .null,
                                             "projectFolder": data["projectFolder"]?.stringValue.map(JSONValue.string) ?? .null]
            return SettingsPage(title: subject, sections: [
                SettingsSection(header: ruleTitle(subject), rows: [SettingsItem(rawID: "text", kind: "field", title: subject, mono: true, key: "text", value: text ?? "", multiline: true)]),
            ], save: SettingsButton(title: L10n.text("保存"), act: act("save", args)))
        }
        let sections = ruleFiles.map { file -> SettingsSection in
            let text = data["rules"]?[file]?.stringValue
            let subtitle = present(text) != nil ? firstLine(text) : (text == nil ? L10n.text("未找到") : L10n.text("空"))
            return SettingsSection(header: ruleTitle(file), rows: [
                SettingsItem(rawID: file, kind: "text", title: file, subtitle: subtitle, mono: true, to: SettingsLocation(section: "rules", target: "edit:\(file)")),
            ])
        }
        return SettingsPage(title: L10n.text("规则"), sections: sections)
    }

    // MARK: 记忆

    /// What a tidy run changed, in words.
    private static func reviewSummary(_ counts: JSONValue?) -> String {
        func number(_ key: String) -> Int { Int(counts?[key]?.numberValue ?? 0) }
        let updated = number("refine") + number("supersede") + number("corroborate")
        var parts: [String] = []
        if updated > 0 { parts.append(L10n.plural("更新 \(updated) 条")) }
        if number("new") > 0 { parts.append(L10n.plural("新增 \(number("new")) 条")) }
        if number("skill") > 0 { parts.append(L10n.plural("新增 \(number("skill")) 项技能")) }
        return parts.isEmpty ? L10n.text("没有变更") : parts.joined(separator: L10n.language == "en" ? ", " : "，")
    }

    private static func memory(_ target: String?, _ values: Values) throws -> SettingsPage {
        let records = try body(values, "memory/records")
        let reviews = try body(values, "memory/reviews")
        let list = records["records"]?.arrayValue ?? []
        let (kind, subject) = parts(target)
        let deleted = L10n.text("会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。")
        /// 忘记: the action, and the question before it that says what goes.
        func forget(_ record: JSONValue) -> (act: SettingsAct, confirm: SettingsConfirm) {
            let text = record["text"]?.stringValue ?? ""
            return (act("forget", ["id": record["id"] ?? .null]),
                    SettingsConfirm(title: L10n.text("将要删除"), message: L10n.text("{0}\n会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。", text), button: L10n.text("删除")))
        }
        if kind == "edit" {
            let record = list.first { idText($0["id"]) == subject }
            var saveArgs: [String: JSONValue] = [:]
            if let id = record?["id"] { saveArgs["id"] = id }
            // 忘记 is on the page of the memory too, in red with what it deletes under it (owner, 2026-11-21).
            var sections = [SettingsSection(rows: [SettingsItem(rawID: "text", kind: "field", title: L10n.text("编辑"), key: "text", value: record?["text"]?.stringValue ?? "", multiline: true)])]
            if let record {
                let forgetting = forget(record)
                let button = SettingsButton(title: L10n.text("忘记"), act: forgetting.act, role: "destructive", confirm: forgetting.confirm)
                sections.append(SettingsSection(footer: deleted, rows: [actionRow("forget", title: L10n.text("忘记"), tone: "bad", button: button)]))
            }
            return SettingsPage(title: L10n.text("编辑"), sections: sections,
                                save: SettingsButton(title: L10n.text("保存"), act: act("save", saveArgs)))
        }
        var sections: [SettingsSection] = []
        if list.isEmpty {
            sections.append(SettingsSection(rows: [SettingsItem(rawID: "empty", kind: "text", title: L10n.text("还没有记住的事"), tone: "muted")]))
        } else {
            let rows = list.map { record -> SettingsItem in
                let id = idText(record["id"]) ?? ""
                let forgetting = forget(record)
                let since = present(record["since"]?.stringValue).map { L10n.text("自 {0}", $0) }
                let menu = [
                    SettingsMenuItem(title: L10n.text("编辑"), glyph: "pencil", to: SettingsLocation(section: "memory", target: "edit:\(id)")),
                    SettingsMenuItem(title: L10n.text("忘记"), glyph: "trash", act: forgetting.act, role: "destructive", confirm: forgetting.confirm),
                ]
                return SettingsItem(rawID: id, kind: "text", title: record["text"]?.stringValue ?? "",
                                    subtitle: joined([record["file"]?.stringValue, since, record["status"]?.stringValue == "superseded" ? L10n.text("已替代") : nil]),
                                    to: SettingsLocation(section: "memory", target: "edit:\(id)"), menu: menu)
            }
            sections.append(SettingsSection(header: L10n.text("记忆"), rows: rows))
        }
        let runs = reviews["reviews"]?.arrayValue ?? []
        let runRows: [SettingsItem]
        if runs.isEmpty {
            runRows = [SettingsItem(rawID: "noReviews", kind: "text", title: L10n.text("还没有整理记录"), tone: "muted")]
        } else {
            runRows = runs.map { review in
                let at = review["at"]?.numberValue
                return SettingsItem(rawID: idText(review["id"]) ?? "", kind: "text", title: reviewSummary(review["summary"]),
                                    subtitle: (at ?? 0) != 0 ? when(at) : "")
            }
        }
        sections.append(SettingsSection(header: L10n.text("整理记录"), rows: runRows))
        return SettingsPage(title: L10n.text("记忆"), sections: sections)
    }

    // MARK: 技能

    private static func skills(_ target: String?, _ values: Values) throws -> SettingsPage {
        let (kind, subject) = parts(target)
        if kind == "skill" {
            let one = try body(values, "skills/read")
            let text = one["text"]?.stringValue ?? one["skill"]?["text"]?.stringValue ?? ""
            let remove = destructive(title: L10n.text("删除"), act: act("remove", ["name": .string(subject)]), confirm: confirmDelete(subject))
            return SettingsPage(title: subject, sections: [
                SettingsSection(header: subject, rows: [SettingsItem(rawID: "text", kind: "text", title: text, mono: true)]),
                SettingsSection(rows: [actionRow("delete", title: L10n.text("删除"), tone: "bad", button: remove)]),
            ])
        }
        let list = try body(values, "skills/list")["skills"]?.arrayValue ?? []
        guard !list.isEmpty else {
            return SettingsPage(title: L10n.text("技能"), sections: [
                SettingsSection(rows: [SettingsItem(rawID: "empty", kind: "text", title: L10n.text("还没有技能"), tone: "muted")]),
            ])
        }
        let rows = list.map { skill -> SettingsItem in
            let name = skill["name"]?.stringValue ?? ""
            let menu = [SettingsMenuItem(title: L10n.text("删除"), glyph: "trash", act: act("remove", ["name": .string(name)]), role: "destructive", confirm: confirmDelete(name))]
            return SettingsItem(rawID: name, kind: "text", title: name, subtitle: present(skill["description"]?.stringValue),
                                to: SettingsLocation(section: "skills", target: "skill:\(name)"), menu: menu)
        }
        return SettingsPage(title: L10n.text("技能"), sections: [SettingsSection(header: L10n.text("技能"), rows: rows)])
    }
}
