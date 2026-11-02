import { claudeSessionRegistry, listRunningClaude, summarizeRunning } from './running.mjs';
import { withAppServer } from './codex-store.mjs';

// What the overview shows besides the sessions: how much of each subscription is used, and what is running now. Each is read
// on its own and kept briefly, because reading it starts a process.

const USAGE_TTL = 120_000;

// What makes Claude Code answer as if it were paid by use: with one of these in its environment it cannot report how much of a plan is
// used. A host that was started with a key in its environment still has the owner's own sign-in for the plan.
const PAID_BY_USE = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

const WEEKLY = /week/i;

/** One usage window as the page shows it: a short name, how much is used, and when it starts over. */
export function windowView(window) {
  const used = Math.min(1, Math.max(0, Number(window.usedRatio) || 0));
  const resetsAt = Date.parse(window.resetsAt);
  let label;
  if (window.id === 'five_hour') label = '5 小时';
  else if (window.id === 'seven_day') label = '每周';
  else {
    const model = String(window.label ?? '').match(/\(([^)]+)\)/)?.[1];
    label = WEEKLY.test(`${window.id ?? ''} ${window.label ?? ''}`) && model ? `${model} 每周` : String(window.label ?? '').slice(0, 24);
  }
  return { key: window.id ?? window.label, label, used, ...(Number.isNaN(resetsAt) ? {} : { resetsAt }), core: window.id === 'five_hour' || window.id === 'seven_day' };
}

const titleCase = (text) => (typeof text === 'string' && text ? text[0].toUpperCase() + text.slice(1) : '');

/** What a usage reading says for one harness. A window nobody has used is left out unless it is one of the two every plan has. */
export function usageView(source, snapshot) {
  const base = { id: source.id, name: source.name };
  if (snapshot?.kind === 'available') {
    const windows = (snapshot.windows ?? []).map(windowView).filter((window) => window.core || window.used >= 0.01);
    windows.sort((a, b) => (b.core - a.core) || (a.label === '5 小时' ? -1 : b.label === '5 小时' ? 1 : 0));
    return { ...base, state: 'ok', plan: titleCase(snapshot.plan), limited: snapshot.rateLimited === true, windows: windows.slice(0, 4) };
  }
  // A harness that cannot report usage on this account has nothing to show; one that needs a login says so.
  if (snapshot?.kind === 'reauth_required') return { ...base, state: 'login', plan: '', limited: false, windows: [] };
  return { ...base, state: 'hidden', plan: '', limited: false, windows: [] };
}

/** A Codex window by its length in minutes, as `windowView` shows it. */
function codexWindow(window, key) {
  if (!window || !Number.isFinite(window.usedPercent)) return undefined;
  const minutes = Number(window.windowDurationMins);
  const label = minutes === 300 ? '5 小时' : minutes === 10080 ? '每周' : Number.isFinite(minutes) && minutes > 0 ? (minutes % 1440 === 0 ? `${minutes / 1440} 天` : `${Math.round(minutes / 60)} 小时`) : key;
  return { key, label, used: Math.min(1, Math.max(0, window.usedPercent / 100)), ...(Number.isFinite(window.resetsAt) ? { resetsAt: window.resetsAt * 1000 } : {}), core: minutes === 300 || minutes === 10080 };
}

/**
 * Codex's own answer to `account/rateLimits/read` as a usage view. OAR's reader gives up when `account/read` names no account,
 * which is what a custom model provider in config.toml does even though the person is logged in with ChatGPT; the limits call
 * itself still answers, so it is asked directly when OAR says unsupported.
 */
export function codexLimitsView(source, reply) {
  const limits = reply?.rateLimits;
  const windows = [codexWindow(limits?.primary, 'primary'), codexWindow(limits?.secondary, 'secondary')].filter(Boolean);
  if (!windows.length) return { id: source.id, name: source.name, state: 'hidden', plan: '', limited: false, windows: [] };
  const limited = Boolean(limits.rateLimitReachedType) || limits.spendControlReached === true || reply.ordinaryUsageAllowed === false;
  return { id: source.id, name: source.name, state: 'ok', plan: titleCase(limits.planType), limited, windows };
}

/** Codex's rate limits, asked of an app-server. */
const readCodexLimits = (source) => withAppServer({ command: source.command, env: source.environment?.(), timeoutMs: 30_000 }, (request) => request('account/rateLimits/read', {}));

export function createOverview({ sources, links, titleOf, claude = {}, codexLimits = readCodexLimits, balance, env = process.env, now = Date.now }) {
  let usageCache; let usagePending;

  const sourceOf = (id) => sources().find((source) => source.id === id);

  /** What a harness says about its plan; Claude, when it says it cannot, is asked again with the paid-by-use settings left out of its environment. */
  async function snapshotOf(source) {
    const snapshot = await source.driver.accountUsage?.();
    const names = source.id === 'claude' && snapshot?.kind === 'unsupported' ? PAID_BY_USE.filter((name) => env[name]) : [];
    if (!names.length) return snapshot;
    const again = await source.driver.accountUsage?.(Object.fromEntries(names.map((name) => [name, null])));
    return again?.kind === 'available' ? again : snapshot;
  }

  async function readUsage() {
    // DeepSeek has a wallet, not a plan: its row is the balance of the account, read while the harnesses are asked.
    const wallet = balance ? Promise.resolve().then(balance).catch(() => undefined) : undefined;
    const views = await Promise.all(sources().map(async (source) => {
      try {
        let view = usageView(source, await snapshotOf(source));
        if (view.state === 'hidden' && source.id === 'codex') view = codexLimitsView(source, await codexLimits(source));
        // A harness that is installed always has its row: "—" when its plan cannot be read, never a missing line.
        return view.state === 'hidden' ? { ...view, state: 'unavailable' } : view;
      } catch { return { id: source.id, name: source.name, state: 'unavailable', plan: '', limited: false, windows: [] }; }
    }));
    const row = await wallet; // none without an account
    return { providers: row && row.state !== 'hidden' ? [...views, row] : views };
  }

  function usage({ refresh = false } = {}) {
    if (!refresh && usageCache && now() - usageCache.at < USAGE_TTL) return Promise.resolve(usageCache.value);
    usagePending ??= readUsage().then((value) => { usageCache = { at: now(), value }; return value; }).finally(() => { usagePending = undefined; });
    // A reading takes seconds (it starts the harness): the last one is shown meanwhile.
    return usageCache && !refresh ? Promise.resolve(usageCache.value) : usagePending;
  }

  async function running() {
    const claudeSessions = sourceOf('claude') ? await listRunningClaude({ directory: claude.registry ?? claudeSessionRegistry() }) : [];
    const dshRuns = sources().flatMap((source) => (source.activeRuns?.() ?? []));
    return summarizeRunning({
      claude: claudeSessions, dshRuns, titleOf, dshSessionOf: (provider, id) => links.get(provider, id), now: now(),
    });
  }

  return {
    usage, running,
    /** Resolves once the reading that is under way has finished (for tests). */
    settled: async () => { await usagePending?.catch(() => {}); },
    async handle(action, request) {
      try {
        const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
        const headers = { 'cache-control': 'no-store' };
        if (action === 'usage') return Response.json(await usage(body), { headers });
        if (action === 'running') return Response.json(await running(), { headers });
        return new Response('Not found', { status: 404 });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
    },
  };
}
