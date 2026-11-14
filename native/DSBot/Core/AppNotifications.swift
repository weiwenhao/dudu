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

    func receivedToken(_ data: Data) {
        token = data.map { String(format: "%02x", $0) }.joined()
        DSBotLog.record("notifications.token.ready")
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
                allowed = try await center.requestAuthorization(options: [.alert, .sound])
            case .authorized, .provisional, .ephemeral:
                allowed = true
            default:
                allowed = false
            }
            if allowed { UIApplication.shared.registerForRemoteNotifications() }
            return allowed
        } catch {
            DSBotLog.record("notifications.permission.fail", level: "warn")
            return false
        }
    }

    func synchronize(using store: DSBotStore) async {
        guard store.status == .connected else { return }
        let generation = store.connectionRevision
        let computer = store.activeComputer?.id
        do {
            let state = try await store.request("notifications.state")
            guard !Task.isCancelled, generation == store.connectionRevision,
                  computer == store.activeComputer?.id else { return }
            guard state["configured"]?.boolValue == true else {
                if state["enabled"]?.boolValue == true {
                    DSBotLog.record("notifications.unavailable", level: "warn", code: "APNS_NOT_CONFIGURED")
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
                DSBotLog.record("notifications.registration.fail", level: "warn", code: "APNS_ENVIRONMENT_INVALID")
                return
            }
            _ = try await store.request("notifications.register", [
                "token": .string(token), "environment": .string(environment)
            ])
            DSBotLog.record("notifications.registration.ready")
        } catch {
            guard !Task.isCancelled, generation == store.connectionRevision else { return }
            DSBotLog.networkFailure("notifications.registration.fail", error: error)
        }
    }

    /// Removing a reachable computer also removes this installation's push registration.
    func unregister(_ computer: Computer, using store: DSBotStore) async {
        do {
            if computer.id == store.activeComputer?.id, store.status == .connected {
                _ = try await store.request("notifications.unregister", timeoutSeconds: 5)
            } else {
                let client = DSBotHTTPClient()
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
            DSBotLog.networkFailure("notifications.unregister.fail", error: error)
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
        DSBotLog.record("notifications.token.fail", level: "warn", code: "APNS_REGISTRATION_FAILED")
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
