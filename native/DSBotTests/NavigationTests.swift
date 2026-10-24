import XCTest
@testable import dsbot

final class NavigationTests: XCTestCase {
    private func decode(_ json: String) throws -> NavigationCatalog {
        try JSONDecoder().decode(NavigationCatalog.self, from: Data(json.utf8))
    }

    func testTheCatalogDecodesWhatThePluginSends() throws {
        let catalog = try decode(#"""
        {
          "schemaVersion": 1, "available": true, "updatedAt": 1760000000000,
          "sidebar": [
            {"id": "plugins", "title": "插件", "order": 0, "open": {"web": {"page": "plugins"}}},
            {"id": "schedules", "title": "自动化任务", "order": 10, "source": "pkg",
             "open": {"native": "schedule", "web": {"page": "panel", "target": "schedules"}},
             "icon": {"viewBox": [0, 0, 16, 16],
                      "nodes": [{"tag": "path", "d": "M0 0L1 1", "fill": "none", "stroke": "currentColor", "strokeWidth": 1.3}]}}
          ],
          "views": [{"id": "chat", "title": "对话", "open": {"native": "chat"}},
                    {"id": "notes", "title": "笔记", "open": {"web": {"page": "view", "target": "notes"}}}],
          "dock": [{"id": "files:workspace", "title": "工作区文件", "kind": "files", "entryId": "workspace",
                    "open": {"native": "files"}}],
          "settings": [{"id": "models", "title": "模型", "open": {"web": {"page": "settings", "target": "models"}}}]
        }
        """#)
        XCTAssertTrue(catalog.available)
        XCTAssertEqual(catalog.sidebar.map(\.id), ["plugins", "schedules"])
        XCTAssertEqual(catalog.sidebar[1].source, "pkg")
        XCTAssertEqual(catalog.sidebar[1].icon?.nodes.first?.d, "M0 0L1 1")
        XCTAssertEqual(catalog.sidebar[1].icon?.nodes.first?.strokeWidth, 1.3)
        XCTAssertEqual(catalog.views.map(\.title), ["对话", "笔记"])
        XCTAssertEqual(catalog.settings.first?.target, .web(page: .settings, target: "models"))
    }

    func testMalformedEntriesReportFailureInsteadOfDisappearing() throws {
        XCTAssertThrowsError(try decode(#"""
        {"available": true,
         "sidebar": [{"id": "a", "title": "A", "open": {"web": {"page": "panel", "target": "a"}}},
                     {"id": 7, "title": "wrong type"},
                     {"title": "no id", "open": {}},
                     {"id": "b", "title": "B", "open": {"native": "files"}}]}
        """#))
    }

    func testMalformedIconsReportFailureInsteadOfLosingTheirGlyphs() throws {
        XCTAssertThrowsError(try decode(#"""
        {"available": true,
         "sidebar": [
           {"id": "a", "title": "A", "open": {"native": "files"}, "icon": {"viewBox": [0, 0, 0, 16], "nodes": [{"tag": "path"}]}},
           {"id": "b", "title": "B", "open": {"native": "files"}, "icon": {"viewBox": [0, 0, 16, 16], "nodes": []}},
           {"id": "c", "title": "C", "open": {"native": "files"}, "icon": "<svg/>"},
           {"id": "d", "title": "D", "open": {"native": "files"},
            "icon": {"viewBox": [0, 0, 16, 16], "nodes": [{"tag": "path", "d": "M0 0L1 1"}, {"broken": true}]}}
         ]}
        """#))
        XCTAssertThrowsError(try catalog(withIcon: #"{"viewBox": [0, 0, 16, 16], "nodes": [{"tag": "path", "d": "M0 0L1 1"}, {"broken": true}]}"#))
        XCTAssertThrowsError(try decode(#"{"schemaVersion": 2}"#))
    }

    func testAMissingOrEmptyReplyIsTheEmptyCatalog() throws {
        XCTAssertEqual(try decode("{}"), .empty)
        XCTAssertFalse(try decode("{}").available)
    }

    func testTheAppOpensItsOwnScreenWhenItHasOneAndTheDSHPageWhenItDoesNot() {
        func target(_ native: String?, _ page: String? = nil, _ id: String? = nil) -> NavigationTarget {
            NavigationTarget(NavigationOpen(
                native: native, web: page.map { NavigationOpen.Web(page: $0, target: id) }
            ))
        }
        XCTAssertEqual(target("chat"), .chat)
        XCTAssertEqual(target("files"), .files)
        XCTAssertEqual(target("schedule", "panel", "schedules"), .schedule, "A screen of the app's own wins.")
        XCTAssertEqual(target("calendar", "panel", "calendar"), .web(page: .panel, target: "calendar"),
                       "A screen this build lacks falls back to the page.")
        XCTAssertEqual(target(nil, "trace"), .web(page: .trace, target: nil))
        XCTAssertEqual(target(nil, "view", "notes"), .web(page: .view, target: "notes"))
        XCTAssertEqual(target(nil, "dock", "board:open"), .unsupported)
        XCTAssertEqual(target("calendar"), .unsupported)
        XCTAssertEqual(target(nil, "hologram"), .unsupported, "A page kind this build does not know cannot open.")
        XCTAssertEqual(target(nil), .unsupported)
    }

    func testPagesOfOneConversationNeedASession() {
        for page in [EmbeddedDSHPage.trace, .context, .team, .tools, .view] {
            XCTAssertTrue(page.needsSession, "\(page)")
        }
        for page in [EmbeddedDSHPage.plugins, .settings, .panel] {
            XCTAssertFalse(page.needsSession, "\(page)")
        }
    }

    func testAnOlderPluginLeavesTheListsEmptyInsteadOfTheAppListingWhatDSHMightHave() {
        // There is no built-in copy of DSH's entries: with nothing reported the lists are empty.
        let empty = NavigationCatalog.empty
        XCTAssertFalse(empty.available)
        XCTAssertTrue(empty.sidebar.isEmpty)
        XCTAssertTrue(empty.views.isEmpty)
        XCTAssertTrue(empty.settings.isEmpty)
    }

    // MARK: Drawn icons

    /// The start of a PNG of the given size: the signature and the header chunk, which is what the app reads.
    private func pictureBase64(width: Int = 64, height: Int = 64, name: String = "IHDR", trailing: Int = 12) -> String {
        var bytes: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13]
        bytes += Array(name.utf8)
        for value in [width, height] {
            bytes += [UInt8(value >> 24 & 0xFF), UInt8(value >> 16 & 0xFF), UInt8(value >> 8 & 0xFF), UInt8(value & 0xFF)]
        }
        bytes += [UInt8](repeating: 0, count: trailing)
        return Data(bytes).base64EncodedString()
    }

    private func catalog(withIcon icon: String) throws -> NavigationCatalog {
        let json = """
        {"schemaVersion": 1, "available": true, "updatedAt": 1,
         "sidebar": [{"id": "a", "title": "A", "open": {"native": "files"}, "icon": \(icon)}]}
        """
        return try JSONDecoder().decode(NavigationCatalog.self, from: Data(json.utf8))
    }

    func testAnIconTheBrowserDrewIsKeptAsAPictureWithNoShapes() throws {
        let png = pictureBase64()
        let catalog = try catalog(withIcon: #"{"viewBox": [0, 0, 64, 64], "nodes": [], "png": "\#(png)", "width": 64, "height": 64}"#)
        let icon = try XCTUnwrap(catalog.sidebar.first?.icon)
        XCTAssertEqual(icon.png, Data(base64Encoded: png))
        XCTAssertTrue(icon.nodes.isEmpty)
        XCTAssertEqual(icon.viewBox, [0, 0, 64, 64])
    }

    func testInvalidPicturesReportFailure() throws {
        let bad: [String: String] = [
            "not base64": "not base64!",
            "a data url": "data:image/png;base64,\(pictureBase64())",
            "markup": Data("<svg onload=\"x()\"></svg>".utf8 + [UInt8](repeating: 32, count: 24)).base64EncodedString(),
            "no header chunk": pictureBase64(name: "IDAT"),
            "too large a side": pictureBase64(width: 4096),
            "too small a side": pictureBase64(width: 2),
            "too short": "iVBORw0KGgo=",
            "too many bytes": pictureBase64(trailing: 13 * 1024)
        ]
        for (what, png) in bad {
            XCTAssertThrowsError(try catalog(withIcon: #"{"viewBox": [0, 0, 64, 64], "nodes": [], "png": "\#(png)"}"#), what)
        }
    }

    func testShapesStillNeedAtLeastOneNodeAndAPictureNeedsNone() throws {
        XCTAssertThrowsError(try catalog(withIcon: #"{"viewBox": [0, 0, 16, 16], "nodes": []}"#))
        XCTAssertNotNil(try catalog(withIcon: #"{"viewBox": [0, 0, 16, 16], "nodes": [{"tag": "path", "d": "M0 0L1 1"}]}"#).sidebar[0].icon)
        XCTAssertThrowsError(try catalog(withIcon: #"{"viewBox": [0, 0, 0, 16], "nodes": [], "png": "\#(pictureBase64())"}"#),
                             "The box is checked for a picture too.")
    }
}
