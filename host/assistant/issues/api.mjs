// The issues store over HTTP, for the desktop interface: POST /api/dudu/issues/<action> with one JSON object, answered with JSON.
// The store never throws for a wrong value, it answers { outcome: 'needs_clarification', message, next }; so a request fails
// only when the body is not JSON, the action is unknown, or the database does.
//
// The page is the owner: every change it makes is written as the owner, whatever `actor` the body says. It may send `reason`
// and `groupId` (several changes logged together).
//
// The plugin hooks into three actions, each optional (`createIssuesApi({ issues, onReply, onAssign, onResume })`): a hook never fails
// the change that was made, a failure of it is only reported on the console.
import { issueMessage } from './message.mjs';
import { issueApiDocument } from './contract.mjs';
const NO_STORE = { 'cache-control': 'no-store' };

const meta = ({ reason, groupId }, { actor = 'owner' } = {}) => ({ reason, groupId, actor });

// Only DSH prompt images and session-scoped upload receipts may accompany a forwarded message.
// DSH remains responsible for byte validation, model image support, size limits and receipt ownership.
function forwardAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) return null;
  const items = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    if (item.type === 'file' && typeof item.receiptId === 'string' && /^[\x21-\x7e]{1,512}$/.test(item.receiptId)) {
      items.push({ type: 'file', receiptId: item.receiptId });
    } else if (item.type === 'image' && ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(item.mediaType)
      && typeof item.data === 'string' && item.data.length > 0 && (item.name === undefined || typeof item.name === 'string')) {
      items.push({ type: 'image', mediaType: item.mediaType, data: item.data, ...(item.name === undefined ? {} : { name: item.name }) });
    } else return null;
  }
  return items;
}

async function hand(hook, ...args) {
  try { return await hook?.(...args); } catch (error) { console.warn(`[dudu] An issue hook failed: ${error.message}`); return undefined; }
}

// The owner's answer to what an agent asked: it goes into the log as a decision and clears the question (the page's Needs you mark
// goes with it). `onReply(issue, text)` is the plugin's hand-over of the answer to the agent's session, when there is one.
async function reply(issues, { id, text, ...rest }, scope) {
  const { onReply } = scope;
  const logged = issues.log(id, { kind: 'decision', text, ...meta(rest, scope) });
  if (logged.outcome !== 'success') return logged;
  const cleared = issues.update(id, { ask: '' }, meta(rest, scope));
  const issue = cleared.issue ?? logged.issue;
  await hand(onReply, issue, text);
  return { outcome: 'success', issue, entry: logged.entry };
}

// Naming an agent gives the issue to it. `onAssign(issue)` is the plugin's start of the work (a session for the agent). Naming the agent the
// issue has already, while it has a session, changes nothing: the session that works is not thrown away for a click on the same name.
async function assign(issues, { id, agent, session, project, ...rest }, scope) {
  const { onAssign } = scope;
  if (agent && session === undefined) {
    const current = issues.get(id, { logLimit: 1 });
    if (current.outcome === 'success' && current.issue.agent === agent && current.issue.session && (!project || project.path === current.issue.project?.path)) {
      return { outcome: 'no_op', message: 'The issue has this agent and its session already.', issue: current.issue };
    }
  }
  const result = issues.assign(id, { agent, session, ...(project === undefined ? {} : { project }), ...meta(rest, scope) });
  if (result.outcome === 'success') await hand(onAssign, result.issue);
  return result;
}

// Puts a session back in DSH's sidebar, where it was folded away: the session of the issue `id`, or the session `key` (what the page is
// about to open, whether or not an issue holds it). `onResume(issue)` answers like any operation; for a key alone it is told { id: null, session }.
async function resume(issues, { id, session }, { onResume }) {
  let issue;
  if (id !== undefined) {
    const got = issues.get(id, { logLimit: 1 });
    if (got.outcome !== 'success') return got;
    issue = got.issue;
  } else if (typeof session === 'string' && session) {
    issue = { id: null, session };
  } else {
    return { outcome: 'needs_clarification', message: 'resume needs an issue id or a session key.', next: 'Call again with id or session.' };
  }
  if (!onResume) return { outcome: 'no_op', message: 'Sessions are not kept by this plugin.', issue };
  const result = await hand(onResume, issue);
  return result ? { issue, ...result } : { outcome: 'error', message: 'The session could not be put back.', issue };
}

const CALLS = {
  statuses: (issues) => issues.statuses(),
  'status-add': (issues, { fields }, scope) => scope.actor === 'owner' ? issues.statusAdd(fields) : { outcome: 'error', code: 'owner_only' },
  'status-update': (issues, { id, patch }, scope) => scope.actor === 'owner' ? issues.statusUpdate(id, patch) : { outcome: 'error', code: 'owner_only' },
  'status-remove': (issues, { id, replacement }, scope) => scope.actor === 'owner' ? issues.statusRemove(id, replacement) : { outcome: 'error', code: 'owner_only' },
  'status-order': (issues, { category, ids }, scope) => scope.actor === 'owner' ? issues.statusOrder(category, ids) : { outcome: 'error', code: 'owner_only' },
  labels: (issues) => issues.labels(),
  'label-add': (issues, { fields }) => issues.labelAdd(fields),
  'label-update': (issues, { id, patch }, scope) => scope.actor === 'owner' ? issues.labelUpdate(id, patch) : { outcome: 'error', code: 'owner_only' },
  'label-remove': (issues, { id }, scope) => scope.actor === 'owner' ? issues.labelRemove(id) : { outcome: 'error', code: 'owner_only' },
  'link-add': (issues, { id, fields, ...rest }, scope) => issues.linkAdd(id, fields, meta(rest, scope)),
  'link-remove': (issues, { id, linkId, ...rest }, scope) => issues.linkRemove(id, linkId, meta(rest, scope)),
  schema: () => ({ outcome: 'success', apiVersion: 1, document: issueApiDocument() }),
  office: (issues) => issues.office(),
  list: (issues, body) => issues.list(body),
  get: (issues, { id, logLimit, logCursor }) => issues.get(id, { logLimit, logCursor }),
  add: async (issues, { fields, ...rest }, scope) => {
    const { onAssign } = scope;
    const result = issues.add(fields ?? {}, meta(rest, scope));
    if (result.outcome === 'success' && result.issue.agent) await hand(onAssign, result.issue);
    return result;
  },
  update: async (issues, { id, patch, ...rest }, scope) => {
    const { onChange } = scope;
    const result = issues.update(id, patch ?? {}, meta(rest, scope));
    if (result.outcome === 'success') await hand(onChange, result.issue);
    return result;
  },
  log: (issues, { id, kind, text, data, ...rest }, scope) => issues.log(id, { kind, text, data, ...meta(rest, scope) }),
  message: async (issues, { id, text, attachmentIds = [], requestId, initial = false }, scope) => {
    const { onMention } = scope;
    const got = issues.get(id, { logLimit: 1 });
    if (!got.issue) return got;
    if (!Array.isArray(attachmentIds) || attachmentIds.length > 100 || attachmentIds.some((key) => typeof key !== 'string')) return { outcome: 'needs_clarification', code: 'invalid_message' };
    const message = issueMessage(text, got.issue.agent, { hasAttachments: attachmentIds.length > 0 });
    if (message.error) return { outcome: 'needs_clarification', code: message.error };
    if (typeof initial !== 'boolean' || initial && (message.text || !attachmentIds.length)) {
      return { outcome: 'needs_clarification', code: 'invalid_message' };
    }
    if (message.target && message.target !== 'dudu' && !got.issue.project?.path) return { outcome: 'needs_clarification', code: 'choose_project' };
    if (message.target && !onMention) return { outcome: 'error', code: 'delivery_failed' };
    const logged = issues.log(id, { kind: 'note', text: message.text, attachmentIds, requestId,
      data: initial ? { initial: true } : message.target ? { mention: message.target } : null, ...meta({}, scope) });
    if (logged.outcome !== 'success' || !message.target) return logged;
    try {
      const result = await onMention(got.issue, message, logged.entry);
      if (!result || !['success', 'no_op'].includes(result.outcome)) {
        return { ...logged, outcome: 'error', code: 'delivery_failed', saved: true };
      }
      return { ...logged, issue: issues.get(id, { logLimit: 1 }).issue ?? got.issue, delivery: result };
    } catch {
      return { ...logged, outcome: 'error', code: 'delivery_failed', saved: true };
    }
  },
  assign,
  snooze: (issues, { id, until, ...rest }, scope) => issues.snooze(id, until, meta(rest, scope)),
  complete: async (issues, { id, outcome, ...rest }, scope) => {
    const { onChange } = scope;
    const result = issues.complete(id, { outcome, ...meta(rest, scope) });
    if (result.outcome === 'success') await hand(onChange, result.issue);
    return result;
  },
  cancel: async (issues, { id, reason, ...rest }, scope) => {
    const { onChange } = scope;
    const result = issues.cancel(id, { ...meta(rest, scope), reason });
    if (result.outcome === 'success') await hand(onChange, result.issue);
    return result;
  },
  search: (issues, { q, limit, tab }) => issues.search(q, { limit, tab }),
  recipients: (issues, body) => issues.recipients(body),
  // An explicit issue address routes the owner's body verbatim, even when it contains @names or /skills.
  // `chat`: the line was written in 嘟嘟's chat, so it comes into that thread (and its answer after it) as well as going to the session (home/group.mjs).
  forward: async (issues, { id, session, text, attachments, retryEntry, chat }, { onForward, ...scope }) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 20_000) return { outcome: 'needs_clarification', code: 'invalid_message' };
    const attached = forwardAttachments(attachments);
    if (!attached) return { outcome: 'needs_clarification', code: 'invalid_message' };
    const got = issues.get(id, { logLimit: 1 });
    if (!got.issue) return { ...got, code: 'recipient_unavailable' };
    if (!got.issue.agent) return { outcome: 'needs_clarification', code: 'choose_agent' };
    if (!got.issue.project?.path) return { outcome: 'needs_clarification', code: 'choose_project' };
    if (!got.issue.session || session !== undefined && session !== got.issue.session) return { outcome: 'needs_clarification', code: 'recipient_unavailable' };
    if (!onForward) return { outcome: 'error', code: 'delivery_failed' };
    let logged;
    if (retryEntry !== undefined) {
      if (!Number.isSafeInteger(retryEntry) || retryEntry < 1) return { outcome: 'needs_clarification', code: 'invalid_message' };
      const entry = issues.relayNote(id, retryEntry);
      if (!entry || entry.actor !== scope.actor || entry.text !== text.trim() || entry.data?.mention !== got.issue.agent || entry.data?.session !== got.issue.session) {
        return { outcome: 'needs_clarification', code: 'recipient_unavailable' };
      }
      logged = { outcome: 'success', entry, issue: got.issue };
    } else logged = issues.log(id, { kind: 'note', text: text.trim(), data: { mention: got.issue.agent, session: got.issue.session }, ...meta({}, scope) });
    if (logged.outcome !== 'success') return logged;
    try {
      const result = await onForward(got.issue, text.trim(), logged.entry, attached, { chat: chat === true });
      if (!result || !['success', 'no_op'].includes(result.outcome)) return { ...logged, outcome: 'error', code: 'delivery_failed', saved: true };
      return { ...logged, issue: issues.get(id, { logLimit: 1 }).issue ?? got.issue, delivery: result };
    } catch { return { ...logged, outcome: 'error', code: 'delivery_failed', saved: true }; }
  },
  facets: (issues, body) => issues.facets(body),
  counts: (issues) => issues.counts(),
  reply,
  resume,
  session: async (issues, { id }, { onSession }) => {
    const got = issues.get(id, { logLimit: 1 });
    if (!got.issue) return got;
    return { outcome: 'success', ...(await onSession?.(got.issue) ?? {}) };
  },
  // Where it came from, for the page's Source group: { source: { connector, name, url, from, at, title } | null }.
  source: async (issues, { id }, { onSource }) => {
    const got = issues.get(id, { logLimit: 1 });
    return got.outcome === 'success' ? { outcome: 'success', source: (await hand(onSource, got.issue)) ?? null } : got;
  },
  delete: async (issues, { id, token }, { onDelete }) => {
    if (!token) return issues.forget(id);
    const checked = issues.forget(id, { token, checkOnly: true, allowActive: true });
    if (checked.outcome !== 'success') return checked;
    if (checked.issue.sessions.length && !onDelete) return { outcome: 'error', code: 'session_cleanup_unavailable' };
    try { await onDelete?.(checked.issue); }
    catch { return { outcome: 'error', code: 'session_cleanup_failed' }; }
    return issues.forget(id, { token, allowActive: true });
  },
  forget: async (issues, { id, token }, { onForget }) => {
    const before = token ? issues.get(id, { logLimit: 1 }).issue : null;
    const result = issues.forget(id, { token });
    if (result.forgotten) await hand(onForget, before);
    return result;
  },
  events: (issues, body) => issues.events(body),
  export: (issues) => issues.export(),
};

export const ISSUE_ACTIONS = Object.keys(CALLS);

export function createIssueCommands({ issues, actor = 'owner', ...hooks }) {
  return {
    async execute(action, body = {}) {
      if (!Object.hasOwn(CALLS, action)) return { outcome: 'error', code: 'unknown_action' };
      if (body === null || typeof body !== 'object' || Array.isArray(body)) return { outcome: 'needs_clarification', code: 'invalid_request' };
      return CALLS[action](issues, body, { ...hooks, actor });
    },
  };
}

export function createIssuesApi({ issues, ...hooks }) {
  const commands = createIssueCommands({ ...hooks, issues, actor: 'owner' });
  return {
    /** The same commands for code that is not a request of the page (the owner's own doing, such as sharing a collected record to a session). */
    execute: (action, body) => commands.execute(action, body),
    async handle(action, request) {
      const call = Object.hasOwn(CALLS, action) ? CALLS[action] : null;
      if (!call) return new Response('Not found', { status: 404 });
      try {
        const body = await request.json().catch(() => { throw new SyntaxError('The request body is not JSON.'); });
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('The request body must be a JSON object.');
        return Response.json(await commands.execute(action, body), { headers: NO_STORE });
      } catch (error) {
        const bad = error instanceof SyntaxError;
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: bad ? 400 : 500, headers: NO_STORE });
      }
    },
  };
}
