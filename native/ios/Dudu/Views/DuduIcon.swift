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
    case pin, unpin, rename, issueDetails
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
    /// The long-press menus of the settings pages (the desktop's menus: ArrowUp / ArrowDown to move a status, Unplug for a connector, KeyRound to authorize one).
    case moveUp, moveDown, unplug, keyRound
    /// The seven pages of 嘟嘟's settings (the desktop settings window's own icons: Cog, CircleDashed, Plug, Rss, Split, Brain, Sparkles), fixed in the app (owner, 2026-11-21).
    case settingsGeneral, settingsStatuses, settingsConnectors, settingsCollectors, settingsRules, settingsMemory, settingsSkills

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
        case .selectRows: return .squareCheckBig
        case .forward: return .forward
        case .restore: return .rotateCcw
        case .openLink: return .externalLink
        case .selectAll: return .checkCheck
        case .issueProject: return .box
        case .issueLabel: return .tag
        case .dueDate: return .calendar
        case .issueStatus: return .circleDot
        case .issuePriority: return .signal
        case .pin: return .arrowUpToLine
        case .unpin: return .arrowDownFromLine
        case .rename: return .pencil
        case .issueDetails: return .squareArrowOutUpRight
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
        case .moveUp: return .arrowUp
        case .moveDown: return .arrowDown
        case .unplug: return .unplug
        case .keyRound: return .keyRound
        case .settingsGeneral: return .cog
        case .settingsStatuses: return .circleDashed
        case .settingsConnectors: return .plug
        case .settingsCollectors: return .rss
        case .settingsRules: return .split
        case .settingsMemory: return .brain
        case .settingsSkills: return .sparkles
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
        let image = Image(lucide: lucide, strokeWidth: self == .pin || self == .unpin ? 1.8 : 2).renderingMode(.template)
        Self.menuImages[self] = image
        return image
    }

    @MainActor private static var menuImages: [DuduGlyph: Image] = [:]

    /// The trash can of a menu, drawn red: a native menu draws a template icon in the plain ink whatever its button's role, and the owner wants every delete icon red, the red
    /// a destructive title has (2026-11-21: "删除图标应该要有红色，和删除任务的红色保持颜色一致").
    @MainActor
    fileprivate var destructiveMenuImage: Image {
        let key = MenuInkKey(glyph: self, ink: -1)
        if let image = Self.inkMenuImages[key] { return image }
        let renderer = ImageRenderer(content: DuduIcon(self, size: 24, strokeWidth: 2, scalesStroke: false).foregroundStyle(Color(uiColor: .systemRed)))
        renderer.scale = max(UITraitCollection.current.displayScale, 2)
        guard let drawn = renderer.uiImage else { return menuImage }
        let image = Image(uiImage: drawn).renderingMode(.original)
        Self.inkMenuImages[key] = image
        return image
    }

    /// The same red menu icon at the box that gives it this ink (the inbox's set: the trash can at the visual size of the others).
    @MainActor
    fileprivate func destructiveMenuImage(ink: CGFloat) -> Image {
        let key = MenuInkKey(glyph: self, ink: -ink)
        if let image = Self.inkMenuImages[key] { return image }
        let box = 24 * ink / inkIn24
        let renderer = ImageRenderer(content: DuduIcon(self, size: box, strokeWidth: 2, scalesStroke: false).foregroundStyle(Color(uiColor: .systemRed)))
        renderer.scale = max(UITraitCollection.current.displayScale, 2)
        guard let drawn = renderer.uiImage else { return menuImage }
        let image = Image(uiImage: drawn).renderingMode(.original)
        Self.inkMenuImages[key] = image
        return image
    }

    /// How far the glyph's ink reaches in a 24pt box, line included (visual size for the inbox's actions, below): Lucide's corner arrow 18pt (16 of path and the 2pt line), its plus 16pt, the due date's asset 21pt (a 14pt ink in its 16pt box).
    fileprivate var inkIn24: CGFloat {
        switch self {
        case .dueDate: return 21
        case .plus: return 16
        // The inbox's actions, drawn as one set (owner, 2026-11-21: "一堆图标感觉大小不一，尤其是补全上下文"): here the side of the square that has the area of the glyph's ink box, measured from Lucide's
        // drawing (`.local/designs/inbox-menu-icons-2026-11-21/measure.mjs`): the checkbox 21 x 20, the arrow and the check 18 x 13, the refresh and the rotate and the external link 20 x 20, the trash can 20 x 22.
        case .selectRows: return 20.5
        case .forward, .check, .reply: return 15.3
        case .copy: return 22
        case .completeContext, .restore, .openLink: return 20
        case .trash: return 21
        default: return 18
        }
    }

    /// The glyphs of the inbox's actions: each is drawn at the box that gives it the same visual size as the others (17pt in a 24pt place), wherever the inbox shows them.
    fileprivate var isInboxAction: Bool {
        switch self {
        case .selectRows, .forward, .plus, .completeContext, .check, .restore, .trash, .openLink: return true
        default: return false
        }
    }

    /// The box that draws this glyph in a `slot`-pt icon place (a bar's 22, a swipe block's 22): the slot for any glyph that is not one of the inbox's actions.
    func inboxBox(slot: CGFloat) -> CGFloat { isInboxAction ? slot * 17 / inkIn24 : slot }

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

/// A glyph of the inbox's set in a `slot`-pt icon place (the bars' and the swipe blocks' 22): at the box that gives the set one visual size, with the line of an icon of that slot for all of them.
struct DuduInboxIcon: View {
    let glyph: DuduGlyph
    var slot: CGFloat = 22

    var body: some View {
        DuduIcon(glyph, size: glyph.inboxBox(slot: slot), strokeWidth: slot / 12, scalesStroke: false)
            .frame(width: slot, height: slot)
    }
}

struct DuduLabel: View {
    let title: String
    let image: Image

    init(_ title: String, icon: DuduGlyph) {
        self.title = title
        image = icon == .dueDate ? icon.menuImage(ink: 21) : icon == .trash ? icon.destructiveMenuImage : icon.menuImage
    }

    /// A menu item of the inbox's set: the icon of every action at the same visual size (17pt), the delete red; a glyph that is not one of them is drawn as in any other menu.
    init(inbox title: String, icon: DuduGlyph, destructive: Bool = false) {
        self.title = title
        if icon.isInboxAction {
            image = destructive || icon == .trash ? icon.destructiveMenuImage(ink: 17) : icon.menuImage(ink: 17)
        } else {
            image = destructive || icon == .trash ? icon.destructiveMenuImage : icon.menuImage
        }
    }

    /// A menu item of a message's long-press menu (复制, 选择, 回复, 删除): the icons at one visual size (17pt, the inbox's set) and one line, the delete red. They were a Lucide icon drawn full size and an SF Symbol,
    /// 21.8pt with a 2.2pt line next to 13.8pt with a 1.3pt one (owner, 2026-11-21: "这个按钮有大有小，有粗有细，你发现了吗？").
    init(message title: String, icon: DuduGlyph) {
        self.title = title
        image = icon == .trash ? icon.destructiveMenuImage(ink: 17) : icon.menuImage(ink: 17)
    }

    /// A menu item that deletes or ends something: its icon is red as its title is, for any glyph (the trash can is always red; the unplug of a connector is too).
    init(_ title: String, icon: DuduGlyph, destructive: Bool) {
        self.title = title
        image = destructive ? icon.destructiveMenuImage : icon.menuImage
    }

    /// A menu item whose icon has the same ink as the others of its menu (`DuduGlyph.menuImage(ink:)`).
    init(_ title: String, icon: DuduGlyph, ink: CGFloat) {
        self.title = title
        image = icon.menuImage(ink: ink)
    }

    init(_ title: String, image: Image, renderingMode: Image.TemplateRenderingMode = .template) {
        self.title = title
        self.image = image.renderingMode(renderingMode)
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
