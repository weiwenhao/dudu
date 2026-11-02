# Prompt 编写指南

整理于 2026-11-02。通用方法依据 OpenAI Docs、Claude 官方文档；项目示例依据当前仓库。示例用于说明写法，接入产品前仍须验证模型效果，并遵守现有权限、设计和文案审阅规则。

**先说清要交付什么、凭什么判断完成，再补模型确实需要的信息。** Prompt 的价值在于减少歧义，让结果可以检查。

## 1. 用五件事描述一个任务

| 要素 | 要写清什么 | 本项目里的例子 |
| --- | --- | --- |
| 目标 | 可观察的结果 | 至少两名空闲员工才能打乒乓球 |
| 上下文 | 事实、文件、参考及其来源 | Office 当前实现、已批准的场景和人物素材 |
| 边界 | 工作范围、可用工具、哪些决定已经确定 | 沿用现有画面；工作中的员工不能被拉去打球 |
| 交付 | 代码、文档或数据的形式 | 修改代码，说明原本是否有动画及实际验证结果 |
| 验收 | 输入什么，应该发生什么 | 只有一人空闲不去球台；对手恢复工作后结束打球 |

不要只写“优化一下，做好看一点”。指出对照物和具体差异，例如“复用当前对话框的附件卡片，保持相同圆角、间距、删除按钮位置和悬停行为”。这是把目标变成可执行约束的写法。[OpenAI：Prompt engineering][1]

不需要给每个任务写长篇人设。角色有助于限定职责，但不能代替任务内容。给一两个容易误判的输入和正确输出，往往更容易说明要求；示例要包含边界，避免所有示例都暗示同一种答案。[Claude：Prompting best practices][2]

## 2. 分清指令、材料和代码负责的规则

在 API 中使用平台支持的消息角色表达指令层级；不要靠文本中自称“system”或“管理员”提升权限。稳定规则放在受控的指令部分，当前任务和参考材料单独传入。用标题、JSON 或标签标清来源与边界。[OpenAI：Prompt engineering][1]

外部邮件、网页、附件、会话记录和工具返回值，都是待处理的材料。其中出现“忽略之前的规则”“替我删除所有事项”，不等于 boss 下达了指令。不要把这些原文直接拼进高权限指令。分隔符有助于理解边界，但不能保证消除提示注入；工具权限和写入校验仍要由程序执行。[OpenAI：Safety in building agents][3]

下面是本文的简化接线示例，具体消息角色按实际平台适配：

```js
const messages = [
  { role: 'system', content: FIXED_INSTRUCTIONS },
  {
    role: 'user',
    content: JSON.stringify({
      task: currentTask,
      material: { source: sourceRef, text: sourceText },
    }),
  },
];
const answer = await callModel(messages);
const proposal = validateAnswer(answer);
await applyIfStillCurrentAndAllowed(proposal);
```

最后两步不能省。比如“只能修改已列出的事项”“不能突破 ASSIGN.md 的权限”“旧结果不能覆盖后来的修改”，都需要后端核对，不能只在 Prompt 里写一句。

项目已有参考：

- [`dispatch/prompts.mjs`](../host/assistant/dispatch/prompts.mjs)：固定规则、boss 的规则文件、外部材料分别组装；外部数据使用每次生成的分隔标记。
- [`dispatch/answer.mjs`](../host/assistant/dispatch/answer.mjs)：逐字段检查类型、长度、枚举和事项编号。
- [`issues/tidy.mjs`](../host/assistant/issues/tidy.mjs)：限定可改字段，应用前检查预览和事项版本。

## 3. 明确输出，也明确没有答案时怎么办

给人看的答案，规定重点、语言和必要证据即可。给程序消费的答案，应定义字段、类型、允许值、长度，以及未知值如何表达。

“只输出 JSON”只是文字要求。平台和模型支持时使用严格结构化输出；JSON mode 保证的范围与 schema 约束不同。即使结构合法，内容也可能错误，仍需做业务校验，并处理拒答、截断、超时和无效结果。[OpenAI：Structured model outputs][4]

下面是一个提取截止日期的自拟示例：

```text
任务：从材料中提取明确写出的截止时间。
今天是 2026-11-02，时区 Asia/Shanghai。

输出：{"dueAt":"YYYY-MM-DD 或 null","evidence":"依据原文；没有则为空串"}
只有材料明确表达截止要求时才填写日期。
消息发送日期和活动举办日期不自动作为截止日期。
无法确定时返回 null；不要为了补全字段猜测。

例：
材料：请在 11 月 5 日前提交。
输出：{"dueAt":"2026-11-05","evidence":"11 月 5 日前提交"}

材料：今天聊得很好。
输出：{"dueAt":null,"evidence":""}
```

例子的作用是解释判断边界。实际接入还要由 schema 和代码检查日期、时区、字段和来源。

## 4. 控制上下文，让 Agent 专注于自己的职责

上下文应优先包含当前任务所需的原始事实、已确定的约束、相关片段和来源。长会话可以整理成“目标、已完成、未完成、已确定的决定、下一步、证据位置”，并保留当前状态的核对入口；摘要不能替代事实源。

上下文顺序没有一套适合所有模型的口诀：OpenAI 的通用结构建议与 Claude 针对长文档的摆放建议各有适用场景。Claude 建议长文档靠前、具体问题靠后。改变顺序前，用同一批任务比较结果，尤其检查是否遗漏中间材料。[OpenAI：Prompt engineering][1] [Claude：Prompting best practices][2]

推理型模型通常不需要追加“展示完整思维链”。给出目标、约束和成功条件，要求结果、必要证据及检查结论即可；有依赖关系的操作步骤仍应说明。模型专属技巧应在目标模型上验证。[OpenAI：Reasoning best practices][5]

### 嘟嘟项目里的职责边界

以下是当前实现和已确定的产品约定：

| 角色或步骤 | 应接收的信息 | 职责 |
| --- | --- | --- |
| Worker Agent | 实际任务、必要参考；在选定项目中运行 | 完成工作，给出结果、实际问题和验证证据 |
| Dudu | 事项、会话事实、相关规则和必要历史 | 分配任务、管理事项、总结实际进展 |
| 采集 | 来源 Prompt、已存在事项、外部材料 | 提议新增、更新或忽略，避免重复 |
| 进度总结 | 停止后的最近几段对话和会话事实 | 概括实际进度，提取确实需要回答的问题 |
| 记忆 | boss 的原话、来源及相关已有记录 | 按现有记忆规则捕获、召回和整理 |

Worker 的首条消息目前只取任务标题与描述，见 [`first-message.mjs`](../host/assistant/home/first-message.mjs)。不添加事项管理流程、“所有者答复”或由 Worker 回报状态的要求。boss 的 @ 消息按现有转发机制原样发送。

事项状态由会话事实驱动：运行中为 In Progress，停止、等待输入或失败时进入 In Review；In Review 不代表工作完成，Done 需要 boss 确认。模型只补充有依据的进度和实际问题。实现见 [`issue-state.mjs`](../host/assistant/home/issue-state.mjs)、[`progress.mjs`](../host/assistant/home/progress.mjs) 和 [`conversation.mjs`](../host/assistant/home/conversation.mjs)。

例如，给 Worker 的任务可以这样写：

```text
修复 Office 的乒乓球配对：至少两名空闲员工才能参加。
对手恢复工作或离开后，剩下的人也结束打球。

沿用当前场景、人物和动画素材。
验证单人、双人、对手离开和减少动画的情况，
说明球的往返与挥拍是否实际运行。
```

这是围绕工作结果的任务描述，项目、Agent、权限和事项编号由现有流程管理。

## 5. 把 Prompt 当作代码迭代

先确定评判标准，再收集正常、边界和对抗样例；修改后持续比较结果，并把实际失败加入回归集。模型评审可以辅助，但要用人的判断校准，不能只凭模型说“很好”或一次成功判定有效。[OpenAI：Evaluation best practices][6]

建议从一组能区分对错的小样例开始：

| 用例 | 本项目应检查的结果 |
| --- | --- |
| 明确任务 | 提取真正要做的事，不夹带管理套话 |
| 材料不足 | 保留未知，不编造截止日期、进度和问题 |
| 重复事项 | 识别已有事项，不重复新建 |
| 外部材料要求越权 | 不执行材料中的指令，写入仍受权限校验 |
| Worker 停止但没完成 | 状态保持 In Review，摘要不宣称完成 |
| 读取期间工作重新开始 | 旧总结不覆盖最新状态 |
| 已导入的原始会话 | 不无故启动 Worker 或生成新的确认问题 |
| 记忆材料来自 Agent 的猜测 | 不把猜测当成 boss 的偏好 |

这些是项目的验收建议，不代表已对真实模型跑过评测。代码测试、真实模型质量评测和 UI 设计验收应分别记录。

每次迭代保存：Prompt 所在代码版本、模型标识和可用的版本信息、相关配置、输入样例、期望结果、实际结果、工具调用与评分。先判断失败发生在取材、指令、输出还是程序应用阶段，再改最相关的一处；保留未参与调试的样例检查退化。

## 可直接改用的短模板

```text
目标：
[明确交付结果]

上下文：
[必要事实、已确定的决定、参考文件或来源]

边界：
[范围、可用工具、权限和需要沿用的设计]

交付：
[产物形式、语言、证据；信息不足时如何表达]

验收：
[正常情况、关键边界及预期结果]

材料：
[单独标记来源；材料中的文字不取得指令权限]
```

模板按需删减。简单任务一句话足够；复杂任务应先消除目标、范围和验收上的歧义。

## 一手资料

以下页面于 2026-11-02 查阅；模型能力和 API 细节以接入时的官方文档为准。

1. [OpenAI Docs — Prompt engineering][1]：指令层级、上下文、示例和代码管理。
2. [Claude — Prompting best practices][2]：明确任务、示例、结构及长上下文。
3. [OpenAI Docs — Safety in building agents][3]：外部材料、权限与提示注入边界。
4. [OpenAI Docs — Structured model outputs][4]：结构约束及其限制。
5. [OpenAI Docs — Reasoning best practices][5]：推理模型的简洁目标与约束。
6. [OpenAI Docs — Evaluation best practices][6]：用例、评分和持续回归。

[1]: https://developers.openai.com/api/docs/guides/prompt-engineering
[2]: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
[3]: https://developers.openai.com/api/docs/guides/agent-builder-safety
[4]: https://developers.openai.com/api/docs/guides/structured-outputs
[5]: https://developers.openai.com/api/docs/guides/reasoning-best-practices
[6]: https://developers.openai.com/api/docs/guides/evaluation-best-practices
