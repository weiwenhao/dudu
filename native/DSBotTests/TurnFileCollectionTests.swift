import XCTest
@testable import dsbot

final class TurnFileCollectionTests: XCTestCase {
    private func file(_ id: String, _ path: String, kind: String = "produced", seq: Double = 1) -> DeliveredFile {
        DeliveredFile(id: id, kind: kind, seq: seq, callSeq: seq - 1, index: 0,
                      path: path, name: (path as NSString).lastPathComponent)
    }

    func testLatestFileReferenceWinsWithoutReorderingOrDuplicatingDeliveries() {
        let collection = TurnFileCollection([
            file("produced", "/internal.js"),
            file("first", "/a.js", kind: "presented"),
            file("other", "/b.js", kind: "presented"),
            file("latest", "/a.js", kind: "presented", seq: 10),
            file("stale", "/a.js", kind: "presented", seq: 2)
        ])
        XCTAssertEqual(collection.presented.map(\.id), ["latest", "other"])
        XCTAssertEqual(collection.presented.first?.parameters["seq"], .number(10))
    }

    func testSearchKeepsOriginalDiffIndices() {
        let files = [
            ConversationChanges.File(path: "/src/index.js", display: "src/index.js", added: 1, deleted: 0),
            ConversationChanges.File(path: "/tests/index.js", display: "tests/index.js", added: 2, deleted: 1),
            ConversationChanges.File(path: "/src/config.js", display: "src/config.js", added: 0, deleted: 1)
        ]
        XCTAssertEqual(TurnFileCollection.matchingChanges(files, query: " TESTS/ "), [1])
        XCTAssertEqual(TurnFileCollection.matchingChanges(files, query: "index"), [0, 1])
        XCTAssertEqual(TurnFileCollection.matchingChanges(files, query: "missing"), [])
        XCTAssertEqual(TurnFileCollection.matchingChanges(files, query: " "), [0, 1, 2])
    }

    func testSameNamesUsePathsAndSearchIncludesDirectories() {
        let files = [file("a", "/src/index.js"), file("b", "/tests/index.js"), file("c", "/config.js")]
        let names = TurnFileCollection.displayNames(files)
        XCTAssertEqual(names["a"], "/src/index.js")
        XCTAssertEqual(names["b"], "/tests/index.js")
        XCTAssertEqual(names["c"], "config.js")
        XCTAssertEqual(TurnFileCollection.matching(files, query: "tests").map(\.id), ["b"])
        XCTAssertEqual(TurnFileCollection.matching(files, query: "missing").count, 0)
    }
}
