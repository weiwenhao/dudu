import SwiftUI

/// Approved 2026-11-12: two independent sheets, white 22pt cards and the existing native Menu entrance.
struct SessionActivitySheet: View {
    let request: SessionActivityRequest
    @ObservedObject var store: DSBotStore
    let onOpenChild: (SessionSummary) -> Void
    @StateObject private var model = SessionActivityModel()
    @State private var selectedJobID: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    private struct Reading: Equatable {
        let connection: Int
        let active: Bool
        let jobID: String?
    }

    private var job: SessionBackgroundJob? { model.jobs.first { $0.id == selectedJobID } }
    private var sheetHeight: CGFloat {
        if selectedJobID != nil { return 600 }
        let count = request.panel == .team ? model.members.count : model.jobs.count
        return min(600, max(330, 130 + CGFloat(count) * 82))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 24)
                .padding(.top, 20)
                .padding(.bottom, selectedJobID == nil ? 28 : 24)
            ScrollView {
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
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DSBotStyle.sheet)
        .presentationDetents([.height(sheetHeight), .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(28)
        .presentationBackground(DSBotStyle.sheet)
        .task(id: Reading(connection: store.connectionRevision, active: scenePhase == .active, jobID: selectedJobID)) {
            guard scenePhase == .active else { return }
            await model.read(request, jobID: selectedJobID, using: store)
        }
        .accessibilityIdentifier("session.activity.\(request.panel.rawValue)")
    }

    private var header: some View {
        HStack(spacing: 12) {
            if selectedJobID != nil {
                Button { selectedJobID = nil } label: {
                    DSBotIcon(.back, size: 21)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DSBotQuietPressStyle())
                .accessibilityLabel(L10n.text("返回"))
                Spacer(minLength: 8)
            }
            Text(request.panel.title)
                .font(.system(size: selectedJobID == nil ? 21 : 16, weight: .semibold))
                .foregroundStyle(DSBotStyle.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            Button { dismiss() } label: {
                DSBotIcon(.close, size: 12)
                    .foregroundStyle(DSBotStyle.chatSecondary)
                    .frame(width: 28, height: 28)
                    .background(DSBotStyle.selected, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(DSBotQuietPressStyle())
            .accessibilityLabel(L10n.text("关闭"))
        }
        .frame(height: 30)
    }

    @ViewBuilder
    private var teamList: some View {
        if model.members.isEmpty {
            loading
        } else {
            VStack(spacing: 0) {
                ForEach(Array(model.members.enumerated()), id: \.element.id) { index, member in
                    if index > 0 { Divider().padding(.leading, 56) }
                    if member.canOpen {
                        Button {
                            dismiss()
                            onOpenChild(member.session)
                        } label: {
                            memberRow(member, isRoot: index == 0)
                        }
                        .buttonStyle(DSBotRowButtonStyle())
                    } else {
                        memberRow(member, isRoot: index == 0)
                    }
                }
            }
            .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
    }

    private func memberRow(_ member: SessionTeamMember, isRoot: Bool) -> some View {
        HStack(spacing: isRoot ? 14 : 12) {
            if !isRoot {
                Path { path in
                    path.move(to: CGPoint(x: 12, y: -11))
                    path.addLine(to: CGPoint(x: 12, y: 22))
                    path.addLine(to: CGPoint(x: 28, y: 22))
                }
                .stroke(DSBotStyle.line, lineWidth: 1)
                .frame(width: 28, height: 40)
                .accessibilityHidden(true)
            }
            if let agent = member.session.agent { AgentLogo(agent: agent, size: isRoot ? 26 : 24) }
            else { DSBotIcon(.model, size: 24).foregroundStyle(DSBotStyle.muted) }
            VStack(alignment: .leading, spacing: 6) {
                Text(isRoot ? member.session.agent?.name ?? member.name : member.name)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(DSBotStyle.ink)
                    .lineLimit(2)
                Text(memberSubtitle(member, isRoot: isRoot))
                    .font(.system(size: 13))
                    .foregroundStyle(DSBotStyle.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 6)
            Text(member.statusText)
                .font(.system(size: 13))
                .foregroundStyle(DSBotStyle.chatSecondary)
            DSBotIcon(.right, size: 16)
                .foregroundStyle(DSBotStyle.muted)
                .opacity(member.canOpen ? 1 : 0)
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, minHeight: 82, alignment: .leading)
        .contentShape(Rectangle())
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
            VStack(spacing: 10) {
                ForEach(model.jobs) { job in
                    Button { selectedJobID = job.id } label: {
                        HStack(spacing: 16) {
                            jobMark(job, size: 20)
                            VStack(alignment: .leading, spacing: 8) {
                                Text(job.title)
                                    .font(.system(size: 16, weight: .medium))
                                    .foregroundStyle(DSBotStyle.ink)
                                    .lineLimit(2)
                                jobStatus(job)
                            }
                            Spacer(minLength: 8)
                            DSBotIcon(.right, size: 16).foregroundStyle(DSBotStyle.muted)
                        }
                        .padding(16)
                        .frame(maxWidth: .infinity, minHeight: 100, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(DSBotRowButtonStyle())
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                }
            }
        }
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
        } else {
            DSBotIcon(job.status == "completed" ? .check : .stateIdle, size: size)
                .foregroundStyle(DSBotStyle.chatSecondary)
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
