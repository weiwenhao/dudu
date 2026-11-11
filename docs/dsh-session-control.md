# 从插件里控制 DSH 会话（验证 12 和 14）

结论：给 issue 开会话、发消息、读状态、答问题、收起和放回，**插件的服务端用 DSH 自己的服务就够了，两个运行时都行**，不需要手机那条路的 `ctx.connection.createPeer`。代码在 `host/assistant/home/`：`dsh-sessions.mjs` 是唯一碰 `ctx.*` 的文件，`agent-sessions.mjs` 管会话和状态，`assign.mjs` 把 issue 接上去。

验证环境：npm 的 `dsh web` 0.2.0-rc.2，和 Desktop 自带 CLI 0.2.1-rc.3（`dsh web`，插件 `port: 0`），隔离的 `DSH_HOME` 和 `HOME`，Chrome。**没有真实模型**：这里没有 `DEEPSEEK_API_KEY`，用的是本机的脚本模型（`tests/e2e/mock-model.mjs`，OpenAI 兼容，流式），DSH 把它当默认模型；DSH 的循环、会话、侧栏、问题工具、审批和页面都是真的。没有跑登录后的真实 Claude、Codex（隔离的 HOME 里没有登录）。

2026-10-31 后续要求：工作 Agent 不管理项目事项；`finished` 只表示这一轮结束。`progress.mjs` 由嘟嘟读取最后几段对话，判断未完或可以交给主人审阅，再更新 issue。这里的会话事实与事项进度是两层，不能互相代替；当前规则以 `docs/assistant.md` 3.2、3.3 为准。

2026-11-01 后续要求：@ 对应 Agent 只转发用户消息，通过 `prompt(..., mode: 'queue')` 进入已有会话，不解析问题答案或授权。下面的 `answerOf` / `outcomeOf` 是兼容的显式 `issues/reply` API 和 DSH 原生问题流程，不是 @ 的路由行为。来源为 `session` 的已有对话不由嘟嘟自动审阅、评论或请求确认。

2026-11-06 接口更新：Desktop 随附 DSH `0.2.2-rc.1` 已移除 `sessionController.inspect()`。
统一通过 `host/dsh-session-history.mjs` 读取历史。2026-11-11 起优先调用
`sessionQuery.observeSession(id, { projectionMode: 'none', signal })`，共享它提供的不可变事件快照，
取得快照后用 `[Symbol.dispose]()` 释放准备租约；不复制整段工具输出、不额外计算投影。完整事件和继承事件数仍保留，
不激活会话；全文搜索索引关闭时仍可精确读取。能力缺失时才选择 `sessionQuery.readSession(id)` 或更早的
`sessionController.inspect(id, signal)`，读取错误不触发换源。共享层统一 `session` / `meta` / `header`；
旧 `readSession` 不接收信号，只能取消等待，底层只读请求可能继续。观察调用取消后迟到的租约也会释放。
下文更早的自动进度处理是历史记录，当前事项工作流以主人手动修改为准，不随 Agent 状态变化。

## 用到的接口

插件的 `inject` 里都写成可选（`sessionController`、`sessionQuery`、`permissionPresets`、`userQuestions`、`agentDefaultModel`，`workspaceRegistry`、`sessionProjections` 原来就有），缺哪个，用到它的那一步报"This DSH has no … service"，别的功能照常。历史读取按能力选择观察、新查询或旧检查接口，均不存在时报 `UNSUPPORTED`。

| 做什么 | 怎么做 |
|---|---|
| 能用哪些模型 | `ctx.sessionController.modelCatalog()` → `{ default, groups: [{ id, models }] }`。路由：`deepseek-official`（DSH 自己的）、`claude`、`codex`（装了并启用才有；Claude 的模型有 `default`） |
| 建会话 | `ctx.workspaceRegistry.create(cwd, 标题?)`（目录要存在，同一目录幂等）→ `ctx.sessionController.create({ workspaceId })` → `{ sessionId }`。`workspaceId` 和 `cwd` 不能同时给。空白会话不在侧栏里，第一条消息之后才出现 |
| 侧栏里叫什么 | `ctx.sessionController.rename({ sessionId, title })`，写成 `APP-12 标题`（项目关键词和该项目内的序号） |
| 选模型 | `ctx.sessionController.selectModel({ sessionId, provider, model })`。**会同时把它写成 DSH 之后所有新会话的默认模型**（profile 的 `agent-default-model`，实测补丁文件里多了一条）。所以选完用 `ctx.agentDefaultModel.saveSelection(原来的)` 放回去（实测补丁文件里那条也消失）；会话本来就在这个模型上（DeepSeek）就不选 |
| 访问模式 | `ctx.permissionPresets.set(ctx.agents.get(id).session, 'read-only' \| 'workspace-write' \| 'danger-full-access')`。两个运行时都有这三个名字；新会话默认是 `workspace-write`，所以要在第一条消息之前设。写进会话日志（`permission/preset`、`sandbox/mode`），聊天框里显示 Read Only；Claude、Codex 路由也从这里读（`permissionOf`） |
| 第一条、后续的消息 | `ctx.sessionController.prompt({ requestId, sessionId, mode: 'queue' \| 'steer', content: [{ type: 'text', text }] }, signal)` → `{ accepted: true }`。`queue` 是下一轮。重启后的冷会话它自己恢复 |
| 停 | `ctx.sessionController.cancel({ sessionId })`，这一轮以 `aborted` 结束 |
| 收起、放回 | `ctx.workspaceRegistry.archiveSession(id, { stopActivity? })`、`unarchiveSession(id)`、`archivedSessionIds` |
| 读存着的会话 | `ctx.sessionQuery.observeSession(id, { projectionMode: 'none', signal })` → 不可变 `{ header, inheritedEventCount, events }`，随后释放观察租约，不唤醒会话；旧宿主兼容 `readSession` / `inspect` |

## 状态怎么读

事件（`ctx.on`，只听，不改）：

- `api-session/status (sessionId, running)`：DSH 的 Agent 循环开始或停止运行；连续处理排队消息时，循环一直运行，不会每轮都重新发 `true`。
- `session/event (session, event)`：`turn/start` 开始一轮；`turn/end` 的 `data.reason.kind` 是 `completed`、`max-tokens`、`aborted`、`blocked`、`error`、`interrupted`、`forked`（`error` 带 `{ message, code }`）；`assistant/message` 的 `data.message.content` 文本块是智能体说的话。
- **`turn/end` 先于 `status false`**，结束事件即定下本轮结果：`completed`/`max-tokens` 是 `finished`，`error` 是 `error`，其余结束是 `stopped`；在跑是 `running`；有没答的问题或审批是 `waiting_owner`。下一次 `turn/start` 若 `ctx.agents.get(id).status` 确认仍是 `running`，立即恢复工作中；导入、同步的历史边界没有实际运行的 Agent，不据此开始工作。规则和 `host/assistant/sessions/states.mjs` 对 DSH 会话的一样。
- 一轮的次序通常是 `agent/inbox/spliced` → `status true` → `turn/start` → … → `turn/end` → `status false`；有排队消息时是一次 `status true` 后接多个 `turn/start … turn/end`，最后才 `status false`。没有模型凭据时整轮 80 毫秒，以 `MISSING_CREDENTIAL` 结束。提供方回 HTTP 400，`turn/end` 的错误是 `400: {"message":…}`，插件取出 message。

2026-11-08 DUD-4 误分组：只读核对原会话记录，18:16:25.222（北京时间）上一轮正常结束，18:16:25.232 立即开始下一轮，后续仍有工具执行；原适配只处理 `turn/end` 和循环状态，忽略了排队下一轮的 `turn/start`，因此停在“需要你”。新增的定向单元回归先复现 `finished` 未恢复成 `running`，修复只补真实运行的开始边界，不改变事项 workflow、排队发送或历史导入。

等主人的两种（都是**瀑布事件**，监听器要写 `ctx.on(事件, 处理, { global: true, prepend: true })`，不归自己的请求原样 `return next()`）：

- **智能体提问**：默认预设里 `ask_user_question` 是阻塞的，走 `user-questions/request`（`request.agent.session.id`、`request.questions`、`request.signal`）。阻塞模式下**没有 `request.wait.callId`，`userQuestions` 投影也是空的**（只有 timed 模式才填，`ctx.userQuestions.answer` 也只管那种）。答案是 `{ answers: [{ id, selected: [选项名], custom? }] }`，主人的话：等于某个选项名就选它，否则当 `custom`。
- **智能体要放开权限**：`approval/request`（`toolName`、`callId`、`reason`、`displayReason: { en, zh }`、`signal`），答案是 `'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`。只读会话里写文件：第一次被沙箱挡（`file access denied under read-only mode`，文件没写出来）；模型带 `sandbox_permissions` 重试，才发这个请求。**没有人在 DSH 窗口前时，它不失败，一直等**：实测 15 秒后这一轮仍是 running，issue 上看不出来。所以插件接管：`ask` 是 DSH 自己的那句话（`displayReason.zh`）加"回复"允许"放开这一次，其他回复都不放开"，只有一个明确的"允许"类的词放行这一次（`allowed-once`），别的一律 `rejected`；会话的模式不变。
- 两种都一样处理：同时交给 DSH 自己的窗口（`next()`）和 issue 页，先答的算；页面答了，用合成的 `request.signal` 让 DSH 窗口里的卡片消失。

## 收起和放回（验证 14）

可以。`archiveSession` 把会话从侧栏拿掉（持久，会话文件不动），`unarchiveSession` 放回原位，在真实侧栏里看到行消失、再出现。DSH 自己的侧栏行上也有 "Archive session" 按钮，所以主人可能自己收起，插件**每次问 DSH**（`archivedSessionIds`），不信自己记的。

- 会话在跑时 `archiveSession` 拒绝（`WorkspaceActiveSessionError`，"the session is active (turn)"）；`{ stopActivity: true }` 先收起再停。
- 收起的会话不接新的一轮（`ArchivedSessionGate` 让它以 `blocked` 结束），所以发消息前先放回来。
- 页面里打开 issue 的会话（2026-11-02 按 Desktop 0.2.1-rc.5 更新）：`issues/resume` 将收起的会话放回，返回 `sessionId`、`key` 和 `workspaceId`；客户端同步原生历史，`ctx.sessions.refresh()` 发现已存储的原会话，等原 ID 进入列表后调用 `ctx.uiWorkspace.openSession(id)` → `ctx.layout.selectPanel(null)`。等待超时明确失败。**不调用 `sessions.create` 打开已有对话**：新版 DSH 的该接口用于创建或复用空白会话，对已有工作记录的 ID 会创建另一个空白会话。旧版曾用 create 恢复会话，并要求带 `workspaceId` 避免目录冲突；这条旧路径已经移除。真实 Desktop 运行时的回归覆盖从事项打开 Claude/Codex，检查历史可见且没有多出会话。
- Done 时自动收起会话已由 `onChange` 接通，并在隔离 DSH 的端到端测试中验证；进行中的一轮不被强停，停下来后收起。
- Delete 事项使用 `archiveSession(id, { stopActivity: true })` 清理当前和历史会话，并持久标记原生/DSH 别名，旧副本及采集不自动恢复事项。原生会话仍可搜索、预览、手动重新导入；导入创建新的 DSH 副本，只有显式接管才新建事项。DSH 的公开持久化服务没有删除文件的方法，日志仍保留；共享给其他事项的会话不清理。清理期间暂停 issue 状态反映，失败时恢复，避免丢掉尚未回答的问题。

## 重启 DSH

会话在磁盘上，重启后 `ctx.agents.list()` 是空的，`list` 里 `agentAvailable: false`。共享历史读取能读出上一轮怎么结束（`completed`；被打断的那一轮 DSH 补一个 `interrupted`），插件启动时对打开的 issue 的会话这样读一遍（`restore`），之后照常跟着事件走。实测（两个运行时一样）：

- 重启前已经由嘟嘟判断完成的：保持 In Review 和确认问题；尚未审阅的 `finished` 或 `idle` 会话重新安排嘟嘟审阅，不能仅凭结束状态转入 In Review。显式 @ Agent 回复时，DSH 自己把冷会话恢复。
- 重启时在等回答的、在跑的：这一轮没了（`interrupted`），旧的阻塞问题被放弃；嘟嘟读中断前的最近对话判断进展。主人在唯一留言框显式 @ 对应 Agent 后，才把消息传到会话继续做；普通留言只记日志。

## 试错记录：哪里不行

1. 瀑布事件的监听器只记日志、不调 `next()`：`workspace/session-activity` 被它弄坏，`archiveSession` 在 DSH 里抛 `Cannot read properties of undefined (reading 'length')`，**整个 DSH 进程退出**。观察瀑布事件也得 `return next()`；`api-session/*`、`session/event`、`agent/*` 是 emit 事件，只听就行。
2. `selectModel` 改默认模型（见上）：不处理，主人下一个新会话、嘟嘟自己的对话都会换成 Claude。
3. 模型目录第一次列出要 1.6 秒（装着 claude、codex），之后 11 毫秒；第一次分配会等它，插件启动时先列一次。
4. 没登录的 Claude 路由：回合"成功"结束，智能体说的是 `Not logged in · Please run /login`，DSH 没报错误。旧接线曾因此把 issue 推到 In Review；现在必须由嘟嘟读这句话判断未完成。没登录的 Codex 路由：`ChatGPT is not logged in. Run \`codex login\` in a terminal.`，要等 20 秒到 80 秒以上才报。
5. 页面里 `ctx.sessions.create({ sessionId })` 不带工作区：见上。
6. 两个运行时的差别：Desktop 的请求里多一条 `time-context` 的用户消息，`ctx.connection.createPeer` 只有 Desktop 有，这里用不到；其余一样。
7. **`inject` 里写的每个服务都要等**，值写 `false` 也一样（对象形式的值是拦截配置，不是“可选”）：在没有 `mcpManager` 的 DSH 里，写了 `mcpManager: false` 的插件停在 `pending (waiting for service: mcpManager)`，路由全是 404。可能没有的服务不要写进 `inject`：`ctx.get('名字')` 读（没有返回 `undefined`），或 `ctx.inject(['名字'], (ctx) => …)` 开一个有它才跑的子插件（服务变了重跑）。`inject` 里现有的 `false` 项都是 0.2.0 起每个 DSH 都有的服务，所以没出过事。
8. **`ctx.tools` 的 `restrict`**（源码 `packages/core/tools/src/index.ts`）：只能点全局工具的名字；点自己（会话）登记的名字、没有的名字、空过滤器都会抛错；`allow: []` 合法，把全局工具全藏起来；会话自己登记的工具不受限制、同名时盖过全局的。注册表变化时发 `tools/change`（`restrict` 自己也会发，所以只在表真的变了才重设）。`ctx.tools.schemas()` 不带参数是全局视角。
9. **MCP 客户端的版本差**：`ctx.plugin(await ctx.loader.import('@deepseek-ai/dsh-mcp-client'), { transport, serverName, url, headers, … })` 每个版本都能用，插件停了它也跟着停，返回的 fiber 是可等待的（等它会等到服务器应答，所以挂的时候别等）。`expandTemplates`（配置里写 `${credential:名字}`）和 `ctx.mcpManager` 只在主分支，0.2.2-rc.1 和 0.2.0-rc.2 没有：令牌变了只能重挂。

## 测试用的模型

`@deepseek-ai/dsh-llm-pi-ai` 的 `providers` 里加一条 `api: openai-completions`、`baseURL`、`apiKeyEnv`、`models`，再把 `agent-default-model` 指向它，DSH 就把本机的脚本服务当模型用（`tests/e2e/harness.mjs` 的 `model` 选项做的就是这个）。DSH 的请求里，主人的话后面还跟着 DSH 自己加的用户消息（运行时上下文、时间、目录里的 `AGENTS.md` 提示，开头是 `Current runtime context.`、`Time sampled while preparing`、`<system-reminder>`），脚本模型按"最后一条主人写的话"选回复要跳过它们。

## 没验证的

- 登录后的真实 Claude、Codex 回合；真实的 DeepSeek；真实的 Desktop 窗口（只用了 Desktop 自带的 CLI）。
- 多个窗口同时打开同一个会话时，问题的卡片两处都有，先答的算（只在单元测试里按这个规则写过，没开两个浏览器试）。
