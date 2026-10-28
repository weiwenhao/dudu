import CoreGraphics

enum KeyboardAvoidance {
    static func isVisible(endFrameMinY: CGFloat, screenHeight: CGFloat) -> Bool {
        screenHeight > 0 && endFrameMinY < screenHeight - 1
    }
}
