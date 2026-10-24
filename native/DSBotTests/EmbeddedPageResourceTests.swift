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

}
