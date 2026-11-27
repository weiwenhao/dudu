import Foundation
import Darwin

/// The phone's own network and address, for the line under a connection that failed (owner, 2026-11-27: 「Q3 可以，但是这台手机这四个字换成 本机吧」: 「本机 · Wi-Fi · 192.168.31.88」), so that a screenshot of the
/// page says from where the phone tried to reach the computer. Read from the phone's interfaces: nothing is asked of the system, no permission, nothing is sent.
struct PhoneNetwork: Equatable {
    enum Kind: Equatable { case wifi, cellular, other }

    struct Interface: Equatable {
        let name: String
        let address: String
    }

    let kind: Kind
    let address: String

    /// The interface the phone reaches the network by, from the interfaces that have an IPv4 address: Wi-Fi (`en0`) first, then the cellular one (`pdp_ip…`), then another `en…` (a wire or a hotspot). Loopback,
    /// tunnels (VPN, AirDrop's `awdl`, the personal hotspot's bridge) are not where the phone's own address is.
    static func from(interfaces: [Interface]) -> PhoneNetwork? {
        func rank(_ name: String) -> Int? {
            if name == "en0" { return 0 }
            if name.hasPrefix("pdp_ip") { return 1 }
            if name.hasPrefix("en") { return 2 }
            return nil
        }
        let candidates = interfaces.compactMap { interface -> (Int, Interface)? in
            guard let rank = rank(interface.name) else { return nil }
            return (rank, interface)
        }
        guard let best = candidates.min(by: { $0.0 < $1.0 }) else { return nil }
        let kind: Kind = best.0 == 0 ? .wifi : best.0 == 1 ? .cellular : .other
        return PhoneNetwork(kind: kind, address: best.1.address)
    }

    /// 「本机 · Wi-Fi · 192.168.31.88」, 「本机 · 蜂窝网络 · 10.64.12.7」, or 「本机 · 192.168.31.88」 when it is neither.
    var footnote: String {
        let name: String?
        switch kind {
        case .wifi: name = "Wi-Fi"
        case .cellular: name = L10n.text("蜂窝网络")
        case .other: name = nil
        }
        return ([L10n.text("本机"), name, address].compactMap { $0 }).joined(separator: " · ")
    }

    static func current() -> PhoneNetwork? { from(interfaces: readInterfaces()) }

    /// Every interface that is up, not a loopback, with its IPv4 address.
    static func readInterfaces() -> [Interface] {
        var first: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&first) == 0, let start = first else { return [] }
        defer { freeifaddrs(first) }
        var result: [Interface] = []
        var cursor: UnsafeMutablePointer<ifaddrs>? = start
        while let current = cursor {
            defer { cursor = current.pointee.ifa_next }
            let flags = Int32(current.pointee.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0,
                  let address = current.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            result.append(Interface(name: String(cString: current.pointee.ifa_name), address: String(cString: host)))
        }
        return result
    }
}
