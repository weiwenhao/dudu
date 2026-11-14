import SwiftUI

/// Where the finger is while it holds the talk bar, measured in the chat's coordinates.
@MainActor
final class VoiceTouch: ObservableObject {
    @Published var location: CGPoint?
}

@MainActor
final class VoicePressState: ObservableObject {
    @Published var isActive = false
    @Published var isCancelling = false
    let touch = VoiceTouch()
    var sessionID: String?
    var computerID: String?
    var startedAt: TimeInterval?
    var timeoutTask: Task<Void, Never>?
}

struct VoiceCaptureLayer: View {
    @ObservedObject var capture: NativeSpeechCapture
    @ObservedObject var press: VoicePressState
    let isVoiceMode: Bool

    private var isVisible: Bool { press.isActive || capture.isFinishing }

    var body: some View {
        let visible = isVisible
        let transcript = capture.transcript
        let cancelling = press.isCancelling
        let finishing = capture.isFinishing
        GeometryReader { geometry in
            if isVoiceMode || visible {
                let height = min(geometry.size.height * 0.40, 320)
                VoiceCaptureOverlay(
                    transcript: transcript, meter: capture.meter, touch: press.touch,
                    touchOriginY: geometry.frame(in: .global).maxY - height,
                    isCancelling: cancelling, isFinishing: finishing,
                    isActive: visible
                )
                .frame(height: height)
                .background {
                    Rectangle()
                        .fill(.thickMaterial)
                        .mask {
                            LinearGradient(
                                stops: [
                                    .init(color: .clear, location: 0),
                                    .init(color: .black, location: 0.34)
                                ],
                                startPoint: .top, endPoint: .bottom
                            )
                        }
                        .accessibilityHidden(true)
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
                .opacity(visible ? 1 : 0.001)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(!visible)
        .onChange(of: visible) { _, visible in
            DSBotLog.record("voice.overlay.visibility", state: visible ? "visible" : "hidden")
            if visible, let startedAt = press.startedAt {
                DSBotLog.record("voice.overlay.ready", elapsedMs: (ProcessInfo.processInfo.systemUptime - startedAt) * 1_000)
            }
        }
        .onChange(of: capture.isRecording) { _, recording in
            if !recording && !capture.isFinishing { press.isActive = false }
        }
    }
}

struct VoiceComposerVisibility: ViewModifier {
    @ObservedObject var capture: NativeSpeechCapture
    @ObservedObject var press: VoicePressState

    func body(content: Content) -> some View {
        content.opacity(press.isActive || capture.isFinishing ? 0 : 1)
    }
}

/// Full-width glow that replaces the composer while the hold-to-talk bar is pressed: a blue (or,
/// when the finger has moved up to cancel, red) wash that rises from the bottom edge, a hint, and
/// a level meter. A soft spot of light follows the finger and breathes while it is held down.
struct VoiceCaptureOverlay: View {
    let transcript: String
    @ObservedObject var meter: SpeechAudioMeter
    /// Held, not observed: only the light under the finger follows it (`VoiceFingerGlow`), so the rest of the
    /// overlay is not rebuilt with every touch event.
    let touch: VoiceTouch
    /// The overlay's top edge in the chat's coordinates, to turn the finger's position into its own.
    let touchOriginY: CGFloat
    let isCancelling: Bool
    let isFinishing: Bool
    /// False while it waits, drawn and invisible, for a press: nothing breathes or redraws then.
    let isActive: Bool

    /// Vertical anchors, measured from the screen's bottom edge (the overlay is laid out to it).
    private enum Anchor {
        static let waveformCenter: CGFloat = 90
        static let hintCenter: CGFloat = 160
        static let waveformHeight: CGFloat = 32
        static let hintLineHeight: CGFloat = 16
    }

    private var ink: Color { isCancelling ? Color(red: 0.925, green: 0.243, blue: 0.259) : .white }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .bottom) {
                LinearGradient(
                    colors: isCancelling
                        ? [Color(hex: 0xffe2e4), Color(hex: 0xffdee0), Color(hex: 0xffdadb), Color(hex: 0xffdee0), Color(hex: 0xffe2e4)]
                        : [Color(hex: 0x37b1fe), Color(hex: 0x239bf9), Color(hex: 0x1380f5), Color(hex: 0x239bf9), Color(hex: 0x37b1fe)],
                    startPoint: .leading, endPoint: .trailing
                )
                .mask {
                    ZStack {
                        LinearGradient(
                            stops: [
                                .init(color: .clear, location: 0.25),
                                .init(color: .black.opacity(0.02), location: 0.4),
                                .init(color: .black.opacity(0.12), location: 0.56),
                                .init(color: .black.opacity(0.58), location: 0.8),
                                .init(color: .black, location: 1)
                            ],
                            startPoint: .top, endPoint: .bottom
                        )
                        Ellipse()
                            .fill(.black)
                            .frame(width: geometry.size.width * 1.3, height: geometry.size.height * 2.2)
                            .blur(radius: 56)
                            .offset(y: geometry.size.height * 0.85)
                    }
                }

                VoiceFingerGlow(
                    touch: touch, touchOriginY: touchOriginY, size: geometry.size,
                    isCancelling: isCancelling, isActive: isActive
                )

                VStack(spacing: 0) {
                    if !transcript.isEmpty {
                        Text(transcript)
                            .font(.system(size: 19, weight: .medium))
                            .lineSpacing(7)
                            .lineLimit(2)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 28)
                            .padding(.bottom, 20)
                    }
                    Text(isCancelling ? L10n.text("松手取消") : (isFinishing ? L10n.text("正在识别…") : L10n.text("松手发送，上移取消")))
                        .font(.system(size: 13, weight: .medium))
                        .frame(height: Anchor.hintLineHeight)
                        .opacity(isCancelling ? 1 : 0.78)
                        .padding(.bottom, Anchor.hintCenter - Anchor.hintLineHeight / 2
                            - (Anchor.waveformCenter + Anchor.waveformHeight / 2))
                    waveform
                        .frame(width: min(geometry.size.width * 0.72, 300), height: Anchor.waveformHeight)
                        .opacity(isFinishing ? 0.65 : 1)
                }
                .foregroundStyle(ink)
                .padding(.bottom, Anchor.waveformCenter - Anchor.waveformHeight / 2)
            }
            .clipped()
            .mask {
                LinearGradient(
                    stops: [
                        .init(color: .clear, location: 0),
                        .init(color: .clear, location: 0.1),
                        .init(color: .black.opacity(0.55), location: 0.3),
                        .init(color: .black, location: 0.48)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .contain)
        .accessibilityHidden(!isActive)
        .accessibilityIdentifier(isActive ? (isCancelling ? "voice.overlay.cancel" : "voice.overlay.recording") : "voice.overlay.inactive")
    }

    private static let barCount = 54

    private var waveform: some View {
        HStack(spacing: 2) {
            ForEach(0..<Self.barCount, id: \.self) { index in
                let position = Double(index) / Double(Self.barCount - 1)
                let taper = sin(.pi * position)
                let variation = 0.45 + 0.55 * abs(sin(Double(index) * 1.71))
                Capsule()
                    .frame(width: 3, height: 6.4 + 21 * meter.level * taper * variation)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .mask {
            LinearGradient(
                stops: [
                    .init(color: .clear, location: 0),
                    .init(color: .black, location: 0.12),
                    .init(color: .black, location: 0.88),
                    .init(color: .clear, location: 1)
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        }
        .animation(.linear(duration: 0.09), value: meter.level)
    }
}

private extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
    }
}

/// The light under the finger: follows it with a soft spring and breathes slowly. It is the only part of the
/// overlay that listens to the finger, which moves with every touch event.
private struct VoiceFingerGlow: View {
    @ObservedObject var touch: VoiceTouch
    let touchOriginY: CGFloat
    let size: CGSize
    let isCancelling: Bool
    let isActive: Bool

    private var point: CGPoint {
        touch.location.map { CGPoint(x: $0.x, y: $0.y - touchOriginY) }
            ?? CGPoint(x: size.width / 2, y: size.height * 0.9)
    }

    var body: some View {
        let point = point
        TimelineView(.animation(minimumInterval: 1.0 / 30, paused: !isActive)) { timeline in
            let phase = timeline.date.timeIntervalSinceReferenceDate
            let pulse = 1 + 0.07 * sin(phase * 2.6)
            RadialGradient(
                colors: isCancelling
                    ? [Color(hex: 0xfa7779).opacity(0.29), Color(hex: 0xff9c9e).opacity(0.09), .clear]
                    : [Color(hex: 0x0061ff).opacity(0.4), Color(hex: 0x006bff).opacity(0.15), .clear],
                center: UnitPoint(x: point.x / max(1, size.width), y: point.y / max(1, size.height)),
                startRadius: 0, endRadius: 145 * pulse
            )
        }
        .animation(.interactiveSpring(response: 0.22, dampingFraction: 0.86), value: point)
    }
}
