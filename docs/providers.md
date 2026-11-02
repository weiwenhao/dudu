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
    harness 的会话 id 记在助手消息的 `source.replayState` 里，DSH 重启后也能接着用。通过公开的
    `sessionController.inspect` 读取最后一个 `turn/start`，按本轮用户消息的 ID 区分新消息与正在运行中的引导；
    旧回合即使停在工具调用后，也不影响新回合 resume 原生会话。
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

## 模型菜单要和 Claude Code 自己的一致

模型列表由 OAR 向 harness 要（Claude 是 `claude` 的 `list_models` 控制请求，不用 token）：这台电脑上返回 13 个，和 `/model` 一样——`Default (recommended)`、`Opus 5.5`、`Fable 5.1`、`Sonnet 5.5`、`Haiku 5.5`，以及 Haiku 4.5、Sonnet 5、Opus 5、Fable 5、Opus 4.8/4.7/4.6、Sonnet 4.6（2026-11-01 实测）。菜单里的名字取 harness 自己的 `displayName`；如果它只给了别名（`Opus`、`Default`），就用它今天指向的版本补全：`Opus 5.5`、`Default (recommended) · Sonnet 5.5`，这样选的和跑的是同一个（`oar.mjs` 的 `modelName`）。载入已有会话时，起始模型取对话里实际用过的那个，按名字、再按别名指向的版本找，别名优先于 `default`（`native/index.mjs` 的 `modelFor`）。

## 载入的会话里的图片

你贴进 Claude Code 或 Codex 的图片，载入 DSH 后是真正的图片，不是“[image]”字样（主人 2026-11-01）。读的时候按字节认出真正的类型，不取链接；载入时每条消息的图片作为一批交给 DSH 的附件服务（`ctx.attachments.saveImages`），用户消息的内容按原来的顺序写成 `[{ type: 'text' }, { type: 'image', attachment }]`，和 DSH 自己存粘贴图片的写法一样。Claude 的图片在载入时再读一遍文件取出（base64 很大，不进共享的历史缓存）；Codex 的 `localImage` 只记文件路径，载入时才读。超过 DSH 限制、读不出或不是图片的，留一个“[image]”标记；附件服务不在（旧的 DSH）时和以前一样。图片的任何问题都不让载入失败。会话弹窗里的预览仍是文字，一串图片只显示一个“[image]”。Claude 自己写在文字里的“[Image #1]”是你的话，原样保留。

## 终端接着聊

OAR 默认让 Claude 以 `sdk-cli` 入口运行，这样的会话**不会出现在终端 `claude --resume` 的列表里**（用会话 id
`claude --resume <id>` 仍然可以）。所以每个会话都带 `CLAUDE_CODE_ENTRYPOINT=dudu`，这是已在真实选择器里验证过的做法。

Codex 经 app-server 创建的线程，`codex resume` 本来就能列出。

同一个会话不要同时在 DSH 和终端里写：Claude 没有会话锁，两个进程会各写各的记录。启动前会查 `~/.claude/sessions`，
发现别的进程正占用就拒绝并说明。Codex 自己有单写者限制。

## 停止、原生压缩与接入检查（2026-11-02）

- 停止信号监听整个 DSH 回合，包括两个模型流之间等待镜像工具的时间；通过 OAR 的 `abort` 中断原生工作，再由 `dispose` 释放连接。后续回合等待同一份释放 Promise，避免旧 writer 尚在就恢复会话。启动过程中取消时，最终取得的 OAR session 直接释放，不发送已取消的指令。原生进程完全由 OAR 管理。
- 原生 `compaction_started` / `compaction_ended` 已接到 `activity.mjs`。通过 DSH 既有 `command/run` / `command/done` 发布 `compact` 行，复用截图中 `compact · 正在压缩…` 的控件、图标、动画和语言；来源为 `dudu-harness`，没有伪装成 boss 输入。结束、失败、停止和释放均配对收尾。Claude 只报告结束边界时，仅记录已完成的行，不编造开始时间。
- 压缩由 Claude/Codex 自己进行。DSH 的副本保留完整可见历史，不写 `compaction/summary`、不替换 surface，不伪造摘要、压缩条数或节省 token。DSH 用于自动压缩判断的上下文容量仍保持保护值；不能把它改成原生容量，否则会引发第二次压缩。此前 11:48:31 至 11:50:12 的约 101 秒等待，已由原始 rollout 中的 `task_started`、`compacted` 和新输入时间确认是原生压缩；更早的 active-writer 报错是独立事件。
- 排队输入的后续回合进入压缩，视为原生重新活跃，持续观察；不会在等待第一段文字时关闭连接。已转发输入后来出现 `input_dropped` 时明确失败，不把拒收误报为成功。
- OAR 原生子线程同时按 `sessionId` 和 `agentPath` 隔离；Codex 子线程即使 `agentPath` 为空，其文字、压缩和回合结束也不会进入或结束父会话。父级实际报告的总用量仍正常计入。
- 修复恢复会话后镜像工具显示 `UNKNOWN_TOOL`：DSH 的 `AgentOptions.provider` 仍是创建时的宿主默认值，实际供应商由持久化的模型选择和请求头决定。创建、热加载和重新检测时读取该投影；每次真实适配器请求前再按正在运行的路由核对。供应商停用、重启用或更换路径时移除旧镜像并绑定当前 bridge；注册失败会撤下本次已注册的工具，明确失败。镜像只等待原生结果，不重新执行命令和补丁。
- 正式会话第 78 轮的 `turn/start` 为 2026-11-02 11:51:20（Asia/Shanghai），12:25:48 的 `unknown tool` 提问作为同一轮中的补充输入进入。12:32:47 显示约 41 分 27 秒与该起点一致，包含整轮工作和等待，不是最新一条提问的单独耗时；没有更改 DSH 的累计计时或把补充输入伪造为新回合。

本轮逐项核对后的边界：

| 接入项 | 现状 |
|---|---|
| 新建、resume、项目目录、模型、思考等级、附件和回合内追加输入 | 通过 OAR；已有针对性回归，本轮增加停止后立即再发与压缩验证 |
| 文字、可读推理、工具调用和最终结果 | 已接；本轮修复恢复会话后已知工具未注册的问题，核对实际工具结果，长结果按现有上限截断 |
| 原生 token 用量与缓存 | 已接，累计计数去重，缓存与普通输入按 DSH 口径分开；未知数据不编造 |
| 原生压缩运行状态 | 本轮补齐，使用 DSH 原控件；无摘要文本的原生报告不显示虚构摘要 |
| 工具 stdout 的实时增量 | 尚未映射；当前 DSH 镜像工具公共执行接口只有最终结果，没有通用的 partial-result 发布口。DSH 的 bash job 服务管理的是它自己启动的进程，不能把外部 Codex 命令伪装成该服务的 job |
| 原生上下文占用、模型实际回报、后台任务细节 | OAR 能读到部分事实，但当前 DSH 的普通 LLM stream 无对应进度字段；底栏的上下文估算不是原生上下文百分比。没有因此改变自动压缩阈值或把后台子任务冒充成 DSH 子会话 |
| 授权和结构化提问 | OAR 0.75.0 无公开回复入口，仍明确拒绝无法回答的请求；Claude 的 AskUserQuestion 仍不提供。不能静默批准或让进程无限等待 |
| 列表与同步 | 原生只读，沿用现有 ID、草稿和事件流；外部终端正在压缩时的实时状态尚未从只读历史重建 |

测试使用 Desktop 自带 CLI 的隔离 DSH web、真实 OAR 与 Codex，仅模型服务脚本化。本轮相关端到端 18 项经针对性复跑全部通过：续聊、工具、停止与压缩 8 项，图片 1 项，同步 9 项；不是全仓端到端一次性全通过。验证包含原生自动压缩、原控件可见、页面刷新期间继续显示、压缩后新输入只发送一次、停止时压缩行先于回合结束收尾，以及命令输出、退出码和补丁落盘。首轮有一个侧栏测试未保证实际切换会话，导致它及依赖其数据的小窗测试超时；明确先切换到另一会话后，同步组 9 项完整复跑通过。合成 Codex 会话初始化使用隔离环境和与 DSH 一致的可写工作区默认值，避免测试自身的只读默认值干扰补丁检查；实际只读、可写与完全权限切换另经真实 OAR 探针核对。日志在 `.local/native-cancel-nov02/`。没有向正式原生会话发送检查消息，也没有修改其配置或记录。

## 已导入会话的同步与标识（2026-11-01）

DSH 侧栏用公开插槽 `sidebar.session.row.leading` 显示 Claude、ChatGPT、DeepSeek 的品牌 logo；ChatGPT 统一使用主人 2026-11-02 提供的 `ChatGPT.svg`，保留原始路径与比例，浅色显示黑色，深色随前景色显示，无独有白底、边框或内缩。侧栏、会话、事项、提及菜单和办公室标签共用 `AgentLogo`。头像外框一致，@ 候选里统一为 20 px。运行中的状态点由 DSH 自己显示。图标读取会话的模型投影，会话行在原有缩进上向右增加 16 px，工作区行保持原位置。

可见窗口在初次加载、会话列表成员变化、恢复焦点时检查原生历史，后台每 15 秒检查列表中的会话。正在打开的完整会话和事项小窗另有检查队列：DSH 侧栏切换或小窗打开时立即检查，保持打开时每 5 秒检查，DSH 工作停下来后也立即检查。它们使用 DSH 公开的 `retainedBy.mainView` / `retainedBy.duduIssuePreview`，不会排在其他长会话的批量读取后；检查期间收到的新触发在本次完成后再执行。隐藏窗口暂停轮询，恢复可见时补查。同步有新增事件时刷新列表元数据，对话通过原有事件流更新，保留会话 ID 和输入草稿。

2026-11-02 修正了关联丢失后永远跳过同步的问题。打开会话时若 `links.json` 没有映射，通过 `sessionController.inspect` 读取持久日志中助手的 `source.replayState`，核对其 provider 与 Claude/Codex 身份后补回关联，再同步。检查不激活 Agent；显式删除、被隐藏的旧关联以及同一原生会话已有的新映射都不覆盖。没有原生身份的会话短期缓存检查结果，不每 5 秒重读整份日志。Claude/Codex 转写文件的尺寸与修改时间用于识别变化，显式加载绕过历史缓存。同步只读取原生历史，不向原生会话发消息或启动工作回合。

会话列表与预览头部的更新时间、最近排序使用对话记录的时间。Claude 从转写末尾向前寻找用户输入、模型输出、工具结果或回合结束记录中的有效时间，不把标题、模式、快照、系统注入和子会话的写入算作活跃；最多读取末尾 48 MiB，找不到有效时间时显示已有的“—”，不退回文件修改时间或当前时间。Codex 使用 `thread/list` 返回的更新时间，读取预览时不再以 rollout 的文件修改时间覆盖它。文件的 `mtimeMs` 与大小单独用于缓存失效和同步检测，不进入列表显示；文件被触碰或元数据重写时仍会检查变化，但不会把旧会话排到最前面。

`native/sync.mjs` 将原生会话和 DSH 的用户消息按顺序对齐，只追加最后一个共同用户回合之后的新内容。2026-11-02 修正了“只有上一轮、当前聊天一直不出现”的问题：已写入原生记录的进行中回合也显示，后续片段追加到同一个打开的 DSH 回合，真正结束时才写一次结束记录。Codex 同一回合里的补充输入按原顺序保留，不再只取第一条；预览与完整会话都能读到。只读取已有的消息项，不接管原生进程或向它发送消息。

Codex 用 `completedAt` 和 rollout 的 `task_complete` / `turn_aborted` 确认结束；另一个 app-server 读到 `interrupted` 但没有结束时间时仍视为未结束。Claude 用 `stop_reason` 和 `turn_duration`；`tool_use` / 尚无回答的输入保留为进行中。没有结果的工具暂不发布，不伪造空结果或把它记作完成。已有 DSH 输入尚未出现在原生记录、历史回退或答案分支不兼容时不覆盖。活动会话等待空闲，通过 live Session 的 `runMaintenance` / `append` 发布到既有流；已完成的冷会话仍使用独占持久化句柄。

进行中回合先通过 `sessionController.resolveAgent` 激活，再从 live Session 发布，避免普通恢复流程把刚导入的打开回合认作崩溃。maintenance 保留到观察到原生结束，每 5 秒检查原生文件的变化，窗口暂时隐藏也能收尾。DSH 收到新的用户输入或 Agent 被释放时，先以 `interrupted` 结束本地观察，再让宿主自己的工作继续；不打断外部 Claude/Codex。原生回合标识放在 `replayState.nativeTurnId`，进行中消息另记 `nativeComplete: false`。DSH 重启后从已记录的位置继续，不重发用户输入，不换会话 ID；重启导致的本地中断是一个边界，不会把每次轮询都各记作 Completed。

当前 Desktop 0.2.1-rc.5 的 `runMaintenance` 只更新 Session 投影，不更新 loop 另存的回合计数，直接追加回合后续聊会重复编号。同步在 maintenance 保留区内同步这个计数。这一处访问了 DSH 的内部 `phase.lastTurn`，不是公开 API；只在保留区形状与可写属性符合已验证实现时追加，其他 driver 暂缓同步，不猜测或写出不可恢复的日志。后续 DSH 若提供公开的外部回合导入或计数重读接口，应替换这里的兼容处理。

旧版本已经产生重复续段，或缺少首个系统节点的会话，由 `native/repair.mjs` 修复：仅处理纯导入事件、原生身份一致、没有 DSH 请求或收件事件且当前空闲的副本。从原生已完成回合创建新副本，保留标题、模型和思考等级，归档旧副本并迁移当前事项关联；旧日志仍在 DSH，原生记录只读。有真实 DSH 工作、未知事件、并发修改或归档失败时不替换。正常副本不会进入此迁移；同步响应中的 `replacements` 告知页面新身份，显式打开和预览会跟随它。

### 导入后继续对话的系统节点（2026-11-02）

v4 会话的第一个 surface 节点必须预留给系统提示。`native/session-events.mjs` 在第一个 `step/start` 后、第一条用户消息前写入空的 `system/message`，source 为当前格式的 `{ kind: 'system-prompt' }`。它不携带额外指令；DSH 在继续对话时通过自己的替换事件写入实际系统提示。增量同步不再添加这个开头节点。仅检查能否导入、读取历史，不能验证继续对话后的持久化兼容性；回归覆盖继续发送、重启与重新打开，其中 Codex 经真实 OAR/app-server 续聊，只将模型服务替换为测试模型。

此前适配器只用“最后一条不调用工具的输出”判断回合是否结束。旧回合在工具调用后中断、报错或结束，重开 DSH 后发新消息会被误认成仍在继续旧进程，出现 `The harness is no longer running this turn. Send the message again.`。现在以 DSH 的持久回合边界为准，只把本轮真实用户输入交给 OAR，历史里的任务、运行时上下文和指令不会重发。真正处在同一回合中途而进程已丢失时仍报错，避免静默重复执行工具。没有 `sessionController.inspect` 的旧宿主保留原来的消息推断，不具备这项恢复保证。

旧副本若已继续工作，可能包含 `system/message requires a protected first surface head` 错误，无法通过持久化服务读取，且不能从原生历史重建而丢弃 DSH 中新增的消息。`scripts/repair-imported-session.mjs` 是针对这个错误的离线恢复工具：

```sh
# 默认只读演练，使用当前 Desktop 自带的会话格式校验器。
node scripts/repair-imported-session.mjs /absolute/path/session.v4.jsonl.zstd

# 正常关闭 Desktop 后应用；运行中、写锁被占用或源文件变化时拒绝。
node scripts/repair-imported-session.mjs /absolute/path/session.v4.jsonl.zstd --apply
```

恢复保留同一个会话 ID、所有原有消息、工具输出、原生身份与捕获的模型请求，只插入一个空节点并调整已知的本日志序号引用，包括工具来源、标题、替换范围和 `developer/message.headerSeq`。跨会话继承、未知事件或其他格式损坏一律拒绝。它完整解码 DSH 的多帧 Zstandard 文件，先通过当前 Desktop 的完整校验，再将原始字节备份到 `.local/session-repairs/`，持有 DSH 同一把内核写锁并原子替换；备份和校验摘要保留供恢复。第一压缩帧必须只有 header 一行，事件分批写入后续独立校验帧；已存在系统节点但 header 与事件合在首帧的文件，仅重排压缩帧，不改任何行。物理帧格式与逻辑事件均校验通过后才发布。原生 Claude/Codex 转写文件不作任何修改。

原生历史按实际记录的消息、工具和结束时间生成事件。Codex 的逐回合 token 取 rollout 中的计数，Claude 的 usage 按消息 ID 去重；缓存与普通输入 token 分开。没有测量值时不编造零计数，没有 token 到达时间时不编造流速或时间间隔。

DSH 里新发的图片通过 `attachments.readImage` 验证，再把宿主图片路径交给 OAR 的 `prompt` / `steer` 图片参数；非文件附件后端会先写一份私有持久图片。图片单独发送也可用，读取失败拒绝整条消息，不悄悄只发文字。

Properties 显示 harness 原生 ID，并复制 `claude --resume <id>` 或 `codex resume <id>`。它与内部的 `dsh:<id>` 分开；尚无原生身份的 DSH 会话只显示 DSH ID，不编造恢复命令。属性行的 Agent logo 与状态、优先级、日期图标共用 16 px 容器和文字起点；列表与菜单头像继续使用原来的尺寸。

Delete 事项会停止并持久归档关联 DSH 会话，在 `links.json` 标记移除，避免旧 DSH 副本及待回答事项采集自动恢复事项。原生 Claude/Codex 会话仍在会话管理中供搜索、预览和手动重新导入；重新导入创建新 DSH 副本，只有显式接管才新建事项。DSH 公开 API 不支持物理删除会话日志；原生 Claude/Codex 文件也保留。其他事项共享的会话不清理。

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
  `sessionPersistence` 写进去，再在会话所在目录建（或沿用）工作区。页面随后调 `sessions.refresh`，等原会话 ID
  进入列表，再用 `uiWorkspace.openSession` 打开：历史、工具卡片、原始时间都在。不能使用 `sessions.create` 打开已有会话，
  Desktop 0.2.1-rc.5 会为非空白记录另建空白会话（2026-11-02 修正并加入真实运行时回归）。助手消息里带着 harness
  自己的会话 id（`replayState`），所以在 DSH 里接着发消息就是 `resume` 同一个 Claude / Codex 会话，原会话文件里会多出
  新的一轮，终端里 `claude --resume` / `codex resume` 照样能接着聊。
- **记住放在哪了**：`<DSH_HOME>/dudu/links.json`（权限 600）记着"哪个 harness 会话在哪个 DSH 会话里"。从嘟嘟加载的、
  以及在 DSH 里直接新建的 Claude / ChatGPT 会话都记。关联文件已不存在时失效，可以再加载；显式 Delete 事项留下的移除标记则阻止自动重新导入。
- **验证**：这台电脑上的 365 个真实会话（301 个 Claude、64 个 Codex）都读出来、生成日志，用 DSH 自己读存储时的校验函数
  检查：321 个通过（共 12,025 轮），43 个没有可加载的对话（空会话或没记目录）。真实 DSH 界面里验证过：Web 运行时
  （0.2.0-rc.2）和 Desktop 自带运行时（0.2.1-rc.3）都加载过 Claude 和 ChatGPT 的会话，历史和工具卡片和原生的一样，在 DSH
  里问"之前说的暗号是什么"，两边都答对了，原会话里追加了这一轮。
- **手机上**：没有嘟嘟页（导航里隐藏，页面只在 DSH 自己的窗口里注册）。
- **限制**：工具结果超过 256 KB 的被截断；图片读不到时显示标记；Claude 的 `/compact` 摘要不显示；没有得到回答、也没有结束信号的输入仍可查看，
  不伪造已完成回答；尚无结果的工具等结果写入后才显示。非常长的
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
