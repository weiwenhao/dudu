import XCTest
@testable import dsbot

final class CoreConnectionTests: XCTestCase {
    private let token = String(repeating: "a", count: 43)

    func testHTTPSPairingUsesAuthenticatedHTTPURLAndKeepsCredentialOutOfRequests() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "https://chat.example.test/dsbot?pair=\(token)&computer=desktop_7&name=Office"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "https://chat.example.test/dsbot")
        XCTAssertEqual(endpoint.originalURL, "https://chat.example.test/dsbot?pair=\(token)&computer=desktop_7&name=Office")
        XCTAssertFalse(endpoint.httpURL.absoluteString.contains(token))
        XCTAssertEqual(endpoint.computerId, "desktop_7")
        XCTAssertEqual(endpoint.name, "Office")
    }

    func testLegacyLANPortMigratesTo3170WithoutChangingHTTPTransport() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "http://192.168.1.22:3107/?pair=\(token)"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "http://192.168.1.22:3170/dsbot")
    }

    func testAppLinkUnwrapsPairingAddress() throws {
        let target = "http://192.168.1.22:3097/?pair=\(token)&computer=home"
        var appLinkComponents = URLComponents()
        appLinkComponents.scheme = "harness-mobile"
        appLinkComponents.host = "connect"
        appLinkComponents.queryItems = [URLQueryItem(name: "url", value: target)]
        let appLink = try XCTUnwrap(appLinkComponents.string)
        let endpoint = try ConnectionEndpoint.parse(appLink)

        XCTAssertEqual(endpoint.httpURL.absoluteString, "http://192.168.1.22:3170/dsbot")
        XCTAssertEqual(endpoint.computerId, "home")
    }

    func testPublicHTTPAddressIsUsedDirectly() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "http://public.example.test:8080/dsbot?pair=\(token)"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "http://public.example.test:8080/dsbot")
    }

    func testLegacySocketPairingLinkIsNormalizedToHTTPFamily() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "wss://chat.example.test/dsbot?pair=\(token)"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "https://chat.example.test/dsbot")
        XCTAssertTrue(endpoint.originalURL.hasPrefix("https://"))
    }

    func testHTTPPageCookieIsHttpOnlyAndScopedToItsPageForBothSchemes() throws {
        let id = "00000000-0000-4000-8000-000000000001"
        let path = "/dsbot/ui/\(id)/"
        for scheme in ["http", "https"] {
            let url = try XCTUnwrap(URL(string: "\(scheme)://desktop.example.test:3170\(path)"))
            let page = OpenedHTTPPage(
                id: id, path: path, basePath: path, url: url,
                cookie: token, computerID: "desktop"
            )
            let cookie = try XCTUnwrap(EmbeddedHTTPPageClient.cookie(for: page, origin: url))
            XCTAssertEqual(cookie.name, "dsbot_ui")
            XCTAssertEqual(cookie.path, path)
            XCTAssertEqual(cookie.domain, "desktop.example.test")
            XCTAssertTrue(cookie.isHTTPOnly)
            XCTAssertEqual(cookie.isSecure, scheme == "https")
            XCTAssertEqual(cookie.value, token)
        }
    }

    func testPublicWebSocketPairingLinkIsRejected() {
        XCTAssertThrowsError(try ConnectionEndpoint.parse(
            "ws://public.example.test/?pair=\(token)"
        )) { error in
            XCTAssertEqual(error as? DSBotFailure, .insecurePublicConnection)
        }
    }

    func testMalformedIPv4LookingDomainDoesNotReceiveLegacyLANPortMigration() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "http://example.10.0.0.1:3097/?pair=\(token)"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "http://example.10.0.0.1:3097/dsbot")
    }

    func testDuplicatePairCredentialIsRejected() {
        XCTAssertThrowsError(try ConnectionEndpoint.parse(
            "https://chat.example.test/?pair=\(token)&pair=\(token)"
        )) { error in
            XCTAssertEqual(error as? DSBotFailure, .missingCredential)
        }
    }

    func testDisplayAddressKeepsSchemePortAndPathButDropsQuery() {
        let computer = Computer(
            id: "local-id",
            name: "Office",
            url: "https://chat.example.test:8443/dsbot?pair=\(token)&computer=office",
            computerId: "office",
            lastUsedAt: 0
        )

        XCTAssertEqual(computer.displayAddress, "https://chat.example.test:8443/dsbot")
        XCTAssertFalse(computer.displayAddress.contains(token))
    }

    func testMissingDesktopMethodExplainsPluginUpdateWithoutInvalidatingPairing() {
        let failure = DSBotFailure.remoteCode("METHOD_NOT_ALLOWED")

        XCTAssertEqual(failure.localizedDescription, "请更新电脑端的手机控制插件")
        XCTAssertFalse(failure.requiresNewPairing)
        XCTAssertEqual(DSBotFailure.remote("UNSUPPORTED").localizedDescription, "暂不支持此操作。")
    }
}
