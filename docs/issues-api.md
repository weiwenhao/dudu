# dudu Issues API

事项的 HTTP 调用和嘟嘟作用域工具共用 `host/assistant/issues/api.mjs` 的 `createIssueCommands`。数据契约在 `host/assistant/issues/contract.mjs`；数据库负责字段校验、项目约束、事务和记录。

## 发现和认证

在已认证的 DSH 连接上发送：

```http
POST /api/dudu/issues/schema
Content-Type: application/json

{}
```

返回 `{ "outcome": "success", "apiVersion": 1, "document": { ... } }`，其中 `document` 是 OpenAPI 3.1 文档。每个操作都是 `POST /api/dudu/issues/{action}`，请求体是一个 JSON 对象。依赖 DSH 现有连接认证，不新增匿名入口、独立 MCP 服务或手机 RPC 代理。

嘟嘟通过 `issues_schema` 读取同一份契约。工作 Agent 不获得这些管理工具。

## 标识

`id` 是内部数值主键，跨排序、项目变更和重启保持稳定。无项目事项的 `ref` 为 `null`，界面不显示编号。

项目事项的 `ref` 如 `APP-1`，由最多 3 个大写英文字母和该项目内的序号组成。项目前缀取规范化项目名中的前 3 个英文字母；没有则取目录名，仍没有则用 `PRJ`。前缀重复时以字母替换末尾区分（如 `APP`、`APA`、`APB`），长度仍不超过 3。项目按目录识别；改名保留关键词，同名的其他目录取得不同关键词。序号不会复用。换项目获得该项目的预留号；移回时恢复旧号，清掉项目后隐藏编号。

数据库版本 4 自动缩短旧前缀，优先保留已经合规的前缀，不改变内部 `id`、项目序号、预留号、活动或会话关联。迁移后使用新的完整编号查找。

操作可使用数值 `id`、它的十进制字符串、`#12`，或者当前项目编号。编号大小写不敏感。项目发生变更后，旧项目编号不再解析到该事项。长期引用优先保存数值 `id`。

## 操作

| 操作 | 请求要点 | 作用 |
|---|---|---|
| `list` / `facets` | `tab`、`filter`、`group`、`order`、`cursor` | 与仪表盘相同的筛选、分组和游标分页 |
| `get` | `id`，可选 `logLimit` / `logCursor` | 事项、会话关联和活动 |
| `add` | `fields`，必填 `title` | 新建事项，已有 Agent 分配时接通工作会话 |
| `update` | `id`、`patch`，可选 `reason` | 修改并写入记录 |
| `assign` | `id`、`agent`，可选 `project` / `session` | 先有绝对路径项目，再交给 Agent；相同 Agent 的已有会话保留 |
| `message` | `id`、`text`，可选 `attachmentIds` / `requestId` / `initial` | 唯一留言框的路由规则；附件可以单独发送 |
| `log` | `id`、`kind`、`text`，可选 `data` | 追加活动 |
| `reply` | `id`、`text` | 兼容的提问回复操作；界面使用 `message` |
| `complete` / `cancel` | `id`，可选 `outcome` / `reason` | 完成或取消，接通会话收起 |
| `snooze` | `id`、`until` | 时间为毫秒；`null` 清除推迟 |
| `resume` | `id` 或 `session` | 恢复已有会话，不创建另一份工作 |
| `session` | `id` | 读取原生 `sessionId`、`provider` 和 `command`；Claude/Codex 返回可复制的 resume 命令 |
| `source` | `id` | 读取事项来自哪个连接器和原文链接：`{ source: { connector, name, url, from, at, title } }`，没有可打开的来源时是 `null`；事项页的“来源”组用它 |
| `delete` | `id`；确认时加预览返回的 `token` | 确认后停止和归档关联会话，持久移出嘟嘟目录，再删除事项 |
| `forget` | `id`；确认时再给预览返回的 `token` | 预览后删除本地事项，预览过期时重新确认 |
| `search` | `q`，可选 `tab` / `limit` | 文本、项目编号或内部 `#id` 搜索 |
| `counts` / `office` | `{}` | 计数、办公室完整统计和已分配事项 |
| `statuses` | `{}` | 当前和归档的状态定义、各状态计数 |
| `status-add` | `fields: { name, category, color?, description? }` | 主人新增事项状态 |
| `status-update` | `id`、`patch: { name?, color?, description?, isDefault?: true }` | 编辑名称、颜色、描述或默认值 |
| `status-order` | `category`、`ids`（该类全部有效状态） | 分类内排序 |
| `status-remove` | `id`，有事项时必填 `replacement` | 同类替代并归档原定义，保留历史 |
| `events` / `export` | 可选事件筛选 / `{}` | 审计和导出，含项目编号预留 |

列表一页最多 200 项；`nextCursor` 原样传回下一次请求。`schema` 描述字段形状和枚举；业务规则仍以操作返回为准。

schema v5 增加可自定义的事项状态。`status` 是 `statuses` 返回的稳定 id（初始六个 id 保持兼容），`statusType` 是六个基础类型之一，供结束、自动状态和统计使用；名称修改不改变 id。分类为 `backlog / unstarted / started / completed / canceled`，每类至少保留一个。删除有事项的状态必须指定同类有效状态替代；定义归档后仍供历史显示，不能再直接赋给事项。新建默认值只能使用未结束分类。重新标记同类已结束事项保留完成时间和结果。

这四个设置写操作只接受可信主人作用域；请求体的 `actor` 无法绕过。嘟嘟只获得 `issues_statuses` 读取工具，可以使用已有定义管理事项，不能自行修改工作流。`list` 同时返回状态定义，菜单、筛选和分组据此显示名称与颜色；导出也包括归档定义。

显示选项默认按独立的 `agentState` 分组，次级分组同样支持它；API 的未传分组保持平铺兼容。工作状态由会话事实得到，与事项的自定义状态相互独立；主人可以用 `update` 的 `patch.agentState`（`idle`、`blocked`，`null` 收回；2026-11-03 起没有 `done`，正常结束和提问、出错一样是 `blocked`，旧值迁成 `blocked`）对一个有智能体、且没有在工作的事项说它的状态，这句话只在会话的状态不变时有效，之后以事实为准（`working` 不能写）。`agentState` 有四个值：`working`、`blocked`、`idle` 和 `unassigned`（2026-11-05：没有分配智能体的事项，筛选、分组都认；它不能写）；会话被停止或被终端中断（会话状态 `stopped`）是 `blocked`，没有靠时间变成 `idle` 的规则（2026-11-07 主人去掉了原来“正常结束 12 小时没人处理就是 `idle`”的一条）：`idle` 只有会话本来空闲、或主人自己说的两种来路。`list` 的 `agentState` 永远是有效值，不含内部的依据字段。`agentFinished`（只读的布尔值）在 `agentState` 是 `blocked`、而原因是这一轮正常结束时为 `true`（头像右下角画绿底白勾，不是红点；主人 2026-11-04），提问、授权、出错和主人自己说的 `blocked` 都没有这个字段；它不是状态，分组、筛选和计数不看它。状态在界面上叫 `Needs you` / `需要你`（键仍是 `blocked`）。`deepSleep`（只读的布尔值，2026-11-04）在这个事项的智能体深度睡眠时为 `true`：智能体标记是空闲（会话自己空闲，或者你说了空闲），**或是正常结束在等你看的绿勾（`agentFinished`，2026-11-07：它睡着仍是 `blocked`、仍是绿勾）**、会话是 DSH 会话（嘟嘟起的或接管的）、这一轮已经结束（不是在跑、也不是在等你回答问题或授权），30 分钟里没人处理（会话自己没动静、你没对它说话也没打开它）；醒着的、红点的（提问、授权、出错、停止，包括你说的 `blocked`）、工作的、终端会话的都没有这个字段。它不是状态，不改 `status` 和 `agentState`，分组、筛选和计数不看它；Office 在睡眠区床上的人、休息区里睡着的绿勾的人嘴旁画 `ZZZ`；头像上月牙只给空闲的，绿勾仍画绿勾。设置里的“深度睡眠”（`assistant/settings` 的 `deepSleep`，默认开）关着时，没有事项有这个字段。时间可以用环境变量 `DUDU_DEEP_SLEEP_MS`（毫秒）缩短，只给测试用。`list.items[].progressSummary` 取已存进度末段的第一句；不读会话、不生成文本、不改历史。`list.items[].preview`（2026-11-18，主人：“和会话一样，desc 部分展示最新的消息”）是会话列表在标题下显示的那一句：会话最近一次完整回复的最后一段，压成一行、最多 300 字符，来自会话活动的同一份事实（`attention.preview`），没有会话或还没有回复时是空串；只出现在 `list` 的每一项里，`get` 没有。看板卡片的描述用它，没有它才用 `progressSummary`。

**标签和子事项**（2026-11-05）：事项有 `labels`（写入时是标签 id 的数组，每个至多一次、最多 50 个，id 必须是已有的标签；读出时是 `[{ id, name, color }]`）和 `parent`（写入时是另一个事项的 id 或 null；读出时是 `{ id, ref, title, status, statusType, subIssues? }` 或 null）；有子事项的事项还有只读的 `subIssues: { total, done }`（done 数 `done` 类型的），`get` 另外给只读的 `children`（子事项的完整列表）。`parent` 不能是事项自己或它的子孙；父事项被 `forget` 后子事项的 `parent` 变成 null。标签动作：`labels`（列出 `[{ id, name, color }]`）、`label-add`（`fields: { name, color }`，名字去空白、不分大小写不能重复、最多 50 字，颜色是 `grey|darkGrey|purple|teal|green|yellow|orange|pink|red`，默认 `darkGrey`）、`label-update`（`id`、`patch: { name?, color? }`，只有主人）、`label-remove`（`id`，从所有事项上摘掉，只有主人）。`list`/`facets` 的筛选有 `label`（标签 id 数组，任一即可）；`facets` 多一个 `label`（每个标签 `{ key: id, label: 名字, color, count }`，没有事项用的标签也列，数量 0）。

**链接**（2026-11-05）：事项可以挂任意多条链接，每条 `{ id, url, title, kind }`，`kind` 是 `link`、`pull_request` 或 `document`。地址必须是 http 或 https；同一事项里同一个地址只能有一条；`title` 最多 200 字，没写就用地址生成（GitHub 的 pull request 是 `owner/repo #12`，GitLab 的 merge request 是 `组/项目 !7`，别的是去掉 `www.` 的主机名和路径，最多 60 字）。地址自己说明了是什么就按它定（GitHub、GitLab 的合并请求是 `pull_request`；飞书、Google 文档、Notion、Atlassian 是 `document`），否则按调用者给的 `kind`。不会去访问这个地址。动作：`link-add`（`{ id, fields: { url, title?, kind? } }`）和 `link-remove`（`{ id, linkId }`），都返回 `{ link, links, issue }`；`get` 返回的 `issue.links` 是全部链接，最早的在前。加链接和去掉链接都会更新事项的 `updatedAt` 并留一条事件（`link-add` / `link-remove`），但这两个事件不能撤销，去掉了就再加。事项被删除时它的链接一起删除；`export` 多一个 `links`。

**描述历史**（2026-11-05）：描述（`brief`）的每次修改本来就是一条 `issues/events` 事件，带修改前后的文字，界面的“Show description history”就是从这些事件算出版本（最新的是现在这版，最早的是写成时的样子；从没改过的事项没有历史）。恢复一个版本是再改一次描述，所以也进历史。描述现在存 Markdown（见 `docs/assistant.md` 的“描述是富文本”）。

`get` 的活动 `log` 按记录编号倒序分页，`nextLogCursor` 原样传回 `logCursor`。另返 `activeQuestion`（当前 `ask` 对应的最新 `blocked` 记录，无则为 `null`），即使提问不在本页也保留真实时间和编号。界面按 `at`、`id` 升序展示讨论，将当前提问放在其发生位置，并按编号去重。

```json
{
  "fields": {
    "title": "修复导出",
    "brief": "导出的 CSV 应保留完整的中文内容。",
    "project": { "name": "App", "path": "/work/app" }
  }
}
```

创建后可向 `assign` 发送：

```json
{ "id": 12, "agent": "claude" }
```

Agent 的工作消息只有标题和描述；事项流程、状态、活动和访问说明不拼进去。访问方式仍由 DSH 的权限模式执行。

分配后 Agent 和 project（名字、目录）不可变；`assign`、`update` 和工具遵守相同约束。相同 Agent 的重复分配保留当前会话。内部原生会话导入仍可将 `claude:<id>` / `codex:<id>` 关联转换成对应的 `dsh:<id>`。

## 留言和接管

`message` 未带 @ 时只保存留言。所有事项都接受 `@Dudu`；已分配事项还接受对应的 Agent，界面名称统一为 `@Claude`、`@ChatGPT`、`@DeepSeek`。提及大小写不敏感，旧的 `@codex` 等写法继续兼容；`@ChatGPT` 路由到内部 `codex` 标识。提及不改变分配，也不新建会话。给 Agent 的消息只去掉 @ 路由标记，原样进入已有会话的用户消息队列，不附带事项上下文，不解析问题答案或权限。当前工具仍在等待时，消息排队；使用 DSH 自己的问题/授权控件或兼容的显式 `reply` API 才能解除那种阻塞。`@Dudu` 走嘟嘟的持久对话，带事项定位，不调用工作 Agent。

### 留言附件

附件属于事项，不要求分配 Agent 或建立会话。字节使用 DSH 的不可变附件存储，事项 SQLite 保存附件归属和留言绑定；图片沿用 DSH 的解码校验、大小限制和规范化，普通文件逐块保存原始字节。

两个专用二进制接口依赖同一 DSH 连接认证，不接受客户端自报的存储引用：

- `POST /api/dudu/issues/attachment-upload?id=12&type=image&name=design.png`：请求体为原始文件字节，图片提供实际 `Content-Type`；`type` 为 `image` 或 `file`。成功返回 `{ outcome: "success", item: { id, type, attachment } }`。`item.id` 是服务端生成、只属于这个事项的不透明标识。
- `GET /api/dudu/issues/attachment?id=12&key=<item.id>`：读取该事项的附件；`download=1` 下载。普通文件始终以 `application/octet-stream` 和 `Content-Disposition: attachment` 返回，保留 UTF-8 文件名，禁止 MIME 猜测和活动文档执行。图片仅展示经 DSH 校验的 PNG、JPEG、WebP、GIF；其他格式按文件处理。

上传完成后提交：

```json
{
  "id": 12,
  "text": "@DeepSeek 请看附件",
  "attachmentIds": ["服务端返回的附件标识"],
  "requestId": "本次提交的唯一标识"
}
```

`attachmentIds` 保持文件顺序，最多 100 个、不能重复；只能使用当前事项尚未绑定留言的附件。所有引用校验、留言保存和附件绑定在一个事务里，任何一个引用错误都不留下半条留言。`text` 可以为空，但必须有附件；只写 `@Dudu` / `@Agent` 并附文件也可以。没有 `@` 不投递模型；有 `@` 时，将保存的图片和文件通过 DSH 的图片与会话文件收据协议送到对应会话。

`requestId` 对同一事项和调用身份幂等：原文和附件顺序相同的重试返回原留言及 `no_op`，不会再次投递；内容不同拒绝。留言的 `data.attachments` 包含可信附件元数据，重开页面和服务重启后仍可读取；跨事项标识、已删除事项和未认证请求不能读取。导出包含已绑定附件的元数据，未发送草稿不导出。放弃的上传记录目前随事项保留，底层内容对象的保留策略由 DSH 管理。

新建事项附带的图片和文件（2026-11-19，DUD-15）使用 `initial: true` 标记第一条附件留言：文字为空、必须有已上传附件，并且保存时事项尚未建立会话；相同 `requestId` 的已完成提交在会话建立后仍可幂等重试。桌面和手机使用同一创建顺序：先以未分配状态保存事项，完成上传和附件留言绑定后，再分配所选智能体。首次消息把标题、描述与这些附件一起提交给 DSH；普通文件在目标会话建立后取得该会话的上传收据。未选择智能体时，标记保留在 SQLite，稍后首次分配仍读取这些附件。普通讨论附件不因此投递，父事项的附件也不读取。上传失败不启动智能体；首次发送前若图片读取或文件收据失败，空会话按既有失败路径收起，不降级成纯文字发送。已有会话不重放首次消息，旧会话历史也不改写。

接管已有对话使用同一认证下的 `POST /api/dudu/sessions/takeover`：

```json
{ "provider": "claude", "id": "原生会话编号" }
```

`provider` 为 `dsh`、`claude` 或 `codex`。接管从会话目录取原项目、Agent 和标题，嘟嘟读最近的对话，总结任务与进度写进 `brief`；只建立事项关联和后续观察，不向工作会话发送消息。原生会话通过既有加载流程将历史导入当前 DSH，原生身份仍保留。

重复点击、并发点击以及原生会话和 DSH 副本的别名返回同一事项。缺失项目、不可读取的历史、无效模型结果不会创建半条事项。

按主人 2026-11-03 的决定，事项 `status` 由 boss 手动管理，独立于 `agentState`。分配、启动、恢复、停止、失败、等待回复或授权、插件重载均不改已有 status；Backlog 可以包含正在调研的 Agent。接管的新事项沿用主人配置的默认 status，不从会话活动推断流程阶段，模型返回的状态不被采纳。`agentState` 仍实时映射 `working / blocked / idle`（等回复或授权、出错、正常结束都是 `blocked`），实际问题保留到 `ask`，真实停止后只补一句事实进度，Done 和 Canceled 不自动重开。

## 删除范围

`delete` 与 `forget` 都需要当前事项的预览令牌。错误、过期或事项已变化的令牌不会开始清理。`delete` 对当前和历史会话调用 DSH 的 `archiveSession(..., { stopActivity: true })`，并在 `links.json` 保存移除标记；旧 DSH 副本及后台待回答采集不会自动恢复事项。Claude/Codex 原生会话仍可在会话管理中搜索、预览和手动重新导入，导入创建新的 DSH 副本，单独导入不恢复事项；显式接管才新建事项。与其他事项共享的原生/DSH 别名保留。清理失败返回 `session_cleanup_failed`，事项保留供重试。

DSH 当前公开持久化接口没有物理删除会话日志的方法。因此 `delete` 清理的是运行、侧栏和嘟嘟管理关联，DSH 日志及 Claude/Codex 原生会话文件仍保留；不能将这个结果描述成源记录已物理删除。

## 返回与身份

HTTP 200 表示操作已被处理。调用方仍须检查 `outcome`：

- `success`：成功，通常含 `issue`、`eventId`。
- `no_op`：已有同样结果，如重复接管。
- `needs_clarification`：输入或业务条件不满足。
- `error`：不存在、服务不可用或交付失败。

无法解析的 JSON 或非对象请求返回 HTTP 400；未知 HTTP 操作返回 404；未处理的存储错误返回 500。留言已存但转发失败时为 `error`、`code: "delivery_failed"`、`saved: true`，界面保留这条留言，避免重复保存。

调用身份来自受信任的注册入口：HTTP 为 `owner`，嘟嘟工具为 `dudu`。请求中的 `actor` 不能覆盖身份。嘟嘟工具额外保留管理约束：只按规则分配、不任意修改来源与会话身份、Done 使用专门工具并等待主人确认。
