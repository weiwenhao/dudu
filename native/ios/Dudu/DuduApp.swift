import SwiftUI

@main
@MainActor
struct DuduApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @StateObject private var notifications = AppNotifications.shared
    @StateObject private var store: DuduStore
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG && targetEnvironment(simulator)
        FeedbackChannel.applyReviewOverrides()
        let store = ProcessInfo.processInfo.arguments.contains("-dudu-ui-review")
            ? SimulatorReviewFixture.makeStore() : DuduStore()
        #else
        let store = DuduStore()
        #endif
        _store = StateObject(wrappedValue: store)
    }

    var body: some Scene {
        WindowGroup {
            DuduRootView(store: store)
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
