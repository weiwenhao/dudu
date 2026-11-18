/** Read every page in the requested workflow scope before applying independent session facts. */
export async function listIssueSnapshot(issues, { tab = 'all', filter } = {}) {
  const result = new Map();
  const seen = new Set();
  let cursor;
  let statuses;
  do {
    const page = await issues('list', {
      tab, order: 'created', completedLast: false, limit: 200, ...(cursor ? { cursor } : {}),
      ...(filter ? { filter } : {}),
    });
    if (page?.outcome !== 'success' || !Array.isArray(page.items)) {
      throw Object.assign(new Error('Issue list is unavailable'), page?.outcome === 'needs_clarification' ? { code: 'BAD_REQUEST' } : {});
    }
    if (!cursor) statuses = page.statuses;
    for (const issue of page.items) result.set(issue.id, issue);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Issue cursor did not advance');
    seen.add(cursor);
  } while (cursor);
  return { items: [...result.values()], statuses };
}

export async function listAllIssues(issues, options) {
  return (await listIssueSnapshot(issues, options)).items;
}

export const issueSessionId = (issue) => issue.session?.startsWith('dsh:') ? issue.session.slice(4) : null;
