const fail = (code) => { throw Object.assign(new Error(code), { code }); };

/** Registered only on the authenticated DSH connection; phone pairing/page routes are unchanged. */
export function createChatHomeApi(home, issues) {
  return async (action, request) => {
    try {
      const body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('BAD_REQUEST');
      let answer;
      if (action === 'list') {
        const tab = body.tab ?? 'active';
        if (!['active', 'backlog', 'unread', 'all'].includes(tab)
          || body.filter !== undefined && (!body.filter || typeof body.filter !== 'object' || Array.isArray(body.filter))) fail('BAD_REQUEST');
        answer = await home.list(tab, (issue) => issue, body.filter, { includePinnedConversations: true, ownMessages: true });
        // Reuse the issue store's facet counts (each leaves its own filter out), after warming session facts.
        const summary = await issues('list', { tab: tab === 'unread' ? 'all' : tab, filter: body.filter, limit: 1 });
        if (summary.outcome !== 'success') fail('BAD_REQUEST');
        answer = { ...answer, counts: summary.counts, statuses: summary.statuses };
      } else if (action === 'pin') answer = await home.pin(body, fail);
      else return new Response('Not found', { status: 404 });
      return Response.json(answer, { headers: { 'cache-control': 'no-store' } });
    } catch (error) {
      const bad = error instanceof SyntaxError || error.code === 'BAD_REQUEST';
      return Response.json({ outcome: 'error', code: error.code ?? 'unavailable' }, {
        status: bad ? 400 : error.code === 'NOT_FOUND' ? 404 : 500,
        headers: { 'cache-control': 'no-store' },
      });
    }
  };
}
