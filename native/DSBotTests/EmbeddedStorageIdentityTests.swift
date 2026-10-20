import XCTest
@testable import dsbot

final class EmbeddedStorageIdentityTests: XCTestCase {
    func testAComputerIdThatIsAUUIDIsUsedAsItIs() {
        let id = "8FD5EACC-6FF4-55C9-BC28-43EC06B80254"
        XCTAssertEqual(EmbeddedStorageIdentity.uuid(forComputer: id), UUID(uuidString: id))
    }

    func testAnyOtherIdGetsAStableNameBasedUUID() {
        let first = EmbeddedStorageIdentity.uuid(forComputer: "work-mac")
        XCTAssertEqual(first, EmbeddedStorageIdentity.uuid(forComputer: "work-mac"), "the same computer keeps its storage")
        XCTAssertNotEqual(first, EmbeddedStorageIdentity.uuid(forComputer: "home-mac"), "another computer never shares it")
        XCTAssertNotEqual(first, EmbeddedStorageIdentity.uuid(forComputer: "work-mac "))

        // A well-formed name-based UUID: version 5 and the RFC 4122 variant.
        let text = first.uuidString
        let characters = Array(text)
        XCTAssertEqual(characters[14], "5", text)
        XCTAssertTrue(["8", "9", "A", "B"].contains(characters[19]), text)
    }

    func testTheNameBasedUUIDDoesNotCollideWithAnIdThatLooksLikeIt() {
        // The derivation is salted, so an id that already is the derived text does not map to itself.
        let derived = EmbeddedStorageIdentity.uuid(forComputer: "work-mac")
        XCTAssertEqual(EmbeddedStorageIdentity.uuid(forComputer: derived.uuidString), derived)
        XCTAssertNotEqual(EmbeddedStorageIdentity.uuid(forComputer: "work-mac"), UUID(uuidString: "work-mac"))
    }
}
