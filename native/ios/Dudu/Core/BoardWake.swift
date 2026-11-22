import Foundation
import UIKit

/// The phone woken while it was away (owner, 2026-11-22: 「通过通知唤醒，然后将消息写入，避免打开手机 app 后拉几秒消息」). When the board changes and the App is not in front, the computer sends one
/// silent push (host/native-board-wake.mjs: no alert, no sound, no number). iOS gives the App a few seconds, in which it reads the board once and writes it where opening the App finds it
/// (`BoardSnapshot`, shown at once by `BoardModel.adoptNewerSnapshot`). It sends no read receipt and changes no badge. With no saved computer, or with the Keychain still locked (the phone has
/// not been unlocked since it started and the App was not in memory), it does nothing.
enum BoardWake {
    /// The seconds the whole wake may take: iOS allows about thirty before it stops the App and counts the wake against it.
    static let budgetSeconds: UInt64 = BoardWakeFetch.budgetSeconds

    /// The computer a wake push names, or nil for any other push.
    static func computerID(in userInfo: [AnyHashable: Any]) -> String? { BoardWakeFetch.computerID(in: userInfo) }

    /// Reads the board of `computerID` once and writes it down, within the budget. `.newData` if what it wrote differs from what was written before.
    static func run(
        computerID: String,
        repository: any DuduComputerStorage = ComputerRepository.shared,
        client: any DuduTransport = DuduHTTPClient(),
        storage: any DuduBoardStorage = FileBoardStorage.shared,
        now: @escaping @Sendable () -> Date = { Date() },
        budgetSeconds: UInt64 = BoardWake.budgetSeconds
    ) async -> UIBackgroundFetchResult {
        await withCheckedContinuation { continuation in
            let gate = Gate(continuation)
            let job = Task {
                gate.finish(await work(computerID: computerID, repository: repository, client: client, storage: storage, now: now))
            }
            // The wake must end in time even if a request does not answer: the work is cancelled and iOS is told it failed.
            Task {
                try? await Task.sleep(nanoseconds: budgetSeconds * 1_000_000_000)
                job.cancel()
                DuduLog.record("board.wake.timeout", level: "warn")
                gate.finish(.failed)
            }
        }
    }

    private static func work(
        computerID: String, repository: any DuduComputerStorage, client: any DuduTransport,
        storage: any DuduBoardStorage, now: @Sendable () -> Date
    ) async -> UIBackgroundFetchResult {
        let started = Date()
        do {
            // The same question the board asks when it refreshes, and nothing else: a read of the list, never a read receipt.
            guard let value = try await BoardWakeFetch.read(computerID: computerID, repository: repository, client: client) else {
                DuduLog.record("board.wake.skip", state: "unknown_computer")
                return .noData
            }
            let answer = try await DuduJSON().decode(BoardAnswer.self, from: value)
            guard answer.outcome == "success", let rows = answer.conversations else { throw DuduFailure.protocolError }
            let prepared = await BoardPreviewPreparation().prepare(rows)
            let snapshot = BoardSnapshot(
                computerID: computerID, conversationsByTab: [BoardTab.all.rawValue: prepared], pins: answer.pins ?? [],
                unreadCount: BoardConversation.unreadSessionCount(in: prepared), filterStatuses: answer.statuses ?? [], savedAt: now()
            )
            try snapshot.validate(for: computerID)
            let before = try? await storage.load(for: computerID)
            let changed = before != snapshot
            if changed { try await storage.save(snapshot) }
            DuduLog.record(
                "board.wake.done", elapsedMs: Date().timeIntervalSince(started) * 1_000,
                counts: ["rowCount": prepared.count], state: changed ? "written" : "same"
            )
            return changed ? .newData : .noData
        } catch {
            DuduLog.networkFailure("board.wake.fail", error: error, elapsedMs: Date().timeIntervalSince(started) * 1_000)
            return .failed
        }
    }

    /// Hands the result back once, to whichever of the work and the clock finishes first.
    private final class Gate: @unchecked Sendable {
        private let lock = NSLock()
        private var continuation: CheckedContinuation<UIBackgroundFetchResult, Never>?

        init(_ continuation: CheckedContinuation<UIBackgroundFetchResult, Never>) { self.continuation = continuation }

        func finish(_ result: UIBackgroundFetchResult) {
            lock.lock()
            let next = continuation
            continuation = nil
            lock.unlock()
            next?.resume(returning: result)
        }
    }
}
