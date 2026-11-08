// The board and the Collector for the phone (docs/assistant.md 4.2). The owner is the one asking, here as on the desktop, and the commands are the desktop
// interface's own: `issues/list`, `issues/add`, `inbox/*` (host/assistant/issues/api.mjs, host/assistant/inbox/api.mjs). What changes is the answer: plain,
// small rows (no description, no activity), so that the app draws its lists itself.
//
//   board.list    { tab: 'active' | 'backlog' | 'all', groupKey?, cursor? }   the issues of a tab, grouped by what their agent is doing; with `groupKey` and
//                 `cursor`, the next page of that one group
//                 -> { tab, total, groups: [{ key: 'working' | 'blocked' | 'idle' | 'unassigned', count, nextCursor, items: [row] }] }
//   issue.get     { id }                                     -> { issue }                          one issue, with its description
//   issue.open    { id }                                     -> { sessionId | null }               the session of the issue, put back in DSH's sidebar if it was folded away
//   issue.pick    { withSession? }                           -> { items: [row] }                   the open issues, the one touched last first (what a record is shared to)
//   issue.options {}                                        -> { statuses, labels, projects }     the desktop's creation choices, including its configured default status
//   issue.parents { q? }                                    -> { items: [row] }                   recent issues or a bounded search, including finished parents
//   issue.project.create { name?, path, createDirectory? }  -> { project }                        the same explicit project creation as on desktop
//   issue.label.create { name, color }                       -> { label }                          one label, using the desktop's palette
//   issue.create  { title, description?, status?, priority?, project?, agent?, labels?, dueAt?, parent?, record? }
//                                                           -> { outcome, issue? }                a new issue; with `record`, made of that collected record and linked to it
//   inbox.list    { tab: 'todo' | 'done' | 'ignored', connector?: [id], cursor? }   -> { items: [card], nextCursor, total, names }
//   inbox.get     { id }                                     -> { record, draft }
//   inbox.mark    { action: 'ignore' | 'done' | 'delete' | 'restore', ids }          -> { outcome, changed }
//   inbox.share   { ids, issue, to?: 'issue' | 'session' }   -> { outcome, changed }
//
// A row is { id, ref, title, agent, agentState, agentFinished?, deepSleep?, status, statusType, priority, project?, dueAt?, updatedAt, sessionId? }; a card is the inbox's own
// (inbox/api.mjs). An answer that is not a success keeps its `outcome`, `code` and `message`: the app says it failed in its own words.
export const NATIVE_BOARD_METHODS = Object.freeze([
  'board.list', 'issue.get', 'issue.open', 'issue.pick', 'issue.options', 'issue.parents', 'issue.project.create', 'issue.label.create', 'issue.create',
  'inbox.list', 'inbox.get', 'inbox.mark', 'inbox.share',
]);

const TABS = new Set(['active', 'backlog', 'all']);
const INBOX_TABS = new Set(['todo', 'done', 'ignored']);
const MARKS = new Set(['ignore', 'done', 'delete', 'restore']);
const GROUPS = new Set(['working', 'blocked', 'idle', 'unassigned']);
const PAGE = 50;
const MAX_IDS = 200;
const MAX_TITLE = 300;
const MAX_DESCRIPTION = 20_000;

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
const positive = (value) => Number.isSafeInteger(value) && value > 0;
/** The DSH session behind an issue's key (`dsh:<id>`); an issue held by a harness alone has none the phone can open. */
const sessionIdOf = (key) => (typeof key === 'string' && key.startsWith('dsh:') && key.length > 4 ? key.slice(4) : null);

function row(issue) {
  const sessionId = sessionIdOf(issue.session);
  return {
    id: issue.id, ref: issue.ref ?? null, title: text(issue.title, MAX_TITLE),
    agent: issue.agent ?? null, agentState: issue.agentState ?? 'unassigned',
    ...(issue.agentFinished ? { agentFinished: true } : {}), ...(issue.deepSleep ? { deepSleep: true } : {}),
    status: issue.status, statusType: issue.statusType ?? issue.status, priority: issue.priority ?? 'none',
    ...(issue.project?.name ? { project: text(issue.project.name, 100) } : {}),
    ...(Number.isFinite(issue.dueAt) ? { dueAt: issue.dueAt } : {}),
    updatedAt: issue.updatedAt,
    ...(sessionId ? { sessionId } : {}),
  };
}

const problem = (result) => ({
  outcome: typeof result?.outcome === 'string' ? result.outcome : 'error',
  ...(typeof result?.code === 'string' ? { code: result.code } : {}),
  ...(typeof result?.message === 'string' ? { message: text(result.message, 300) } : {}),
});
const succeeded = (result) => result?.outcome === 'success';

/**
 * `issues(action, body)` and `inbox(action, body)` run the desktop interface's commands (the owner's: every change is written as the owner); each may answer at once or
 * later. `fail(code)` throws the bridge's own error for a request that is not well formed.
 */
export function createNativeBoard({ issues, inbox, projects, fail }) {
  const unavailable = () => fail('UPSTREAM_UNAVAILABLE');
  const askIssues = async (action, body) => (issues ? issues(action, body) : unavailable());
  const askInbox = async (action, body) => (inbox ? inbox(action, body) : unavailable());
  const shortText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

  async function options() {
    const [statuses, labels, folders] = await Promise.all([
      askIssues('statuses', {}), askIssues('labels', {}), projects ? projects.list() : unavailable(),
    ]);
    const bad = [statuses, labels, folders].find((result) => !succeeded(result));
    if (bad) return problem(bad);
    return {
      outcome: 'success',
      statuses: (statuses.statuses ?? []).filter((status) => !status.archived).map(({ id, type, name, color, isDefault }) => ({ id, type, name, color, isDefault })),
      labels: (labels.labels ?? []).map(({ id, name, color }) => ({ id, name, color })),
      projects: (folders.projects ?? []).map(({ name, path }) => ({ name, path })),
    };
  }

  async function parents(params) {
    if (params.q !== undefined && (typeof params.q !== 'string' || params.q.length > MAX_TITLE)) fail('BAD_REQUEST');
    const q = params.q?.trim() ?? '';
    const words = /[\p{L}\p{N}]/u.test(q);
    const result = await askIssues(words ? 'search' : 'list', words ? { q, tab: 'all', limit: 20 } : { tab: 'all', order: 'updated', limit: 20 });
    return succeeded(result) ? { outcome: 'success', items: (result.items ?? []).map(row) } : problem(result);
  }

  async function createProject(params) {
    if (!shortText(params.path, 1000) || params.name !== undefined && !shortText(params.name, 200)
      || params.createDirectory !== undefined && typeof params.createDirectory !== 'boolean') fail('BAD_REQUEST');
    if (!projects) unavailable();
    const result = await projects.create({
      path: params.path.trim(), ...(params.name === undefined ? {} : { name: params.name.trim() }), createDirectory: params.createDirectory === true,
    });
    return succeeded(result) ? { outcome: 'success', project: { name: result.project.name, path: result.project.path } } : problem(result);
  }

  async function createLabel(params) {
    if (!shortText(params.name, 50) || typeof params.color !== 'string') fail('BAD_REQUEST');
    const result = await askIssues('label-add', { fields: { name: params.name.trim(), color: params.color } });
    return succeeded(result) ? { outcome: 'success', label: result.label } : problem(result);
  }

  async function list(params) {
    const tab = params.tab ?? 'active';
    if (!TABS.has(tab)) fail('BAD_REQUEST');
    const request = { tab, group: 'agentState', limit: PAGE };
    if (params.groupKey !== undefined || params.cursor !== undefined) {
      if (!GROUPS.has(params.groupKey) || typeof params.cursor !== 'string' || !params.cursor || params.cursor.length > 200) fail('BAD_REQUEST');
      request.groupFilter = { key: params.groupKey };
      request.cursor = params.cursor;
    }
    const result = await askIssues('list', request);
    if (!succeeded(result)) return { tab, ...problem(result) };
    const groups = (result.groups ?? []).filter((group) => GROUPS.has(group.key)).map((group) => ({
      key: group.key, count: Number.isSafeInteger(group.count) ? group.count : (group.items ?? []).length,
      nextCursor: typeof group.nextCursor === 'string' ? group.nextCursor : null, items: (group.items ?? []).map(row),
    }));
    // A page of one group comes back flat: the rows of that group, and the cursor of its next page.
    if (request.groupFilter && !result.groups?.length) {
      return { outcome: 'success', tab, total: result.total ?? 0, groups: [{ key: params.groupKey, count: result.total ?? 0, nextCursor: result.nextCursor ?? null, items: (result.items ?? []).map(row) }] };
    }
    return { outcome: 'success', tab, total: Number.isSafeInteger(result.total) ? result.total : 0, groups };
  }

  async function get(params) {
    if (!positive(params.id)) fail('BAD_REQUEST');
    const result = await askIssues('get', { id: params.id, logLimit: 1 });
    if (!succeeded(result) || !result.issue) return problem(result);
    const { issue } = result;
    return {
      outcome: 'success',
      issue: { ...row(issue), description: text(issue.brief, MAX_DESCRIPTION), hasSession: Boolean(issue.session), createdAt: issue.createdAt },
    };
  }

  /** The session of an issue, brought back to DSH's sidebar when it was folded away (as the desktop does when the owner opens it). */
  async function open(params) {
    if (!positive(params.id)) fail('BAD_REQUEST');
    const result = await askIssues('get', { id: params.id, logLimit: 1 });
    if (!succeeded(result) || !result.issue) return problem(result);
    const sessionId = sessionIdOf(result.issue.session);
    if (!sessionId) return { outcome: 'success', sessionId: null };
    const resumed = await askIssues('resume', { id: params.id });
    return ['success', 'no_op'].includes(resumed?.outcome) ? { outcome: 'success', sessionId } : { ...problem(resumed), sessionId: null };
  }

  /** The open issues (Active and Backlog), the one touched last first; the phone searches them itself. */
  async function pick(params) {
    const results = await Promise.all(['active', 'backlog'].map((tab) => askIssues('list', { tab, order: 'updated', limit: PAGE })));
    const bad = results.find((result) => !succeeded(result));
    if (bad) return problem(bad);
    const items = results.flatMap((result) => result.items ?? []).sort((a, b) => b.updatedAt - a.updatedAt);
    // Sharing to a session needs an issue that has an agent and a session.
    const chosen = params.withSession === true ? items.filter((issue) => issue.agent && issue.session) : items;
    return { outcome: 'success', items: chosen.map(row) };
  }

  async function create(params) {
    const title = text(params.title, MAX_TITLE).trim();
    if (!title) fail('BAD_REQUEST');
    if (params.description !== undefined && typeof params.description !== 'string') fail('BAD_REQUEST');
    if (params.record !== undefined && !positive(params.record)) fail('BAD_REQUEST');
    const fields = { title, ...(params.description?.trim() ? { brief: text(params.description, MAX_DESCRIPTION).trim() } : {}) };
    if (params.status !== undefined) {
      if (!shortText(params.status, 100)) fail('BAD_REQUEST');
      fields.status = params.status;
    }
    if (params.priority !== undefined) {
      if (!['none', 'urgent', 'high', 'medium', 'low'].includes(params.priority)) fail('BAD_REQUEST');
      fields.priority = params.priority;
    }
    if (params.project !== undefined) {
      if (params.project !== null && (!isRecord(params.project) || !shortText(params.project.name, 200)
        || params.project.path != null && !shortText(params.project.path, 1000))) fail('BAD_REQUEST');
      fields.project = params.project === null ? null : { name: params.project.name.trim(), path: params.project.path?.trim() ?? null };
    }
    if (params.agent !== undefined) {
      if (params.agent !== null && !['claude', 'codex', 'deepseek'].includes(params.agent)) fail('BAD_REQUEST');
      fields.agent = params.agent;
    }
    if (params.labels !== undefined) {
      if (!Array.isArray(params.labels) || params.labels.length > 50 || !params.labels.every(positive)) fail('BAD_REQUEST');
      fields.labels = [...new Set(params.labels)];
    }
    if (params.dueAt !== undefined) {
      if (params.dueAt !== null && (!Number.isSafeInteger(params.dueAt) || params.dueAt < 0)) fail('BAD_REQUEST');
      fields.dueAt = params.dueAt;
    }
    if (params.parent !== undefined) {
      if (params.parent !== null && !positive(params.parent)) fail('BAD_REQUEST');
      fields.parent = params.parent;
    }
    // Made of a collected record: it is marked with its source, and the record is linked to the issue it became.
    if (params.record !== undefined) {
      const got = await askInbox('get', { id: params.record });
      if (!succeeded(got)) return problem(got);
      Object.assign(fields, { source: 'connector', sourceRef: got.draft.sourceRef });
    }
    const made = await askIssues('add', { fields });
    if (!succeeded(made) || !made.issue) return problem(made);
    if (params.record !== undefined) await askInbox('link', { id: params.record, issue: made.issue.id });
    return { outcome: 'success', issue: row(made.issue) };
  }

  async function inboxList(params) {
    const tab = params.tab ?? 'todo';
    if (!INBOX_TABS.has(tab)) fail('BAD_REQUEST');
    if (params.cursor !== undefined && (typeof params.cursor !== 'string' || params.cursor.length > 100)) fail('BAD_REQUEST');
    const connector = Array.isArray(params.connector) ? params.connector.filter((id) => typeof id === 'string' && id.length <= 80).slice(0, 20) : undefined;
    const result = await askInbox('list', { tab, limit: PAGE, ...(params.cursor ? { cursor: params.cursor } : {}), ...(connector?.length ? { filter: { connector } } : {}) });
    if (!succeeded(result)) return { tab, ...problem(result) };
    return {
      outcome: 'success', tab, items: result.items, nextCursor: result.nextCursor ?? null, names: result.names ?? {},
      // What the tab holds in all, whatever is on this page: the sum of its collectors' counts.
      total: (result.facets?.connector ?? []).reduce((sum, facet) => sum + facet.count, 0),
    };
  }

  async function inboxGet(params) {
    if (!positive(params.id)) fail('BAD_REQUEST');
    const result = await askInbox('get', { id: params.id });
    return succeeded(result) ? { outcome: 'success', record: result.record, draft: result.draft } : problem(result);
  }

  function ids(params) {
    if (!Array.isArray(params.ids) || params.ids.length === 0 || params.ids.length > MAX_IDS || !params.ids.every(positive)) fail('BAD_REQUEST');
    return [...new Set(params.ids)];
  }

  async function inboxMark(params) {
    if (!MARKS.has(params.action)) fail('BAD_REQUEST');
    const result = await askInbox(params.action, { ids: ids(params) });
    return ['success', 'no_op'].includes(result?.outcome) ? { outcome: result.outcome, changed: result.changed ?? 0 } : problem(result);
  }

  async function inboxShare(params) {
    if (!positive(params.issue)) fail('BAD_REQUEST');
    if (params.to !== undefined && !['issue', 'session'].includes(params.to)) fail('BAD_REQUEST');
    const result = await askInbox('share', { ids: ids(params), issue: params.issue, ...(params.to ? { to: params.to } : {}) });
    return ['success', 'no_op'].includes(result?.outcome)
      ? { outcome: result.outcome, changed: result.changed ?? 0, ...(result.issue ? { issue: { id: result.issue.id, ref: result.issue.ref ?? null } } : {}) }
      : problem(result);
  }

  const METHODS = {
    'board.list': list, 'issue.get': get, 'issue.open': open, 'issue.pick': pick,
    'issue.options': options, 'issue.parents': parents, 'issue.project.create': createProject, 'issue.label.create': createLabel, 'issue.create': create,
    'inbox.list': inboxList, 'inbox.get': inboxGet, 'inbox.mark': inboxMark, 'inbox.share': inboxShare,
  };
  return {
    async dispatch(method, params) {
      if (!Object.hasOwn(METHODS, method)) fail('UNSUPPORTED');
      if (!isRecord(params)) fail('BAD_REQUEST');
      return METHODS[method](params);
    },
  };
}
