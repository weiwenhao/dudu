import SwiftUI
import XCTest
@testable import dsbot

final class SVGPathTests: XCTestCase {
    private func assertRect(_ path: Path, _ x: Double, _ y: Double, _ width: Double, _ height: Double,
                            accuracy: Double = 0.05, file: StaticString = #filePath, line: UInt = #line) {
        let box = path.boundingRect
        XCTAssertEqual(box.minX, x, accuracy: accuracy, "minX", file: file, line: line)
        XCTAssertEqual(box.minY, y, accuracy: accuracy, "minY", file: file, line: line)
        XCTAssertEqual(box.width, width, accuracy: accuracy, "width", file: file, line: line)
        XCTAssertEqual(box.height, height, accuracy: accuracy, "height", file: file, line: line)
    }

    func testAbsoluteAndRelativeLinesCloseTheShape() {
        assertRect(SVGPath.path(from: "M0 0 L10 0 L10 10 Z"), 0, 0, 10, 10)
        assertRect(SVGPath.path(from: "m1 1 l2 0 l0 3 z"), 1, 1, 2, 3)
        assertRect(SVGPath.path(from: "M0 0 H10 V5 h-10 v-5"), 0, 0, 10, 5)
    }

    func testPairsAfterAMovetoAreImplicitLinetos() {
        assertRect(SVGPath.path(from: "M0 0 10 0 10 10"), 0, 0, 10, 10)
        assertRect(SVGPath.path(from: "m0 0 10 0 0 10"), 0, 0, 10, 10)
        assertRect(SVGPath.path(from: "M0 0 L10 0 5 8"), 0, 0, 10, 8)
    }

    func testCompactNumbersAndExponentsAreSplitCorrectly() {
        assertRect(SVGPath.path(from: "M1.5.5L-1-2"), -1, -2, 2.5, 2.5)
        assertRect(SVGPath.path(from: "M1e1 2E-1L0 0"), 0, 0, 10, 0.2)
        assertRect(SVGPath.path(from: "M 0,0 , L 4,3"), 0, 0, 4, 3)
    }

    func testCurvesEndWhereTheyAreToldAndSmoothCurvesReflectTheLastControl() {
        let cubic = SVGPath.path(from: "M0 0 C0 10 10 10 10 0 S20 -10 20 0")
        XCTAssertEqual(cubic.currentPoint?.x ?? .nan, 20, accuracy: 0.001)
        XCTAssertEqual(cubic.currentPoint?.y ?? .nan, 0, accuracy: 0.001)
        // The second curve starts out going the way the first one arrived (a reflected control at y = -10).
        XCTAssertLessThan(cubic.boundingRect.minY, -2)

        let quadratic = SVGPath.path(from: "M0 0 Q5 10 10 0 T20 0")
        XCTAssertEqual(quadratic.currentPoint?.x ?? .nan, 20, accuracy: 0.001)
        XCTAssertLessThan(quadratic.boundingRect.minY, -2, "T reflects the previous control point.")
    }

    func testEllipticalArcsFollowTheSweepAndLargeArcFlags() {
        // From (0,0) to (10,0) with radius 5 the arc is a half circle; sweep decides which side.
        assertRect(SVGPath.path(from: "M0 0 A5 5 0 0 1 10 0"), 0, -5, 10, 5)
        assertRect(SVGPath.path(from: "M0 0 A5 5 0 0 0 10 0"), 0, 0, 10, 5)
        // Radii too small to span the points grow until they just do.
        assertRect(SVGPath.path(from: "M0 0 A1 1 0 0 1 10 0"), 0, -5, 10, 5)
        // A large arc between close points goes the long way round.
        let large = SVGPath.path(from: "M0 0 A5 5 0 1 1 5 5")
        XCTAssertGreaterThan(large.boundingRect.width, 9)
        XCTAssertGreaterThan(large.boundingRect.height, 9)
        // Relative arcs, and flags written without separators (`1010` is flag 1, flag 0, x 10).
        assertRect(SVGPath.path(from: "m0 0a5 5 0 0 1 10 0"), 0, -5, 10, 5)
        let compact = SVGPath.path(from: "M0 0a5 5 0 1010 0")
        let spaced = SVGPath.path(from: "M0 0a5 5 0 1 0 10 0")
        XCTAssertEqual(compact.boundingRect, spaced.boundingRect)
        // An arc to its own start draws nothing, and zero radii are a straight line.
        XCTAssertTrue(SVGPath.path(from: "M3 3 A5 5 0 0 1 3 3").boundingRect.size == .zero)
        assertRect(SVGPath.path(from: "M0 0 A0 5 0 0 1 10 0"), 0, 0, 10, 0)
    }

    func testMalformedDataKeepsWhatWasDrawnBeforeTheError() {
        assertRect(SVGPath.path(from: "M0 0 L10 0 L"), 0, 0, 10, 0)
        assertRect(SVGPath.path(from: "M0 0 L10 0 X 5 5"), 0, 0, 10, 0)
        XCTAssertTrue(SVGPath.path(from: "").isEmpty)
        XCTAssertTrue(SVGPath.path(from: "10 10 L 5 5").isEmpty, "Numbers before any command are not a path.")
    }

    func testAnIconPathFromDSHKeepsItsBounds() {
        let circle = "M6 8.25C7.51878 8.25 8.75 7.01878 8.75 5.5C8.75 3.98122 7.51878 2.75 6 2.75"
            + "C4.48122 2.75 3.25 3.98122 3.25 5.5C3.25 7.01878 4.48122 8.25 6 8.25Z"
        assertRect(SVGPath.path(from: circle), 3.25, 2.75, 5.5, 5.5, accuracy: 0.1)
    }

    func testBasicShapes() {
        assertRect(SVGPath.circle(cx: 8, cy: 8, r: 3), 5, 5, 6, 6)
        assertRect(SVGPath.ellipse(cx: 8, cy: 8, rx: 4, ry: 2), 4, 6, 8, 4)
        assertRect(SVGPath.rect(x: 1, y: 2, width: 6, height: 4, rx: nil, ry: nil), 1, 2, 6, 4)
        assertRect(SVGPath.rect(x: 1, y: 2, width: 6, height: 4, rx: 50, ry: nil), 1, 2, 6, 4)
        assertRect(SVGPath.line(x1: 0, y1: 0, x2: 3, y2: 4), 0, 0, 3, 4)
        assertRect(SVGPath.poly(points: "0,0 4,0 4,3", closed: false), 0, 0, 4, 3)
        assertRect(SVGPath.poly(points: "0 0 4 0 4 3", closed: true), 0, 0, 4, 3)
        XCTAssertTrue(SVGPath.circle(cx: 1, cy: 1, r: 0).isEmpty)
        XCTAssertTrue(SVGPath.poly(points: "1,1", closed: true).isEmpty)
    }

    func testTheWhaleLogoStillParses() {
        let whale = DeepSeekWhale().path(in: CGRect(x: 0, y: 0, width: 23.16, height: 17.04))
        XCTAssertGreaterThan(whale.boundingRect.width, 22)
        XCTAssertGreaterThan(whale.boundingRect.height, 16)
    }
}
