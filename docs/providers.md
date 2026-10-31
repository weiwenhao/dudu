# 供应商：在 DSH 里使用电脑上的 Claude 和 ChatGPT

dudu 插件把电脑上已安装的 harness（第一版是 Claude Code 和 Codex）接进 DSH。新会话的聊天框上方会多一个供应商
下拉框，选 Claude 或 ChatGPT 后，这个会话由对应的 harness 运行，DSH 只负责显示。

关键点：会话是 harness 自己的真实会话。在终端里用 `claude --resume` 或 `codex resume` 就能接着聊。

## 怎么运行

```
DSH 的 loop ──一步一条助手消息──▶ harness 适配器（LLM adapter）
     │                                   │
     │ 每个工具调用 = 一次镜像工具调用      │ OAR：启动已安装的 claude / codex，
     ▼                                   ▼ 读它的协议，resume，列模型
镜像工具：只等待 harness 报告的结果      claude / codex 进程（用你的登录、设置、skills、MCP）
```

- **驱动层是 [OAR](https://github.com/botiverse/oar)**（`@botiverse/oar`，Apache-2.0）。DSH 官方的 subagent 包
  （`packages/experimental/subagent-oar`）用的也是它。启动 CLI、读协议、resume、找安装位置、列模型都由 OAR 做，
  这里不再手写。当前固定在 0.75.0，打包时只把 Claude 和 Codex 两个 runtime 打成一个 377 KB 的文件
  （`host/providers/oar-runtimes.mjs`），安装后的插件没有自己的依赖；包里的许可证在
  `dist/THIRD_PARTY_NOTICES.txt`。OAR 还没到 1.0，升级时改 `package.json` 里的版本，跑 `npm test`，再用真实的
  claude 和 codex 各跑一轮。
- **DSH 一侧是我们自己的**（`host/providers/`）：
  - `harness-bridge.mjs`：适配器。DSH 每请求一步，就回放 harness 的一条助手消息；harness 的工具调用变成镜像工具的调用。
    harness 的会话 id 记在助手消息的 `source.replayState` 里，DSH 重启后也能接着用。
  - `mirror-tools.mjs`：镜像工具，不做事，只等 harness 报告结果，让工具调用在 DSH 里显示成终端、diff、读文件、搜索等原生卡片。
  - `oar.mjs`：把 OAR 的记录流读成"步"（Claude 以 `message_stop` 为一步的结束，Codex 以每个工具调用为一步），以及启动、
    中断、关闭、模型列表、安装探测。
  - `drivers/claude.mjs`、`drivers/codex.mjs`：各 harness 的差别（工具名、访问模式怎么落实、环境变量）。
  - `index.mjs`：按安装情况注册路由 `claude`、`codex`；每个会话只在选中该路由时才有镜像工具；设置存在 `providers.json`。
- **界面**（`host/dudu-plugin/client.js`，只用 DSH 公开的客户端接口，没改任何 DSH 包）：供应商下拉框占用聊天框上方
  `conversation.hero.agentPreset` 这个槽（优先级 -1，把原来的模式按钮挪到子槽里继续显示）；模型菜单通过包装
  `modelDirectories.directoryFor` 返回的 store，只留下当前供应商的模型，DSH 自己的菜单、搜索、推理等级都没动。
  供应商的选择写进会话日志（`model/selection` 事件）。这部分是一个单独的 Cordis 插件，依赖的服务缺失时只是不出现，
  不会影响手机控制和设置页。设置里的"供应商"栏显示是否找到、版本、路径，可以启用/停用、指定可执行文件路径、重新检测。

## 终端接着聊

OAR 默认让 Claude 以 `sdk-cli` 入口运行，这样的会话**不会出现在终端 `claude --resume` 的列表里**（用会话 id
`claude --resume <id>` 仍然可以）。所以每个会话都带 `CLAUDE_CODE_ENTRYPOINT=dudu`，这是已在真实选择器里验证过的做法。

Codex 经 app-server 创建的线程，`codex resume` 本来就能列出。

同一个会话不要同时在 DSH 和终端里写：Claude 没有会话锁，两个进程会各写各的记录。启动前会查 `~/.claude/sessions`，
发现别的进程正占用就拒绝并说明。Codex 自己有单写者限制。

## 嘟嘟：看电脑上已有的会话，搜索，加载进 DSH

侧边栏的全局面板里有「嘟嘟」（用 Dudu 自己的 logo，插件列表里的 `dudu` 也是同一个）。点开是一屏总览，没有标题和说明文字：

```
[搜索会话]  [索引 N / M]  全部 Claude ChatGPT  刷新                        手机已连接
用量（Claude 5 小时、每周）          正在运行（忙的、刚完成的、空闲只计数）
Token（7 天的柱，今天，7 天）
最近（8 条，一条一行）                                                       全部 N
```

一搜索，整页就是搜索结果；清空搜索回到总览。会话一行里有供应商、标题、目录、时间和按钮（**加载到 DSH**，已在 DSH
里的是"打开"）；点一行展开，能看到第一条提示、目录、会话 ID 和"复制恢复命令"（`cd <目录> && claude --resume <id>`
或 `codex resume <id>`）。

- **用量**：问 harness 自己（OAR 的 `accountUsage`，Claude 是让 `claude --safe-mode` 报 `get_usage`，不碰凭据）：5 小时、
  每周、用过的按模型窗口，和重置时间，两分钟读一次。这台电脑的 Codex 登录方式读不了限额，所以 ChatGPT 不显示；读不了的
  harness 一律不占位置。
- **Token**：Claude 读转写里每条消息的 usage（输入、输出、缓存都算，一条消息只算一次，子 agent 的转写也算），按本地日期；
  ChatGPT 用 Codex 自己报的每日总数（`account/usage/read`）。**没有美元数**：Claude 只在会话结束时记一个总花费，没法按天拆，
  也没法由 token 反推价格（拿 `cost-state` 做过线性拟合，对不上），要美元数得有一张价格表。
- **正在运行**：Claude 自己登记着在跑的进程（`~/.claude/sessions`，有忙/空闲、从什么时候起、目录），所以终端里的和 DSH
  里的都是准的；DSH 自己启动的 Codex 会话也算。终端里的 Codex 没有这样的登记，读不到。忙的和 10 分钟内刚完成的各占一行，
  其余空闲的只数个数，点"展开"才列出。点一行，如果它已经在 DSH 里就打开那个会话，在终端里的不动它。
- **手机**：已配对的手机最近 3 分钟内有过请求就是"已连接"，否则"未连接"，不数台数；`dsh web` 没有手机控制，就不显示。

- **会话从哪来**：OAR 没有列会话的接口，所以读 harness 自己的存储，都放在 `host/providers/native/`。Claude 读
  `~/.claude/projects/*/*.jsonl`，只读每个文件的头和尾（转写可以到几百 MB，里面大部分是请求内容）来取标题、目录和
  第一条提示，标题的优先级是自己改的名、Claude 生成的标题、第一条话；Codex 用 `codex app-server` 的 `thread/list`
  （`modelProviders: []` 才是"不过滤"，加 `useStateDbOnly`），和 `codex resume` 看到的一致，子 agent 不列出。
- **搜索**：标题、第一条提示、目录、分支、会话 ID 马上能搜。对话内容在后台读进内存（这台电脑上所有 Claude 对话的文字
  一共十几 MB，读一遍几秒），读完就能按内容搜，结果带命中的片段；读的时候搜索框旁边显示"索引 N / M"。内容只在内存
  里，不写任何文件。每个词都要找到，标题里的词比别处的分量大。
- **加载**：宿主把对话读成"轮 → 步 → 工具调用和结果"（Claude 按 `parentUuid` 处理回退重发的分支，Codex 用
  `thread/read` 的 items，工具调用和结果用实时转写同一份代码读），生成 DSH 自己会写的那些事件，用 DSH 的
  `sessionPersistence` 写进去，再在会话所在目录建（或沿用）工作区。页面随后调 DSH 自己的 `sessions.create`，对一个已
  存储的会话它的意思是"接管并恢复"，DSH 于是把它当成普通会话打开：历史、工具卡片、原始时间都在。助手消息里带着 harness
  自己的会话 id（`replayState`），所以在 DSH 里接着发消息就是 `resume` 同一个 Claude / Codex 会话，原会话文件里会多出
  新的一轮，终端里 `claude --resume` / `codex resume` 照样能接着聊。
- **记住放在哪了**：`<DSH_HOME>/dudu/links.json`（权限 600）记着"哪个 harness 会话在哪个 DSH 会话里"。从嘟嘟加载的、
  以及在 DSH 里直接新建的 Claude / ChatGPT 会话都记。DSH 里的会话被删了，记录就失效，可以再加载。
- **验证**：这台电脑上的 365 个真实会话（301 个 Claude、64 个 Codex）都读出来、生成日志，用 DSH 自己读存储时的校验函数
  检查：321 个通过（共 12,025 轮），43 个没有可加载的对话（空会话或没记目录）。真实 DSH 界面里验证过：Web 运行时
  （0.2.0-rc.2）和 Desktop 自带运行时（0.2.1-rc.3）都加载过 Claude 和 ChatGPT 的会话，历史和工具卡片和原生的一样，在 DSH
  里问"之前说的暗号是什么"，两边都答对了，原会话里追加了这一轮。
- **手机上**：没有嘟嘟页（导航里隐藏，页面只在 DSH 自己的窗口里注册）。
- **限制**：工具结果超过 256 KB 的被截断；历史里的图片显示成 `[图片]`；Claude 的 `/compact` 摘要不显示；一条没有得到回答的
  话（被打断）在 DSH 里是一轮被停止的对话，会话末尾没有收尾的工具调用会被去掉，这样接着发的消息才是新的一轮；非常长的
  Codex 线程读取可能要几分钟，建索引时超过 25 秒的会跳过，不影响加载；目录已经不存在的会话不能加载；搜索只搜标题、目录和
  对话文字，不搜工具输出。

## 访问模式

OAR 没有审批通道：Claude 固定不弹权限确认，Codex 的审批策略固定是 never。所以 DSH 里不会弹出 harness 的审批和提问，
访问模式只能这样落实：

| DSH 访问模式 | Claude | Codex |
| --- | --- | --- |
| 只读 | 不给 Bash、Edit、Write 等会写的工具 | 只读沙箱 |
| 工作区内修改 / 自动 / 未知 | 不限制（和你在 Orca 里用的完全访问一致） | 工作区可写沙箱 |
| 完全访问 | 不限制 | 完全访问 |

Claude 的"工作区内修改"并没有真正的沙箱，这是和 Codex 的差别。Claude 想问用户问题的工具（AskUserQuestion）已关掉；
harness 对宿主发出的其他请求，本轮会以明确的错误结束，不会一直挂着。

## 已知限制

- 每轮启动一个 harness 进程，轮末结束。Claude 用 `run_in_background` 起的后台任务会随进程结束；它在下一轮里会
  知道那个任务被停止了。
- 你在 harness 工作时发的消息，DSH 的"排队发送"会把它当成下一轮，下一轮 resume 同一个会话。真正的"引导"
  （写进正在跑的 turn）Codex 当场生效；Claude 会把它排在当前 turn 之后单独答一轮，所以这一轮会等它答完再结束。
- Codex 偶尔不把某条命令当作工具项上报（见过被只读沙箱拦下的命令），这时 DSH 里只有文字，没有工具卡片。
- harness 的工具结果超过 256 KB 会被截断。
- 会话头部仍显示 DSH 的"标准模式"，对 harness 会话没有意义，没去改 DSH 的标题栏。
- 供应商下拉框的选择会成为之后新会话的默认值（DSH 自己保存模型选择的方式）。
- Claude 调用没登记过的工具（比如 MCP 工具）时，DSH 里会多一条"工具已添加"的记录，之后同名工具不再出现。
- 手机端没有供应商下拉框和供应商设置栏。

## Orca 是怎么做的（调研结论）

Orca 有两套：终端那套是用 PTY 加 shell 包装、全局 hook 脚本和标题扫描来感知 agent 状态，脆弱也重（也是你现在在用的）；
另一套实验性的结构化聊天用 Claude Agent SDK 和 `codex app-server`，只列出 Claude 和 Codex。它的"聊天转终端"
其实是 fork 一份会话，因为同一时刻只能有一个写者；hook 写在全局配置文件里，会漂移（GH#16771、#28076）；SDK 会话
同样被 `claude --resume` 列表隐藏（GH#28322）。这里的做法是直接在 DSH 里显示 harness 自己的会话，不加 hook，
不动全局配置。

嘟嘟页参考的是 Orca 的 AI Vault（会话库）：一行里放标题、目录、分支、时间，搜索结果带命中的片段，内容索引在后台建、页面
说明进度。没有照搬的：Orca 把内容放进 SQLite 的全文索引（要先同意才建，工具输出只收 3072 字符以内），这里所有对话文字
只有十几 MB，直接放内存，不写磁盘；Orca 的删除、拖进终端、跨主机这些也没做。

## 新增的界面文字（需要审核）

- 供应商下拉框：按钮的无障碍名称 `供应商，当前 X`；X 来自 DeepSeek / Claude / ChatGPT。
- 设置栏目名：`供应商`；栏内：`状态`、`可用`/`未找到`/`版本不受支持`/`无法运行`、`启用`、`可执行文件路径`、
  输入框提示 `留空则自动查找`、`保存`、`已保存`、`重新检测`、读取中的 `正在读取…`。
- 会话里的错误（英文，直接显示在"本轮运行失败"里）：`Claude is not logged in. Run \`claude\` in a terminal and sign in.`、
  `ChatGPT is not logged in. Run \`codex login\` in a terminal.`、`This Claude Code session is open in another process
  (pid N). Close it there first.`、`<Claude|ChatGPT> asked for something DSH cannot answer here (…)`、
  `… exited (code) before the turn finished.`、`The turn was interrupted.`、`The session's folder is not available: …`、
  `Could not start …`、`… did not take the message: …`。
- 工具结果被截断时末尾的 `… (output truncated)`。
- 嘟嘟页（侧边栏入口「嘟嘟」由你提供）：搜索框提示和无障碍名称 `搜索会话`；`索引 N / M`；筛选 `全部` / `Claude` / `ChatGPT`
  （分组的无障碍名称 `筛选`）；`刷新`；`手机已连接` / `手机未连接`；卡片名 `用量`、`Token`、`正在运行`、`最近`；用量里的
  `5 小时`、`每周`、`<模型> 每周`、`16:59 重置`、`周二 01:59`、`已限流`、`需要登录`、`无法读取`；Token 的 `今天`、`7 天`；
  运行里的 `N 忙`、`忙 12 分钟`、`3 分钟前完成`、`刚刚完成`、`空闲 N 小时`、`另有 N 个空闲`、`展开` / `收起`、`没有在运行的会话`；
  会话行的 `加载到 DSH` / `加载中…` / `打开`、展开后的 `目录：`、`会话 ID：`、`复制恢复命令` / `已复制`；
  `全部 N`、`没有会话`、`没有匹配的会话`、`读取会话失败：…`、卡片读取中的 `…`。
- 加载失败时显示在那一行下面的英文：`That harness is not available. Check Settings > 供应商.`、`This DSH cannot store a loaded
  session.`、`That session is no longer on this computer.`、`The session does not say which folder it ran in.`、
  `The session has no conversation to load.`、`The session's folder is not available: …`。

## 验证

`npm test` 覆盖归一化、模式映射、安装探测、模型列表、生命周期（用 OAR 自带的脚本化 runtime）、设置页和镜像工具。
没有单元测试能替代的部分是用真实的 CLI 和真实的 DSH 界面跑过：Claude（Haiku 5.5）和 Codex 各完成工具调用、
停止、DSH 重启后接着聊、排队消息；终端的 `claude --resume` 选择器和 `thread/list` 里能看到这些会话；
DSH 的 Web 运行时（0.2.0-rc.2）和 Desktop 自带的运行时（0.2.1-rc.3）都试过。
