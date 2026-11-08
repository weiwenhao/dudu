import Foundation
import Darwin

enum ConnectionAddressKind: String, Codable, Sendable {
    case lan
    case internet = "public"
}

struct ConnectionAddress: Codable, Sendable, Equatable, Hashable, Identifiable {
    var kind: ConnectionAddressKind
    var url: String
    var id: String { url }

    static func normalized(_ input: String, kind: ConnectionAddressKind? = nil) throws -> ConnectionAddress {
        guard var parts = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = parts.host, !host.isEmpty,
              let scheme = parts.scheme?.lowercased(), scheme == "http" || scheme == "https",
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              ["", "/", "/dsbot"].contains(parts.path) else { throw DSBotFailure.invalidLink }
        parts.scheme = scheme
        parts.host = host.lowercased()
        parts.path = ""
        guard let url = parts.string else { throw DSBotFailure.invalidLink }
        return ConnectionAddress(kind: kind ?? (ConnectionEndpoint.isLocalHost(host) ? .lan : .internet), url: url)
    }

    static func validated(_ addresses: [ConnectionAddress]) throws -> [ConnectionAddress] {
        guard !addresses.isEmpty, addresses.count <= 32 else { throw DSBotFailure.invalidLink }
        var result: [ConnectionAddress] = []
        for address in addresses {
            let route = try normalized(address.url, kind: address.kind)
            if let previous = result.first(where: { $0.url == route.url }) {
                guard previous.kind == route.kind else { throw DSBotFailure.invalidLink }
            } else {
                result.append(route)
            }
        }
        return result
    }
}

struct ConnectionEndpoint: Sendable {
    var originalURL: String
    var httpURL: URL
    let token: String
    var computerId: String?
    let name: String
    var addresses: [ConnectionAddress]
    var probeId: String?
    var addressesEdited = false

    static func parse(_ input: String, name overrideName: String = "") throws -> ConnectionEndpoint {
        guard input.utf8.count <= 128 * 1024 else { throw DSBotFailure.invalidLink }
        let unwrapped = try unwrapAppLink(input.trimmingCharacters(in: .whitespacesAndNewlines))
        guard var components = URLComponents(string: unwrapped),
              let scheme = components.scheme?.lowercased(),
              let host = components.host,
              !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.fragment == nil
        else { throw DSBotFailure.invalidLink }

        let items = components.queryItems ?? []
        let pairItems = items.filter { $0.name == "pair" }
        guard pairItems.count == 1,
              let token = pairItems[0].value,
              token.range(of: #"^[A-Za-z0-9_-]{43}$"#, options: .regularExpression) != nil
        else { throw DSBotFailure.missingCredential }

        let computerItems = items.filter { $0.name == "computer" }
        guard computerItems.count <= 1 else { throw DSBotFailure.invalidLink }
        let computerId = computerItems.first?.value
        if let computerId,
           (computerId.isEmpty || computerId.count > 100
            || computerId.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) == nil) {
            throw DSBotFailure.invalidLink
        }
        let devices = items.filter { $0.name == "device" }
        guard devices.count <= 1 else { throw DSBotFailure.invalidLink }
        let probeId = devices.first?.value
        if let probeId {
            guard computerId != nil, validIdentity(probeId) else { throw DSBotFailure.invalidLink }
        }

        let qrName = items.first(where: { $0.name == "name" })?.value?.trimmingCharacters(in: .whitespacesAndNewlines)
        let chosenName = overrideName.trimmingCharacters(in: .whitespacesAndNewlines)
        let displayName = String((chosenName.isEmpty ? (qrName?.isEmpty == false ? qrName! : host) : chosenName).prefix(80))

        let isLAN = isLocalHost(host)
        let httpScheme: String
        // Legacy pairing links are normalized here; the native client always speaks HTTP(S).
        switch scheme {
        case "https", "wss":
            httpScheme = "https"
        case "http":
            httpScheme = "http"
        case "ws":
            guard isLAN else { throw DSBotFailure.insecurePublicConnection }
            httpScheme = "http"
        default:
            throw DSBotFailure.invalidLink
        }

        let path = components.path.isEmpty ? "/" : components.path
        guard path == "/" || path == "/dsbot" || path == "/api/remote.mux" else {
            throw DSBotFailure.invalidLink
        }
        components.scheme = httpScheme
        components.path = "/dsbot"
        components.fragment = nil
        if isLAN, components.port == 3097 || components.port == 3107 {
            components.port = 3170
        }
        guard let storedURL = components.url else { throw DSBotFailure.invalidLink }
        var httpComponents = components
        // Credentials stay in the Authorization header, never in API request URLs.
        httpComponents.query = nil
        guard let httpURL = httpComponents.url else { throw DSBotFailure.invalidLink }
        let routeItems = items.filter { $0.name == "lan" || $0.name == "public" }
        if !routeItems.isEmpty, probeId == nil { throw DSBotFailure.invalidLink }
        var routes = try routeItems.map { item -> ConnectionAddress in
            guard let value = item.value, let kind = ConnectionAddressKind(rawValue: item.name) else {
                throw DSBotFailure.invalidLink
            }
            return try ConnectionAddress.normalized(value, kind: kind)
        }
        var origin = httpComponents
        origin.path = ""
        guard let originURL = origin.string else { throw DSBotFailure.invalidLink }
        if !routes.contains(where: { $0.url == originURL }) {
            routes.insert(try ConnectionAddress.normalized(originURL), at: 0)
        }
        routes = try ConnectionAddress.validated(routes)
        return ConnectionEndpoint(
            originalURL: storedURL.absoluteString,
            httpURL: httpURL,
            token: token,
            computerId: computerId,
            name: displayName,
            addresses: routes,
            probeId: probeId
        )
    }

    static func saved(_ computer: Computer) throws -> ConnectionEndpoint {
        var endpoint = try parse(computer.url, name: computer.name)
        if let storedID = computer.computerId {
            if let linkID = endpoint.computerId, storedID != linkID { throw DSBotFailure.identityMismatch }
            endpoint.computerId = storedID
        }
        if let addresses = computer.addresses { endpoint.addresses = try ConnectionAddress.validated(addresses) }
        endpoint.probeId = computer.probeId ?? endpoint.probeId
        endpoint.addressesEdited = computer.addressesEdited == true
        if let id = endpoint.probeId {
            guard endpoint.computerId != nil, validIdentity(id) else { throw DSBotFailure.invalidLink }
        }
        return endpoint
    }

    func selecting(_ address: ConnectionAddress) throws -> ConnectionEndpoint {
        let route = try ConnectionAddress.normalized(address.url, kind: address.kind)
        guard var original = URLComponents(string: originalURL),
              var selected = URLComponents(string: route.url) else { throw DSBotFailure.invalidLink }
        original.scheme = selected.scheme
        original.host = selected.host
        original.port = selected.port
        original.path = "/dsbot"
        selected.path = "/dsbot"
        guard let stored = original.string, let http = selected.url else { throw DSBotFailure.invalidLink }
        var result = self
        result.originalURL = stored
        result.httpURL = http
        return result
    }

    static func validIdentity(_ value: String) -> Bool {
        value.range(of: #"^[A-Za-z0-9_-]{1,100}$"#, options: .regularExpression) != nil
    }

    private static func unwrapAppLink(_ input: String) throws -> String {
        guard let url = URL(string: input),
              let scheme = url.scheme?.lowercased(),
              scheme == "harness-mobile" || scheme == "dsbot"
        else { return input }
        guard url.host == "connect" else { throw DSBotFailure.invalidLink }
        let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        let targets = components?.queryItems?.filter { $0.name == "url" } ?? []
        guard targets.count == 1, let value = targets[0].value, !value.isEmpty else {
            throw DSBotFailure.invalidLink
        }
        return value
    }

    fileprivate static func isLocalHost(_ rawHost: String) -> Bool {
        let host = rawHost.lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "[]"))
            .replacingOccurrences(of: #"\.$"#, with: "", options: .regularExpression)
        if host == "localhost" || host.hasSuffix(".localhost") || host.hasSuffix(".local") {
            return true
        }

        var ipv4 = in_addr()
        if host.withCString({ inet_pton(AF_INET, $0, &ipv4) }) == 1 {
            let octets = withUnsafeBytes(of: &ipv4) { Array($0) }
            let first = Int(octets[0])
            let second = Int(octets[1])
            return first == 10 || first == 127
                || (first == 172 && (16...31).contains(second))
                || (first == 192 && second == 168)
                || (first == 169 && second == 254)
                || (first == 100 && (64...127).contains(second))
        }

        var ipv6 = in6_addr()
        if host.withCString({ inet_pton(AF_INET6, $0, &ipv6) }) == 1 {
            let bytes = withUnsafeBytes(of: &ipv6) { Array($0) }
            let loopback = bytes.dropLast().allSatisfy { $0 == 0 } && bytes.last == 1
            let uniqueLocal = (bytes[0] & 0xfe) == 0xfc
            let linkLocal = bytes[0] == 0xfe && (bytes[1] & 0xc0) == 0x80
            return loopback || uniqueLocal || linkLocal
        }
        return false
    }
}
