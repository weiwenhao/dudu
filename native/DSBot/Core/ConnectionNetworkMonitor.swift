import Foundation
import Network

protocol ConnectionNetworkMonitoring: Sendable {
    func start(onChange: @escaping @Sendable () -> Void)
}

/// A path callback can repeat while requests start and stop. Only a change in
/// reachability or the interfaces carrying traffic warrants selecting another route.
struct ConnectionNetworkPathChanges {
    struct State: Equatable {
        let isReachable: Bool
        let interfaces: Set<String>
    }

    private var previous: State?

    mutating func update(_ state: State) -> Bool {
        let changed = previous.map { $0 != state } ?? false
        previous = state
        return changed
    }
}

/// NWPathMonitor delivers changes on one private queue. The first snapshot belongs
/// to ordinary startup; subsequent equivalent snapshots must not interrupt it.
final class ConnectionNetworkMonitor: ConnectionNetworkMonitoring, @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "dudu.connection.path", qos: .utility)
    private var changes = ConnectionNetworkPathChanges()

    func start(onChange: @escaping @Sendable () -> Void) {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let kinds: [(NWInterface.InterfaceType, String)] = [
                (.wifi, "wifi"), (.cellular, "cellular"), (.wiredEthernet, "wired"),
                (.loopback, "loopback"), (.other, "other")
            ]
            let interfaces = Set(kinds.compactMap { path.usesInterfaceType($0.0) ? $0.1 : nil })
            let state = ConnectionNetworkPathChanges.State(
                isReachable: path.status == .satisfied, interfaces: interfaces
            )
            guard self.changes.update(state) else { return }
            DSBotLog.record(
                "network.path.observed",
                state: state.isReachable ? interfaces.sorted().joined(separator: ".") : "unreachable"
            )
            onChange()
        }
        monitor.start(queue: queue)
    }

    deinit { monitor.cancel() }
}
