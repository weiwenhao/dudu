# Issues 界面：待主人审的用词

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

## 我替你定的小事（可以推翻）

- project 的颜色：按 project 名字算一个固定的颜色，同名永远同色。文档写"按顺序分配"，那要在服务端存一份对应表，等设置文件做时再改。
- 每个页签的筛选和显示选项先存在这台电脑的浏览器里（文档说存在 `settings.json`，等设置接口做时搬过去）。
- Board 的列按流程排（Todo、In Progress、In Review），列表分组按"在做的在前"；Board 的"Rows"是把每一列分成几段，不是横向泳道。
- 快捷键：鼠标放在一行上按 S 改状态，按 F 打开筛选；输入框里、按了 ⌘/Ctrl/Alt 时不触发。
- 详情页的评论按 ⌘/Ctrl + Enter 发送；标题按 Enter 保存、Esc 取消。

## 还没做（设计稿没有画，或要先定）

- **New issue 的窗口**：设计稿只画了按钮；窗口是我做的最小版本（上表），样子和字都等你定；建的时候不能选 project、智能体、优先级、截止，要在 issue 自己的页面里改。
- 选中几行后批量改状态的操作栏（文档说"实现时照 Linear"，没有画）。
- 筛选里的 **Dates**（Due date、Created、Updated）：设计稿只列了名字，没有选项。
- All issues 的搜索框和页脚的总数（文档里有，设计稿的图里没有）。
- Board 列头的"···"和"+"，详情页右上角的复制链接、打开会话、推迟，智能体那一格的"回复"。
- 仪表盘（可拖动的小组件版面）、Office、Quota：现在打开嘟嘟，Issues 直接占满页面。
- 原来的"嘟嘟"页（读取 Claude、Codex 已有的会话、加载进 DSH）：装了新界面之后打开嘟嘟看不到它，代码还在，没装新界面（没构建）时仍是它。设计里它是 Sessions 小组件，等做小组件时放回去。
