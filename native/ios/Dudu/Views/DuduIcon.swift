import LucideSwift
import SwiftUI
import UIKit

enum DuduGlyph: CaseIterable {
    case menu, panel, camera, image, video, keyboard, microphone, voice
    case plus, add, compose, close, remove, check, settings
    case plugins, skills, schedule, computer, account, options
    case message, queue, trace, context, team
    case down, up, right, select, reconnect, permission, model
    case scan, focus, stop, send, terminal, open, search, folder, workspace, workspaceOpen, file, back, copy
    case goal, plan, compact, attach
    case think, browse, code, globe, question, pause, play, trash, editLine, mode, sliders
    case archive, archiveRestore, info
    /// The settings' 隐私政策 and 版本信息 rows (owner, 2026-11-12); 关于 is `info`.
    case privacy, version
    case inbox, selectRows, forward, restore, openLink, selectAll, listTodo, zap, reply
    case issueProject, issueLabel, dueDate, issueStatus, issuePriority
    case listFilter, issueSource, filterStatus, filterDates
    /// Fill in the context of a collected record (the desktop's `RefreshCw`, in its record menu and the row's buttons; the owner, 2026-11-11: "刷新图标吧").
    case completeContext
    /// The quota (the desktop's `Gauge`: the header icon and the chat's 额度 button), the board's second button (owner, 2026-11-11).
    case quota
    /// The desktop's session status icons, before the name of a board group (`SessionStateIcon`).
    case stateIdle, stateWorking, stateBlocked, stateUnassigned
    /// A failed agent or background job in the activity sheets (red Lucide `CircleAlert`).
    case stateFailed
    /// The square Stop in the approved background-job detail.
    case jobStop

    var lucide: LucideIconName {
        switch self {
        case .menu: return .menu
        case .panel: return .panelRight
        case .camera: return .camera
        case .image: return .image
        case .video: return .film
        case .keyboard: return .keyboard
        case .microphone: return .mic
        case .voice: return .audioLines
        case .plus: return .plus
        case .add: return .circlePlus
        case .compose: return .squarePen
        case .close: return .x
        case .remove: return .circleMinus
        case .check: return .check
        case .settings: return .settings
        case .plugins: return .layers
        case .skills: return .sparkles
        case .schedule: return .clock
        case .computer: return .monitor
        case .account: return .circleUserRound
        case .options: return .ellipsis
        case .message: return .messageSquare
        case .queue: return .messageCircleText
        case .trace: return .activity
        case .context: return .fileCode
        case .team: return .usersRound
        case .down: return .chevronDown
        case .up: return .chevronUp
        case .right: return .chevronRight
        case .select: return .chevronsUpDown
        case .reconnect: return .rotateCw
        case .permission: return .shieldCheck
        case .model: return .bot
        case .scan: return .scanQrCode
        case .focus: return .scan
        case .stop: return .circleStop
        case .send: return .arrowUp
        case .terminal: return .terminal
        case .open: return .cornerDownRight
        case .search: return .search
        case .folder: return .folder
        case .workspace: return .folder
        case .workspaceOpen: return .folderOpen
        case .file: return .file
        case .back: return .chevronLeft
        case .copy: return .copy
        case .reply: return .reply
        case .goal: return .target
        case .plan: return .clipboardList
        case .compact: return .foldVertical
        case .attach: return .paperclip
        case .think: return .brain
        case .browse: return .eye
        case .code: return .code
        case .globe: return .globe
        case .question: return .circleQuestionMark
        case .pause: return .pause
        case .play: return .play
        case .trash: return .trash
        case .editLine: return .pencilLine
        case .mode: return .recycle
        case .sliders: return .slidersHorizontal
        case .archive: return .archive
        case .archiveRestore: return .archiveRestore
        case .info: return .info
        case .privacy: return .lock
        case .version: return .tag
        case .inbox: return .inbox
        case .listTodo: return .listTodo
        case .zap: return .zap
        case .selectRows: return .listChecks
        case .forward: return .forward
        case .restore: return .rotateCcw
        case .openLink: return .externalLink
        case .selectAll: return .checkCheck
        case .issueProject: return .box
        case .issueLabel: return .tag
        case .dueDate: return .calendar
        case .issueStatus: return .circleDot
        case .issuePriority: return .signal
        case .listFilter: return .listFilter
        case .issueSource: return .plug
        case .filterStatus: return .circleDashed
        case .filterDates: return .calendarDays
        case .completeContext: return .refreshCw
        case .quota: return .gauge
        case .stateIdle: return .circle
        case .stateWorking: return .loaderCircle
        case .stateBlocked: return .octagonPause
        case .stateUnassigned: return .user
        case .stateFailed: return .circleAlert
        case .jobStop: return .square
        }
    }

    var assetName: String? {
        switch self {
        case .goal: return "Goal"
        case .queue: return "Queue"
        case .mode: return "AgentPreset"
        case .workspace: return "Workspace"
        case .workspaceOpen: return "WorkspaceOpen"
        case .think: return "Think"
        case .dueDate: return "IssueDue"
        default: return nil
        }
    }

    // Native menus require Image labels. Rasterize only the icons being displayed.
    @MainActor
    fileprivate var menuImage: Image {
        if let assetName { return Image(assetName).renderingMode(.template) }
        if let image = Self.menuImages[self] { return image }
        let image = Image(lucide: lucide, strokeWidth: 2).renderingMode(.template)
        Self.menuImages[self] = image
        return image
    }

    @MainActor private static var menuImages: [DuduGlyph: Image] = [:]

    /// How far the glyph's ink reaches in a 24pt box, line included: Lucide's corner arrow 18pt (16 of path and the 2pt line), its plus 16pt, the due date's asset 21pt (a 14pt ink in its 16pt box).
    fileprivate var inkIn24: CGFloat {
        switch self {
        case .dueDate: return 21
        case .plus: return 16
        default: return 18
        }
    }

    private struct MenuInkKey: Hashable {
        let glyph: DuduGlyph
        let ink: CGFloat
    }

    @MainActor private static var inkMenuImages: [MenuInkKey: Image] = [:]

    /// A menu icon whose ink is `ink` points across, whatever padding its glyph has in its own box. The three icons of the New issue's "…" menu were three sizes (the due date's asset 14pt, the arrow 18pt, a plus
    /// would be 16pt; owner, 2026-11-17: "这个三个图标大小不一的"). A native menu shows an image at the size it has, so the glyph is drawn at the size that gives this ink, with a 2pt line.
    @MainActor
    fileprivate func menuImage(ink: CGFloat) -> Image {
        let key = MenuInkKey(glyph: self, ink: ink)
        if let image = Self.inkMenuImages[key] { return image }
        let box = 24 * ink / inkIn24
        let renderer = ImageRenderer(content: DuduIcon(self, size: box, strokeWidth: 2, scalesStroke: false).foregroundStyle(Color.black))
        renderer.scale = max(UITraitCollection.current.displayScale, 2)
        guard let drawn = renderer.uiImage else { return menuImage }
        let image = Image(uiImage: drawn).renderingMode(.template)
        Self.inkMenuImages[key] = image
        return image
    }
}

struct DuduIcon: View {
    let glyph: DuduGlyph
    var size: CGFloat
    var strokeWidth: CGFloat
    /// Lucide's own scaling: `strokeWidth` is the line of a 24pt icon and it shrinks with the icon (a 20pt icon has 1.67pt, a 15pt one 1.25pt).
    var scalesStroke: Bool

    /// One line for every icon of the app, the proportion of Lucide's own, DSH's (a 1.3 line in a 16 box) and the plugin's: a small icon keeps a light line. The line used to be 2pt on every size, so the
    /// small icons (the quick buttons, the chevrons, the close marks) were bold next to the larger ones (owner, 2026-11-10: "感觉有粗有细，比如嘟嘟消息框上面的悬浮的按钮的图标就是粗的"). A call that names a
    /// `strokeWidth` and says nothing about scaling keeps that line as it is (the composer's plus, the check in a filled mark, the board's state marks); an icon larger than 24pt keeps 2pt rather than
    /// growing bolder.
    init(_ glyph: DuduGlyph, size: CGFloat = 24, strokeWidth: CGFloat? = nil, scalesStroke: Bool? = nil) {
        self.glyph = glyph
        self.size = size
        self.strokeWidth = strokeWidth ?? 2
        self.scalesStroke = scalesStroke ?? (strokeWidth == nil)
    }

    var body: some View {
        Group {
            if let assetName = glyph.assetName {
                Image(assetName)
                    .resizable()
                    .renderingMode(.template)
                    .frame(width: size, height: size)
            } else {
                LucideIcon(glyph.lucide, size: size, strokeWidth: strokeWidth, absoluteStrokeWidth: !(scalesStroke && size <= 24))
            }
        }
        .accessibilityHidden(true)
    }
}

struct DuduLabel: View {
    let title: String
    let image: Image

    init(_ title: String, icon: DuduGlyph) {
        self.title = title
        image = icon.menuImage
    }

    /// A menu item whose icon has the same ink as the others of its menu (`DuduGlyph.menuImage(ink:)`).
    init(_ title: String, icon: DuduGlyph, ink: CGFloat) {
        self.title = title
        image = icon.menuImage(ink: ink)
    }

    /// A menu item whose icon is not one of the app's glyphs (the pin, which is drawn by hand).
    init(_ title: String, image: Image) {
        self.title = title
        self.image = image.renderingMode(.template)
    }

    var body: some View {
        Label {
            Text(title)
        } icon: {
            image
        }
        .accessibilityLabel(title)
    }
}
