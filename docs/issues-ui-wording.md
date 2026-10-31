# 嘟嘟桌面界面：待主人审的用词（Issues、仪表盘、小组件）

2026-10-31 照定稿的设计稿（画布 v38）做了 Issues 的界面。界面上固定的字都是英文，所有字都在一个文件里：`host/dudu-plugin/ui/strings.js`（带 `NEW` 注释的是设计稿里没有的）。**审过之前不安装到主人的桌面版**（`npm run desktop:update` 没跑过）。

## 设计稿里已有的字（不用再审，列在这里对照）

Issues · Active / Backlog / All issues · Backlog / Todo / In Progress / In Review / Done / Canceled · No priority / Urgent / High / Medium / Low · Priority: High（读屏） · Add Filter… · Filter… · Filter · Status / Agent / Agent state / Priority / Project / Source · Working / Needs you / Stuck / Idle · is any of · Clear · Change status… · No agent · Today · Display options · List / Board · Grouping / Sub-grouping / Ordering / Columns / Rows · No grouping · Order completed by recency · Completed issues · All · List options / Show empty groups · Board options / Show empty columns · Display properties（ID、Status、Agent、Priority、Project、Due date、Source、Created、Updated） · Reset · Properties · Project · Activity · Leave a comment… · Needs you

## 新增的字（设计稿里没有，要你审）

| 位置 | 现在的写法 |
|---|---|
| 列表为空 | No issues |
| 读取失败 | Could not load issues · Retry |
| 没有 project 的 issue（分组名、筛选） | No project |
| 日期上放鼠标的提示（文档要求"日期和还剩几天"） | `Oct 30 · 1 day overdue`、`Nov 4 · in 4 days` |
| 筛选胶囊，只选了一项时 | `Status is Todo`（选了多项仍是 `is any of`） |
| 去掉筛选的叉（读屏） | Remove filter: Status |
| 折叠、展开分组的三角（读屏） | Collapse In Progress · Expand In Progress |
| Source 的四个值（库里只有这四个；文档写的是 Feishu、Email、You、嘟嘟、Session） | You · 嘟嘟 · Connector · Session |
| Completed issues 的选项（文档只写了"最近一天、一周、一个月，或不显示"） | Past day · Past week · Past month · None |
| 显示选项里反转顺序的小按钮（读屏） | Reverse Grouping · Reverse Ordering |
| issue 详情：回列表（读屏）、上一个、下一个（读屏）、位置 | Back to Issues · Previous issue · Next issue · `1 / 7` |
| 详情：标题和描述为空时 | Untitled · Add description… |
| 详情：没有截止日期、日历弹层、设优先级 | No due date · Due date · Clear · Set priority… |
| 详情：发送按钮（读屏）、较早的记录、找不到 | Send · Load earlier · This issue does not exist. |
| New issue 的窗口（设计稿只有标题行的按钮，窗口是我按最简单的做的：标题、描述、两个按钮；新 issue 在 Todo，没有 project 和智能体） | New issue · Issue title · Add description… · Cancel · Create issue · Could not create the issue |
| Activity 里的时间 | just now · 12 min ago · 2 h ago · Yesterday 17:40 · Oct 30 09:05 |
| Activity 里的句子（库里存的是类型和前后值，句子是界面拼的；设计稿里一条写了"换了智能体并换了状态"，我拆成一条一个变化） | You / 嘟嘟 / 智能体名 + `created the issue` · `created the issue from a message` · `created the issue from a session` · `changed status from Todo to In Progress` · `changed priority to Urgent` · `set the due date to Oct 30, 2026` · `removed the due date` · `assigned the issue to DeepSeek` · `removed the agent` · `asked` · `changed the session` · `commented` |
| 批量选择（勾几行后底部出来的条） | `Bulk actions`（读屏）· `3 selected` · `Clear selection` · `Select 标题`（每行的框，读屏）· 按钮 `Status` `Priority` `Agent` |
| 改完之后底部的一条（6 秒，带撤销） | `Marked as Done` · `Status set to In Progress` · `Priority set to High` · `Due date set` · `Due date removed` · `Assigned to Claude` · `Agent removed` · `Updated 3 issues` · `Copied DUDU-12` · `Snoozed` · `Snooze cleared` · `Could not save the change` · 按钮 `Undo` |
| 筛选里的 Dates | `Dates` · `Due date` / `Created` / `Updated` · `Overdue` · `Today` · `Next 7 days` · `Next 30 days` · `Past day` · `Past week` · `Past month` |
| All issues 的搜索和页脚 | 搜索框 `Search issues…`（读屏 `Search issues`）· 页脚 `1 issue` / `1,234 issues` |
| 分组条和 Board 列头的按钮 | `Add issue to In Progress`（＋，读屏）· `In Progress options`（···，读屏）· `Collapse column` · `Expand column: In Progress` |
| 详情页标题右边的按钮和菜单 | `Copy ID` · `Open session`（没有会话时是 `Open source`）· `Snooze` · `Later today` · `Tomorrow` · `Next week` · `Clear snooze` · `Snoozed until Nov 2, 09:00` |
| 详情页的智能体菜单、回复和结果 | `Set agent…` · `A new session starts with the log of this issue as its first message. The old session is closed.` · `Reply…` · `Send reply`（读屏）· `Add a result…` · `Save` · `Skip` |

## 仪表盘和小组件的新字（设计稿里没有，要你审）

设计稿里已有的字：`Edit layout`、`Add widget`、`Restore default`、`Done`、8 个小组件的名字、`Minimum size`、`Maximum size`，撤销条的三个例子（`Removed`、`Moved`、`resized to 5×2`）。

| 位置 | 现在的写法 |
|---|---|
| 编辑条上的一句提示 | `Drag a widget to move it, pull an edge to resize it.` |
| 图标按钮（读屏） | `Edit layout` · `Settings` · `Remove Quota`（卡片左上角的"−"） |
| Add widget 的列表 | 标题 `Add widget` · 每项的按钮 `Add`、已在版面上的写 `Added` · 全加完时 `Every widget is on the dashboard.` · 别的插件带来的小组件写 `From @acme/xxx` |
| 8 个小组件的一句话（添加列表里，写在 `host/assistant/dashboard/widgets.mjs`） | Issues：`Every issue, as a list or a board.` · Overview：`Overdue, due this week and in progress.` · Upcoming：`Issues with a due date, soonest first.` · Stuck：`Issues that are stuck or waiting on someone.` · Inputs：`Whether each connector works and what it read today.` · Quota：`Subscription usage, one line per agent.` · Sessions：`Search and open sessions.` · Office：`A 3D office: each active issue is someone at a desk.` |
| 改版面后底部的撤销条（字由插件拼，`host/assistant/dashboard/index.mjs`） | `Removed “Quota”` · `Moved “Overview”` · `“Overview” resized to 5×2`（这三条是设计稿的例子，引号我用了英文的 “ ”，设计稿写的是「」）· 新增的：`Added “Quota”` · `Restored default` · `Changed layout`（一次动了好几个）· `“Issues” resized to full width × 4` · 按钮 `Undo` |
| 拖边角时指针旁的小标签 | `4×2` · `4×2 · Minimum size` · `4×2 · Maximum size` |
| 用键盘改版面时读屏念的 | `Overview: column 3, row 2` · `Overview: 4 by 2` |
| 小组件出错、版面读不出来 | `This widget could not be shown` · `From @acme/xxx` · `This widget comes from @acme/xxx, which is not installed.` · `Could not load the dashboard` · `Retry` · `Could not save the layout` |
| Overview | `Overdue` · `Due this week` · `In progress` |
| Upcoming、Stuck 为空 | `Nothing is due` · `Nothing is stuck` |
| Quota | `No usage to show` · 读不到的写 `—`（不写 0%）· 窗口名 `5-hour`、`Weekly`、`3-day`（插件给的是中文 5 小时、每周，界面里换成英文）· 悬停条 `Claude · Max`、`5-hour 74% used · resets 13:00` · 读屏 `Claude 74% used`、`ChatGPT: Limit reached, resets 15:00` · 2×2 里 `Resets 13:00` · 需要登录的 `Sign in to see usage` |
| Sessions | 搜索框 `Search sessions` · `No sessions` · `Could not read sessions` · 点开时 `Opening…` · 智能体名 `Claude`、`ChatGPT` |
| 校验小组件声明时的拒绝理由（以后写在设置页里，`widgets.mjs`） | `It has no id.` `It has no name.` `It has no minimum size.` `Its recommended size is smaller than its minimum size.` 等 10 句 |

## 设置窗口的新字（设计稿里没有，要你审）

窗口的外形照设计文档：左边分区，右边卡片，右上角“打开项目文件夹”。

| 位置 | 现在的写法 |
|---|---|
| 窗口 | 标题 `Settings`（设计文档写的是“嘟嘟设置”）· 分区 `General` `Connectors` `Rules` `Memory` `Widgets` `Skills` · 右上角 `Open project folder` |
| General | `Project folder` · `Default` · `Change…` · `Folder path` · `Move the files into it` · `Save` · `Cancel` · `Issues` · `Export issues` · `Could not export the issues` |
| 选的文件夹被拒绝时的理由（插件给，`host/assistant/project.mjs` 的 `REASONS`，共 14 句） | 例：`This folder is in a temporary location that the system can clear. Choose another folder.` · `This folder already has other files in it. Choose an empty folder, or one that 嘟嘟 created before.` |
| Connectors | `No connectors` · `Not tested` · `Tested 3 min ago · OK` / `· Failed` · `Turn on <名字>`（开关，读屏）· `Details of <名字>` · 来源 `You` / `嘟嘟` · 种类 `Command` / `MCP` / `DSH` · `Allowed operations` · `Read` / `Write` · `Test` · `Remove` · `Removed <名字>` · `Undo` · `Skipped entries` · `Line 13: <原因>` |
| 连接器库给的话（`host/assistant/connectors/text.mjs`，约 150 句；读不出的条目的原因和“添加了连接器”的记录行是你会看到的，其余是写给模型的） | 例：`The json block is not valid JSON (line 1, column 16).` · `Added connector "X" (id): … It is off until the owner turns it on.` |
| Rules | 文件名 `TRIAGE.md`、`ASSIGN.md` · `Open` · `Empty` · `Not found` |
| Memory | `Search memory` · `Nothing is remembered yet` · `Edit` · `Save` · `Cancel` · `Forget` · `This will be deleted` · `Delete` · `Since 2026-10-29` · `Superseded` · `Tidy runs` · `No tidy runs yet` · `Undo` · 预览里的 `3 conversation turns`、`entries`、`lines of the daily notes`、`skills`、`tidy notes`、`staged notes` |
| Widgets | `On the dashboard`（开关，读屏 `Put Quota on the dashboard`）· `Built in` · `Reads issues` |
| Skills | `No skills yet` · `Delete` · `Back to skills` |
| 项目文件夹里的七个文件（`host/assistant/templates.mjs`，中文，每一句都要你审） | `AGENTS.md`（规则）`SOUL.md`（口吻）`USER.md` `MEMORY.md` `CONNECTORS.md`（格式示例，不登记任何连接器）`TRIAGE.md`（影响、工作量、优先级和截止；表里的数字和“Urgent 现在只在你明确说很急时才用”是提议）`ASSIGN.md`（分配的顺序和访问方式，注释里有两个例子） |
| 整理（tidy）写进你文件里的字（`host/assistant/memory/tidy.mjs`） | `新建` `佐证` `细化` `取代` `技能` `待确认` `暂存` `记入` `修改` `撤销` `已撤销`，来源写成 `（来源 turn:12）` |

## 我替你定的小事（可以推翻）

- project 的颜色：按 project 名字算一个固定的颜色，同名永远同色。文档写"按顺序分配"，那要在服务端存一份对应表，等设置文件做时再改。
- 每个页签的筛选和显示选项先存在这台电脑的浏览器里（文档说存在 `settings.json`，等设置接口做时搬过去）。
- Board 的列按流程排（Todo、In Progress、In Review），列表分组按"在做的在前"；Board 的"Rows"是把每一列分成几段，不是横向泳道。
- 快捷键：鼠标放在一行上按 S 改状态，按 F 打开筛选；输入框里、按了 ⌘/Ctrl/Alt 时不触发。
- 详情页的评论按 ⌘/Ctrl + Enter 发送；标题按 Enter 保存、Esc 取消。
- 勾选：悬停时行首出现方框，勾了一行后每行都显示；点一行再按住 Shift 点另一行，勾中间的一整段；Esc 全部放开；批量改 Status、Priority、Agent，一次撤销全部撤回（Board 里不勾选）。
- Dates：三个字段各有几个现成的范围，一次只能选一个，没有件数；Overdue 是今天之前，Today、Next 7 days、Next 30 days 从今天算起，Past week 是往回 7 天。
- Board 列头的"···"里先只有 Collapse column（折成一条窄的竖条，点它展开）；"＋"在这一列的状态里新建；列表的分组条上的"＋"一样在这一组里新建。
- Snooze 的时间：Later today（今天 18:00，不到一小时就不给）、Tomorrow（明天 09:00）、Next week（下周一 09:00）；只用来把智能体的提问藏起来。
- 回复智能体的提问：写进日志（算一条决定），提问和 Needs you 标记随之消失；把回复交给智能体的会话，要等会话接上以后才有。
- 仪表盘：Issues 没被拉过时占满全部列，窗口宽了窄了它跟着；拉过一次就是具体的格数。格子是正方形，6 行一屏，列数跟着窗口宽度（至少 4 列），照设计稿的规则。新加的小组件放在第一个放得下的空位，放不下就放在最下面，版面滚到那里并闪一下；每种最多一个。
- 键盘：编辑版面时 Tab 到小组件，方向键移一格，Shift + 方向键改大小一格，Delete 移除；Esc 退出编辑。
- Overview 的"In progress"数的是智能体正在工作（Working）的；Stuck 只列智能体状态是 Stuck 的（库里没有"在等别人"这个状态）；Quota 不列没有订阅的智能体（DeepSeek），读不到的写 `—`；重置时间当天写时分，别的天写星期加时分。
- Sessions 小组件就是原来"嘟嘟"页的会话列表（搜索、点一下加载进 DSH 并打开）；原页上的用量和"在跑什么"拆给了 Quota 和以后的小组件。
- 在详情页把状态改成 Done 以后，活动里出现一行"Add a result…"，可以写一句结果，也可以 Skip。

## 还没做（设计稿没有画，或要先定）

- **New issue 的窗口**：设计稿只画了按钮；窗口是我做的最小版本（上表），样子和字都等你定；从分组条或 Board 列的"＋"打开时，新 issue 带那一组的状态、优先级、智能体或 project，窗口里不显示；建的时候不能选其他的，要在 issue 自己的页面里改。
- 详情页的"Open session"和换智能体：按钮和菜单做好了，真正开会话、换会话要等会话那一块（`docs/assistant.md` 3.3、3.4）接上；右上"···"里的"撤销这次整理"和"忘记"也是。
- Office、Inputs 两个小组件，宠物：还没有（Office 的场景在写，Inputs 要等连接器的读取接上）。设置里的“通用”还缺宠物和快捷键、模型、最近一次整理，“手机控制、供应商”仍在 DSH 自己的设置里。
- 原来的"嘟嘟"页（读取 Claude、Codex 已有的会话、加载进 DSH）：现在是 Sessions 小组件，不在默认版面上，要用时在"Add widget"里加；没构建新界面时仍显示旧页。
