// A sub-issue's agent is told where its issue comes from (owner, 2026-11-05: "子事项的开始提示词里面应该要有父事项的信息，不然子事项不知道从何开始"): the parent's title and
// description, and what the other sub-issues of that parent are (and which of them are done). Nothing else about how dudu manages issues goes in.
const PARENT_BRIEF_MAX = 3000;
const SIBLINGS_MAX = 12;
const cjk = (text) => /[㐀-鿿]/.test(text);
const WORDS = {
  zh: { parent: '所属的父事项', siblings: '同一个父事项下的其他子事项', done: '已完成', canceled: '已取消' },
  en: { parent: 'Parent issue', siblings: 'Other sub-issues of the same parent', done: 'done', canceled: 'canceled' },
};
const cut = (text, max) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);
const name = (issue) => [issue.ref, issue.title?.trim()].filter(Boolean).join(' ');

/**
 * The part of the first message that says where a sub-issue comes from: the parent issue (`parent`, with its description) and the other sub-issues of it (`siblings`).
 * The words follow the language of the issue itself. Nothing for an issue that has no parent.
 */
export function parentContext({ issue, parent, siblings = [] } = {}) {
  if (!issue?.parent && !parent) return '';
  const zh = cjk(`${issue.title ?? ''}${issue.brief ?? ''}`);
  const words = WORDS[zh ? 'zh' : 'en'];
  const colon = zh ? '：' : ':';
  const head = parent ?? issue.parent;
  const lines = [`${words.parent}${colon} ${name(head)}`];
  const brief = parent?.brief?.trim();
  if (brief) lines.push('', cut(brief, PARENT_BRIEF_MAX));
  const others = siblings.filter((item) => item.id !== issue.id).slice(0, SIBLINGS_MAX);
  if (others.length) {
    lines.push('', `${words.siblings}${colon}`);
    for (const item of others) {
      const mark = item.statusType === 'done' ? ` (${words.done})` : item.statusType === 'canceled' ? ` (${words.canceled})` : '';
      lines.push(`- ${name(item)}${mark}`);
    }
  }
  return lines.join('\n');
}

/**
 * The worker gets the task itself. Workflow, source records and permissions stay with dudu and DSH. A sub-issue's task starts with where it comes from: `issues` is the
 * issues store, read for the parent and its other sub-issues.
 */
export function firstMessage({ issue, issues } = {}) {
  let context = '';
  if (issue?.parent && issues?.get) {
    try {
      const got = issues.get(issue.parent.id, { logLimit: 1 });
      if (got.outcome === 'success') context = parentContext({ issue, parent: got.issue, siblings: got.issue.children ?? [] });
    } catch { /* the task itself is still given */ }
  }
  if (issue?.parent && !context) context = parentContext({ issue });
  return [issue.title?.trim(), issue.brief?.trim(), context].filter(Boolean).join('\n\n');
}
