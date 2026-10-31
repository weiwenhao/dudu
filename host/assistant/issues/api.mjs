// The issues store over HTTP, for the desktop interface: POST /api/dudu/issues/<action> with one JSON object, answered with JSON.
// The store never throws for a wrong value, it answers { outcome: 'needs_clarification', message, next }; so a request fails
// only when the body is not JSON, the action is unknown, or the database does.
//
// The page is the owner: every change it makes is written as the owner, whatever `actor` the body says. It may send `reason`
// and `groupId` (several changes undone together).
//
// The plugin hooks into three actions, each optional (`createIssuesApi({ issues, onReply, onAssign, onResume })`): a hook never fails
// the change that was made, a failure of it is only reported on the console.
const NO_STORE = { 'cache-control': 'no-store' };

const meta = ({ reason, groupId }) => ({ reason, groupId });

async function hand(hook, ...args) {
  try { return await hook?.(...args); } catch (error) { console.warn(`[dudu] An issue hook failed: ${error.message}`); return undefined; }
}

// The owner's answer to what an agent asked: it goes into the log as a decision and clears the question (the page's Needs you mark
// goes with it). `onReply(issue, text)` is the plugin's hand-over of the answer to the agent's session, when there is one.
async function reply(issues, { id, text, ...rest }, { onReply }) {
  const logged = issues.log(id, { kind: 'decision', text, ...meta(rest) });
  if (logged.outcome !== 'success') return logged;
  const cleared = issues.update(id, { ask: '' }, meta(rest));
  const issue = cleared.issue ?? logged.issue;
  await hand(onReply, issue, text);
  return { outcome: 'success', issue, entry: logged.entry };
}

// Naming an agent gives the issue to it. `onAssign(issue)` is the plugin's start of the work (a session for the agent). Naming the agent the
// issue has already, while it has a session, changes nothing: the session that works is not thrown away for a click on the same name.
async function assign(issues, { id, agent, session, ...rest }, { onAssign }) {
  if (agent && session === undefined) {
    const current = issues.get(id, { logLimit: 1 });
    if (current.outcome === 'success' && current.issue.agent === agent && current.issue.session) {
      return { outcome: 'no_op', message: 'The issue has this agent and its session already.', issue: current.issue };
    }
  }
  const result = issues.assign(id, { agent, session, ...meta(rest) });
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
  list: (issues, body) => issues.list(body),
  get: (issues, { id, logLimit, logCursor }) => issues.get(id, { logLimit, logCursor }),
  add: (issues, { fields, ...rest }) => issues.add(fields ?? {}, meta(rest)),
  update: (issues, { id, patch, ...rest }) => issues.update(id, patch ?? {}, meta(rest)),
  log: (issues, { id, kind, text, data, ...rest }) => issues.log(id, { kind, text, data, ...meta(rest) }),
  assign,
  snooze: (issues, { id, until, ...rest }) => issues.snooze(id, until, meta(rest)),
  complete: (issues, { id, outcome, ...rest }) => issues.complete(id, { outcome, ...meta(rest) }),
  cancel: (issues, { id, reason, ...rest }) => issues.cancel(id, { ...meta(rest), reason }), // the reason of a cancel is the reason
  search: (issues, { q, limit, tab }) => issues.search(q, { limit, tab }),
  facets: (issues, body) => issues.facets(body),
  counts: (issues) => issues.counts(),
  reply,
  resume,
  undo: (issues, { target }) => issues.undo(target),
  events: (issues, body) => issues.events(body),
  export: (issues) => issues.export(),
};

export const ISSUE_ACTIONS = Object.keys(CALLS);

export function createIssuesApi({ issues, onReply, onAssign, onResume }) {
  return {
    async handle(action, request) {
      const call = Object.hasOwn(CALLS, action) ? CALLS[action] : null;
      if (!call) return new Response('Not found', { status: 404 });
      try {
        const body = await request.json().catch(() => { throw new SyntaxError('The request body is not JSON.'); });
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('The request body must be a JSON object.');
        return Response.json(await call(issues, body, { onReply, onAssign, onResume }), { headers: NO_STORE });
      } catch (error) {
        const bad = error instanceof SyntaxError;
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: bad ? 400 : 500, headers: NO_STORE });
      }
    },
  };
}
