# dudu Issues API

事项的 HTTP 调用和嘟嘟作用域工具共用 `host/assistant/issues/api.mjs` 的 `createIssueCommands`。数据契约在 `host/assistant/issues/contract.mjs`；数据库负责字段校验、项目约束、事务、记录和撤销。

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

项目事项的 `ref` 如 `APP-1`，由最多 3 个大写英文字母和该项目内的序号组成。项目前缀取规范化项目名中的前 3 个英文字母；没有则取目录名，仍没有则用 `PRJ`。前缀重复时以字母替换末尾区分（如 `APP`、`APA`、`APB`），长度仍不超过 3。项目按目录识别；改名保留关键词，同名的其他目录取得不同关键词。序号不会复用。换项目获得该项目的预留号；移回、撤销时恢复旧号，清掉项目后隐藏编号。

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
| `message` | `id`、`text` | 唯一留言框的路由规则 |
| `log` | `id`、`kind`、`text`，可选 `data` | 追加活动 |
| `reply` | `id`、`text` | 兼容的提问回复操作；界面使用 `message` |
| `complete` / `cancel` | `id`，可选 `outcome` / `reason` | 完成或取消，接通会话收起 |
| `snooze` | `id`、`until` | 时间为毫秒；`null` 清除推迟 |
| `undo` | 可选 `target: { eventId }` / `{ groupId }` 或事件数值 | 撤销可撤销的修改，保留之后的编辑 |
| `resume` | `id` 或 `session` | 恢复已有会话，不创建另一份工作 |
| `session` | `id` | 读取原生 `sessionId`、`provider` 和 `command`；Claude/Codex 返回可复制的 resume 命令 |
| `delete` | `id`；确认时加预览返回的 `token` | 确认后停止和归档关联会话，持久移出嘟嘟目录，再删除事项 |
| `forget` | `id`；确认时再给预览返回的 `token` | 预览后删除本地事项，预览过期时重新确认 |
| `search` | `q`，可选 `tab` / `limit` | 文本、项目编号或内部 `#id` 搜索 |
| `counts` / `office` | `{}` | 计数、办公室完整统计和已分配事项 |
| `events` / `export` | 可选事件筛选 / `{}` | 审计和导出，含项目编号预留 |

列表一页最多 200 项；`nextCursor` 原样传回下一次请求。`schema` 描述字段形状和枚举；业务规则仍以操作返回为准。

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

分配后 Agent 和 project（名字、目录）不可变；`assign`、`update`、工具和撤销遵守相同约束。相同 Agent 的重复分配保留当前会话。内部原生会话导入仍可将 `claude:<id>` / `codex:<id>` 关联转换成对应的 `dsh:<id>`。

## 留言和接管

`message` 未带 @ 时只保存留言。所有事项都接受 `@Dudu`；已分配事项还接受对应的 Agent，界面名称统一为 `@Claude`、`@ChatGPT`、`@DeepSeek`。提及大小写不敏感，旧的 `@codex` 等写法继续兼容；`@ChatGPT` 路由到内部 `codex` 标识。提及不改变分配，也不新建会话。给 Agent 的消息只去掉 @ 路由标记，原样进入已有会话的用户消息队列，不附带事项上下文，不解析问题答案或权限。当前工具仍在等待时，消息排队；使用 DSH 自己的问题/授权控件或兼容的显式 `reply` API 才能解除那种阻塞。`@Dudu` 走嘟嘟的持久对话，带事项定位，不调用工作 Agent。

接管已有对话使用同一认证下的 `POST /api/dudu/sessions/takeover`：

```json
{ "provider": "claude", "id": "原生会话编号" }
```

`provider` 为 `dsh`、`claude` 或 `codex`。接管从会话目录取原项目、Agent 和标题，嘟嘟读最近的对话，总结任务与进度写进 `brief`；只建立事项关联和后续观察，不向工作会话发送消息。原生会话通过既有加载流程将历史导入当前 DSH，原生身份仍保留。

重复点击、并发点击以及原生会话和 DSH 副本的别名返回同一事项。缺失项目、不可读取的历史、无效模型结果不会创建半条事项。

接管后的后续观察以 `docs/assistant.md` 2026-11-01 最新补充为准：来源为 `session` 的已有对话不自动调用模型评论或编造问题；运行中为 In Progress，正常结束、中断、失败、空闲、等回复或授权均为 In Review。这个状态只表示 boss 或嘟嘟需要介入，不表示工作已完成，`ask` 可以为空；真正恢复执行后才回到 In Progress。Done 和 Canceled 不自动重开。内部 `agentState: needs_you` 为接口兼容保留，界面复用 In Review / 待审核，不再显示 Needs you。

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

调用身份来自受信任的注册入口：HTTP 为 `owner`，嘟嘟工具为 `dudu`。请求中的 `actor` 不能覆盖身份；撤销也使用入口身份。嘟嘟工具额外保留管理约束：只按规则分配、不任意修改来源与会话身份、Done 使用专门工具并等待主人确认。
