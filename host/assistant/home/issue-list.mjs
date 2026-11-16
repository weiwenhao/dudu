/** Read every issue before applying session facts, which are independent of workflow and issue paging. */
export async function listAllIssues(issues, filter) {
  const result = new Map();
  const seen = new Set();
  let cursor;
  do {
    const page = await issues('list', {
      tab: 'all', order: 'created', completedLast: false, limit: 200, ...(cursor ? { cursor } : {}),
      ...(filter ? { filter } : {}),
    });
    if (page?.outcome !== 'success' || !Array.isArray(page.items)) {
      throw Object.assign(new Error('Issue list is unavailable'), page?.outcome === 'needs_clarification' ? { code: 'BAD_REQUEST' } : {});
    }
    for (const issue of page.items) result.set(issue.id, issue);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error('Issue cursor did not advance');
    seen.add(cursor);
  } while (cursor);
  return [...result.values()];
}

export const issueSessionId = (issue) => issue.session?.startsWith('dsh:') ? issue.session.slice(4) : null;
