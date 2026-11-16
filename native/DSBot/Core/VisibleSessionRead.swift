import Foundation

/// Feedback for the exact content an uncovered history has already displayed. This is
/// presentation feedback only; the computer remains the durable read-receipt authority.
struct VisibleSessionRead {
    enum Phase { case pending, saved, failed }
    let id: UUID
    let target: DraftTarget
    let connection: Int
    let seq: Int
    var phase: Phase
}

/// Current-watch activity is separate from reading: a working/idle transition updates
/// an avatar immediately but must never itself submit an acknowledgement.
struct WatchedSessionActivity {
    let target: DraftTarget
    let connection: Int
    let seq: Int
    let state: SessionActivityState
    let asleep: Bool
}
