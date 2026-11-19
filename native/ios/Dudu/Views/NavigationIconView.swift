import SwiftUI

/// Draws an icon the dudu plugin sent as geometry. `currentColor` takes the surrounding foreground
/// style, so the icon follows the same ink as the label next to it.
struct NavigationIconView: View {
    let icon: NavigationIcon
    var size: CGFloat = 20

    var body: some View {
        if let png = icon.png {
            RasterNavigationIcon(png: png, size: size)
        } else {
            shapes
        }
    }

    private var shapes: some View {
        Canvas { context, canvas in
            let box = icon.viewBox.map { CGFloat($0) }
            let scale = min(canvas.width / box[2], canvas.height / box[3])
            let base = CGAffineTransform(
                translationX: (canvas.width - box[2] * scale) / 2 - box[0] * scale,
                y: (canvas.height - box[3] * scale) / 2 - box[1] * scale
            ).scaledBy(x: scale, y: scale)
            for node in icon.nodes {
                Self.draw(node, in: context, base: base, scale: scale)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    private static func draw(_ node: NavigationIconNode, in context: GraphicsContext, base: CGAffineTransform, scale: CGFloat) {
        guard var path = shape(of: node) else { return }
        if let matrix = node.matrix, matrix.count == 6 {
            path = path.applying(CGAffineTransform(
                a: matrix[0], b: matrix[1], c: matrix[2], d: matrix[3], tx: matrix[4], ty: matrix[5]
            ))
        }
        path = path.applying(base)

        var layer = context
        if let opacity = node.opacity { layer.opacity = max(0, min(1, opacity)) }
        if let fill = shading(node.fill, fallback: "currentColor") {
            layer.fill(path, with: fill, style: FillStyle(eoFill: node.fillRule == "evenodd"))
        }
        if let stroke = shading(node.stroke, fallback: "none") {
            let style = StrokeStyle(
                lineWidth: (node.strokeWidth ?? 1) * scale,
                lineCap: cap(node.strokeLinecap),
                lineJoin: join(node.strokeLinejoin)
            )
            layer.stroke(path, with: stroke, style: style)
        }
    }

    private static func shape(of node: NavigationIconNode) -> Path? {
        switch node.tag {
        case "path":
            return node.d.map(SVGPathCache.path(from:))
        case "circle":
            guard let r = node.r else { return nil }
            return SVGPath.circle(cx: node.cx ?? 0, cy: node.cy ?? 0, r: r)
        case "ellipse":
            guard let rx = node.rx, let ry = node.ry else { return nil }
            return SVGPath.ellipse(cx: node.cx ?? 0, cy: node.cy ?? 0, rx: rx, ry: ry)
        case "rect":
            guard let width = node.width, let height = node.height else { return nil }
            return SVGPath.rect(x: node.x ?? 0, y: node.y ?? 0, width: width, height: height, rx: node.rx, ry: node.ry)
        case "line":
            return SVGPath.line(x1: node.x1 ?? 0, y1: node.y1 ?? 0, x2: node.x2 ?? 0, y2: node.y2 ?? 0)
        case "polyline":
            return node.points.map { SVGPath.poly(points: $0, closed: false) }
        case "polygon":
            return node.points.map { SVGPath.poly(points: $0, closed: true) }
        default:
            return nil
        }
    }

    private static func shading(_ paint: String?, fallback: String) -> GraphicsContext.Shading? {
        switch paint ?? fallback {
        case "none": return nil
        case "currentColor": return .foreground
        case let value: return NavigationColor.parse(value).map { .color($0) }
        }
    }

    private static func cap(_ value: String?) -> CGLineCap {
        switch value {
        case "round": return .round
        case "square": return .square
        default: return .butt
        }
    }

    private static func join(_ value: String?) -> CGLineJoin {
        switch value {
        case "round": return .round
        case "bevel": return .bevel
        default: return .miter
        }
    }
}

/// An icon DSH's browser drew itself. Only the picture's shape counts: as a template image it takes the
/// surrounding foreground style, so it is the same ink as every icon drawn from shapes.
private struct RasterNavigationIcon: View {
    let png: Data
    let size: CGFloat

    var body: some View {
        Group {
            if let image = NavigationRasterCache.image(for: png) {
                Image(uiImage: image)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
            } else {
                Color.clear
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/// A navigation list has a few of these pictures at most; decoding each once is enough.
enum NavigationRasterCache {
    private static let cache: NSCache<NSData, UIImage> = {
        let cache = NSCache<NSData, UIImage>()
        cache.countLimit = 32
        return cache
    }()

    static func image(for data: Data) -> UIImage? {
        let key = data as NSData
        if let hit = cache.object(forKey: key) { return hit }
        guard let image = UIImage(data: data, scale: 3) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }
}

/// The icons of one session of the app use a handful of paths; parsing each once is enough.
enum SVGPathCache {
    private final class Box { let path: Path; init(_ path: Path) { self.path = path } }
    private static let cache: NSCache<NSString, Box> = {
        let cache = NSCache<NSString, Box>()
        cache.countLimit = 256
        return cache
    }()

    static func path(from data: String) -> Path {
        let key = data as NSString
        if let hit = cache.object(forKey: key) { return hit.path }
        let path = SVGPath.path(from: data)
        cache.setObject(Box(path), forKey: key)
        return path
    }
}

enum NavigationColor {
    /// `#rgb`, `#rrggbb` or `#rrggbbaa`.
    static func parse(_ value: String) -> Color? {
        guard value.first == "#" else { return nil }
        let hex = value.dropFirst()
        guard hex.allSatisfy(\.isHexDigit) else { return nil }
        func channel(_ text: Substring) -> Double { Double(Int(text, radix: 16) ?? 0) / 255 }
        switch hex.count {
        case 3:
            let digits = hex.map { String(repeating: $0, count: 2) }
            return Color(red: channel(Substring(digits[0])), green: channel(Substring(digits[1])), blue: channel(Substring(digits[2])))
        case 6, 8:
            let start = hex.startIndex
            func part(_ offset: Int) -> Substring {
                hex[hex.index(start, offsetBy: offset)..<hex.index(start, offsetBy: offset + 2)]
            }
            return Color(
                red: channel(part(0)), green: channel(part(2)), blue: channel(part(4)),
                opacity: hex.count == 8 ? channel(part(6)) : 1
            )
        default:
            return nil
        }
    }
}
