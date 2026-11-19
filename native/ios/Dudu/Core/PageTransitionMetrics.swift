import QuartzCore

/// Let the prepared page finish its layout before starting its horizontal animation.
@MainActor
final class PagePresentationFrame: NSObject {
    private var displayLink: CADisplayLink?
    private var action: (() -> Void)?

    func afterLayout(_ action: @escaping () -> Void) {
        cancel()
        self.action = action
        let link = CADisplayLink(target: self, selector: #selector(present))
        displayLink = link
        link.add(to: .main, forMode: .common)
    }

    func cancel() {
        displayLink?.invalidate()
        displayLink = nil
        action = nil
    }

    @objc private func present() {
        let callback = action
        cancel()
        callback?()
    }
}

/// Samples only an active page transition. Display-link gaps are diagnostics, not rendered-frame measurements.
@MainActor
final class PageTransitionMetrics: NSObject {
    private var displayLink: CADisplayLink?
    private var direction = ""
    private var startedAt: TimeInterval = 0
    private var previousTimestamp: TimeInterval?
    private var longestInterval: TimeInterval = 0
    private var frameCount = 0
    private var lateFrameCount = 0

    func start(direction: String) {
        finish()
        self.direction = direction
        startedAt = CACurrentMediaTime()
        previousTimestamp = nil
        longestInterval = 0
        frameCount = 0
        lateFrameCount = 0
        let link = CADisplayLink(target: self, selector: #selector(sample(_:)))
        displayLink = link
        link.add(to: .main, forMode: .common)
    }

    func finish() {
        guard displayLink != nil else { return }
        DuduLog.record(
            "board.transition.frames",
            elapsedMs: (CACurrentMediaTime() - startedAt) * 1_000,
            counts: ["frameCount": frameCount, "lateFrameCount": lateFrameCount],
            geometry: ["longestFrameMs": longestInterval * 1_000],
            state: direction
        )
        cancel()
    }

    func cancel() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func sample(_ link: CADisplayLink) {
        frameCount += 1
        let interval = previousTimestamp.map { link.timestamp - $0 }
            ?? max(0, CACurrentMediaTime() - startedAt)
        longestInterval = max(longestInterval, interval)
        let expected = link.targetTimestamp - link.timestamp
        if expected > 0, interval > expected * 1.5 { lateFrameCount += 1 }
        previousTimestamp = link.timestamp
    }
}
