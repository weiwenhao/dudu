import { T } from '../strings.js';
import { actorName, describe, isDiscussion, storedSystemText } from './activity.js';
import { statusLabel } from './workflow.js';
import { AGENT_NAMES } from './model.js';

// What the Copy menu puts on the clipboard (Linear's Copy submenu): the id, the title, the issue as Markdown, everything as Markdown, a git branch name and
// the issue as a prompt for an agent. All of it is plain text built from the issue as the page has it; nothing here talks to the store.

/** ASCII words of a title, joined by dashes, for a branch name; a title with no ASCII letters or digits (a Chinese one) gives nothing. */
export function slugOf(title, max = 40) {
  const slug = String(title ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/, '');
}

/** `hou-4-linux-cve`: the id in lower case and the words of the title (the id alone when the title has none). */
export function branchName(issue) {
  return [String(issue?.ref ?? '').toLowerCase(), slugOf(issue?.title)].filter(Boolean).join('-');
}

const heading = (issue) => `# ${[issue.ref, issue.title || T.detail.untitled].filter(Boolean).join(' ')}`;

/** The issue's title and description. */
export function issueMarkdown(issue) {
  return [heading(issue), String(issue.brief ?? '').trim()].filter(Boolean).join('\n\n');
}

const linkLine = (link) => `- [${link.title || link.url}](${link.url})`;
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Everything the issue page shows: the properties, the description, the links and the conversation and activity, oldest first (`log` is what `issues/get`
 * returns, newest first). The words are the page's own, so the text follows the language of the page.
 */
export function everythingMarkdown(issue, { log = [], links = issue.links ?? [] } = {}) {
  const lines = [];
  lines.push(`- ${T.fields.status}: ${statusLabel(issue.status)}`);
  if (issue.priority && issue.priority !== 'none') lines.push(`- ${T.fields.priority}: ${T.priority[issue.priority] ?? issue.priority}`);
  if (issue.agent) lines.push(`- ${T.fields.agent}: ${AGENT_NAMES[issue.agent] ?? issue.agent}${issue.agentState ? ` (${T.agentState[issue.agentState] ?? issue.agentState})` : ''}`);
  if (issue.project?.name) lines.push(`- ${T.fields.project}: ${issue.project.name}`);
  if (issue.labels?.length) lines.push(`- ${T.labels.name}: ${issue.labels.map((label) => label.name).join(', ')}`);
  if (issue.dueAt != null) lines.push(`- ${T.detail.dueDate}: ${dayOf(issue.dueAt)}`);
  if (issue.parent) lines.push(`- ${T.subIssues.subIssueOf}: ${[issue.parent.ref, issue.parent.title].filter(Boolean).join(' ')}`);
  const parts = [heading(issue), lines.join('\n')];
  if (String(issue.brief ?? '').trim()) parts.push(issue.brief.trim());
  if (links.length) parts.push(`## ${T.links.title}\n\n${links.map(linkLine).join('\n')}`);
  const entries = [...log].sort((a, b) => a.at - b.at || a.id - b.id).map((entry) => {
    const who = actorName(entry.actor);
    if (isDiscussion(entry)) return `- **${who}** · ${dayOf(entry.at)}: ${storedSystemText(entry).replace(/\n+/g, ' ')}`;
    const said = describe(entry);
    return `- **${who}** · ${dayOf(entry.at)}: ${said.sentence}${said.detail ? ` (${said.detail})` : ''}`;
  });
  if (entries.length) parts.push(`## ${T.detail.activity}\n\n${entries.join('\n')}`);
  return parts.join('\n\n');
}

/** The issue as work to hand to an agent (Linear's "Copy as prompt"). The wording is the issue's own: a title, its description, where to work and what to read. */
export function promptOf(issue, { links = issue.links ?? [] } = {}) {
  const lines = [`${issue.ref ? `${issue.ref}: ` : ''}${issue.title || T.detail.untitled}`];
  if (String(issue.brief ?? '').trim()) lines.push('', issue.brief.trim());
  const facts = [];
  if (issue.project?.path) facts.push(`Project folder: ${issue.project.path}`);
  else if (issue.project?.name) facts.push(`Project: ${issue.project.name}`);
  if (issue.labels?.length) facts.push(`Labels: ${issue.labels.map((label) => label.name).join(', ')}`);
  if (issue.dueAt != null) facts.push(`Due: ${dayOf(issue.dueAt)}`);
  if (facts.length) lines.push('', ...facts);
  if (links.length) lines.push('', 'Links:', ...links.map((link) => `- ${link.title && link.title !== link.url ? `${link.title}: ` : ''}${link.url}`));
  return lines.join('\n');
}

export const COPY_KINDS = ['id', 'title', 'markdown', 'everything', 'branch', 'prompt'];

/** The text of one kind of copy; `extra` is what only the page has ({ log, links }). */
export function copyText(kind, issue, extra = {}) {
  switch (kind) {
    case 'id': return issue.ref ?? '';
    case 'title': return issue.title ?? '';
    case 'markdown': return issueMarkdown(issue);
    case 'everything': return everythingMarkdown(issue, extra);
    case 'branch': return branchName(issue);
    case 'prompt': return promptOf(issue, extra);
    default: return '';
  }
}

