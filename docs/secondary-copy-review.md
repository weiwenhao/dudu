# 副文本自检与待审清单

2026-11-02：主人要求去掉截图中的说明性副文本，已有副文本也要逐句审核。本清单记录代码自检结果，**不是审字通过的记录**。优先清理嘟嘟桌面设置，连同添加组件、事项详情、对话、会话管理、Office、额度和嵌入设置一起检查；手机原生界面另列发现项，本轮没有修改或构建手机。

副文本指固定的解释性文字；主人的 Prompt、规则正文、技能内容、会话摘录以及路径、时间、数量等实际数据不因为字号小或颜色浅就删除。错误、空状态和操作结果仍受 `AGENTS.md` 的审字规则约束，完整固定用词另见 [issues-ui-wording.md](issues-ui-wording.md) 和 [ui-localization-wording.md](ui-localization-wording.md)。

## 本轮移除

这些行从界面撤下，不换成新的说法，也不挪到 tooltip。规则的名称、文件名和正文保留。主人随后确认设置中的“小组件”栏目多余，整页及其开发者模式开关一并移除；组件统一在“编辑版面”中管理，开发检查器只保留现有开发接口。

| 位置 | 原中文 | 原 English |
|---|---|---|
| 规则页顶部 | 两份 Markdown 文件，嘟嘟照着它们判断。直接改文件，或者对嘟嘟说。 | Dudu follows these two Markdown files. Edit them directly, or tell Dudu. |
| TRIAGE.md 标题下 | 新来的事有多重要、要花多少功夫、什么时候要 | How important a new issue is, how much work it takes and when it is due |
| ASSIGN.md 标题下 | 什么事交给哪个智能体；拿不准的留着 | Which agent gets each issue; leave uncertain ones unassigned |
| 连接器页顶部 | 告诉嘟嘟去哪里、收集什么。保存后，每轮采集都会照着这些提示读取。 | Tell Dudu where and what to collect. Saved prompts are used on each collection run. |
| 技能页顶部 | 嘟嘟自己的技能，和各智能体的技能互不影响。 | Dudu’s own skills are separate from each agent’s skills. |
| 通用页模型名下 | 用 DSH 当前的模型 | Uses the current DSH model |
| 小组件页顶部 | 小组件来自嘟嘟自带的，和你在 DSH 里装的插件。装插件在 DSH 的插件页。 | Widgets come from Dudu and your installed DSH plugins. Install plugins on DSH’s Plugins page. |
| 看板组件描述（设置与添加弹窗） | 所有事项，可按列表或看板查看 | Every issue, as a list or a board |
| 额度组件描述（设置与添加弹窗） | 各智能体的订阅用量 | Subscription usage, one line per agent |
| 办公室组件描述（设置与添加弹窗） | 已分配智能体的进行中事项，各有一位员工 | Assigned active issues as people at desks |
| 设置中的组件来源与数据声明 | 内置 / 来自 {插件名} · 读取{事项 / 额度 / 输入 / 会话 / 网络} | Built in / From {plugin} · Reads {issues / quota / inputs / sessions / network} |
| 开发者模式说明 | 编辑版面时，本地小组件上多一个检查器：最小和推荐大小、浅色深色、示例数据、检查结果 | In layout editing, local widgets get an inspector for sizes, themes, example data and checks |
| 事项留言框下 | 用 @{recipient} 发送消息，不 @ 就是留言。 | Mention @{recipient} to send a message. Otherwise, leave a comment. |
| 会话搜索结果底部（主人 2026-11-08 要求撤下） | 还有 N 个会话没法搜索内容 | N sessions cannot be searched |
| 会话索引进度说明（主人 2026-11-08 要求在 header 显示更新时间，加载时转圈） | 正在建立搜索索引（已读/总数） | Building the search index (done/total) |

第三方组件的描述也不再在设置和添加弹窗中显示。声明仍保留给搜索、校验和开发检查器使用，不改第三方文件。

## 仍显示的固定解释文字：待主人逐项审核

本表逐字记录当前代码。上下文、压缩提示曾来自主人要求与 DSH；此次按“已有所有副文本都要审核”重新列出，不推定已通过。此处不增加、替换任何 App 文案。

| 位置 / 代码 | 中文 | English |
|---|---|---|
| 对话 + 菜单，`pet.contextHint` | 自动附加当前页面位置 | Attach the current page automatically |
| 对话 + 菜单，`pet.compactHint` | 压缩以上对话内容 | Compact the conversation above |
| 语音录制气泡，`pet.release` | 松开发送 · Esc 取消 | Release to send · Esc to cancel |
| 忘记记忆确认，`settings.memory.scope` | 会删除本地记忆和相关引用。DSH 来源消息和模型历史会保留。 | This removes local memory and its references. DSH source messages and model history stay. |
| 忘记事项确认，`detail.forgetScope` | 将删除这条事项、活动和本地关联。来源消息和会话历史会保留。 | This issue, its activity and local links will be deleted. Source messages and session history stay. |
| 添加组件弹窗读屏说明，`dashboard.addDescription` | 选择要放到仪表盘上的小组件。 | Pick a widget to put on the dashboard. |
| 新建事项弹窗读屏说明，`newIssue.description` | 填写标题，可补充描述。 | Create an issue with a title and an optional description. |
| 供应商路径输入占位，`shell.autoFind` | 留空则自动查找 | Leave blank to find automatically |
| 手机配对有效期，`shell.expiry` | 二维码 10 分钟内有效 | QR code expires in 10 minutes |

主人 2026-11-03 要求移除手机配对弹窗的整个顶部，不再显示 `shell.scan`（“打开嘟嘟扫码” / “Open Dudu to scan”）和“关闭”按钮；点击弹窗外部关闭。`shell.pair` 只作为读屏名称，不显示标题行。

`dashboard.editHint`（“拖动移动，拉边调整大小” / “Drag to move, pull an edge to resize”）和 `detail.agentNote`（“会开启新会话，原会话会关闭。” / “Starts a new session. The old one is closed.”）是历史保留键，当前没有渲染入口，不能把它们算作仍在显示的提示。

2026-11-03 主人明确要求移除宠物悬停的整个快捷键提示气泡。已撤下 `pet.doubleSpace`（“双击空格对话” / “Double Space to chat”）和 `pet.holdSpace`（“长按空格说话” / “Hold Space to speak”），同时删除渲染入口和悬停样式；不再列为仍显示、等待审字的副文本。通用设置里的快捷键开关保留。

## 实际数据和元信息：保留，不补充解释句

| 范围 | 具体内容 | 当前位置 |
|---|---|---|
| 设置 | 项目文件夹路径；规则文件名和正文；连接器 Prompt；记忆文件名、记录时间和状态；技能原文中的描述；整理记录 | `ui/settings/` |
| 会话管理 | 项目名、目录、更新时间、搜索命中的会话摘录、Agent 名称、事项编号 | `ui/sessions/` |
| 看板和事项 | 编号、优先级、截止日期、实际会话 ID、状态、留言和真实进度；截止日期悬停的日期和天数 | `ui/issues/` |
| 添加组件 | 尺寸、已添加状态、第三方插件的来源名称 | `ui/dashboard/AddWidgetDialog.jsx` |
| Office | 实际员工状态和白板数量；读屏汇总使用实际数量和共用状态名 | `ui/widgets/office/` |
| 额度 | 订阅计划、实际重置时间和用量、余额 | `ui/widgets/Quota.jsx` |
| 小组件开发检查器 | 尺寸、主题、数据源的控件名称和检查结果 | `ui/widgets/WidgetPreview.jsx` |
| 手机控制 / 供应商（嘟嘟设置里的两页） | 实际配对日期、地址、版本、路径、供应商原始错误 | `ui/settings/PhoneSection.jsx`、`ui/settings/ProvidersSection.jsx` |

2026-11-27 起手机控制有一个例外：主人明说要加「连接指南」（页面里三步和下载链接，二维码弹窗上方两行），用词见 [issues-ui-wording.md](issues-ui-wording.md)。

这些内容中的固定标签仍列在完整用词表中；动态数据保持原文。DSH 自己的完整会话页、第三方插件自有界面和模型回复不属于嘟嘟在本轮新增的说明文案，不能据此宣称已审核。

## 手机原生界面发现项：待审，本轮未改

| 位置 | 当前原文 |
|---|---|
| 连接引导，`native/ios/Dudu/Views/ConnectionGuideView.swift` | 在电脑的「设置 → 手机控制」中生成配对码 |
| 同上：2026-11-03 起手机控制只在嘟嘟自己的设置里（嘟嘟页右上角的设置 → 手机控制），DSH 自己的设置里没有；这句话的位置对不上了，改字等主人定，本轮没有改手机 | （同上） |
| 新会话模式选择，`native/ios/Dudu/Views/ChatView.swift` | 模式在会话开始前选择，之后不能更改。 |
| 新会话项目选择，`native/ios/Dudu/Views/ChatView.swift` | 选择一个工作区开始 |
| 输出达到上限，`native/ios/Dudu/Views/ConversationFeatureViews.swift` | 回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。 |
| DSH 进程中断，`native/ios/Dudu/Views/ConversationFeatureViews.swift` | DSH 进程在本轮完成前退出（例如被强制结束、崩溃或关闭超时），重新启动后本轮已中止。未完成的工具调用结果未知。 |

手机里的项目 / 模式描述、文件说明、计划和会话摘要还有来自 DSH 或用户的动态内容，不能当作固定副文本逐句翻译或改写。本轮只做代码检索，没有做原生界面的渲染检查。

## 2026-11-03 设置重写后

设置八页重写时没有新增说明性副文本（页标题用导航里的名字，组标题是已有的字段名）。唯一新增的固定字是连接器的添加表单，以及保存失败时的原因，见 [issues-ui-wording.md](issues-ui-wording.md) 的“设置重写：连接器手动添加”；它们是操作和结果，不是解释。

## 2026-11-03 手机端全面复查

主人以旧排队编辑头部的“取消编辑 / 编辑排队消息 / 保存排队消息”为反例，要求排查手机端堆砌文案、
重复提示和冗余交互。旧头部已经按主人给出的原文改成“取消 / 编辑 / 保存”；本轮沿用这一标准。
前文“手机原生界面发现项”是 11 月 2 日检查的历史记录，当前处置以本节为准。

检查范围是当前 `native/ios/Dudu/` 的 SwiftUI 页面、弹窗、菜单、状态和结果反馈，以及
`host/mobile-page-adapter.mjs` 的嵌入页适配。覆盖会话、输入与附件、排队、目标、任务、模式和模型选择、
计划与问题、重试与中断、文件与图片、侧栏与搜索、设置、电脑连接、手动配对和扫码。
同时追踪 `DuduStore`、`SessionCommands`、`PermissionLabels`、`Models` 中生成这些文字的分支。
未将旧 Expo 原型当成当前手机实现，也未将第三方 DSH 页面和模型正文宣称为已逐字审核。

### 已清理的重复表达

| 位置 | 原文 | 当前处置 |
|---|---|---|
| + 菜单，目标 | 设置或查看长期任务目标 / 编辑进行中的目标 | 移除两种副文本；保留“目标”及原操作 |
| + 菜单，计划 | 计划模式已开启 / 进入或退出计划模式 | 移除两种副文本；用原有“计划 / 退出计划模式”和勾选表达状态 |
| + 菜单，压缩 | 压缩以上对话内容 | 移除；保留“压缩” |
| + 菜单，权限 | 切换权限预设 | 移除；保留“权限”和当前权限值 |
| + 菜单，模型 | 选择本会话使用的模型 | 移除；保留“模型”和当前模型值 |
| + 菜单，推理等级 | 调整思考的深度 | 移除；保留“推理等级”和当前等级值 |
| 模式选择底部 | 模式在会话开始前选择，之后不能更改。 | 移除说明和对应高度；保留真实模式名称、描述、选择状态和开始后不可更改的行为 |
| 通知展开后 | 这条通知触发了本轮回复。 | 移除；保留通知标题与实际通知正文 |
| 目标编辑头部 | 编辑目标 | 复用主人已批准的“编辑”；左右仍为“取消 / 保存”，与排队编辑一致 |
| 尚未选工作区的输入入口 | 选择一个工作区开始 | 复用现有“选择工作区”；点击仍打开项目选择 |
| 设置加载失败的操作 | 重新加载设置 | 复用现有“重试”；保留对应加载进度与失败状态 |
| 每轮回复末尾 | 本轮用量 | 主人 2026-11-03 要求移除；删除入口、对应弹窗及该行留白，旧“详细”偏好不再控制显示 |

菜单仍使用现有 60pt 行高、24pt 图标、27pt 分组圆角、相同分隔线与左右间距；删除说明后标题在行内垂直居中。
这些改动是撤下说明、复用既有短标签和主人明确批准的编辑头部，没有编写新的 App 说明句。
读屏名称同步使用同一个标题，当前选项继续通过 accessibilityValue 提供。

### 已修正的反馈逻辑

| 位置 | 原行为 | 当前行为 |
|---|---|---|
| 目标编辑失败 | `runCommand` 写入会话全局错误，弹窗又读取同一个错误，在两个反馈位置重复登记 | 编辑器通过独立回调接收失败，只在当前弹窗显示；其他命令继续使用会话结果提示。电脑/会话切换后的旧结果丢弃 |
| 重试记录 | `started`、`cancelled` 仍拼接原始延迟秒数；已开始的重试还显示“· 1s” | 只有 `scheduled` 状态显示倒计时；已开始/取消的重试保留原状态、次数，诊断原因仍可展开 |
| 重试倒计时归零 | 用 `max(1, …)` 强制至少 1 秒 | 等待状态允许显示 0 秒，直到服务端发布新状态 |
| 重试/失败原因与错误码 | 原因“HTTP 502”下一行又显示“HTTP_502” | 忽略大小写、空白与下划线的形式差异，相同内容只保留原因；提供额外信息的错误码仍保留 |
| 无正文的通知 | 删除解释句后，空通知仍可展开出空白 | 只有实际正文非空才显示展开箭头和响应展开 |

### 需要改字的三处：建议待审，尚未替换

| 位置 | 当前原文 | 建议原文 | 原因 |
|---|---|---|---|
| 配对引导 | 在电脑的「设置 → 手机控制」中生成配对码 | 在电脑的「嘟嘟 → 设置 → 手机控制」生成配对码 | 补齐已经迁移的真实入口，避免误导到 DSH 自己的设置 |
| 输出上限标题下 | 回答被截断，已有输出保留在对话中。发送“继续”可让模型接着输出。 | 发送“继续”可接着输出。 | 标题“已达到输出 token 上限”已交代状态，正文只保留可执行动作 |
| 进程中断标题下 | DSH 进程在本轮完成前退出（例如被强制结束、崩溃或关闭超时），重新启动后本轮已中止。未完成的工具调用结果未知。 | DSH 在运行中退出，未完成的工具结果未知。 | 标题“任务已停止”已经交代结果，去掉原因枚举和重复的停止描述，保留工具执行结果未知这一事实 |

以上是具体改字建议，不是已批准用词。遵循根目录和 `native/ios/AGENTS.md` 的逐字审阅要求，在主人确认前保留原文，
不将文档中的建议自动写入 App。

### 检查后保留

| 范围 | 保留内容与依据 |
|---|---|
| 计划、问题、模型和模式 | 真实计划/问题正文、选项描述、模式描述是用户或 DSH 的内容；“同意执行”“要求修改”“已继续工作，仍可回答”分别表达动作或真实语义 |
| 排队与任务 | 条数、折叠展开状态、真实排队内容与任务进度；编辑/删除/插话保持行内图标，读屏名称仍明确对象 |
| 破坏性操作与权限 | 移除工作区会保留目录/会话的实际范围、取消归档后才能打开的条件、完全权限/自动审查的后果说明 |
| 文件与图片 | 路径、增删行数、截断/二进制/超限提示、下载和图片操作的无障碍名称；这些解释内容的实际限制或具体动作 |
| 手动配对与扫码 | 完整配对链接占位、“连接”和扫码对准提示（2026-11-27：iPhone 去掉了选填电脑名，按钮由“添加并连接”改为“连接”）；它们区分输入要求及实际操作后果，没有再追加帮助段落 |
| 加载与故障 | 首次连接和实际请求的等待、错误原因和重试；侧栏只在无数据且无加载/错误时显示空状态，嵌入页只在一个加载/错误层显示状态 |
| 结果反馈 | `ChatFeedbackOverlay` 已保持同一时刻一条会话提示；计划模式成功不额外弹提示，真实压缩进度留在会话记录内 |
| 嵌入设置 | 适配层已经隐藏重复的网页设置头部和与原生标题相同的栏目标题；原生壳保留一个返回入口，没有再叠加说明 |

本轮功能、截图和安装验证的实际结果另记在 [native-mobile-fixes.md](native-mobile-fixes.md)，
未做完整测试套件或穷举所有服务器故障状态。
