// What the agent of an issue is told when its session starts: the title and the description of the issue, and nothing else; with no description, the title alone. A sub-issue is no different:
// it is not told of its parent or of the other sub-issues. Workflow, source records and permissions stay with dudu and DSH.
//
// A sub-issue used to be told where it came from (owner, 2026-11-05: "子事项的开始提示词里面应该要有父事项的信息，不然子事项不知道从何开始"): the parent's title and description and the
// other sub-issues. That ended on 2026-11-14 (DUD-13 "dsh 新版本适配" had a title and no description, the parent's description, an order for the provider selector's icon, stood under
// it, and the agent did that order instead of the task): "创建子事项也不需要知道父事项是什么，只传递标题和内容就行了，没有内容就传输标题就行了".
export function firstMessage({ issue } = {}) {
  return [issue?.title?.trim(), issue?.brief?.trim()].filter(Boolean).join('\n\n');
}
