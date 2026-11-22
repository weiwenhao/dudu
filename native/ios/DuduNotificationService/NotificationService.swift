import UserNotifications

/// The notification extension (owner, 2026-11-22: 「Signal、Telegram 这类开源消息 App 就是这么做的，那你也这么做吧」). iOS starts it for a notice of a reply or a question (the push carries
/// `mutable-content`, host/native-board-announce.mjs) before the notice is shown, also when the App was swiped away and iOS will not wake it. In the seconds it has, it reads the board from the
/// computer and writes it into the Keychain (`BoardWakeRecord`), where the App reads it, so that opening the App shows the new rows and red dots at once. The notice itself is shown exactly as it came.
final class NotificationService: UNNotificationServiceExtension {
    private let lock = NSLock()
    private var handler: ((UNNotificationContent) -> Void)?
    private var content: UNNotificationContent?
    private var job: Task<Void, Never>?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        lock.lock()
        handler = contentHandler
        content = request.content
        lock.unlock()
        guard let computerID = BoardWakeFetch.computerID(in: request.content.userInfo) else { finish(); return }
        DuduLog.record("board.service.begin")
        job = Task { [weak self] in
            let written = await BoardWakeFetch.write(computerID: computerID)
            DuduLog.record("board.service.end", state: written ? "written" : "nothing")
            self?.finish()
        }
    }

    /// iOS is about to stop the extension: the notice is shown as it came.
    override func serviceExtensionTimeWillExpire() {
        job?.cancel()
        DuduLog.record("board.service.timeout", level: "warn")
        finish()
    }

    private func finish() {
        lock.lock()
        let next = handler
        let shown = content
        handler = nil
        lock.unlock()
        // The extension may be stopped the moment it hands the notice back: what it logged is written first.
        DuduLog.flush()
        if let next, let shown { next(shown) }
    }
}
