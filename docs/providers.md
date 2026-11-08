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
  这里不再手写。2026-11-07 按主人确认的方案，改由本地包 `@dudu/oar-adapter`
  （`packages/oar-adapter/`）统一引入，依赖精确固定的官方 `@botiverse/oar@0.92.0`，
  用 6 份带输入/输出校验的补丁保留仍有必要的本地扩展。手动压缩和通用单任务停止改用官方实现，
  已移除原 `0.75.0-dudu.2` 中相应的重复补丁。仓库不再维护完整的上游副本；
  `npm install` 和打包从官方依赖生成被忽略的 `.generated/oar/`，不修改 `node_modules`。
  来源、原包 integrity、各文件校验与维护步骤记在包内 `README.md`、`upstream.json`，保留原许可证和 NOTICE。
  打包只把 Claude 和 Codex 两个 runtime 的依赖打成一个文件
  （`host/providers/oar-runtimes.mjs`），安装后的插件没有自己的依赖；包里的许可证在
  `dist/THIRD_PARTY_NOTICES.txt`。升级时先对照上游检查本地扩展，再用真实的 Claude、Codex 做相关回归；全量测试仍需主人明确同意。
- **DSH 一侧是我们自己的**（`host/providers/`）：
  - `harness-bridge.mjs`：适配器。DSH 每请求一步，就回放 harness 的一条助手消息；harness 的工具调用变成镜像工具的调用。
    harness 的会话 id 记在助手消息的 `source.replayState` 里，DSH 重启后也能接着用。通过公开的
    `sessionQuery.readSession`（旧宿主回退到 `sessionController.inspect`）读取最后一个 `turn/start`，按本轮用户消息的 ID 区分新消息与正在运行中的引导；
    旧回合即使停在工具调用后，也不影响新回合 resume 原生会话。`input-delivery.mjs` 另外保存原生输入的提交阶段，
    启动失败时不会把已保存在 DSH、却尚未交给 harness 的指令漏掉。
  - `mirror-tools.mjs`：镜像工具，不做事，只等 harness 报告结果，让工具调用在 DSH 里显示成终端、diff、读文件、搜索等原生卡片。
  - `oar.mjs`：把 OAR 的记录流读成"步"（Claude 以 `message_stop` 为一步的结束，Codex 以每个工具调用为一步），以及启动、
    中断、关闭、模型列表、安装探测。
  - `commands.mjs`：在原生 Agent 作用域内接管 DSH 既有的 `/compact`，保留命令身份和原生控件；
    通过 `runMaintenance` 保留空闲边界，直到 OAR 释放 writer 后才让排队输入开始。
  - `drivers/claude.mjs`、`drivers/codex.mjs`：各 harness 的差别（工具名、访问模式怎么落实、环境变量）。
  - `index.mjs`：按安装情况注册路由 `claude`、`codex`；每个会话只在选中该路由时才有镜像工具；设置存在 `providers.json`。
- **界面**（`host/dudu-plugin/client.js`，只用 DSH 公开的客户端接口，没改任何 DSH 包）：供应商下拉框占用聊天框上方
  `conversation.hero.agentPreset` 这个槽（优先级 -1，把原来的模式按钮挪到子槽里继续显示）；模型菜单通过包装
  `modelDirectories.directoryFor` 返回的 store，只留下当前供应商的模型，DSH 自己的菜单、搜索、推理等级都没动。
  供应商的选择写进会话日志（`model/selection` 事件）。这部分是一个单独的 Cordis 插件，依赖的服务缺失时只是不出现，
  不会影响手机控制和设置页。嘟嘟设置里的"供应商"页（DSH 自己的设置里没有）显示是否找到、版本、路径，可以启用/停用、指定可执行文件路径、重新检测。
  选择器左侧使用当前供应商自己的 Logo，复用侧栏与事项的 `AgentLogo`（16 px，跟随浅色/深色主题），切换供应商时同步更新。

## 官方 OAR 0.92.0 与适配包验证（2026-11-07）

已将旧的完整 vendor 副本替换为 `@dudu/oar-adapter`、精确固定的官方 0.92.0 依赖和六份兼容补丁。
原包 archive integrity 与锁文件一致；构建额外核对完整源码树、每份补丁的输入与输出以及最终文件清单。
校验失败保留上一次可用产物；没有修改官方安装目录或放宽补丁匹配条件。
独立目录安装适配包后可重建相同校验值并导入 runtime，桌面安装包也已在仓库外导入验证。

手动压缩的合同、调度与完成判断，以及通用 `stopTask` 合同与归一化均改用官方实现。
Claude 继续使用官方单任务停止；Codex 只为已观察到的根会话后台终端使用本地扩展，其余任务交给官方
子线程归属检查。Claude 启动取消、配置回读、后台输出与设置更新、Codex v1 子智能体及恢复归属、
退出信号回收仍保留必要补丁。上游的压缩、单任务控制、进程关闭与后代清理模块保持原样，
退出 hook 适配了新版的待清理后代集合。

升级回归发现，官方压缩失败结果使用通用原因，直接显示会丢失原生提供的具体诊断。主机只对已判定的
原生失败/缺少压缩证据读取根会话的既有诊断，不改官方成败判断，也不覆盖命令身份变化的拒绝原因。
Claude 的帧类型会带子类型（如 `result/success`），因此按原始 native `type` 读取具体错误。
Codex 与 Claude 的失败、取消、并发拒绝、释放后续聊经复跑通过。

相关逻辑、原生配置、真实进程树和桥接关闭测试通过；24 项定向端到端回归经针对性复跑全部通过，
覆盖默认模型/思考等级与权限、三个阶段的停止、两种 harness 的热更新和重启、后台 shell/Monitor、
自然完成、子智能体历史/刷新/停止，以及压缩成功、失败、取消、排队与续聊。
测试使用 Desktop 自带 CLI 的隔离 DSH web、独立 HOME 与真实 Claude/Codex，仅模型服务脚本化。
后台 ticker 改为临时文件写完后原子替换，避免测试读取半份 JSON；原生配置测试先释放 CLI 再删除 HOME。
这两项是测试夹具修正，没有据此增加产品侧处理逻辑。

记录在 `.local/oar-refactor-20261107/` 的 `unit-092.log`、`ownership-092.log`、
`e2e-092.log`、`compaction-final-092.log` 和 `claude-compaction-final-092.log`；
前两次集成记录中的压缩失败诊断断言，已由后续针对性复跑验证关闭。
lint、typecheck 与变更检查通过。未运行全量测试，未安装或热更新正式 Desktop。

## DSH 0.2.2-rc.1 历史接口兼容（2026-11-06）

该版本的 `sessionController` 已移除 `inspect()`，历史读取改由 `ctx.sessionQuery.readSession(id)` 提供。
原接线在 harness 开始一轮前调用旧方法，直接以 `ctx.get(...)?.inspect is not a function` 失败；搜索、导入同步、
原生关联恢复、导入副本修复和嘟嘟自身对话恢复也使用过旧方法。

`host/dsh-session-history.mjs` 统一按能力选择读取接口：优先使用 `sessionQuery.readSession`，仅在此方法不存在时
回退到旧版 `sessionController.inspect`。新接口返回的 `session` 与旧接口的 `meta` / `header` 统一为原有消费者
读取的头部字段，完整保留事件和继承事件数；不激活会话、不追加事件。新接口实际读取出错时保留错误，不换另一来源
掩盖失败。新接口不接收 `AbortSignal`，由调用侧取消等待；底层只读请求仍可能在取消后完成。
插件可选注入 `sessionQuery`，端到端测试的探针同步使用同一适配层。

## 宿主退出与插件热更新时的原生进程回收（2026-11-07）

现场的 Claude writer 在旧 DSH 宿主退出后仍存活，父 PID 为 1，管道已经断开；新宿主恢复同一
原生会话时，`openElsewhere` 正确报 `HARNESS_BUSY`，防止两个 writer 同时修改原生记录。
使用同一份 OAR、真实 Claude CLI、独立 HOME 与本地脚本模型复现：修复前 `process.exit()`
会回收 writer，未处理的 SIGTERM 会留下它。现场日志不足以确定旧宿主最终收到的具体信号。

热更新保留的是 DSH 宿主进程与已保存的会话身份/历史；它卸载旧适配器，因此要释放旧原生进程。
后台任务保留只适用于同一个存活的 OAR 会话跨 DSH 轮次复用，不表示跨插件卸载或宿主退出保留
一个失去管道的 writer。这两项行为均继续保留。

- 插件开始卸载即启动 `providers.close()`，不再等手机连接、索引扫描等服务先退出。
  provider 关闭先撤销路由、释放原生 writer，再等待未完成的安装探测/模型刷新。
  重复关闭共用同一份 Promise，仍等待实际原生退出；扫描与原生回收并行，关联存储最后 flush。
- `HarnessBridge` 的普通启动与手动压缩都受插件 lifetime 取消。卸载会等待正在启动的会话；
  晚返回的 handle 被关闭，不会在插件释放后注册成新的 run。
- 本地 OAR `ownership.js` 使用 `signal-exit@4.1.0` 补齐未处理的终止信号，继续使用已有的同步
  进程组/后代回收逻辑，保留宿主原有信号处理与退出状态。适配 0.92.0 后，仅当原生子进程和
  上游捕获的待清理后代均已释放才移除 hook；主进程及其管道先关闭时仍保留后代回收。
  SIGKILL 无法运行进程内清理。没有新增协议驱动、接管其他终端 writer 或移除占用检查。

回归包括真实 OS 进程树在 exit、SIGTERM、SIGINT、SIGHUP 下回收、保留主动处理信号的宿主、
不影响无关进程、热更新后的 hook 释放、阻塞刷新时优先释放 writer、启动期间卸载等待 native exit，
主进程关闭后待清理后代在四种退出路径的回收与最终 hook 释放，以及真实 Claude 的原始隔离复现。
DSH 集成回归使用 Desktop 0.2.2-rc.1 自带 CLI 的隔离 web
与独立 HOME，验证更新/重启时释放后台进程，随后恢复同一原生会话；正常多轮后台任务不受影响。

## harness 进程、后台任务和深度睡眠（2026-11-05）

通常 DSH 每开始一轮，`HarnessBridge.begin` 起一个 OAR 会话，按上一轮记下的原生会话 id `resume`，
这一轮结束后释放进程。有原生后台任务时，DSH 的回复仍正常结束，`oar-resident.mjs` 保留同一个 OAR
会话和原生进程；下一轮通过 OAR 的 `deliver()` 投递到它，不重新启动后台命令。
订阅使用带原生会话 ID 的记录游标，沿用用量基线，不回放上一轮文字，也不重复累计 token。

`jobs.mjs` 把实际观察到的原生后台任务登记到 DSH 的 `ctx.jobs`。任务名称、存活、完成和失败沿用
原生事实；DSH 提供既有的任务列表、有界输出和单独停止控件。Claude 使用 OAR 的原生任务事件与
`get_task_output`，停止走 `stop_task`；当前 Claude 2.1.318 把 `Monitor` 也报告为 `local_bash`，
展示其原生描述。Codex 使用 `thread/backgroundTerminals/list`、原生输出增量和完成事件，
停止走 `thread/backgroundTerminals/terminate`。停止确认与终端消失都发生后才记为 stopped，
不把主动停止返回的非零退出码当成自然失败。原生 CLI 继续拥有通知；观察器等待结算，避免 DSH
另行发送一条重复的完成提示、再触发一次模型请求。

最后一个后台任务结束时，先读完最终输出，再释放已经空闲的原生进程。新输入被拒收或在启动阶段取消，
不连带释放之前仍在运行的后台任务。模型和思考等级可通过原生控制更新；Claude 的启动目录、
权限模式和启动时工具排除规则变化时拒绝复用，保留后台任务，待任务停止后按新设置重新启动，
不声称在旧权限下应用了新权限。后台任务仍依赖原生 CLI 进程；关闭插件、退出 DSH 或原生进程退出
会收尾其任务记录，不将它们声明为可以跨进程恢复的守护进程。

`HarnessBridge` 每个会话保留最近一轮的 `HarnessRun`（工具结果每个最多 256 KB、活动记录、团队观察），
直到下一轮开始才换掉。深度睡眠（`docs/assistant.md` 3.4：智能体空闲或正常结束在等你看（不是红点）、这一轮结束、30 分钟没人处理）
调用 `bridge.release(sessionId)`：只释放已经结束且没有原生后台任务的一轮，在跑的、后台工作中、
正在手动压缩的会话不碰。`createProviders().release(sessionId)` 对所有已注册 harness 调用同一入口。
DSH 的 Agent 对象不归这里管，DSH 没有给插件卸载它的办法（实测见 `docs/assistant.md`
的“深度睡眠和办公室的 ZZZ”一条）。

事项会话弹窗标题后的团队和后台任务入口，直接挂载宿主 `conversation.session.header.actions`
中的 `agent-team` 和 `job-list`，保留其组件、服务、语言和交互。弹层跟随弹窗层级；Escape
先关闭已展开的原生面板，保留会话弹窗。打开原生子智能体后关闭弹窗，进入既有 one-shot 子会话。

针对性验证使用 Desktop 随附 CLI、真实 Claude/Codex 和隔离 DSH，只脚本化模型服务。
5 项后台任务端到端通过：两种 shell 在回复结束和下一轮后仍是同一个 PID，调整思考等级对保留进程
实际生效，弹窗中的任务列表可读输出并停止原进程；Claude Monitor 跨轮次存活并能单独停止；
两种 shell 自然结束都显示 completed 并保留最后输出，没有新增 DSH 完成提示或重复模型轮次。
结果在 `.local/native-jobs-e2e-final.log`。团队弹窗及两种子智能体停止的 3 项回归通过
（`.local/native-jobs-team-final.log`），复制命令、原生模型菜单、展开、草稿保留、点外关闭
和焦点的 3 项弹窗回归通过（`.local/native-jobs-modal-regression.log`）。
10 项生命周期逻辑回归通过，包含拒收新输入时保留后台工作、最终输出读完后才释放进程和用量不重计。
已检查浅色、深色窄窗口的真实截图；lint、typecheck、打包和相关文件的差异检查通过。
未运行全量测试，未热更新正式 Desktop，未改动或安装 iPhone。

## 会话统计中的输出速度（2026-11-05）

Claude/Codex 的原生 turn 用量和 DSH 的消息回放计时不是同一个测量范围。原生最终回答带回整轮用量，
DSH 却把它当作最后一步的输出，并用首个回放片段到消息落盘的间隔计算速度。主人截图中的 `15548 tok/s`
由此产生；真实日志中一条最终回答带着 23,540 个输出 token，回放只有 88ms。轮数、步数和用量继续按原记录展示，
不将这些回放间隔当成模型的生成速度，也不为旧日志估算一个替代速度。

- `providers/stats.mjs` 注册独立的 `duduHarnessTiming` 持久投影，按 DSH 自己的步骤边界、首 token、
  重试和重复消息规则，累计 Claude/Codex 的无效速度样本。不改 DSH 的事件、原生用量或宿主的统计投影。
- `ui/lib/harness-stats.js` 通过公开的 slot shadowing 包装宿主统计组件，只修正它读取的 `sessionStats`
  中的 `decodeMs` / `decodeTokens`。兼容旧版 `stats` 与新版 `activity` 槽；用量控件、弹窗、文案、
  主题和显示偏好仍由 DSH 自己提供。混合供应商历史中，DSH 直接调用模型时测得的速度继续保留。
- 手机读取整会话统计时使用同一投影扣除规则；逐轮统计也不把 harness 回放算成生成速度，仍保留 token 用量。
  新投影会从已有日志重建，因此修正涵盖历史会话，无需重写会话文件。

针对性验证：Desktop 随附 CLI 和本机独立 CLI 各通过一项隔离真实 DSH 端到端，覆盖两种 harness、
DSH 自身的实测速度、完整会话、刷新重开、事项会话弹窗及精确 token 用量；3 项投影逻辑和 1 项手机统计
重建回归通过。只读复算主人报告的原会话日志，所有无效速度样本均被排除，其他统计值未变；
数值记录在 `.local/harness-stats-nov05/actual-session-check.json`。lint 和 typecheck 通过，
未运行全量测试，未更新正式 Desktop，也未安装 iPhone。

## 启动失败后的输入恢复（2026-11-04）

DSH 写入用户消息与 harness 接收输入是两个不同的边界。此前原生启动或恢复在初始化阶段失败，
DSH 历史里虽然仍有完整指令，下一轮适配器只取最新 `turn/start` 后的消息；若 boss 接着发“继续”，
原生 Claude/Codex 就只收到“继续”。这项修复发生在 Desktop 的供应商接线，不需要重新安装 iPhone。

- 在读取附件和启动 OAR 前，先调用宿主的 `sessions.flush()` 持久化本轮输入，再保存 `preparing`。
  真正调用 OAR `prompt` / `steer` 前，先持久化 `submitting`；原生确认接收后写 `accepted` 及原生会话 ID。
  初始化、项目目录或附件准备失败，以及明确的原生拒收，留下确定未提交的记录。传输异常或提交中断保持不确定，
  不把“没有回答”当成“没有执行”。
- 记录放在插件数据目录的 `input-delivery/<sha256>.json`，按供应商和 DSH 会话隔离，每次尝试只保留最新阶段，
  只存消息 ID、回合、阶段和原生身份，不复制指令或图片。目录权限为 `0700`，文件为 `0600`；
  同一会话的写入串行，临时文件同步后原子替换，再同步目录；写失败不更新内存中的持久阶段。
- 不向 DSH 日志写自定义事件。DSH 的会话事件词汇是封闭的；公共 `Session.append()` 不提供事件 envelope 的
  `ignorable` 标记，自定义类型会使重启后的日志读取失败。私有记录只在适配器分析时与所属原回合合并，
  不进入宿主日志、聊天 UI 或模型输入。
- boss 下一次明确发送消息时，按原顺序合并此前确定未提交的输入和最新消息，附件仍经原有读取与验证。
  连续启动失败、DSH 重启不丢这份关联；提交成功后不再次补发，也不伪造新的 boss 留言。没有定时或后台重试。
- 明确停止放弃待恢复输入。已确认接收、不确定是否送达、跨供应商和已有后续工作隔开的历史指令不自动补发。
  原生接收后模型报错、尚无第一条助手消息时，恢复和手动压缩仍能使用已保存的原生 ID。
  原生后来报告 `input_dropped` 仍明确结束为失败；目前不因此把已经确认接收的记录重新变为可自动补发。
- 旧日志只在供应商明确、没有模型或工具工作、并以启动前的 `HARNESS_UNAVAILABLE` / `HARNESS_BAD_CWD`
  结束时恢复。其他历史错误不推断输入是否送达。已经发生过后续执行的旧事故不修改正式日志，也不突然重放旧任务；
  boss 可以从 DSH 历史取回原文后明确重发。

针对性验证：本次输入恢复、持久阶段、OAR 提交和适配器边界的 34 项逻辑测试通过。Desktop 随附 CLI 的隔离真实
DSH 与本机真实 Claude/Codex 中，4 项端到端通过，只替换模型服务：两种供应商各自验证完整指令加图片连续
启动失败两次、重启 DSH、从原生聊天框发送“继续”、原会话收到完整内容且后续不重复；另外各自验证原生接收后
模型失败、重启后仍使用原生 ID，且不会再次执行旧输入。DSH 日志没有私有提交事件，聊天中没有额外的 boss
消息。记录在 `.local/input-recovery-nov04/e2e-journal-final.log`，lint、typecheck 与改动检查通过。
未运行全量测试，未更新正式 Desktop，按主人最新要求未构建或安装 iPhone。

## 原生结束边界收到排队输入（2026-11-04）

正式会话 22:27:20 和 22:28:33 的 `HARNESS_REJECTED / session disposed` 是接线的生命周期错误：
Claude 已成功结束，OAR 已释放本轮原生进程，但 DSH 仍在消费同一轮的镜像步骤，
并接纳了新的排队输入。旧适配器把这条新指令 steer 给已经释放的原生进程，因而被拒收。
这不是任务里的操作失败，也不是 GitHub 凭据问题。

现先消费旧进程尚未回放的工具步骤、结果和最终回答，再在成功且没有工具调用的终止边界，
以相同原生会话 ID 恢复下一次原生运行。只提交尚未转发的消息，保留已转发 ID 和子智能体身份，
不重复执行最初的任务，也不丢弃旧回答。结束与 steer 竞争时，仅接受 OAR 明确报告的
`disposed`、`runtime_exited`、`no_active_turn` 这些提交前拒收；传输不确定、原生失败和停止
继续按失败或中断处理，不自动重发。

7 项相关逻辑用例通过。Desktop 随附 CLI 的隔离真实 DSH、真实 Claude/Codex 中，
两项端到端通过：在原生即将结束时排队并插话，两个回答均保留，原生会话身份不变，
两条指令各提交一次，模型请求恰好两次。只替换模型服务，没有调用正式会话或修改其历史。
记录为 `.local/device-logs/blank-relaunch-nov04/handoff-logic-final.log` 和
`handoff-final-e2e.log`；修复已打包，尚未更新正式 Desktop。

## 原生子智能体与 DSH 团队（2026-11-04）

`teams.mjs` 把 harness 自己启动的子智能体投影到 DSH 既有的 Agent Team 和子会话目录。原生 CLI 继续决定委派、
工作、通信和结果交付；DSH 只记录和显示，不再启动另一份研究。根会话的工作流 status 不受影响。

- OAR 的 `task_started` / `task_updated` / `task_ended` 建立和更新成员、任务及其子会话；shell、MCP、ambient
  和非智能体任务不冒充团队成员。Claude 按 `agentPath` / 原生工具调用关联内容，Codex 按原生 child thread ID
  关联；子会话的文字、推理、镜像工具和结果不会进入根会话。
- Codex 0.162.1 的原生多智能体 v1 使用 `collabAgentToolCall`，v2 使用 `subAgentActivity`。本地 OAR 同时处理
  两种记录；v1 的 spawn 工具完成只代表已创建，子任务结果以真实子线程回合结束或原生状态快照为准。祖先与兄弟
  之间的通信不建立新的子任务归属。
- 子会话使用独立的 DSH 观察适配器，读取同一条 OAR 记录流，沿用现有消息及工具卡片。委派输入标为
  `dudu-native-subagent`，不冒充 boss 留言。观察适配器不出现在可选模型列表；子智能体用量不再与已经包含它的
  根会话用量重复累计。
- 根助手先回复、原生子任务仍在运行时，保留 OAR 进程，并延后会让 DSH 停止的最终 step/turn 边界。原生根助手
  接收研究通知后继续原回合；最后一个子任务结束而根助手没有继续时，沿用 5 秒跟进窗口后释放。停止、失败和卸载
  收尾所有未结束的观察记录，不把进程退出伪装成研究完成。
- 成员、父子目录和任务都写入 DSH 的标准事件；成员使用稳定的原生身份，任务沿用 `task-N` 编码。原生子智能体
  再次工作时沿用已有记录，正常结束不重新创建成员。现有团队任务枚举没有单独的失败/取消状态；这两类任务保留
  pending，具体失败或中断在子会话的真实回合结果中显示，不标为 completed。
- 已观察到的子任务身份随父助手消息的 `source.replayState` 保存；新一轮只恢复关系，不恢复“正在工作”。
  Codex 的 OAR 投影用同一份事实识别原生续用事件，收到新的活动才继续同一个 DSH 子会话。没有新活动时不会
  启动观察回合、修改任务或读 worker 对话生成进展。
- Claude 通过 `SendMessage` 续用子任务时，新的 `task_started.toolCallId` 是本次派发调用，子输出仍沿用最初
  `Agent` 的 `agentPath`。保留原始输出关联，不用新派发调用覆盖它。原生同步追加的回答只携带原生身份；
  分析同一原生会话时保留此前已观察到的子任务关系，不能因该回答缺少 `nativeSubagents` 就将它们丢弃。
- 打开团队成员时，只有本插件记录的原生子会话才从团队按钮的默认 continuable 地址改为 one-shot。页面、工具
  卡片和只读输入区完全沿用 DSH；不会允许在 DSH 独立给原生子智能体发消息、恢复或停止。

- **原生会话同步的代价**（2026-11-07，主人在手机上发消息转了约 4 秒：“为什么会一直转转转发不出去？”）：面板的客户端每 5 秒为打开的会话、每 15 秒为所有会话请求 `sessions/sync`，`loadOnce` 过去的做法是先把整份 Claude 记录读一遍（这个对话的记录 659 MB、上千张图，单独读一遍实测 5.07 秒），再为图片读第二遍（没有缓存），读完才由 `sync.mjs` 发现会话的智能体正在工作而推迟；推迟时 `checked` 不记，所以下一次请求又全部重来。结果是 DSH 宿主的主线程几乎一直满载（`ps` 看是约 96% CPU，`sample` 看全在 `fs` 回调里的 JS），手机的请求排在后面。现在：智能体正在 DSH 里工作的会话**一个字节都不读**（`sync.mjs` 的 `busy`，两处共用一条规则）；为图片读的那一遍和历史一样按记录的状态（大小加修改时间）缓存 2 分钟；被推迟的同步，同一状态的记录 60 秒内不再试（`fresh` 或记录变大除外）。测试 `tests/native-sessions.test.ts` 的 “the synchronization does not read the transcript…”（监视 `fs.createReadStream`，数假智能体被问了几次；三条各去掉一条都会失败）。代价仍随记录大小线性增长：只看末尾就能判断“有没有新东西”的做法没做。**尚未装进主人的 Desktop**（`desktop:update`）。

团队入口使用 DSH 自己的 Agent Team 扩展；测试启用宿主随附的 `experimental-agent-team` 及其客户端模块，
不从 npm 安装另一个版本，不复制其 UI。当前 Desktop 已配置该扩展的 profile。

边界：只记录更新后实际观察到的工作，不回填猜测历史；没有收到的子会话内容不编造。Claude
只报告任务结果而没有逐条内容时，保留其原生结果；不按通知中的任意路径直接读取文件，也不调用 Dudu 生成额外
总结。现有父会话仍可通过原生工具继续委派和恢复子任务。独立子智能体控制和手机专用操作未新增。

针对性验证使用 Desktop 随附的 CLI、真实 Claude/Codex 和隔离的 DSH，仅脚本化模型服务。两个供应商的
原生研究均能出现在宿主 Agent Team，打开子会话查看真实结果、刷新后重开、重启 DSH 后继续原生子任务，
仍沿用同一成员、任务和子会话。两种供应商的停止回归也分别通过，停止不被标为完成。这 4 项端到端分批通过；
Claude 最后一次补验包含上述原始输出关联修正，记录在 `.local/native-subagents-nov04/claude-lineage-retry.log`，
另 3 项在 `e2e-desktop-verified.log`。截图已检查，沿用宿主的团队弹窗和 one-shot 子会话页面。
本轮供应商替换、执行路由和镜像重绑的 3 项逻辑回归通过；原有相关 OAR 投影及运行期测试的结果保留在同目录。
未运行全量测试，未更新正式 Desktop，也未验证实体 iPhone。

## 模型菜单要和 Claude Code 自己的一致

模型列表由 OAR 向 harness 要（Claude 是 `claude` 的 `list_models` 控制请求，不用 token）：这台电脑上返回 13 个，和 `/model` 一样——`Default (recommended)`、`Opus 5.5`、`Fable 5.1`、`Sonnet 5.5`、`Haiku 5.5`，以及 Haiku 4.5、Sonnet 5、Opus 5、Fable 5、Opus 4.8/4.7/4.6、Sonnet 4.6（2026-11-01 实测）。菜单里的名字取 harness 自己的 `displayName`；如果它只给了别名（`Opus`、`Default`），就用它今天指向的版本补全：`Opus 5.5`、`Default (recommended) · Sonnet 5.5`，这样选的和跑的是同一个（`oar.mjs` 的 `modelName`）。载入已有会话时，起始模型取对话里实际用过的那个，按名字、再按别名指向的版本找，别名优先于 `default`（`native/index.mjs` 的 `modelFor`）。

2026-11-03 修复模型目录失败后无法恢复的问题。DSH 的全局目录会把供应商局部失败存入 `failures`，同时标为 `ready`；原来的菜单重新读取只返回该缓存，网络恢复后仍可能没有可选模型。`client.js` 的供应商作用域现在在明确读取菜单时检查当前供应商的失败，先调用 DSH 既有的 `catalog.refresh()`，再共用其进行中的加载请求；不因为其他供应商失败而反复刷新正常供应商。浏览器恢复联网、供应商设置保存或“重新检测”成功后，也通过同一入口刷新目录。不轮询，不重发聊天，不修改已保存的供应商启用状态、模型选择或思考等级，仍复用 DSH 的完整模型菜单及错误显示。

定向验证使用隔离的真实 DSH 和脚本模型复现供应商 `ECONNRESET`，没有修改正式 Desktop 的网络或配置。修复前，网络已恢复但重开菜单仍读旧的失败缓存；修复后 3 项端到端通过，覆盖重开菜单、恢复联网和设置重新检测，并检查模型切换、思考等级及刷新后持久选择。正常菜单沿用共享缓存，不因每次打开而重复请求。供应商设置的启停、路径和检测交互另有 1 项通过，lint、typecheck 和改动检查通过；未运行全量测试，未安装或重启正式 Desktop。

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
- 2026-11-03 补齐 Claude 启动阶段的取消：此前 `runtime.session()` 尚在等待原生恢复、SessionStart hooks 或设置/用量读取时，还没有可供调用 `abort()` 的 Session，DSH 的停止要等它返回才处理。Claude provider 现在将本轮信号通过本地 OAR 的可选 `openSignal` 传入；OAR 立即使用既有进程释放逻辑，等待实际退出后拒绝启动，不发送已取消的输入，随后移除启动监听。已打开的 Session 继续走原来的 abort/dispose。
- 本次正式会话日志中，00:21:53.273 开始的回合在 00:22:14.246 以 `aborted/user` 结束；该回合没有模型输出或工具调用，原生 transcript 也没有对应的新输入。日志没有保留按钮点击和原生启动控制的时间，不能据此计算点击到停止的实际延迟，也不能断言具体卡在启动的哪一项。隔离 DSH、真实 Claude 与一个等待 30 秒的 SessionStart hook 可复现旧实现点击停止后超过 5 秒仍不结束的问题；回归测试还检查停止后原生子进程已退出、取消输入未调用模型、界面恢复发送按钮，以及下一条消息继续使用同一原生会话。
- 修复后的针对性端到端 3 项全部通过，分别覆盖恢复启动、等待模型、运行原生工具；最后一次测试从点击到持久回合结束分别为 345、103、73 ms，仅代表该隔离环境的观测。工具测试禁用 Claude 的自动后台任务，等待真实 shell 启动标记，避免把已转入后台或已结束的工具当作仍在执行；停止后也确认 shell 已退出。另有 6 项取消与 writer 释放逻辑测试、lint、typecheck 和变更文件检查通过，未运行全量测试。记录在 `.local/claude-stop-*-nov03.log` 与 `.local/claude-stop-nov03/incident.json`。正式 Desktop 的更新脚本因本任务运行在 DSH 内而在安装前拒绝热更新，原运行构建保持不变；修复已打包，任务结束后需从外部终端执行 `npm run desktop:update`，不能绕过保护在本回合内替换适配器。
- 原生 `compaction_started` / `compaction_ended` 已接到 `activity.mjs`。通过 DSH 既有 `command/run` / `command/done` 发布 `compact` 行，复用截图中 `compact · 正在压缩…` 的控件、图标、动画和语言；来源为 `dudu-harness`，没有伪装成 boss 输入。结束、失败、停止和释放均配对收尾。Claude 只报告结束边界时，仅记录已完成的行，不编造开始时间。
- 压缩由 Claude/Codex 自己进行。DSH 的副本保留完整可见历史，不写 `compaction/summary`、不替换 surface，不伪造摘要、压缩条数或节省 token。DSH 用于自动压缩判断的上下文容量仍保持保护值；不能把它改成原生容量，否则会引发第二次压缩。此前 11:48:31 至 11:50:12 的约 101 秒等待，已由原始 rollout 中的 `task_started`、`compacted` 和新输入时间确认是原生压缩；更早的 active-writer 报错是独立事件。
- **手动 `/compact` 已接通 Claude 与 Codex。** 此前适配器给 DSH 的辅助摘要请求返回空文本，后来只改成“不支持”提示，均未完成实际需求。2026-11-02 最初通过本地 OAR 扩展接通；2026-11-07 升级到官方 0.92.0 后移除重复实现，直接使用官方 `compact({ signal })` 的完成结果与原生证据，包括 Claude 对内置 `/compact` 命令身份的检查。仅 `completed` 算成功；拒绝、失败、中断、未确认均保留对应结果。信号停止等待不等于取消原生工作，主机仍调用 `abort()` 并等待 `dispose()` 实际释放后才能让下一条消息开始。
- `commands.mjs` 仅覆盖当前原生 Agent 的命令，切回 DSH 模型时撤下。命令注册表只记录一对 `command/run` / `command/done`，不额外伪造自动压缩行、不产生 boss 消息，也不写 DSH 的 `compaction/summary`。空会话沿用宿主的无历史结果。收到请求不代表成功：必须读到根会话的 Codex 压缩 item / Claude `compact_boundary`，再收到成功的回合结束；子线程事件不计入。Claude 把错误文字放在成功 result 却没有压缩边界时仍判失败，并保留原始诊断。
- 手动压缩通过公开 `agent.runMaintenance` 独占空闲 Agent；新消息留在收件箱，OAR 完全释放 writer 后才进入下一轮。忙时拒绝第二次操作；失败、取消、Agent 释放或插件卸载都会清理本次原生 session。DSH 命令注册表可能先发布请求取消的错误行，maintenance 仍等待实际释放，避免下一条消息撞到 active writer。适配器的辅助摘要路径继续明确拒绝，防止 DSH 再压缩可见副本；自动原生压缩沿用原接线。
- 手动命令的取消沿用 DSH 自身语义：从聊天框发起的请求绑定当前页面，执行中刷新会取消请求；不会伪造跨页面仍在运行。成功后刷新保留命令结果，后续继续同一个原生会话。自动压缩属于原生工作回合，其刷新恢复接线不变。
- 排队输入的后续回合进入压缩，视为原生重新活跃，持续观察；不会在等待第一段文字时关闭连接。已转发输入后来出现 `input_dropped` 时明确失败，不把拒收误报为成功。
- OAR 原生子线程同时按 `sessionId` 和 `agentPath` 隔离；Codex 子线程即使 `agentPath` 为空，其文字、压缩和回合结束也不会进入或结束父会话。父级实际报告的总用量仍正常计入。
- 已知 harness 失败通过 DSH 标准流的 `finish.reason.failure` 传递 `{ code, message }`，保留启动失败、拒收、退出、登录等分类和原始原因。DSH 会把外部 `Error` 上自加的 `code` 归为 `UNKNOWN`，因此只在适配器边界把本插件的错误转换为结构化结果，不复制宿主错误类，也不采信第三方任意附带的错误码。中断仍结束为 `aborted`；失败不会自动重发任务。已写入旧日志的 `UNKNOWN` 不回填猜测的分类。
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
| 原生上下文占用、模型实际回报、后台任务细节 | OAR 能读到部分事实，但当前 DSH 的普通 LLM stream 无对应进度字段；底栏的上下文估算不是原生上下文百分比。没有因此改变自动压缩阈值；原生子智能体通过独立观察会话及标准团队事件显示，见本页 2026-11-04 的接入说明 |
| 授权和结构化提问 | OAR 0.92.0 仍无通用公开回复入口，明确拒绝无法回答的请求；Claude 的 AskUserQuestion 仍不提供。不能静默批准或让进程无限等待 |
| 列表与同步 | 原生只读，沿用现有 ID、草稿和事件流；外部终端正在压缩时的实时状态尚未从只读历史重建 |

测试使用 Desktop 自带 CLI 的隔离 DSH web、真实 OAR 与 Codex，仅模型服务脚本化。本轮相关端到端 18 项经针对性复跑全部通过：续聊、工具、停止与压缩 8 项，图片 1 项，同步 9 项；不是全仓端到端一次性全通过。验证包含原生自动压缩、原控件可见、页面刷新期间继续显示、压缩后新输入只发送一次、停止时压缩行先于回合结束收尾，以及命令输出、退出码和补丁落盘。首轮有一个侧栏测试未保证实际切换会话，导致它及依赖其数据的小窗测试超时；明确先切换到另一会话后，同步组 9 项完整复跑通过。合成 Codex 会话初始化使用隔离环境和与 DSH 一致的可写工作区默认值，避免测试自身的只读默认值干扰补丁检查；实际只读、可写与完全权限切换另经真实 OAR 探针核对。日志在 `.local/native-cancel-nov02/`。没有向正式原生会话发送检查消息，也没有修改其配置或记录。

同日补齐手动压缩后的针对性回归：13 项端到端在最后一次运行中全部通过，用时约 66 秒；另有 8 项相关逻辑测试、typecheck 与 lint 通过。端到端包含手动压缩 7 项（空历史 1 项，Claude / Codex 各自的聊天框触发和压缩后续聊、失败与取消、输入排队），浮窗 2 项，以及原生 TUI 同步与缺失关联恢复 4 项。使用 Desktop CLI 的隔离 web、真实 Claude / Codex 和仓库内的 OAR；只替换本地模型服务。压缩已实际写入原生 transcript，后续模型请求包含该摘要，DSH 里仍是原会话且没有额外摘要或 boss 消息。首次手动检查中的测试错误已修正：计数应区分宿主注入的用户角色上下文；手动请求在页面刷新时应取消；同步测试不再依赖另一个未选中用例创建的会话。不是全量测试结论，也没有更新正式 Desktop。

## iPhone 供应商与侧栏（2026-11-02）

手机的 `catalog.get` 返回现有模型目录和 `providers`（供应商 ID、显示名、模型 ID 列表、
默认模型 ID、宿主默认标记）。与桌面的新任务选择一致，Claude 和 Codex 保留各自路由，
DeepSeek Account、官方与其他普通模型路由归在 DeepSeek 组；不列空的供应商。
`session.create` 可带 `modelId`，先从宿主目录校验，再创建/复用空会话并调用
`session/selectModel`，完成后才返回。没有模型的旧请求仍沿用宿主默认值。

原生新任务的供应商、项目、模式复用既有胶囊与列表弹窗；模型和思考等级留在原有模型弹窗中，
按供应商筛选。已有内容的会话不提供跨供应商切换。切换空会话供应商期间阻止发送，
迟到的回复不能覆盖另一个会话或电脑。

会话摘要增加可选的 `providerId`、`agent`、`agentState`，旧缓存与旧插件可继续读取。
桌面和原生共用 `agentStateForActivity`：实际等待交互优先于运行，正在运行优先于历史，
其后比较 DSH 持久状态和已有原生索引的时间。仅为缺少展示投影的会话读取投影，
使用短缓存及并发上限，读取失败不阻断整份列表。不为此读取工作对话做审核或调用模型。
原生 Logo 由 `scripts/sync-agent-assets.mjs` 从桌面当前矢量生成，构建时自动同步并带上许可。

针对性验证：真实 DSH 与 OAR 的隔离 web 中，三个供应商各自从手机桥接接口创建会话、
发送一次、读回回答和侧栏完成标记，3 项通过；仅模型服务使用测试替身。
原生连接、供应商选择与 Logo 资源的 16 项相关测试通过；三个界面行为经针对性复跑通过，
覆盖侧栏图标和状态、供应商选择后切换项目、按供应商筛选模型与思考等级。
已对照现有原生控件检查模拟器截图，最终 iPhone Release 构建、lint、typecheck 与
`git diff --check` 通过；未运行全量测试，未安装到正式 Desktop 或实体 iPhone。
这不代表真实账号、实体 iPhone 或权限问答的额外验证；OAR 的既有授权边界继续适用。

## 已导入会话的同步与标识（2026-11-01）

DSH 侧栏用公开插槽 `sidebar.session.row.leading` 显示 Claude、ChatGPT、DeepSeek 的品牌 logo；ChatGPT 统一使用主人 2026-11-02 提供的 `ChatGPT.svg`，保留原始路径与比例，浅色显示黑色，深色随前景色显示，无独有白底、边框或内缩。侧栏、会话、事项、提及菜单和办公室标签共用 `AgentLogo`。头像外框一致，@ 候选里统一为 20 px。运行中的状态点由 DSH 自己显示。图标读取会话的模型投影，会话行在原有缩进上向右增加 16 px，工作区行保持原位置。

可见窗口在初次加载、会话列表成员变化、恢复焦点时检查原生历史，后台每 15 秒检查列表中的会话。正在打开的完整会话和事项小窗另有检查队列：DSH 侧栏切换或小窗打开时立即检查，保持打开时每 5 秒检查，DSH 工作停下来后也立即检查。它们使用 DSH 公开的 `retainedBy.mainView` / `retainedBy.duduIssuePreview`，不会排在其他长会话的批量读取后；检查期间收到的新触发在本次完成后再执行。隐藏窗口暂停轮询，恢复可见时补查。同步有新增事件时刷新列表元数据，对话通过原有事件流更新，保留会话 ID 和输入草稿。

2026-11-02 修正事项会话小窗串行等待 `issues/resume`、原生同步和列表刷新的问题。DSH 列表里已有的会话直接 retain / 打开，首次打开也不等待原生同步；已有记录先显示，外部 TUI 更新由原有前台同步通道补进来。未知或归档目标仍执行恢复、发现和列表确认；宿主恢复旧副本失败时再显式同步修复一次。准备步骤记住修复后的 ID；历史缓存由下述有界的 Controller 引用负责。

2026-11-03 修正每次打开会话都重新“载入历史”的问题。DSH 在最后一个引用释放时销毁该会话的客户端历史，
仅缓存会话 ID 无法保留内容。Web 插件现在为最近打开的 12 个会话保留 `duduHistoryCache` 引用，
直接复用 DSH 的历史、已加载旧页、投影及 follow 流。只在完整会话或事项小窗实际打开时加入缓存，
不预加载侧栏，不增加 Agent 工作回合；按最近打开顺序淘汰，目录删除或插件卸载时释放。
前台原生同步仍只认 `mainView` / `duduIssuePreview`，缓存引用不会被误当成正在浏览的窗口。
已有更新继续由原有 follow 流到达；整个浏览器页面重载、首次访问或淘汰后的会话仍需读取一次。
Web 的历史缓存仅驻留当前页面内存，不另存一套会话到浏览器磁盘。

打开操作最多等待 15 秒，超时沿用已有的失败提示与重试按钮。关闭、重试和超时会取消本次请求，等待宿主 ready 的引用也会释放，迟到结果不能挂回已关闭的小窗。事项 Agent 的“打开会话”悬浮帮助已按主人要求去掉，按钮原有 hover、焦点样式和读屏名称保留。

针对性测试暂缓原生同步和恢复请求，确认再次打开及放大不等它们结束，并保留草稿；最后一次隔离 DSH 运行里再次打开到已有内容可见为 66 ms。这只是该测试环境的一次测量，不是所有真实会话的耗时保证。外部 Claude / Codex 更新和丢失关联恢复另在真实同步用例中通过。

同日补充首开阻塞与超时回归：先用挂起同步请求复现旧实现的读取等待，再验证列表里已有的会话首开不等待它。相关端到端 10 项经针对性复跑通过，覆盖首次及重复打开、放大、模型和思考等级、图片与草稿保留、点外关闭及焦点、超时重试和取消，以及 Claude / Codex 原生更新和丢失关联恢复。关闭后的截图确认没有 Agent 的悬浮帮助。更新脚本相关逻辑测试 8 项、lint、typecheck、变更文件的单独 lint 和 `git diff --check` 通过；单独 lint 仍报告 shell 里既有的 4 项 effect 依赖警告。

初跑的模型菜单检查在再次展开处失败：宿主先发布所选思考等级，随后才在异步选择回调中关闭菜单，测试现等待操作结束并关闭后再展开。移除 Tooltip 后，悬停测试也改为直接等待 CSS 颜色变化。没有为测试修改宿主菜单。记录在 `.local/issue-preview-recovery-e2e.log`、`issue-preview-recovery-final.log`、`issue-preview-model-menu-final.log` 和 `issue-preview-desktop-update-tests.log`；未运行全量测试，未更新正式 Desktop。

2026-11-02 修正了关联丢失后永远跳过同步的问题。打开会话时若 `links.json` 没有映射，通过共享历史读取层读取持久日志中助手的 `source.replayState`，核对其 provider 与 Claude/Codex 身份后补回关联，再同步。检查不激活 Agent；显式删除、被隐藏的旧关联以及同一原生会话已有的新映射都不覆盖。没有原生身份的会话短期缓存检查结果，不每 5 秒重读整份日志。Claude/Codex 转写文件的尺寸与修改时间用于识别变化，显式加载绕过历史缓存。同步只读取原生历史，不向原生会话发消息或启动工作回合。

会话列表与预览头部的更新时间、最近排序使用对话记录的时间。Claude 从转写末尾向前寻找用户输入、模型输出、工具结果或回合结束记录中的有效时间，不把标题、模式、快照、系统注入和子会话的写入算作活跃；最多读取末尾 48 MiB，找不到有效时间时显示已有的“—”，不退回文件修改时间或当前时间。Codex 使用 `thread/list` 返回的更新时间，读取预览时不再以 rollout 的文件修改时间覆盖它。文件的 `mtimeMs` 与大小单独用于缓存失效和同步检测，不进入列表显示；文件被触碰或元数据重写时仍会检查变化，但不会把旧会话排到最前面。

`native/sync.mjs` 将原生会话和 DSH 的用户消息按顺序对齐，只追加最后一个共同用户回合之后的新内容。2026-11-02 修正了“只有上一轮、当前聊天一直不出现”的问题：已写入原生记录的进行中回合也显示，后续片段追加到同一个打开的 DSH 回合，真正结束时才写一次结束记录。Codex 同一回合里的补充输入按原顺序保留，不再只取第一条；预览与完整会话都能读到。只读取已有的消息项，不接管原生进程或向它发送消息。

Codex 用 `completedAt` 和 rollout 的 `task_complete` / `turn_aborted` 确认结束；另一个 app-server 读到 `interrupted` 但没有结束时间时仍视为未结束。Claude 用 `stop_reason` 和 `turn_duration`；`tool_use` / 尚无回答的输入保留为进行中。没有结果的工具暂不发布，不伪造空结果或把它记作完成。已有 DSH 输入尚未出现在原生记录、历史回退或答案分支不兼容时不覆盖。活动会话等待空闲，通过 live Session 的 `runMaintenance` / `append` 发布到既有流；已完成的冷会话仍使用独占持久化句柄。

进行中回合先通过 `sessionController.resolveAgent` 激活，再从 live Session 发布，避免普通恢复流程把刚导入的打开回合认作崩溃。maintenance 保留到观察到原生结束，每 5 秒检查原生文件的变化，窗口暂时隐藏也能收尾。DSH 收到新的用户输入或 Agent 被释放时，先以 `interrupted` 结束本地观察，再让宿主自己的工作继续；不打断外部 Claude/Codex。原生回合标识放在 `replayState.nativeTurnId`，进行中消息另记 `nativeComplete: false`。DSH 重启后从已记录的位置继续，不重发用户输入，不换会话 ID；重启导致的本地中断是一个边界，不会把每次轮询都各记作 Completed。

当前 Desktop 0.2.1-rc.5 的 `runMaintenance` 只更新 Session 投影，不更新 loop 另存的回合计数，直接追加回合后续聊会重复编号。同步在 maintenance 保留区内同步这个计数。这一处访问了 DSH 的内部 `phase.lastTurn`，不是公开 API；只在保留区形状与可写属性符合已验证实现时追加，其他 driver 暂缓同步，不猜测或写出不可恢复的日志。后续 DSH 若提供公开的外部回合导入或计数重读接口，应替换这里的兼容处理。

旧版本已经产生重复续段，或缺少首个系统节点的会话，由 `native/repair.mjs` 修复：仅处理纯导入事件、原生身份一致、没有 DSH 请求或收件事件且当前空闲的副本。从原生已完成回合创建新副本，保留标题、模型和思考等级，归档旧副本并迁移当前事项关联；旧日志仍在 DSH，原生记录只读。有真实 DSH 工作、未知事件、并发修改或归档失败时不替换。正常副本不会进入此迁移；同步响应中的 `replacements` 告知页面新身份，显式打开和预览会跟随它。

### 导入后继续对话的系统节点（2026-11-02）

v4 会话的第一个 surface 节点必须预留给系统提示。`native/session-events.mjs` 在第一个 `step/start` 后、第一条用户消息前写入空的 `system/message`，source 为当前格式的 `{ kind: 'system-prompt' }`。它不携带额外指令；DSH 在继续对话时通过自己的替换事件写入实际系统提示。增量同步不再添加这个开头节点。仅检查能否导入、读取历史，不能验证继续对话后的持久化兼容性；回归覆盖继续发送、重启与重新打开，其中 Codex 经真实 OAR/app-server 续聊，只将模型服务替换为测试模型。

此前适配器只用“最后一条不调用工具的输出”判断回合是否结束。旧回合在工具调用后中断、报错或结束，重开 DSH 后发新消息会被误认成仍在继续旧进程，出现 `The harness is no longer running this turn. Send the message again.`。现在以 DSH 的持久回合边界为准，只把本轮真实用户输入交给 OAR，历史里的任务、运行时上下文和指令不会重发。真正处在同一回合中途而进程已丢失时仍报错，避免静默重复执行工具。既没有 `sessionQuery.readSession` 也没有 `sessionController.inspect` 的旧宿主保留原来的消息推断，不具备这项恢复保证。

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

OAR 没有审批回复通道；Codex 的审批策略仍为 never。2026-11-03–04 起，Claude 改为使用原生权限评估，
`--permission-prompts none` 仅拒绝需要人工回复的调用，不再默认绕过权限。DSH 不会弹出 harness 的审批和提问。

| DSH 访问模式 | Claude | Codex |
| --- | --- | --- |
| 只读 | 原生 dontAsk，且不给 Bash、Edit、Write 等会写的工具 | 只读沙箱 |
| 工作区内修改 / 未指定 | 继承当前目录下 Claude 自己的权限设置 | 工作区可写沙箱 |
| 自动 | 原生 auto | 工作区可写沙箱 |
| 完全访问 | 原生 bypassPermissions | 完全访问 |

### Claude 默认模型、思考等级和 lark-cli（2026-11-03–04）

本机 Claude 2.1.317 的配置回读为 `model: sonnet`、`effort: xhigh`、`permissions.defaultMode: auto`。
此前分配逻辑默认强制只读，移除了 Bash；同时优先选字面名为 `default` 的模型，而目录将未提供的
思考等级填为 Medium。OAR 自身又固定带 `--dangerously-skip-permissions`，因此仅放回 Bash 并不等于恢复原生 Auto。

现在由仓库内的 OAR 通过 `get_settings` 回读实际启动目录的配置，不发送模型请求。目录按原生默认模型排序，
保留实际的默认思考等级和逐模型设置，`default` 等别名也使用同一解析模型的等级。分配与自动派工未命中
主人明确的访问规则时，Claude 使用这套默认值；模型输出不能自行要求跳过权限。ASSIGN.md 明确的只读等规则仍优先。
DSH 的“工作区可写”是宿主权限范围，Claude 在该范围对应的执行路径中继承原生权限；界面此处仍显示 DSH 的名称，
没有将 DSH 的全局 Auto 注册为一个无检查的占位。原生 Auto 是否启用仍由 Claude 的本机配置和原生策略决定。

旧事项会话只有在日志能确认它由嘟嘟以初始 `read-only` / `default` 创建，且相应的最近一次选择仍位于
第一条真实用户消息之前时，恢复流程才修正这些默认值。后续手动权限、模型与思考等级、显式规则、正在工作的会话均保留；
没有启动日志的导入会话不迁移。修正不发送任务、不增加进展、不改变事项工作流状态。

本机 `lark-cli --version` 可直接运行，版本 1.0.96，因此本次有证据的故障在于 Bash 被默认只读移除，
不是 CLI 没有安装。隔离的真实 Claude / OAR 已从实际 init 帧确认 `permissionMode: auto`，
请求模型为 Sonnet 5.5、effort 为 xhigh；真实 DSH 中也已执行无副作用的 `lark-cli --version`。
未用正式飞书账号发消息、修改其权限设置或执行写操作。具体飞书操作仍取决于原生权限、登录和 scope。

2026-11-04 的定向用例经分别复跑通过：真实 Claude / OAR 配置回读与 Auto init 帧、DSH 中实际执行
`lark-cli --version`、关闭后重开模型菜单仍勾选 Xhigh、显式只读仍不提供 Bash、启动阶段 / 等模型 / 工具运行时停止，
以及停止后复用同一原生会话。已查看 `.local/claude-defaults-nov04/effort-menu.png`。
日志在 `.local/pet-title-claude-nov04-unit.log`、`pet-title-claude-nov04-adapters.log`、
`claude-menu-bubble-nov04-e2e.log`、`pet-claude-nov04-e2e.log` 与 `claude-defaults-stop-nov03-e2e.log`。
这不代表所有环境的停止都在 200ms 内完成。

最终源码已经官方更新脚本打包；脚本在安装前命中 DSH 内部任务的热更新保护，正式 Desktop 仍运行旧构建。
因此旧会话默认值修正尚未在正式实例执行。最新打包 / 运行指纹与外部终端更新步骤见
[assistant.md](assistant.md) 的本批最终验证记录。未绕过保护或重启 Desktop。

Claude 的"工作区内修改"并没有真正的沙箱，这是和 Codex 的差别。Claude 想问用户问题的工具（AskUserQuestion）已关掉；
harness 对宿主发出的其他请求，本轮会以明确的错误结束，不会一直挂着。

## 已知限制

- 每轮启动一个 harness 进程，轮末结束。原生子智能体研究仍在运行时会延后轮末释放，直到实际结束、失败或主人停止；
  非智能体的后台 shell / MCP 任务不会单独延长进程生命，它们仍可能在轮末随进程结束。
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
说明进度。会话目录、完整对话文字和有序预览消息保存在插件自己的 SQLite，写入和查询在工作线程执行；重启先用缓存，
后台按来源版本更新，预览每页读 20 条消息。旧的搜索缓存需补一次消息顺序，不再每次打开都读原始记录。同步条件、
节流和迁移见 [assistant.md 的会话管理](assistant.md#会话管理)。工具结果、思考和图片字节不进这份文字缓存。
Orca 的删除、拖进终端、跨主机这些没有做。

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

## 2026-11-02：会话观察与 Agent 状态

发现、搜索、预览或导入已有 Claude、Codex 会话只读取内容，不自动创建事项。只有显式 Take over 才创建并绑定 issue；此前误收的事项不自动删除。已接管的原生会话与 DSH 副本按真实事件时间合并，DSH 的实时工作和待答请求优先；TUI 中更新的会话可以覆盖旧的 DSH 停止记录，之后更新的 DSH 事件又可覆盖旧的 TUI 记录。读取和采用会话不更新活动时间。

工作生命周期是 Idle、Working、Blocked（2026-11-03 起不再有 Done），独立于 issue 的 In Review、确认问题和提醒推迟。`turn/end` 一提交就结束 Working，不等后续的 running=false；正常结束、实际提问、授权和错误都是 Blocked（轮到主人了），主动停止是 Idle。DSH 侧栏保留 14px Agent Logo，右下角复用 Issues 的状态组件；未知供应商保持宿主原有展示。已阅读完成通知不会把 Blocked 改成 Idle。历史结束结果走 DSH 标准会话投影，原生状态按挂载行的 ID 批量读取，不反复扫描所有完整记录。

本次使用 Desktop 自带 CLI 的隔离 web 完成分配、提问、授权、失败恢复、停止、侧栏四种标记、原生会话发现/预览/导入/接管和小组件检查；ego-browser 另看了真实侧栏、工作中的 Logo 和平滑后的 ChatGPT SVG。热更新测试验证前后端同时切换、同一 DSH PID、同一浏览器文档、保留事项与布局。测试重打 tar 包时禁用 macOS AppleDouble 元数据，避免安装多出 `._` 文件而导致精确指纹不同。后端重载仍会释放供应商，未实现进行中 harness 轮次的保留。

正式会话中两次 `NO_ADAPTER` 已核对为当前 Codex 轮次自行执行 `desktop:update` 后发生：热更新撤下承载自己的供应商，下一步请求找不到适配器。更新脚本现在在安装与触发重载前检查调用进程的祖先链；默认热更新从 Desktop 的工作进程内发起时明确拒绝，已打好的包保留。应等任务结束后从外部终端更新；这项检查不表示外部终端热更能保留其他运行中的 harness。

## 2026-11-08：会话读取失败与预览诊断

原生与 DSH 会话索引在当前进程内停止自动重试失败的记录，只有显式刷新才重新尝试；进程重启会重新建立内存中的失败集合。Codex 目录含有已知 rollout 路径时，后台索引及冷预览检查该路径和同名 `.zst` 文件，由官方 app-server 读取内容。目录里的 `.jsonl` 路径在压缩后仍可能保持不变，不能只检查原路径就认定文件丢失。两种文件都不存在才直接失败。不会因此删除原生目录记录或修改会话。索引失败计数只包含没有可检索正文的记录，已有正文不会因刷新或补齐预览失败而被算成无法检索。

搜索与预览共用有序消息缓存，预览优先从插件 SQLite 分页读取，冷缓存才只读来源并补齐。`<状态目录>/diagnostics/sessions.jsonl` 持久化索引失败及预览来源、耗时、消息数和失败类别；不保存正文、路径、搜索词、凭据或上游错误原文。权限 `0600`，每份最多 256 KiB，保留当前与上一份；写入异步且有界。这里的本地诊断不进入 DSH 会话历史或模型输入。

同日只读排查 DUD-9 的引用显示：模型正文含有 `U+E200 cite U+E202 turn…view… U+E201` 这种网页来源引用标记，链接与引用 ID 仍在该会话前面的搜索工具结果中。嘟嘟弹窗复用 DSH 的 `conversation.content`，宿主的 MarkdownText 没有这套引用语法的解析，因而显示私用区字符和引用 ID。本次只确认此渲染缺口，没有改写历史正文、删掉来源引用或替换宿主聊天渲染器。
