// The dashboard layout over HTTP, for the desktop interface: POST /api/dudu/dashboard/<action> with one JSON object, answered with JSON.
// Like the issues API: the dashboard never throws for a wrong value, it answers { outcome: 'needs_clarification', message, next }; so a
// request fails only when the body is not a JSON object, the action is unknown, or something breaks that should not.
//
// The page is the owner: there is no actor. `set` takes { layout, type?, name?, rows? } (type: the widget the owner dragged, resized, added or
// removed, which names the undo entry; name: its display name when it is a widget a plugin brought; rows: how many rows the window shows,
// which a widget that fills its height counts); the other actions take the fields of the dashboard's own calls, see index.mjs.
const NO_STORE = { 'cache-control': 'no-store' };

const CALLS = {
  get: (dashboard, body) => dashboard.get(body),
  catalog: (dashboard, { widgets }) => dashboard.catalog(widgets),
  set: (dashboard, { layout, type, name, rows }) => dashboard.set(layout, { type, name, rows }),
  reset: (dashboard, body) => dashboard.reset(body),
  add: (dashboard, body) => dashboard.add(body),
  move: (dashboard, body) => dashboard.move(body),
  resize: (dashboard, body) => dashboard.resize(body),
  remove: (dashboard, body) => dashboard.remove(body),
  undo: (dashboard, body) => dashboard.undo(body),
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
