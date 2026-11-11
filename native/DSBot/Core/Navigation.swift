import Foundation

/// What DSH shows in its own sidebar, conversation tabs and settings, as the dsbot plugin
/// reports it. The app never lists these itself: an entry that a plugin adds to DSH arrives here, and
/// the plugin says how each one is opened.
struct NavigationCatalog: Decodable, Equatable, Sendable {
    var schemaVersion: Int
    /// False until DSH's own window has reported once.
    var available: Bool
    var updatedAt: Double
    var sidebar: [NavigationItem]
    var views: [NavigationItem]
    var settings: [NavigationItem]

    static let empty = NavigationCatalog(
        schemaVersion: 1, available: false, updatedAt: 0, sidebar: [], views: [], settings: []
    )

    init(
        schemaVersion: Int, available: Bool, updatedAt: Double,
        sidebar: [NavigationItem], views: [NavigationItem], settings: [NavigationItem]
    ) {
        self.schemaVersion = schemaVersion
        self.available = available
        self.updatedAt = updatedAt
        self.sidebar = sidebar
        self.views = views
        self.settings = settings
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, available, updatedAt, sidebar, views, settings
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        guard schemaVersion == 1 else {
            throw DecodingError.dataCorruptedError(forKey: .schemaVersion, in: container, debugDescription: "Unsupported navigation schema.")
        }
        available = try container.decodeIfPresent(Bool.self, forKey: .available) ?? false
        updatedAt = try container.decodeIfPresent(Double.self, forKey: .updatedAt) ?? 0
        sidebar = try container.decodeIfPresent([NavigationItem].self, forKey: .sidebar) ?? []
        views = try container.decodeIfPresent([NavigationItem].self, forKey: .views) ?? []
        settings = try container.decodeIfPresent([NavigationItem].self, forKey: .settings) ?? []
    }

    /// The plugin identifies the primary entries. Native routes also recognize older snapshots
    /// from before the grouping field was added; the DSH plugin inventory stays dynamic.
    var primarySidebar: [NavigationItem] {
        sidebar.filter(\.isPrimarySidebarEntry)
    }

    var additionalSidebar: [NavigationItem] {
        sidebar.filter { !$0.isPrimarySidebarEntry }
    }
}

struct NavigationItem: Decodable, Identifiable, Equatable, Sendable {
    var id: String
    var title: String
    var order: Double
    var icon: NavigationIcon?
    var open: NavigationOpen
    /// The package that registered it in DSH, when it said so.
    var source: String?
    var sessionId: String?
    /// `primary` for the permanent sidebar entries; `dudu` for its settings group. DSH's entries have none.
    var group: String?

    init(
        id: String, title: String, order: Double = 0, icon: NavigationIcon? = nil,
        open: NavigationOpen, source: String? = nil, sessionId: String? = nil, group: String? = nil
    ) {
        self.id = id
        self.title = title
        self.order = order
        self.icon = icon
        self.open = open
        self.source = source
        self.sessionId = sessionId
        self.group = group
    }

    private enum CodingKeys: String, CodingKey { case id, title, order, icon, open, source, sessionId, group }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        order = try container.decodeIfPresent(Double.self, forKey: .order) ?? 0
        // An icon the app cannot draw costs the entry its glyph, never the entry.
        icon = try container.decodeIfPresent(NavigationIcon.self, forKey: .icon)
        open = try container.decode(NavigationOpen.self, forKey: .open)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId)
        group = try container.decodeIfPresent(String.self, forKey: .group)
    }

    /// What the app does for the entry. The plugin's own tasks entry is known by its id as well as by its `target`: a plugin that predates the `target` still gets the tasks page, and as the fourth
    /// permanent row (owner, 2026-11-10), instead of the old schedule list under 查看更多.
    var target: NavigationTarget {
        if id == "dudu.tasks", open.native == "schedule" { return .tasks }
        return NavigationTarget(open)
    }

    var isPrimarySidebarEntry: Bool {
        group == "primary" || [.assistant, .board, .collector, .tasks].contains(target)
    }
}

/// How an entry opens. `native` names a screen the app draws itself; `web` names the DSH page that is
/// embedded when the app has no screen of its own for it.
struct NavigationOpen: Decodable, Equatable, Sendable {
    struct Web: Decodable, Equatable, Sendable {
        var page: String
        var target: String?

        init(page: String, target: String? = nil) {
            self.page = page
            self.target = target
        }
    }

    var native: String?
    /// The section of a native settings page.
    var target: String?
    var web: Web?

    init(native: String? = nil, target: String? = nil, web: Web? = nil) {
        self.native = native
        self.target = target
        self.web = web
    }
}

/// What the app does for an entry, decided by the screens this build actually has.
enum NavigationTarget: Equatable, Sendable {
    case chat
    /// The plugin's persistent assistant session, opened through the native conversation.
    case assistant
    /// The board, the page the app opens on.
    case board
    /// What the collectors brought back.
    case collector
    /// DSH's own settings pages, listed one level down in the settings.
    case dshSettings
    /// 嘟嘟's own configuration, drawn in SwiftUI.
    case duduSettings(section: String)
    case files
    /// DSH's own schedule list (what an older plugin and DSH's `schedules` entry open).
    case schedule
    /// 嘟嘟's scheduled tasks, the fourth permanent row (owner, 2026-11-10): the plugin's `dudu.tasks` entry says `target: dudu-tasks`.
    case tasks
    case web(page: EmbeddedDSHPage, target: String?)
    case unsupported

    init(_ open: NavigationOpen) {
        if let native = open.native {
            switch native {
            case "chat": self = .chat; return
            case "assistant": self = .assistant; return
            case "board": self = .board; return
            case "collector": self = .collector; return
            case "dsh-settings": self = .dshSettings; return
            case "dudu-settings": self = .duduSettings(section: open.target ?? open.web?.target ?? "general"); return
            case "files": self = .files; return
            case "schedule": self = open.target == "dudu-tasks" ? .tasks : .schedule; return
            default: break // A screen this build does not have: fall back to the page DSH has for it.
            }
        }
        if let web = open.web, let page = EmbeddedDSHPage(rawValue: web.page) {
            // Cached navigation and older plugins still describe these pages as web pages.
            self = page == .dudu ? .duduSettings(section: web.target ?? "general") : .web(page: page, target: web.target)
        } else {
            self = .unsupported
        }
    }

    var settingsSection: String? {
        if case let .duduSettings(section) = self { return section }
        return nil
    }
}

extension EmbeddedDSHPage {
    /// Pages of one conversation: they are opened on the conversation that is on screen.
    var needsSession: Bool {
        switch self {
        case .trace, .context, .team, .tools, .view: return true
        case .plugins, .settings, .panel, .dudu: return false
        }
    }
}

// MARK: Icons

/// An icon as geometry (a view box and shapes), drawn natively, or, when DSH's icon uses a mask, a gradient
/// or anything else shapes cannot say, a small picture the browser drew. The plugin sends no markup.
struct NavigationIcon: Decodable, Equatable, Sendable {
    var viewBox: [Double]
    var nodes: [NavigationIconNode]
    /// The PNG of a drawn icon. Only its shape matters: it is tinted like every other icon.
    var png: Data?

    init(viewBox: [Double], nodes: [NavigationIconNode], png: Data? = nil) {
        self.viewBox = viewBox
        self.nodes = nodes
        self.png = png
    }

    private enum CodingKeys: String, CodingKey { case viewBox, nodes, png }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let box = try container.decode([Double].self, forKey: .viewBox)
        // The same limits the plugin applies; an icon outside them is not drawn.
        guard box.count == 4, box.allSatisfy(\.isFinite), box[2] > 0, box[3] > 0, box[2] <= 1024, box[3] <= 1024 else {
            throw DecodingError.dataCorruptedError(forKey: .viewBox, in: container, debugDescription: "Unusable icon.")
        }
        if let encoded = try container.decodeIfPresent(String.self, forKey: .png) {
            guard let data = Self.picture(fromBase64: encoded) else {
                throw DecodingError.dataCorruptedError(forKey: .png, in: container, debugDescription: "Unusable picture.")
            }
            viewBox = box
            nodes = []
            png = data
            return
        }
        let nodes = try container.decode([NavigationIconNode].self, forKey: .nodes)
        guard !nodes.isEmpty, nodes.count <= 48 else {
            throw DecodingError.dataCorruptedError(forKey: .nodes, in: container, debugDescription: "Unusable icon.")
        }
        viewBox = box
        self.nodes = nodes
    }

    /// A real, small PNG: its signature, then a header chunk that gives a size of 8 to 128 points a side.
    static func picture(fromBase64 text: String) -> Data? {
        guard text.utf8.count <= 16 * 1024, let data = Data(base64Encoded: text), data.count >= 33,
              data.count <= 12 * 1024 else { return nil }
        let signature: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        guard data.prefix(8).elementsEqual(signature), String(decoding: data[12..<16], as: UTF8.self) == "IHDR" else {
            return nil
        }
        func side(_ offset: Int) -> Int {
            data[offset..<(offset + 4)].reduce(0) { $0 << 8 | Int($1) }
        }
        let width = side(16), height = side(20)
        return (8...128).contains(width) && (8...128).contains(height) ? data : nil
    }
}

struct NavigationIconNode: Decodable, Equatable, Sendable {
    var tag: String
    var d: String?
    var points: String?
    var cx: Double?
    var cy: Double?
    var r: Double?
    var rx: Double?
    var ry: Double?
    var x: Double?
    var y: Double?
    var width: Double?
    var height: Double?
    var x1: Double?
    var y1: Double?
    var x2: Double?
    var y2: Double?
    /// `none`, `currentColor` or a hex colour.
    var fill: String?
    var stroke: String?
    var strokeWidth: Double?
    var strokeLinecap: String?
    var strokeLinejoin: String?
    var fillRule: String?
    var opacity: Double?
    var matrix: [Double]?
}

/// Why the lists are empty, so the app can say so instead of listing what DSH might have.
enum NavigationAvailability: Equatable, Sendable {
    /// Not asked yet (or the connection is new).
    case unknown
    /// The plugin on the computer predates `navigation.get`.
    case unsupported
    /// The plugin is current, but DSH's own window has not reported to it yet.
    case waiting
    case ready
}
