# 嘟嘟桌面界面：用词

**状态（2026-10-31）：你让我按你的风格代审，已审。** 做法：设计稿（画布 v38，存档在 `.local/design-archive/`）里有的字，一律照设计稿；设计稿没有的，按你定的风格改：短、平、不解释，固定用词用英文，内容用中文。没有安装到桌面版。下面是结果，哪条不合意直接说，我改。

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

**设置窗口**：标题 `Settings`（设计文档写的是"嘟嘟设置"）· `General` `Connectors` `Rules` `Memory` `Widgets` `Skills` · `Open project folder` · General `Project folder` `Default` `Change…` `Folder path` `Move the files into it` `Save` `Cancel` `Issues` `Export issues` · Connectors `No connectors` `Not tested` `OK · 12m ago` `Failed · 3h ago` `Added by 嘟嘟`（只给嘟嘟添加的标）`Command` `MCP` `DSH extension` `Allowed operations` `Read` `Write` `Test` `Remove` `Removed 飞书` `Undo` `Skipped entries` `Line 13: …` · Rules `Open` `Empty` `Not found` · Memory `Search records` `Nothing is remembered yet` `Edit` `Forget` `This will be deleted` `Delete` `Since 2026-10-29` `Superseded` `Tidy runs` `No tidy runs yet`；一次整理写成一行 `3 entries updated, 1 skill added` · Widgets `On the dashboard` `Built in` `Reads issues` · Skills `No skills yet` `Delete` `Back to skills`。

## 中文文件（项目文件夹里，你会直接读和改）

- 七个模板（`host/assistant/templates.mjs`）按设计稿里你写的 `TRIAGE.md`、`ASSIGN.md` 示例收短：几行短话，去掉表格、"Urgent 现在只在你明确说很急时才用"和每个文件开头的说明。`AGENTS.md` 从三个小节 11 条收成 8 条。优先级怎么从影响和工作量算，放在代码里的默认，不在文件里。
- 整理（tidy）写进你文件里的字（`host/assistant/memory/tidy.mjs`）换成平常话：`新增` `又提到` `补充` `改成` `新增技能` `待确认` `暂存` `记下` `修改` `撤销` `已撤销`，来源写成 `（来源 turn:12）`。
- 连接器库的约 150 句（`host/assistant/connectors/text.mjs`）：你会看到的只有读不出的条目的原因和"添加了连接器"的记录行，都是技术话、已经够短；其余是写给模型的，不算界面。

## 我替你定的小事（可以推翻）

- project 的颜色按名字算一个固定色；每个页签的筛选和显示选项先存在浏览器里。
- Board 的列按流程排；快捷键 S 改状态、F 筛选（输入框里不触发）；评论 ⌘/Ctrl + Enter 发送；标题 Enter 保存、Esc 取消。
- 勾选：悬停出现方框，勾一行后每行都显示；Shift 勾一段；Esc 放开；批量改 Status、Priority、Agent，一次撤销全撤回。
- Dates：每个字段几个现成范围，一次选一个，没有件数；Overdue 是今天之前，Past week 是往回 7 天。
- Board 列头"···"里先只有 Collapse column；Snooze 三个时间：今天 18:00（不到一小时就不给）、明天 09:00、下周一 09:00；回复智能体写进日志，提问随之消失；改成 Done 后可以补一句结果，也可以跳过。
- 仪表盘：Issues 没被拉过时占满全部列并跟着窗口；键盘 Tab 到小组件，方向键移一格，Shift + 方向键改大小，Delete 移除；Esc 退出编辑。Overview 的 `In progress` 数智能体正在工作的；Quota 不列没有订阅的（DeepSeek），读不到的写 `—`。
- 设置里的模态窗口会盖住页面的撤销条，所以移除连接器的撤销是窗口里的一行。

## 还没做

- New issue 的窗口：设计稿只画了按钮，窗口是最小版（标题、描述、两个按钮；从分组条或 Board 列的"＋"打开时带那一组的值）。
- 详情页的"Open session"和换智能体：按钮和菜单做好了，接真正的会话要等分配那一块；右上"···"（撤销这次整理、忘记）也是。
- Office、宠物；设置里"通用"还缺宠物和快捷键、模型、最近一次整理；"手机控制、供应商"仍在 DSH 自己的设置里。
