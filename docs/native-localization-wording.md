# iPhone 中英文文案对照（待审阅）

2026-11-14。中文沿用现有 App 文案；英文优先复用 Desktop 已有译文。标记“新增”的英文等待主人逐字审阅后发布。标记“复用”的条目没有被这次实现重新判定为已批准，原先待审的 Desktop 文案仍保持原状态。此文件是文案清单，不会显示在 App。

界面跟随 iOS 为 Dudu 选择的语言；支持简体中文和英语。没有增加语言选择器或说明段落。会话、Prompt、项目、事项、自定义状态、规则正文、记忆正文和技能正文均保留原文。

`{0}`、`{1}` 是运行时内容；`%lld` 是 String Catalog 的整数参数。`one` / `other` 是英文单复数形式，并非同时显示。日期、星期、列表连接词由系统按界面语言格式化，不固定翻译具体日期。

## 系统权限弹窗

| 系统键 | 中文（保持原文） | English（新增，待审） |
|---|---|---|
| NSCameraUsageDescription | 拍摄对话图片，或扫描电脑上的 Dudu 配对二维码。 | Take photos for conversations, or scan the Dudu pairing QR code on your computer. |
| NSLocalNetworkUsageDescription | 连接你电脑上的 DSH，继续对话和管理任务。 | Connect to DSH on your computer to continue conversations and manage tasks. |
| NSMicrophoneUsageDescription | 按住说话，将语音转换为对话文字。 | Hold to speak and convert speech into conversation text. |
| NSPhotoLibraryAddUsageDescription | 将会话图片保存到照片图库。 | Save conversation images to your photo library. |
| NSPhotoLibraryUsageDescription | 选择照片作为对话附件。 | Choose photos to attach to conversations. |
| NSSpeechRecognitionUsageDescription | 将语音识别为文字，发送到当前会话。 | Convert speech to text to send to the current session. |

## App 和手机接口

2026-11-20 问题框：主人选择 A 入口并批准 iOS / Android 实现，新增中文
“回答问题”已随 `.local/designs/mobile-questions-2026-11-20/v4/` 的 A 方案批准。
英文尚未审阅，String Catalog 仅登记已批准的中文，Android 同步同一来源。
上一题、下一题、跳过、提交、输入你的答案及校验提示均复用已有键，不增加说明文案。

共 726 个去重的界面键。原生目录有 606 个键；接口和内嵌页面有 158 个键，其中一部分共用译文。

| 中文 / 参数模板 | English | 来源 / 状态 | 使用处 |
|---|---|---|---|
|  · 默认 |  · Default | 新增，待审 | native-settings.mjs |
| %.2f 秒 | %.2f s | 新增，待审 | ConversationFileStorage.swift |
| %lld 个任务 | one: %lld task<br>other: %lld tasks | 新增，待审 | SidebarView.swift |
| %lld 分钟 | one: %lld minute<br>other: %lld minutes | 新增，待审 | LibraryView.swift |
| %lld 天 | one: %lld day<br>other: %lld days | 新增，待审 | Quota.swift、LibraryView.swift |
| %lld 小时 | one: %lld hour<br>other: %lld hours | 新增，待审 | Quota.swift、LibraryView.swift |
| %lld 条 | one: %lld item<br>other: %lld items | 新增，待审 | SidebarView.swift |
| %lld 条排队消息 | one: %lld queued message<br>other: %lld queued messages | 新增，待审 | QueuedMessagesPanel.swift |
| %lld 秒 | one: %lld second<br>other: %lld seconds | 新增，待审 | LibraryView.swift |
| /目标 | /goal | 新增，待审 | ChatView.swift |
| 5 小时 | 5-hour | 复用 widgets.quota.fiveHour | Quota.swift |
| @ 后面还要写要说的话。 | Add a message after the mention. | 复用 detail.messageErrors.empty_request | AssistantComposer.swift |
| API 密钥无效 | Invalid API key | 新增，待审 | ConversationFeatureViews.swift |
| DSH 进程在本轮完成前退出（例如被强制结束、崩溃或关闭超时），重新启动后本轮已中止。未完成的工具调用结果未知。 | DSH exited before this turn finished, for example after a force quit, crash, or shutdown timeout. The turn was aborted on restart. Results of unfinished tool calls are unknown. | 新增，待审 | ConversationFeatureViews.swift |
| Token 用量 | Token usage | 新增，待审 | ConversationFileStorage.swift |
| [图片] | [Image] | 新增，待审 | native-bridge.mjs |
| 每周 | Weekly | 新增，待审 | Quota.swift |
| {0}<br>会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。 | {0}<br>Local memory and its references will be deleted. DSH source messages and model history will be kept. | 新增，待审 | native-settings.mjs |
| {0} {1}分 | {0} {1} min | 新增，待审 | Tasks.swift |
| {0} 个工具 | one: {0} tool<br>other: {0} tools | 新增，待审 | native-settings.mjs |
| {0} 个连接器 | one: {0} connector<br>other: {0} connectors | 新增，待审 | native-settings.mjs |
| {0} 已完成 | {0} completed | 新增，待审 | TodoList.swift |
| {0} 待处理 | {0} pending | 新增，待审 | TodoList.swift |
| {0} 条事项 | one: {0} issue<br>other: {0} issues | 新增，待审 | native-settings.mjs |
| {0} 每周 | {0} weekly | 新增，待审 | Quota.swift |
| {0} 的更多操作 | More actions for {0} | 新增，待审 | SidebarView.swift |
| {0} 的连接详情 | Connection details for {0} | 新增，待审 | ComputerListView.swift |
| {0} 轮 {1} 步 | {0} turns · {1} steps | 新增，待审 | ConversationFileStorage.swift |
| {0} 进行中 | {0} in progress | 新增，待审 | TodoList.swift |
| {0} 重置 | Resets {0} | 新增，待审 | Quota.swift |
| {0}分 | {0}m | 新增，待审 | Transcript.swift |
| {0}分{1}秒 | {0}m {1}s | 新增，待审 | SessionActivity.swift |
| {0}分钟 | {0} min | 新增，待审 | SidebarView.swift |
| {0}小时 | {0}h | 新增，待审 | Transcript.swift、SidebarView.swift |
| {0}小时{1}分 | {0}h {1}m | 新增，待审 | SessionActivity.swift |
| {0}并{1} | {0} and {1} | 新增，待审 | Transcript.swift |
| {0}秒 | {0}s | 新增，待审 | SessionActivity.swift、Transcript.swift |
| {0}等 | {0}, and more | 新增，待审 | Transcript.swift |
| {0}（{1}/{2}） | {0} ({1}/{2}) | 新增，待审 | ConversationFeatureViews.swift |
| {0}，{1} | {0}, {1} | 新增，待审 | BoardView.swift、GoalBanner.swift、QuotaSheet.swift、SidebarView.swift、TaskPanel.swift |
| {0}，剩余 {1}%{2} | {0}, {1}% remaining{2} | 新增，待审 | QuotaSheet.swift |
| {0}：{1} | {0}: {1} | 新增，待审 | GroupChat.swift |
| 一周后 | In one week | 复用 due.oneWeek | IssueCreationPickers.swift |
| 一条命令 | One command | 复用 settings.connectorsPage.custom.how.command | native-settings.mjs |
| 上一条事项 | Previous issue | 复用 detail.previous | DuduRootView.swift |
| 上一题 | Previous question | 新增，待审 | ConversationQuestionsView.swift |
| 上下文 | Context | 新增，待审 | CollectorView.swift |
| 上下文已压缩 | Context compacted | 新增，待审 | Transcript.swift |
| 上次 {0} · 新增 {1} 条 | one: Last {0} · {1} new item<br>other: Last {0} · {1} new items | 新增，待审 | native-settings.mjs |
| 上次 {0} · 没有新的 | Last {0} · Nothing new | 新增，待审 | native-settings.mjs |
| 上次 {0} · 读取失败 | Last {0} · Read failed | 新增，待审 | native-settings.mjs |
| 上移 | Move up | 复用 settings.statuses.moveUp | native-settings.mjs |
| 下一条事项 | Next issue | 复用 detail.next | DuduRootView.swift |
| 下一题 | Next question | 新增，待审 | ConversationQuestionsView.swift |
| 下次 {0} | Next {0} | 新增，待审 | LibraryView.swift |
| 下次运行 | Next run | 复用 tasks.next | TaskSheets.swift |
| 下次运行 {0} | Next run {0} | 新增，待审 | Tasks.swift |
| 下移 | Move down | 复用 settings.statuses.moveDown | native-settings.mjs |
| 下载 | Download | 复用 attachments.download | PhotoAttachmentPreview.swift |
| 不支持此操作。 | This action is not supported. | 新增，待审 | native-server.mjs |
| 不用登录 | No sign-in | 复用 settings.connectorsPage.custom.how.none | native-settings.mjs |
| 两侧内容相同 | Both sides are identical | 新增，待审 | ConversationFeatureViews.swift |
| 中 | Medium | 复用 priority.medium | IssueCreation.swift |
| 主智能体 | Main agent | 新增，待审 | SessionActivitySheet.swift |
| 事项 | issues | 复用 widgets.needs.issues | native-settings.mjs |
| 事项标题 | Issue title | 复用 newIssue.titlePlaceholder | NewIssueSheet.swift |
| 事项没能创建 | Could not create the issue | 复用 newIssue.failed | NewIssueSheet.swift |
| 事项没能加载 | Could not load issues | 复用 loadFailed | BoardView.swift、CollectorView.swift、IssueActionsSheet.swift、IssueCreationPickers.swift、NewIssueSheet.swift |
| 二进制文件，无法显示改动 | Cannot show changes to a binary file | 新增，待审 | ConversationFeatureViews.swift |
| 仅一次 | Once | 复用 tasks.kinds.once | Tasks.swift、TaskSheets.swift |
| 仅可查看 | Read Only | 新增，待审 | PermissionLabels.swift |
| 仅显示已归档 | Archived only | 新增，待审 | SidebarView.swift |
| 代码 | Code | 新增，待审 | Transcript.swift |
| 令牌 | Token | 复用 settings.connectorsPage.custom.token | native-settings.mjs |
| 任务 | Tasks | 复用 tasks.title | QuickCards.swift、DuduRootView.swift、TaskPanel.swift、TaskSheets.swift、TasksView.swift、Navigation or embedded pages |
| 定时任务 | Scheduled tasks | App 菜单中文由主人 2026-11-17 指定；英文原先复用 Tasks，2026-11-17 主人说“就按你定的来吧”，改成 Scheduled tasks（Tasks 放在 Agent team / Background tasks 旁边容易和后台任务混）。同一个词也是对话「…」菜单的第三项和它的面板标题（SessionTasksSheet.swift） | SidebarView.swift（包括无障碍名称，兼容旧导航目录）、DuduRootView.swift、SessionActivity.swift |
| 任务分配 | Issue assignment | 复用 settings.rules.files.ASSIGN.md.title | native-settings.mjs |
| 任务已停止 | Task stopped | 新增，待审 | ConversationFeatureViews.swift |
| 任务已因退出 DeepSeek 登录而停止。 | The task stopped because you signed out of DeepSeek. | 新增，待审 | ConversationFeatureViews.swift |
| 任务没能加载 | Could not load tasks | 新增，待审 | TaskSheets.swift、TasksView.swift |
| 任务运行记录 | Task run history | 复用 tasks.history | TaskSheets.swift |
| 任务，{0} | Tasks, {0} | 新增，待审 | TaskPanel.swift |
| 优先级 | Priority | 复用 fields.priority | IssueActionsSheet.swift、NewIssueSheet.swift |
| 会话 | Session | 复用 source.session | SidebarView.swift |
| 会话名称 | Session name | 新增，待审 | SidebarView.swift |
| 会话统计 | Session statistics | 新增，待审 | ConversationFileStorage.swift |
| 会话视图选项 | Session view options | 新增，待审 | SidebarView.swift |
| 低 | Low | 复用 priority.low | IssueCreation.swift |
| 余额 | Balance | 复用 widgets.quota.balance | QuotaSheet.swift |
| 你： | You:  | 复用 pet.you | QuickTodoViews.swift |
| 使用中 | In use | 新增，待审 | ComputerConnectionView.swift |
| 供应商 | Provider | 复用 tasks.provider | ChatView.swift、TaskSheets.swift |
| 保存 | Save | 复用 detail.saveResult | ComputerConnectionView.swift、GoalBanner.swift、IssueCreationPickers.swift、QueuedMessagesPanel.swift、TaskSheets.swift、native-settings.mjs |
| 保存修改 | Save changes | 复用 tasks.save | TaskSheets.swift |
| 信息 | Collector | 复用 widgets.titles.collector | QuickCards.swift、CollectorView.swift、Navigation or embedded pages |
| 信息没能加载 | Could not load the information | 复用 collector.loadFailed | CollectorView.swift |
| 修改了文件 | Edited files | 新增，待审 | Transcript.swift |
| 修改或添加标签… | Change or add labels… | 复用 labels.search | IssueCreationPickers.swift |
| 值 | Value | 复用 settings.connectorsPage.custom.envValue | NativeSettingsView.swift |
| 停止 | Stop | 复用 pet.stop | SessionActivitySheet.swift |
| 停止任务 | Stop task | 新增，待审 | ChatView.swift、ComposerAttachmentSheet.swift |
| 允许 | Allow | 新增，待审 | ChatView.swift |
| 元数据 | Metadata | 新增，待审 | ConversationFeatureViews.swift |
| 先写点内容。 | Write a message first. | 复用 detail.messageErrors.invalid_message | AssistantComposer.swift |
| 先打开一个会话 | Open a session first | 新增，待审 | DuduRootView.swift |
| 先添加一个连接器 | Add a connector first | 复用 settings.collectors.needConnector | native-settings.mjs |
| 先选择智能体。 | Choose an agent first. | 复用 detail.messageErrors.choose_agent | AssistantComposer.swift |
| 先选项目，再把工作交给智能体。 | Choose a project before sending work to an agent. | 复用 detail.messageErrors.choose_project | AssistantComposer.swift |
| 全选 | Select all | 复用 bulk.selectAll | CollectorView.swift、DuduRootView.swift |
| 全部 | All | 复用 display.completed.all | Tasks.swift |
| 全部 %lld 个文件 | one: All %lld file<br>other: All %lld files | 新增，待审 | TurnFilesView.swift |
| 全部事项 | All issues | 复用 tabs.all | Board.swift |
| 全部对话（显示已归档） | All sessions (including archived) | 新增，待审 | SidebarView.swift |
| 公网地址 | Public address | 复用 shell.publicAddress | ComputerConnectionView.swift |
| 公网地址请使用 HTTPS | Use HTTPS for a public address | 新增，待审 | Models.swift |
| 关于 | About | 新增，待审 | AboutView.swift、SettingsView.swift |
| 关联会话 | Linked conversation | 复用 tasks.linked | TaskSheets.swift |
| 关联工作区 | Workspace | 复用 tasks.workspace | TaskSheets.swift |
| 关闭 | Close | 复用 descriptionHistory.close | CollectorView.swift、ConversationFeatureViews.swift、IssueActionsSheet.swift、NewIssueSheet.swift、QuickSheetPage.swift、SessionActivitySheet.swift、TaskSheets.swift、TurnFilesView.swift |
| 关闭会话列表 | Close session list | 新增，待审 | DuduRootView.swift |
| 关闭侧边栏 | Close sidebar | 新增，待审 | DrawerMotion.swift |
| 关闭提示 | Dismiss notification | 新增，待审 | DuduToast.swift |
| 关闭文件 | Close file | 新增，待审 | WorkPanelView.swift |
| 关闭照片预览 | Close photo preview | 新增，待审 | PhotoAttachmentPreview.swift |
| 关闭电脑连接 | Close computer connections | 新增，待审 | ComputerListView.swift |
| 关闭设置 | Close settings | 新增，待审 | SettingsView.swift |
| 其他设置 | Other settings | 新增，待审 | SettingsView.swift、Navigation or embedded pages |
| 内网和公网都无法连接 | Cannot connect to the local or public address | 新增，待审 | Models.swift |
| 内网地址 | LAN address | 复用 shell.lan | ComputerConnectionView.swift |
| 写入 | Write | 新增，待审 | Transcript.swift |
| 分 | m  | 复用 pet.duration.minute | TaskSheets.swift |
| 分组方式 | Group by | 新增，待审 | SidebarView.swift |
| 切换到键盘 | Switch to keyboard | 新增，待审 | ChatView.swift |
| 刚刚 | just now | 复用 activity.justNow | SidebarView.swift |
| 创建 | Create | 复用 settings.statuses.create | native-settings.mjs |
| 创建事项 | Create issue | 复用 newIssue.create | NewIssueSheet.swift |
| 创建目标 | Create goal | 新增，待审 | Transcript.swift |
| 删除 | Delete | 复用 collector.remove | BoardView.swift、CollectorView.swift、ComputerListView.swift、MessageActions.swift、NativeSettingsView.swift、SidebarView.swift、native-settings.mjs |
| 删除“{0} {1}”？ | Delete “{0} {1}”? | 新增，待审 | BoardView.swift |
| 删除任务 | Delete task | 复用 tasks.delete | TaskSheets.swift、TasksView.swift |
| 删除失败：这条消息可能已经开始发送。 | Could not delete this message. It may already be sending. | 新增，待审 | ChatView.swift |
| 删除工作区 | Delete workspace | 新增，待审 | SidebarView.swift |
| 删除工作区「{0}」？ | Delete workspace “{0}”? | 新增，待审 | SidebarView.swift |
| 删除排队消息 | Delete queued message | 新增，待审 | QueuedMessagesPanel.swift |
| 刷新文件 | Refresh files | 新增，待审 | WorkPanelView.swift |
| 剩余 | Remaining | 新增，待审 | QuotaSheet.swift |
| 办公 | Work | 复用 settings.connectorsPage.groups.work | native-settings.mjs |
| 加载更多 | Load more | 复用 tasks.more | ConversationFeatureViews.swift、TaskSheets.swift |
| 加载更早 | Load earlier | 新增，待审 | ChatView.swift |
| 加载设置… | Loading settings… | 新增，待审 | SettingsView.swift |
| 单列表 | Single list | 新增，待审 | SidebarView.swift |
| 单次延迟 · {0} | One-time delay · {0} | 新增，待审 | LibraryView.swift |
| 单次提醒 | One-time reminder | 新增，待审 | LibraryView.swift |
| 压缩 | Compact | 复用 pet.compact | ComposerAttachmentSheet.swift |
| 压缩失败 | Compaction failed | 新增，待审 | SessionCommands.swift |
| 压缩已取消 | Compaction canceled | 新增，待审 | SessionCommands.swift |
| 压缩已完成，但会话保存失败 | Compaction finished, but the session could not be saved. | 新增，待审 | SessionCommands.swift |
| 压缩期间历史发生了变化，请重试 | History changed during compaction. Try again. | 新增，待审 | SessionCommands.swift |
| 压缩未能完整完成，请检查会话状态 | Compaction did not finish. Check the session. | 新增，待审 | SessionCommands.swift |
| 原会话 | Original session | 新增，待审 | LibraryView.swift |
| 发消息 | Message | 复用 pet.message | ChatView.swift |
| 发送 | Send | 复用 detail.send | ChatView.swift |
| 取消 | Cancel | 复用 newIssue.cancel | BoardView.swift、CollectorView.swift、ComposerAttachmentSheet.swift、ComputerConnectionView.swift、GoalBanner.swift、IssueCreationPickers.swift、NativeSettingsView.swift、NewIssueSheet.swift、PairingView.swift、QueuedMessagesPanel.swift、SettingsView.swift、SidebarView.swift、TaskSheets.swift、native-settings.mjs |
| 取消归档 | Unarchive | 新增，待审 | SidebarView.swift |
| 取消归档后才能打开。 | Unarchive this session to open it. | 新增，待审 | SidebarView.swift |
| 取消置顶 | Unpin | 新增，待审 | SidebarView.swift |
| 取消选择 | Clear selection | 复用 bulk.clear | DuduRootView.swift |
| 受阻的目标 | Blocked goal | 新增，待审 | Transcript.swift |
| 变量名 | Variable name | 复用 settings.connectorsPage.custom.envName | NativeSettingsView.swift |
| 只移除工作区的登记。目录和其中的会话都会保留，会话会显示在「未分组」下。 | Only the workspace registration will be removed. Its folder and sessions will remain. Sessions will appear under “Ungrouped”. | 新增，待审 | SidebarView.swift |
| 只能 @ 当前事项的处理者。 | Mention the recipient assigned to this issue. | 复用 detail.messageErrors.recipient_unavailable | AssistantComposer.swift |
| 同意执行 | Approve and run | 新增，待审 | PlanReview.swift |
| 名称 | Name | 复用 settings.statuses.name | native-settings.mjs |
| 后台任务 | Background tasks | 新增，待审 | SessionActivity.swift、DuduRootView.swift |
| 后台任务状态更新 | Background task status updated | 新增，待审 | Transcript.swift |
| 向用户提出了问题 | Asked a question | 新增，待审 | Transcript.swift |
| 启用完全权限 | Enable full access | 新增，待审 | PermissionLabels.swift |
| 启用完全权限后，智能体将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。 | Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, and external commands. Use it only when you trust the current task. | 新增，待审 | PermissionLabels.swift |
| 启用自动审查 | Enable auto review | 新增，待审 | PermissionLabels.swift |
| 周一 | Mon | 新增，待审 | Quota.swift、Tasks.swift、LibraryView.swift |
| 周一至周五 | Monday to Friday | 复用 tasks.kinds.workdays | Tasks.swift |
| 周一至周五 09:00 | Monday to Friday at 09:00 | 复用 settings.collectors.preset.0 9 * * 1-5 | native-settings.mjs |
| 周一至周五 9 至 18 点每小时 | Monday to Friday, every hour 9–18 | 复用 settings.collectors.preset.0 9-18 * * 1-5 | native-settings.mjs |
| 周三 | Wed | 新增，待审 | Quota.swift、Tasks.swift、LibraryView.swift |
| 周二 | Tue | 新增，待审 | Quota.swift、Tasks.swift、LibraryView.swift |
| 周五 | Fri | 新增，待审 | Quota.swift、Tasks.swift、LibraryView.swift |
| 周六 | Sat | 新增，待审 | Quota.swift、Tasks.swift、LibraryView.swift |
| 周四 | Thu | 新增，待审 | Quota.swift、Tasks.swift、LibraryView.swift |
| 周日 | Sun | 新增，待审 | Quota.swift、Tasks.swift、LibraryView.swift |
| 命令行 | Command line | 复用 settings.connectorsPage.custom.kind.sentence | native-settings.mjs |
| 命令行 · {0} | CLI · {0} | 新增，待审 | native-settings.mjs |
| 嘟嘟 | Dudu | 复用 brand | Tasks.swift、DuduRootView.swift、native-bridge.mjs |
| 嘟嘟 · 默认 | Dudu · Default | 新增，待审 | native-settings.mjs |
| 回到最新消息 | Jump to latest message | 新增，待审 | ChatView.swift |
| 回复 | Reply | 复用 pet.reply | MessageActions.swift、QuickTodoViews.swift |
| 回复没能发给会话：连接暂时不可用。 | Could not send the reply to the session: connection unavailable. | 新增，待审 | AssistantComposer.swift |
| 回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。 | The answer was cut off. Existing output is kept in the conversation. Send “continue” to resume it. | 新增，待审 | ConversationFeatureViews.swift |
| 图片 | Image | 新增，待审 | MessageMarkdown.swift、native-bridge.mjs |
| 图片格式或大小不符合要求。 | The image format or size is not supported. | 新增，待审 | native-bridge.mjs、native-server.mjs |
| 在{0}中添加状态 | Add status to {0} | 新增，待审 | native-settings.mjs |
| 在浏览器里授权 | Sign in in the browser | 复用 settings.connectorsPage.custom.how.oauth | native-settings.mjs |
| 在电脑的「设置 → 手机控制」中生成配对码 | Generate a pairing code in Settings → Mobile Control on your computer | 新增，待审 | ConnectionGuideView.swift |
| 在终端运行 {0}，再点重试 | Run {0} in your terminal, then retry | 新增，待审 | native-settings.mjs |
| 基于 DSH 的多 Agent 高效协作助手 | An efficient multi-agent collaboration assistant built on DSH | 新增，待审 | AppInfo.swift |
| 处理中 | In Progress | 复用 status.in_progress | IssueCreation.swift、NewIssueSheet.swift、native-settings.mjs |
| 处理失败 | Processing failed | 新增，待审 | Transcript.swift |
| 处理过程 | Activity | 新增，待审 | ChatView.swift |
| 复制 | Copy | 复用 copy.menu | MessageActions.swift |
| 复制文件内容 | Copy file contents | 新增，待审 | WorkPanelView.swift |
| 复制路径 | Copy path | 新增，待审 | TurnFilesView.swift |
| 失败 | Failed | 新增，待审 | SessionActivity.swift |
| 失败原因：{0} | Reason: {0} | 新增，待审 | ConversationFeatureViews.swift |
| 子任务状态更新 | Subtask status updated | 新增，待审 | Transcript.swift |
| 子智能体 | Subagent | 新增，待审 | Transcript.swift |
| 安全存储暂时不可用。 | Secure storage is temporarily unavailable. | 新增，待审 | Models.swift |
| 完全权限 | Full access | 新增，待审 | PermissionLabels.swift |
| 完成 | Done | 复用 dashboard.done | SessionCommands.swift、ConversationFeatureViews.swift、MessageActions.swift、PairingView.swift、PlanReview.swift |
| 对准电脑上显示的配对码 | Point at the pairing code on your computer | 新增，待审 | QRScannerView.swift |
| 对话 | Conversation | 新增，待审 | DuduRootView.swift |
| 将事项移至：{0} | Move issues to: {0} | 新增，待审 | native-settings.mjs |
| 将删除这条事项、活动和本地关联。来源消息和会话历史会保留。 | This issue, its activity and local links will be deleted. Source messages and session history stay. | 复用 deleteIssue.scope | BoardView.swift |
| 将要删除 | This will be deleted | 复用 settings.confirmDelete.title | native-settings.mjs |
| 尚未设置目标 | No goal set | 新增，待审 | SessionCommands.swift |
| 就是这句话 | This sentence | 复用 settings.connectorsPage.custom.how.sentence | native-settings.mjs |
| 展开 | Show more | 复用 detail.showMore | GroupChatViews.swift |
| 展开工具输出 | Expand tool output | 新增，待审 | ChatView.swift |
| 工作中 | Working | 复用 agentState.working | Board.swift、Models.swift、SessionActivity.swift |
| 工作区 | Workspace | 新增，待审 | SidebarView.swift |
| 工作区内修改 | Workspace Write | 新增，待审 | PermissionLabels.swift |
| 工作区名称 | Workspace name | 新增，待审 | SidebarView.swift |
| 工具调用 | Tool call | 新增，待审 | Transcript.swift、native-bridge.mjs |
| 工具调用用时 | Tool time | 新增，待审 | ConversationFileStorage.swift |
| 工具输出 | Tool output | 新增，待审 | ChatView.swift |
| 已停止 | Stopped | 新增，待审 | SessionActivity.swift、Transcript.swift |
| 已停用 | Disabled | 新增，待审 | LibraryView.swift |
| 已写入文件 | Wrote files | 新增，待审 | Transcript.swift |
| 已创建任务 | Task created | 复用 pet.actions.tasks_create | TaskSheets.swift |
| 已删除 | Deleted | 复用 collector.toast.deleted | Board.swift |
| 已删除 {0} | Deleted {0} | 新增，待审 | native-settings.mjs |
| 已删除任务 | Task deleted | 复用 pet.actions.tasks_delete | Tasks.swift |
| 已协调子智能体 | Coordinated subagents | 新增，待审 | Transcript.swift |
| 已压缩 | Compacted | 复用 pet.compacted | SessionCommands.swift |
| 已压缩 {0} 条历史记录（约 {1} tokens） | Compacted {0} history items (about {1} tokens) | 新增，待审 | Transcript.swift |
| 已压缩 {0} 条历史（约 {1} tokens） | Compacted {0} history items (about {1} tokens) | 新增，待审 | SessionCommands.swift |
| 已取消 | Canceled | 复用 status.canceled | IssueCreation.swift、NewIssueSheet.swift、native-settings.mjs |
| 已取消进入计划模式 | Plan mode entry canceled | 新增，待审 | SessionCommands.swift |
| 已启用 | Enabled | 新增，待审 | LibraryView.swift |
| 已处理 | Handled | 复用 collector.tabs.done | Board.swift、CollectorView.swift |
| 已完成 | Done | 复用 status.done | IssueCreation.swift、SessionActivity.swift、Transcript.swift、NewIssueSheet.swift、TaskPanel.swift、native-bridge.mjs、native-settings.mjs |
| 已完成分析 | Analyzed the request | 新增，待审 | Transcript.swift |
| 已完成，用时 {0} | Completed in {0} | 新增，待审 | Transcript.swift |
| 已展开 | Expanded | 新增，待审 | BoardView.swift、QuickTodoViews.swift、SidebarView.swift、TranscriptView.swift |
| 已开启 | Enabled | 复用 tasks.statuses.active | QuickCards.swift、Tasks.swift |
| 已开始 | Started | 复用 settings.statuses.categories.started | native-settings.mjs |
| 已归档的会话 | Archived session | 新增，待审 | SidebarView.swift |
| 已归档，取消归档后才能打开 | Archived. Unarchive to open. | 新增，待审 | SidebarView.swift |
| 已恢复 | Restored | 复用 collector.toast.restored | Board.swift |
| 已恢复任务 | Task resumed | 复用 pet.actions.tasks_resume | Tasks.swift |
| 已投递 | Delivered | 复用 tasks.delivery.delivered | Tasks.swift |
| 已投递到会话 | Delivered to session | 新增，待审 | LibraryView.swift |
| 已折叠 | Collapsed | 新增，待审 | BoardView.swift、SidebarView.swift |
| 已搜索代码 | Searched code | 新增，待审 | Transcript.swift |
| 已搜索网页 | Searched the web | 新增，待审 | Transcript.swift |
| 已收起 | Collapsed | 新增，待审 | QuickTodoViews.swift、TranscriptView.swift |
| 已新建  | Created  | 新增，待审 | CollectorView.swift |
| 已暂停 | Paused | 复用 tasks.statuses.paused | QuickCards.swift、Tasks.swift |
| 已暂停任务 | Task paused | 复用 pet.actions.tasks_pause | Tasks.swift |
| 已暂停的目标 | Paused goal | 新增，待审 | Transcript.swift |
| 已更新任务 | Task updated | 复用 pet.actions.tasks_update | TaskSheets.swift |
| 已更新目标 | Goal updated | 新增，待审 | SessionCommands.swift |
| 已替代 | Superseded | 复用 settings.memory.superseded | native-settings.mjs |
| 已有会话 | Existing conversation | 复用 tasks.targets.existing | Tasks.swift |
| 已有同名状态。 | A status with this name already exists. | 复用 settings.statuses.errors.duplicate_status | native-settings.mjs |
| 已有进行中的目标，请使用「更新目标」 | A goal is already active. Use “Update goal”. | 新增，待审 | SessionCommands.swift |
| 已添加工具 | Added tool | 新增，待审 | native-bridge.mjs |
| 已清除目标 | Goal cleared | 新增，待审 | SessionCommands.swift |
| 已移除工具 | Removed tool | 新增，待审 | native-bridge.mjs |
| 已结束 | Ended | 复用 tasks.statuses.ended | Tasks.swift |
| 已继续工作，仍可回答 | Work has resumed. You can still answer. | 新增，待审 | ConversationQuestionsView.swift |
| 已编辑 %lld 个文件 | one: Edited %lld file<br>other: Edited %lld files | 新增，待审 | TurnFilesView.swift |
| 已编辑文件 | Edited files | 新增，待审 | TurnFilesView.swift |
| 已置顶 | Pinned | 新增，待审 | SidebarView.swift |
| 已设置目标 | Goal set | 新增，待审 | SessionCommands.swift |
| 已访问网页 | Visited web pages | 新增，待审 | Transcript.swift |
| 已读取图片 | Read images | 新增，待审 | Transcript.swift |
| 已读取文件 | Read files | 新增，待审 | Transcript.swift |
| 已调用工具 | Called tools | 新增，待审 | Transcript.swift |
| 已达上限，{0} 重置 | Limit reached. Resets {0} | 新增，待审 | Quota.swift |
| 已达到输出 token 上限 | Output token limit reached | 新增，待审 | ConversationFeatureViews.swift |
| 已进入计划模式 | Entered plan mode | 新增，待审 | SessionCommands.swift |
| 已连接 | Connected | 复用 settings.connectorsPage.views.connected | SettingsView.swift、native-settings.mjs |
| 已连接 · {0} | Connected · {0} | 新增，待审 | ComputerConnectionView.swift、ComputerListView.swift |
| 已退出计划模式 | Left plan mode | 新增，待审 | SessionCommands.swift |
| 已选 {0} 条 | Selected: {0} | 新增，待审 | CollectorView.swift、DuduRootView.swift |
| 已重试模型请求 | Model request retried | 新增，待审 | ConversationFeatureViews.swift |
| 常用频率 | Common frequencies | 复用 settings.collectors.common | native-settings.mjs |
| 开发 | Development | 复用 settings.connectorsPage.groups.dev | native-settings.mjs |
| 开始时间 | Started | 新增，待审 | SessionActivitySheet.swift |
| 归档 | Archive | 新增，待审 | SidebarView.swift |
| 当前工具上下文 | Current tool context | 新增，待审 | native-bridge.mjs |
| 当前无法压缩，请等会话空闲后再试 | Compaction is unavailable. Wait until the session is idle. | 新增，待审 | SessionCommands.swift |
| 当前桌面服务不支持从手机修改权限预设。 | This desktop service does not support changing permission presets from the phone. | 新增，待审 | native-bridge.mjs、native-server.mjs |
| 当前模型未提供推理等级 | This model has no reasoning levels | 新增，待审 | ComposerAttachmentSheet.swift |
| 当前状态下无法执行此操作 | This action is unavailable in the current state | 新增，待审 | SessionCommands.swift |
| 当前请求的额度已用尽 | The quota for this request has been exhausted | 新增，待审 | ConversationFeatureViews.swift |
| 影响、工作量和截止 | Impact, effort and due dates | 复用 settings.rules.files.TRIAGE.md.title | native-settings.mjs |
| 待办 | Todo | 复用 status.todo | IssueCreation.swift、QuickCards.swift、NewIssueSheet.swift、QuickTodoViews.swift、native-settings.mjs |
| 待处理 | To handle | 复用 collector.tabs.todo | Board.swift、TaskPanel.swift |
| 待审核 | In Review | 复用 status.in_review | IssueCreation.swift、NewIssueSheet.swift、native-settings.mjs |
| 待确认 | Needs confirmation | 复用 tasks.delivery.uncertain | Tasks.swift |
| 待规划 | Backlog | 复用 tabs.backlog | Board.swift、IssueCreation.swift、NewIssueSheet.swift、native-settings.mjs |
| 忘记 | Forget | 复用 settings.memory.forget | native-settings.mjs |
| 思考 | Thinking | 新增，待审 | TranscriptView.swift |
| 思考过程 | Reasoning | 新增，待审 | ChatView.swift |
| 恢复 | Restore | 复用 collector.restore | CollectorView.swift |
| 恢复任务 | Resume task | 复用 tasks.resume | TaskSheets.swift、TasksView.swift |
| 恢复目标 | Resume goal | 新增，待审 | GoalBanner.swift |
| 截止日期 | Due date | 复用 display.orderBy.due | IssueActionsSheet.swift、IssueCreationPickers.swift、NewIssueSheet.swift |
| 所属会话 | Session | 新增，待审 | LibraryView.swift |
| 手机端暂不支持「{0}」 | “{0}” is not supported on the phone yet | 新增，待审 | DuduRootView.swift |
| 打开一次电脑上的 DSH 窗口后，这里会显示 DSH 的入口。 | Open DSH on your computer once to see its entries here. | 新增，待审 | SidebarView.swift |
| 打开事项 | Open issue | 复用 widgets.sessions.openIssue | CollectorView.swift |
| 打开会话 | Open session | 复用 detail.openSession | GroupChatViews.swift、LibraryView.swift、QuickTodoViews.swift |
| 打开会话列表 | Open session list | 新增，待审 | DuduRootView.swift |
| 打开会话后查看项目文件 | Open a session to view project files | 新增，待审 | WorkPanelView.swift |
| 打开来源 | Open source | 复用 detail.openSource | CollectorView.swift |
| 执行了命令 | Ran commands | 新增，待审 | Transcript.swift |
| 执行位置 | Run in | 复用 tasks.target | TaskSheets.swift |
| 执行失败 | Failed | 新增，待审 | native-bridge.mjs |
| 扫描配对码 | Scan pairing code | 新增，待审 | ConnectionGuideView.swift、PairingView.swift |
| 找不到请求的会话或项目。 | The requested session or project was not found. | 新增，待审 | native-bridge.mjs、native-server.mjs |
| 技能 | Skills | 复用 settings.nav.skills | NativeSettings.swift、native-settings.mjs |
| 投递失败 | Delivery failed | 复用 tasks.delivery.failed | Tasks.swift |
| 拒绝 | Deny | 新增，待审 | ChatView.swift |
| 指令 | Commands | 新增，待审 | ComposerAttachmentSheet.swift |
| 按住说话 | Hold to speak | 新增，待审 | ChatView.swift |
| 按住说话，上滑取消 | Hold to speak, slide up to cancel | 新增，待审 | VoicePressSurface.swift |
| 按工作区 | By workspace | 新增，待审 | SidebarView.swift |
| 授权 | Authorize | 复用 settings.connectorsPage.authorize | native-settings.mjs |
| 探测响应格式不正确。 | Invalid probe response. | 新增，待审 | native-server.mjs |
| 探索未至之境 | Explore the unknown | 新增，待审 | ConversationEmptyState.swift |
| 推理 | Reasoning | 新增，待审 | ConversationFileStorage.swift |
| 推理等级 | Reasoning effort | 复用 pet.effort | ComposerAttachmentSheet.swift、native-settings.mjs |
| 描述 | Description | 复用 settings.statuses.description | native-settings.mjs |
| 描述你的任务以生成计划 | Describe your task to generate a plan | 新增，待审 | ChatView.swift |
| 提交 | Submit | 新增，待审 | ConversationQuestionsView.swift |
| 提醒内容 | Reminder | 新增，待审 | LibraryView.swift |
| 提问 | Ask a question | 新增，待审 | Transcript.swift |
| 插件 | Plugins | 新增，待审 | DuduRootView.swift |
| 插件状态更新 | Plugin status updated | 新增，待审 | Transcript.swift |
| 插话发送 | Send now | 新增，待审 | QueuedMessagesPanel.swift |
| 插话发送失败，请重试。 | Could not send this message now. Try again. | 新增，待审 | ChatView.swift |
| 搜索事项… | Search issues… | 复用 search.placeholder | CollectorView.swift、IssueCreationPickers.swift |
| 搜索对话内容… | Search conversations… | 新增，待审 | ConversationSearchView.swift、SidebarView.swift |
| 搜索文件 | Search files | 新增，待审 | TurnFilesView.swift |
| 搜索文件内容 | Search file contents | 新增，待审 | Transcript.swift |
| 收到 GitHub 事件 | GitHub event received | 新增，待审 | Transcript.swift |
| 收到任务消息 | Task message received | 新增，待审 | Transcript.swift |
| 收到团队消息 | Team message received | 新增，待审 | Transcript.swift |
| 收到外部事件 | External event received | 新增，待审 | Transcript.swift |
| 收到执行请求 | Execution request received | 新增，待审 | Transcript.swift |
| 收起工具输出 | Collapse tool output | 新增，待审 | ChatView.swift |
| 收集什么 | What to collect | 复用 settings.collectors.prompt | native-settings.mjs |
| 收集器 | Collectors | 新增，待审 | NativeSettings.swift、native-settings.mjs |
| 放弃 | Discard | 复用 tasks.discard | TaskSheets.swift |
| 整理记录 | Tidy runs | 复用 settings.memory.reviews | native-settings.mjs |
| 文件 | File | 复用 pet.file | ComposerAttachmentSheet.swift、WorkPanelView.swift、native-bridge.mjs |
| 文件 {0} | File {0} | 新增，待审 | AttachmentTiles.swift |
| 文件夹不存在时创建 | Create the folder if it does not exist | 新增，待审 | IssueCreationPickers.swift |
| 文件超过 16 MB，无法发送 | Cannot send files larger than 16 MB | 新增，待审 | FileAttachments.swift |
| 文件较大，仅显示开头部分 | This file is large. Showing the beginning only. | 新增，待审 | WorkPanelView.swift |
| 文件过多，仅显示前 500 项 | Too many files. Showing the first 500. | 新增，待审 | WorkPanelView.swift |
| 文件过大，无法显示改动 | This file is too large to show changes | 新增，待审 | ConversationFeatureViews.swift |
| 断开 | Disconnect | 复用 settings.connectorsPage.disconnect | native-settings.mjs |
| 新会话 | New session | 新增，待审 | SidebarView.swift |
| 新增 {0} 条 | one: Added {0} item<br>other: Added {0} items | 新增，待审 | native-settings.mjs |
| 新增 {0} 项技能 | one: Added {0} skill<br>other: Added {0} skills | 新增，待审 | native-settings.mjs |
| 新对话 | New conversation | 新增，待审 | native-bridge.mjs |
| 新建事项 | New issue | 复用 newIssue.title | CollectorView.swift、DuduRootView.swift、NewIssueSheet.swift |
| 新建任务 | New task | 复用 tasks.create | DuduRootView.swift、TaskSheets.swift、TasksView.swift |
| 新建会话 | New session | 新增，待审 | SidebarView.swift |
| 新建对话并复用 | Create a conversation and reuse it | 复用 tasks.targets.reuse | Tasks.swift |
| 新建标签：“{0}” | New label: “{0}” | 新增，待审 | IssueCreationPickers.swift |
| 新建项目 | Create project | 复用 projects.create | IssueCreationPickers.swift |
| 无优先级 | No priority | 复用 priority.none | IssueCreation.swift |
| 无法启动相机。 | Cannot start the camera. | 新增，待审 | QRScannerView.swift |
| 无法读取这个文件 | Cannot read this file | 新增，待审 | FileAttachments.swift |
| 无法读取配对码。 | Cannot read the pairing code. | 新增，待审 | QRScannerView.swift |
| 无法连接内网地址 | Cannot connect to the local address | 新增，待审 | Models.swift |
| 无法连接，请检查电脑和网络 | Cannot connect. Check your computer and network. | 新增，待审 | Models.swift |
| 上传失败 | Upload failed | 中文为主人 2026-11-23 指定；英文新增，待审 | ConnectionModels.swift；Home.kt（上传被转发服务器以 413 拒绝时，原先显示「无法连接，请检查电脑和网络」） |
| 无项目 | No project | 复用 noProject | IssueCreationPickers.swift |
| 时区 | Time zone | 复用 tasks.timezone | TaskSheets.swift |
| 明天 | Tomorrow | 复用 snooze.tomorrow | IssueCreationPickers.swift |
| 昨天 | Yesterday | 复用 activity.yesterday | SidebarView.swift |
| 智能体 | Agent | 复用 fields.agent | IssueActionsSheet.swift、NewIssueSheet.swift |
| 智能体团队 | Agent team | 新增，待审 | SessionActivity.swift、DuduRootView.swift |
| 智能体状态 | Agent state | 复用 fields.agentState | IssueActionsSheet.swift |
| 暂不支持此操作。 | This action is not supported yet. | 新增，待审 | Models.swift |
| 暂停任务 | Pause task | 复用 tasks.pause | TaskSheets.swift、TasksView.swift |
| 暂停目标 | Pause goal | 新增，待审 | GoalBanner.swift |
| 暂无{0} | No {0} | 新增，待审 | LibraryView.swift |
| 暂无会话 | No sessions | 复用 widgets.sessions.empty | SidebarView.swift |
| 暂无可压缩的历史 | No history to compact | 新增，待审 | SessionCommands.swift |
| 暂无可选模型 | No models available | 新增，待审 | ComposerAttachmentSheet.swift |
| 暂无可选模式 | No modes available | 新增，待审 | ChatView.swift |
| 暂无后台任务 | No background tasks | 新增，待审 | SessionActivitySheet.swift |
| 暂无定时任务 | No scheduled tasks | 新增（2026-11-17，对话「…」菜单里的定时任务面板），主人说“就按你定的来吧” | SessionTasksSheet.swift |
| 暂无已归档会话 | No archived sessions | 新增，待审 | SidebarView.swift |
| 暂无已登记的项目 | No registered projects | 新增，待审 | ChatView.swift |
| 暂无文件 | No files | 新增，待审 | WorkPanelView.swift |
| 暂无权限选项 | No permission options | 新增，待审 | ComposerAttachmentSheet.swift |
| 暂无用量 | No usage to show | 复用 widgets.quota.empty | QuotaSheet.swift |
| 更多 | More | 复用 detail.more | BoardView.swift、CollectorView.swift、DuduRootView.swift、IssueActionsSheet.swift、NewIssueSheet.swift |
| 更改没能保存 | Could not save the change | 复用 toast.failed | Board.swift、NativeSettings.swift、Tasks.swift、CollectorView.swift、IssueActionsSheet.swift、TaskSheets.swift、native-settings.mjs |
| 更新 {0} 条 | one: Updated {0} item<br>other: Updated {0} items | 新增，待审 | native-settings.mjs |
| 更新了计划 | Updated the plan | 新增，待审 | Transcript.swift |
| 更新于 {0} | Updated {0} | 新增，待审 | Quota.swift |
| 更新待办清单 | Update todo list | 新增，待审 | Transcript.swift |
| 更新目标 | Update goal | 新增，待审 | Transcript.swift |
| 最近一次整理 | Last tidy | 复用 settings.general.lastTidy | native-settings.mjs |
| 最近触发 | Last triggered | 新增，待审 | LibraryView.swift |
| 有效期至{0} | Valid until {0} | 新增，待审 | Quota.swift |
| 有未保存的修改 | You have unsaved changes | 复用 tasks.unsaved | TaskSheets.swift |
| 未分组 | Ungrouped | 新增，待审 | SidebarList.swift |
| 未分配 | Unassigned | 复用 agentState.unassigned | Board.swift、NewIssueSheet.swift |
| 未开始 | Unstarted | 复用 settings.statuses.categories.unstarted | native-settings.mjs |
| 未找到 | Not found | 复用 settings.rules.missing | native-settings.mjs |
| 未缓存输入 | Uncached input | 新增，待审 | ConversationFileStorage.swift |
| 未能生成有效摘要，请稍后重试 | Could not generate a valid summary. Try again later. | 新增，待审 | SessionCommands.swift |
| 未连接 | Not connected | 新增，待审 | ComputerConnectionView.swift、SettingsView.swift |
| 本周结束 | End of this week | 复用 due.weekEnd | IssueCreationPickers.swift |
| 本地 | Local | 复用 settings.connectorsPage.custom.kind.local | native-settings.mjs |
| 本机 · {0} | Local · {0} | 新增，待审 | native-settings.mjs |
| 本轮删除的文件 | File deleted in this turn | 新增，待审 | ConversationFeatureViews.swift |
| 本轮新建的文件 | File created in this turn | 新增，待审 | ConversationFeatureViews.swift |
| 本轮运行失败 | This turn failed | 新增，待审 | ConversationFeatureViews.swift |
| 权限 | Permissions | 新增，待审 | ComposerAttachmentSheet.swift |
| 松手发送，上移取消 | Release to send, slide up to cancel | 新增，待审 | VoiceCaptureOverlay.swift |
| 松手取消 | Release to cancel | 新增，待审 | VoiceCaptureOverlay.swift |
| 查找文件 | Find files | 新增，待审 | Transcript.swift |
| 查看、切换或添加电脑 | View, switch, or add a computer | 新增，待审 | SettingsView.swift |
| 查看全文 | View full text | 新增，待审 | PlanReview.swift |
| 查看更多 | Show more | 新增，待审 | SidebarView.swift |
| 查看目标 | View goal | 新增，待审 | Transcript.swift |
| 查看详情 | View details | 新增，待审 | ChatView.swift |
| 标签 | Labels | 复用 fields.label | IssueActionsSheet.swift、IssueCreationPickers.swift、NewIssueSheet.swift |
| 标签没能创建 | Could not create the label | 复用 labels.createFailed | IssueCreationPickers.swift |
| 桌面服务拒绝了此操作。 | The desktop service denied this action. | 新增，待审 | native-bridge.mjs、native-server.mjs |
| 桌面服务暂时无法完成此操作。 | The desktop service could not complete this action. | 新增，待审 | native-bridge.mjs、native-server.mjs |
| 模型 | Model | 复用 tasks.model | ComposerAttachmentSheet.swift、TaskSheets.swift、native-settings.mjs |
| 模型用时 | Model time | 新增，待审 | ConversationFileStorage.swift |
| 模型请求重试已取消 | Model request retry canceled | 新增，待审 | ConversationFeatureViews.swift |
| 模式 | Mode | 新增，待审 | ChatView.swift |
| 橙色 | Orange | 复用 labels.colors.orange | IssuePropertyIcons.swift |
| 正在写入文件 | Writing files | 新增，待审 | Transcript.swift |
| 正在分析请求 | Analyzing the request | 新增，待审 | Transcript.swift |
| 正在加载会话 | Loading sessions | 新增，待审 | SidebarView.swift |
| 正在协调子智能体 | Coordinating subagents | 新增，待审 | Transcript.swift |
| 正在压缩… | Compacting… | 新增，待审 | Transcript.swift |
| 正在投递 | Delivering | 复用 tasks.delivery.delivering | Tasks.swift |
| 正在搜索代码 | Searching code | 新增，待审 | Transcript.swift |
| 正在搜索网页 | Searching the web | 新增，待审 | Transcript.swift |
| 正在更新计划 | Updating the plan | 新增，待审 | Transcript.swift |
| 正在编辑文件 | Editing files | 新增，待审 | Transcript.swift |
| 正在访问网页 | Visiting web pages | 新增，待审 | Transcript.swift |
| 正在识别… | Recognizing… | 新增，待审 | VoiceCaptureOverlay.swift |
| 正在读取图片 | Reading images | 新增，待审 | Transcript.swift |
| 正在读取文件 | Reading files | 新增，待审 | Transcript.swift |
| 正在调用工具 | Calling tools | 新增，待审 | Transcript.swift |
| 正在运行代码 | Running code | 新增，待审 | Transcript.swift |
| 正在运行命令 | Running commands | 新增，待审 | Transcript.swift |
| 正在连接 | Connecting | 新增，待审 | ConversationEmptyState.swift、SettingsView.swift |
| 正在连接… | Connecting… | 新增，待审 | ComputerConnectionView.swift、ComputerListView.swift、ConnectionGuideView.swift、ConversationEmptyState.swift |
| 正在退出计划模式，下一步生效 | Leaving plan mode on the next step | 新增，待审 | SessionCommands.swift |
| 正在重试模型请求 | Retrying model request | 新增，待审 | ConversationFeatureViews.swift |
| 此审批已失效或无法由手机处理。 | This approval has expired or cannot be handled from the phone. | 新增，待审 | native-bridge.mjs、native-server.mjs |
| 此操作暂不受支持。 | This action is not supported yet. | 新增，待审 | native-bridge.mjs、native-server.mjs |
| 此相机不支持二维码扫描。 | This camera does not support QR code scanning. | 新增，待审 | QRScannerView.swift |
| 每 15 分钟 | Every 15 minutes | 复用 settings.collectors.preset.15m | native-settings.mjs |
| 每 30 分钟 | Every 30 minutes | 复用 settings.collectors.preset.30m | native-settings.mjs |
| 每 5 分钟 | Every 5 minutes | 复用 settings.collectors.preset.5m | native-settings.mjs |
| 每 6 小时 | Every 6 hours | 复用 settings.collectors.preset.6h | native-settings.mjs |
| 每 {0} | Every {0} | 新增，待审 | LibraryView.swift |
| 每 {0} 分钟 | one: Every {0} minute<br>other: Every {0} minutes | 新增，待审 | native-settings.mjs |
| 每 {0} 天 | one: Every {0} day<br>other: Every {0} days | 新增，待审 | native-settings.mjs |
| 每 {0} 小时 | one: Every {0} hour<br>other: Every {0} hours | 新增，待审 | native-settings.mjs |
| 每个分类至少保留一个状态。 | Keep at least one status in each category. | 复用 settings.statuses.errors.last_status | native-settings.mjs |
| 每周 | Every week | 复用 tasks.kinds.weekly | Tasks.swift、LibraryView.swift、TaskSheets.swift |
| 每天 | Every day | 复用 tasks.kinds.daily | Tasks.swift、LibraryView.swift、native-settings.mjs |
| 每天 09:00 | Every day at 09:00 | 复用 settings.collectors.preset.0 9 * * * | native-settings.mjs |
| 每小时 | Every hour | 复用 settings.collectors.preset.1h | native-settings.mjs |
| 每月 | Every month | 复用 tasks.kinds.monthly | Tasks.swift、TaskSheets.swift |
| 每次新建对话 | New conversation each run | 复用 tasks.targets.new | Tasks.swift |
| 没找到 {0}{1} | Could not find {0}{1} | 新增，待审 | native-settings.mjs |
| 没有事项 | No issues | 复用 empty | QuickCards.swift、AssistantSuggestions.swift、BoardView.swift、CollectorView.swift、QuickTodoViews.swift |
| 没有任务 | No tasks | 复用 pet.noTasks | QuickCards.swift、TasksView.swift |
| 没有信息 | Nothing here | 复用 collector.empty | QuickCards.swift、CollectorView.swift |
| 没有匹配的会话 | No matching sessions | 新增，待审 | ConversationSearchView.swift |
| 没有变更 | No changes | 新增，待审 | native-settings.mjs |
| 没有可清除的目标 | No goal to clear | 新增，待审 | SessionCommands.swift |
| 没有可用的会话 | No sessions available | 新增，待审 | TaskSheets.swift |
| 没有可用的工作区 | No workspaces available | 新增，待审 | TaskSheets.swift |
| 没有找到事项 | No issues found | 复用 subIssues.noMatch | CollectorView.swift、IssueCreationPickers.swift |
| 没有收集器 | No collectors | 复用 settings.collectors.empty | native-settings.mjs |
| 没装 | Not installed | 复用 settings.connectorsPage.state.missing | native-settings.mjs |
| 深度求索中 | Deep diving | 复用 pet.running | TranscriptView.swift |
| 深度求索中 ··· | Deep thinking ··· | 新增，待审 | TranscriptView.swift |
| 深度求索中，用时 {0} ··· | Deep thinking, {0} ··· | 新增，待审 | TranscriptView.swift |
| 深度睡眠 | Deep sleep | 复用 settings.general.deepSleep | AgentLogo.swift、native-settings.mjs |
| 深灰 | Dark Grey | 复用 labels.colors.darkGrey | IssuePropertyIcons.swift |
| 添加 | Add | 复用 dashboard.add | ChatView.swift、ComposerAttachmentSheet.swift |
| 添加子事项 | Add sub-issue | 复用 subIssues.add | IssueActionsSheet.swift |
| 添加并连接 | Add and connect | 新增，待审 | PairingView.swift |
| 添加描述… | Add description… | 复用 detail.description | NewIssueSheet.swift |
| 添加收集器 | Add collector | 复用 settings.collectors.add | native-settings.mjs |
| 添加环境变量 | Add environment variable | 复用 settings.connectorsPage.custom.addEnv | native-settings.mjs |
| 添加电脑 | Add computer | 新增，待审 | ComputerListView.swift、PairingView.swift |
| 添加自定义连接器 | Add custom connector | 复用 settings.connectorsPage.addCustom | native-settings.mjs |
| 清除搜索 | Clear search | 新增，待审 | ConversationSearchView.swift |
| 清除目标 | Clear goal | 新增，待审 | GoalBanner.swift |
| 灰色 | Grey | 复用 labels.colors.grey | IssuePropertyIcons.swift |
| 点按展开 | Tap to expand | 新增，待审 | TaskPanel.swift |
| 点按折叠或展开 | Tap to collapse or expand | 新增，待审 | BoardView.swift、SidebarView.swift |
| 点按收起 | Tap to collapse | 新增，待审 | TaskPanel.swift |
| 照片 | Photos | 新增，待审 | ComposerAttachmentSheet.swift |
| 父事项 | Parent issue | 复用 subIssues.parent | IssueCreationPickers.swift |
| 版本信息 | Version | 新增，待审 | SettingsView.swift |
| 状态 | Status | 复用 fields.status | NativeSettings.swift、IssueActionsSheet.swift、NewIssueSheet.swift、native-settings.mjs |
| 电脑上的 Dudu 插件需要更新后，这里才会显示 DSH 的入口。 | Update the Dudu plugin on your computer to see DSH entries here. | 新增，待审 | SidebarView.swift |
| 电脑名称 | Computer name | 复用 shell.computerName | PairingView.swift |
| 电脑已切换，请重试。 | Computer switched. Try again. | 新增，待审 | Models.swift |
| 电脑拒绝了此操作。 | The computer denied this action. | 新增，待审 | Models.swift、native-server.mjs |
| 电脑暂时无法完成请求。 | The computer could not complete this request. | 新增，待审 | Models.swift |
| 电脑正在处理其他操作，请稍后重试。 | The computer is busy. Try again later. | 新增，待审 | Models.swift |
| 电脑返回了无法识别的数据。 | The computer returned unrecognized data. | 新增，待审 | Models.swift |
| 电脑连接 | Computer connections | 新增，待审 | ComputerListView.swift、SidebarView.swift |
| 留言已保存，请求没能送达。 | Your comment was saved, but the request could not be delivered. | 复用 detail.messageErrors.delivery_failed | AssistantComposer.swift |
| 目标 | Goal | 新增，待审 | ComposerAttachmentSheet.swift、GoalBanner.swift |
| 目标已暂停 | Goal paused | 新增，待审 | SessionCommands.swift |
| 目标已继续 | Goal resumed | 新增，待审 | SessionCommands.swift |
| 目标指令，点按取消 | Goal command. Tap to cancel. | 新增，待审 | ChatView.swift |
| 目标操作 | Goal actions | 新增，待审 | GoalBanner.swift |
| 目标操作失败 | Goal action failed | 新增，待审 | SessionCommands.swift |
| 看板 | Board | 新增，待审 | DuduRootView.swift、Navigation or embedded pages |
| 确认启用完全权限？ | Enable full access? | 新增，待审 | PermissionLabels.swift |
| 确认启用自动审查（实验）？ | Enable auto review (experimental)? | 新增，待审 | PermissionLabels.swift |
| 移除截止日期 | Remove due date | 复用 due.remove | IssueCreationPickers.swift |
| 移除文件 | Remove file | 新增，待审 | AttachmentTiles.swift |
| 移除照片 | Remove photo | 新增，待审 | PhotoAttachmentPreview.swift |
| 移除父事项 | Remove parent | 复用 subIssues.removeParent | NewIssueSheet.swift |
| 空 | Empty | 复用 settings.rules.empty | native-settings.mjs |
| 空闲中 | Idle | 复用 agentState.idle | Board.swift、Models.swift、SessionActivity.swift |
| 立即执行 | Run now | 复用 tasks.run | TaskSheets.swift、TasksView.swift |
| 等待你的操作 | Waiting for your input | 新增，待审 | Transcript.swift、ConversationQuestionsView.swift |
| 等待浏览器… | Waiting for the browser… | 复用 settings.connectorsPage.state.waiting | native-settings.mjs |
| 筛选会话 | Filter sessions | 新增，待审 | SidebarView.swift |
| 粉色 | Pink | 复用 labels.colors.pink | IssuePropertyIcons.swift |
| 粘贴地址或命令，或者写一句话说怎么读 | Paste an address or command, or write a sentence on how to read it | 复用 settings.connectorsPage.custom.placeholder | native-settings.mjs |
| 粘贴电脑生成的完整链接 | Paste the complete link generated on your computer | 新增，待审 | PairingView.swift |
| 粘贴配对链接 | Paste pairing link | 新增，待审 | ConnectionGuideView.swift、PairingView.swift |
| 紧急 | Urgent | 复用 priority.urgent | IssueCreation.swift |
| 紫色 | Purple | 复用 labels.colors.purple | IssuePropertyIcons.swift |
| 红色 | Red | 复用 labels.colors.red | IssuePropertyIcons.swift |
| 继续执行目标 | Continue goal | 新增，待审 | Transcript.swift |
| 绿色 | Green | 复用 labels.colors.green | IssuePropertyIcons.swift |
| 缓存写入 | Cache write | 新增，待审 | ConversationFileStorage.swift |
| 缓存命中 | Cache hit rate | 新增，待审 | ConversationFileStorage.swift |
| 缓存读取 | Cache read | 新增，待审 | ConversationFileStorage.swift |
| 编辑 | Edit | 复用 settings.memory.edit | Transcript.swift、ComputerConnectionView.swift、GoalBanner.swift、QueuedMessagesPanel.swift、TaskSheets.swift、TasksView.swift、native-settings.mjs |
| 编辑失败：这条消息可能已经开始发送。 | Could not edit this message. It may already be sending. | 新增，待审 | ChatView.swift |
| 编辑排队消息 | Edit queued message | 新增，待审 | QueuedMessagesPanel.swift |
| 编辑目标 | Edit goal | 新增，待审 | GoalBanner.swift |
| 编辑连接地址 | Edit connection address | 新增，待审 | ComputerConnectionView.swift |
| 网页 | Web | 复用 settings.connectorsPage.groups.web | native-settings.mjs |
| 网页搜索 | Web search | 新增，待审 | Transcript.swift |
| 网页获取 | Fetch web page | 新增，待审 | Transcript.swift |
| 置顶 | Pin | 新增，待审 | SidebarView.swift |
| 自 {0} | Since {0} | 新增，待审 | native-settings.mjs |
| 自动化任务 | Automated task | 新增，待审 | Transcript.swift |
| 自动化任务内容 | Automation task content | 复用 tasks.prompt | TaskSheets.swift |
| 自动化任务名称 | Automation task name | 复用 tasks.name | TaskSheets.swift |
| 自动审查 | Auto review | 新增，待审 | PermissionLabels.swift |
| 自动审查不使用沙箱。每次原生工具调用和 PTC 内层调用前，都会由与当前 agent 相同的模型进行审查；审查拒绝的调用由你批准或拒绝。此功能仍属实验性，可能误放行或误拒绝，并会消耗额外 token。 | Auto review does not use a sandbox. Before each native tool call and inner PTC call, the same model as the current agent reviews the action; you approve or reject calls denied by the review. This feature is experimental, may incorrectly allow or deny actions, and uses additional tokens. | 新增，待审 | PermissionLabels.swift |
| 补全上下文 | Fill in context | 复用 collector.complete | CollectorView.swift |
| 要求修改 | Request changes | 新增，待审 | PlanReview.swift |
| 规则 | Rules | 复用 tasks.rules | NativeSettings.swift、TaskSheets.swift、native-settings.mjs |
| 计划 | Plan | 新增，待审 | ComposerAttachmentSheet.swift、PlanReview.swift |
| 计划待审 | Plan review | 新增，待审 | PlanReview.swift |
| 计划模式当前未开启 | Plan mode is not active | 新增，待审 | SessionCommands.swift |
| 计划模式操作失败 | Plan mode action failed | 新增，待审 | SessionCommands.swift |
| 记忆 | Memory | 复用 settings.nav.memory | NativeSettings.swift、native-settings.mjs |
| 设为默认 | Set as default | 复用 settings.statuses.makeDefault | native-settings.mjs |
| 设置 | Settings | 复用 dashboard.settings | SettingsView.swift、SidebarView.swift |
| 设置父事项… | Set parent issue… | 复用 subIssues.setParent | NewIssueSheet.swift |
| 访问模式 | access | 复用 activity.access | native-settings.mjs |
| 语音识别暂不可用。 | Speech recognition is temporarily unavailable. | 新增，待审 | NativeSpeechCapture.swift |
| 语音输入 | Voice input | 复用 pet.voice | ChatView.swift |
| 说明 | Description | 新增，待审 | LibraryView.swift |
| 请允许语音识别权限。 | Allow speech recognition access. | 新增，待审 | NativeSpeechCapture.swift |
| 请允许麦克风权限。 | Allow microphone access. | 新增，待审 | NativeSpeechCapture.swift |
| 请先在电脑上更新 Dudu 插件，再使用此功能。 | Update the Dudu plugin on your computer to use this feature. | 新增，待审 | DuduStore.swift、SessionSearch.swift |
| 请先完成这道问题。 | Complete this question first. | 新增，待审 | ConversationQuestionsView.swift |
| 请先登录 DeepSeek，并确认请求地址支持账号认证。 | Sign in to DeepSeek and check that the request URL supports account authentication. | 新增，待审 | ConversationFeatureViews.swift |
| 请在系统设置中允许相机访问。 | Allow camera access in Settings. | 新增，待审 | QRScannerView.swift |
| 请更新电脑端的 Dudu 插件 | Update the Dudu plugin on your computer | 新增，待审 | Models.swift |
| 请更新电脑端的 dudu 插件。 | Update the Dudu plugin on your computer. | 新增，待审 | native-server.mjs |
| 请更新电脑端的手机控制插件 | Update the mobile control plugin on your computer | 新增，待审 | Models.swift |
| 请检查状态名称和颜色。 | Check the status name and color. | 复用 settings.statuses.errors.invalid_status | native-settings.mjs |
| 请求内容无效，请检查后重试。 | Invalid request. Check it and try again. | 新增，待审 | Models.swift |
| 请求内容过大。 | The request is too large. | 新增，待审 | native-bridge.mjs、native-server.mjs |
| 请求参数不正确。 | Invalid request parameters. | 新增，待审 | native-bridge.mjs、native-server.mjs |
| 请求可能已在电脑执行，请查看会话状态后再操作。 | This request may have run on your computer. Check the session before trying again. | 新增，待审 | Models.swift |
| 请求可能已在电脑执行，请检查会话状态。 | This request may have run on your computer. Check the session. | 新增，待审 | native-server.mjs |
| 请求标识已在使用。 | This request ID is already in use. | 新增，待审 | native-server.mjs |
| 请求的会话或资源已不存在。 | This session or resource no longer exists. | 新增，待审 | Models.swift |
| 请求过多，请稍后重试。 | Too many requests. Try again later. | 新增，待审 | native-server.mjs |
| 请粘贴电脑生成的完整配对链接 | Paste the complete pairing link generated on your computer | 新增，待审 | Models.swift |
| 请输入新的目标内容 | Enter the new goal | 新增，待审 | SessionCommands.swift |
| 请输入配对链接 | Enter a pairing link | 新增，待审 | PairingView.swift |
| 请选择一个选项或填写自定义答案。 | Choose an option or enter your own answer. | 新增，待审 | ConversationQuestionsView.swift |
| 请选择现有事项要移入的状态。 | Choose a status for the existing issues. | 复用 settings.statuses.errors.status_in_use | native-settings.mjs |
| 请重新连接电脑。 | Reconnect to your computer. | 新增，待审 | Navigation or embedded pages |
| 读取 | Read | 新增，待审 | Transcript.swift |
| 读取图片 | Read image | 新增，待审 | Transcript.swift |
| 跳过 | Skip | 复用 detail.skipResult | ConversationQuestionsView.swift |
| 输入 | inputs | 复用 widgets.needs.inputs | ConversationFeatureViews.swift |
| 输入你的答案 | Enter your answer | 新增，待审 | ConversationQuestionsView.swift |
| 输入目标，智能体将持续执行 | Enter a goal for the agent to keep working on | 新增，待审 | ChatView.swift |
| 输出 | Output | 新增，待审 | ConversationFileStorage.swift、ConversationFeatureViews.swift、SessionActivitySheet.swift |
| 输出速度（TPS） | Output speed (TPS) | 新增，待审 | ConversationFileStorage.swift |
| 运行中 | Running | 新增，待审 | SessionActivity.swift |
| 运行了代码 | Ran code | 新增，待审 | Transcript.swift |
| 运行命令 | Run command | 新增，待审 | Transcript.swift |
| 运行失败 | Run failed | 复用 tasks.runFailed | GroupChat.swift |
| 运行时间 | Run time | 复用 tasks.timing | TaskSheets.swift |
| 返回 | Back | 复用 settings.connectorsPage.back | AboutView.swift、ComposerAttachmentSheet.swift、ComputerListView.swift、ConversationSearchView.swift、DuduRootView.swift、IssueActionsSheet.swift、QuickSheetPage.swift、SessionActivitySheet.swift、SettingsView.swift |
| 返回上一级 | Go up one level | 新增，待审 | WorkPanelView.swift |
| 返回电脑连接 | Back to computer connection | 新增，待审 | ComputerConnectionView.swift |
| 返回设置栏目 | Back to settings sections | 新增，待审 | SettingsView.swift |
| 还有收集器在用它：{0} | Still used by collectors: {0} | 新增，待审 | native-settings.mjs |
| 还没有技能 | No skills yet | 复用 settings.skills.empty | AssistantSuggestions.swift、native-settings.mjs |
| 还没有整理记录 | No tidy runs yet | 复用 settings.memory.noReviews | native-settings.mjs |
| 还没有整理过 | Not tidied yet | 复用 settings.general.noTidy | native-settings.mjs |
| 还没有标签 | No labels yet | 复用 labels.empty | IssueCreationPickers.swift |
| 还没有记住的事 | Nothing is remembered yet | 复用 settings.memory.empty | native-settings.mjs |
| 还没有项目 | No projects yet | 复用 projects.empty | IssueCreationPickers.swift |
| 这一页没能加载 | Could not load this page | 复用 settings.failed | NativeSettingsView.swift、native-settings.mjs |
| 这个文件是空的 | This file is empty | 新增，待审 | FileAttachments.swift |
| 这个状态已不存在。 | This status no longer exists. | 复用 settings.statuses.errors.unknown_status | native-settings.mjs |
| 这台电脑 | This computer | 复用 settings.connectorsPage.groups.here | native-settings.mjs |
| 进行中 | Active | 复用 tabs.active | Board.swift、TaskPanel.swift |
| 进行中的目标 | Active goal | 新增，待审 | Transcript.swift |
| 远程 | Remote | 复用 settings.connectorsPage.custom.kind.remote | native-settings.mjs |
| 连接 | Connect | 复用 settings.connectorsPage.connect | native-settings.mjs |
| 连接器 | Connectors | 复用 settings.nav.connectors | NativeSettings.swift、native-settings.mjs |
| 连接地址 | Connection addresses | 复用 shell.addresses | ComputerConnectionView.swift |
| 连接地址未连接到兼容的 dudu 服务。 | This address does not connect to a compatible Dudu service. | 新增，待审 | native-server.mjs |
| 连接地址未连接到这台电脑，请检查地址、TLS 证书和网络配置。 | This address does not connect to this computer. Check the address, TLS certificate, and network settings. | 新增，待审 | native-server.mjs |
| 连接地址格式不正确。 | Invalid connection address. | 新增，待审 | native-server.mjs |
| 连接已断开 | Disconnected | 新增，待审 | Models.swift |
| 连接暂时不可用。 | Connection unavailable. | 复用 shell.unavailable | AssistantSuggestions.swift |
| 连接状态 | Connection status | 新增，待审 | ComputerConnectionView.swift |
| 连接电脑上的 DSH | Connect to DSH on your computer | 新增，待审 | ConnectionGuideView.swift、PairingView.swift |
| 连接超时 | Connection timed out | 复用 settings.connectorsPage.state.timedOut | Models.swift、native-settings.mjs |
| 退出计划模式 | Leave plan mode | 新增，待审 | ComposerAttachmentSheet.swift |
| 退出计划模式时不能带附件 | Attachments cannot be sent when leaving plan mode | 新增，待审 | SessionCommands.swift |
| 选填 | Optional | 新增，待审 | ComputerConnectionView.swift、PairingView.swift |
| 选择 | Select | 复用 collector.select | CollectorView.swift、MessageActions.swift |
| 选择工作区 | Choose workspace | 新增，待审 | ChatView.swift |
| 选择标签颜色 | Pick a color for label | 复用 labels.pickColor | IssueCreationPickers.swift |
| 选择电脑 | Choose computer | 新增，待审 | SettingsView.swift、SidebarView.swift |
| 选择电脑，当前为{0} | Choose computer. Current: {0} | 新增，待审 | ConnectionGuideView.swift |
| 选择项目 | Choose a project | 复用 projects.choose | IssueCreationPickers.swift |
| 逐行对比超时，按整个文件替换显示 | Line comparison timed out. Showing the whole file replacement. | 新增，待审 | ConversationFeatureViews.swift |
| 通用 | General | 复用 settings.nav.general | NativeSettings.swift、native-settings.mjs |
| 部分照片未添加 | Some photos were not added | 新增，待审 | ChatView.swift |
| 配对信息与电脑不匹配，请重新配对 | Pairing does not match this computer. Pair again. | 新增，待审 | Models.swift |
| 配对已失效 | Pairing expired | 新增，待审 | ConnectionGuideView.swift |
| 配对已失效，请生成新配对码 | Pairing has expired. Generate a new pairing code. | 新增，待审 | Models.swift |
| 配对已失效，请重新配对。 | Pairing has expired. Pair again. | 新增，待审 | native-server.mjs |
| 配对链接 | Pairing link | 新增，待审 | PairingView.swift |
| 配对链接无效 | Invalid pairing link | 新增，待审 | Models.swift |
| 重命名 | Rename | 复用 views.rename | SidebarView.swift |
| 重命名会话 | Rename session | 新增，待审 | SidebarView.swift |
| 重命名工作区 | Rename workspace | 新增，待审 | SidebarView.swift |
| 重复提醒 | Recurring reminder | 新增，待审 | LibraryView.swift |
| 重复规则 | Recurrence | 新增，待审 | LibraryView.swift |
| 重新扫码配对 | Scan to pair again | 新增，待审 | ConnectionGuideView.swift |
| 重新连接 | Reconnect | 新增，待审 | ComputerConnectionView.swift、ComputerListView.swift、ConnectionGuideView.swift |
| 重试 | Retry | 复用 dashboard.retry | BoardView.swift、CollectorView.swift、ConversationFeatureViews.swift、ConversationSearchView.swift、EmbeddedPageView.swift、IssueActionsSheet.swift、IssueCreationPickers.swift、LibraryView.swift、NativeSettingsView.swift、NewIssueSheet.swift、SettingsView.swift、SidebarView.swift、TaskSheets.swift、TasksView.swift、WorkPanelView.swift、native-settings.mjs |
| 重试延迟：{0} ms | Retry delay: {0} ms | 新增，待审 | ConversationFeatureViews.swift |
| 间隔 | Interval | 复用 tasks.kinds.interval | Tasks.swift、TaskSheets.swift |
| 隐私政策 | Privacy policy | 新增，待审 | SettingsView.swift |
| 隐藏已归档 | Hide archived | 新增，待审 | SidebarView.swift |
| 需要令牌 | Needs a token | 复用 settings.connectorsPage.custom.how.token | native-settings.mjs |
| 需要你 | Needs you | 复用 agentState.blocked | Board.swift、Models.swift、SessionActivity.swift |
| 需要授权 | Needs authorization | 复用 settings.connectors.needsAuth | native-settings.mjs |
| 需要登录 | Needs sign-in | 复用 settings.connectorsPage.state.needsLogin | native-settings.mjs |
| 需要相机权限才能扫描配对码。 | Camera access is required to scan the pairing code. | 新增，待审 | QRScannerView.swift |
| 青色 | Teal | 复用 labels.colors.teal | IssuePropertyIcons.swift |
| 页面未能打开 | Could not open the page | 新增，待审 | EmbeddedPageSession.swift |
| 页面请求未能完成。 | The page request could not be completed. | 新增，待审 | Navigation or embedded pages |
| 项目 | Project | 复用 fields.project | ChatView.swift、IssueActionsSheet.swift、IssueCreationPickers.swift、NewIssueSheet.swift、WorkPanelView.swift、native-settings.mjs |
| 项目名称 | Project name | 新增，待审 | IssueCreationPickers.swift |
| 项目文件夹 | Project folder | 复用 settings.general.folder | IssueCreationPickers.swift、native-settings.mjs |
| 项目文件夹没能打开。 | The project folder could not be opened. | 复用 settings.unavailable | native-settings.mjs |
| 项目文件夹没能打开，请检查路径，或勾选创建文件夹。 | Could not open the project folder. Check the path, or allow folder creation. | 新增，待审 | IssueCreationPickers.swift |
| 预览照片 | Preview photo | 新增，待审 | PhotoAttachmentPreview.swift |
| 频率，如 30m、2h、1d，或 cron | How often, such as 30m, 2h, 1d, or cron | 复用 settings.collectors.frequency | native-settings.mjs |
| 颜色 | Color | 复用 settings.statuses.color | native-settings.mjs |
| 额度 | Quota | 复用 widgets.titles.quota | DuduRootView.swift、QuotaSheet.swift |
| 首 token 平均（TTFT） | Average time to first token (TTFT) | 新增，待审 | ConversationFileStorage.swift |
| 高 | High | 复用 priority.high | IssueCreation.swift |
| 黄色 | Yellow | 复用 labels.colors.yellow | IssuePropertyIcons.swift |
| 默认 | Default | 复用 settings.general.isDefault | native-settings.mjs |
| 默认模型 | Default model | 复用 tasks.defaultModel | TaskSheets.swift |
| ，{0} | , {0} | 新增，待审 | QuotaSheet.swift |
| ：{0} | : {0} | 新增，待审 | native-settings.mjs |

## 2026-11-15 会话状态增量

主人已批准中文“未读”“空闲”，随后明确将“处理中”改为“工作”（2026-11-15）。String Catalog 使用 `未读 → Unread`、`空闲 → Idle`、`工作 → Working`，其中 `Idle` 和 `Working` 复用旧词。桌面“会话状态”的新英文 `Session status` 和新的 `Unread` 仍待逐字审阅。此前构建已在主人要求下原位安装到手机；此处不把构建或安装视为译文批准。

视频入口的可访问性文字“发送视频”由主人本轮明确提供，String Catalog 仅增加中文，没有擅加英文译文。未分配事项详情复用“智能体”“事项没能加载”“重试”，不新增其他文案或副文本。

## 2026-11-17 连接引导页

主人确认 `.local/designs/connection-guide-2026-11-17/04-connection-guide.png` 后，
连接引导页使用以下原文：

| 中文 | 审核状态 | 使用处 |
|---|---|---|
| 连接嘟嘟 | 主人已批准 | ConnectionGuideView.swift |
| 打开 DSH 并安装嘟嘟插件，在嘟嘟设置中打开配对二维码 | 主人已批准 | ConnectionGuideView.swift |

String Catalog 只增加已批准的中文，不新增未经审阅的英文译文。扫描和粘贴按钮沿用原文。
旧的「连接电脑上的 DSH」仍由独立的配对表单使用，未随连接引导页一并改写。

## 2026-11-17 新建事项加图片

主人看过 `.local/designs/issue-images-2026-11-17/menu-close.png` 和 `phone-final-flow.png` 后说“就这样吧”：新建事项的“…”菜单在“截止日期”“设置父事项…”下面多一项，选好第一张图后，图片块的末尾有一个“+”块。

| 中文 | English | 审核状态 | 使用处 |
|---|---|---|---|
| 添加图片 | Add photos | 中文主人已批准（图中原文）；英文新增，待审 | NewIssueSheet.swift：菜单项，也是“+”块的朗读文字 |

英文先写了 Add photos，和现有的“照片 → Photos”“添加 → Add”“移除照片 → Remove photo”一致，等主人逐字审阅。
一度只加了中文（照“发送视频”的做法），英文界面里会显示中文，主人指出这不对（“英文界面为什么要写中文？”），当天补上。
其余文字沿用原文：预览照片、移除照片、部分照片未添加。

## 2026-11-18 收件箱、转发和任务页

主人看过 `.local/designs/inbox-forward-2026-11-18/` 的设计后说“ios 的审核通过”；页面上的字用设计里的原文，这里是这次新增的。英文是我写的，等主人逐字审阅。

| 中文 | English | 审核状态 | 使用处 |
|---|---|---|---|
| 转发 | Forward | 中文随设计通过（取代“分享到会话”和“分享到事项”）；英文新增，待审 | CollectorView.swift：长按菜单、选择栏、记录栏；ForwardPickerSheet.swift：标题、确认卡的按钮 |
| 转发给 | Forward to | 中文随设计通过；英文新增，待审 | ForwardPickerSheet.swift：确认卡上的小标签 |
| 最近会话 | Recent conversations | 中文随设计通过；英文新增，待审 | ForwardPickerSheet.swift：列表上的小标签 |
| 已转发到 {0} | Forwarded to {0} | 中文随设计通过（取代“已分享到 {0} 的会话”）；英文新增，待审 | Board.swift：转发成功的提示 |
| 已转发到  | Forwarded to  | 中文随设计通过（取代“已分享到 ”；末尾有一个空格，后面接事项编号）；英文新增，待审 | CollectorView.swift：记录页里挂了事项的那一行 |
| 搜索 | Search | 中文是设计图里搜索框的原文；英文新增，待审。设计说明把它当成了已有的词，其实 String Catalog 里原来只有“搜索事项…”“搜索文件”这些 | ForwardPickerSheet.swift：搜索框的提示文字 |

沿用、没有改的词：取消、选择、全选、已选 {0} 条、打开来源、更多、补全上下文、恢复、已处理、删除、新建事项、新建任务、暂停任务、恢复任务、立即执行、编辑、删除任务、状态、打开事项、清除搜索、更改没能保存。选择器的列表为空、搜不到或没加载出来时沿用“没有事项”“没有找到事项”“事项没能加载”，没有新增说明文字。

删掉的词（没有地方再用）：分享到事项、分享到会话、已分享到 {0}、已分享到 {0} 的会话、已分享到 （由上面的“转发”系列取代），复制任务、已复制任务（手机上不再有复制任务）。“搜索事项…”还在新建事项的选择器里用，所以保留。

2026-11-18 主人说“忽略功能可以删掉了，用不上这个功能了”，手机上去掉了忽略这个功能，同时删掉的词（String Catalog 里的两条也已删除）：忽略（滑动、长按菜单、选择栏、记录页“更多”）、已忽略（“已忽略”页签的名字和标记后的提示）。没有新增任何文字。

## 2026-11-19 上架前补齐的英文

上架 App Store 前在英文界面里走了一遍：连接引导页的标题和说明、首页的“电脑未连接”、“发送视频”、“子事项”这五条只有中文，英文界面里会显示中文（主人 2026-11-17 说过“英文界面为什么要写中文？”）。中文原文没有动，英文是我写的，等主人逐字审阅。

| 中文 | English | 使用处 |
|---|---|---|
| 连接嘟嘟 | Connect to Dudu | ConnectionGuideView.swift：标题 |
| 打开 DSH 并安装嘟嘟插件，在嘟嘟设置中打开配对二维码 | Open DSH and install the Dudu plugin, then open the pairing QR code in Dudu's settings | ConnectionGuideView.swift：说明 |
| 电脑未连接 | Computer not connected | BoardHomeView.swift：首页提示 |
| 发送视频 | Send video | ComposerAttachmentSheet.swift、ChatView.swift |
| 子事项 | Sub-issues | BoardSubIssues.swift |

## 2026-11-21 设置页：长按菜单、状态页、记忆和连接器

中文是主人在 `.local/designs/phone-status-settings-2026-11-21/` 和 `.local/designs/settings-delete-and-connectors-2026-11-21/` 两张设计稿里看过的字；下面的英文是新增，等待主人逐字审阅。插件下发这些字，App 里没有新增文案。

| 中文 | English（新增，待审） |
|---|---|
| 完成度 | Progress |
| 请在电脑上授权 | Authorize on your computer |
| 授权页面已在电脑的浏览器里打开。在电脑上完成后，这里会自动更新。 | The authorization page is open in your computer's browser. This updates by itself once you finish there. |
| 会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。 | Local memory and its references will be deleted. DSH source messages and model history will be kept. |

“等待浏览器…”不再由插件下发。设置页底部的版本号只剩版本号和构建号（`v0.1.0 (143)`），没有文字。

## 2026-11-27 首次打开的连接页

主人确认 `.local/designs/phone-first-run-2026-11-27/` 的方案 1（「实现吧」）：标题下面那句说明换成电脑上要做的三步。中文是主人确认的原文；英文是我写的，等主人逐字审阅
（第 3 步里的「设置」「手机控制」「生成二维码」用电脑端英文界面里的叫法：Settings、Phone control、Generate QR code）。

| 中文 | English（新增，待审） | 使用处 |
|---|---|---|
| 在电脑上安装 DSH | Install DSH on your computer | ConnectionGuideSteps.swift、ConnectionSteps.kt：第 1 步（下面的 deepseek.com/harness 是网址，不翻译） |
| 在 DSH 的「添加插件」里输入 | In DSH's “Add plugin”, enter | 第 2 步（后面接 dsh-dudu 和「复制」） |
| 打开嘟嘟，点右上角的设置，进入「手机控制」，点「生成二维码」 | Open Dudu, tap Settings at the top right, go to “Phone control”, and tap “Generate QR code” | 第 3 步 |

「复制」沿用原有的词（复制后图标换成对勾，没有新增「已复制」）。原来的「打开 DSH 并安装嘟嘟插件，在嘟嘟设置中打开配对二维码」不再使用，已从 String Catalog 删除。

## 仍由原内容决定的文字

2026-11-17 连接状态设计确认新增首页提示“电脑未连接”（`BoardConnectionNotice`）。
String Catalog 只加入主人已确认的这句中文，未增加未经审核的英文译文。
聊天加载移除可见的“正在连接…”副文本，保留既有的可访问性文字“正在连接”；
待发送消息使用无文字的进度标记，不增加断连或重试说明。

- 用户创建或修改的名称、标题、正文，以及 Agent 输出，不按界面语言翻译。
- DSH 动态入口使用它已经注册的中英文词典；第三方插件没有对应译文或无法明确匹配时，保留插件原来的标题，不猜译。
- 系统语音识别配置保持原样，不随 UI 语言擅自切换。
- 内嵌 DSH 页面使用本页的语言服务，不写入 Desktop 的语言偏好。

本轮没有安装到手机或热更新 Desktop；没有启动 App、模拟器、浏览器或真实 DSH 场景。构建和单元测试不代表英文排版已通过目视验收。
