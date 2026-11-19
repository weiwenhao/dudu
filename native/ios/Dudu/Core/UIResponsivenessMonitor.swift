import CoreFoundation
import Foundation

private final class MainRunLoopState: @unchecked Sendable {
    private let lock = NSLock()
    private var enabled = false
    private var isProcessing = false
    private var processingStartedAt: TimeInterval = 0
    private var reportedCurrentInterval = false
    private var lastReportedAt = -Double.greatestFiniteMagnitude

    func start() {
        lock.lock()
        enabled = true
        isProcessing = false
        reportedCurrentInterval = false
        lastReportedAt = -Double.greatestFiniteMagnitude
        lock.unlock()
    }

    func stop() {
        lock.lock()
        enabled = false
        isProcessing = false
        reportedCurrentInterval = false
        lock.unlock()
    }

    func didWake(at uptime: TimeInterval) {
        lock.lock()
        if enabled {
            isProcessing = true
            processingStartedAt = uptime
            reportedCurrentInterval = false
        }
        lock.unlock()
    }

    func willWait(at uptime: TimeInterval) -> Double? {
        lock.lock()
        defer { lock.unlock() }
        guard enabled, isProcessing else { return nil }

        let elapsedMs = (uptime - processingStartedAt) * 1_000
        isProcessing = false
        return reportIfNeeded(elapsedMs: elapsedMs, uptime: uptime)
    }

    func activeStall(at uptime: TimeInterval) -> Double? {
        lock.lock()
        defer { lock.unlock() }
        guard enabled, isProcessing else { return nil }

        let elapsedMs = (uptime - processingStartedAt) * 1_000
        return reportIfNeeded(elapsedMs: elapsedMs, uptime: uptime)
    }

    private func reportIfNeeded(elapsedMs: Double, uptime: TimeInterval) -> Double? {
        guard elapsedMs >= 250, !reportedCurrentInterval else { return nil }
        guard uptime - lastReportedAt >= 10 else { return nil }
        reportedCurrentInterval = true
        lastReportedAt = uptime
        return elapsedMs
    }
}

@MainActor
final class UIResponsivenessMonitor {
    static let shared = UIResponsivenessMonitor()

    private let runLoopState = MainRunLoopState()
    private var observer: CFRunLoopObserver?
    private var watchdog: DispatchSourceTimer?

    private init() {}

    func start() {
        guard observer == nil, watchdog == nil else { return }
        runLoopState.start()

        let state = runLoopState
        let activities = CFRunLoopActivity.afterWaiting.rawValue
            | CFRunLoopActivity.beforeWaiting.rawValue
        guard let observer = CFRunLoopObserverCreateWithHandler(
            kCFAllocatorDefault,
            activities,
            true,
            0,
            { _, activity in
                let uptime = ProcessInfo.processInfo.systemUptime
                if activity.contains(.afterWaiting) {
                    state.didWake(at: uptime)
                }
                if activity.contains(.beforeWaiting), let elapsedMs = state.willWait(at: uptime) {
                    DispatchQueue.global(qos: .utility).async {
                        DuduLog.record("ui.main_thread_stall", elapsedMs: elapsedMs)
                    }
                }
            }
        ) else {
            runLoopState.stop()
            return
        }

        self.observer = observer
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)

        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(
            deadline: .now() + .milliseconds(200),
            repeating: .milliseconds(200),
            leeway: .milliseconds(50)
        )
        timer.setEventHandler {
            guard let elapsedMs = state.activeStall(at: ProcessInfo.processInfo.systemUptime) else {
                return
            }
            DuduLog.record("ui.main_thread_stall", elapsedMs: elapsedMs)
        }
        watchdog = timer
        timer.resume()
    }

    func stop() {
        runLoopState.stop()

        if let observer {
            CFRunLoopRemoveObserver(CFRunLoopGetMain(), observer, .commonModes)
            self.observer = nil
        }
        if let watchdog {
            watchdog.setEventHandler {}
            watchdog.cancel()
            self.watchdog = nil
        }
    }
}
