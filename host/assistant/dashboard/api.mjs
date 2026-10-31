// The dashboard layout over HTTP, for the desktop interface: POST /api/dudu/dashboard/<action> with one JSON object, answered with JSON.
// Like the issues API: the dashboard never throws for a wrong value, it answers { outcome: 'needs_clarification', message, next }; so a
// request fails only when the body is not a JSON object, the action is unknown, or something breaks that should not.
//
// The page is the owner: there is no actor. `set` takes { layout, type?, name? } (type: the widget the owner dragged, resized, added or
// removed, which names the undo entry; name: its display name when it is a widget a plugin brought); the other actions take the fields
// of the dashboard's own calls, see index.mjs.
const NO_STORE = { 'cache-control': 'no-store' };

const CALLS = {
  get: (dashboard) => dashboard.get(),
  set: (dashboard, { layout, type, name }) => dashboard.set(layout, { type, name }),
  reset: (dashboard) => dashboard.reset(),
  add: (dashboard, body) => dashboard.add(body),
  move: (dashboard, body) => dashboard.move(body),
  resize: (dashboard, body) => dashboard.resize(body),
  remove: (dashboard, body) => dashboard.remove(body),
  undo: (dashboard) => dashboard.undo(),
};

export const DASHBOARD_ACTIONS = Object.keys(CALLS);

export function createDashboardApi({ dashboard }) {
  return {
    async handle(action, request) {
      const call = Object.hasOwn(CALLS, action) ? CALLS[action] : null;
      if (!call) return new Response('Not found', { status: 404 });
      try {
        const body = await request.json().catch(() => { throw new SyntaxError('The request body is not JSON.'); });
        if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new SyntaxError('The request body must be a JSON object.');
        return Response.json(await call(dashboard, body), { headers: NO_STORE });
      } catch (error) {
        const bad = error instanceof SyntaxError;
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: bad ? 400 : 500, headers: NO_STORE });
      }
    },
  };
}
