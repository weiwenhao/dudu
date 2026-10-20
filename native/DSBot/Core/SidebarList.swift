import Foundation

/// How DSH's sidebar lists conversations, as its "视图选项" menu offers: grouping and which archived
/// conversations show. The defaults are DSH's. (DSH can also nest workspaces; a phone does not.)
enum SidebarGrouping: String, CaseIterable, Sendable {
    case workspace, flat
}

enum SidebarArchiveFilter: String, CaseIterable, Sendable {
    case hide, all, only
}

struct SidebarOptions: Equatable, Sendable {
    var grouping: SidebarGrouping = .workspace
    var archive: SidebarArchiveFilter = .hide
}

/// One workspace in the list (or the conversations that belong to none).
struct SidebarGroup: Identifiable, Equatable, Sendable {
    static let ungroupedID = "ungrouped"

    var id: String
    var title: String
    /// Nil for the group of conversations no workspace holds.
    var workspaceId: String?
    /// The conversations of this workspace, in display order.
    var sessions: [SessionSummary]

    var isUngrouped: Bool { workspaceId == nil }
}

/// What the list shows, row by row.
enum SidebarEntry: Identifiable, Equatable, Sendable {
    case group(SidebarGroup, isCollapsed: Bool)
    case session(SessionSummary)

    var id: String {
        switch self {
        case let .group(group, _): return "group:\(group.id)"
        case let .session(session): return "session:\(session.id)"
        }
    }
}

enum SidebarList {
    /// The rows of the sidebar for the conversations, workspaces and view options.
    ///
    /// - A conversation nobody has written in yet never shows, not even while it is open: the new-task
    ///   page is a page of its own, and the conversation joins the list when its first message is sent.
    /// - Pinned conversations come first in their group, most recently pinned first.
    /// - A search ignores the grouping and the archive filter and lists what matches.
    static func entries(
        sessions: [SessionSummary],
        workspaces: [WorkspaceSummary],
        options: SidebarOptions,
        search: String = "",
        collapsed: Set<String> = []
    ) -> [SidebarEntry] {
        let visible = sessions.filter { $0.blank != true }

        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        if !query.isEmpty {
            let matches = visible.filter {
                $0.title.localizedCaseInsensitiveContains(query)
                    || ($0.workspaceName?.localizedCaseInsensitiveContains(query) ?? false)
            }
            return ordered(matches).map { .session($0) }
        }

        let shown = visible.filter { passes($0, options.archive) }
        if options.grouping == .flat {
            return ordered(shown).map { .session($0) }
        }

        var entries: [SidebarEntry] = []
        for group in groups(of: shown, workspaces: workspaces, options: options) {
            let isCollapsed = collapsed.contains(group.id)
            entries.append(.group(group, isCollapsed: isCollapsed))
            if !isCollapsed { entries.append(contentsOf: group.sessions.map { .session($0) }) }
        }
        return entries
    }

    // MARK: Pieces

    private static func passes(_ session: SessionSummary, _ filter: SidebarArchiveFilter) -> Bool {
        switch filter {
        case .hide: return session.archived != true
        case .all: return true
        case .only: return session.archived == true
        }
    }

    /// Pinned conversations first, most recently pinned first; the rest newest first.
    static func ordered(_ sessions: [SessionSummary]) -> [SessionSummary] {
        let pinned = sessions.filter { $0.pinned == true }.sorted { ($0.pinRank ?? 0) < ($1.pinRank ?? 0) }
        let rest = sessions.filter { $0.pinned != true }.sorted { $0.updatedAt > $1.updatedAt }
        return pinned + rest
    }

    private static func groups(
        of sessions: [SessionSummary], workspaces: [WorkspaceSummary], options: SidebarOptions
    ) -> [SidebarGroup] {
        let known = Set(workspaces.map(\.id))
        let byWorkspace = Dictionary(grouping: sessions) { session -> String in
            guard let id = session.workspaceId, known.contains(id) else { return SidebarGroup.ungroupedID }
            return id
        }
        var result = workspaces.map { workspace in
            SidebarGroup(
                id: workspace.id, title: workspace.name, workspaceId: workspace.id,
                sessions: ordered(byWorkspace[workspace.id] ?? [])
            )
        }
        // Only archived conversations: a workspace with none of them has nothing to show.
        if options.archive == .only { result.removeAll { $0.sessions.isEmpty } }
        // Conversations that belong to no registered workspace come last, as DSH's "Ungrouped".
        if let loose = byWorkspace[SidebarGroup.ungroupedID], !loose.isEmpty {
            result.append(SidebarGroup(
                id: SidebarGroup.ungroupedID, title: "未分组", workspaceId: nil,
                sessions: ordered(loose)
            ))
        }
        return result
    }
}
