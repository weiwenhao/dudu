# 桌面中英文界面用词（待主人审阅）

2026-11-02 补充：本表包含历史键。主人要求清理和重新审核的副文本，以 [secondary-copy-review.md](secondary-copy-review.md) 中的逐句清单和处置为准；表中旧的 `note`、规则 `description`、`developerDescription`、`currentModel`、`detail.messageHint` 已从界面移除，不再代表当前显示效果。随后按主人要求移除整个“小组件”设置栏目，其导航、可见性开关、开发者模式和本地开发标记用词也仅作历史记录；组件添加、移除仍使用“编辑版面”中的既有用词。

2026-10-31：按主人要求，固定界面文字随 DeepSeek Harness 的语言设置切换。以下与代码的 622 个键（2026-11-03 起再加 11 个，见下面标明的）对应；其中 504 个为现行控件和诊断用词，118 个为保留的旧连接器兼容译文。本次新增译文没有算作此前已经审过的字，也未安装到正式 Desktop。

`{name}`、`{text}` 等是实际内容的位置；有数量变化的用词列出 1 和 3 的示例。事项标题、正文、模型回答、连接器名称、规则文件和第三方插件文案保持原文。2026-11-01 按本人明确要求，英文名统一为 Dudu；本人身份与署名在 2026-11-01 统一为 boss；**2026-11-04 主人改定：“我在嘟嘟这个插件中的角色就是‘你’”，英文 You，中文 你**（留言署名、事项的来源、设置里的提示都用它，见下面的 `activity.you`、`source.owner`、`connectorDiagnostics`）。

本轮新增包括：侧栏菜单、选择和新建项目、统一留言框及 @ 路由提示、系统活动和错误的双语显示、采集 Prompt 说明，以及 Office 的已分配事项说明。完整交接消息和项目模板改字另见 [issues-ui-wording.md](issues-ui-wording.md)。

| 代码位置 | English | 中文 |
|---|---|---|
| brand | Dudu | 嘟嘟 |
| issues | Issues | 事项 |
| tabs.active | Active | 进行中 |
| tabs.backlog | Backlog | 待规划 |
| tabs.all | All issues | 全部事项 |
| status.backlog | Backlog | 待规划 |
| status.todo | Todo | 待办 |
| status.in_progress | In Progress | 处理中 |
| status.in_review | In Review | 待审核 |
| status.done | Done | 已完成 |
| status.canceled | Canceled | 已取消 |
| priority.none | No priority | 无优先级 |
| priority.urgent | Urgent | 紧急 |
| priority.high | High | 高 |
| priority.medium | Medium | 中 |
| priority.low | Low | 低 |
| priorityOf | Priority: {name} | 优先级：{name} |
| addFilter | Add Filter… | 添加筛选… |
| filterOptions | Filter… | 筛选… |
| filterButton | Filter | 筛选 |
| fields.status | Status | 状态 |
| fields.agent | Agent | 智能体 |
| fields.agentState | Agent state | 智能体状态 |
| fields.priority | Priority | 优先级 |
| fields.project | Project | 项目 |
| fields.source | Source | 来源 |
| isAnyOf | is any of | 是其中之一 |
| is | is | 是 |
| removeFilter | Remove filter | 移除筛选 |
| command.suggestions | Suggestions | 候选项 |
| clear | Clear | 清除 |
| addFilterChip | Filter | 筛选 |
| changeStatus | Change status… | 更改状态… |
| changeStatusOf | {status}. Change status: {title} | {status}。更改状态：{title} |
| noProject | No project | 无项目 |
| source.owner | You | 你 |
| source.dudu | Dudu | 嘟嘟 |
| source.connector | Collector | 收集器 |
| source.session | Session | 会话 |
| display.title | Display options | 显示选项 |
| display.list | List | 列表 |
| display.board | Board | 看板 |
| display.grouping | Grouping | 分组 |
| display.subGrouping | Sub-grouping | 子分组 |
| display.ordering | Ordering | 排序 |
| display.columns | Columns | 列 |
| display.rows | Rows | 行 |
| display.noGrouping | No grouping | 不分组 |
| display.groupBy.status | Status | 状态 |
| display.groupBy.agent | Agent | 智能体 |
| display.groupBy.project | Project | 项目 |
| display.groupBy.priority | Priority | 优先级 |
| display.orderBy.priority | Priority | 优先级 |
| display.orderBy.status | Status | 状态 |
| display.orderBy.due | Due date | 截止日期 |
| display.orderBy.updated | Updated | 更新时间 |
| display.orderBy.created | Created | 创建时间 |
| display.reverse | Reverse {what} | 反转{what} |
| display.recency | Order completed by recency | 已完成事项按最近更新排序 |
| display.completedIssues | Completed issues | 已完成事项 |
| display.completed.all | All | 全部 |
| display.completed.day | Past day | 过去一天 |
| display.completed.week | Past week | 过去一周 |
| display.completed.month | Past month | 过去一个月 |
| display.completed.none | None | 不显示 |
| display.listOptions | List options | 列表选项 |
| display.showEmptyGroups | Show empty groups | 显示空分组 |
| display.boardOptions | Board options | 看板选项 |
| display.showEmptyColumns | Show empty columns | 显示空列 |
| display.properties | Display properties | 显示属性 |
| display.property.id | ID | 编号 |
| display.property.status | Status | 状态 |
| display.property.agent | Agent | 智能体 |
| display.property.priority | Priority | 优先级 |
| display.property.project | Project | 项目 |
| display.property.dueDate | Due date | 截止日期 |
| display.property.source | Source | 来源 |
| display.property.created | Created | 创建时间 |
| display.property.updated | Updated | 更新时间 |
| display.reset | Reset | 重置 |
| collapse | Collapse {name} | 折叠{name} |
| expand | Expand {name} | 展开{name} |
| detail.messageHint | Mention @{recipient} to send a message. Otherwise, leave a comment. | 用 @{recipient} 发送消息，不 @ 就是留言。 |
| detail.mention | Mention | 提及 |
| detail.messageErrors.invalid_message | Write a message first. | 先写点内容。 |
| detail.messageErrors.multiple_targets | Mention one recipient at a time. | 一次只 @ 一个。 |
| detail.messageErrors.choose_agent | Choose an agent first. | 先选择智能体。 |
| detail.messageErrors.empty_request | Add a message after the mention. | @ 后面还要写要说的话。 |
| detail.messageErrors.choose_project | Choose a project before sending work to an agent. | 先选项目，再把工作交给智能体。 |
| detail.messageErrors.delivery_failed | Your comment was saved, but the request could not be delivered. | 留言已保存，请求没能送达。 |
| detail.more | More | 更多 |
| detail.forgetScope | This issue, its activity and local links will be deleted. Source messages and session history stay. | 将删除这条事项、活动和本地关联。来源消息和会话历史会保留。 |
| detail.properties | Properties | 属性 |
| detail.project | Project | 项目 |
| detail.activity | Activity | 活动 |
| detail.leaveComment | Leave a comment… | 添加评论… |
| detail.send | Send | 发送 |
| detail.needsYou | Needs you | 等你回复 |
| detail.untitled | Untitled | 未命名 |
| detail.description | Add description… | 添加描述… |
| detail.loadEarlier | Load earlier | 加载更早的记录 |
| detail.notFound | This issue does not exist. | 这条事项不存在。 |
| detail.back | Back to Issues | 返回事项 |
| detail.previous | Previous issue | 上一条事项 |
| detail.next | Next issue | 下一条事项 |
| detail.position | 3 / 3 | 3 / 3 |
| detail.noDueDate | No due date | 无截止日期 |
| detail.noProjectSet | No project | 无项目 |
| detail.clearDue | Clear | 清除 |
| detail.dueDate | Due date | 截止日期 |
| due.placeholder（2026-11-02 主人确认） | Try: 24h, 7 days, Feb 9 | 试试：24h、7天、2月9日 |
| due.remove（2026-11-02 主人确认） | Remove due date | 移除截止日期 |
| due.custom（2026-11-02 主人确认） | Custom… | 自定义… |
| due.weekEnd（2026-11-02 主人确认） | End of this week | 本周结束 |
| due.oneWeek（2026-11-02 主人确认） | In one week | 一周后 |
| detail.setPriority | Set priority… | 设置优先级… |
| detail.copyId | Copy ID | 复制编号 |
| detail.openSession | Open session | 打开会话 |
| detail.openSource | Open source | 打开来源 |
| detail.snooze | Snooze | 稍后提醒 |
| detail.setAgent | Set agent… | 选择智能体… |
| detail.agentNote | Starts a new session. The old one is closed. | 会开启新会话，原会话会关闭。 |
| detail.reply | Leave a reply… | 回复… |
| detail.sendReply | Send reply | 发送回复 |
| detail.result | Add a result… | 记录结果… |
| detail.saveResult | Save | 保存 |
| detail.skipResult | Skip | 跳过 |
| snooze.laterToday | Later today | 今天晚些时候 |
| snooze.tomorrow | Tomorrow | 明天 |
| snooze.nextWeek | Next week | 下周 |
| snooze.clear | Clear snooze | 取消稍后提醒 |
| snooze.until | Snoozed until {date} | 稍后提醒至 {date} |
| activity.you | You | 你 |
| activity.justNow | just now | 刚刚 |
| activity.minutesAgo | 1m ago<br>3m ago | 1 分钟前<br>3 分钟前 |
| activity.hoursAgo | 1h ago<br>3h ago | 1 小时前<br>3 小时前 |
| activity.yesterday | Yesterday | 昨天 |
| activity.created | created the issue | 创建了事项 |
| activity.createdFromMessage | created the issue from a message | 从消息创建了事项 |
| activity.createdFromSession | created the issue from a session | 从会话创建了事项 |
| activity.status | changed status from {from} to {to} | 将状态从{from}改为{to} |
| activity.priority | changed priority to {to} | 将优先级改为{to} |
| activity.due | set the due date to {date} | 将截止日期设为 {date} |
| activity.dueRemoved | removed the due date | 移除了截止日期 |
| activity.assigned | assigned the issue to {agent} | 交给了 {agent} |
| activity.unassigned | removed the agent | 移除了智能体 |
| activity.asked | asked | 提问 |
| activity.session | changed the session | 更换了会话 |
| activity.commented | commented | 评论 |
| activity.sessionStarted | started a session with {agent} | 与 {agent} 开始了会话 |
| activity.sessionClosed | closed the session | 关闭了会话 |
| activity.sessionResumed | resumed the session | 恢复了会话 |
| activity.whoShouldTake | Who should handle this? | 交给谁处理？ |
| activity.failed | Something went wrong: {reason}. What should we do? | 出错了：{reason}。怎么办？ |
| activity.noReason | No reason given | 没有说明原因 |
| activity.notStarted | Could not start: {reason}. Choose another agent, or try later? | 没能开始：{reason}。要换个智能体，还是稍后再试？ |
| activity.notDelivered | Could not send the reply to the session: {reason} | 回复没能发给会话：{reason} |
| activity.access | access | 访问模式 |
| activity.requestedAccess | asked for | 请求 |
| activity.allowedAccess | ASSIGN.md allows | ASSIGN.md 允许 |
| activity.sessionDropped | the session it named was not offered, so a new one starts | 指定的会话不可用，已开启新会话 |
| activity.urgentNeedsRule | Urgent needs a rule in TRIAGE.md; the priority comes from impact and effort. | TRIAGE.md 没有紧急规则，优先级按影响和工作量判断。 |
| newIssue.title | New issue | 新建事项 |
| newIssue.description | Create an issue with a title and an optional description. | 填写标题，可补充描述。 |
| newIssue.titlePlaceholder | Issue title | 事项标题 |
| newIssue.briefPlaceholder | Add description… | 添加描述… |
| newIssue.cancel | Cancel | 取消 |
| newIssue.create | Create issue | 创建事项 |
| newIssue.failed | Could not create the issue | 事项没能创建 |
| bulk.toolbar | Bulk actions | 批量操作 |
| bulk.selected | 1 selected<br>3 selected | 已选 1 条<br>已选 3 条 |
| bulk.clear | Clear selection | 取消选择 |
| bulk.select | Select {project reference or title} | 选择{项目编号或标题} |
| toast.undo | Undo | 撤销 |
| toast.markedDone | Marked as Done | 已标记为完成 |
| toast.status | Status set to {name} | 状态已改为{name} |
| toast.priority | Priority set to {name} | 优先级已改为{name} |
| toast.dueSet | Due date set | 已设置截止日期 |
| toast.dueRemoved | Due date removed | 已移除截止日期 |
| toast.assigned | Assigned to {name} | 已交给 {name} |
| toast.unassigned | Agent removed | 已移除智能体 |
| toast.updated | Updated 1 issue<br>Updated 3 issues | 已更新 1 条事项<br>已更新 3 条事项 |
| toast.copied | Copied {text} | 已复制 {text} |
| toast.snoozed | Snoozed | 已设为稍后提醒 |
| toast.snoozeCleared | Snooze cleared | 已取消稍后提醒 |
| toast.failed | Could not save the change | 更改没能保存 |
| toast.region | Notifications | 通知 |
| dates.name | Dates | 日期 |
| dates.due | Due date | 截止日期 |
| dates.created | Created | 创建时间 |
| dates.updated | Updated | 更新时间 |
| dates.overdue | Overdue | 已逾期 |
| dates.today | Today | 今天 |
| dates.next7 | Next 7 days | 未来 7 天 |
| dates.next30 | Next 30 days | 未来 30 天 |
| dates.day | Past day | 过去一天 |
| dates.week | Past week | 过去一周 |
| dates.month | Past month | 过去一个月 |
| search.label | Search issues | 搜索事项 |
| search.placeholder | Search issues… | 搜索事项… |
| total | 1 issue<br>3 issues | 1 条事项<br>3 条事项 |
| addTo | New issue in {name} | 在{name}中新建事项 |
| lane.options | Column options | 列选项 |
| lane.collapse | Collapse column | 折叠列 |
| lane.expand | Expand column | 展开列 |
| dashboard.menu | Dudu menu | 嘟嘟菜单 |
| dashboard.editLayout | Edit layout | 编辑版面 |
| dashboard.editHint | Drag to move, pull an edge to resize | 拖动移动，拉边调整大小 |
| dashboard.addWidget | Add widget | 添加小组件 |
| dashboard.restoreDefault | Restore default | 恢复默认 |
| dashboard.done | Done | 完成 |
| dashboard.settings | Settings | 设置 |
| dashboard.board | Dashboard | 仪表盘 |
| dashboard.remove | Remove widget | 移除小组件 |
| dashboard.addTitle | Add widget | 添加小组件 |
| dashboard.addDescription | Pick a widget to put on the dashboard. | 选择要放到仪表盘上的小组件。 |
| dashboard.added | Added | 已添加 |
| dashboard.add | Add | 添加 |
| dashboard.source | From {name} | 来自 {name} |
| dashboard.noMore | Every widget is on the dashboard. | 所有小组件都已添加。 |
| dashboard.minimum | Minimum size | 最小尺寸 |
| dashboard.maximum | Maximum size | 最大尺寸 |
| dashboard.undo | Undo | 撤销 |
| dashboard.placed | {name}: column 3, row 3 | {name}：第 3 列，第 3 行 |
| dashboard.sized | {name}: 3 by 3 | {name}：3 列，3 行 |
| dashboard.broken | This widget could not be shown | 这个小组件没能显示 |
| dashboard.brokenFrom | From {source} | 来自 {name} |
| dashboard.missing | This widget comes from {source}, which is not installed. | 这个小组件来自 {name}，该插件尚未安装。 |
| dashboard.loadFailed | Could not load the dashboard | 仪表盘没能加载 |
| dashboard.retry | Retry | 重试 |
| dashboard.saveFailed | Could not save the layout | 版面没能保存 |
| dashboard.actionAdded | Added「{name}」 | 已添加「{name}」 |
| dashboard.actionRemoved | Removed「{name}」 | 已移除「{name}」 |
| dashboard.actionMoved | Moved「{name}」 | 已移动「{name}」 |
| dashboard.actionResized | 「{name}」resized to 3×3<br>「{name}」resized to full width × 3 | 已将「{name}」调整为 3×3<br>已将「{name}」调整为全宽 × 3 |
| dashboard.restored | Restored default | 已恢复默认 |
| dashboard.changed | Changed layout | 已更改版面 |
| projects.choose | Choose a project | 选择项目 |
| projects.create | Create project | 新建项目 |
| projects.empty | No projects yet | 还没有项目 |
| projects.loading | Loading projects… | 正在读取项目… |
| projects.failed | Could not load projects | 项目没能读取 |
| widgets.titles.issues | Issues | 事项 |
| widgets.titles.overview | Overview | 概览 |
| widgets.titles.upcoming | Upcoming | 接下来 |
| widgets.titles.stuck | Stuck | 卡住了 |
| widgets.titles.inputs | Inputs | 收进来 |
| widgets.titles.quota | Quota | 额度 |
| widgets.titles.sessions | Sessions | 会话 |
| widgets.titles.office | Office | 办公室 |
| widgets.descriptions.issues | Every issue, as a list or a board | 所有事项，可按列表或看板查看 |
| widgets.descriptions.overview | Overdue, due this week and in progress | 逾期、本周截止和处理中的事项 |
| widgets.descriptions.upcoming | Issues with a due date, soonest first | 按截止日期从近到远排列 |
| widgets.descriptions.stuck | Issues an agent is stuck on | 智能体卡住的事项 |
| widgets.descriptions.inputs | Whether each connector works and what it read today | 连接器的状态和今天读到的内容 |
| widgets.descriptions.sessions | Search and open sessions | 搜索和打开会话 |
| widgets.descriptions.office | Assigned active issues as people at desks | 已分配智能体的进行中事项，各有一位员工 |
| widgets.needs.issues | issues | 事项 |
| widgets.needs.quota | quota | 额度 |
| widgets.needs.inputs | inputs | 输入 |
| widgets.needs.sessions | sessions | 会话 |
| widgets.needs.network | network | 网络 |
| widgets.inputs.empty | No source prompts | 还没有采集提示 |
| widgets.inputs.readToday | Read today | 今天读到 |
| widgets.inputs.made | Issues made | 生成事项 |
| widgets.inputs.allWorking | All working | 全部正常 |
| widgets.inputs.failed | Failed · {when} | 失败 · {when} |
| widgets.inputs.never | Not read yet | 尚未读取 |
| widgets.inputs.count | 1 read<br>3 read | 已读 1 条<br>已读 3 条 |
| widgets.overview.overdue | Overdue | 已逾期 |
| widgets.overview.thisWeek | Due this week | 本周截止 |
| widgets.overview.inProgress | In progress | 处理中 |
| widgets.upcoming.empty | Nothing is due | 没有即将截止的事项 |
| widgets.stuck.empty | Nothing is stuck | 没有卡住的事项 |
| widgets.quota.empty | No usage to show | 暂无用量 |
| widgets.quota.unknown | — | — |
| widgets.quota.fiveHour | 5-hour | 5 小时 |
| widgets.quota.weekly | Weekly | 每周 |
| widgets.quota.days | 1-day<br>3-day | 1 天<br>3 天 |
| widgets.quota.used | {label} 3% used | {label} 已用 3% |
| widgets.quota.resets | resets {when} | {when} 重置 |
| widgets.quota.resetsAt | Resets {when} | {when} 重置 |
| widgets.quota.limitReached | Limit reached, resets {when} | 已达上限，{when} 重置 |
| widgets.quota.label | {name} 3% used | {name} 已用 3% |
| widgets.quota.login | Sign in to see usage | 登录后查看用量 |
| widgets.sessions.search | Search sessions | 搜索会话 |
| widgets.sessions.empty | No sessions | 暂无会话 |
| widgets.sessions.failed | Could not read sessions | 会话没能读取 |
| widgets.sessions.opening | Opening… | 正在打开… |
| widgets.sessions.agents.claude | Claude | Claude |
| widgets.sessions.agents.codex | ChatGPT | ChatGPT |
| widgets.sessions.agents.dsh | DeepSeek Harness | DeepSeek Harness |
| settings.title | Dudu settings | 嘟嘟设置 |
| settings.openFolder | Open project folder | 打开项目文件夹 |
| settings.failed | Could not load this page | 这一页没能加载 |
| settings.retry | Retry | 重试 |
| settings.unavailable | The project folder could not be opened. | 项目文件夹没能打开。 |
| settings.nav.general | General | 通用 |
| settings.nav.connectors | Connectors | 连接器 |
| settings.nav.collectors | Collectors | 收集器 |
| settings.nav.rules | Rules | 规则 |
| settings.nav.memory | Memory | 记忆 |
| settings.nav.widgets | Widgets | 小组件 |
| settings.nav.skills | Skills | 技能 |
| settings.nav.providers | Providers | 供应商 |
| settings.nav.phone | Phone control | 手机控制 |
| settings.general.folder | Project folder | 项目文件夹 |
| settings.general.isDefault | Default | 默认 |
| settings.general.change | Change… | 更改 |
| settings.general.path | Folder path | 文件夹路径 |
| settings.general.moveFiles | Move the files into it | 把文件移过去 |
| settings.general.save | Save | 保存 |
| settings.general.cancel | Cancel | 取消 |
| settings.general.issues | Issues | 事项 |
| settings.general.exportIssues | Export issues | 导出事项 |
| settings.general.export | Export | 导出 |
| settings.general.exportFailed | Could not export the issues | 事项没能导出 |
| settings.general.pet | Pet | 宠物 |
| settings.general.showPet | Show pet | 显示宠物 |
| settings.general.doubleSpace | Double Space to open conversation | 双击空格打开对话 |
| settings.general.holdSpace | Hold Space for voice input | 长按空格语音输入 |
| settings.general.model | Model | 模型 |
| settings.general.changeModel | Change in DSH | 在 DSH 里更换 |
| settings.general.lastTidy | Last tidy | 最近一次整理 |
| settings.general.noTidy | Not tidied yet | 还没有整理过 |
| settings.general.undoTidy | Undo tidy | 撤销整理 |
| settings.general.deepSleep | Deep sleep | 深度睡眠 |
| settings.general.currentModel | Uses the current DSH model | 用 DSH 当前的模型 |
| settings.connectors.add | Add connector | 添加连接器 |
| settings.connectors.name | Name | 名称 |
| settings.connectors.prompt | Prompt | Prompt |
| settings.connectors.empty | No connectors | 没有连接器 |
| settings.connectors.remove | Remove | 删除 |
| settings.connectors.addedByDudu | Added by Dudu | 嘟嘟添加 |
| settings.connectors.removeOf | Remove {name} | 删除：{name} |
| settings.connectors.removed | Removed {name} | 已删除 {name} |
| settings.connectors.undo | Undo | 撤销 |
| settings.connectors.kind.prompt | Prompt | Prompt |
| settings.connectors.kind.mcp | MCP | MCP |
| settings.connectors.server | MCP server | MCP 服务 |
| settings.connectors.authorized | Authorized | 已授权 |
| settings.connectors.needsAuth | Needs authorization | 需要授权 |
| settings.connectors.usedBy | Collectors: {names} | 收集器：{names} |
| settings.connectors.inUse | Collectors still use it: {names} | 还有收集器在用它：{names} |
| settings.collectors.add | Add collector | 添加收集器 |
| settings.collectors.name | Name | 名称 |
| settings.collectors.connector | Connector | 连接器 |
| settings.collectors.prompt | What to collect | 收集什么 |
| settings.collectors.empty | No collectors | 没有收集器 |
| settings.collectors.needConnector | Add a connector first | 先添加一个连接器 |
| settings.collectors.frequency | How often, such as 30m, 2h, 1d, or cron | 频率，如 30m、2h、1d，或 cron |
| settings.collectors.common | Common frequencies | 常用频率 |
| settings.collectors.notes | Notes | 笔记 |
| settings.collectors.addedByDudu | Added by Dudu | 嘟嘟添加 |
| settings.collectors.removeOf | Remove {name} | 删除：{name} |
| settings.collectors.removed | Removed {name} | 已删除 {name} |
| settings.collectors.undo | Undo | 撤销 |
| settings.collectors.last.done | Last {time} · {n} new<br>Last {time} · nothing new | 上次 {time} · 新增 {n} 条<br>上次 {time} · 没有新的 |
| settings.collectors.last.failed | Last {time} · failed | 上次 {time} · 读取失败 |
| settings.collectors.everyMinutes / everyHours / everyDays | Every {n} minutes / Every {n} hours / Every hour / Every {n} days / Every day | 每 {n} 分钟 / 每 {n} 小时 / 每小时 / 每 {n} 天 / 每天 |
| settings.collectors.preset.* | Every 5 minutes … Monday to Friday, every hour 9–18 | 每 5 分钟 … 周一至周五 9 至 18 点每小时 |
| settings.rules.open | Open | 打开 |
| settings.rules.empty | Empty | 空 |
| settings.rules.missing | Not found | 未找到 |
| settings.rules.note | Dudu follows these two Markdown files. Edit them directly, or tell Dudu. | 两份 Markdown 文件，嘟嘟照着它们判断。直接改文件，或者对嘟嘟说。 |
| settings.rules.files.TRIAGE.md.title | Impact, effort and due dates | 影响、工作量和截止 |
| settings.rules.files.TRIAGE.md.description | How important a new issue is, how much work it takes and when it is due | 新来的事有多重要、要花多少功夫、什么时候要 |
| settings.rules.files.ASSIGN.md.title | Issue assignment | 任务分配 |
| settings.rules.files.ASSIGN.md.description | Which agent gets each issue; leave uncertain ones unassigned | 什么事交给哪个智能体；拿不准的留着 |
| settings.memory.search | Search records | 搜索记录 |
| settings.memory.count | 1 record<br>3 records | 1 条<br>3 条 |
| settings.memory.editOf | Edit: {text} | 编辑：{text} |
| settings.memory.forgetOf | Forget: {text} | 忘记：{text} |
| settings.memory.empty | Nothing is remembered yet | 还没有记住的事 |
| settings.memory.edit | Edit | 编辑 |
| settings.memory.save | Save | 保存 |
| settings.memory.cancel | Cancel | 取消 |
| settings.memory.forget | Forget | 忘记 |
| settings.memory.willDelete | This will be deleted | 将要删除 |
| settings.memory.confirmForget | Delete | 删除 |
| settings.memory.since | Since {date} | 自 {date} |
| settings.memory.superseded | Superseded | 已替代 |
| settings.memory.reviews | Tidy runs | 整理记录 |
| settings.memory.noReviews | No tidy runs yet | 还没有整理记录 |
| settings.memory.undo | Undo | 撤销 |
| settings.memory.scope | This removes local memory and its references. DSH source messages and model history stay. | 会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。 |
| settings.memory.summary | No changes<br>1 entry updated, 1 entry added, 1 skill added<br>3 entries updated, 3 entries added, 3 skills added | 没有变更<br>更新 1 条，新增 1 条，新增 1 项技能<br>更新 3 条，新增 3 条，新增 3 项技能 |
| settings.memory.counts.turns | conversation turns | 轮对话 |
| settings.memory.counts.entries | entries | 条记忆 |
| settings.memory.counts.logLines | lines of the daily notes | 行每日记录 |
| settings.memory.counts.skills | skills | 项技能 |
| settings.memory.counts.reviews | tidy notes | 条整理记录 |
| settings.memory.counts.staged | staged notes | 条待整理记录 |
| settings.widgets.onDashboard | On the dashboard | 在仪表盘上 |
| settings.widgets.builtIn | Built in | 内置 |
| settings.widgets.reads | Reads {what} | 读取{what} |
| settings.widgets.switchOn | Put {name} on the dashboard | 将{name}放到仪表盘上 |
| settings.widgets.note | Widgets come from Dudu and your installed DSH plugins. Install plugins on DSH’s Plugins page. | 小组件来自嘟嘟自带的，和你在 DSH 里装的插件。装插件在 DSH 的插件页。 |
| settings.widgets.developerDescription | In layout editing, local widgets get an inspector for sizes, themes, example data and checks | 编辑版面时，本地小组件上多一个检查器：最小和推荐大小、浅色深色、示例数据、检查结果 |
| settings.widgets.developer | Developer mode | 开发者模式 |
| settings.widgets.local | Local widgets | 本地小组件 |
| settings.widgets.developing | In development | 开发中 |
| settings.widgets.inspect | Inspect widget | 检查小组件 |
| settings.widgets.minimum | Minimum size | 最小尺寸 |
| settings.widgets.recommended | Recommended size | 推荐尺寸 |
| settings.widgets.light | Light | 浅色 |
| settings.widgets.dark | Dark | 深色 |
| settings.widgets.theme | Theme | 主题 |
| settings.widgets.sample | Example data | 示例数据 |
| settings.widgets.mine | My data | 我的数据 |
| settings.widgets.data | Data | 数据 |
| settings.widgets.checks | Checks | 检查 |
| settings.widgets.metadata | Name, description and preview | 名称、描述和预览 |
| settings.widgets.fits | Content fits | 内容完整显示 |
| settings.widgets.accessible | Icon buttons have labels | 图标按钮有名称 |
| settings.widgets.healthy | No errors | 没有错误 |
| settings.widgets.pass | Pass | 通过 |
| settings.widgets.fail | Check | 待检查 |
| settings.widgets.idMismatch | The widget id does not match its slot registration. | 小组件编号与插槽注册不一致。 |
| settings.skills.empty | No skills yet | 还没有技能 |
| settings.skills.delete | Delete | 删除 |
| settings.skills.back | Back to skills | 返回技能 |
| settings.skills.note | Dudu’s own skills are separate from each agent’s skills. | 嘟嘟自己的技能，和各智能体的技能互不影响。 |
| settings.skills.deleteOf | Delete: {name} | 删除：{name} |
| agentState.idle | Idle | 空闲中 |
| agentState.working | Working | 工作中 |
| agentState.blocked | Needs you | 需要你 |
| agentState.unassigned | Unassigned | 未分配 |
| deepSleep | Deep sleep | 深度睡眠 |
| fields.label | Labels | 标签 |
| display.property.labels | Labels | 标签 |
| labels.name | Labels | 标签 |
| labels.add | Add label | 添加标签 |
| labels.search | Change or add labels… | 修改或添加标签… |
| labels.create | Create new label: "{name}" | 新建标签：“{name}” |
| labels.pickColor | Pick a color for label | 选择标签颜色 |
| labels.colors | Grey · Dark Grey · Purple · Teal · Green · Yellow · Orange · Pink · Red | 灰色 · 深灰 · 紫色 · 青色 · 绿色 · 黄色 · 橙色 · 粉色 · 红色 |
| labels.loading / failed / createFailed / empty | Loading labels… · Could not load labels · Could not create the label · No labels yet | 正在读取标签… · 标签没能读取 · 标签没能创建 · 还没有标签 |
| subIssues.add / addMore | Add sub-issue · Add sub-issues | 添加子事项 · 添加子事项 |
| subIssues.title / placeholder | Sub-issues · Sub-issue title | 子事项 · 子事项标题 |
| subIssues.parent / subIssueOf | Parent issue · Sub-issue of | 父事项 · 子事项，属于 |
| subIssues.setParent / removeParent / searchParent / noMatch | Set parent issue… · Remove parent · Search issues… · No issues found | 设置父事项… · 移除父事项 · 搜索事项… · 没有找到事项 |
| subIssues.createFailed | Could not create the sub-issue | 子事项没能创建 |
| newIssue2.more / parent | More · Parent issue | 更多 · 父事项 |
| pet.open | Open conversation | 展开对话 |
| pet.close | Close | 关闭 |
| pet.conversation | Dudu | 嘟嘟 |
| pet.message | Message | 发消息 |
| pet.send | Send | 发送 |
| pet.earlier | Earlier | 更早的对话 |
| pet.voice | Voice input | 语音输入 |
| pet.release | Release to send · Esc to cancel | 松开发送 · Esc 取消 |
| pet.stop | Stop | 停止 |
| pet.failed | Could not load the conversation | 对话没能加载 |
| pet.voiceFailed | Voice input failed | 语音输入失败 |
| pet.doubleSpace | Double Space to chat | 双击空格对话 |
| pet.holdSpace | Hold Space to speak | 长按空格说话 |
| pet.actions.issues_add | Issue added | 已添加事项 |
| pet.actions.issues_update | Issue updated | 已更新事项 |
| pet.actions.issues_assign | Issue assigned | 已分配事项 |
| pet.actions.issues_complete | Issue completed | 已完成事项 |
| pet.actions.issues_cancel | Issue canceled | 已取消事项 |
| pet.actions.memory_remember | Remembered | 已记录 |
| pet.actions.memory_forget | Forgotten | 已忘记 |
| pet.actions.connector_register | Connector added | 已添加连接器 |
| pet.actions.collector_register | Collector added | 已添加收集器 |
| pet.actions.dashboard_add | Widget added | 已添加小组件 |
| pet.actions.dashboard_remove | Widget removed | 已移除小组件 |
| pet.actions.dashboard_reset | Layout restored | 已恢复版面 |
| noAgent | No agent | 未分配 |
| today | Today | 今天 |
| dueIn | in 1 day<br>in 3 days | 1 天后<br>3 天后 |
| overdue | 1 day overdue<br>3 days overdue | 逾期 1 天<br>逾期 3 天 |
| empty | No issues | 没有事项 |
| loadFailed | Could not load issues | 事项没能加载 |
| retry | Retry | 重试 |
| shell.unavailable | Connection unavailable. | 连接暂时不可用。 |
| shell.reading | Loading connection settings… | 正在读取连接配置… |
| shell.loading | Loading… | 正在读取… |
| shell.busy | Working… | 处理中… |
| shell.phone | Phone control | 手机控制 |
| shell.computerName | Computer name | 电脑名称 |
| shell.addresses | Connection addresses | 连接地址 |
| shell.lan | LAN address | 内网地址 |
| shell.lanCode | Generate a QR code for the LAN address | 为内网地址生成二维码 |
| shell.generate | Generate QR code | 生成二维码 |
| shell.address | Connection address 1<br>Connection address 3 | 连接地址 1<br>连接地址 3 |
| shell.removeAddress | Delete connection address 1<br>Delete connection address 3 | 删除连接地址 1<br>删除连接地址 3 |
| shell.remove | Delete | 删除 |
| shell.addAddress | Add address | 添加地址 |
| shell.save | Save | 保存 |
| shell.saved | Saved | 已保存 |
| shell.devices | Paired devices | 已配对设备 |
| shell.paired | Paired on {date} | 配对于 {date} |
| shell.revoke | Revoke | 撤销 |
| shell.noDevices | No paired devices | 暂无配对设备 |
| shell.scan | Open Dudu to scan | 打开嘟嘟扫码 |
| shell.close | Close | 关闭 |
| shell.copied | Copied | 已复制 |
| shell.copyPairing | Copy pairing link | 复制配对链接 |
| shell.copyFailed | Could not copy. Scan the QR code to connect. | 复制失败，请扫码连接 |
| shell.expiry | QR code expires in 10 minutes | 二维码 10 分钟内有效 |
| shell.pair | Pair phone | 配对手机 |
| shell.revokeQuestion | Revoke the connection to {name}? | 撤销 {name} 的连接？ |
| shell.cancel | Cancel | 取消 |
| shell.revokePairing | Revoke pairing | 撤销配对 |
| shell.providers | Providers | 供应商 |
| shell.state | Status | 状态 |
| shell.enable | Enable | 启用 |
| shell.executable | Executable path | 可执行文件路径 |
| shell.autoFind | Leave blank to find automatically | 留空则自动查找 |
| shell.detect | Check again | 重新检测 |
| shell.providerStates.ready | Ready | 可用 |
| shell.providerStates.missing | Not found | 未找到 |
| shell.providerStates.unsupported | Unsupported version | 版本不受支持 |
| shell.providerStates.broken | Cannot run | 无法运行 |
| shell.providerChip | Provider: {name} | 供应商：{name} |
| diagnostics.Enter a folder path. | Enter a folder path. | 填写文件夹路径。 |
| diagnostics.Use a full path. | Use a full path. | 填写完整路径。 |
| diagnostics.That is a temporary folder the system may clear. Choose another. | That is a temporary folder the system may clear. Choose another. | 这是系统可能清理的临时文件夹，请换一个。 |
| diagnostics.That path is a file, not a folder. | That path is a file, not a folder. | 这个路径指向文件，请选择文件夹。 |
| diagnostics.That folder already has other files. Choose an empty one, or one 嘟嘟 made. | That folder already has other files. Choose an empty one, or one Dudu made. | 文件夹里已有其他文件，请选择空文件夹或嘟嘟的文件夹。 |
| diagnostics.嘟嘟 can't write to that folder. | Dudu can't write to that folder. | 嘟嘟不能写入这个文件夹。 |
| diagnostics.嘟嘟 can't read that folder. | Dudu can't read that folder. | 嘟嘟不能读取这个文件夹。 |
| diagnostics.That path is a link that leads nowhere. | That path is a link that leads nowhere. | 这个路径是已失效的链接。 |
| diagnostics.The current folder is a link. Move its files yourself. | The current folder is a link. Move its files yourself. | 当前文件夹是链接，请手动移动文件。 |
| diagnostics.The current folder is not a 嘟嘟 folder, so nothing was moved. | The current folder is not a Dudu folder, so nothing was moved. | 当前文件夹不是嘟嘟的文件夹，文件没有移动。 |
| diagnostics.The new folder must be empty. | The new folder must be empty. | 新文件夹必须是空的。 |
| diagnostics.The new folder can't be inside the current one, or the other way round. | The new folder can't be inside the current one, or the other way round. | 新旧文件夹不能互相包含。 |
| diagnostics.That is already the folder in use. | That is already the folder in use. | 已经在使用这个文件夹。 |
| diagnostics.The files could not be moved. Nothing was deleted. | The files could not be moved. Nothing was deleted. | 文件没能移动，没有删除任何文件。 |
| diagnostics.Give the source a short name. | Give the connector a short name. | 请给连接器起一个简短的名称。 |
| diagnostics.Give a prompt saying where and what to collect. | Write a prompt saying where and what to collect. | 请写下去哪里收集、收集什么。 |
| diagnostics.A line of the prompt cannot start with # or ## (it would be read as a heading). | A line of the prompt cannot start with # or ##. | Prompt 里的行不能以 # 或 ## 开头。 |
| diagnostics.Keep credentials in the existing tools, not in source prompts. | Keep credentials out of prompts. Use the tool that holds them. | 不要把密钥写进 Prompt，请使用保存密钥的工具。 |
| diagnostics.The source prompts changed. Read them again before editing. | The connectors changed. Reload and try again. | 连接器刚刚有变动，请重新打开再试。 |
| diagnostics.There are too many source prompts. | There are too many connectors. | 连接器太多了。 |
| diagnostics.This source no longer exists. | This connector no longer exists. | 这个连接器已不存在。 |
| diagnostics.The source prompts could not be read or saved. | The connectors could not be read or saved. | 连接器没能读取或保存。 |
| diagnostics.Wait until the conversation and memory tidy finish. | Wait until the conversation and memory tidy finish. | 请等对话和记忆整理结束。 |
| diagnostics.It is not a widget declaration. | It is not a widget declaration. | 这不是小组件声明。 |
| diagnostics.It has no id. | It has no id. | 缺少编号。 |
| diagnostics.It has no name. | It has no name. | 缺少名称。 |
| diagnostics.It has no minimum size. | It has no minimum size. | 缺少最小尺寸。 |
| diagnostics.Its minimum size must be whole columns and rows, up to 12 rows. | Its minimum size must be whole columns and rows, up to 12 rows. | 最小尺寸须为整数列和行，最多 12 行。 |
| diagnostics.It has no recommended size. | It has no recommended size. | 缺少推荐尺寸。 |
| diagnostics.Its recommended size must be whole columns and rows, up to 12 rows. | Its recommended size must be whole columns and rows, up to 12 rows. | 推荐尺寸须为整数列和行，最多 12 行。 |
| diagnostics.Its recommended size is smaller than its minimum size. | Its recommended size is smaller than its minimum size. | 推荐尺寸小于最小尺寸。 |
| diagnostics.Its needs must be a list. | Its needs must be a list. | 数据来源须为列表。 |
| diagnostics.Its description must be text. | Its description must be text. | 说明须为文字。 |
| diagnostics.Use a plugin name followed by a dot and a widget name. | Use a plugin name followed by a dot and a widget name. | 编号须为插件名、小数点和小组件名。 |
| diagnostics.This widget needs a different version of 嘟嘟. | This widget needs a different version of Dudu. | 这个小组件需要其他版本的嘟嘟。 |
| diagnostics.This widget declares an unknown data source. | This widget declares an unknown data source. | 小组件声明了未知的数据来源。 |
| diagnostics.The development flag must be true or false. | The development flag must be true or false. | 开发标记须为 true 或 false。 |
| diagnostics.The widget id does not match its slot registration. | The widget id does not match its slot registration. | 小组件编号与插槽注册不一致。 |

## Office 的独立用词

Office 复用同一语言设置；事项状态、智能体状态等复用主表。Office 自己没有别的固定字（设置、工位数量和未分配都已去掉：工位固定 9 个）。

标题为 `Office` / `办公室`；读屏摘要如 `Office: 7 issues, 2 need you, 1 stuck, 1 working, 3 idle` / `办公室：7 条事项，2 等你回复，1 卡住了，1 工作中，3 空闲`，只统计已分配的进行中事项；名牌为事项编号、标题、当前语言的状态和智能体状态；智能体名字 Claude / ChatGPT / DeepSeek 保持原名。白板的未分配总数单独统计，不生成员工。

## 保留的旧连接器兼容译文

以下键仍在代码中，便于识别旧诊断；当前连接器界面不显示这些启停、测试、启动配置和操作白名单控件。现在只保存采集 Prompt，并提供删除和撤销，不能把本表当成现行功能说明。

| 代码位置 | English | 中文 |
|---|---|---|
| connectorDiagnostics.skipped.tooBig | The file is too large to read. | 文件太大，无法读取。 |
| connectorDiagnostics.skipped.noMeta | No metadata comment (&lt;!-- id: … --&gt;) found. | 缺少元数据注释（&lt;!-- id: … --&gt;）。 |
| connectorDiagnostics.skipped.badId | The id must be 1 to 24 lowercase letters, digits or hyphens. | id 须为 1 到 24 个小写字母、数字或连字符。 |
| connectorDiagnostics.skipped.badEnabled | enabled must be true or false. | enabled 须为 true 或 false。 |
| connectorDiagnostics.skipped.noJson | No json block found. | 缺少 json 代码块。 |
| connectorDiagnostics.skipped.manyJson | More than one json block. | 有多个 json 代码块。 |
| connectorDiagnostics.skipped.unclosedJson | The json block is not closed. | json 代码块没有闭合。 |
| connectorDiagnostics.skipped.badJson | The json block is not valid JSON.<br>The json block is not valid JSON (line 3, column 8).<br>The json block is not valid JSON (at position 12). | json 代码块格式无效。<br>json 代码块格式无效（第 3 行，第 8 列）。<br>json 代码块格式无效（位置 12）。 |
| connectorDiagnostics.skipped.duplicate | This id is already used on line 3. | 这个 id 已在第 3 行使用。 |
| connectorDiagnostics.config.notObject | The json block must be an object. | json 代码块须为对象。 |
| connectorDiagnostics.config.badKind | kind must be cli, mcp or dsh. | kind 须为 cli、mcp 或 dsh。 |
| connectorDiagnostics.config.unknownKey | Unknown field "{key}". | 未知字段“{key}”。 |
| connectorDiagnostics.config.command | command must be a program name on PATH or an absolute path. | command 须为 PATH 中的程序名或绝对路径。 |
| connectorDiagnostics.config.runsAnything | "{name}" runs whatever it is told to, so an allow list cannot limit it. | “{name}”可运行任意指令，允许列表无法限制它。 |
| connectorDiagnostics.config.noAllow | A command connector needs an allow list of operations. | 命令行连接器需要允许的操作列表。 |
| connectorDiagnostics.config.allow | allow[3] {why} | allow[3]：{why} |
| connectorDiagnostics.config.allowShape | must be text, or an object with run, and optionally name, description and readOnly. | 须为文字，或含 run 的对象；可选 name、description 和 readOnly。 |
| connectorDiagnostics.config.allowTwice | is already listed. | 已在列表中。 |
| connectorDiagnostics.config.allowName | name must be lowercase letters, digits and underscores, up to 29. | name 须为小写字母、数字和下划线，最多 29 个字符。 |
| connectorDiagnostics.config.allowNameTwice | name is already used by another operation. | name 已被其他操作使用。 |
| connectorDiagnostics.config.allowDescription | description must be one line of up to 300 characters. | description 须为一行文字，最多 300 个字符。 |
| connectorDiagnostics.config.allowReadOnly | readOnly must be true or false. | readOnly 须为 true 或 false。 |
| connectorDiagnostics.config.allowTooMany | allow can have at most 50 operations. | allow 最多可有 50 个操作。 |
| connectorDiagnostics.config.map | {label} must be an object. | {label} 须为对象。 |
| connectorDiagnostics.config.mapName | {label} has a name that is not allowed: {key}. | {label} 中的名称不符合要求：{key}。 |
| connectorDiagnostics.config.mapValue | {label}.{key} must be text, { "secret": "&lt;reference&gt;" } or { "env": "&lt;NAME&gt;" }, each with an optional prefix. | {label}.{key} 须为文字、{ "secret": "&lt;reference&gt;" } 或 { "env": "&lt;NAME&gt;" }，可附带 prefix。 |
| connectorDiagnostics.config.literalSecret | {label}.{key} holds a secret as plain text; use { "secret": "&lt;reference&gt;" }. | {label}.{key} 含有明文凭据，请改用 { "secret": "&lt;reference&gt;" }。 |
| connectorDiagnostics.config.transport | transport must be stdio or http. | transport 须为 stdio 或 http。 |
| connectorDiagnostics.config.args | args must be a list of up to 50 pieces of text. | args 须为文字列表，最多 50 项。 |
| connectorDiagnostics.config.argSecret | This holds a secret as plain text; give it through env as { "secret": "&lt;reference&gt;" }. | 含有明文凭据，请通过 env 的 { "secret": "&lt;reference&gt;" } 传入。 |
| connectorDiagnostics.config.envBlocked | {name} changes how programs load code or connect, so Dudu cannot set it. | {name} 会改变程序加载代码或连接的方式，嘟嘟不能设置它。 |
| connectorDiagnostics.config.cwd | cwd must be an absolute path. | cwd 须为绝对路径。 |
| connectorDiagnostics.config.url | url must be an http or https address. | url 须为 http 或 https 地址。 |
| connectorDiagnostics.config.urlHttps | Use an https address (http is only for this computer). | 请使用 https 地址；http 只用于本机。 |
| connectorDiagnostics.config.urlCredential | The url holds a credential; put it in headers as a secret reference. | url 含有凭据，请在 headers 中使用凭据引用。 |
| connectorDiagnostics.config.mixed | url and headers belong to http, command, args, env and cwd to stdio. | url 和 headers 用于 http；command、args、env 和 cwd 用于 stdio。 |
| connectorDiagnostics.config.from | from must be { agent, name } where agent is claude, claude-desktop or codex. | from 须为 { agent, name }，agent 为 claude、claude-desktop 或 codex。 |
| connectorDiagnostics.config.fromScope | scope must be user or project, and a project scope needs an absolute project path. | scope 须为 user 或 project；project 需要绝对项目路径。 |
| connectorDiagnostics.config.fromExclusive | from replaces command, args, env, url and headers; give one or the other. | from 与 command、args、env、url、headers 只能选一种。 |
| connectorDiagnostics.config.launch | launch must be the 16 character fingerprint written when the connector was turned on. | launch 须为启用连接器时写入的 16 位指纹。 |
| connectorDiagnostics.config.server | server must be the name between mcp__ and __ in the DSH tool names. | server 须为 DSH 工具名称中 mcp__ 与 __ 之间的名称。 |
| connectorDiagnostics.config.tools | tools must be a list of tool names. | tools 须为工具名称列表。 |
| connectorDiagnostics.config.timeout | timeoutSec must be a whole number from 1 to 120. | timeoutSec 须为 1 到 120 的整数。 |
| connectorDiagnostics.config.oneLine | {label} must be one line of text. | {label} 须为一行文字。 |
| connectorDiagnostics.config.notMarkdown | {label} must not start like a heading, a code block or a comment. | {label} 不能以标题、代码块或注释开头。 |
| connectorDiagnostics.config.name | name must be one line of up to 100 characters. | name 须为一行文字，最多 100 个字符。 |
| connectorDiagnostics.config.id | id must be 1 to 24 lowercase letters, digits or hyphens. | id 须为 1 到 24 个小写字母、数字或连字符。 |
| connectorDiagnostics.config.needId | Give the connector an id (lowercase letters, digits and hyphens). | 请填写连接器 id，使用小写字母、数字和连字符。 |
| connectorDiagnostics.config.input | The input must be an object. | 输入须为对象。 |
| connectorDiagnostics.config.ownerOnly | {key} is yours to set; Dudu cannot. | {key} 由你设置，嘟嘟不能修改。 |
| connectorDiagnostics.template.empty | The template is empty. | 模板为空。 |
| connectorDiagnostics.template.tooLong | The template is longer than 500 characters. | 模板超过 500 个字符。 |
| connectorDiagnostics.template.tooMany | The template has more than 40 words. | 模板超过 40 个词。 |
| connectorDiagnostics.template.unclosedQuote | The template has a quote that is not closed. | 模板中的引号没有闭合。 |
| connectorDiagnostics.template.firstWord | The first word of a template must be fixed text, not a {placeholder}. | 模板的第一个词须为固定文字，不能是 {placeholder}。 |
| connectorDiagnostics.runtime.fileError | CONNECTORS.md could not be read or written ({code}). | CONNECTORS.md 无法读取或写入（{code}）。 |
| connectorDiagnostics.runtime.unexpected | Something went wrong: {what} | 出错了：{what} |
| connectorDiagnostics.runtime.busy | CONNECTORS.md keeps changing; try again. | CONNECTORS.md 一直在变动，请重试。 |
| connectorDiagnostics.runtime.unclosedFence | CONNECTORS.md has a code block that is never closed (line 3); it has to be closed before a connector can be added. | CONNECTORS.md 第 3 行的代码块没有闭合，请先补齐再添加连接器。 |
| connectorDiagnostics.runtime.noFolder | The project folder does not exist. | 项目文件夹不存在。 |
| connectorDiagnostics.runtime.noConnector | There is no connector "3". | 没有编号为“3”的连接器。 |
| connectorDiagnostics.runtime.broken | The entry "3" on line 3 cannot be used: {reason} | 第 3 行的条目“3”无法使用：{reason} |
| connectorDiagnostics.runtime.exists | There is already a connector "3". | 编号为“3”的连接器已存在。 |
| connectorDiagnostics.runtime.notDudu | "3" is not Dudu's entry; Dudu cannot change or remove it. | “3”由你添加，嘟嘟不能修改或删除。 |
| connectorDiagnostics.runtime.isOn | "3" is on. It has to be turned off before its settings can change. | “3”已开启，请先关闭再修改配置。 |
| connectorDiagnostics.runtime.changedSince | "3" changed since it was shown; look at it again before turning it on. | “3”已变动，请重新查看后再开启。 |
| connectorDiagnostics.runtime.badTicks | tools must be a list of tool names, or null for the default. | tools 须为工具名称列表；null 表示使用默认值。 |
| connectorDiagnostics.runtime.noUndo | This undo is not available any more. | 这次操作已无法撤销。 |
| connectorDiagnostics.runtime.undoChanged | "3" was changed after that; nothing was undone. | “3”后来有改动，没有撤销。 |
| connectorDiagnostics.runtime.undoBack | "3" exists again; nothing was undone. | “3”已重新出现，没有撤销。 |
| connectorDiagnostics.runtime.unknownOperation | There is no operation "{name}" in an enabled connector. | 已开启的连接器中没有操作“{name}”。 |
| connectorDiagnostics.runtime.isOff | The connector "3" is off; it is turned on in the connections page. | 连接器“3”已关闭，请在连接器页开启。 |
| connectorDiagnostics.runtime.needsReview | The original configuration of "3" changed since it was turned on; it has to be looked at and turned on again. | “3”的原始配置有变动，请查看后重新开启。 |
| connectorDiagnostics.runtime.notRead | "{name}" is not a read operation, so it is not run for reading. | “{name}”不是读取操作，不会自动运行。 |
| connectorDiagnostics.runtime.notReadable | A {kind} connector can only be used inside the conversation. | {kind} 连接器只能在对话中使用。 |
| connectorDiagnostics.runtime.noDsh | DSH tools are not available here. | 这里无法使用 DSH 工具。 |
| connectorDiagnostics.runtime.noDshServer | DSH has no tools from a server called "{server}". | DSH 没有来自“{server}”的工具。 |
| connectorDiagnostics.runtime.outputCut | The program wrote more than the limit and was stopped; this is the beginning of its output. | 程序输出超过限制，已停止；这里只显示开头部分。 |
| connectorDiagnostics.runtime.argObject | arguments must be an object. | arguments 须为对象。 |
| connectorDiagnostics.runtime.argUnknown | {name} is not an argument of this operation. | {name} 不是这个操作的参数。 |
| connectorDiagnostics.runtime.argMissing | {name} is missing. | 缺少 {name}。 |
| connectorDiagnostics.runtime.argType | {name} must be text or a number. | {name} 须为文字或数字。 |
| connectorDiagnostics.runtime.argLong | {name} is longer than 3 characters. | {name} 超过 3 个字符。 |
| connectorDiagnostics.runtime.argControl | {name} has a control character or a line break. | {name} 含有控制字符或换行。 |
| connectorDiagnostics.runtime.argDash | {name} starts with "-", which would be read as an option. | {name} 以“-”开头，会被当作选项。 |
| connectorDiagnostics.runtime.notFound | The program "{command}" was not found; check that it is installed and on PATH. | 找不到程序“{command}”，请检查是否已安装并在 PATH 中。 |
| connectorDiagnostics.runtime.cannotRun | The program "{command}" could not be started ({code}). | 程序“{command}”无法启动（{code}）。 |
| connectorDiagnostics.runtime.exited | The program ended with exit code {code}. | 程序已结束，退出码为 {code}。 |
| connectorDiagnostics.runtime.killed | The program was stopped ({signal}). | 程序已停止（{signal}）。 |
| connectorDiagnostics.runtime.timedOut | Stopped after 3 seconds without a result. | 3 秒内没有结果，已停止。 |
| connectorDiagnostics.runtime.toolError | The tool reported an error. | 工具返回了错误。 |
| connectorDiagnostics.runtime.cannotConnect | Could not connect: {why} | 无法连接：{why} |
| connectorDiagnostics.runtime.signIn | The server wants a sign-in. Sign in with the tool that owns the server; this app does not handle sign-in. | 服务器要求登录，请在配置它的工具中登录。 |
| connectorDiagnostics.runtime.closed | The server closed the connection. | 服务器关闭了连接。 |
| connectorDiagnostics.runtime.unreachable | Could not reach the server ({code}). | 无法访问服务器（{code}）。 |
| connectorDiagnostics.runtime.unsupported | {what} is not supported here (stdio and streamable HTTP are). | 这里不支持 {what}，可使用 stdio 和 streamable HTTP。 |
| connectorDiagnostics.runtime.noSecret | The credential "{ref}" is not in the credential store. | 凭据库中没有“{ref}”。 |
| connectorDiagnostics.runtime.noEnv | The environment variable {name} is not set. | 未设置环境变量 {name}。 |
| connectorDiagnostics.runtime.original | The entry "{name}" is not in the {agent} configuration (any more). | {agent} 配置中没有条目“{name}”。 |
| connectorDiagnostics.runtime.originalBad | The {agent} configuration could not be read. | 无法读取 {agent} 配置。 |
| connectorDiagnostics.runtime.vars | The original configuration uses ${{name}}, which is not set. | 原始配置使用的 ${{name}} 尚未设置。 |
| connectorDiagnostics.runtime.sse | The original configuration uses the older SSE transport. | 原始配置使用旧的 SSE 传输方式。 |
| connectorDiagnostics.runtime.cannotReadConfig | The {agent} configuration could not be read. | 无法读取 {agent} 配置。 |
| connectorDiagnostics.runtime.tooMany | There are too many connectors. | 连接器数量过多。 |

## 2026-11-01 会话接管和提及补充（待审）

| Key | English | 中文 |
|---|---|---|
| widgets.sessions.clear | Clear search | 清空搜索 |
| widgets.sessions.more | More sessions | 更多会话 |
| widgets.sessions.openFailed | Could not open this session. | 会话没能打开。 |
| widgets.sessions.takeoverLabel | Let Dudu manage this task | 交给嘟嘟管理 |
| widgets.sessions.takeover | Let Dudu manage: {title} | 交给嘟嘟管理：{标题} |
| widgets.sessions.takeoverFailed | Could not take over this session. | 会话没能接管。 |
| detail.messageErrors.recipient_unavailable | Mention the recipient assigned to this issue. | 只能 @ 当前事项的处理者。 |

## 2026-11-04 宠物对话窗口的运行行（英文待审）

取代上面已删的 `pet.working`（`Working` / `工作中`）。中文是主人指定的，英文取自 DSH 自己的 `Deep diving for 9s ···`；说明见 [issues-ui-wording.md](issues-ui-wording.md) 的同日一节。

| Key | English | 中文 |
|---|---|---|
| pet.running | Deep diving | 深度求索中 |
| pet.runningFor | Deep diving for {duration} ··· | 深度求索中，用时 {duration} ··· |
| pet.duration | 9s · 1m 15s · 1h 2m 5s | 9秒 · 1分15秒 · 1小时2分5秒 |
| copy.menu | Copy | 复制 |
| copy.title | Copy title | 复制标题 |
| copy.markdown | Copy issue as Markdown | 复制事项为 Markdown |
| copy.everything | Copy everything as Markdown | 复制全部内容为 Markdown |
| copy.branch | Copy git branch name | 复制 Git 分支名 |
| copy.prompt | Copy as prompt | 复制为提示词 |
| copy.duplicate | Make a copy… | 复制一份… |
| copy.done.title | title（Copied title） | 标题（已复制 标题） |
| copy.done.markdown | issue as Markdown | 事项 Markdown |
| copy.done.everything | everything as Markdown | 全部内容 Markdown |
| copy.done.branch | git branch name | Git 分支名 |
| copy.done.prompt | prompt | 提示词 |
| deleteIssue.title | Delete "{name}"? | 删除“{name}”？ |
| deleteIssue.titleMany | Delete {count} issues? | 删除 {count} 条事项？ |
| deleteIssue.scope | This issue, its activity and local links will be deleted. Source messages and session history stay. | 将删除这条事项、活动和本地关联。来源消息和会话历史会保留。 |
| deleteIssue.scopeMany | These issues, their activity and local links will be deleted. Source messages and session history stay. | 将删除这些事项、它们的活动和本地关联。来源消息和会话历史会保留。 |
| links.title | Links | 链接 |
| links.add | Add link… | 添加链接… |
| links.addPullRequest | Add pull request… | 添加拉取请求… |
| links.addDocument | Add document… | 添加文档… |
| links.url | URL | 网址 |
| links.titleOptional | Title (optional) | 标题（可选） |
| links.addButton | Add | 添加 |
| links.dialog.link | Add link | 添加链接 |
| links.dialog.pull_request | Add pull request | 添加拉取请求 |
| links.dialog.document | Add document | 添加文档 |
| links.remove | Remove {name} | 移除 {name} |
| links.invalid | Enter a web address that starts with http:// or https:// | 请输入以 http:// 或 https:// 开头的网址。 |
| links.duplicate | This link is on the issue already. | 这条链接已经在事项上了。 |
| descriptionHistory.menu | Show description history | 查看描述历史 |
| descriptionHistory.title | Description history | 描述历史 |
| descriptionHistory.current | Current version | 当前版本 |
| descriptionHistory.restore | Restore this version | 恢复此版本 |
| descriptionHistory.close | Close | 关闭 |
| descriptionHistory.none | The description has not been changed. | 描述还没有改过。 |
| descriptionHistory.empty | The description was empty. | 当时的描述是空的。 |
| richText.menu | Blocks | 内容块 |
| richText.linkPlaceholder | Paste or type a link… | 粘贴或输入链接… |
| richText.blocks.heading1 | Heading 1 | 一级标题 |
| richText.blocks.heading2 | Heading 2 | 二级标题 |
| richText.blocks.heading3 | Heading 3 | 三级标题 |
| richText.blocks.bulletList | Bulleted list | 无序列表 |
| richText.blocks.orderedList | Numbered list | 有序列表 |
| richText.blocks.taskList | Checklist | 待办清单 |
| richText.blocks.quote | Quote | 引用 |
| richText.blocks.codeBlock | Code block | 代码块 |
| richText.blocks.divider | Divider | 分隔线 |
| richText.format.bold | Bold | 加粗 |
| richText.format.italic | Italic | 斜体 |
| richText.format.strike | Strikethrough | 删除线 |
| richText.format.code | Code | 代码 |
| richText.format.link | Link | 链接 |
| views.add | Add new view | 添加视图 |
| views.newTitle | New view | 新视图 |
| views.renameTitle | Rename view | 重命名视图 |
| views.name | View name | 视图名称 |
| views.create | Create view | 创建视图 |
| views.save | Save | 保存 |
| views.rename | Rename | 重命名 |
| views.delete | Delete view | 删除视图 |
| views.deleteTitle | Delete view "{name}"? | 删除视图“{name}”？ |
| views.deleteScope | The view is deleted. The issues in it stay. | 将删除这个视图，里面的事项不受影响。 |
| widgets.sessions.unsearchable | {count} sessions cannot be searched, so results may be incomplete | 还有 {count} 个会话没法搜索内容，结果可能不全 |
| widgets.sessions.indexing | Building the search index ({done}/{total}), so results may be incomplete | 正在建立搜索索引（{done}/{total}），结果可能不全 |
| widgets.sessions.listPartial | Some sessions could not be read, so the list may be incomplete | 部分会话没能读取，列表可能不全 |
