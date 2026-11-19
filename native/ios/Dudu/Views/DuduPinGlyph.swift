import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

/// The push pin of a conversation's 置顶 and of a pinned row: a pin tilted 45° with its needle toward the lower
/// left. Traced from the reference menu (the mark is 15 units across in a 20-unit box, drawn with a 1.4
/// stroke like the checklist beside it), because the icon sets the app uses only have an upright pin.
struct DuduPinGlyph: View {
    var size: CGFloat = 20
    var strokeWidth: CGFloat = 1.4

    /// The outline, clockwise from the left end of the collar, in the 20-unit box.
    private static let outline = [
        CGPoint(x: 3.320, y: 8.840), CGPoint(x: 11.066, y: 16.787), CGPoint(x: 11.888, y: 15.949),
        CGPoint(x: 12.794, y: 12.980), CGPoint(x: 17.545, y: 8.796), CGPoint(x: 11.475, y: 2.568),
        CGPoint(x: 7.170, y: 7.211), CGPoint(x: 4.179, y: 8.040),
    ]
    /// The needle tapers from the collar to a point.
    private static let needle = [
        CGPoint(x: 5.843, y: 14.716), CGPoint(x: 2.560, y: 17.539), CGPoint(x: 2.351, y: 17.324),
        CGPoint(x: 5.257, y: 14.115),
    ]

    var body: some View {
        Canvas { context, canvas in
            let k = canvas.width / 20
            let scaled: ([CGPoint]) -> Path = { points in
                var path = Path()
                path.addLines(points.map { CGPoint(x: $0.x * k, y: $0.y * k) })
                path.closeSubpath()
                return path
            }
            context.stroke(
                scaled(Self.outline), with: .foreground,
                style: StrokeStyle(lineWidth: strokeWidth * k, lineCap: .round, lineJoin: .round)
            )
            context.fill(scaled(Self.needle), with: .foreground)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

#if canImport(UIKit)
extension DuduPinGlyph {
    /// The glyph as the template image a menu item takes, the size of the other menu icons (24 points).
    @MainActor
    static var menuImage: Image {
        if let menuImageCache { return menuImageCache }
        let renderer = ImageRenderer(content: DuduPinGlyph(size: 24).foregroundStyle(.black))
        renderer.scale = 3
        let image = renderer.uiImage.map { Image(uiImage: $0.withRenderingMode(.alwaysTemplate)) }
            ?? Image(systemName: "pin")
        menuImageCache = image
        return image
    }

    @MainActor private static var menuImageCache: Image?
}
#endif
