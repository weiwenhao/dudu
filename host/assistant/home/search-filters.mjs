const DAYS = { day: 1, week: 7, month: 30 };
const FILTER_FIELDS = { sessions: ['agent', 'project', 'updated'], tasks: ['status', 'agent'] };
const keyList = (maxLength) => ({ type: 'array', maxItems: 256, items: { type: ['string', 'null'], maxLength } });
const fields = {
  agent: keyList(100),
  project: keyList(200),
  updated: { type: 'array', maxItems: 1, items: { type: 'string', enum: Object.keys(DAYS) } },
  status: { type: 'array', maxItems: 3, items: { type: 'string', enum: ['active', 'paused', 'ended'] } },
};
export const SEARCH_FILTERS_SCHEMA = { type: 'object', properties: fields, additionalProperties: false };

export function validSearchFilters(scope, filters) {
  if (filters === undefined) return true;
  const allowed = FILTER_FIELDS[scope];
  if (!Array.isArray(allowed) || !filters || typeof filters !== 'object' || Array.isArray(filters)) return false;
  return Object.entries(filters).every(([field, keys]) => {
    if (!allowed.includes(field) || !Array.isArray(keys)) return false;
    const { maxItems, items } = fields[field];
    return keys.length <= maxItems && keys.every((key) => items.enum
      ? items.enum.includes(key)
      : key === null || typeof key === 'string' && key.length <= items.maxLength);
  });
}

export const agentOfEntry = (entry) => (entry.issue ? entry.issue.agent ?? null : 'dudu');
export const projectOfEntry = (entry) => {
  const project = entry.issue?.project;
  return (typeof project === 'string' ? project : project?.name) ?? null;
};
export const isUnfiltered = (filter) => Object.values(filter ?? {}).every((keys) => !keys?.length);

/** The board's rolling ranges are measured from the current hour using the time of the newest message. */
export function filterSessions(entries, { agent = [], project = [], updated = [] }, now = Date.now(), includeAssistant = true) {
  if (!agent.length && !project.length && !updated.length) return entries;
  const from = updated.length ? Math.floor(now / 3_600_000) * 3_600_000 - DAYS[updated[0]] * 86_400_000 : -Infinity;
  return entries.filter((entry) => (includeAssistant || entry.issue)
    && (!agent.length || agent.includes(agentOfEntry(entry)))
    && (!project.length || project.includes(projectOfEntry(entry)))
    && (!updated.length || entry.receivedAt >= from));
}

export function filterTasks(tasks, { status = [], agent = [] }) {
  return tasks.filter((task) => (!status.length || status.includes(task.status)) && (!agent.length || agent.includes(task.agent ?? null)));
}

/** Include every key from the keyword matches. Counts may reflect the other selected filters. */
export function facetCounts(rows, pick, matching = rows) {
  const counts = new Map(rows.map((row) => [pick(row), 0]));
  for (const row of matching) {
    const key = pick(row);
    counts.set(key, counts.get(key) + 1);
  }
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
}
