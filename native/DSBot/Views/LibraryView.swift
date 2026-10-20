import SwiftUI

struct LibraryView: View {
    let section: String
    @ObservedObject var store: DSBotStore
    var onOpenSession: ((String) -> Void)? = nil

    var body: some View {
        LibraryEntriesView(
            title: libraryTitle(for: section),
            section: section,
            entries: entries,
            sessions: store.sessions,
            isLoading: store.loadingLibrarySections.contains(section),
            error: store.libraryErrors[section],
            onRetry: { await store.loadLibrary(section) },
            onOpenSession: onOpenSession
        )
        .task(id: section) { await store.loadLibrary(section) }
    }

    private var entries: [LibraryEntry] {
        switch section {
        case "plugins": return store.plugins
        case "schedule": return store.schedules
        default: return []
        }
    }
}

struct LibraryEntriesView: View {
    let title: String
    let section: String
    let entries: [LibraryEntry]
    let sessions: [SessionSummary]
    let isLoading: Bool
    var error: String?
    var onRetry: (() async -> Void)?
    var onOpenSession: ((String) -> Void)?
    @State private var expandedEntryIDs: Set<String> = []

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 10) {
                if isLoading && entries.isEmpty {
                    ProgressView()
                        .tint(DSBotStyle.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 56)
                } else if entries.isEmpty, let error {
                    VStack(spacing: 12) {
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundStyle(DSBotStyle.muted)
                            .multilineTextAlignment(.center)
                        if let onRetry {
                            Button("重试") {
                                DSBotLog.record("library.retry")
                                Task { await onRetry() }
                            }
                            .font(.system(size: 14, weight: .medium))
                            .frame(minHeight: 44)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, 52)
                } else if entries.isEmpty {
                    Text("暂无\(title)")
                        .font(.system(size: 15))
                        .foregroundStyle(DSBotStyle.muted)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 52)
                } else {
                    ForEach(entries) { entry in
                        entryRow(entry)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 28)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Color.white)
    }

    @ViewBuilder
    private func entryRow(_ entry: LibraryEntry) -> some View {
        let isExpanded = expandedEntryIDs.contains(entry.id)
        let hasDetails = hasExpandableContent(entry)
        VStack(alignment: .leading, spacing: 8) {
            Button {
                DSBotLog.record("library.entry.toggle")
                if isExpanded {
                    expandedEntryIDs.remove(entry.id)
                } else {
                    expandedEntryIDs.insert(entry.id)
                }
            } label: {
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(entry.name)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(DSBotStyle.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if section == "schedule", let summary = scheduleSummary(entry) {
                            Text(summary)
                                .font(.system(size: 13))
                                .foregroundStyle(DSBotStyle.muted)
                                .lineLimit(2)
                        } else if let subtitle = entry.subtitle, !subtitle.isEmpty, !subtitle.hasPrefix("/") {
                            Text(subtitle)
                                .font(.system(size: 13))
                                .foregroundStyle(DSBotStyle.muted)
                                .multilineTextAlignment(.leading)
                                .lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    if let enabled = entry.enabled {
                        Text(enabled ? "已启用" : "已停用")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(enabled ? DSBotStyle.ink : DSBotStyle.muted)
                    }
                    if hasDetails {
                        DSBotIcon(isExpanded ? .up : .down, size: 16)
                            .foregroundStyle(DSBotStyle.muted)
                            .padding(.top, 3)
                    }
                }
                .padding(15)
                .background(DSBotStyle.sheet.opacity(0.7))
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(DSBotRowButtonStyle())
            .disabled(!hasDetails)
            .accessibilityIdentifier("library.entry.\(entry.id)")

            if isExpanded {
                entryDetails(entry)
                    .padding(.horizontal, 15)
                    .padding(.bottom, 8)
            }
        }
    }

    @ViewBuilder
    private func entryDetails(_ entry: LibraryEntry) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let detail = entry.detail, !detail.isEmpty {
                labeledDetail(detailTitle, value: detail)
            }
            if section == "schedule", let schedule = entry.schedule {
                if let rule = ruleDescription(schedule.rule) {
                    labeledDetail("重复规则", value: rule)
                }
                let session = sessions.first { $0.id == schedule.sessionId }
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("所属会话")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(DSBotStyle.muted)
                        Text(session?.title ?? "原会话")
                            .font(.system(size: 14))
                            .foregroundStyle(DSBotStyle.ink)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 8)
                    if session != nil, let onOpenSession {
                        Button {
                            DSBotLog.record("schedule.session.open")
                            onOpenSession(schedule.sessionId)
                        } label: {
                            HStack(spacing: 5) {
                                Text("打开会话")
                                DSBotIcon(.right, size: 13)
                            }
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(DSBotStyle.ink)
                            .frame(minHeight: 40)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
                if let lastDelivery = schedule.lastDelivery {
                    if let scheduled = lastDelivery.scheduledAt {
                        labeledDetail("最近触发", value: scheduled)
                    }
                    if let delivered = lastDelivery.deliveredAt {
                        labeledDetail("已投递到会话", value: delivered)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func labeledDetail(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(DSBotStyle.muted)
            Text(value)
                .font(.system(size: 14))
                .foregroundStyle(DSBotStyle.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func hasExpandableContent(_ entry: LibraryEntry) -> Bool {
        entry.detail?.isEmpty == false || (section == "schedule" && entry.schedule != nil)
    }

    private var detailTitle: String {
        switch section {
        case "schedule": return "提醒内容"
        default: return "说明"
        }
    }

    private func scheduleSummary(_ entry: LibraryEntry) -> String? {
        guard let schedule = entry.schedule else { return entry.subtitle }
        let rule = ruleDescription(schedule.rule) ?? schedule.rule.kind
        return [rule, entry.subtitle.map { "下次 \($0)" }].compactMap { $0 }.joined(separator: " · ")
    }

    private func ruleDescription(_ rule: LibraryScheduleRule) -> String? {
        switch rule.kind {
        case "after":
            guard let seconds = rule.afterSeconds else { return "单次提醒" }
            return "单次延迟 · \(duration(seconds))"
        case "at":
            return "单次提醒"
        case "every":
            guard let seconds = rule.everySeconds else { return "重复提醒" }
            return "每 \(duration(seconds))"
        case "daily":
            return ["每天", rule.time, rule.timeZone].compactMap { $0 }.joined(separator: " · ")
        case "weekly":
            let weekdayNames = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
            let days = rule.weekdays?.compactMap { day -> String? in
                guard weekdayNames.indices.contains(day - 1) else { return nil }
                return weekdayNames[day - 1]
            }.joined(separator: "、")
            return ["每周", days, rule.time, rule.timeZone].compactMap { $0 }.joined(separator: " · ")
        case "cron":
            return ["Cron", rule.expression, rule.timeZone].compactMap { $0 }.joined(separator: " · ")
        default:
            return nil
        }
    }

    private func duration(_ seconds: Int) -> String {
        if seconds % 86_400 == 0 { return "\(seconds / 86_400) 天" }
        if seconds % 3_600 == 0 { return "\(seconds / 3_600) 小时" }
        if seconds % 60 == 0 { return "\(seconds / 60) 分钟" }
        return "\(seconds) 秒"
    }
}
