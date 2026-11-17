import Foundation

enum SessionActivityPanel: String, Identifiable {
    /// `tasks`: the scheduled tasks that go into the conversation (`SessionTasksSheet`; it reads the task list, not `session.team` or `session.jobs`).
    case team, jobs, tasks
    var id: String { rawValue }
    var title: String {
        switch self {
        case .team: return L10n.text("智能体团队")
        case .jobs: return L10n.text("后台任务")
        case .tasks: return L10n.text("定时任务")
        }
    }
}

struct SessionActivityRequest: Identifiable {
    let id = UUID()
    let panel: SessionActivityPanel
    let computerID: String
    let session: SessionSummary
}

struct SessionTeamMember: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let session: SessionSummary
    let name: String
    let modelId: String?
    let state: String
    let canOpen: Bool

    var statusText: String {
        switch state {
        case "working": return L10n.text("工作中")
        case "completed": return L10n.text("已完成")
        case "failed": return L10n.text("失败")
        case "blocked": return L10n.text("需要你")
        default: return L10n.text("空闲中")
        }
    }
}

struct SessionBackgroundJob: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let status: String
    let startedAt: Double
    let finishedAt: Double?
    let detail: String?

    var isLive: Bool { status == "running" || status == "stopping" }
    var statusText: String {
        switch status {
        case "running", "stopping": return L10n.text("运行中")
        case "completed": return L10n.text("已完成")
        case "killed": return L10n.text("已停止")
        default: return L10n.text("失败")
        }
    }

    func elapsed(at now: Date) -> String {
        let seconds = max(0, Int(((finishedAt ?? now.timeIntervalSince1970 * 1000) - startedAt) / 1000))
        if seconds >= 3600 { return L10n.text("{0}小时{1}分", "\(seconds / 3600)", "\(seconds % 3600 / 60)") }
        if seconds >= 60 { return L10n.text("{0}分{1}秒", "\(seconds / 60)", "\(seconds % 60)") }
        return L10n.text("{0}秒", "\(seconds)")
    }

    var startTime: String {
        Date(timeIntervalSince1970: startedAt / 1000).formatted(
            .dateTime.month().day().hour().minute().locale(L10n.locale)
        )
    }
}

private struct SessionTeamAnswer: Decodable, Sendable { let members: [SessionTeamMember] }
private struct SessionJobsAnswer: Decodable, Sendable { let jobs: [SessionBackgroundJob] }
private struct SessionJobOutput: Decodable, Sendable { let job: SessionBackgroundJob; let text: String }

/// Reads only while its sheet is visible. A failed request ends that reading; opening a page is a fresh explicit read.
@MainActor
final class SessionActivityModel: ObservableObject {
    @Published private(set) var members: [SessionTeamMember] = []
    @Published private(set) var jobs: [SessionBackgroundJob] = []
    @Published private(set) var output = ""
    @Published private(set) var isLoading = true
    @Published private(set) var failure: String?
    @Published private(set) var stoppingID: String?
    private let json = DSBotJSON()
    private var refreshRevision = 0

    func read(_ request: SessionActivityRequest, jobID: String?, using store: DSBotStore) async {
        failure = nil
        if jobID != nil { output = ""; isLoading = true }
        while !Task.isCancelled {
            guard request.computerID == store.activeComputer?.id,
                  request.session.id == store.selectedSession?.id else { return }
            do {
                try await refresh(request, jobID: jobID, using: store)
                guard !Task.isCancelled else { return }
                isLoading = false
                if let jobID, jobs.first(where: { $0.id == jobID })?.isLive == false { return }
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                failure = error.localizedDescription
                isLoading = false
                DSBotLog.networkFailure(
                    "session.activity.read.fail", error: error,
                    method: jobID != nil ? "session.job.output" : request.panel == .team ? "session.team" : "session.jobs"
                )
                return
            }
            do { try await Task.sleep(for: .seconds(3)) } catch { return }
        }
    }

    private func refresh(_ request: SessionActivityRequest, jobID: String?, using store: DSBotStore) async throws {
        refreshRevision &+= 1
        let revision = refreshRevision
        var parameters: [String: JSONValue] = ["id": .string(request.session.id)]
        if let jobID {
            parameters["jobId"] = .string(jobID)
            let value = try await store.request("session.job.output", parameters)
            let answer = try await json.decode(SessionJobOutput.self, from: value)
            try checkCurrent(request, using: store)
            guard revision == refreshRevision else { return }
            guard answer.job.id == jobID else { throw DSBotFailure.protocolError }
            if output != answer.text { output = answer.text }
            if let index = jobs.firstIndex(where: { $0.id == jobID }) { jobs[index] = answer.job }
        } else if request.panel == .team {
            if let subagent = request.session.subagent { parameters["subagent"] = subagent.json }
            let value = try await store.request("session.team", parameters)
            let answer = try await json.decode(SessionTeamAnswer.self, from: value)
            try checkCurrent(request, using: store)
            guard revision == refreshRevision else { return }
            if members != answer.members { members = answer.members }
        } else {
            let value = try await store.request("session.jobs", parameters)
            let answer = try await json.decode(SessionJobsAnswer.self, from: value)
            try checkCurrent(request, using: store)
            guard revision == refreshRevision else { return }
            let ordered = answer.jobs.sorted {
                if $0.isLive != $1.isLive { return $0.isLive }
                if $0.isLive { return $0.startedAt < $1.startedAt }
                return ($0.finishedAt ?? $0.startedAt) > ($1.finishedAt ?? $1.startedAt)
            }
            if jobs != ordered { jobs = ordered }
        }
    }

    private func checkCurrent(_ request: SessionActivityRequest, using store: DSBotStore) throws {
        try Task.checkCancellation()
        guard request.computerID == store.activeComputer?.id,
              request.session.id == store.selectedSession?.id else { throw CancellationError() }
    }

    func stop(_ job: SessionBackgroundJob, request: SessionActivityRequest, using store: DSBotStore) async {
        guard stoppingID == nil, job.status == "running",
              request.computerID == store.activeComputer?.id,
              request.session.id == store.selectedSession?.id else { return }
        stoppingID = job.id
        failure = nil
        // An observation started before Stop must not overwrite the newer result.
        refreshRevision &+= 1
        defer { stoppingID = nil }
        do {
            _ = try await store.request("session.job.stop", ["id": .string(request.session.id), "jobId": .string(job.id)])
            try checkCurrent(request, using: store)
            try await refresh(request, jobID: job.id, using: store)
        } catch is CancellationError {
            return
        } catch {
            if !Task.isCancelled { failure = error.localizedDescription }
        }
    }
}
