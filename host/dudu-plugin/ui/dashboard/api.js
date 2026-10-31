// The dashboard's calls to the plugin (POST /api/dudu/dashboard/<action>), answered in one shape: the layout as a list of
// { id, type, x, y, w, h } (w is 'fill' for the untouched default Issues), the undo the plugin holds, and the widgets it knows.
const listOf = (result) => (Array.isArray(result?.layout) ? result.layout : result?.layout?.widgets ?? []);
const shape = (result) => ({ outcome: result?.outcome ?? 'error', items: listOf(result), undo: result?.undo ?? null, widgets: result?.widgets ?? null, message: result?.message ?? '' });

export function dashboardApi(request) {
  const call = async (action, body) => shape(await request(`dashboard/${action}`, body));
  return {
    get: () => call('get'),
    // `type` is the widget that was moved, resized or removed: it names the change on the undo bar (the plugin writes the words).
    set: (items, type) => call('set', { layout: { v: 1, widgets: items }, ...(type ? { type } : {}) }),
    add: (type, columns) => call('add', { type, ...(columns ? { columns } : {}) }),
    reset: () => call('reset'),
    undo: () => call('undo'),
  };
}
