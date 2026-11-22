import Combine
import Foundation
import UIKit
import UserNotifications

struct CollectorNotificationTarget: Equatable, Sendable {
    let id = UUID()
    let computerID: String

    init?(userInfo: [AnyHashable: Any]) {
        guard let value = userInfo["dudu"] as? [String: Any],
              value["version"] as? Int == 1,
              let computer = value["computerId"] as? String,
              !computer.isEmpty, computer.utf8.count <= 128,
              let collector = value["collectorId"] as? String,
              !collector.isEmpty, collector.utf8.count <= 200 else { return nil }
        computerID = computer
    }
}

/// The system presents APNs alerts in every App state. There is no second local-notification delivery path.
@MainActor
final class AppNotifications: ObservableObject {
    static let shared = AppNotifications()
    @Published private(set) var token: String?
    @Published private(set) var target: CollectorNotificationTarget?
    private let center = UNUserNotificationCenter.current()
    private var unreadCount: Int?
    private var desiredUnreadCount = 0
    private var badgeTask: Task<Void, Never>?

    func setUnreadCount(_ count: Int) {
        desiredUnreadCount = max(0, count)
        guard badgeTask == nil, unreadCount != desiredUnreadCount else { return }
        // Serialize system writes so a delayed old-computer result cannot restore its badge.
        badgeTask = Task {
            defer { badgeTask = nil }
            do {
                let settings = await center.notificationSettings()
                if settings.authorizationStatus == .notDetermined, desiredUnreadCount > 0 {
                    _ = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                }
                while unreadCount != desiredUnreadCount {
                    let next = desiredUnreadCount
                    try await center.setBadgeCount(next)
                    unreadCount = next
                }
            } catch { DuduLog.record("notifications.badge.fail", level: "warn") }
        }
    }

    func receivedToken(_ data: Data) {
        token = data.map { String(format: "%02x", $0) }.joined()
        DuduLog.record("notifications.token.ready")
    }

    func open(_ target: CollectorNotificationTarget) { self.target = target }
    func consumed(_ id: UUID) {
        if target?.id == id { target = nil }
    }

    func authorize() async -> Bool {
        do {
            let settings = await center.notificationSettings()
            let allowed: Bool
            switch settings.authorizationStatus {
            case .notDetermined:
                allowed = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            case .authorized, .provisional, .ephemeral:
                allowed = true
            default:
                allowed = false
            }
            if allowed { UIApplication.shared.registerForRemoteNotifications() }
            return allowed
        } catch {
            DuduLog.record("notifications.permission.fail", level: "warn")
            return false
        }
    }

    func synchronize(using store: DuduStore) async {
        guard store.status == .connected else { return }
        let generation = store.connectionRevision
        let computer = store.activeComputer?.id
        do {
            let state = try await store.request("notifications.state")
            guard !Task.isCancelled, generation == store.connectionRevision,
                  computer == store.activeComputer?.id else { return }
            guard state["configured"]?.boolValue == true else {
                if state["enabled"]?.boolValue == true {
                    DuduLog.record("notifications.unavailable", level: "warn", code: "APNS_NOT_CONFIGURED")
                }
                return
            }
            let settings = await center.notificationSettings()
            // A desktop opt-in may ask once on this phone; launching with every collector off never prompts.
            if settings.authorizationStatus == .notDetermined, state["enabled"]?.boolValue != true { return }
            let allowed = await authorize()
            guard !Task.isCancelled, generation == store.connectionRevision,
                  computer == store.activeComputer?.id else { return }
            if !allowed {
                _ = try await store.request("notifications.unregister")
                return
            }
            guard let token else { return } // The App delegate schedules synchronization when APNs supplies it.
            guard let environment = Bundle.main.object(forInfoDictionaryKey: "DuduAPNSEnvironment") as? String,
                  ["development", "production"].contains(environment) else {
                DuduLog.record("notifications.registration.fail", level: "warn", code: "APNS_ENVIRONMENT_INVALID")
                return
            }
            _ = try await store.request("notifications.register", [
                "token": .string(token), "environment": .string(environment)
            ])
            DuduLog.record("notifications.registration.ready")
        } catch {
            guard !Task.isCancelled, generation == store.connectionRevision else { return }
            DuduLog.networkFailure("notifications.registration.fail", error: error)
        }
    }

    /// Removing a reachable computer also removes this installation's push registration.
    func unregister(_ computer: Computer, using store: DuduStore) async {
        do {
            if computer.id == store.activeComputer?.id, store.status == .connected {
                _ = try await store.request("notifications.unregister", timeoutSeconds: 5)
            } else {
                let client = DuduHTTPClient()
                do {
                    let endpoint = try ConnectionEndpoint.saved(computer)
                    _ = try await client.connect(
                        endpoint: endpoint, expectedComputerId: computer.computerId ?? endpoint.computerId,
                        generation: 1, onEvent: { _ in }, onDisconnect: {}
                    )
                    _ = try await client.request("notifications.unregister", params: [:], timeoutSeconds: 5)
                    await client.disconnect()
                } catch {
                    await client.disconnect()
                    throw error
                }
            }
        } catch {
            // Local removal is still possible offline. Revoking pairing on the computer stops push authoritatively.
            DuduLog.networkFailure("notifications.unregister.fail", error: error)
        }
        if target?.computerID == computer.computerId { target = nil }
    }
}

final class NotificationAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        AppNotifications.shared.receivedToken(deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        DuduLog.record("notifications.token.fail", level: "warn", code: "APNS_REGISTRATION_FAILED")
    }

    /// The silent push that wakes the App while it is away (`BoardWake`). In front, the App is told on its own connection and reads the board itself.
    func application(
        _ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard let computerID = BoardWake.computerID(in: userInfo), application.applicationState != .active else {
            completionHandler(.noData)
            return
        }
        DuduLog.record("board.wake.received", state: "background")
        Task {
            let result = await BoardWake.run(computerID: computerID)
            completionHandler(result)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler(CollectorNotificationTarget(userInfo: notification.request.content.userInfo) == nil
            ? [] : [.banner, .list, .sound])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.actionIdentifier == UNNotificationDefaultActionIdentifier,
           let target = CollectorNotificationTarget(userInfo: response.notification.request.content.userInfo) {
            Task { @MainActor in AppNotifications.shared.open(target) }
        }
        completionHandler()
    }
}
