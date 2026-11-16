import SwiftUI
import UIKit

enum DSBotLayout {
    static let toolbarButtonSize: CGFloat = 44
    static let toolbarHorizontalPadding: CGFloat = 20
    static let toolbarHeight: CGFloat = toolbarButtonSize
    static let sidebarPadding: CGFloat = 16
    static let actionColumnWidth: CGFloat = 44
    static let drawerCornerRadius: CGFloat = 45
    static let edgeSwipeWidth: CGFloat = 24

    static let composerHeight: CGFloat = 44
    static let composerCornerRadius: CGFloat = 28
    static let conversationSideMargin: CGFloat = 24
    static let userMessageSideMargin: CGFloat = 20
    static let composerSideMargin: CGFloat = conversationSideMargin
    /// Distance from the composer to the bottom edge of the screen (the conversation runs to that edge, under
    /// the home indicator).
    static let composerBottomMargin: CGFloat = 24
    /// Distance from the composer to the keyboard.
    static let composerKeyboardGap: CGFloat = 8

    /// Home-indicator inset of the key window; unlike SwiftUI's safe area it ignores the keyboard.
    @MainActor
    static var windowSafeAreaBottom: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .safeAreaInsets.bottom ?? 0
    }

    /// Height of the screen the app is on, to tell where the keyboard starts.
    @MainActor
    static var screenHeight: CGFloat {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first?.screen.bounds.height ?? 0
    }

    static func drawerWidth(in availableWidth: CGFloat) -> CGFloat {
        min(availableWidth * 0.79, 360)
    }
}

private struct ConversationIsCoveredKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// A page (DSH's or the app's own) is open over the conversation, which stays mounted underneath without
    /// being seen: whatever animates in it can stop.
    var conversationIsCovered: Bool {
        get { self[ConversationIsCoveredKey.self] }
        set { self[ConversationIsCoveredKey.self] = newValue }
    }
}

private struct HomeIndicatorInsetKey: EnvironmentKey {
    static let defaultValue: CGFloat = 0
}

extension EnvironmentValues {
    /// The inset of the home indicator at the bottom of the screen, 0 on a phone without one.
    var homeIndicatorInset: CGFloat {
        get { self[HomeIndicatorInsetKey.self] }
        set { self[HomeIndicatorInsetKey.self] = newValue }
    }
}

enum DSBotStyle {
    static let blue = Color(red: 65.0 / 255, green: 118.0 / 255, blue: 230.0 / 255)
    static let composerAction = Color(red: 184.0 / 255, green: 219.0 / 255, blue: 253.0 / 255)
    static let ink = Color(red: 23.0 / 255, green: 24.0 / 255, blue: 27.0 / 255)
    static let muted = Color(red: 150.0 / 255, green: 152.0 / 255, blue: 157.0 / 255)
    static let line = Color(red: 237.0 / 255, green: 237.0 / 255, blue: 240.0 / 255)
    static let sheet = Color(red: 247.0 / 255, green: 247.0 / 255, blue: 248.0 / 255)
    static let canvas = Color(red: 250.0 / 255, green: 250.0 / 255, blue: 250.0 / 255)
    static let selected = Color(red: 234.0 / 255, green: 234.0 / 255, blue: 237.0 / 255)
    static let settingsBackground = Color(uiColor: .systemGroupedBackground)

    // Chat palette taken from DSH's own light theme (neutral-bluish scale and the bubble tint).
    static let chatInk = Color(red: 0x0f / 255, green: 0x11 / 255, blue: 0x15 / 255)
    static let chatSecondary = Color(red: 0x61 / 255, green: 0x66 / 255, blue: 0x6b / 255)
    static let chatTertiary = Color(red: 0x81 / 255, green: 0x85 / 255, blue: 0x8c / 255)
    static let chatCaption = Color(red: 0xad / 255, green: 0xb2 / 255, blue: 0xb8 / 255)
    static let chatBubble = Color(red: 0xed / 255, green: 0xf2 / 255, blue: 0xfe / 255)
    static let chatPanel = Color(red: 0xf9 / 255, green: 0xfa / 255, blue: 0xfb / 255)
    static let chatBorder = Color.black.opacity(0.04)
    static let chatDivider = Color.black.opacity(0.10)
    static let chatRunning = Color(red: 0x3a / 255, green: 0x62 / 255, blue: 0xd6 / 255)
    static let chatWarning = Color(red: 0xf5 / 255, green: 0x9e / 255, blue: 0x0b / 255)
    static let chatError = Color(red: 0xec / 255, green: 0x13 / 255, blue: 0x13 / 255)
}

/// One continuous backing across the status bar and title, fading only below the controls.
struct DSBotToolbarTitleBackdrop: View {
    let safeAreaTop: CGFloat

    var body: some View {
        Rectangle()
            .fill(.regularMaterial)
            .opacity(0.85)
            .mask {
                VStack(spacing: 0) {
                    Rectangle()
                    LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                        .frame(height: 20)
                }
            }
            .padding(.top, -safeAreaTop)
            .padding(.bottom, -12)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Bound the system material to the composer and its bottom gap, with the fade inside that area.
struct DSBotComposerBackdrop: View {
    let bottomGap: CGFloat

    var body: some View {
        Rectangle()
            .fill(.regularMaterial)
            .mask {
                LinearGradient(stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .black, location: 0.7),
                    .init(color: .black, location: 1)
                ], startPoint: .top, endPoint: .bottom)
            }
            .clipped()
            .padding(.horizontal, -DSBotLayout.composerSideMargin)
            .padding(.bottom, -bottomGap)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Fallback backing for floating controls; iOS 26 supplies this through the scroll edge.
struct DSBotPanelBackdrop: View {
    var horizontalExtension: CGFloat = DSBotLayout.composerSideMargin
    var topExtension: CGFloat = 0
    var bottomExtension: CGFloat = 8
    var tintOpacity: Double = 0.35

    @ViewBuilder
    var body: some View {
        if !DSBotScrollEdges.usesSystemEffect {
            Rectangle()
                .fill(.regularMaterial)
                .overlay(DSBotStyle.canvas.opacity(tintOpacity))
                .mask {
                    VStack(spacing: 0) {
                        LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom)
                            .frame(height: 16)
                        Rectangle()
                    }
                }
                .padding(.horizontal, -horizontalExtension)
                .padding(.top, -topExtension)
                .padding(.bottom, -bottomExtension)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

extension View {
    func dsbotGlass<S: Shape>(in shape: S, interactive: Bool = false) -> some View {
        modifier(DSBotGlassSurface(shape: shape, interactive: interactive))
    }
}

private struct DSBotGlassSurface<S: Shape>: ViewModifier {
    let shape: S
    let interactive: Bool
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(DSBotStyle.canvas, in: shape)
                .overlay(shape.stroke(DSBotStyle.line, lineWidth: 0.75))
        } else if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular.interactive(interactive), in: shape)
                .overlay(shape.stroke(DSBotStyle.ink.opacity(0.08), lineWidth: 0.5).allowsHitTesting(false))
        } else {
            content
                .background(.ultraThinMaterial, in: shape)
                .overlay(shape.stroke(.white.opacity(0.8), lineWidth: 0.75))
        }
    }
}

struct DSBotGlassGroup<Content: View>: View {
    var spacing: CGFloat = 12
    @ViewBuilder var content: () -> Content

    @ViewBuilder
    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing, content: content)
        } else {
            content()
        }
    }
}

struct DSBotGlassButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .dsbotGlass(in: Circle(), interactive: true)
    }
}

struct DSBotGlassCapsuleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .dsbotGlass(in: Capsule(), interactive: true)
    }
}

struct DSBotIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.55 : 1)
    }
}

/// Press feedback without a box: the label just dims. Used where a grey highlight would look like
/// a stray frame around part of a row.
struct DSBotQuietPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.5 : 1)
    }
}

struct DSBotRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(
            Color.primary.opacity(configuration.isPressed ? 0.06 : 0),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
    }
}
