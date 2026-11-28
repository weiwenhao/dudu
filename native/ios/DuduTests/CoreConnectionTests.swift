import XCTest
@testable import Dudu

final class CoreConnectionTests: XCTestCase {
    private let token = String(repeating: "a", count: 43)

    func testRepeatedNetworkSnapshotsDoNotRequestAnotherReconnect() {
        var changes = ConnectionNetworkPathChanges()
        let wifi = ConnectionNetworkPathChanges.State(isReachable: true, interfaces: ["wifi"])
        let cellular = ConnectionNetworkPathChanges.State(isReachable: true, interfaces: ["cellular"])
        XCTAssertFalse(changes.update(wifi), "Startup already chooses a route.")
        for _ in 0..<10 { XCTAssertFalse(changes.update(wifi)) }
        XCTAssertTrue(changes.update(cellular))
        for _ in 0..<125 { XCTAssertFalse(changes.update(cellular)) }
        XCTAssertTrue(changes.update(wifi), "Returning to Wi-Fi must reconsider the LAN.")
    }

    func testNetworkAvailabilityChangesStillRequestRouteSelection() {
        var changes = ConnectionNetworkPathChanges()
        let cellular = ConnectionNetworkPathChanges.State(isReachable: true, interfaces: ["cellular"])
        let offline = ConnectionNetworkPathChanges.State(isReachable: false, interfaces: [])
        XCTAssertFalse(changes.update(cellular))
        XCTAssertTrue(changes.update(offline))
        XCTAssertFalse(changes.update(offline))
        XCTAssertTrue(changes.update(cellular))
    }

    func testHTTPSPairingUsesAuthenticatedHTTPURLAndKeepsCredentialOutOfRequests() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "https://chat.example.test/?pair=\(token)&computer=desktop_7&name=Office"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "https://chat.example.test")
        XCTAssertEqual(endpoint.originalURL, "https://chat.example.test/?pair=\(token)&computer=desktop_7&name=Office")
        XCTAssertFalse(endpoint.httpURL.absoluteString.contains(token))
        XCTAssertEqual(endpoint.computerId, "desktop_7")
        XCTAssertEqual(endpoint.name, "Office")
    }

    func testLegacyLANPortMigratesTo3170WithoutChangingHTTPTransport() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "http://192.168.1.22:3107/?pair=\(token)"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "http://192.168.1.22:3170")
    }

    func testAppLinkUnwrapsPairingAddress() throws {
        let target = "http://192.168.1.22:3097/?pair=\(token)&computer=home"
        var appLinkComponents = URLComponents()
        appLinkComponents.scheme = "harness-mobile"
        appLinkComponents.host = "connect"
        appLinkComponents.queryItems = [URLQueryItem(name: "url", value: target)]
        let appLink = try XCTUnwrap(appLinkComponents.string)
        let endpoint = try ConnectionEndpoint.parse(appLink)

        XCTAssertEqual(endpoint.httpURL.absoluteString, "http://192.168.1.22:3170")
        XCTAssertEqual(endpoint.computerId, "home")
    }

    func testPublicHTTPAddressIsUsedDirectly() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "http://public.example.test:8080/?pair=\(token)"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "http://public.example.test:8080")
    }

    func testLegacySocketPairingLinkIsNormalizedToHTTPFamily() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "wss://chat.example.test/?pair=\(token)"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "https://chat.example.test")
        XCTAssertTrue(endpoint.originalURL.hasPrefix("https://"))
    }

    func testHTTPPageCookieIsHttpOnlyAndScopedToItsPageForBothSchemes() throws {
        let id = "00000000-0000-4000-8000-000000000001"
        let path = "/ui/\(id)/"
        for scheme in ["http", "https"] {
            let url = try XCTUnwrap(URL(string: "\(scheme)://desktop.example.test:3170\(path)"))
            let page = OpenedHTTPPage(
                id: id, path: path, basePath: path, url: url,
                cookie: token, computerID: "desktop"
            )
            let cookie = try XCTUnwrap(EmbeddedHTTPPageClient.cookie(for: page, origin: url))
            XCTAssertEqual(cookie.name, "dudu_ui")
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
            XCTAssertEqual(error as? DuduFailure, .insecurePublicConnection)
        }
    }

    func testMalformedIPv4LookingDomainDoesNotReceiveLegacyLANPortMigration() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "http://example.10.0.0.1:3097/?pair=\(token)"
        )

        XCTAssertEqual(endpoint.httpURL.absoluteString, "http://example.10.0.0.1:3097")
    }

    func testDuplicatePairCredentialIsRejected() {
        XCTAssertThrowsError(try ConnectionEndpoint.parse(
            "https://chat.example.test/?pair=\(token)&pair=\(token)"
        )) { error in
            XCTAssertEqual(error as? DuduFailure, .missingCredential)
        }
    }

    func testPairingTheSameComputerReusesItsLocalRecord() throws {
        let link = try ConnectionEndpoint.parse("https://old.example.test/?pair=\(token)&computer=office")
        var library = ComputerLibrary(computers: [], activeId: nil)
        let first = library.recordPairing(endpoint: link, readyId: "office")
        let repeated = library.recordPairing(endpoint: link, readyId: "office")
        XCTAssertEqual(repeated.id, first.id)

        let newToken = String(repeating: "b", count: 43)
        let replacement = try ConnectionEndpoint.parse("https://new.example.test/?pair=\(newToken)&computer=office")
        let updated = library.recordPairing(endpoint: replacement, readyId: "office")
        XCTAssertEqual(updated.id, first.id)
        XCTAssertEqual(library.computers, [updated])
        XCTAssertEqual(library.activeId, first.id)
        XCTAssertEqual(updated.url, replacement.originalURL)
    }

    func testDisplayAddressKeepsSchemeAndPortButDropsPathAndQuery() {
        let computer = Computer(
            id: "local-id",
            name: "Office",
            url: "https://chat.example.test:8443/?pair=\(token)&computer=office",
            computerId: "office",
            lastUsedAt: 0
        )

        XCTAssertEqual(computer.displayAddress, "https://chat.example.test:8443")
        XCTAssertFalse(computer.displayAddress.contains(token))
    }

    func testRootPairingAddressKeepsTheExistingAuthenticatedAPIEndpoint() throws {
        let endpoint = try ConnectionEndpoint.parse(
            "https://chat.example.test:8443/?pair=\(token)&computer=office"
        )
        XCTAssertEqual(endpoint.httpURL.absoluteString, "https://chat.example.test:8443")
        XCTAssertEqual(endpoint.computerId, "office")
    }

    func testMissingDesktopMethodExplainsPluginUpdateWithoutInvalidatingPairing() {
        let failure = DuduFailure.remoteCode("METHOD_NOT_ALLOWED")

        XCTAssertEqual(failure.localizedDescription, L10n.text("请更新电脑端的手机控制插件"))
        XCTAssertFalse(failure.requiresNewPairing)
        XCTAssertEqual(DuduFailure.remote("UNSUPPORTED").localizedDescription, L10n.text("暂不支持此操作。"))
    }

    func testMultiAddressPairingKeepsOneCredentialAndCanSelectEitherOrigin() throws {
        var parts = URLComponents(string: "http://192.168.1.20:3170/")!
        parts.queryItems = [
            URLQueryItem(name: "pair", value: token), URLQueryItem(name: "computer", value: "desktop"),
            URLQueryItem(name: "device", value: "phone"),
            URLQueryItem(name: "lan", value: "http://192.168.1.20:3170"),
            URLQueryItem(name: "public", value: "https://remote.example.test:8443"),
        ]
        let endpoint = try ConnectionEndpoint.parse(parts.string!)
        XCTAssertEqual(endpoint.addresses.count, 2)
        XCTAssertEqual(endpoint.probeId, "phone")
        let internet = try endpoint.selecting(endpoint.addresses[1])
        XCTAssertEqual(internet.httpURL.absoluteString, "https://remote.example.test:8443")
        XCTAssertEqual(internet.token, endpoint.token)
        XCTAssertEqual(internet.computerId, endpoint.computerId)
        XCTAssertNil(internet.httpURL.query)
        XCTAssertEqual(internet.addresses, endpoint.addresses)
    }

    func testLegacyComputerJSONDecodesWithoutLosingItsIdentityOrCredential() throws {
        let data = Data("""
        {"id":"local","name":"Mac","url":"http://192.168.1.20:3170/?pair=\(token)&computer=desktop","computerId":"desktop","lastUsedAt":12}
        """.utf8)
        let computer = try JSONDecoder().decode(Computer.self, from: data)
        let endpoint = try ConnectionEndpoint.saved(computer)
        XCTAssertEqual(computer.id, "local")
        XCTAssertEqual(endpoint.token, token)
        XCTAssertEqual(endpoint.addresses, [ConnectionAddress(kind: .lan, url: "http://192.168.1.20:3170")])
        XCTAssertNil(endpoint.probeId)
        var upgraded = computer
        upgraded.addresses = endpoint.addresses + [ConnectionAddress(kind: .internet, url: "https://remote.example.test")]
        upgraded.probeId = "device"
        let restored = try JSONDecoder().decode(Computer.self, from: JSONEncoder().encode(upgraded))
        XCTAssertEqual(try ConnectionEndpoint.saved(restored).addresses.count, 2)
        XCTAssertEqual(restored.id, computer.id)
        XCTAssertEqual(restored.url, computer.url)
    }

    func testAddressImportsRejectCredentialsPathsAndUnverifiableRouteLists() throws {
        for url in ["https://u:p@host", "https://host/path", "https://host/?pair=secret", "file:///tmp/a"] {
            XCTAssertThrowsError(try ConnectionAddress.normalized(url))
        }
        XCTAssertThrowsError(try ConnectionEndpoint.parse(
            "https://remote.example.test/?pair=\(token)&lan=http%3A%2F%2F192.168.1.20%3A3170"
        ))
        XCTAssertThrowsError(try ConnectionAddress.validated([]))
        XCTAssertEqual(try ConnectionAddress.normalized("http://laptop.local:3170").kind, .lan)
        XCTAssertEqual(try ConnectionAddress.normalized("http://[fd00::1]:3170").kind, .lan)
    }
}
