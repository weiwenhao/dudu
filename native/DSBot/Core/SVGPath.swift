import CoreGraphics
import Foundation
import SwiftUI

/// SVG path data (the `d` attribute) and the basic shapes, as SwiftUI paths.
///
/// DSH's icons arrive from the desktop as plain geometry, so this is the whole "SVG renderer" the app
/// needs: every command (absolute and relative), implicit repeats, compact numbers such as `1.5.5` or
/// `-1-2`, and elliptical arcs. Malformed data keeps whatever was drawn before the error.
enum SVGPath {
    static func path(from data: String) -> Path {
        var reader = Reader(Array(data.utf8))
        var path = Path()
        var current = CGPoint.zero
        var subpathStart = CGPoint.zero
        var cubicControl: CGPoint?
        var quadraticControl: CGPoint?
        var command: UInt8?

        parsing: while true {
            reader.skipSeparators()
            if reader.atEnd { break }
            if let letter = reader.peekLetter() {
                command = letter
                reader.advance()
                if letter == UInt8(ascii: "Z") || letter == UInt8(ascii: "z") {
                    path.closeSubpath()
                    current = subpathStart
                    cubicControl = nil
                    quadraticControl = nil
                    continue
                }
            }
            guard let active = command else { break }
            let relative = active >= UInt8(ascii: "a")
            let origin = relative ? current : .zero
            let upper = relative ? active - 32 : active

            func point(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: origin.x + x, y: origin.y + y) }

            switch upper {
            case UInt8(ascii: "M"):
                guard let x = reader.number(), let y = reader.number() else { break parsing }
                current = point(x, y)
                subpathStart = current
                path.move(to: current)
                // Further pairs after a moveto are implicit linetos.
                command = relative ? UInt8(ascii: "l") : UInt8(ascii: "L")
                cubicControl = nil
                quadraticControl = nil
            case UInt8(ascii: "L"):
                guard let x = reader.number(), let y = reader.number() else { break parsing }
                current = point(x, y)
                path.addLine(to: current)
                cubicControl = nil
                quadraticControl = nil
            case UInt8(ascii: "H"):
                guard let x = reader.number() else { break parsing }
                current = CGPoint(x: relative ? current.x + x : x, y: current.y)
                path.addLine(to: current)
                cubicControl = nil
                quadraticControl = nil
            case UInt8(ascii: "V"):
                guard let y = reader.number() else { break parsing }
                current = CGPoint(x: current.x, y: relative ? current.y + y : y)
                path.addLine(to: current)
                cubicControl = nil
                quadraticControl = nil
            case UInt8(ascii: "C"):
                guard let x1 = reader.number(), let y1 = reader.number(),
                      let x2 = reader.number(), let y2 = reader.number(),
                      let x = reader.number(), let y = reader.number() else { break parsing }
                let control2 = point(x2, y2)
                path.addCurve(to: point(x, y), control1: point(x1, y1), control2: control2)
                current = point(x, y)
                cubicControl = control2
                quadraticControl = nil
            case UInt8(ascii: "S"):
                guard let x2 = reader.number(), let y2 = reader.number(),
                      let x = reader.number(), let y = reader.number() else { break parsing }
                let control1 = cubicControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                let control2 = point(x2, y2)
                path.addCurve(to: point(x, y), control1: control1, control2: control2)
                current = point(x, y)
                cubicControl = control2
                quadraticControl = nil
            case UInt8(ascii: "Q"):
                guard let x1 = reader.number(), let y1 = reader.number(),
                      let x = reader.number(), let y = reader.number() else { break parsing }
                let control = point(x1, y1)
                path.addQuadCurve(to: point(x, y), control: control)
                current = point(x, y)
                quadraticControl = control
                cubicControl = nil
            case UInt8(ascii: "T"):
                guard let x = reader.number(), let y = reader.number() else { break parsing }
                let control = quadraticControl.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                path.addQuadCurve(to: point(x, y), control: control)
                current = point(x, y)
                quadraticControl = control
                cubicControl = nil
            case UInt8(ascii: "A"):
                guard let rx = reader.number(), let ry = reader.number(), let rotation = reader.number(),
                      let large = reader.flag(), let sweep = reader.flag(),
                      let x = reader.number(), let y = reader.number() else { break parsing }
                let end = point(x, y)
                addArc(to: &path, from: current, to: end, rx: rx, ry: ry, rotation: rotation, large: large, sweep: sweep)
                current = end
                cubicControl = nil
                quadraticControl = nil
            default:
                break parsing
            }
        }
        return path
    }

    // MARK: Basic shapes

    static func circle(cx: Double, cy: Double, r: Double) -> Path {
        ellipse(cx: cx, cy: cy, rx: r, ry: r)
    }

    static func ellipse(cx: Double, cy: Double, rx: Double, ry: Double) -> Path {
        guard rx > 0, ry > 0 else { return Path() }
        return Path(ellipseIn: CGRect(x: cx - rx, y: cy - ry, width: 2 * rx, height: 2 * ry))
    }

    static func rect(x: Double, y: Double, width: Double, height: Double, rx: Double?, ry: Double?) -> Path {
        guard width > 0, height > 0 else { return Path() }
        let frame = CGRect(x: x, y: y, width: width, height: height)
        // A missing radius takes the other one, and neither can pass half the side.
        let horizontal = min(max(rx ?? ry ?? 0, 0), width / 2)
        let vertical = min(max(ry ?? rx ?? 0, 0), height / 2)
        guard horizontal > 0 || vertical > 0 else { return Path(frame) }
        return Path(roundedRect: frame, cornerSize: CGSize(width: horizontal, height: vertical))
    }

    static func line(x1: Double, y1: Double, x2: Double, y2: Double) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: x1, y: y1))
        path.addLine(to: CGPoint(x: x2, y: y2))
        return path
    }

    static func poly(points: String, closed: Bool) -> Path {
        var reader = Reader(Array(points.utf8))
        var values: [Double] = []
        while true {
            reader.skipSeparators()
            guard let value = reader.number() else { break }
            values.append(value)
        }
        guard values.count >= 4 else { return Path() }
        var path = Path()
        path.move(to: CGPoint(x: values[0], y: values[1]))
        var index = 2
        while index + 1 < values.count {
            path.addLine(to: CGPoint(x: values[index], y: values[index + 1]))
            index += 2
        }
        if closed { path.closeSubpath() }
        return path
    }

    // MARK: Elliptical arcs (SVG 1.1, implementation notes F.6)

    private static func addArc(
        to path: inout Path, from start: CGPoint, to end: CGPoint,
        rx rawRx: Double, ry rawRy: Double, rotation: Double, large: Bool, sweep: Bool
    ) {
        if start == end { return }
        var rx = abs(rawRx)
        var ry = abs(rawRy)
        guard rx > 0, ry > 0 else {
            path.addLine(to: end)
            return
        }
        let phi = rotation * .pi / 180
        let cosPhi = cos(phi)
        let sinPhi = sin(phi)
        let dx = (start.x - end.x) / 2
        let dy = (start.y - end.y) / 2
        let x1 = cosPhi * dx + sinPhi * dy
        let y1 = -sinPhi * dx + cosPhi * dy

        // Radii too small to span the two points are scaled up until they just do.
        let scale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if scale > 1 {
            let factor = scale.squareRoot()
            rx *= factor
            ry *= factor
        }

        let numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
        let coefficient = (large == sweep ? -1.0 : 1.0) * (max(0, numerator / denominator)).squareRoot()
        let cxPrime = coefficient * rx * y1 / ry
        let cyPrime = -coefficient * ry * x1 / rx
        let cx = cosPhi * cxPrime - sinPhi * cyPrime + (start.x + end.x) / 2
        let cy = sinPhi * cxPrime + cosPhi * cyPrime + (start.y + end.y) / 2

        func angle(_ ux: Double, _ uy: Double, _ vx: Double, _ vy: Double) -> Double {
            let sign: Double = ux * vy - uy * vx < 0 ? -1 : 1
            let length = (ux * ux + uy * uy).squareRoot() * (vx * vx + vy * vy).squareRoot()
            guard length > 0 else { return 0 }
            return sign * acos(max(-1, min(1, (ux * vx + uy * vy) / length)))
        }
        let theta = angle(1, 0, (x1 - cxPrime) / rx, (y1 - cyPrime) / ry)
        var delta = angle((x1 - cxPrime) / rx, (y1 - cyPrime) / ry, (-x1 - cxPrime) / rx, (-y1 - cyPrime) / ry)
        if !sweep, delta > 0 { delta -= 2 * .pi }
        if sweep, delta < 0 { delta += 2 * .pi }

        // At most a quarter turn per cubic keeps the approximation well under a pixel.
        let segments = max(1, Int((abs(delta) / (.pi / 2)).rounded(.up)))
        let step = delta / Double(segments)
        let handle = 4.0 / 3.0 * tan(step / 4)

        func map(_ x: Double, _ y: Double) -> CGPoint {
            CGPoint(x: cosPhi * rx * x - sinPhi * ry * y + cx, y: sinPhi * rx * x + cosPhi * ry * y + cy)
        }
        var from = theta
        for _ in 0..<segments {
            let to = from + step
            let c1 = map(cos(from) - handle * sin(from), sin(from) + handle * cos(from))
            let c2 = map(cos(to) + handle * sin(to), sin(to) - handle * cos(to))
            path.addCurve(to: map(cos(to), sin(to)), control1: c1, control2: c2)
            from = to
        }
    }

    // MARK: Reading

    private struct Reader {
        private let bytes: [UInt8]
        private var index = 0

        init(_ bytes: [UInt8]) { self.bytes = bytes }

        var atEnd: Bool { index >= bytes.count }

        mutating func advance() { index += 1 }

        mutating func skipSeparators() {
            while index < bytes.count {
                let byte = bytes[index]
                if byte == 0x20 || byte == 0x2C || byte == 0x09 || byte == 0x0A || byte == 0x0D { index += 1 } else { break }
            }
        }

        func peekLetter() -> UInt8? {
            guard index < bytes.count else { return nil }
            let byte = bytes[index]
            let isLetter = (byte >= 0x41 && byte <= 0x5A) || (byte >= 0x61 && byte <= 0x7A)
            // `e` and `E` belong to exponents, and only appear inside a number the reader is consuming.
            return isLetter ? byte : nil
        }

        mutating func number() -> Double? {
            skipSeparators()
            let begin = index
            var cursor = index
            func digits() -> Bool {
                let before = cursor
                while cursor < bytes.count, bytes[cursor] >= 0x30, bytes[cursor] <= 0x39 { cursor += 1 }
                return cursor > before
            }
            if cursor < bytes.count, bytes[cursor] == 0x2B || bytes[cursor] == 0x2D { cursor += 1 }
            var any = digits()
            if cursor < bytes.count, bytes[cursor] == 0x2E {
                cursor += 1
                any = digits() || any
            }
            guard any else { return nil }
            if cursor < bytes.count, bytes[cursor] == 0x65 || bytes[cursor] == 0x45 {
                var exponent = cursor + 1
                if exponent < bytes.count, bytes[exponent] == 0x2B || bytes[exponent] == 0x2D { exponent += 1 }
                let digitsStart = exponent
                while exponent < bytes.count, bytes[exponent] >= 0x30, bytes[exponent] <= 0x39 { exponent += 1 }
                if exponent > digitsStart { cursor = exponent }
            }
            index = cursor
            return Double(String(decoding: bytes[begin..<cursor], as: UTF8.self))
        }

        /// An arc flag is one character, and compact data runs it into the next number (`a1 1 0 00.5.5`).
        mutating func flag() -> Bool? {
            skipSeparators()
            guard index < bytes.count, bytes[index] == 0x30 || bytes[index] == 0x31 else { return nil }
            defer { index += 1 }
            return bytes[index] == 0x31
        }
    }
}
