import { claudeSessionRegistry, listRunningClaude, summarizeRunning } from './running.mjs';

// What the overview shows besides the sessions: what is running now. (How much of each subscription is left is the quota service's, providers/quota/: it is asked for only when a person asks.)

export function createOverview({ sources, links, titleOf, claude = {}, now = Date.now }) {
  const sourceOf = (id) => sources().find((source) => source.id === id);

  async function running() {
    const claudeSessions = sourceOf('claude') ? await listRunningClaude({ directory: claude.registry ?? claudeSessionRegistry() }) : [];
    const dshRuns = sources().flatMap((source) => (source.activeRuns?.() ?? []));
    return summarizeRunning({
      claude: claudeSessions, dshRuns, titleOf, dshSessionOf: (provider, id) => links.get(provider, id), now: now(),
    });
  }

  return {
    running,
    async handle(action, request) {
      try {
        const headers = { 'cache-control': 'no-store' };
        if (action === 'running') return Response.json(await running(), { headers });
        return new Response('Not found', { status: 404 });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
    },
  };
}
