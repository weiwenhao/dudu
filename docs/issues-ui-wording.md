# 嘟嘟桌面界面：用词

**上次审阅（2026-10-31）：你让我按你的风格代审，已审。** 做法：设计稿（画布 v38，存档在 `.local/design-archive/`）里有的字，一律照设计稿；设计稿没有的，按你定的风格改：短、平、不解释。此前的“固定用词用英文”已被你本次“跟随 DeepSeek 语言设置”的要求替代。没有安装到桌面版。下面保留之前审过的历史清单；本次的全部中英文对照在 [ui-localization-wording.md](ui-localization-wording.md)，新增译文仍待你看。连接器启停、独立回复框、顶栏布局控件等旧清单内容已被末节的最新要求替代，不再显示。

所有界面上的固定字在 `host/dudu-plugin/ui/strings.js`（带 `NEW` 注释的是设计稿里没有的）。

## 2026-11-14 Pi 供应商（新增的字）

接入 Pi（`pi`，终端里的编码智能体）后，界面上新增的字只有两处，等你逐字审：

| 位置 | 中文 | 英文 |
| --- | --- | --- |
| 智能体的名字：新建事项和事项里的“智能体”列表、头像、筛选、办公室、会话的供应商选择器、设置里的“供应商”页（一行一个，和 Claude、ChatGPT 一样） | **Pi** | **Pi** |
| 设置 > 供应商里，找到的 Pi 版本太旧时，那一行下面的灰字（宿主写的原句，只有英文，和“Claude was not found.”这类句子一样原样显示） | Pi 1.4.0 or newer is needed (found 1.3.0). | 同左 |

没有新增别的字：开关、路径、“重新检测”、状态词都是原有的；Pi 的头像用 pi.dev 官网的标志（三色的 π），和 Claude、ChatGPT 的标志一样只用来认出它是谁。手机 App（2026-11-14）里的“智能体”列表现在也由宿主发来的供应商决定，Pi 在那里叫 **Pi**（名字来自宿主，不是新写的 App 文案；标志用 SwiftUI 画的同一个三色标志）；认不出的智能体显示它自己的名字和首字母。

## 2026-11-10 需要你图标色板

主人批准的预览使用色名：`雾蓝`、`靛蓝`、`青绿`、`灰紫`、`玫瑰灰`、`蓝灰`、`金色`、`亮蓝`、`电光紫`、`鲜橙`、`玫红`、`墨绿`、`石墨黑`。复用已有的 `颜色` / `Color` 和 `默认` / `Default`，不增加说明文案。色名在两种界面语言里暂用这些已审中文，新的英文色名需另行审阅。

## 2026-11-10 状态图标完成度

主人批准预览后要求删去图标下面的 `1/4`、`1/2`、`3/4` 等文字，不需要提示。弹层只显示已审的标题 `完成度`，下方仍为已有 `颜色`；五个选项只显示圆形填充，不添加 tooltip。读屏沿用预览一并列出的 `状态图标`、`完成度 {value}`，数值为 `0`、`1/4`、`1/2`、`3/4`、`1`。新文案在两种界面语言中暂用已审中文，英文翻译另待审阅。

## 2026-11-04 双地址连接设计

主人审核双地址预览、提出删去“内网优先”和“备用”等调整后，要求直接完成开发。此轮按批准稿使用：
`公网地址` / `Public address`、二维码地址类型 `内网` / `LAN` 与 `公网` / `Public`，
以及读屏 `编辑公网地址` / `Edit public address`、`移除地址` / `Remove address`；编辑动作复用 `编辑` / `Edit`。
“生成二维码”改为整台电脑的单个操作，原有“为内网地址生成二维码”不再出现在这页。
手机端本轮原样文案和批准范围见 [remote-connection-design.md](remote-connection-design.md)。

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
- 活动里嘟嘟写的几行（英文，固定用词）：`started a session with Claude` · `closed the session` · `resumed the session` · `access: read-only` · `the session it named was not offered, so a new one starts` · `Urgent needs a rule in TRIAGE.md; the priority comes from impact and effort.`（`host/assistant/dispatch/words.mjs`，其余是给调用它的模型看的，不在界面上）。
- 交给会话的第一条消息：现为原任务标题和描述，见本文末尾 2026-11-01 的更新。
- 给模型的指令（`dispatch/prompts.mjs`）不是界面，但你写的 `TRIAGE.md`、`ASSIGN.md` 就是读给它们的。
- Office：名牌、图例、读屏句子在 `host/dudu-plugin/ui/widgets/office/strings.js`。
- 设置“通用”页“事项”一栏里的开关 `深度睡眠` / `Deep sleep`（`strings.js` 的 `settings.general.deepSleep`，主人 2026-11-05 要的：“嘟嘟设置页面增加一条可以深度睡眠的配置，默认开启可以选择关闭”）：中文是主人的原话；英文是我照译的，请主人看一下英文。行上没有说明文字（主人定的规矩：不默认加副标题），读屏名和行名一样，没存成时用宠物开关已在用的那句 `Could not save the change` / `更改没能保存`（`T.toast.failed`），不是新词。
- 深度睡眠的月牙（主人 2026-11-05 选定的标记）的名字 `深度睡眠` / `Deep sleep`（`strings.js` 的顶层 `deepSleep`）：头像的悬停提示和读屏名（`Claude · 深度睡眠` / `Claude · Deep sleep`，是已有的 `{智能体} · {状态}` 里状态那一格换成这个词）、Office 名牌的读屏名和悬停卡里的状态字、iPhone 头像的读屏名（`深度睡眠`）。中文是主人的原话；英文是我照译的，请主人看一下英文（和设置里那一行是同一个词）。
- **标签、子事项、新建事项窗口（2026-11-05，参照 Linear；主人没有逐字审，下面都是暂定，请主人看）**。Linear 截图里有的字原样用：`Labels`、`Change or add labels…`、`Create new label: "x"`、`Pick a color for label`、九种颜色名（`Grey`、`Dark Grey`、`Purple`、`Teal`、`Green`、`Yellow`、`Orange`、`Pink`、`Red`）、`Add label`、`Sub-issue of`、`Add sub-issues`、`Set due date`（这里用已有的 `Due date`）；我加的：`Add sub-issue`（右键菜单）、`Sub-issues`（小标题）、`Sub-issue title`（输入框）、`Parent issue`、`Set parent issue…`、`Remove parent`、`Search issues…`、`No issues found`、`Loading labels…`、`No labels yet`、`Could not load labels`、`Could not create the label`、`Could not create the sub-issue`、`More`（新建窗口 “…” 的名字）；显示属性里多了 `Labels`，筛选里多了 `Labels`。中文：标签、修改或添加标签…、新建标签：“x”、选择标签颜色、灰色/深灰/紫色/青色/绿色/黄色/橙色/粉色/红色、添加标签、子事项，属于、添加子事项、连续创建、子事项标题、父事项、设置父事项…、移除父事项、搜索事项…、没有找到事项、正在读取标签…、还没有标签、标签没能读取、标签没能创建、子事项没能创建、更多。完成数/总数写成 `0/1`（不用字）。新建窗口的芯片没有新字：状态、优先级、智能体（没选时写 `Agent`，读屏名仍是 `No agent`）、项目（读屏名仍是 `Choose a project`）。
- Office 的深度睡眠标签 `ZZZ`：2026-11-07 主人说“zzz 就不需要了”，已经去掉（`strings.js` 的 `zzz` 也删了）；没有为它留下新词。

## 对话、宠物和整理：本次新增，等你看

以下字是在上一次代审之后加的，还没有安装到正式 Desktop。固定控件的字在 `host/dudu-plugin/ui/strings.js`：

| 位置 | 原样用词 |
|---|---|
| 详情页更多按钮（读屏） | `More` |
| 忘记 issue 的范围说明 | `This issue, its activity and local links will be deleted. Source messages and session history stay.` |
| 通用：宠物和快捷键 | `Pet` · `Show pet` · `Double Space to open conversation` · `Hold Space for voice input` |
| 通用：模型 | `Model` · `Change in DSH` |
| 通用和详情：整理 | `Last tidy` · `Not tidied yet` · `Undo tidy` |
| 宠物按钮和对话控件（含读屏） | `Open conversation` · `Close` · `嘟嘟` · `Message` · `Send` · `Earlier` · `Voice input` · `Stop` |
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
- `dudu.widget` 已用插件自己声明的 DSH 插槽接通；供应商和手机控制是嘟嘟设置里的两页，DSH 自己的设置里不再有这两项（主人 2026-11-03）。
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
- 此前未启用的详情附件入口已在 2026-11-05 按主人提供的 Linear 截图实现；新增的三个操作用词见文末，等待逐字审阅。

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
- 嘟嘟管理事项，具体工作交给智能体
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
| + 菜单：压缩 | `Compact` | `压缩` | DSH 自己的命令名（主人圈出来的） |
| 上一项的说明 | `Compact the conversation above` | `压缩以上对话内容` | DSH 自己的中文 |
| 模型小框的两行 | `Model` · `Reasoning effort` | `模型` · `推理等级` | DSH 自己的字；主人说的是“思考等级”，请定用哪个 |
| 压缩之后对话里的一行 | `Compacted` · `Nothing to compact yet` · `Could not compact` | `已压缩` · `还没有可压缩的内容` · `压缩没能完成` | 新写 |

文件卡片上的“类型 · 大小”（`MD · 18 KB`）是文件自己的信息，不是我们写的字。
沿用的现有字：`Add`（+ 按钮的读屏名）、`Message`、`Send`、`Earlier`、`Today`、`Default`、`Working`。

### 2026-11-01 本人身份与英文名（本人明确指定，已确认）

本人在留言署名、来源和新生成的总结中统一称为 `boss`，保持小写；英文界面中的嘟嘟统一写为 `Dudu`，包括侧栏入口、署名、对话框、设置和说明。提及补全和输入提示统一写为 `@Dudu`、`@ChatGPT`、`@Claude`、`@DeepSeek`，路由仍兼容小写和旧的 `@codex`。中文品牌名仍为“嘟嘟”。既有引用内容和内部角色标识保留原值。

2026-11-09，按主人指明的位置把嘟嘟入口接到侧栏收起后的全局标题栏，仍使用已有的 `嘟嘟` / `Dudu`（`T.brand`）作为悬停提示和读屏名称；没有新文字。宿主原有“展开侧边栏”和“新建会话”的文字、翻译和快捷键由原组件继续提供。

### 2026-11-01 停止工作统一进入 In Review（主人明确指定）

工作完成、暂停、中断、报错、等待回复或授权，都使用已有的 `In Review` / `待审核`，不再单独显示 `Needs you` / `等你回复` 或头像上的琥珀点。详情问题的状态标记和宠物的待处理提醒复用同一词。Agent 独立生命周期按主人 2026-11-02 的补充执行，见下一条。

### 2026-11-02 智能体独立状态（主人明确指定）

主人指定 `idle / working / blocked / done`，英文显示 `Idle / Working / Blocked / Done`；中文沿用已有的 `空闲 / 工作中 / 待介入 / 已完成`，没有新增词。2026-11-03 主人把 done 合并进 blocked：只剩 `Idle / Working / Blocked` 和 `空闲 / 工作中 / 待介入`，删去了 `Done / 已完成` 这个状态名，没有新增词。事项列表、看板、详情、Office 和侧栏共用 Logo 右下角的状态标记及同一组悬停说明。In Review / 待审核仍是事项状态，与 Agent 状态独立；等回复或出错的员工也可以休息。

### 2026-11-02 原生会话手动压缩提示（待审，尚未安装到 Desktop）

`Manual compaction is not available for {name} through OAR; native automatic compaction remains enabled.`

`{name}` 为 `Claude` 或 `ChatGPT`。Claude 与 Codex 的正常 `/compact` 现已调用原生压缩，这句只保留作旧宿主缺少 maintenance / runtime 缺少能力，以及适配器辅助摘要路径的明确拒绝，不再是当前两个 harness 的正常命令结果。

新增失败原因（收到成功回合结束却没有真实压缩回执，不得显示成功）：

`{name} ended without reporting native compaction.`

如果 harness 在该 result 中提供了错误文字，直接显示其原始诊断，不用这一后备句。

本次沿用 DSH 命令结果的原文也列出待审，未另写中文覆盖宿主：

- `Usage: /compact (no arguments)`
- `No compactable history yet.`
- `Compaction is unavailable because this process has an active compaction, or the agent is not idle.`
- `Compaction cancelled.`

### 2026-11-02 宠物右键隐藏（待审，尚未安装到 Desktop）

新增菜单项：`Hide pet` / `隐藏宠物`。主人要求在嘟嘟设置中以及宠物右键菜单中隐藏宠物；设置沿用现有的 `Show pet` / `显示宠物` 开关，保存失败沿用 `Could not save the change` / `更改没能保存`，没有新增提示文案。

### 2026-11-02 副文本清理和规则页内编辑

主人要求截图中的说明性副文本撤下，已有副文本重新审字；完整原句、移除范围、仍显示的说明及手机原生发现项见 [secondary-copy-review.md](secondary-copy-review.md)。本轮不以自检代替主人审核。

规则页复用既有 `Edit` / `编辑`、`Save` / `保存`、`Cancel` / `取消`，读屏名字沿用记忆页的 `Edit: {text}` / `编辑：{text}`，此处 `{text}` 是规则文件名；失败复用 `Could not save the change` / `更改没能保存`。开发者模式曾合并进小组件列表，随后按主人要求随整个“小组件”设置栏目一并移除。组件仍由“编辑版面”管理，开发检查器保留现有开发接口。本轮没有新增固定文案。

### 2026-11-02 Linear 形式的截止日期（主人已确认）

主人授权查看已登录的 Linear，参考实际日期标签、快捷菜单和自定义日历。以下五组中英文原文已在 2026-11-02 展示给主人，主人回复“可以”，允许随本次日期控件更新发布：

| 键 | English | 中文 |
| --- | --- | --- |
| due.placeholder | Try: 24h, 7 days, Feb 9 | 试试：24h、7天、2月9日 |
| due.remove | Remove due date | 移除截止日期 |
| due.custom | Custom… | 自定义… |
| due.weekEnd | End of this week | 本周结束 |
| due.oneWeek | In one week | 一周后 |

“本周结束”对应最近一个周五，周五当天可选当天，周末则为下个周五；“一周后”为七个本地日历日后。相对日和周跨夏令时仍按本地日历计算。

复用已有 `Tomorrow` / `明天`、`Due date` / `截止日期`、`Cancel` / `取消`、`Save` / `保存`，以及日期变更和撤销的现有文字。没有复制 Linear 的解释段落，也没有增加帮助副文本。日期和星期通过语言设置格式化，不翻译事项内容。

### 2026-11-03 自定义事项状态（待审，尚未安装到 Desktop）

主人授权参考 Linear 在嘟嘟设置中自定义状态。以下是本次新增或新增位置使用的中英文原文，尚待主人逐字确认；没有新增说明性副文本。状态名称、描述和事项数量为实际内容。

| 位置 | English | 中文 |
| --- | --- | --- |
| 设置入口和标题 | Status | 状态 |
| 名称输入 | Name | 名称 |
| 描述输入 | Description | 描述 |
| 颜色按钮和输入 | Color | 颜色 |
| 新增表单按钮 | Create | 创建 |
| 菜单按钮读屏名 | Status options: {name} | 状态选项: {name} |
| 分类加号的读屏名 | Add status to {category} | 在{category}中添加状态 |
| 拖动柄读屏名 | Reorder: {name} | 调整顺序: {name} |
| 菜单排序 | Move up / Move down | 上移 / 下移 |
| 菜单默认值 | Set as default | 设为默认 |
| 删除时选择替代状态 | Move issues to | 将事项移至 |
| 分类条 | Backlog / Unstarted / Started / Completed / Canceled | 待规划 / 未开始 / 已开始 / 已完成 / 已取消 |
| 无效或已删除的状态 | This status no longer exists. | 这个状态已不存在。 |
| 名称或颜色不合法 | Check the status name and color. | 请检查状态名称和颜色。 |
| 名称重复 | A status with this name already exists. | 已有同名状态。 |
| 删除分类的最后一个状态 | Keep at least one status in each category. | 每个分类至少保留一个状态。 |
| 有事项但未选替代状态 | Choose a status for the existing issues. | 请选择现有事项要移入的状态。 |

继续复用已有的 Edit / 编辑、Cancel / 取消、Save / 保存、Delete / 删除、Default / 默认及删除确认标题。编辑按钮的读屏名沿用 `Edit: {name}` / `编辑：{name}`。

默认分组和次级分组复用已批准的 `Agent state` / `智能体状态`；名称为 `Idle / Working / Blocked` 与 `空闲 / 工作中 / 待介入`（2026-11-03 起不再有 `Done / 已完成` 这个智能体状态；事项状态 Done 不受影响）。进度生成规则变化只影响内容，不新增固定提示。

### 2026-11-03 设置重写：连接器手动添加（待审，尚未安装到 Desktop）

主人要求设置整体重写（八页同一套积木），并让连接器可以手动添加 Prompt。重写没有新增说明性副文本，也没有换已有的字；新增的字只有下面这些，尚待主人逐字确认：

| 位置 | English | 中文 |
| --- | --- | --- |
| 连接器页右上的按钮，也是添加表单的组标题 | Add connector | 添加连接器 |
| 添加和修改表单的两个输入（读屏名和占位） | Name · Prompt | 名称 · Prompt |
| Prompt 里有以 `#` 或 `##` 开头的行 | A line of the prompt cannot start with # or ##. | Prompt 里的行不能以 # 或 ## 开头。 |
| 名称空、太长或含 `<` `>` | Give the connector a short name. | 请给连接器起一个简短的名称。 |
| Prompt 空或太长 | Write a prompt saying where and what to collect. | 请写下去哪里收集、收集什么。 |
| Prompt 或名称含密钥 | Keep credentials out of prompts. Use the tool that holds them. | 不要把密钥写进 Prompt，请使用保存密钥的工具。 |
| 文件在页面不知道时被改过 | The connectors changed. Reload and try again. | 连接器刚刚有变动，请重新打开再试。 |
| 连接器超过 100 个 | There are too many connectors. | 连接器太多了。 |
| 修改时它已被删掉 | This connector no longer exists. | 这个连接器已不存在。 |
| 文件读不了或写不了 | The connectors could not be read or saved. | 连接器没能读取或保存。 |

这些错误来自后端的固定句子，页面按界面语言显示，原句见 `host/assistant/connectors/index.mjs`，译文在 `ui/strings.js` 的 `diagnostics`。其余沿用已有的字：`Save` / `保存`、`Cancel` / `取消`、`Edit: {name}` / `编辑：{name}`、`Remove {name}` / `删除：{name}`、`Undo` / `撤销`、`Added by Dudu` / `嘟嘟添加`（后者原来写在字典里、界面没有用，现在用来标出嘟嘟添加的条目）。

手机控制和供应商两页的字没有变（`ui/strings.js` 的 `shell`），只是从 DSH 的设置搬进了嘟嘟设置；`Providers` / `供应商` 页的状态点没有文字。

### 2026-11-03 智能体 Blocked 方案 B（主人已确认）

主人查看当前图标与两个候选方案的对比截图后，指定使用方案 B。`agentState.blocked` 的中文由「卡住了」改为「待介入」，英文仍为 `Blocked`；列表和看板的分组图标使用八边形暂停 `OctagonPause`，保留现有尺寸、线宽和颜色。该确认取代前文的旧中文译名。

状态名称同步用于筛选、头像悬停说明、Office 和手机原生侧栏。状态键仍为 `blocked`，含义仍包括等待实际答复或授权及执行出错；本次不调整状态判断、事项流程或头像角标。

### 2026-11-03 宠物右键菜单与悬停提示（主人已确认）

主人提供 Codex 宠物菜单截图，要求参考其样式，并增加快速打开嘟嘟设置的入口。菜单按顺序使用 `Settings` / `设置`、`Hide Dudu` / `隐藏 Dudu`，分别使用齿轮和隐藏图标；没有新增解释文字。主人随后明确指定“我们就叫隐藏 Dudu”，该命名取代前文的 `Hide pet` / `隐藏宠物`。设置打开既有的 `Dudu settings` / `嘟嘟设置` 窗口，不打开 DSH 自己的设置。

按主人要求移除悬停气泡中的 `Double Space to chat` / `双击空格对话`、`Hold Space to speak` / `长按空格说话`。通用设置里的两个快捷键开关和真实的录音、回复、事项提醒不变；这次撤下的副文本也记录于 [secondary-copy-review.md](secondary-copy-review.md)。

### 2026-11-04 状态名「需要你」和本人的称呼「你」（主人明确指定）

主人的原话：“待介入这个英文应该是 needs you”“待介入这个词不够好，换成需要你”“issue 详情页留言应该是 boss 吧，也换成 你，英文版是 You”“我在嘟嘟这个插件中的角色就是 ‘你’”。所以：

- 智能体状态 `blocked` 的显示名：英文 `Needs you`，中文 `需要你`，取代 `Blocked` / `待介入`（筛选、分组标题、右键菜单、头像悬停说明、Office 的读屏句和名牌、提醒、手机侧栏同用）。状态键、含义不变；提问、授权、出错和本轮正常结束都是它。
- 本人在界面里的称呼：英文 `You`，中文 `你`，取代 `boss`：issue 详情页留言和活动的署名、事项的来源（Source）、设置里“由你设置 / 由你添加”的两句提示。连接器页里显示的几句英文不再点名（`it has to be turned off…`、`it is turned on in the connections page`、`is not Dudu's entry`），中文本来就没有名字。
- 嘟嘟写给本人看的文字（回复、事项标题和描述、进展句、记忆）改称“你”（英文 you），不再写 boss；这条规则在 `host/assistant/identity.mjs`，只管以后新写的文字，已经存下的旧进展句不会改。给模型看的内部提示和工具返回里仍把这个人叫 boss / owner。
- 头像右下角的角标不是新词：红点（提问、授权、出错）和绿底白勾（本轮正常结束）没有文字；悬停说明两种都是 `Needs you` / `需要你`。

### 2026-11-04 宠物对话窗口的运行行（中文是主人指定的，英文待审，尚未安装到 Desktop）

嘟嘟回答时，宠物窗口原来只有一个“…”。主人问“回答过程中什么效果都没有么，可以加一个深度求索中之类的东西吧，现在的会话都是有的”，又贴了 DSH 对话里蓝色的“深度求索中，用时 9 秒 ···”，说“我们的对话都是这样的”。窗口里这一行照 DSH 做，取代原来的 `Working` / `工作中`（那个“…”的读屏名，已删）：

| 位置 | English | 中文 |
|---|---|---|
| 运行行（看得见） | `Deep diving for {duration} ···` | `深度求索中，用时 {duration} ···` |
| 运行行（读屏，只读一次、不报时间） | `Deep diving` | `深度求索中` |
| 时间 `{duration}` | `9s` · `1m 15s` · `1h 2m 5s` | `9秒` · `1分15秒` · `1小时2分5秒` |

- 中文是主人给的原文；英文和时间的写法取自 DSH 自己的 `Deep diving for 9s ···`，没有改字，请主人看一下英文。
- 时间的写法同 DSH：秒总有，满一分钟才写分，满一小时才写小时。
- 没有新增别的字：DSH 在这行上面那一行步骤（“正在分析请求”）宠物窗口没有做。

### 2026-11-05 采集器：频率、笔记、来源（主人授权我按下表定稿）

主人 2026-11-05 看了图，选定：列表用“频率靠右 + 上次采集一行”，表单用一个频率文字框加常用下拉，笔记折叠，事项页属性栏加“来源”一组（“来源”两个字是主人指定的）。新增的字如下。主人看了图后说“你直接定吧”，所以下表就是定稿；英文那一栏他没有逐条看，如要改再说：

| 位置 | English | 中文 | 谁的字 |
| --- | --- | --- | --- |
| 事项页属性栏的组名 | Source | 来源 | 主人指定 |
| 频率文字框的占位和读屏名 | How often, such as 30m, 2h, 1d, or cron | 频率，如 30m、2h、1d，或 cron | 我（图里主人选了 F2） |
| 频率框尾箭头的读屏名 | Common frequencies | 常用频率 | 我 |
| 下拉里的八项和列表里的说法 | Every 5 minutes · Every 15 minutes · Every 30 minutes · Every hour · Every 6 hours · Every day at 09:00 · Monday to Friday at 09:00 · Monday to Friday, every hour 9–18 | 每 5 分钟 · 每 15 分钟 · 每 30 分钟 · 每小时 · 每 6 小时 · 每天 09:00 · 周一至周五 09:00 · 周一至周五 9 至 18 点每小时 | 句式取自 DSH 自己的定时任务（“每 N 分钟”“每天”“周一至周五”），数字和后两项是我的 |
| 列表里别的频率 | Every {n} minutes · Every {n} hours · Every hour · Every {n} days · Every day | 每 {n} 分钟 · 每 {n} 小时 · 每小时 · 每 {n} 天 · 每天 | 同上 |
| 修改表单里折叠的一行（2026-11-05 拿掉了：收集器不再有笔记，主人：“我希望两句话就能说清楚”） | ~~Notes~~ | ~~笔记~~ | 我（图里主人选了 N2） |
| 列表里 Prompt 下面一行 | Last {time} · {n} new · Last {time} · nothing new · Last {time} · failed | 上次 {time} · 新增 {n} 条 · 上次 {time} · 没有新的 · 上次 {time} · 读取失败 | 我（图里主人选了 C；“读取失败”是新的） |
| 频率写不对 | Write how often, such as 30m, 2h, 1d, or a cron expression such as 0 9 * * 1-5. | 请写多久采集一次，如 30m、2h、1d，或 cron 表达式，如 0 9 * * 1-5。 | 我 |
| 频率低于 5 分钟 | The shortest time between collections is 5 minutes. | 最短每 5 分钟采集一次。 | 我 |
| 笔记含密钥（已删，没有笔记了） | ~~Keep credentials out of the notes. Use the tool that holds them.~~ | ~~不要把密钥写进笔记，请使用保存密钥的工具。~~ | 我 |
| 笔记超过 4000 字（已删） | ~~The notes are longer than 4000 characters.~~ | ~~笔记超过 4000 字了。~~ | 我 |

沿用已有的字：`Open source` / `打开来源`（顶栏的按钮和“来源”组里按钮的读屏名）、`Name` / `名称`、`Prompt`、`Save` / `保存`、`Cancel` / `取消`。事项说明末尾由代码写的一行 `来源：飞书 · 链接` 是事项内容，不是界面文字；给智能体看的采集和整理提示词（英文）在 `host/assistant/home/source-collector.mjs` 和 `host/assistant/dispatch/prompts.mjs`，仍待主人看。

### 2026-11-05 信息收集器小组件（主人看过设计稿和下面的字，说“没问题，就按你的推荐实现吧”）

| 位置 | English | 中文 | 谁的字 |
| --- | --- | --- | --- |
| 小组件名 | Collector | 信息收集器 | 主人 |
| 三个页签 | To handle · Handled · Ignored | 待处理 · 已处理 · 已忽略 | 我，主人看过 |
| 右键和弹窗里的动作 | Share to issue · Ignore · Restore | 分享到事项 · 忽略 · 恢复 | 我，主人看过（“分享”“忽略”是主人的词） |
| 没有信息时 | Nothing here | 没有信息 | 我，主人看过 |
| 提示 | Ignored · Restored · Shared to {ref} | 已忽略 · 已恢复 · 已分享到 {ref} | 前一个和后一个主人看过；“已恢复”是照“已忽略”补的，没单独给主人看 |
| 加载失败 | Could not load the information | 信息没能加载 | 我（新，没单独给主人看） |
| 弹窗里的一行（只有挂了事项的记录才有） | Dudu made [DUD-12] · Shared to [DUD-12] · Created [DUD-12] | 嘟嘟 建了 [DUD-12] · 已分享到 [DUD-12] · 已新建 [DUD-12] | “嘟嘟 没有转成事项”那一句 2026-11-05 删了（主人：“这个东西也不需要。只要收集好信息就好了，不需要嘟嘟处理任何东西”）；“嘟嘟 建了”只留给这次改动之前嘟嘟自己建过事项的记录，以后不会有新的；后两句是主人自己做了之后的说法（分享到事项或会话都是“已分享到”），照“已分享到 {ref}”补的 |
| 添加小组件列表里的说明 | What the connectors collected, to share to an issue, make an issue of, or ignore | 连接器收集回来的信息，可分享到事项、新建事项或忽略 | 我（新，没单独给主人看；已被下面“连接器和收集器分开”一节里的说法取代） |

### 2026-11-05 收集器里的“分享到会话”和多选（待主人审）

主人要的：“现在有分享到事项，再增加一个分享到会话”“一个一个忽略太慢了，增加一个 checkout 窗口，可以多选操作”，还有“这个移动到上面”（筛选按钮放进标题那一行）。新增的字：

| 位置 | English | 中文 | 谁的字 |
| --- | --- | --- | --- |
| 右键菜单、弹窗和批量栏里的动作 | Share to session | 分享到会话 | 主人（原话） |
| 提示 | Shared to the session of {ref} | 已分享到 {ref} 的会话 | 我（照“已分享到 {ref}”补的，没单独给主人看） |
| 批量栏：读屏名、计数、取消 | Bulk actions · {n} selected · Clear selection | 批量操作 · 已选 {n} 条 · 取消选择 | 事项列表批量栏里已有的字，原样用 |
| 发给会话的那条消息里的固定标签（写在事项的活动和智能体的会话里，主人会看到） | — | 收集到的信息：{标题} · 发送人：{谁} · 时间：{年-月-日 时:分} · 来源：{收集器名} · {链接} · 上下文： | “时间”“来源”“上下文”是主人的原话（“时间来源上下文都要有”）；“收集到的信息”“发送人”是我加的，等主人看 |

多选用事项列表已有的复选框和批量栏，没有别的新字；筛选按钮的位置变了，字没变。小组件窄的时候批量栏仍是一行，三个动作换成右键菜单里同一个动作的图标，按钮的名字和悬停提示还是上面这几个字，没有新字（主人：“放一行里面吧”）。分享到会话时，会话里收到的整条消息的样子（例）：`收集到的信息：合同第三条` / `发送人：Alice` / `时间：2026-11-05 14:02` / `来源：飞书 @我 · https://…` / 空一行 / 原文 / 空一行 / `上下文：` 和 `- Bob（2026-11-05 13:02）：法务看过了。`；没有的项不写，几条一起发时中间一行 `---`。

沿用事项已有的字：筛选、添加筛选…、来源（筛选字段）、日期、过去一天、过去一周、过去一个月、是 / 是其中之一、清除、移除筛选、新建事项、打开事项、打开来源、搜索事项…、上下文、撤销、关闭；时间照事项活动的写法（刚刚、12 分钟前、3 小时前、昨天 17:40、11月3日 09:05）。主人 2026-11-05 说过属性组不叫“连接器”，直接叫“来源”，筛选字段也叫“来源”。

### 2026-11-05 事项留言附件（新增操作用词待审）

主人要求按提供的 Linear 截图实现，并优先复用 UI 组件库。附件入口、删除、展开、关闭、重试和错误提示沿用已有用词，没有增加解释文案。以下三个新增操作同时用于悬停提示和读屏名，尚待主人审阅后发布：

| 位置 | English | 中文 |
| --- | --- | --- |
| 图片悬停工具栏和预览窗口 | Download | 下载 |
| 同上 | Copy image | 复制图片 |
| 同上 | Copy link | 复制链接 |

文件名、文件类型、文件大小和留言原文为用户内容及实际数据。实现使用已有 shadcn/Radix Button、Tooltip、Dialog 和 Lucide 图标，未引入自绘弹窗或新的控件库。

### 2026-11-05 会话接管成功

（2026-11-08 更新：主人说“接管之后直接打开 issue 详情”，所以接管成功后除了下面的提示，还会关掉弹窗、打开事项详情；提示的词没变。）

主人明确要求“提示接管成功就行了，不需要再跳转到 issue 详情”。中文原样用“接管成功”，不需要再审；英文翻译待审：

| 位置 | English | 中文 |
| --- | --- | --- |
| 接管完成后的提示条 | Session taken over | 接管成功（主人提供） |

成功后保留会话弹窗、选中项、预览和搜索，立即显示事项编号，按钮变为已有的“打开会话”和“打开事项”；只有主人点击“打开事项”才进入详情。搜索加载、失败和重试沿用已有用词，没有新增解释段落。

### 2026-11-05 连接器和收集器分开（主人看过设计稿，说“按你的设计重构”；字没有逐条审，待审，尚未安装到 Desktop）

连接器只管怎么连上一个服务（Prompt 或 MCP），收集器管收集什么、多久一次。设置里多一页“收集器”，下面是新增和改动的字（图里主人看到的字；“没有逐条审”的意思是主人没有一个一个确认）：

| 位置 | English | 中文 | 谁的字 |
| --- | --- | --- | --- |
| 设置左边新的一页 | Collectors | 收集器 | 主人（“收集器”是主人的词） |
| 连接器：两种形式（胶囊和行里的小标签） | Prompt · MCP | Prompt · MCP | 主人（“连接器以后也会有 mcp 授权的形式。prompt 只是形式之一”） |
| 连接器表单里的选择框（标签和读屏名） | MCP server | MCP 服务 | 我 |
| MCP 服务的状态（选择框的行右边、列表行里“服务名 · 状态”） | Authorized · Needs authorization | 已授权 · 需要授权 | 我。**DSH 没有授权这一步**：有这个服务的工具就写“已授权”，没有就写“需要授权”（没授权、没启动都会这样）；所以设计稿里的“授权”按钮没有做 |
| 连接器行最下一行 | Collectors: {names} | 收集器：{names} | 我 |
| 删不掉一个还在用的连接器 | Collectors still use it: {names} | 还有收集器在用它：{names} | 我 |
| 收集器页：添加 | Add collector | 添加收集器 | 我（照“添加连接器”） |
| 收集器表单里的选择框（标签和读屏名） | Connector | 连接器 | 我 |
| 收集器表单里的多行框（占位和读屏名） | What to collect | 收集什么 | 我（“收集什么”是主人解释笔记时用的话，也是主人说“去哪里、收集什么”的原话） |
| 收集器页的两种空 | No collectors · Add a connector first | 没有收集器 · 先添加一个连接器 | 我（后一句时“添加收集器”是灰的） |
| 连接器页的空、删除、撤销、嘟嘟添加的标 | No connectors · Remove {name} · Removed {name} · Undo · Added by Dudu | 没有连接器 · 删除：{name} · 已删除 {name} · 撤销 · 嘟嘟添加 | 已有的字，原样 |
| 频率、常用频率、“上次”一行 | （见 2026-11-05 采集器一节） | 同上 | 已有的字，从连接器搬到收集器（笔记已删） |

不能保存时表单里写的原因（新增）：

| English | 中文 |
| --- | --- |
| Give the collector a short name. | 请给收集器起一个简短的名称。 |
| A connector is a Prompt or an MCP server. | 连接器的形式是 Prompt 或 MCP。 |
| Write a prompt saying how to reach the service. | 请写下怎么连上这个服务。 |
| Choose an MCP server. | 请选一个 MCP 服务。 |
| Use the name of an MCP server in DSH. | 请填 DSH 里的 MCP 服务名称。 |
| Choose a connector. | 请选一个连接器。 |
| Choose an existing connector. | 这个连接器已不存在，请另选一个。 |
| Write what to collect. | 请写下要收集什么。 |
| This is too long. | 内容太长了。 |
| A line cannot start with # or ##. | 这里的行不能以 # 或 ## 开头。 |
| Keep credentials out of the collector. Use the tool that holds them. | 不要把密钥写进收集器，请使用保存密钥的工具。 |
| The collectors changed. Reload and try again. · There are too many collectors. · This collector no longer exists. · The collectors could not be read or saved. | 收集器刚刚有变动，请重新打开再试。 · 收集器太多了。 · 这个收集器已不存在。 · 收集器没能读取或保存。 |
| （连接器的四句换了说法：The connectors changed… / There are too many connectors. / This connector no longer exists. / The connectors could not be read or saved.） | 连接器刚刚有变动，请重新打开再试。 · 连接器太多了。 · 这个连接器已不存在。 · 连接器没能读取或保存。 |

别处跟着改的字：

| 位置 | English | 中文 | 说明 |
| --- | --- | --- | --- |
| 事项属性栏“来源”里，来源类型是收集器时写的值 | Collector | 收集器 | 原来写“连接器”；属性组名“来源”不变 |
| 添加小组件列表里信息收集器的说明 | What the collectors collected, to share to an issue, make an issue of, or ignore | 收集器收集回来的信息，可分享到事项、新建事项或忽略 | 原来是“连接器…” |
| 嘟嘟对话里添加收集器的一行 | Collector added | 已添加收集器 | 照“已添加连接器” |
| 项目文件夹里两个文件开头的话（新建文件夹和拆旧登记册时写） | — | CONNECTORS.md：“连接器告诉嘟嘟怎么连上一个服务：写一段 Prompt，或者指定一个 DSH 里已连接的 MCP 服务。要收集什么、多久收集一次，写在收集器里。”COLLECTORS.md：“收集器是一份定时的收集：通过哪个连接器读，收集什么，多久一次。每个收集器写一个二级标题，下面直接写要收集什么。”AGENTS.md 里那一条改成“连接器记怎么连上你的服务，收集器记收集什么、多久一次；……” | 这些在文件里，不在界面上；主人自己的文件不会被改（旧登记册拆分时，没动过的老开头换成新的） |

给嘟嘟看的英文提示词：采集会话（`host/assistant/home/source-collector.mjs`，写了连接器的写法；同一天稍后不再问 `to_me`、`handled`、`me`，只说“读、交回记录”）仍待主人看（同一天又改了：去掉了笔记，问法只剩收集器的名字、连接器的话、收集器的话和上次时间，系统提示里加了“只给提示词点名的，拿不准就不给，‘尤其是’不是放宽”一条，这是给模型看的英文，不是界面字，也待主人看）。整理收集来的信息的提示词和代码一起去掉了（主人：“只要收集好信息就好了，不需要嘟嘟处理任何东西”），`host/assistant/dispatch/prompts.mjs` 里只剩分配用的。

没有做的设计：设计稿里 MCP 行的“授权”按钮（DSH 没有从这里发起授权的办法，授权在 DSH 里做）；没有 MCP 服务时，MCP 的选择框是灰的、不另写说明。

## 智能体状态“未分配”（2026-11-05，待主人审）

主人要求智能体状态新增一个“未分配”，没有分配智能体的事项就是它。这是**唯一新增的界面文字**，词是我定的，等主人看：

| 位置 | English | 中文 | 说明 |
| --- | --- | --- | --- |
| 智能体状态：分组标题、看板列名、筛选项、右键菜单和悬停里的状态名（`agentState.unassigned`） | Unassigned | 未分配 | 沿用 Linear 里没有负责人的叫法；图标是原来就有的“没有智能体”的人形，没有新图 |

同一天规则变了但**没有新词**：会话停止或被终端中断算“需要你”（`Needs you / 需要你`）；正常结束后 12 小时没人处理算“空闲”，并进入深度睡眠（`Idle`、月牙都是已有的）。

2026-11-07 主人把这两处又改了，仍**没有新词**：①去掉“12 小时变空闲”，空闲只由主人自己放（“去掉自动进入空闲的机制吧，只有我手动放到空闲区域”）；②正常结束的绿勾也能深度睡眠，仍留在“需要你”，Office 里休息区的人也带 `ZZZ`（“在需要我的阶段，只要不是红点，都可以进入深度睡眠。办公室小人在活动区域也会有 zzz 的表情”）；头像上月牙只给空闲的，睡着的绿勾仍是绿勾，没有为它起新名字。

## 2026-11-05 照 Linear 补的功能里的新界面词（待主人审）

主人逐条点头的七件事（复制菜单、父子事项展示、链接/PR/文档、描述历史、富文本描述、保存的视图、删除确认）带来的新词。**Linear 自己用的词原样用**：Copy、Copy title、Copy as prompt、Make a copy…、Add link…、Add pull request…、Add document…、Show description history、Add new view、Create view、Delete "…"?、Heading 1/2/3、Bulleted list、Numbered list、Checklist、Quote、Code block、Divider；**其余是我写的**（窗口里的字段名、提示和错误句、中文），逐条列在 `docs/ui-localization-wording.md` 末尾（键 `copy.*`、`deleteIssue.*`、`links.*`、`descriptionHistory.*`、`richText.*`、`views.*`）。

要主人特别看一眼的：
- 删除确认的第二句不能照抄 Linear（它说“在 Recently deleted 里留 30 天”，嘟嘟删了就没有了），写的是真实的：“This issue, its activity and local links will be deleted. Source messages and session history stay.”（沿用事项页“Forget”窗口里本来就有的那句）。
- 列表里子事项写成“父事项标题#子事项标题”，是主人的格式（分隔符 2026-11-05 定为 #），不是新词。
- 复制出去的文字不是界面词，但内容里有固定的英文标签：复制为提示词写 `Project folder:`、`Labels:`、`Due:`、`Links:`；复制全部内容的 Markdown 里的属性名跟界面语言走。

2026-11-05 主人说“连续创建”没用：窗口里的 `Create more` / `连续创建` 开关删掉了（上面那一条里的它不再有）。

## 会话列表的三句灰字（2026-11-05，待主人审）

主人选了方案 A（见 `docs/assistant.md` 4.1）。三句都是我写的新词，中文照主人看过的图：`还有 N 个会话没法搜索内容，结果可能不全`、`正在建立搜索索引（已读/总数），结果可能不全`、`部分会话没能读取，列表可能不全`；英文 `N sessions cannot be searched, so results may be incomplete`、`Building the search index (done/total), so results may be incomplete`、`Some sessions could not be read, so the list may be incomplete`。原来的红字“会话没能读取”只留给“一个会话都读不出来”。

2026-11-08 主人要求换方式或不显示第一句：撤下中英文“无法搜索正文”的常驻提示，不添加替代文案，不转移到 tooltip 或弹窗；读取失败仍进诊断日志。后两种实际进行中或列表来源失败的状态保持原有展示。

同日主人随后要求 header 显示最后更新时间、加载时显示 loading：索引进度那句也撤下；顶栏复用已有 `更新时间` / `Updated` 和时间值，读取或索引进行中时显示中灰转圈，沿用原有 loading 的读屏名称，没有新文字。

子事项在列表里的写法是 `父标题#子标题`（分隔符主人定了 `#`）。子事项开始提示词里原来加的几行（`所属的父事项：…`、`同一个父事项下的其他子事项：…`，英文 `Parent issue:`、`Other sub-issues of the same parent:`）2026-11-14 去掉了：子事项和别的事项一样，只传标题和说明。


## 列表和看板的日期（2026-11-05，没有新词）

主人给了 Linear 的列表和看板截图要照着优化时间：列表里的截止日期是圆角胶囊，下一天写成 `Tomorrow` / `明天`（Due date 菜单里已有的这个词，`T.snooze.tomorrow`），今天仍是 `Today` / `今天`，其余是日期；鼠标停在上面的提示仍写日期和还有几天（`Nov 6 · in 1 day`）。看板卡片底部的 `Created Nov 5` 是已有的写法，没有改。行尾和卡片右下角的“打开事项”图标去掉了（主人：现在可以右键打开），“打开事项”这个词只剩右键菜单里的那一项，是已有的词。

## 信息收集器的全选（2026-11-05，英文待主人审）

主人说“增加一个全选吧”，又选了把它放进勾选后出现的底部栏（`已选 N 条 ×` 之后）：按钮的字、窄时图标的提示和读屏名都是 `全选`（主人自己的词）；英文写 `Select all`（我写的，待审）。页签行上没有方框，也没有别的新字。

## 2026-11-06 连接器页重画：界面稿里的字（页面已做好，字待主人审）

主人给了 Claude 和 Muse 的连接器页，要照着做：目录自带、每项有图标、点“连接”就连上（`docs/assistant.md` 3.1，图在 `.local/connector-ui-nov06/out4/`）。前两版的字作废。沿用的已审的字：搜索、名称、保存、取消、撤销、重试、需要授权、还有收集器在用它。新增的如下，中文照图；词出自 Claude 或 Muse 的在备注里写明，其余是我写的。英文先只写按钮和状态，一句话说明的英文等中文定了再写。

| 在哪里 | English | 中文 | 备注 |
| --- | --- | --- | --- |
| 页头右边的按钮 | Add custom connector | 添加自定义连接器 | Claude 的词 |
| 两个视图 | Available · Connected | 可用 · 已连接 | Muse 的词；已连接后面跟个数 |
| 目录里每行的按钮 | Connect | 连接 | Claude 的词 |
| 打开一个以后的红字 | Disconnect | 断开 | Muse、Claude 都是这个词 |
| 授权掉了或要重新授权的按钮 | Authorize | 授权 | |
| 打开一个以后的两行名 | Address · Tools | 地址 · 工具 | |
| 分组标题 | This computer · Work · Projects · Development · Web | 这台电脑 · 办公 · 项目 · 开发 · 网页 | “项目”“网页”是主人 2026-11-06 点头的那份清单里的组名；“这台电脑”对应 Muse 的“你的设备” |
| 灰字里的数量和命令 | {n} tools · Command line · {command} | {n} 个工具 · 命令行 · {命令} | |
| 一行的状态 | Waiting for the browser… · Connection timed out · Needs sign-in · Not installed | 等待浏览器… · 连接超时 · 需要登录 · 没装 | 别的出错原因照服务或系统说的话显示，不翻译 |
| 命令行出问题时灰字换成 | Run {command} in a terminal, then retry · Not found: {command}. Install: {line} | 在终端运行 {命令}，再点重试 · 没找到 {命令}：{安装命令} | |
| 授权完成时浏览器里那一页 | {name} connected. You can go back to Dudu. | 已连接 {名称}。可以回到嘟嘟了。 | |
| 授权没成时浏览器里那一页 | Could not connect {name}. Go back to Dudu and select Authorize again. | 没有连上 {名称}。回到嘟嘟，再点一次“授权”。 | |
| 添加自定义连接器那一页：框里的灰字 | Paste an address or command, or write a sentence on how to read it | 粘贴地址或命令，或者写一句话说怎么读 | |
| 框下一行小字（认成了什么） | Remote · Sign in in the browser · Remote · No sign-in · Remote · Needs a token · Local · One command · Command line · This sentence | 远程 · 在浏览器里授权 · 远程 · 不用登录 · 远程 · 需要令牌 · 本地 · 一条命令 · 命令行 · 就是这句话 | 先去问服务时写“正在查看…”（Checking…） |
| 按服务说的多出来的栏和链接 | Token · Add environment variable | 令牌 · 添加环境变量 | 主人看过图并说“就这样”，字仍请逐条确认 |
| 打开一个：标题前返回箭头的读屏名 | Back | 返回 | 任务单里给的词，表里原来没有 |
| 灰字里的本机命令 | This computer · {command} | 本机 · {命令} | 草图里 Pencil 那一行就是这么写的；英文是我写的 |
| 灰字里只有一个工具时（只有英文不同） | 1 tool | （中文不变，仍是 {n} 个工具） | 英文是我写的 |
| 打开一个：“工具”那一行的值 | {n} | {n} 个 | 草图里是“14 个”；英文只写数字，是我写的 |
| 空的时候：可用里一个也没有、还没连上、搜索没找到 | No connectors | 没有连接器 | 沿用已有的字，没有新写 |
| 添加自定义连接器：框里认出好几个服务时，写在小字里代替“一条命令” | {n} connectors | {n} 个连接器 | NEW（我写的，待审）：粘贴的文件里有几个服务，名称那一栏就不要，保存一次全加上 |
| 添加环境变量后出来的两个框（读屏名和灰字） | Variable name · Value | 变量名 · 值 | NEW（我写的，待审）；删掉这一行的叉用已有的“删除”（Remove） |

目录里每项的一句话（中文，我写的，英文待定）：飞书：消息、日程和文档；Google 日历：日程；Google 云端硬盘：文件、文档和表格；Notion：页面、数据库和评论；Airtable：表格和数据库；Canva：设计；Linear：事项和项目；Atlassian：Jira 和 Confluence；GitHub：仓库、议题和拉取请求；GitLab：仓库、议题和合并请求；Sentry：报错和告警；Supabase：数据库和项目；Vercel：项目和部署；浏览器：用你已经登录好的浏览器打开网页。服务的名字用它们自己的写法，不翻译。

## 新建事项里粘贴图片（2026-11-06，没有新词，有一处待主人定）

粘贴的图片用评论框已有的缩略图和移除按钮（读屏名 `Remove 文件名` / `移除 文件名`）。事项建好后上传图片失败时，右下角提示借用了已有的 `Could not save the change` / `更改没能保存`；对“图片没传上”来说不太准，要不要单独写一句（比如“图片没能附上”），请主人定。

## 额度小组件改成一张表（2026-11-06，三处新词待主人审）

主人选了 C3：列是智能体，行是 5 小时 / 每周（已有的词），DeepSeek 余额是合并的一列（`余额` / `Balance` 已有）。新词只有三处：表左上角 `剩余` / `Left`；读屏对每个格子说的 `Claude 5 小时：剩余 26%` / `Claude 5-hour: 26% left`；悬停里每个窗口一行的 `5 小时 剩余 26%` / `5-hour 26% left`（原来是“已用”）。条下面的 `13:00 重置`、用完时的 `Limit reached, resets 13:00` 沿用已有的写法。原来的“已用 N%”在这个小组件里不再出现。

（2026-11-11：额度卡片换成顶部弹层的块之后，这一节里只有旧表用的两个词——表左上角的 `剩余` / `Left` 和读屏对每个格子说的那句——以及旧的 `登录后查看用量` 不再出现在界面里；`5 小时 剩余 26%` 那一行现在是块里每个窗口右边的“剩余 26%”。没有新词。）

## 2026-11-07 手机：看板首页、信息收集器、设置里的嘟嘟设置；收集器的“已处理”“删除”和来源小图（主人说“这一版整体设计我觉得很不错，就按这版实现吧”）

手机页面里的字全是桌面端已有的（看板、进行中 / 待规划 / 全部事项、需要你 / 工作中 / 空闲 / 未分配、信息收集器、待处理 / 已处理 / 已忽略、已选 N 条、全选、取消选择、分享到事项、分享到会话、新建事项、创建事项、事项标题、添加描述…、取消、打开来源、打开事项、忽略、恢复、撤销、上下文、更多、搜索事项…、没有事项、事项没能加载、没有信息、信息没能加载、重试、更改没能保存、事项没能创建、上一条事项 / 下一条事项、设置里嘟嘟七页的名字）。新的只有下面几处：

| 地方 | 字 | 说明 |
|---|---|---|
| 收集器的按钮、右键菜单、批量栏（桌面和手机） | `已处理`、`删除` | 主人的原话（“收集器增加删除和已处理按钮”）。英文 `Handled`、`Delete` 是我写的，待审 |
| 删除后的提示（桌面和手机） | `已删除` / `Deleted` | 新写的，照“已忽略”；已处理后的提示用主人的“已处理” / `Handled` |
| 手机设置里嘟嘟那张卡的最后一行 | `DSH 设置` | 主人的原话（“嘟嘟的设置增加一个条目叫 DSH 设置”）；进去是 DSH 原来的那张列表，不加小标题 |
| 手机信息收集器右上角那个只有图标的按钮的读屏名字 | `选择` | 新写的 |
| 手机侧栏“信息收集器”后面那个数字的读屏名字 | `N 条` | 新写的（数字是待处理的条数） |
| 手机记录详情里挂了事项的一行 | `已分享到 REF` / `已新建 REF` | 桌面详情里同一行的写法（`已分享到`、`已新建`） |

收集器每一行最左边多了来源的小图（桌面和手机；服务的 logo，没有 logo 的是收集器名字的第一个字母）：没有字。

## 2026-11-08 手机页面名称：信息（主人指定）

主人说“app 信息收集器改名叫信息吧”。手机侧栏入口及其页面标题统一使用 `信息`，
由 `host/native-navigation.mjs` 的同一个名称提供。设置中的 `收集器` 仍指收集规则。
同日主人对桌面截图指定“信息收集器改成信息”：桌面小组件、添加列表和读屏名称共享的中文标题也改为 `信息`。本次没有新增英文翻译。
桌面多选最初采用主人选定的 A 方案和图标 C（Lucide `ListTodo`），设计在 `.local/designs/collector-selection-2026-11-08/`。2026-11-09 主人要求去掉标题行的选择按钮，改成右键菜单里的入口：菜单使用已批准的 `选择` / `Select`，已选行用已有的 `取消选择` / `Clear selection` 取消当前行，图标沿用 `ListTodo`。平时不留复选框和空位，选中第一条后才显示，取消最后一条后收起。不新增界面文字。
主人选择图标方案 C：手机“信息”入口使用 Lucide `Rss`，手机“看板”入口使用
Lucide `ListTodo`。复用原有导航图标的尺寸、颜色、线宽和圆角笔触，由插件提供几何数据。

## 2026-11-08 手机侧栏：对齐版 A（主人批准）

主人先要求“名字就叫嘟嘟”“信息看板嘟嘟这三个”“默认隐藏的查看更多”，
看过 A 的对齐稿后说“那就用对齐版，另外信息和嘟嘟的位置换一个”。
固定入口依次为 `嘟嘟`、`看板`、`信息`，折叠入口用 `查看更多`。
这些文字均为主人指定或批准，入口读屏名字复用相同文字；没有新增说明或副标题。

## 2026-11-08 手机嘟嘟输入行为

复用桌面已有的 `上下文`、`没有事项`、`还没有技能`、`连接暂时不可用。`；
传话错误沿用 `@ 后面还要写要说的话。`、`先选择智能体。`、
`先选项目，再把工作交给智能体。`、`只能 @ 当前事项的处理者。`、
`留言已保存，请求没能送达。`、`先写点内容。`，
其他失败沿用桌面的组合句 `回复没能发给会话：连接暂时不可用。`。
成功回执同桌面是 `✓ @编号 · 标题`，编号、标题和候选里的项目名、技能描述均是内容。
没有新增说明或副标题；文件错误复用手机原来的提示。

## 2026-11-08 手机嘟嘟设置改为原生、模型按来源分组

七个栏目名称、字段、菜单选项、连接器识别结果、确认框和错误均沿用原设置的原文；
顶栏使用已有的 `取消`、`保存`、`创建`，删除、断开和授权各显示一个动作。
自定义连接器的粘贴框、名称、令牌、环境变量及识别状态复用原连接器网页的相同文字，
不另加说明。模型的来源名称和同名来源的 ID 是实际配置数据，不编造账号或 API 的别名。
设置首页不新增 WebView 加载提示。

## 2026-11-08 手机新建事项的参数

字段、选项、选择页标题、失败提示与读屏名称复用桌面和 App 现有文字：
状态、优先级、项目、智能体、标签、未分配、无项目、五种优先级、六种默认状态、
新建项目、项目名称、项目文件夹、文件夹不存在时创建、选择项目、
修改或添加标签…、新建标签：“x”、选择标签颜色及九种颜色名、
截止日期、明天、本周结束、一周后、移除截止日期、父事项、设置父事项…、移除父事项、
搜索事项…、没有找到事项、更多、保存、取消、重试，以及原有创建和读取失败提示。
不增加副标题或帮助段落。自定义状态、项目、标签、事项标题和目录是实际数据。
这里没有新增措辞，也不改变上述桌面文案原有的待审记录。

## 智能体空闲状态名称（2026-11-09，主人原话）

主人指定把中文状态名「空闲」改为「空闲中」，与「工作中」对齐。桌面看板、事项、Office、头像提示和 iPhone 看板、头像读屏共用这个名称；英文仍为 Idle，协议值仍为 idle，不改变状态判断与分组。

2026-11-09 飞书连接器的读法加了一句（主人看过原文并同意："改。"）：「找 @ 我的消息用 `im +messages-search --is-at-me`，老话题下面的新回复只有它能找到。」原因：采集会话每满 24 轮换新，新会话自己想读法，只按聊天逐个拉近 7 天的消息就看不到老话题里的新回复（Steven Yanni 在 Project Channel 的一个 10 月 27 日的话题里 @ 主人的 22:59 那条因此漏掉）。这句写在随插件带的目录里（`catalog-data.mjs`）和主人自己的 `CONNECTORS.md` 里。

## 定时任务补充文案（2026-11-10，待审）

主人确认了定时任务弹窗设计与入口位置。设计中已有的标题、字段、按钮和“已更新任务”“已暂停任务”回执照稿实现。其余补充词的逐字中英文清单放在 [scheduled-tasks.md 的文案一节](scheduled-tasks.md#文案)：其他执行位置、其他频率选择、投递中/失败/不确定状态及创建/恢复/复制/删除回执。它们在 `ui/strings.js` 标为 `NEW`，尚未发布；通用空态、取消、失败等复用原有文案。英文任务文案尚未单独审核。

## 嘟嘟的快捷项和卡片（2026-11-10，新词主人已审）

输入框上方三个按钮和它们发出的三张卡片，桌面和手机共用同一批字：

| 位置 | 中文 | 来源 |
| --- | --- | --- |
| 按钮和卡片标题 | 待办 | 现有的字；它列的是需要你的事项（看板“需要你”那一组），不是状态 Todo（主人 2026-11-10：“待办应该就是需要我这一栏的东西”），字不变 |
| 按钮和卡片标题 | 信息 | 手机侧栏、桌面小组件里收集器的现有名称 |
| 按钮和卡片标题 | ~~定时任务~~ **任务**（2026-11-11 起，见文末） | 任务页的标题 |
| 待办卡片为空 | 没有事项 | 看板空着时的现有字 |
| 信息卡片为空 | 没有信息 | 信息页空着时的现有字 |
| 任务卡片为空 | ~~没有定时任务~~ **没有任务**（2026-11-11 起） | 新词，主人 2026-11-10 已审，照用（“要你审的新字就按你说的来”；句式照“没有连接器”“没有收集器”；英文 `No scheduled tasks`） |

卡片里的行不写新字：待办和信息的行是看板、信息页的原行；定时任务的行用定时任务页现有的规则写法（每天、每周 周一和周三、间隔 30分……）、`下次运行`、`已开启`、`已暂停`。没有新增副标题或说明。

另有一处不在界面上的字：命令 `/dudu-card` 的英文描述（`Show one of the quick lists of the chat as a card: todo, info or task`）会出现在 DSH 自己对话框的斜杠菜单里；它是内部命令，不是 App 文案，但会被看到，是否改写或隐藏请主人定。

## 手机上的定时任务页（2026-11-10，新词主人已审）

主人看过设计图（`.local/designs/phone-tasks-2026-11-10/`）后选了侧栏 B、列表 B，并要求手机上能新建和编辑。页面、详情和编辑器的字都用桌面定时任务页已有的：定时任务、全部、已开启、已暂停、已结束、下次运行、每天 / 周一至周五 / 每周 / 每月 / 间隔 / 仅一次 / Cron、周一到周日、暂停任务、恢复任务、立即执行、复制任务、删除任务、规则、自动化任务名称、自动化任务内容、任务运行记录、加载更多、关联会话、运行时间、时区、执行位置（新建对话并复用 / 每次新建对话 / 已有会话）、关联工作区、供应商、模型、默认模型、有未保存的修改、放弃、保存修改，以及回执“已创建任务”“已更新任务”“已暂停任务”“已恢复任务”“已复制任务”“已删除任务”“正在投递”（桌面的投递状态词，那几个在桌面还没审）。手机原有的字：新建任务的标题用“新建任务”，编辑用“编辑”，“取消”“保存”“撤销”“重试”“更改没能保存”“已投递 / 投递失败 / 待确认”同桌面。

新字，主人 2026-11-10 已审，照下面写的用（“要你审的新字就按你说的来”）：

| 位置 | 中文 | 说明 |
| --- | --- | --- |
| 页面和卡片空着 | ~~没有定时任务~~ **没有任务**（2026-11-11 起） | 句式照“没有事项”“没有信息”；原来的旧页写“暂无定时任务”，新页不再用 |
| 页面或编辑器没读出来 | **任务没能加载** | 句式照“事项没能加载”“信息没能加载” |
| 选关联工作区时没有任何工作区 | **没有可用的工作区**；选已有会话时没有会话：**没有可用的会话** | 一行灰字 |


## 嘟嘟的群聊（2026-11-10，新词主人已按设计稿确认）

主人看过设计图（`.local/designs/group-chat-2026-11-10/`）后说“你就按这一版实现吧”，图上的字就是下面这些；桌面和手机用同一套。其余的字都是已有的：待办、信息、定时任务、打开会话、今天、没有事项、已投递（“已投递”在勾的无障碍名称里）。事项的编号、标题和智能体的名字是内容，不是界面的字。

| 位置 | 中文 | 说明 |
| --- | --- | --- |
| 消息的菜单（手机长按、桌面右键）；待办行展开后的按钮（桌面是只有图标的按钮，鼠标停上去显示这个字） | **回复** | 把这条消息所属事项的 `@编号 ` 填进输入框 |
| 消息的菜单 | **复制** | 复制这条消息的文字（事项的回复、主人的 @ 行、嘟嘟的话） |
| 消息的菜单 | **删除** | 红色；只是不再显示这一条（会话记录和嘟嘟的记忆都还在） |
| 待办行里最新消息是主人说的 | **你：**（英文 `You: `） | 加在那条消息前面，如“你：看一下 PLAN-4129 的结果” |
| 回复之后输入框里 `@编号 ` 后面的灰字 | 事项的标题 | 内容，不是新词；写第一个字就消失 |

英文是我写的（`Reply`、`Copy`、`Delete`、`You: `），中文照设计稿。没有新的无障碍标签：头像按钮的名字是事项编号，展开的行用 `aria-expanded`。

## 嘟嘟自己做的定时任务（2026-11-11，新词待主人审）

主人选了设计稿的 A（“选 A，这样改动最小”）：表单还是原来的行和字，「供应商」列表里多一项 **嘟嘟**（产品名，用它自己的图标；英文照 `T.brand`）。选了嘟嘟，没有“关联工作区”这一行，“执行位置”只有两个选项；字都是已有的。**每次新建对话**是之前列出、还没审的字（见 [scheduled-tasks.md 的文案一节](scheduled-tasks.md#文案)），现在是选嘟嘟时的默认。

| 位置 | 中文 | 英文 | 说明 |
| --- | --- | --- | --- |
| 聊天里嘟嘟做的任务失败的一行（桌面、手机） | **运行失败** | Run failed | 新词；后面接原因（系统给的话，可能是英文）。成功的一行没有新字：时钟图标、任务名和时间，再是结果 |

`ui/strings.js` 的 `tasks.runFailed` 标了 `NEW`；手机用同一个字。

## 「定时任务」改叫「任务」（2026-11-11，主人说的字）

主人：“定时任务改成任务吧，app 和 desktop 都改”。这是主人给的字，不需要再审。改了的地方：

| 位置 | 原来 | 现在 | 英文（我写的，没有单独审） |
| --- | --- | --- | --- |
| 桌面：任务窗口的标题、右上角的按钮、嘟嘟聊天输入框上面的快捷项 | 定时任务 | **任务** | Scheduled tasks → **Tasks** |
| 手机：侧栏的第四行（插件发的 `dudu.tasks` 标题）、页面的标题、输入框上面的快捷项 | 定时任务 | **任务** | — |
| 空的任务卡片、手机任务页空着 | 没有定时任务 | **没有任务** | No scheduled tasks → **No tasks** |

窗口里的其他字不变（新建任务、任务运行记录、自动化任务名称/内容 等）。`ui/strings.js` 的 `tasks.title`、`pet.noTasks`，手机的 `QuickCardKind.title`、`DSBotRootView` 的页面标题和 `TasksView` 的空态。文档里更早的“定时任务”是当时的说法，不改。

## 收集信息里的“补全上下文”（2026-11-11，主人说的字）

主人：“收集信息的地方能不能增加一个快捷按钮？让我点击一下，就让收集信息对应的会话去继续补全这一条信息的上下文”。按钮的字取主人自己的说法：

| 位置 | 中文 | 英文（我写的，没有单独审） |
| --- | --- | --- |
| 桌面：行上鼠标停着时的快捷按钮（只有图标，字是它的无障碍名称和提示）、记录弹窗的按钮、右键菜单里的一项；手机：记录页底栏按钮的无障碍名称、行的长按菜单和记录页“更多”菜单里的一项 | **补全上下文** | Fill in context |

没有别的新字：运行中按钮上是转圈，不写字；失败时显示插件自己给的英文原因（桌面是提示条，手机记录页打开着时写在记录页里），没有原因时用原有的“更改没能保存”。`ui/strings.js` 的 `collector.complete`。

## 收集信息里的编号（2026-11-11，主人选的）

主人：“设计一个 id 吧，不然我都不知道哪个是哪个”，在三种放法里选了 A（`.local/designs/record-id-2026-11-11/ids.png`）。编号就是记录的 `ref`：`r` 加数字，如 `r143`，画在图里的样子主人看过；不是新写的字。位置：行的第二行最前面（桌面的行和嘟嘟聊天里的信息卡、手机的行；手机聊天里留着的旧信息卡用的是同一行），记录弹窗和手机记录页的小字行最前面。

## 额度的弹层里的“更新于”（2026-11-11，等主人审）

主人（2026-11-11）把额度从小组件改成仪表盘右上角的图标，点开一个弹层（设计 `.local/designs/quota-icon-2026-11-11/`，主人选了 B 一家一块）。弹层顶上要写读数的时间，因为读数最多 15 分钟才更新一次，读失败时留着上一次的：

| 位置 | 中文 | 英文（我写的，没有单独审） |
| --- | --- | --- |
| 桌面弹层右上角、手机面板右上角：这些读数是什么时候读到的（今天写时间，更早写星期加时间，和“重置”的时间同一种写法） | **更新于 15:12** | Updated 15:12 |

另一处新字（2026-11-11，主人看了 magpie 的账号行后选了写在套餐后面）：

| 位置 | 中文 | 英文（我写的，没有单独审） |
| --- | --- | --- |
| 桌面弹层和手机面板里 ChatGPT 那一块，跟在套餐名后面：这个套餐付费到哪一天（月日按界面语言，悬停是完整时间） | **有效期至11月24日** | Until Nov 24 |

字是 magpie 的，来自主人贴的截图；`ui/strings.js` 的 `widgets.quota.until`，手机在 `Core/Quota.swift` 的 `planLine`。

没有别的新字：图标的提示和读屏名是原有的“额度”；块里的字是原来额度小组件的（剩余、5 小时、每周、重置、已达上限，… 重置、余额）。DeepSeek 的两块在套餐位写的 `Account` 和 `API` 是 host 给的英文套餐名（和 Max、Plus 一样），不是界面词；这一条也请主人看一眼。`ui/strings.js` 的 `widgets.quota.updated`。删掉的额度小组件的字（`widgets.descriptions.quota`、`widgets.needs.quota` 的说明）已不显示。

## 任务窗口左边一栏（2026-11-11，没有新字）

主人：“这里为什么都有大片的空白？能不能重新设计一下，正常一点”，画了三个，说“按你说的改吧”（A，设计在 `.local/designs/tasks-list-2026-11-11/`）。用的字都是窗口原有的：已开启、已暂停、已结束、全部、搜索任务、下次运行、规则的写法（每天、间隔 10 分……）。变的只有：四个标签后面多了各自的任务数（数字）；“N 个任务”那一行去掉了（`ui/strings.js` 的 `tasks.count` 删了）；行里不再写提供方的名字，改成图标的悬停提示和读屏名（图标本来就是它）。

## 长回复的小药丸（2026-11-11，两个新字）

手机和桌面右下角嘟嘟对话里，长回复折成前几行，中间一颗小药丸；展开后末尾一颗。主人给了飞书截图（上面的字是“展开”）说“用图片里面这个样式吧”“右下角的嘟嘟对话也同步一下样式”。

| 位置 | 中文 | 英文（我写的，没有单独审） |
| --- | --- | --- |
| 折起来的长回复，盖在渐隐处 | **展开**（主人截图上的字） | Expand |
| 展开以后，回复的末尾 | **收起**（和“展开”成对，等主人审） | Collapse |

`ui/strings.js` 的 `pet.expand`、`pet.collapse`；手机是 `GroupChatViews.swift` 里的 `FoldCapsule`（读屏名就是字本身）。去掉的东西没有字：原来的小箭头、@ 那一行下面的勾（读屏名“已投递”）和发出时手机上的“✓ @编号 · 标题”提示。

## 目录里的“ego”（2026-11-11，主人说的字）

主人：“浏览器连接器这个直接改成叫 ego 连接器吧”。目录「网页」组里原来叫“浏览器”的那一项，名字现在是 **ego**（主人给的字）。一句话没改（“用你已经登录好的浏览器打开网页”）。没装 ego lite 的人在那一行看到的是原有的格式：“没找到 ego-browser：https://lite.ego.app/”（地址是它的下载页，不是新写的字）。Google 日历和 Google 云端硬盘两项现在会检查登录，没登录时用原有的说法：“需要登录”，灰字“在终端运行 gws auth login，再点重试”。

## 去掉的“撤销”（2026-11-12，主人的话）

主人看到连接器页的“已删除 ego · 撤销”和记忆“整理记录”里每一行的“撤销”后说：“我发现在我不知道的地方有大量的冗余且没用的撤销操作……除了 dashboard 里面的撤销我觉得有一点用，其他的我觉得都可以清理掉。”又说：“现在删除有提示吗，就是确认删除，有提示你就直接把撤销操作都清理了就行了，手机和 desktop 都清理”，对没有确认的三处答：连接器断开和收集器删除“加”（确认），信息里删记录“不加确认去掉撤销”。

**已去掉**（桌面和手机）：看板和事项详情里每次改动后的“撤销”（提示条还在，不带按钮）、“撤销整理”（事项整理）、记忆整理记录每一行的“撤销”、信息里忽略、恢复、已处理、删除后的“撤销”、手机任务暂停和恢复后的“撤销”、连接器断开和收集器删除后的“已删除 X · 撤销”条（桌面；手机的提示条留着，不带“撤销”）、嘟嘟的 `issues_undo` 工具、默认规则里的“能撤销的都能撤销”。**留着的**：仪表盘的“撤销”（主人要留）；“撤销配对”不是撤销，是撤销一台手机的连接。

**新加的确认**（没有新字，用的是忘记一条记忆那套）：桌面连接器页“断开”和收集器页的垃圾桶，点了先出一个小窗：标题“将要删除”，下面是名字，按钮“取消”和“删除”（`ConfirmDelete.jsx`，字在 `strings.js` 的 `settings.confirmDelete`；英文照忘记记忆的：This will be deleted / Cancel / Delete）。手机连接器页的“断开”也一样：确认的标题“将要删除”、名字、按钮“删除”（手机收集器的左滑删除本来就有）。信息里的删除不加确认。

文字：`strings.js` 里相应的 `undoTidy`、记忆的 `undo`、连接器和收集器的 `removed`、`undo`、`toast.undo` 都已删；`toast.undo` 不再有人用。

## 手机设置里的隐私政策、关于、版本信息（2026-11-12，主人的话）

主人：“隐私策略，关于，版本信息都放设置里面吧。”手机设置首页末尾多一张卡片，三行，按主人说的次序：

| 位置 | 字 | 来源 |
| --- | --- | --- |
| 第一行，点开在浏览器里打开隐私政策页 | **隐私政策** | 主人写的是“隐私策略”；我按 App Store 和通行的用法写成“隐私政策”，主人 2026-11-12 确认（“按你推荐的来”） |
| 第二行，点进一页 | **关于** | 主人的原话 |
| 第三行，右边是版本号和构建号，不能点 | **版本信息** | 主人的原话；右边的 `0.3.0 (97)` 是数字，不是字 |
| “关于”那一页的名字下面的小字 | 基于 DSH 的多 Agent 高效协作助手 | 主人定的产品一句话（README、插件的 package.json 和 GitHub About 用的就是它），第一次放进 App，主人 2026-11-12 确认；同一天主人把句中的“Issue”改成了“DSH”；页上还有标志和名字“Dudu” |

没有别的新字：关于页的标题是“关于”，返回键的读屏名“返回”是原有的。手机在配对前进不了设置，所以未配对时看不到这些字；要不要在配对那一页另放一个“隐私政策”，取决于审核员怎么用 App（见 [app-store.md](app-store.md)）。字在 `Views/SettingsView.swift` 的 `aboutCard`、`Views/AboutView.swift`，版本号和地址在 `Core/AppInfo.swift`。
