import SwiftUI

/// Approved 2026-11-12: two independent sheets, white 22pt cards and the existing native Menu entrance.
struct SessionActivitySheet: View {
    let request: SessionActivityRequest
    @ObservedObject var store: DSBotStore
    let onOpenChild: (SessionSummary) -> Void
    @StateObject private var model = SessionActivityModel()
    @State private var selectedJobID: String?
    /// nil: open when there is nothing else to show (a team whose members are all finished), closed otherwise.
    @State private var finishedOpen: Bool?
    /// The height follows the content (a folded row opening, members arriving); the selection moves with it, or the sheet would lose its detent.
    @State private var detent: PresentationDetent = .height(330)
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    private struct Reading: Equatable {
        let connection: Int
        let active: Bool
        let jobID: String?
    }

    private struct TeamSection: Identifiable {
        let state: String
        let title: String
        let members: [SessionTeamMember]
        var id: String { state }
    }

    private var job: SessionBackgroundJob? { model.jobs.first { $0.id == selectedJobID } }

    /// The team without its main agent, by state: the ones that need a look first, the finished ones folded into one row.
    private var teamSections: [TeamSection] {
        let others = Array(model.members.dropFirst())
        let shown = ["working", "blocked", "failed"]
        var sections = shown.compactMap { state -> TeamSection? in
            let found = others.filter { $0.state == state }
            return found.isEmpty ? nil : TeamSection(state: state, title: found[0].statusText, members: found)
        }
        let idle = others.filter { !shown.contains($0.state) && $0.state != "completed" }
        if !idle.isEmpty { sections.append(TeamSection(state: "idle", title: idle[0].statusText, members: idle)) }
        return sections
    }
    private var finishedMembers: [SessionTeamMember] { model.members.dropFirst().filter { $0.state == "completed" } }
    private var finishedIsOpen: Bool { finishedOpen ?? teamSections.isEmpty }

    private var sheetHeight: CGFloat {
        if selectedJobID != nil { return 600 }
        let rows: CGFloat = 58
        if request.panel == .jobs { return min(600, max(260, 130 + CGFloat(model.jobs.count) * rows)) }
        var height: CGFloat = 130 + 64
        for section in teamSections { height += 44 + CGFloat(section.members.count) * rows }
        if !finishedMembers.isEmpty {
            height += 66 + (finishedIsOpen ? 10 + CGFloat(finishedMembers.count) * rows : 0)
        }
        return min(600, max(260, height))
    }

    var body: some View {
        QuickSheetPage(
            title: request.panel.title,
            onBack: selectedJobID == nil ? nil : { selectedJobID = nil },
            onClose: { dismiss() },
            centersTitle: true,
            actions: {}, filters: {}
        ) {
                VStack(alignment: .leading, spacing: 22) {
                    if let job { jobDetail(job) }
                    else if request.panel == .team { teamList }
                    else { jobsList }
                    if let failure = model.failure {
                        Text(failure)
                            .font(.system(size: 14))
                            .foregroundStyle(DSBotStyle.chatSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
        } footer: {}
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DSBotStyle.sheet)
        .presentationDetents([.height(sheetHeight), .large], selection: $detent)
        .onChange(of: sheetHeight, initial: true) { _, height in
            if detent != .large { detent = .height(height) }
        }
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(DSBotStyle.sheet)
        .task(id: Reading(connection: store.connectionRevision, active: scenePhase == .active, jobID: selectedJobID)) {
            guard scenePhase == .active else { return }
            await model.read(request, jobID: selectedJobID, using: store)
        }
        .accessibilityIdentifier("session.activity.\(request.panel.rawValue)")
        #if DEBUG && targetEnvironment(simulator)
        .task(id: model.jobs.first?.id) {
            let args = ProcessInfo.processInfo.arguments
            guard args.contains("-dsbot-ui-review"),
                  let index = args.firstIndex(of: "-dsbot-review-sheet"), args.indices.contains(index + 1),
                  args[index + 1] == "job-detail", selectedJobID == nil,
                  let job = model.jobs.first else { return }
            selectedJobID = job.id
        }
        #endif
    }

    @ViewBuilder
    private var teamList: some View {
        if model.members.isEmpty {
            loading
        } else {
            // Owner's pick B (2026-11-17): the main agent first, then the others by state, the finished ones folded into one row.
            VStack(alignment: .leading, spacing: 0) {
                if let root = model.members.first { rootCard(root) }
                ForEach(teamSections) { section in
                    sectionLabel(section.title, count: section.members.count)
                    teamCard(section.members, marked: true)
                }
                if !finishedMembers.isEmpty {
                    finishedRow
                        .padding(.top, 14)
                    if finishedIsOpen {
                        teamCard(finishedMembers, marked: false)
                            .padding(.top, 10)
                    }
                }
            }
        }
    }

    private func cardBackground<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        content()
            .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    @ViewBuilder
    private func openable<Label: View>(_ member: SessionTeamMember, @ViewBuilder label: () -> Label) -> some View {
        let content = label()
        if member.canOpen {
            Button {
                dismiss()
                onOpenChild(member.session)
            } label: { content }
            .buttonStyle(DSBotRowButtonStyle())
        } else {
            content
        }
    }

    private func rootCard(_ member: SessionTeamMember) -> some View {
        cardBackground {
            openable(member) {
                HStack(spacing: 14) {
                    if let agent = member.session.agent { AgentLogo(agent: agent, size: 26) }
                    else { DSBotIcon(.model, size: 24).foregroundStyle(DSBotStyle.muted) }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(member.session.agent?.name ?? member.name)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(DSBotStyle.ink)
                            .lineLimit(1)
                        Text(memberSubtitle(member, isRoot: true))
                            .font(.system(size: 13))
                            .foregroundStyle(DSBotStyle.muted)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    teamMark(member.state)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .contentShape(Rectangle())
            }
        }
    }

    private func sectionLabel(_ title: String, count: Int) -> some View {
        HStack(spacing: 6) {
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(DSBotStyle.chatSecondary)
            Text("\(count)").font(.system(size: 13)).foregroundStyle(DSBotStyle.muted).monospacedDigit()
        }
        .padding(.leading, 16)
        .padding(.top, 14)
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    /// `marked`: the state's mark before the title. The finished list has none, its row above already says it.
    private func teamCard(_ members: [SessionTeamMember], marked: Bool) -> some View {
        cardBackground {
            VStack(spacing: 0) {
                ForEach(Array(members.enumerated()), id: \.element.id) { index, member in
                    if index > 0 { Divider().padding(.leading, marked ? 48 : 16) }
                    openable(member) {
                        HStack(spacing: 12) {
                            if marked { teamMark(member.state).frame(width: 20, height: 20) }
                            Text(member.name)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(DSBotStyle.ink)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 14)
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                }
            }
        }
    }

    private var finishedRow: some View {
        cardBackground {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { finishedOpen = !finishedIsOpen }
            } label: {
                HStack(spacing: 12) {
                    teamMark("completed").frame(width: 20, height: 20)
                    Text(L10n.text("已完成"))
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(DSBotStyle.ink)
                    Spacer(minLength: 8)
                    Text("\(finishedMembers.count)")
                        .font(.system(size: 14))
                        .foregroundStyle(DSBotStyle.muted)
                        .monospacedDigit()
                    DSBotIcon(finishedIsOpen ? .down : .right, size: 16)
                        .foregroundStyle(DSBotStyle.muted)
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(DSBotRowButtonStyle())
        }
    }

    @ViewBuilder
    private func teamMark(_ state: String) -> some View {
        switch state {
        case "working": SessionJobRunningMark(size: 20)
        case "completed": DSBotIcon(.check, size: 18).foregroundStyle(DSBotStyle.muted)
        case "failed": DSBotIcon(.stateFailed, size: 18).foregroundStyle(DSBotStyle.chatError)
        case "blocked": DSBotIcon(.stateBlocked, size: 18).foregroundStyle(DSBotStyle.ink)
        default: DSBotIcon(.stateIdle, size: 18).foregroundStyle(DSBotStyle.chatSecondary)
        }
    }

    private func memberSubtitle(_ member: SessionTeamMember, isRoot: Bool) -> String {
        let name = isRoot ? L10n.text("主智能体") : member.session.agent?.name
        let modelName = member.modelId.map { id in store.models.first { $0.id == id }?.name ?? id }
        return [name, modelName].compactMap { $0 }.joined(separator: " · ")
    }

    @ViewBuilder
    private var jobsList: some View {
        if model.jobs.isEmpty {
            if model.isLoading { loading }
            else if model.failure == nil {
                VStack(spacing: 20) {
                    DSBotIcon(.stateWorking, size: 26).foregroundStyle(DSBotStyle.muted)
                    Text(L10n.text("暂无后台任务"))
                        .font(.system(size: 15))
                        .foregroundStyle(DSBotStyle.muted)
                }
                .frame(maxWidth: .infinity, minHeight: 160)
            }
        } else {
            // One card, one line of state per job: the mark says running / finished / failed, the time sits on the right.
            cardBackground {
                VStack(spacing: 0) {
                    ForEach(Array(model.jobs.enumerated()), id: \.element.id) { index, job in
                        if index > 0 { Divider().padding(.leading, 48) }
                        Button { selectedJobID = job.id } label: {
                            HStack(spacing: 12) {
                                jobMark(job, size: 20).frame(width: 20, height: 20)
                                Text(job.title)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(DSBotStyle.ink)
                                    .lineLimit(2)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 8)
                                jobTrailing(job)
                            }
                            .padding(.horizontal, 16)
                            .padding(.vertical, 14)
                            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(DSBotRowButtonStyle())
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func jobTrailing(_ job: SessionBackgroundJob) -> some View {
        if job.isLive && scenePhase == .active {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                trailingText(job, at: context.date)
            }
        } else {
            trailingText(job, at: .now)
        }
    }

    /// Only a job that did not simply finish says its state in words; the others show how long they ran.
    private func trailingText(_ job: SessionBackgroundJob, at date: Date) -> some View {
        let finishedWell = job.isLive || job.status == "completed"
        return Text(finishedWell ? job.elapsed(at: date) : "\(job.statusText) · \(job.elapsed(at: date))")
            .font(.system(size: 13))
            .foregroundStyle(finishedWell || job.status == "killed" ? DSBotStyle.chatSecondary : DSBotStyle.chatError)
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
    }

    private var loading: some View {
        Group {
            if model.isLoading {
                ProgressView().tint(DSBotStyle.chatSecondary)
                    .frame(maxWidth: .infinity, minHeight: 140)
            }
        }
    }

    @ViewBuilder
    private func jobStatus(_ job: SessionBackgroundJob) -> some View {
        if job.isLive && scenePhase == .active {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                statusText(job, at: context.date)
            }
        } else {
            statusText(job, at: .now)
        }
    }

    private func statusText(_ job: SessionBackgroundJob, at date: Date) -> some View {
        Text("\(job.statusText) · \(job.elapsed(at: date))")
            .font(.system(size: 13))
            .foregroundStyle(DSBotStyle.chatSecondary)
            .monospacedDigit()
    }

    @ViewBuilder
    private func jobMark(_ job: SessionBackgroundJob, size: CGFloat) -> some View {
        if job.isLive {
            SessionJobRunningMark(size: size)
        } else if job.status == "completed" {
            DSBotIcon(.check, size: size).foregroundStyle(DSBotStyle.muted)
        } else if job.status == "killed" {
            DSBotIcon(.stateIdle, size: size).foregroundStyle(DSBotStyle.chatSecondary)
        } else {
            DSBotIcon(.stateFailed, size: size).foregroundStyle(DSBotStyle.chatError)
        }
    }

    private func jobDetail(_ job: SessionBackgroundJob) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 12) {
                Text(job.title)
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(DSBotStyle.ink)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 8) {
                    jobMark(job, size: 15)
                    jobStatus(job)
                }
            }
            HStack {
                Text(L10n.text("开始时间")).foregroundStyle(DSBotStyle.ink)
                Spacer(minLength: 12)
                Text(job.startTime).foregroundStyle(DSBotStyle.chatSecondary)
            }
            .font(.system(size: 15))
            .padding(16)
            .frame(minHeight: 52)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Text(L10n.text("输出"))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(DSBotStyle.chatSecondary)
                    if model.isLoading { ProgressView().controlSize(.mini) }
                }
                .padding(.leading, 16)
                ScrollView(.horizontal) {
                    Text(model.output.isEmpty ? "—" : model.output)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(DSBotStyle.ink)
                        .textSelection(.enabled)
                        .padding(16)
                        .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
                }
                .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
            if job.isLive {
                Button {
                    Task { await model.stop(job, request: request, using: store) }
                } label: {
                    HStack(spacing: 10) {
                        if model.stoppingID == job.id || job.status == "stopping" {
                            ProgressView().controlSize(.small)
                        } else {
                            DSBotIcon(.jobStop, size: 14)
                        }
                        Text(L10n.text("停止")).font(.system(size: 16, weight: .medium))
                    }
                    .foregroundStyle(DSBotStyle.chatError)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .contentShape(Rectangle())
                }
                .disabled(model.stoppingID != nil || job.status == "stopping")
                .buttonStyle(DSBotRowButtonStyle())
                .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
            }
        }
    }
}

private struct SessionJobRunningMark: View {
    let size: CGFloat
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var turning = false

    private var animates: Bool { scenePhase == .active && !reduceMotion }

    var body: some View {
        DSBotIcon(.stateWorking, size: size)
            .foregroundStyle(DSBotStyle.chatSecondary)
            .rotationEffect(.degrees(animates && turning ? 360 : 0))
            .animation(animates ? .linear(duration: 1).repeatForever(autoreverses: false) : nil, value: turning)
            .onChange(of: animates, initial: true) { _, active in turning = active }
            .accessibilityHidden(true)
    }
}
