import Combine
import Foundation

@MainActor
final class AssistantCompletions: ObservableObject {
    enum Status { case loading, ready, failed }
    enum Candidate: Identifiable {
        case issue(AssistantRecipient)
        case skill(AssistantSkill)
        var id: String {
            switch self {
            case .issue(let item): return "issue:\(item.id)"
            case .skill(let item): return "skill:\(item.name)"
            }
        }
        var token: String {
            switch self {
            case .issue(let item): return "@\(item.address)"
            case .skill(let item): return "/\(item.name)"
            }
        }
    }
    @Published private(set) var query: AssistantCompletion.Query?
    @Published private(set) var candidates: [Candidate] = []
    @Published private(set) var status = Status.ready
    @Published var selected = 0
    @Published private(set) var skills: [AssistantSkill] = []
    private(set) var recipient: AssistantRecipient?
    private var target: DraftTarget?
    private var dismissed: ComposerEditingState?
    private var editing: ComposerEditingState?
    private var task: Task<Void, Never>?
    private var revision = 0
    private var loadedSkills = false

    func inspect(_ edit: ComposerEditingState, store: DuduStore, enabled: Bool) {
        let currentTarget = store.selectedSession.flatMap { session in
            store.activeComputer.map { DraftTarget(computerID: $0.id, sessionID: session.id) }
        }
        if target != currentTarget { reset(); target = currentTarget }
        editing = edit
        guard enabled, store.isAssistantConversation, edit != dismissed,
              let next = AssistantCompletion.query(edit, continuing: query) else { clear(); return }
        guard next != query else { return }
        let continuing = next.continues(query)
        task?.cancel()
        revision &+= 1
        let currentRevision = revision
        query = next
        selected = 0
        if !continuing { candidates = [] }
        if next.kind == .skill, loadedSkills {
            candidates = AssistantCompletion.rank(skills, query: next.text).map(Candidate.skill)
            status = .ready
            return
        }
        status = .loading
        task = Task {
            do {
                let entries: [Candidate]
                if next.kind == .issue {
                    entries = try await store.assistantRecipients(next.text).map(Candidate.issue)
                } else {
                    let values = try await store.assistantSkills()
                    guard currentRevision == revision, !Task.isCancelled else { return }
                    skills = values
                    loadedSkills = true
                    entries = AssistantCompletion.rank(values, query: next.text).map(Candidate.skill)
                }
                guard currentRevision == revision, !Task.isCancelled else { return }
                candidates = entries
                status = .ready
            } catch {
                guard currentRevision == revision, !Task.isCancelled else { return }
                candidates = []
                status = .failed
            }
        }
    }

    func choose(_ candidate: Candidate, in text: String) -> (String, NSRange)? {
        guard let query else { return nil }
        let insertion = AssistantCompletion.insert(candidate.token, query: query, in: text)
        if case let .issue(item) = candidate { recipient = item }
        close()
        return insertion
    }

    func close() {
        dismissed = editing
        clear()
    }

    private func clear() {
        task?.cancel()
        task = nil
        revision &+= 1
        if query != nil { query = nil }
        if !candidates.isEmpty { candidates = [] }
        if status != .ready { status = .ready }
        // Keep the names for token colouring, but refresh the catalog on the next / invocation.
        loadedSkills = false
    }

    func reopen() { dismissed = nil }

    func reset() {
        close()
        skills = []
        loadedSkills = false
        recipient = nil
        editing = nil
        dismissed = nil
        selected = 0
    }
}
