# 嘟嘟桌面界面：用词

**上次审阅（2026-10-31）：你让我按你的风格代审，已审。** 做法：设计稿（画布 v38，存档在 `.local/design-archive/`）里有的字，一律照设计稿；设计稿没有的，按你定的风格改：短、平、不解释。此前的“固定用词用英文”已被你本次“跟随 DeepSeek 语言设置”的要求替代。没有安装到桌面版。下面保留之前审过的历史清单；本次的全部中英文对照在 [ui-localization-wording.md](ui-localization-wording.md)，新增译文仍待你看。连接器启停、独立回复框、顶栏布局控件等旧清单内容已被末节的最新要求替代，不再显示。

所有界面上的固定字在 `host/dudu-plugin/ui/strings.js`（带 `NEW` 注释的是设计稿里没有的）。

## 照设计稿改正的

我原来写得和设计稿不一样的，现在都改回设计稿的写法：

| 位置 | 原来 | 现在（设计稿） |
|---|---|---|
| 编辑条上的提示 | Drag a widget to move it, pull an edge to resize it. | `Drag to move, pull an edge to resize` |
| 改版面后的撤销条 | `Removed “Quota”` | `Removed「Quota」`、`Moved「Overview」`、`「Overview」resized to 5×2`（名字用「」，括号前后不留空格） |
| 卡片左上角的"−"（读屏） | Remove Quota | `Remove widget` |
| 分组条、Board 列头的"＋"（读屏） | Add issue to In Progress | `New issue in In Progress` |
| Board 列头的"···"（读屏） | In Progress options | `Column options` |
| 每行开头的勾选框（读屏） | Select 标题 | `Select DUDU-12` |
| 回复智能体提问的输入框 | Reply… | `Leave a reply…` |
| 活动里的时间 | 12 min ago · 2 h ago | `12m ago` · `2h ago` |

## 我缩短或去掉的

- 换智能体的菜单底下那句：原来是"A new session starts with the log of this issue as its first message. The old session is closed."，现在是 `Starts a new session. The old one is closed.`
- 添加列表里 8 个小组件的一句话：去掉句号；Stuck 改成 `Issues an agent is stuck on`（它只列智能体出错的，库里没有"在等别人"这个状态）；Office 改成 `Each active issue as someone at a desk`。
- 项目文件夹被拒绝时的理由（14 句）：缩短，例：`That is a temporary folder the system may clear. Choose another.` · `That folder already has other files. Choose an empty one, or one 嘟嘟 made.`
- 去掉 8 个没用到的字（Saved、Close、On、Tools 等）。

## 设计稿里没有、我写的（已按风格看过，要改告诉我）

**Issues**：`No issues` · `Could not load issues` · `Retry` · `No project` · 来源 `You` `嘟嘟` `Connector` `Session` · `Past day` `Past week` `Past month` `None` · 勾选 `3 selected` `Clear selection` `Bulk actions` · 改完后的条 `Marked as Done` `Status set to In Progress` `Priority set to High` `Due date set` `Due date removed` `Assigned to Claude` `Agent removed` `Updated 3 issues` `Copied DUDU-12` `Snoozed` `Snooze cleared` `Could not save the change` `Undo` · Dates `Dates` `Overdue` `Today` `Next 7 days` `Next 30 days` `Past day` `Past week` `Past month` · 搜索 `Search issues…` · 页脚 `1,234 issues` · 详情 `Back to Issues` `Untitled` `Add description…` `No due date` `Due date` `Set priority…` `Set agent…` `Open source` `Later today` `Tomorrow` `Next week` `Clear snooze` `Send reply` `Add a result…` `Save` `Skip` `Load earlier` `This issue does not exist.` · New issue 窗口 `New issue` `Issue title` `Create issue` `Cancel` `Could not create the issue` · 活动里的句子 `created the issue` `changed status from Todo to In Progress` `changed priority to Urgent` `set the due date to Oct 30, 2026` `assigned the issue to DeepSeek` `removed the agent` `asked` `commented`（设计稿把"换智能体"和"换状态"写在一句里，我一条一个变化）。

**仪表盘**：`Added「Quota」` · `Restored default` · `Changed layout` · `「Issues」resized to full width × 4` · `Added`（添加列表里已在版面上的）· `Add`（按钮）· `Every widget is on the dashboard.` · `From @acme/xxx` · `This widget could not be shown` · `This widget comes from @acme/xxx, which is not installed.` · `Could not load the dashboard` · `Could not save the layout` · 读屏 `Overview: column 3, row 2`、`Overview: 4 by 2`。

**小组件**：Overview `Overdue` `Due this week` `In progress` · `Nothing is due` · `Nothing is stuck` · Inputs `No connectors are on` `Read today` `Issues made` `All working` `Failed · 3h ago` `Not read yet` `12 read` · Quota `No usage to show` `—` `5-hour` `Weekly` `74% used` `Resets 13:00` `Limit reached, resets 13:00` `Sign in to see usage`；悬停条 `Claude · Max`、`5-hour 74% used · resets 13:00` · Sessions `Search sessions` `No sessions` `Could not read sessions` `Opening…`。

**设置窗口**：标题现为 `dudu settings` / `嘟嘟设置`（照设计稿补回品牌）· `General` `Connectors` `Rules` `Memory` `Widgets` `Skills` · `Open project folder` · General `Project folder` `Default` `Change…` `Folder path` `Move the files into it` `Save` `Cancel` `Issues` `Export issues` · Connectors `No connectors` `Not tested` `OK · 12m ago` `Failed · 3h ago` `Added by dudu`（只给嘟嘟添加的标）`Command` `MCP` `DSH extension` `Allowed operations` `Read` `Write` `Test` `Remove` `Removed 飞书` `Undo` `Skipped entries` `Line 13: …` · Rules `Open` `Empty` `Not found` · Memory `Search records` `Nothing is remembered yet` `Edit` `Forget` `This will be deleted` `Delete` `Since 2026-10-29` `Superseded` `Tidy runs` `No tidy runs yet`；一次整理写成一行 `3 entries updated, 1 skill added` · Widgets `On the dashboard` `Built in` `Reads issues` · Skills `No skills yet` `Delete` `Back to skills`。

## 中文文件（项目文件夹里，你会直接读和改）

- 七个模板（`host/assistant/templates.mjs`）按设计稿里你写的 `TRIAGE.md`、`ASSIGN.md` 示例收短：几行短话，去掉表格、"Urgent 现在只在你明确说很急时才用"和每个文件开头的说明。`AGENTS.md` 从三个小节 11 条收成 8 条。优先级怎么从影响和工作量算，放在代码里的默认，不在文件里。
- 整理（tidy）写进你文件里的字（`host/assistant/memory/tidy.mjs`）换成平常话：`新增` `又提到` `补充` `改成` `新增技能` `待确认` `暂存` `记下` `修改` `撤销` `已撤销`，来源写成 `（来源 turn:12）`。
- 连接器库的约 150 句（`host/assistant/connectors/text.mjs`）：你会看到的只有读不出的条目的原因和"添加了连接器"的记录行，都是技术话、已经够短；其余是写给模型的，不算界面。

## 我替你定的小事（可以推翻）

- project 的颜色按名字算一个固定色；每个页签的筛选和显示选项先存在浏览器里。
- Board 的列按流程排；快捷键 S 改状态、F 筛选（输入框里不触发）；评论 ⌘/Ctrl + Enter 发送；标题 Enter 保存、Esc 取消。
- 勾选：悬停出现方框，勾一行后每行都显示；Shift 勾一段；Esc 放开；批量改 Status、Priority、Agent，一次撤销全撤回。
- Dates：每个字段几个现成范围，一次选一个，没有件数；Overdue 是今天之前，Past week 是往回 7 天。
- Board 列头"···"里先只有 Collapse column；Snooze 三个时间：今天 18:00（不到一小时就不给）、明天 09:00、下周一 09:00；显式 @ 智能体回复才送到会话并清掉提问，普通留言只记日志；改成 Done 后可以补一句结果，也可以跳过。
- 仪表盘：Issues 没被拉过时占满全部列并跟着窗口；键盘 Tab 到小组件，方向键移一格，Shift + 方向键改大小，Delete 移除；Esc 退出编辑。Overview 的 `In progress` 数智能体正在工作的；Quota 不列没有订阅的（DeepSeek），读不到的写 `—`。
- 设置里的模态窗口会盖住页面的撤销条，所以移除连接器的撤销是窗口里的一行。

## 收进来、分配、Office：新写的字，等你看

- 设计稿原话：issue 没分配时的问题 `交给谁处理？`；做完后的 `确认完成吗？`。
- 智能体出问题时 issue 上的问题（中文，`host/assistant/home/assign.mjs`）：`出错了：…。怎么办？` · `没能开始：…。要换个智能体，还是稍后再试？` · `回复没能发给会话：…`。
- 活动里嘟嘟写的几行（英文，固定用词）：`started a session with Claude` · `closed the session` · `resumed the session` · `access: read-only` · `No agent chosen: …` · `the session it named was not offered, so a new one starts` · `Urgent needs a rule in TRIAGE.md; the priority comes from impact and effort.`（`host/assistant/dispatch/words.mjs`，其余是给调用它的模型看的，不在界面上）。
- 交给会话的第一条消息：现为原任务标题和描述，见本文末尾 2026-11-01 的更新。
- 给模型的指令（`dispatch/prompts.mjs`）不是界面，但你写的 `TRIAGE.md`、`ASSIGN.md` 就是读给它们的。
- Office：名牌、图例、读屏句子在 `host/dudu-plugin/ui/widgets/office/strings.js`。

## 对话、宠物和整理：本次新增，等你看

以下字是在上一次代审之后加的，还没有安装到正式 Desktop。固定控件的字在 `host/dudu-plugin/ui/strings.js`：

| 位置 | 原样用词 |
|---|---|
| 详情页更多按钮（读屏） | `More` |
| 忘记 issue 的范围说明 | `This issue, its activity and local links will be deleted. Source messages and session history stay.` |
| 通用：宠物和快捷键 | `Pet` · `Show pet` · `Double Space to open conversation` · `Hold Space for voice input` |
| 通用：模型 | `Model` · `Change in DSH` |
| 通用和详情：整理 | `Last tidy` · `Not tidied yet` · `Undo tidy` |
| 宠物按钮和对话控件（含读屏） | `Open conversation` · `Close` · `嘟嘟` · `Message` · `Send` · `Earlier` · `Voice input` · `Stop` · `Working` |
| 语音气泡 | `Release to send · Esc to cancel` |
| 对话和语音失败 | `Could not load the conversation` · `Voice input failed` |
| 记忆忘记的实际范围 | `This removes local memory and its references. DSH source messages and model history stay.` |
| 忙时迁移文件夹的原因 | `Wait until the conversation and memory tidy finish.`（插件返回，设置页原样显示） |

忘记、删除确认、取消、加载更早记录、撤销和 Today 复用上面已经看过的字；没有新增一套说法。模型和智能体实际回答的内容由模型产生，不是固定界面文案。

## 小组件扩展和设置：本次新增，等你看

这些字同样还没有安装到正式 Desktop：

| 位置 | 原样用词 |
|---|---|
| 设置导航 | `Providers` · `Phone control` |
| 小组件开发者模式和分组 | `Developer mode` · `Local widgets` · `In development` |
| 编辑版面时的检查器 | `Inspect widget` · `Minimum size` · `Recommended size` · `Light` · `Dark` · `Theme` · `Example data` · `My data` · `Data` · `Checks` |
| 检查结果 | `Name, description and preview` · `Content fits` · `Icon buttons have labels` · `No errors` · `Pass` · `Check` |

设置里会显示声明校验的以下原句（`host/assistant/dashboard/widgets.mjs` 和 `ui/widgets/catalog.jsx`）。它们是固定界面文案，也要审：

- `It is not a widget declaration.`
- `It has no id.`
- `It has no name.`
- `It has no minimum size.`
- `Its minimum size must be whole columns and rows, up to 12 rows.`
- `It has no recommended size.`
- `Its recommended size must be whole columns and rows, up to 12 rows.`
- `Its recommended size is smaller than its minimum size.`
- `Its needs must be a list.`
- `Its description must be text.`
- `Use a plugin name followed by a dot and a widget name.`
- `This widget needs a different version of 嘟嘟.`
- `This widget declares an unknown data source.`
- `The development flag must be true or false.`
- `The widget id does not match its slot registration.`

`ASSIGN.md` 对同一个 issue 指向多个不同目录或模型时，活动和问题中的具体原因是 `ASSIGN.md gives conflicting folders or models for this issue.`，外层沿用上面的 `没能开始：…。要换个智能体，还是稍后再试？`。

对话出错时的按钮复用 `Retry`；语音接 DSH 的已配置识别服务复用 `Voice input failed` 等原有用词。模板 `examples/dudu-widget/` 的 `Example widget`、`An example using the read-only issues hook`、预览图 `2 issues` 只用于示例插件，不进入自带的八个组件。

## 仍需审阅或受宿主限制的部分

- New issue 的窗口：设计稿只画了按钮，窗口是最小版（标题、描述、两个按钮；从分组条或 Board 列的"＋"打开时带那一组的值）。
- 详情页右上"···"、宠物和嘟嘟自己的对话、设置里宠物和快捷键、模型、最近一次整理已接上；新增的字见本节。
- `dudu.widget` 已用插件自己声明的 DSH 插槽接通；供应商和手机控制已嵌入嘟嘟设置，保留原来的 DSH 设置入口。
- 本地记忆删除不会复活到索引，但 DSH 的源消息和模型正常历史仍保留；当前宿主没有删改日志或过滤模型历史的接口。不能把它标成“完全忘记”。
- 宠物和设置本次按存档 v38 的现有稿对齐；其他小组件内容和检查器没有高保真稿，沿用文字要求和 DSH 样式。
- 手机端没有设计，没做。

## 语言和视觉对齐：本次变更

- 界面跟随 DSH 的中文、英文和“跟随浏览器”，立即更新；品牌英文统一为 `dudu`，中文为“嘟嘟”。已存在的事项内容、连接器名称、规则文件和模型回答不翻译。
- 本次新增固定文字和译文完整列在 [ui-localization-wording.md](ui-localization-wording.md)，与当前代码的 622 个键对应（现行用词 504 个，保留的旧连接器兼容译文 118 个），含读屏、错误、日期、手机控制和供应商设置。表中的数量示例展示单复数；英文的状态、布局名称仍照原稿。Office 的独立用词另列。
- 对话中操作成功的行复用设计稿的勾号和结果行布局。中文：`已添加事项`、`已更新事项`、`已分配事项`、`已完成事项`、`已取消事项`、`已记录`、`已忘记`、`已添加连接器`、`已添加小组件`、`已移除小组件`、`已恢复版面`；英文对应行见对照表。这些行来自真实工具结果，不是模型说成功就显示。
- UI 对照使用存档的浅色、深色页面；DSH 的全局 `corner-shape: superellipse(1.5)` 会把设计里的圆形和胶囊改成超椭圆，已在 `.dudu` 内重置为 `round`。控件仍是 shadcn/ui、Radix 和 Tailwind。
- 设置导航、记忆编辑和删除图标使用存档稿的原始 SVG 路径；已安装的 Lucide 版本中，部分同名图标的路径不同。规则的标题、说明和代码区、技能的行内删除入口也已补回。连接器按主人后补要求只显示名称、Prompt 和删除，旧的标签、读写、展开区和开关全部撤下。
- 系统活动和已知运行错误随界面语言显示；事项内容、模型问题和外部程序的原始输出不翻译。旧连接器配置诊断译文只作为兼容字典保留，在完整对照表中单独标出。
- 详情稿里的附件图标尚无对应的 issue 附件存储、回复传递约定；当前没有添加仅作展示的附件按钮。其余详情操作按稿对齐。

## 最新补充后的用词（待审）

这一节对应项目选择、唯一留言框、采集 Prompt 和固定工位的新实现。提及只列当前处理者：未分配为 `@dudu`，已分配为对应 Agent；编号按项目关键词和项目内序号；其余新增固定字仍待审。完整逐键中英文见 [ui-localization-wording.md](ui-localization-wording.md)：

| 位置 | English | 中文 |
|---|---|---|
| 侧栏菜单（读屏） | `dudu menu` | `嘟嘟菜单` |
| 项目选择和创建 | `Choose a project` · `Create project` · `Project name` · `Project folder` | `选择项目` · `新建项目` · `项目名称` · `项目文件夹` |
| 创建目录 | `Create the folder if it does not exist` | `文件夹不存在时创建` |
| 项目空、读取和失败 | `No projects yet` · `Loading projects…` · `Could not load projects` | `还没有项目` · `正在读取项目…` · `项目没能读取` |
| 项目创建失败 | `Could not open the project folder. Check its path or create it.` | `项目文件夹没能打开，请检查路径，或勾选创建文件夹。` |
| 留言框下方 | `Mention @{recipient} to send a message. Otherwise, leave a comment.` | `用 @{recipient} 发送消息，不 @ 就是留言。` |
| @ 菜单（读屏） | `Mention` | `提及` |
| 菜单候选列表（读屏） | `Suggestions` | `候选项` |
| 留言错误 | `Write a message first.` · `Mention one recipient at a time.` · `Choose an agent first.` · `Add a message after the mention.` | `先写点内容。` · `一次只 @ 一个。` · `先选择智能体。` · `@ 后面还要写要说的话。` |
| 留言缺项目 | `Choose a project before sending work to an agent.` | `先选项目，再把工作交给智能体。` |
| 请求没送达 | `Your comment was saved, but the request could not be delivered.` | `留言已保存，请求没能送达。` |
| 连接器说明 | `Tell dudu where and what to collect. Saved prompts are used on each collection run.` | `告诉嘟嘟去哪里、收集什么。保存后，每轮采集都会照着这些提示读取。` |
| 删除 Prompt（读屏） | `Remove {name}` | `删除{name}` |
| 收进来为空 | `No source prompts` | `还没有采集提示` |
| Office 说明 | `Assigned active issues as people at desks` | `已分配智能体的进行中事项，各有一位员工` |

原来存成中文或英文的系统提示现在按界面语言显示，包括 `交给谁处理？`、启动失败、会话回复失败、访问方式和优先级规则说明；英文、中文的完整原句在对照表 `activity.*`。嘟嘟审阅工作进度后写的摘要和问题由模型产生，保留原文；完成确认显示嘟嘟的图标和名字。

### 工作 Agent 收到的第一条消息

2026-11-01 按主人补充，完整结构只有下面这些，没有附加固定文案；描述为空时只发标题：

```text
{原任务标题}

{任务描述}
```

事项编号、优先级、流程状态、活动、来源、交接模板和访问说明不拼进工作消息。访问范围由 DSH 权限设置执行。嘟嘟保留来源与过程，并在 Agent 停止后解读实际进度。

### 2026-11-01 新增用词（待审）

| 位置 | English | 中文 |
|---|---|---|
| 会话搜索清空 | `Clear search` | `清空搜索` |
| 会话翻页 | `More sessions` | `更多会话` |
| 打开失败 | `Could not open this session.` | `会话没能打开。` |
| 接管按钮提示 | `Let dudu manage this task` | `交给嘟嘟管理` |
| 接管失败 | `Could not take over this session.` | `会话没能接管。` |
| @ 处理者不匹配 | `Mention the recipient assigned to this issue.` | `只能 @ 当前事项的处理者。` |
| 会话记录区域 | `Conversation history` | `会话记录` |
| 记录为空 | `No messages` | `暂无消息` |
| 预览内的动作 | `Import` · `Take over` | `导入` · `接管`（主人本轮原词） |

会话预览复用 `正在读取…`、`会话没能读取`、`加载更早的记录` 所对应的现有界面用词；已导入的动作复用 `打开会话`。接管只在右栏底部的按钮上，悬停提示复用上表的 `交给嘟嘟管理`（行内的接管图标和 Agent 图标的悬停名字已去掉，见下面 2026-11-01 会话管理弹窗一节）。新增英文译词和空状态仍待主人审字。

Office 这轮撤去头部人数、Agent 图例和左下角未分配角标，白板及工位设置沿用原有用词。编号复制、选择的模板改为实际项目编号；没有项目编号时，选择的读屏标签用事项标题。

### 新项目的规则和连接器模板

`host/assistant/templates.mjs` 的 `AGENTS.md` 本轮新增或替换三条，原样如下；只用于新建文件夹，不覆盖主人已有的规则：

```text
- 嘟嘟管理事项，具体工作交给智能体；智能体停下来后，嘟嘟读最近几段对话，判断进展、更新状态
- 连接器记你指定的信息来源和收集要求，嘟嘟用已有的工具和技能去读；发消息、改来源里的东西要你明确要求
- 先选项目，再分配智能体；智能体只在所选项目里工作
```

`CONNECTORS.md` 模板本轮替换为：

```markdown
# 连接器

连接器是你告诉嘟嘟去哪里、收集什么的 Prompt。每个来源写一个二级标题，下面直接写收集要求。嘟嘟用已有的工具和技能去读，不用另配启动方式或开启开关。

格式示例（缩进的部分不会被读取）：

    ## 飞书
    看飞书里需要我处理的消息，记下来源链接、发消息的人和截止日期。
```


### 2026-11-01 添加组件和会话入口调整

主人本轮明确只保留 Issues、Office、Quota 三个内置组件。Overview、Upcoming、Stuck、Inputs 的界面和专属文案已撤下；原 Sessions 的搜索、预览、导入和接管用词搬入右上角会话管理弹窗，不新增操作名称。事项详情的多余 dudu 品牌面包屑已移除。此前的八组件记录保留为历史。

添加弹窗使用 `design/ui.html` 新稿中的 `Search widgets`、`Full width`；尺寸和数据来源文字复用现有 `Recommended size`、`Minimum size`、`Reads …`、`Added`、`Add`、`Close`，没有额外提示语。两条新增中文译文等待主人确认，当前仅供本地体验检查：

| 位置 | 设计原文 | 待确认中文 |
|---|---|---|
| 添加组件搜索框和读屏名 | Search widgets | 搜索小组件 |
| Issues 推荐尺寸的宽度 | Full width | 全宽 |

### 2026-11-01 会话管理弹窗改成左右两栏（一个新词待审）

左边列表、右边会话记录和按钮（画布"会话"四张，主人 2026-11-01 看过后让直接改代码）。除下面一个新词外，弹窗里的字都是上面已有的，没有新增提示语：

| 位置 | English | 中文 |
|---|---|---|
| 已有事项在管的会话，右栏底部主按钮 | `Open issue` | `打开事项`（待主人审字；"事项"沿用现有用词） |

撤下的字：`Let dudu manage: {title}`（行内接管图标的读屏名，图标已去掉）、`Opening…` / `正在打开…`（没有用到）。右栏不再写角色名：你的话是靠右的气泡，Agent 的话直接显示；Agent 的名字写在标题下一行（`Claude`、`ChatGPT`、`DeepSeek Harness`）。

弹窗里用到的现有字：`Sessions`、`Search sessions`、`Clear search`、`More sessions`、`No sessions`、`Could not read sessions`、`Import`、`Open session`、`Take over`、`Let dudu manage this task`、`Load earlier`、`Conversation history`（读屏）、`No messages`、`Could not open this session.`、`Could not take over this session.`、`Loading…`、事项编号。

### 2026-11-01 真机测试后的调整（新字待审）

| 位置 | English | 中文 |
|---|---|---|
| 事项活动里折起来的长文，点开 / 收回 | `Show more` · `Show less` | `展开` · `收起` |
| Quota 里 DeepSeek 一行的悬停和读屏（账户余额） | `Balance ¥12.34` | `余额 ¥12.34` |
| 添加小组件里，推荐尺寸的高度占满时 | `Full height`（和现有的 `Full width` 并排） | `全高` |

沿用的现有字，没有新增：接管、导入、打开会话时按钮左边的进行中提示 `Working…` / `处理中…`（`T.shell.busy`）；事项页加载时的 `Loading…` / `正在读取…`。
模型菜单里的名字（`Opus 5.5`、`Default (recommended) · Sonnet 5.5`）取自 Claude Code 自己的模型列表，不是我们写的字。

### 2026-11-01 晚：宠物对话窗口（新字待审；主人说“没什么问题，照着设计稿实现”，字仍请审一遍）

| 位置 | English | 中文 | 来源 |
|---|---|---|---|
| + 菜单：加文件 | `File` | `文件` | DSH 自己的字，主人圈出来的 |
| + 菜单：附上当前页面（也是输入框开头的蓝字） | `Context` | `上下文` | 主人的话 |
| 上一项的说明 | `Attach the current page automatically` | `自动附加当前页面位置` | 主人的话 |
| + 菜单：压缩 | `Compact` | `压缩` | DSH 自己的命令名（主人圈出来的） |
| 上一项的说明 | `Compact the conversation above` | `压缩以上对话内容` | DSH 自己的中文 |
| 模型小框的两行 | `Model` · `Reasoning effort` | `模型` · `推理等级` | DSH 自己的字；主人说的是“思考等级”，请定用哪个 |
| 压缩之后对话里的一行 | `Compacted` · `Nothing to compact yet` · `Could not compact` | `已压缩` · `还没有可压缩的内容` · `压缩没能完成` | 新写 |

文件卡片上的“类型 · 大小”（`MD · 18 KB`）是文件自己的信息，不是我们写的字。
沿用的现有字：`Add`（+ 按钮的读屏名）、`Message`、`Send`、`Earlier`、`Today`、`Default`、`Working`。

### 2026-11-01 本人身份与英文名（本人明确指定，已确认）

本人在留言署名、来源和新生成的总结中统一称为 `boss`，保持小写；英文界面中的嘟嘟统一写为 `Dudu`，包括侧栏入口、署名、对话框、设置和说明。提及补全和输入提示统一写为 `@Dudu`、`@ChatGPT`、`@Claude`、`@DeepSeek`，路由仍兼容小写和旧的 `@codex`。中文品牌名仍为“嘟嘟”。既有引用内容和内部角色标识保留原值。

### 2026-11-01 停止工作统一进入 In Review（主人明确指定）

工作完成、暂停、中断、报错、等待回复或授权，都使用已有的 `In Review` / `待审核`，不再单独显示 `Needs you` / `等你回复` 或头像上的琥珀点。详情问题的状态标记、Agent 状态筛选、Office 和宠物提醒复用同一词。未新增界面用词；内部 `needs_you` 键为兼容保留。
