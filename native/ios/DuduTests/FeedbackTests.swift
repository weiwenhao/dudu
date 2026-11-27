import XCTest
@testable import Dudu

final class FeedbackTests: XCTestCase {
    func testTheReplyAddressNeedsAnAtAndADotAndNoSpace() {
        for valid in ["a@b.co", " name.surname@qq.com ", "x@mail.example.org"] { XCTAssertTrue(FeedbackEmail.isValid(valid), valid) }
        for invalid in ["", "abc", "a@b", "a@.com", "@b.com", "a b@c.com", "a@@b.com", "a@b..com", "a@b.", "a@b.com x"] { XCTAssertFalse(FeedbackEmail.isValid(invalid), invalid) }
    }

    func testTheLogThatGoesAlongIsTheNewestWholeLinesOldestFirst() {
        // The files come newest first; each file's lines run oldest to newest.
        let newest = Data("c1\nc2\n".utf8), older = Data("b1\nb2\n".utf8), oldest = Data("a1\n".utf8)
        XCTAssertEqual(FeedbackLogs.recent(newestFirst: [newest, older, oldest], limit: 1_000), "a1\nb1\nb2\nc1\nc2", "everything fits: no note")
        // The cut note counts toward the limit; after it, the newest whole lines that fit stay.
        let markerCost = FeedbackLogs.leftOutLine.utf8.count + 1
        let a = String(repeating: "a", count: 39), b = String(repeating: "b", count: 39)
        let c = String(repeating: "c", count: 39), d = String(repeating: "d", count: 39)
        let cutFiles = [Data("\(c)\n\(d)\n".utf8), Data("\(a)\n\(b)\n".utf8)]
        let fullLimit = markerCost + 80
        let full = FeedbackLogs.recent(newestFirst: cutFiles, limit: fullLimit)
        XCTAssertEqual(full, "\(FeedbackLogs.leftOutLine)\n\(c)\n\(d)")
        XCTAssertLessThanOrEqual(full.utf8.count, fullLimit)
        let oneLimit = markerCost + 40
        let one = FeedbackLogs.recent(newestFirst: cutFiles, limit: oneLimit)
        XCTAssertEqual(one, "\(FeedbackLogs.leftOutLine)\n\(d)")
        XCTAssertLessThanOrEqual(one.utf8.count, oneLimit)
        XCTAssertEqual(FeedbackLogs.recent(newestFirst: [newest, older, oldest], limit: 7), "", "the note itself cannot fit")
        XCTAssertEqual(FeedbackLogs.recent(newestFirst: [], limit: 10), "")

        let longLine = String(repeating: "x", count: 80_000)
        let large = FeedbackLogs.recent(newestFirst: [Data("\(longLine)\n\(longLine)\n".utf8)], limit: FeedbackChannel.maximumLogBytes)
        XCTAssertLessThanOrEqual(large.utf8.count, FeedbackChannel.maximumLogBytes)
        XCTAssertTrue(large.hasPrefix(FeedbackLogs.leftOutLine + "\n"))
        XCTAssertTrue(large.hasSuffix(longLine))
    }

    func testTheRequestCarriesTheFieldsTheFormServiceMails() throws {
        let report = FeedbackReport(message: "连不上电脑", email: "me@example.com", app: "Dudu iOS 0.3.0 (169)", device: "iPhone18,1 · iOS 26.3", language: "zh-Hans", logs: "{\"event\":\"x\"}")
        let request = try FeedbackSender.request(for: report, accessKey: "key-1", endpoint: URL(string: "https://example.test/submit")!)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: String])
        XCTAssertEqual(body["access_key"], "key-1")
        XCTAssertEqual(body["email"], "me@example.com", "the address an answer goes to")
        XCTAssertEqual(body["message"], "连不上电脑")
        XCTAssertEqual(body["subject"], "Dudu 反馈 · iOS 0.3.0 (169)")
        XCTAssertEqual(body["device"], "iPhone18,1 · iOS 26.3")
        XCTAssertEqual(body["logs"], "{\"event\":\"x\"}")
        XCTAssertTrue(FeedbackSender.succeeded(status: 200, data: Data(#"{"success":true,"message":"Email sent successfully!"}"#.utf8)))
        XCTAssertFalse(FeedbackSender.succeeded(status: 200, data: Data(#"{"success":false}"#.utf8)), "the service said no")
        XCTAssertFalse(FeedbackSender.succeeded(status: 429, data: Data(#"{"success":true}"#.utf8)), "only 200 is a send")
        XCTAssertFalse(FeedbackSender.succeeded(status: 200, data: Data("<html>".utf8)))
    }

    func testNothingIsSentWithoutAnAccessKey() async {
        do {
            try await FeedbackSender().send(FeedbackReport(message: "m", email: "a@b.co", app: "", device: "", language: "", logs: ""), accessKey: "")
            XCTFail("a send without a key must not go out")
        } catch {
            XCTAssertEqual(error as? FeedbackError, .notConfigured)
        }
    }
}
