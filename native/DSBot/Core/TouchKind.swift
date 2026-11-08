import CoreGraphics
import Foundation

/// What a finger did, from how far it moved and how long it stayed (pure: the recorder of taps in `UserActionRecorder.swift` asks it, and so does a check on its own).
enum TouchKind: Equatable {
    /// Down and up in the same place, quickly.
    case tap
    /// Down and up in the same place, after a pause: a press and hold.
    case hold
    /// Moved: a scroll, a swipe, a drag. Not recorded.
    case drag

    /// A finger that moves this far (points) is dragging.
    static let dragTravel: CGFloat = 16
    /// A finger that stays this long (seconds) in one place is holding.
    static let holdDuration: TimeInterval = 0.45

    static func of(travel: CGFloat, duration: TimeInterval) -> TouchKind {
        if travel >= dragTravel { return .drag }
        return duration >= holdDuration ? .hold : .tap
    }
}
