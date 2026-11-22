import Foundation

/// Which part of the app an entry was chosen from; the sidebar highlights only its own.
enum NavigationArea: Equatable {
    case sidebar, view
}

/// What fills the main area: the conversation, a screen of the app's own, or an embedded DSH page.
struct MainDestination: Equatable {
    var id: String
    var area: NavigationArea
    var target: NavigationTarget
    var title: String

    static let conversation = MainDestination(id: "chat", area: .view, target: .chat, title: L10n.text("对话"))
    static let board = MainDestination(id: "dudu.board", area: .sidebar, target: .board, title: L10n.text("看板"))
    static let inbox = MainDestination(id: "dudu.collector", area: .sidebar, target: .collector, title: L10n.text("收件箱"))
    static let tasks = MainDestination(id: "dudu.tasks", area: .sidebar, target: .tasks, title: L10n.text("任务"))
    static let settings = MainDestination(id: "settings", area: .sidebar, target: .settingsHome, title: L10n.text("设置"))

    var showsChat: Bool { target == .chat }
    var onCanvas: Bool {
        if target.settingsSection != nil { return true }
        return [.chat, .board, .collector, .tasks].contains(target)
    }

    /// A short, log-safe name for the target.
    var logState: String {
        switch target {
        case .chat: return "conversation"
        case .assistant: return "assistant"
        case .board: return "board"
        case .collector: return "collector"
        case .settingsHome: return "settings"
        case .tasks: return "tasks"
        case .dshSettings: return "dshSettings"
        case .duduSettings: return "duduSettings"
        case .files: return "files"
        case let .web(page, _): return page.rawValue
        case .unsupported: return "unsupported"
        }
    }
}

enum HomeTab: String, CaseIterable, Identifiable {
    case board, inbox, tasks, settings

    var id: String { rawValue }
    var destination: MainDestination {
        switch self {
        case .board: return .board
        case .inbox: return .inbox
        case .tasks: return .tasks
        case .settings: return .settings
        }
    }
    var title: String { destination.title }

    init?(target: NavigationTarget) {
        switch target {
        case .board: self = .board
        case .collector: self = .inbox
        case .tasks: self = .tasks
        case .settingsHome: self = .settings
        default: return nil
        }
    }
}

/// Auxiliary pages remember where they were opened, independently of the retained chat session.
/// Entries keep their identity while another page covers them, including a cancelled edge swipe.
struct MainNavigation {
    struct Page: Identifiable, Equatable {
        let id = UUID()
        let destination: MainDestination
    }

    private(set) var root: MainDestination = .board
    private(set) var pages: [Page] = []

    var destination: MainDestination { pages.last?.destination ?? root }
    var previous: MainDestination? {
        guard !pages.isEmpty else { return nil }
        return pages.dropLast().last?.destination ?? root
    }

    @discardableResult
    mutating func open(_ next: MainDestination) -> Bool {
        guard next != destination else { return false }
        if next.target == .board || next.showsChat {
            reset(to: next)
        } else {
            pages.append(Page(destination: next))
        }
        return true
    }

    /// Only a committed return removes a page. Preparing or cancelling a gesture leaves this intact.
    @discardableResult
    mutating func pop(expected id: UUID) -> Bool {
        guard pages.last?.id == id else { return false }
        pages.removeLast()
        return true
    }

    mutating func reset(to next: MainDestination) {
        root = next
        pages = []
    }
}
