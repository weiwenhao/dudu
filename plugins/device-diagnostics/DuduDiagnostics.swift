import Foundation
import OSLog
import UIKit

private let duduDiagnosticsExceptionHandler: @convention(c) (NSException) -> Void = {
  exception in
  DuduDiagnostics.captureUncaughtException(exception)
}

private struct KeyboardSnapshot {
  let timestamp: Date
  let beginFrame: CGRect?
  let endFrame: CGRect?
  let duration: TimeInterval
  let animationCurve: Int?
  let isLocal: Bool?
}

private final class BackgroundFlushTask {
  private let lock = NSLock()
  private var identifier = UIBackgroundTaskIdentifier.invalid
  private var isFinished = false

  init() {
    identifier = UIApplication.shared.beginBackgroundTask(
      withName: "DuduDiagnosticsFlush"
    ) { [weak self] in
      self?.finish()
    }
  }

  func finish() {
    lock.lock()
    guard !isFinished else {
      lock.unlock()
      return
    }
    isFinished = true
    let taskIdentifier = identifier
    identifier = .invalid
    lock.unlock()

    guard taskIdentifier != .invalid else {
      return
    }

    if Thread.isMainThread {
      UIApplication.shared.endBackgroundTask(taskIdentifier)
    } else {
      DispatchQueue.main.async {
        UIApplication.shared.endBackgroundTask(taskIdentifier)
      }
    }
  }
}

enum DuduDiagnostics {
  private static let workQueue = DispatchQueue(
    label: "com.harnessmobile.native-diagnostics",
    qos: .utility
  )
  private static let startLock = NSLock()
  private static let storageLock = NSRecursiveLock()
  private static let segmentPattern =
    try? NSRegularExpression(pattern: #"^native-[0-9]{8}\.jsonl$"#)
  private static let temporarySegmentPattern =
    try? NSRegularExpression(pattern: #"^native-[0-9]{8}\.jsonl\.tmp$"#)
  private static let urlPattern =
    try? NSRegularExpression(pattern: #"(?i)\b[a-z][a-z0-9+.-]*://[^\s"'<>]+"#)
  private static let credentialPattern = try? NSRegularExpression(
    pattern: #"(?i)(\b(?:password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|authorization|api[_-]?key|secret|client[_-]?secret|cookie|set-cookie)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|Bearer\s+[A-Za-z0-9._~+/-]+=*|Basic\s+[A-Za-z0-9+/=]+|[^\s,;&}]+)"#
  )
  private static let timestampFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let segmentLimit = 256 * 1024
  private static let totalLimit = 4 * 1024 * 1024
  private static let retention: TimeInterval = 7 * 24 * 60 * 60
  private static let maxEntriesPerRead = 500
  private static let maxRecentLogSignatures = 4096

  private static var started = false
  private static var observers: [NSObjectProtocol] = []
  private static var logTimer: DispatchSourceTimer?
  private static var previousExceptionHandler: NSUncaughtExceptionHandler?
  private static var didReportOSLogFailure = false
  private static var lastOSLogDate: Date?
  private static var recentOSLogSignatures = Set<Int>()
  private static var recentOSLogOrder: [Int] = []

  private static var storageDirectory: URL?
  private static var activeSegmentIndex: UInt64?
  private static var activeSegmentSize = 0
  private static var nextSegmentIndex: UInt64 = 1

  static func start() {
    startLock.lock()
    guard !started else {
      startLock.unlock()
      return
    }
    started = true
    startLock.unlock()

    previousExceptionHandler = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler(duduDiagnosticsExceptionHandler)

    workQueue.async {
      let version =
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        ?? "unknown"
      let build =
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        ?? "unknown"
      writeEvent(
        event: "app.start",
        level: "info",
        timestamp: Date(),
        data: [
          "version": version,
          "build": build,
        ]
      )
      pollCurrentProcessLogs()
      installLogTimer()
    }

    installObservers()
  }

  private static func installObservers() {
    let lifecycleNotifications: [(Notification.Name, String)] = [
      (UIApplication.didBecomeActiveNotification, "active"),
      (UIApplication.willResignActiveNotification, "will_resign_active"),
      (UIApplication.didEnterBackgroundNotification, "background"),
      (UIApplication.willEnterForegroundNotification, "foreground"),
      (UIApplication.willTerminateNotification, "will_terminate"),
    ]

    for (name, state) in lifecycleNotifications {
      let observer = NotificationCenter.default.addObserver(
        forName: name,
        object: nil,
        queue: nil
      ) { _ in
        let timestamp = Date()
        if state == "background" {
          scheduleBackgroundFlush(timestamp: timestamp)
        } else {
          workQueue.async {
            writeEvent(
              event: "app.lifecycle",
              level: "info",
              timestamp: timestamp,
              data: ["state": state]
            )
          }
        }
      }
      observers.append(observer)
    }

    let keyboardNotifications: [(Notification.Name, String)] = [
      (UIResponder.keyboardWillShowNotification, "show"),
      (UIResponder.keyboardWillHideNotification, "hide"),
      (UIResponder.keyboardWillChangeFrameNotification, "frame_change"),
    ]

    for (name, eventName) in keyboardNotifications {
      let observer = NotificationCenter.default.addObserver(
        forName: name,
        object: nil,
        queue: nil
      ) { notification in
        let userInfo = notification.userInfo ?? [:]
        let snapshot = KeyboardSnapshot(
          timestamp: Date(),
          beginFrame: (userInfo[UIResponder.keyboardFrameBeginUserInfoKey] as? NSValue)?
            .cgRectValue,
          endFrame: (userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?
            .cgRectValue,
          duration: (userInfo[UIResponder.keyboardAnimationDurationUserInfoKey] as? NSNumber)?
            .doubleValue ?? 0,
          animationCurve: (userInfo[UIResponder.keyboardAnimationCurveUserInfoKey] as? NSNumber)?
            .intValue,
          isLocal: (userInfo[UIResponder.keyboardIsLocalUserInfoKey] as? NSNumber)?.boolValue
        )

        workQueue.async {
          var data: [String: Any] = [
            "durationSeconds": snapshot.duration,
          ]
          if let frame = snapshot.beginFrame {
            data["beginFrame"] = frameData(frame)
          }
          if let frame = snapshot.endFrame {
            data["endFrame"] = frameData(frame)
          }
          if let curve = snapshot.animationCurve {
            data["animationCurve"] = curve
          }
          if let isLocal = snapshot.isLocal {
            data["isLocal"] = isLocal
          }
          writeEvent(
            event: "keyboard.\(eventName)",
            level: "info",
            timestamp: snapshot.timestamp,
            data: data
          )
        }
      }
      observers.append(observer)
    }
  }

  private static func scheduleBackgroundFlush(timestamp: Date) {
    let beginFlush = {
      let task = BackgroundFlushTask()
      workQueue.async {
        writeEvent(
          event: "app.lifecycle",
          level: "info",
          timestamp: timestamp,
          data: ["state": "background"]
        )
        pollCurrentProcessLogs()
        synchronizeActiveSegment()
        DispatchQueue.main.async {
          task.finish()
        }
      }
    }

    if Thread.isMainThread {
      beginFlush()
    } else {
      DispatchQueue.main.async(execute: beginFlush)
    }
  }

  private static func installLogTimer() {
    let timer = DispatchSource.makeTimerSource(queue: workQueue)
    timer.schedule(
      deadline: .now() + .seconds(10),
      repeating: .seconds(10),
      leeway: .seconds(2)
    )
    timer.setEventHandler {
      pollCurrentProcessLogs()
    }
    logTimer = timer
    timer.resume()
  }

  private static func pollCurrentProcessLogs() {
    guard #available(iOS 15.0, *) else {
      reportOSLogFailure(domain: "OSLogStore", code: 15)
      return
    }

    do {
      let store = try OSLogStore(scope: .currentProcessIdentifier)
      let startDate = lastOSLogDate?.addingTimeInterval(-1) ?? .distantPast
      let position = store.position(date: startDate)
      let entries = try store.getEntries(at: position)
      var capturedEntries: [OSLogEntry] = []
      capturedEntries.reserveCapacity(maxEntriesPerRead)

      for entry in entries {
        if let lastOSLogDate,
           entry.date < lastOSLogDate.addingTimeInterval(-1) {
          continue
        }

        let signature = logSignature(entry)
        guard !recentOSLogSignatures.contains(signature) else {
          continue
        }
        guard capturedEntries.count < maxEntriesPerRead else {
          break
        }

        rememberLogSignature(signature)
        if lastOSLogDate == nil || entry.date > lastOSLogDate! {
          lastOSLogDate = entry.date
        }
        capturedEntries.append(entry)
      }

      for entry in capturedEntries {
        var data: [String: Any] = [
          "entryType": String(describing: type(of: entry)),
          "message": entry.composedMessage,
        ]
        if let processEntry = entry as? OSLogEntryFromProcess {
          data["process"] = processEntry.process
          data["processIdentifier"] = processEntry.processIdentifier
          data["threadIdentifier"] = processEntry.threadIdentifier
        }

        if let logEntry = entry as? OSLogEntryLog {
          data["category"] = logEntry.category
          data["subsystem"] = logEntry.subsystem
          data["storeCategory"] = String(describing: logEntry.storeCategory)
          writeEvent(
            event: "oslog.entry",
            level: levelName(logEntry.level),
            timestamp: entry.date,
            data: data
          )
        } else {
          data["storeCategory"] = String(describing: entry.storeCategory)
          writeEvent(
            event: "oslog.entry",
            level: "info",
            timestamp: entry.date,
            data: data
          )
        }
      }
    } catch {
      let nsError = error as NSError
      reportOSLogFailure(domain: nsError.domain, code: nsError.code)
    }
  }

  private static func levelName(_ level: OSLogEntryLog.Level) -> String {
    switch level {
    case .undefined:
      return "info"
    case .debug:
      return "debug"
    case .info:
      return "info"
    case .notice:
      return "notice"
    case .error:
      return "error"
    case .fault:
      return "fault"
    @unknown default:
      return "info"
    }
  }

  private static func reportOSLogFailure(domain: String, code: Int) {
    guard !didReportOSLogFailure else {
      return
    }
    didReportOSLogFailure = true
    writeEvent(
      event: "oslog.read_error",
      level: "warning",
      timestamp: Date(),
      data: ["errorDomain": domain, "errorCode": code]
    )
  }

  private static func logSignature(_ entry: OSLogEntry) -> Int {
    var hasher = Hasher()
    hasher.combine(entry.date.timeIntervalSinceReferenceDate)
    hasher.combine(entry.composedMessage)
    hasher.combine(String(describing: type(of: entry)))
    if let processEntry = entry as? OSLogEntryFromProcess {
      hasher.combine(processEntry.processIdentifier)
      hasher.combine(processEntry.threadIdentifier)
    }
    if let payloadEntry = entry as? OSLogEntryWithPayload {
      hasher.combine(payloadEntry.subsystem)
      hasher.combine(payloadEntry.category)
    }
    return hasher.finalize()
  }

  private static func rememberLogSignature(_ signature: Int) {
    recentOSLogSignatures.insert(signature)
    recentOSLogOrder.append(signature)
    if recentOSLogOrder.count > maxRecentLogSignatures {
      let expired = recentOSLogOrder.removeFirst()
      recentOSLogSignatures.remove(expired)
    }
  }

  private static func frameData(_ frame: CGRect) -> [String: Double] {
    [
      "x": Double(frame.origin.x),
      "y": Double(frame.origin.y),
      "width": Double(frame.size.width),
      "height": Double(frame.size.height),
    ]
  }

  static func captureUncaughtException(_ exception: NSException) {
    let stack = Array(exception.callStackSymbols.prefix(20)).map {
      limited($0, to: 256)
    }
    writeEvent(
      event: "exception.uncaught",
      level: "fault",
      timestamp: Date(),
      data: [
        "name": limited(exception.name.rawValue, to: 256),
        "reason": limited(exception.reason ?? "unknown", to: 4096),
        "callStack": stack,
      ]
    )
    synchronizeActiveSegment()
    previousExceptionHandler?(exception)
  }

  private static func writeEvent(
    event: String,
    level: String,
    timestamp: Date,
    data: [String: Any]
  ) {
    storageLock.lock()
    defer { storageLock.unlock() }

    do {
      let record: [String: Any] = [
        "timestamp": timestampFormatter.string(from: timestamp),
        "source": "native",
        "level": level,
        "event": event,
        "data": sanitize(data),
      ]
      var line = try JSONSerialization.data(
        withJSONObject: record,
        options: [.sortedKeys]
      )
      line.append(0x0A)
      try appendLine(line)
    } catch {
      // Diagnostics failures must not affect app execution or report through OSLog.
    }
  }

  private static func sanitize(_ value: Any) -> Any {
    if let string = value as? String {
      return limited(redact(string), to: 4096)
    }
    if let dictionary = value as? [String: Any] {
      return dictionary.mapValues { sanitize($0) }
    }
    if let array = value as? [Any] {
      return array.map { sanitize($0) }
    }
    return value
  }

  private static func redact(_ value: String) -> String {
    var result = value

    if let urlPattern {
      let matches = urlPattern.matches(
        in: result,
        range: NSRange(result.startIndex..., in: result)
      )
      for match in matches.reversed() {
        guard let range = Range(match.range, in: result) else {
          continue
        }
        let original = String(result[range])
        result.replaceSubrange(range, with: redactedURL(original))
      }
    }

    if let credentialPattern {
      let fullRange = NSRange(result.startIndex..., in: result)
      result = credentialPattern.stringByReplacingMatches(
        in: result,
        range: fullRange,
        withTemplate: "$1[REDACTED]"
      )
    }
    return result
  }

  private static func redactedURL(_ value: String) -> String {
    var core = value
    var trailingPunctuation = ""
    while let last = core.last, ".,;)]}".contains(last) {
      trailingPunctuation.insert(last, at: trailingPunctuation.startIndex)
      core.removeLast()
    }

    guard var components = URLComponents(string: core) else {
      return "[URL]" + trailingPunctuation
    }
    components.user = nil
    components.password = nil
    components.query = nil
    components.fragment = nil
    return (components.string ?? "[URL]") + trailingPunctuation
  }

  private static func limited(_ value: String, to maxCharacters: Int) -> String {
    guard value.count > maxCharacters else {
      return value
    }
    return String(value.prefix(maxCharacters)) + "...[truncated]"
  }

  private static func appendLine(_ line: Data) throws {
    try prepareStorageIfNeeded()
    guard let directory = storageDirectory else {
      return
    }
    pruneSegments(reserving: line.count)

    let currentURL = activeSegmentIndex.map { segmentURL($0, in: directory) }
    if let currentURL,
       let currentIndex = activeSegmentIndex,
       FileManager.default.fileExists(atPath: currentURL.path),
       fileSize(currentURL) + line.count <= segmentLimit {
      let handle = try FileHandle(forWritingTo: currentURL)
      do {
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
        try handle.close()
        activeSegmentIndex = currentIndex
        activeSegmentSize = fileSize(currentURL)
      } catch {
        try? handle.close()
        throw error
      }
    } else {
      try createSegment(with: line, in: directory)
    }
  }

  private static func prepareStorageIfNeeded() throws {
    guard storageDirectory == nil else {
      return
    }

    guard let documents = FileManager.default.urls(
      for: .documentDirectory,
      in: .userDomainMask
    ).first else {
      return
    }

    let directory = documents
      .appendingPathComponent("diagnostics", isDirectory: true)
      .appendingPathComponent("native", isDirectory: true)
    try FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    storageDirectory = directory
    removeInterruptedTemporarySegments()
    pruneSegments()

    let segments = knownSegments()
    if let latest = segments.max(by: { $0.index < $1.index }) {
      activeSegmentIndex = latest.index
      nextSegmentIndex = latest.index == UInt64.max ? 1 : latest.index + 1
      repairIncompleteTail(at: segmentURL(latest.index, in: directory))
      activeSegmentSize = fileSize(segmentURL(latest.index, in: directory))
    } else {
      activeSegmentIndex = nil
      activeSegmentSize = 0
      nextSegmentIndex = 1
    }
  }

  private static func createSegment(with line: Data, in directory: URL) throws {
    while true {
      let index = nextSegmentIndex
      nextSegmentIndex = index == UInt64.max ? 1 : index + 1
      let destination = segmentURL(index, in: directory)
      let temporary = directory.appendingPathComponent(segmentName(index) + ".tmp")

      if FileManager.default.fileExists(atPath: destination.path) {
        continue
      }
      if FileManager.default.fileExists(atPath: temporary.path) {
        try? FileManager.default.removeItem(at: temporary)
      }

      try line.write(to: temporary)
      try FileManager.default.moveItem(at: temporary, to: destination)
      activeSegmentIndex = index
      activeSegmentSize = line.count
      return
    }
  }

  private static func synchronizeActiveSegment() {
    storageLock.lock()
    defer { storageLock.unlock() }

    guard let directory = storageDirectory,
          let index = activeSegmentIndex else {
      return
    }
    let handle = try? FileHandle(forWritingTo: segmentURL(index, in: directory))
    try? handle?.synchronize()
    try? handle?.close()
  }

  private static func repairIncompleteTail(at url: URL) {
    guard let data = try? Data(contentsOf: url),
          let lastByte = data.last,
          lastByte != 0x0A else {
      return
    }

    let validLength = data.lastIndex(of: 0x0A).map { $0 + 1 } ?? 0
    let validData = Data(data.prefix(validLength))
    guard let handle = try? FileHandle(forWritingTo: url) else {
      return
    }
    try? handle.truncate(atOffset: 0)
    try? handle.write(contentsOf: validData)
    try? handle.synchronize()
    try? handle.close()
  }

  private static func removeInterruptedTemporarySegments() {
    guard let directory = storageDirectory,
          let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path),
          let temporarySegmentPattern else {
      return
    }

    for name in names where temporarySegmentPattern.firstMatch(
      in: name,
      range: NSRange(name.startIndex..., in: name)
    ) != nil {
      try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
    }
  }

  private static func pruneSegments(reserving additionalBytes: Int = 0) {
    guard storageDirectory != nil else {
      return
    }

    let now = Date()
    var segments = knownSegments()
    for segment in segments where now.timeIntervalSince(segment.modifiedAt) > retention {
      try? FileManager.default.removeItem(at: segment.url)
      if activeSegmentIndex == segment.index {
        activeSegmentIndex = nil
        activeSegmentSize = 0
      }
    }

    segments = knownSegments().sorted { $0.index < $1.index }
    var totalSize = segments.reduce(0) { $0 + $1.size }
    let targetSize = max(0, totalLimit - additionalBytes)
    for segment in segments where totalSize > targetSize {
      guard activeSegmentIndex != segment.index else {
        continue
      }
      try? FileManager.default.removeItem(at: segment.url)
      totalSize -= segment.size
    }
  }

  private static func knownSegments() -> [NativeSegment] {
    guard let directory = storageDirectory,
          let names = try? FileManager.default.contentsOfDirectory(atPath: directory.path),
          let segmentPattern else {
      return []
    }

    return names.compactMap { name in
      guard segmentPattern.firstMatch(
        in: name,
        range: NSRange(name.startIndex..., in: name)
      ) != nil,
      let index = UInt64(name.dropFirst("native-".count).dropLast(".jsonl".count)) else {
        return nil
      }

      let url = directory.appendingPathComponent(name)
      guard let values = try? url.resourceValues(
        forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey]
      ),
      values.isRegularFile == true,
      values.isSymbolicLink != true else {
        return nil
      }

      return NativeSegment(
        index: index,
        url: url,
        size: values.fileSize ?? 0,
        modifiedAt: values.contentModificationDate ?? .distantPast
      )
    }
  }

  private static func fileSize(_ url: URL) -> Int {
    (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
  }

  private static func segmentName(_ index: UInt64) -> String {
    String(format: "native-%08llu.jsonl", index)
  }

  private static func segmentURL(_ index: UInt64, in directory: URL) -> URL {
    directory.appendingPathComponent(segmentName(index))
  }
}

private struct NativeSegment {
  let index: UInt64
  let url: URL
  let size: Int
  let modifiedAt: Date
}
