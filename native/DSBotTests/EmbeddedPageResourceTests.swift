import XCTest
@testable import dsbot

final class EmbeddedPageResourceTests: XCTestCase {
    func testPluginComboResourceKeepsTrailingSlashAndDoubleQuestionMark() throws {
        let url = try XCTUnwrap(URL(string:
            "dsbot-ui://8fd5eacc-6ff4-55c9-bc28-43ec06b80254/"
            + "plugins/??@deepseek-ai/dsh-api-gateway/client.js,"
            + "@deepseek-ai/dsh-client-ui-open-in-app/client.js,"
            + "@deepseek-ai/dsh-api-job-controller/client.js"
            + "&rev=5d576e53f948"
        ))

        XCTAssertEqual(
            embeddedResourceRequestPath(from: url),
            "/plugins/??@deepseek-ai/dsh-api-gateway/client.js,"
                + "@deepseek-ai/dsh-client-ui-open-in-app/client.js,"
                + "@deepseek-ai/dsh-api-job-controller/client.js"
                + "&rev=5d576e53f948"
        )
    }

    func testResourcePathKeepsPercentEncodedPathAndQuery() throws {
        let url = try XCTUnwrap(URL(string:
            "dsbot-ui://8fd5eacc-6ff4-55c9-bc28-43ec06b80254/"
            + "plugins/%40scope/client%2Fbundle.js?rev=a%2Fb"
        ))

        XCTAssertEqual(
            embeddedResourceRequestPath(from: url),
            "/plugins/%40scope/client%2Fbundle.js?rev=a%2Fb"
        )
    }

    func testUserLinksChooseOneSystemOpenPathForNormalAndNewWindowTargets() throws {
        let url = try XCTUnwrap(URL(string: "https://platform.deepseek.com/usage"))
        XCTAssertEqual(
            embeddedExternalLinkDisposition(url: url, isUserActivated: true, targetFrameIsNil: false),
            .openInSystem
        )
        XCTAssertEqual(
            embeddedExternalLinkDisposition(url: url, isUserActivated: true, targetFrameIsNil: true),
            .handleNewWindowInSystem
        )
        XCTAssertEqual(
            embeddedExternalLinkDisposition(url: url, isUserActivated: false, targetFrameIsNil: true),
            .reject
        )
    }

    func testExternalLinksRejectCredentialsAndUnrelatedProtocols() throws {
        for value in [
            "https://user:password@example.com/usage",
            "https://user@example.com",
            "https://example.com:0",
            "https://example.com:65536",
            "file:///private/example",
            "javascript:alert(1)",
            "dsbot://pair/example",
        ] {
            let url = try XCTUnwrap(URL(string: value))
            XCTAssertEqual(
                embeddedExternalLinkDisposition(url: url, isUserActivated: true, targetFrameIsNil: true),
                .reject,
                value
            )
        }
    }

    func testOnlyADockPageMayLoadFramesFromOtherSites() throws {
        let site = try XCTUnwrap(URL(string: "https://example.com/docs"))
        let loopback = try XCTUnwrap(URL(string: "http://127.0.0.1:5173/"))
        for url in [site, loopback] {
            XCTAssertTrue(embeddedSubframeNavigationAllowed(page: .dock, url: url, targetFrameIsMain: false))
            // The page itself never navigates away, and a new window is not a frame.
            XCTAssertFalse(embeddedSubframeNavigationAllowed(page: .dock, url: url, targetFrameIsMain: true))
            XCTAssertFalse(embeddedSubframeNavigationAllowed(page: .dock, url: url, targetFrameIsMain: nil))
            for page in [EmbeddedDSHPage.plugins, .trace, .context, .team, .tools, .settings, .panel, .view] {
                XCTAssertFalse(embeddedSubframeNavigationAllowed(page: page, url: url, targetFrameIsMain: false), "\(page)")
            }
        }
        for value in [
            "https://user:password@example.com/", "file:///private/example", "javascript:alert(1)",
            "data:text/html,hello", "blob:https://example.com/id", "dsbot://pair/example", "about:srcdoc",
        ] {
            let url = try XCTUnwrap(URL(string: value))
            XCTAssertFalse(embeddedSubframeNavigationAllowed(page: .dock, url: url, targetFrameIsMain: false), value)
        }
    }

    func testTheBrowserTabsOpenInSystemBrowserComesFromThePageNotAFrame() throws {
        let url = try XCTUnwrap(URL(string: "https://example.com/docs"))
        XCTAssertTrue(embeddedDockOpensInSystem(page: .dock, url: url, sourceIsMainFrame: true))
        XCTAssertFalse(embeddedDockOpensInSystem(page: .dock, url: url, sourceIsMainFrame: false), "a frame is not DSH asking")
        XCTAssertFalse(embeddedDockOpensInSystem(page: .settings, url: url, sourceIsMainFrame: true))
        for value in ["file:///private/example", "javascript:alert(1)", "https://user:pw@example.com/"] {
            let rejected = try XCTUnwrap(URL(string: value))
            XCTAssertFalse(embeddedDockOpensInSystem(page: .dock, url: rejected, sourceIsMainFrame: true), value)
        }
    }
}
