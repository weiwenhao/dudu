import UIKit

/// Writes down every tap and every press and hold on the app's windows, so that "I tapped and nothing happened for a while" can be read off the diagnostics
/// afterwards (owner, 2026-11-07: "user action 之类的日志"): next to the requests to the computer (`http.request.complete`) and the main thread's stalls
/// (`ui.main_thread_stall`, `UIResponsivenessMonitor`), `scripts/device-actions.mjs` says which tap was followed by a wait, and for what.
///
/// What is written: the kind (`user.tap`, `user.hold`), where on the screen (points) and how big the screen is, and a time. For a tap that time is how long the touch
/// waited for the main thread before the app saw it (`elapsedMs`: the system stamps a touch when the finger lands; a busy main thread takes it later); for a hold,
/// how long the finger stayed. Nothing that says what was tapped, what was typed or which conversation it was: the keyboard is another window, which is left alone.
///
/// The recorder is a gesture recognizer that never recognizes anything: it watches, leaves every touch to the views and delays none of them, and fails as soon as the
/// touch is over. It is put on the windows once (`install`, from the scene's becoming active).
@MainActor
final class UserActionRecorder {
    static let shared = UserActionRecorder()

    private let windows = NSHashTable<UIWindow>.weakObjects()

    private init() {}

    /// Puts the recorder on the app's ordinary windows, once each. The keyboard's and the system's own are above the normal level and have none.
    func install() {
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            for window in windowScene.windows where window.windowLevel == .normal && !windows.contains(window) {
                windows.add(window)
                window.addGestureRecognizer(TouchRecorder())
            }
        }
    }
}

private final class TouchRecorder: UIGestureRecognizer {
    private struct Beginning {
        let time: TimeInterval
        let point: CGPoint
        /// How long after the finger landed the app saw it, in milliseconds.
        let latency: Double
    }

    private var beginning: Beginning?
    private var travel: CGFloat = 0

    init() {
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        // One finger at a time: a second one is a pinch or a rotation, which is not an action.
        guard beginning == nil, event.allTouches?.count == 1, let touch = touches.first else {
            beginning = nil
            return
        }
        let latency = max(0, (ProcessInfo.processInfo.systemUptime - touch.timestamp) * 1_000)
        beginning = Beginning(time: touch.timestamp, point: touch.location(in: nil), latency: latency)
        travel = 0
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let beginning, let touch = touches.first else { return }
        let point = touch.location(in: nil)
        travel = max(travel, hypot(point.x - beginning.point.x, point.y - beginning.point.y))
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        defer {
            beginning = nil
            state = .failed
        }
        guard let beginning, let touch = touches.first else { return }
        let duration = touch.timestamp - beginning.time
        let size = view?.bounds.size ?? .zero // (the window's: the whole screen)
        let place: [String: Double] = [
            "tapX": beginning.point.x.rounded(), "tapY": beginning.point.y.rounded(),
            "screenWidth": size.width.rounded(), "screenHeight": size.height.rounded()
        ]
        switch TouchKind.of(travel: travel, duration: duration) {
        case .tap:
            DSBotLog.record("user.tap", elapsedMs: beginning.latency, geometry: place, state: beginning.latency >= 250 ? "late" : nil)
        case .hold:
            DSBotLog.record("user.hold", elapsedMs: duration * 1_000, geometry: place)
        case .drag:
            break
        }
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        beginning = nil
        state = .failed
    }

    override func reset() {
        beginning = nil
        travel = 0
    }

    // It only watches: it never keeps another recognizer from working, and no other keeps it from watching.
    override func canPrevent(_ preventedGestureRecognizer: UIGestureRecognizer) -> Bool { false }
    override func canBePrevented(by preventingGestureRecognizer: UIGestureRecognizer) -> Bool { false }
}
