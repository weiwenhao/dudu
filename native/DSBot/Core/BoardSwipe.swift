import Foundation

/// A return drag closes an already exposed action strip by intent, rather than requiring
/// the person to pull almost its entire width back under the row.
enum BoardSwipe {
    static func destination(start: CGFloat, offset: CGFloat, velocity: CGFloat, actionWidth: CGFloat) -> CGFloat {
        let travel = offset - start
        if start < 0, travel > 18 || (travel > 4 && velocity > 180) { return 0 }
        if start > 0, travel < -18 || (travel < -4 && velocity < -180) { return 0 }
        if offset > actionWidth / 2 { return actionWidth }
        if offset < -55 { return -actionWidth * 2 }
        return 0
    }
}
