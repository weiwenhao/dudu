import SwiftUI

@main
@MainActor
struct DSBotApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @StateObject private var notifications = AppNotifications.shared
    @StateObject private var store: DSBotStore
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG && targetEnvironment(simulator)
        let store = ProcessInfo.processInfo.arguments.contains("-dsbot-ui-review")
            ? SimulatorReviewFixture.makeStore() : DSBotStore()
        #else
        let store = DSBotStore()
        #endif
        _store = StateObject(wrappedValue: store)
    }

    var body: some Scene {
        WindowGroup {
            DSBotRootView(store: store)
                .environment(\.locale, L10n.locale)
                .preferredColorScheme(.light)
                .task(id: "\(store.connectionRevision)/\(store.status)/\(notifications.token ?? "")") {
                    await notifications.synchronize(using: store)
                }
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active {
                        UIResponsivenessMonitor.shared.start()
                        UserActionRecorder.shared.install()
                        store.resume()
                    } else {
                        UIResponsivenessMonitor.shared.stop()
                        if phase == .background { store.suspend() }
                    }
                }
        }
    }
}
