// Two small things the 嘟嘟 page and the pet share, though the pet sits beside every DSH page and the page is only one of them.
//
// Where the owner is: the page says what it shows (the dashboard, or one issue) and clears it when the owner leaves it, so the pet knows
// what "Context" would attach. The issue's page adds the reference and the title once it has loaded the issue.
//
// An issue to open: the pet's reminders ask for one by id; the page opens it when it is showing, or when it next shows.
import { useSyncExternalStore } from 'react';

let where = null;
const watchers = new Set();
const emit = (set) => { for (const watch of set) watch(); };

export const getWhere = () => where;
export const subscribeWhere = (watch) => { watchers.add(watch); return () => watchers.delete(watch); };
export const useWhere = () => useSyncExternalStore(subscribeWhere, getWhere, () => null);

/** The page the owner is on: `{ page: 'dashboard' }`, `{ page: 'issue', id }` or null. The same issue keeps what was described about it. */
export function setWhere(next) {
  if (next && where && next.page === where.page && next.id === where.id) next = { ...where, ...next };
  if (JSON.stringify(next) === JSON.stringify(where)) return;
  where = next;
  emit(watchers);
}

/** What the page of the issue reads as: its reference and title. Ignored when the owner has already gone to another page. */
export function describeIssue(id, { ref, title }) {
  if (where?.page === 'issue' && where.id === id) setWhere({ ...where, ref: ref ?? null, title });
}

let pending = null;
const openers = new Set();
export const subscribeOpenIssue = (open) => { openers.add(open); return () => openers.delete(open); };
/** Ask the 嘟嘟 page for an issue. Nobody listening yet means the page is not showing: it takes the request when it shows. */
export function requestIssue(id) { pending = id; emit(openers); }
export function takeIssueRequest() { const id = pending; pending = null; return id; }
