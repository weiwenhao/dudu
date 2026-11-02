// The dashboard's calls to the plugin (POST /api/dudu/dashboard/<action>), answered in one shape: the layout as a list of
// { id, type, x, y, w, h } (w is 'fill' for the untouched default Issues, and h is 'fill' too: every row the window shows), the undo the
// plugin holds, and the widgets it knows.
//
// The layout the page sends is of the current version (an older number would be read as an older grid and scaled).
//
// Every call says how many rows this window shows (`rows`): only the page knows, and a widget that fills its height counts them, so the
// answer is the layout as this window sees it.
import { VERSION } from '../../../assistant/dashboard/layout.mjs';

const listOf = (result) => (Array.isArray(result?.layout) ? result.layout : result?.layout?.widgets ?? []);
const shape = (result) => ({ outcome: result?.outcome ?? 'error', items: listOf(result), undo: result?.undo ?? null, widgets: result?.widgets ?? null, message: result?.message ?? '' });

export function dashboardApi(request) {
  const call = async (action, body) => shape(await request(`dashboard/${action}`, body));
  const said = (rows) => (rows ? { rows } : {});
  return {
    get: (rows) => call('get', said(rows)),
    // `type` is the widget that was moved, resized or removed: it names the change on the undo bar (the plugin writes the words).
    set: (items, type, rows) => call('set', { layout: { v: VERSION, widgets: items }, ...(type ? { type } : {}), ...said(rows) }),
    add: (type, columns, rows) => call('add', { type, ...(columns ? { columns } : {}), ...said(rows) }),
    reset: (rows) => call('reset', said(rows)),
    undo: (rows) => call('undo', said(rows)),
  };
}
