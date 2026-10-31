# 从插件里控制 DSH 会话（验证 12 和 14）

结论：给 issue 开会话、发消息、读状态、答问题、收起和放回，**插件的服务端用 DSH 自己的服务就够了，两个运行时都行**，不需要手机那条路的 `ctx.connection.createPeer`。代码在 `host/assistant/home/`：`dsh-sessions.mjs` 是唯一碰 `ctx.*` 的文件，`agent-sessions.mjs` 管会话和状态，`assign.mjs` 把 issue 接上去。

验证环境：npm 的 `dsh web` 0.2.0-rc.2，和 Desktop 自带 CLI 0.2.1-rc.3（`dsh web`，插件 `port: 0`），隔离的 `DSH_HOME` 和 `HOME`，Chrome。**没有真实模型**：这里没有 `DEEPSEEK_API_KEY`，用的是本机的脚本模型（`tests/e2e/mock-model.mjs`，OpenAI 兼容，流式），DSH 把它当默认模型；DSH 的循环、会话、侧栏、问题工具、审批和页面都是真的。没有跑登录后的真实 Claude、Codex（隔离的 HOME 里没有登录）。

## 用到的接口

插件的 `inject` 里都写成可选（`sessionController`、`permissionPresets`、`userQuestions`、`agentDefaultModel`，`workspaceRegistry`、`sessionProjections` 原来就有），缺哪个，用到它的那一步报"This DSH has no … service"，别的功能照常。

| 做什么 | 怎么做 |
|---|---|
| 能用哪些模型 | `ctx.sessionController.modelCatalog()` → `{ default, groups: [{ id, models }] }`。路由：`deepseek-official`（DSH 自己的）、`claude`、`codex`（装了并启用才有；Claude 的模型有 `default`） |
| 建会话 | `ctx.workspaceRegistry.create(cwd, 标题?)`（目录要存在，同一目录幂等）→ `ctx.sessionController.create({ workspaceId })` → `{ sessionId }`。`workspaceId` 和 `cwd` 不能同时给。空白会话不在侧栏里，第一条消息之后才出现 |
| 侧栏里叫什么 | `ctx.sessionController.rename({ sessionId, title })`，写成 `DUDU-12 标题` |
| 选模型 | `ctx.sessionController.selectModel({ sessionId, provider, model })`。**会同时把它写成 DSH 之后所有新会话的默认模型**（profile 的 `agent-default-model`，实测补丁文件里多了一条）。所以选完用 `ctx.agentDefaultModel.saveSelection(原来的)` 放回去（实测补丁文件里那条也消失）；会话本来就在这个模型上（DeepSeek）就不选 |
| 访问模式 | `ctx.permissionPresets.set(ctx.agents.get(id).session, 'read-only' \| 'workspace-write' \| 'danger-full-access')`。两个运行时都有这三个名字；新会话默认是 `workspace-write`，所以要在第一条消息之前设。写进会话日志（`permission/preset`、`sandbox/mode`），聊天框里显示 Read Only；Claude、Codex 路由也从这里读（`permissionOf`） |
| 第一条、后续的消息 | `ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue' \| 'steer', content: [{ type: 'text', text }] }, signal)` → `{ accepted: true }`。`queue` 是下一轮。重启后的冷会话它自己恢复 |
| 停 | `ctx.sessionController.cancel({ sessionId })`，这一轮以 `aborted` 结束 |
| 收起、放回 | `ctx.workspaceRegistry.archiveSession(id, { stopActivity? })`、`unarchiveSession(id)`、`archivedSessionIds` |
| 读存着的会话 | `ctx.sessionController.inspect(id)` → `{ meta, events }`，不唤醒会话 |

## 状态怎么读

事件（`ctx.on`，只听，不改）：

- `api-session/status (sessionId, running)`：DSH 的循环开始、结束一轮。
- `session/event (session, event)`：`turn/end`，`data.reason.kind` 是 `completed`、`max-tokens`、`aborted`、`blocked`、`error`、`interrupted`、`forked`（`error` 带 `{ message, code }`）；`assistant/message`，`data.message.content` 里的文本块是智能体说的话。
- **`turn/end` 先于 `status false`**，所以在 `status false` 时定状态：最后一轮 `completed`/`max-tokens` 是 `finished`，`error` 是 `error`，别的结束是 `idle`；在跑是 `running`；有没答的问题或审批是 `waiting_owner`。规则和 `host/assistant/sessions/states.mjs` 对 DSH 会话的一样。
- 一轮的次序：`agent/inbox/spliced` → `status true` → `turn/start` → … → `turn/end` → `status false`。没有模型凭据时整轮 80 毫秒，以 `MISSING_CREDENTIAL` 结束。提供方回 HTTP 400，`turn/end` 的错误是 `400: {"message":…}`，插件取出 message。

等主人的两种（都是**瀑布事件**，监听器要写 `ctx.on(事件, 处理, { global: true, prepend: true })`，不归自己的请求原样 `return next()`）：

- **智能体提问**：默认预设里 `ask_user_question` 是阻塞的，走 `user-questions/request`（`request.agent.session.id`、`request.questions`、`request.signal`）。阻塞模式下**没有 `request.wait.callId`，`userQuestions` 投影也是空的**（只有 timed 模式才填，`ctx.userQuestions.answer` 也只管那种）。答案是 `{ answers: [{ id, selected: [选项名], custom? }] }`，主人的话：等于某个选项名就选它，否则当 `custom`。
- **智能体要放开权限**：`approval/request`（`toolName`、`callId`、`reason`、`displayReason: { en, zh }`、`signal`），答案是 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`。只读会话里写文件：第一次被沙箱挡（`file access denied under read-only mode`，文件没写出来）；模型带 `sandbox_permissions` 重试，才发这个请求。**没有人在 DSH 窗口前时，它不失败，一直等**：实测 15 秒后这一轮仍是 running，issue 上看不出来。所以插件接管：`ask` 是 DSH 自己的那句话（`displayReason.zh`）加"回复"允许"放开这一次，其他回复都不放开"，只有一个明确的"允许"类的词放行这一次（`allowed-once`），别的一律 `rejected`；会话的模式不变。
- 两种都一样处理：同时交给 DSH 自己的窗口（`next()`）和 issue 页，先答的算；页面答了，用合成的 `request.signal` 让 DSH 窗口里的卡片消失。

## 收起和放回（验证 14）

可以。`archiveSession` 把会话从侧栏拿掉（持久，会话文件不动），`unarchiveSession` 放回原位，在真实侧栏里看到行消失、再出现。DSH 自己的侧栏行上也有 "Archive session" 按钮，所以主人可能自己收起，插件**每次问 DSH**（`archivedSessionIds`），不信自己记的。

- 会话在跑时 `archiveSession` 拒绝（`WorkspaceActiveSessionError`，"the session is active (turn)"）；`{ stopActivity: true }` 先收起再停。
- 收起的会话不接新的一轮（`ArchivedSessionGate` 让它以 `blocked` 结束），所以发消息前先放回来。
- 页面里打开 issue 的会话：`ctx.sessions.create({ sessionId, workspaceId })` → 等它进列表 → `ctx.uiWorkspace.openSession(id)` → `ctx.layout.selectPanel(null)`。**必须带 `workspaceId`**，不带就是 `session/conflict: … belongs to "<项目目录>", not "<DSH 的目录>"`（会话和目录绑死）。插件的 `issues/resume`（收起的先放回）把会话所在的工作区 id 一起返回，`client.js` 的 `actions.openSession` 用它。

## 重启 DSH

会话在磁盘上，重启后 `ctx.agents.list()` 是空的，`list` 里 `agentAvailable: false`。`inspect(id)` 能读出上一轮怎么结束（`completed`；被打断的那一轮 DSH 补一个 `interrupted`），插件启动时对打开的 issue 的会话这样读一遍（`restore`），之后照常跟着事件走。实测（两个运行时一样）：

- 重启前做完的：还是 In Review，`ask` 还在；主人回复，DSH 自己把冷会话恢复，新一轮照常跑完。
- 重启时在等回答的、在跑的：这一轮没了（`interrupted`），issue 停在 In Progress、智能体状态 Idle，`ask` 已清掉（关机时问题被放弃）。主人再回复，就是一条普通消息，会话恢复接着做。

## 试错记录：哪里不行

1. 瀑布事件的监听器只记日志、不调 `next()`：`workspace/session-activity` 被它弄坏，`archiveSession` 在 DSH 里抛 `Cannot read properties of undefined (reading 'length')`，**整个 DSH 进程退出**。观察瀑布事件也得 `return next()`；`api-session/*`、`session/event`、`agent/*` 是 emit 事件，只听就行。
2. `selectModel` 改默认模型（见上）：不处理，主人下一个新会话、嘟嘟自己的对话都会换成 Claude。
3. 模型目录第一次列出要 1.6 秒（装着 claude、codex），之后 11 毫秒；第一次分配会等它，插件启动时先列一次。
4. 没登录的 Claude 路由：回合"成功"结束，智能体说的是 `Not logged in · Please run /login`（不是错误；issue 进 In Review，评论里就是这句）。没登录的 Codex 路由：`ChatGPT is not logged in. Run \`codex login\` in a terminal.`，要等 20 秒到 80 秒以上才报。
5. 页面里 `ctx.sessions.create({ sessionId })` 不带工作区：见上。
6. 两个运行时的差别：Desktop 的请求里多一条 `time-context` 的用户消息，`ctx.connection.createPeer` 只有 Desktop 有，这里用不到；其余一样。

## 测试用的模型

`@deepseek-ai/dsh-llm-pi-ai` 的 `providers` 里加一条 `api: openai-completions`、`baseURL`、`apiKeyEnv`、`models`，再把 `agent-default-model` 指向它，DSH 就把本机的脚本服务当模型用（`tests/e2e/harness.mjs` 的 `model` 选项做的就是这个）。DSH 的请求里，主人的话后面还跟着 DSH 自己加的用户消息（运行时上下文、时间、目录里的 `AGENTS.md` 提示，开头是 `Current runtime context.`、`Time sampled while preparing`、`<system-reminder>`），脚本模型按"最后一条主人写的话"选回复要跳过它们。

## 没验证的

- 登录后的真实 Claude、Codex 回合；真实的 DeepSeek；真实的 Desktop 窗口（只用了 Desktop 自带的 CLI）。
- 多个窗口同时打开同一个会话时，问题的卡片两处都有，先答的算（只在单元测试里按这个规则写过，没开两个浏览器试）。
- Done 时自动收起会话（`closeFor` 写了、没接，见报告）。
