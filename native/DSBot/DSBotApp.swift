import SwiftUI

@main
@MainActor
struct DSBotApp: App {
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
                .preferredColorScheme(.light)
                .onChange(of: scenePhase, initial: true) { _, phase in
                    if phase == .active {
                        UIResponsivenessMonitor.shared.start()
                        store.resume()
                    } else {
                        UIResponsivenessMonitor.shared.stop()
                        if phase == .background { store.suspend() }
                    }
                }
        }
    }
}
