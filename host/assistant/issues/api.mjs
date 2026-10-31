// The issues store over HTTP, for the desktop interface: POST /api/dudu/issues/<action> with one JSON object, answered with JSON.
// The store never throws for a wrong value, it answers { outcome: 'needs_clarification', message, next }; so a request fails
// only when the body is not JSON, the action is unknown, or the database does.
//
// The page is the owner: every change it makes is written as the owner, whatever `actor` the body says. It may send `reason`
// and `groupId` (several changes undone together).
const NO_STORE = { 'cache-control': 'no-store' };

const meta = ({ reason, groupId }) => ({ reason, groupId });

const CALLS = {
  list: (issues, body) => issues.list(body),
  get: (issues, { id, logLimit, logCursor }) => issues.get(id, { logLimit, logCursor }),
  add: (issues, { fields, ...rest }) => issues.add(fields ?? {}, meta(rest)),
  update: (issues, { id, patch, ...rest }) => issues.update(id, patch ?? {}, meta(rest)),
  log: (issues, { id, kind, text, data, ...rest }) => issues.log(id, { kind, text, data, ...meta(rest) }),
  assign: (issues, { id, agent, session, ...rest }) => issues.assign(id, { agent, session, ...meta(rest) }),
  snooze: (issues, { id, until, ...rest }) => issues.snooze(id, until, meta(rest)),
  complete: (issues, { id, outcome, ...rest }) => issues.complete(id, { outcome, ...meta(rest) }),
  cancel: (issues, { id, reason, ...rest }) => issues.cancel(id, { ...meta(rest), reason }), // the reason of a cancel is the reason
  search: (issues, { q, limit, tab }) => issues.search(q, { limit, tab }),
  facets: (issues, body) => issues.facets(body),
  counts: (issues) => issues.counts(),
  undo: (issues, { target }) => issues.undo(target),
  events: (issues, body) => issues.events(body),
  export: (issues) => issues.export(),
};

export const ISSUE_ACTIONS = Object.keys(CALLS);

export function createIssuesApi({ issues }) {
  return {
    async handle(action, request) {
      const call = Object.hasOwn(CALLS, action) ? CALLS[action] : null;
      if (!call) return new Response('Not found', { status: 404 });
      try {
        const body = await request.json().catch(() => { throw new SyntaxError('The request body is not JSON.'); });
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('The request body must be a JSON object.');
        return Response.json(await call(issues, body), { headers: NO_STORE });
      } catch (error) {
        const bad = error instanceof SyntaxError;
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: bad ? 400 : 500, headers: NO_STORE });
      }
    },
  };
}
