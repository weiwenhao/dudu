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

## 验证

`npm test` 覆盖归一化、模式映射、安装探测、模型列表、生命周期（用 OAR 自带的脚本化 runtime）、设置页和镜像工具。
没有单元测试能替代的部分是用真实的 CLI 和真实的 DSH 界面跑过：Claude（Haiku 5.5）和 Codex 各完成工具调用、
停止、DSH 重启后接着聊、排队消息；终端的 `claude --resume` 选择器和 `thread/list` 里能看到这些会话；
DSH 的 Web 运行时（0.2.0-rc.2）和 Desktop 自带的运行时（0.2.1-rc.3）都试过。
