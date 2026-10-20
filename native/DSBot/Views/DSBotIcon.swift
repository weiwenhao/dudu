import LucideSwift
import SwiftUI

enum DSBotGlyph: CaseIterable {
    case menu, panel, camera, image, keyboard, microphone, voice
    case plus, add, compose, close, remove, check, settings
    case plugins, skills, schedule, computer, account, options
    case message, trace, context, team
    case down, up, right, select, reconnect, permission, model
    case scan, focus, stop, send, terminal, open, search, folder, file, back, copy
    case goal, plan, compact, attach
    case think, browse, code, globe, question, pause, play, trash, editLine, mode, sliders
    case archive, archiveRestore

    var lucide: LucideIconName {
        switch self {
        case .menu: return .menu
        case .panel: return .panelRight
        case .camera: return .camera
        case .image: return .image
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
        case .file: return .file
        case .back: return .chevronLeft
        case .copy: return .copy
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
        }
    }

    // Native menus require Image labels. Rasterize only the icons being displayed.
    @MainActor
    fileprivate var menuImage: Image {
        if let image = Self.menuImages[self] { return image }
        let image = Image(lucide: lucide, strokeWidth: 2)
        Self.menuImages[self] = image
        return image
    }

    @MainActor private static var menuImages: [DSBotGlyph: Image] = [:]
}

struct DSBotIcon: View {
    let glyph: DSBotGlyph
    var size: CGFloat
    var strokeWidth: CGFloat
    /// Lucide's own scaling: `strokeWidth` is the line of a 24pt icon and it shrinks with the icon, so a small
    /// icon keeps a light line (the transcript's, as in DSH). By default the line is the same on every size.
    var scalesStroke: Bool

    init(_ glyph: DSBotGlyph, size: CGFloat = 24, strokeWidth: CGFloat = 2, scalesStroke: Bool = false) {
        self.glyph = glyph
        self.size = size
        self.strokeWidth = strokeWidth
        self.scalesStroke = scalesStroke
    }

    var body: some View {
        LucideIcon(glyph.lucide, size: size, strokeWidth: strokeWidth, absoluteStrokeWidth: !scalesStroke)
            .accessibilityHidden(true)
    }
}

struct DSBotLabel: View {
    let title: String
    let image: Image

    init(_ title: String, icon: DSBotGlyph) {
        self.title = title
        image = icon.menuImage
    }

    /// A menu item whose icon is not one of the app's glyphs (the pin, which is drawn by hand).
    init(_ title: String, image: Image) {
        self.title = title
        self.image = image
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
