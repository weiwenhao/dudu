// An issue to open: the pet's reminders ask for one by id; the 嘟嘟 page opens it when it is showing, or when it next shows.
// (This file also told the pet which page the owner was on, for "Context"; the owner had that taken out on 2026-11-12.)
const openers = new Set();
let pending = null;
export const subscribeOpenIssue = (open) => { openers.add(open); return () => openers.delete(open); };
/** Ask the 嘟嘟 page for an issue. Nobody listening yet means the page is not showing: it takes the request when it shows. */
export function requestIssue(id) { pending = id; for (const open of openers) open(); }
export function takeIssueRequest() { const id = pending; pending = null; return id; }
