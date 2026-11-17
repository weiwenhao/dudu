import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHarnessAdapter, HarnessBridge } from './harness-bridge.mjs';
import { createMirrorTool, createMirrorTools } from './mirror-tools.mjs';
import { createHarnessInput } from './input.mjs';
import { registerHarnessCommands } from './commands.mjs';
import { createHarnessTeams } from './teams.mjs';
import { createInputJournal } from './input-delivery.mjs';
import { createHarnessJobs } from './jobs.mjs';
import { createForegroundWatch } from './foreground.mjs';
import { reportGoal } from './goal.mjs';

// The providers of DSH: the harnesses installed on this computer. A harness that is found and enabled becomes a
// model route of its own (`claude`, `codex`); a session that selects the route is run by that harness, and the
// mirror tools that show the harness's tool calls live in that session's agent only, for as long as the
// session's selected route is that harness.

const NO_SETTINGS = { disabled: [], paths: {} };

async function readSettings(file) {
  let raw;
  try { raw = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { ...NO_SETTINGS }; throw error; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The providers settings file is not an object.');
  return {
    disabled: Array.isArray(raw.disabled) ? raw.disabled.filter((id) => typeof id === 'string') : [],
    paths: raw.paths && typeof raw.paths === 'object' ? Object.fromEntries(Object.entries(raw.paths).filter(([, value]) => typeof value === 'string' && value)) : {},
  };
}

async function writeSettings(file, settings) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

export async function createProviders({ host, providers, folder, log = console }) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const settingsFile = join(folder, 'providers.json');
  const inputJournal = createInputJournal(join(folder, 'input-delivery'));
  let settings = await readSettings(settingsFile);
  const status = new Map();         // provider id -> what the settings page shows
  const registered = new Map();     // route -> { bridge, driver, path, dispose }
  const foreground = createForegroundWatch((id) => [...registered.values()].some(({ bridge }) => {
    const run = bridge.runOf(id);
    return run && !run.finished && run.foregroundActive === false;
  }));
  const mirrored = new Map();       // agent id -> { agent, route, bridge, dispose }
  const closing = new Set();
  let refreshing = Promise.resolve();
  let closed = false;
  let disposal;

  const routeOf = (agent) => host.providerOf?.(agent) ?? agent.options?.provider;

  function syncMirrorTools(agent, route) {
    const wanted = registered.get(route)?.bridge;
    const current = mirrored.get(agent.id);
    if (current?.agent === agent && current.bridge === wanted) return;
    current?.dispose();
    mirrored.delete(agent.id);
    if (!wanted) return;
    const disposers = [];
    const dispose = () => { for (const stop of disposers) { try { stop(); } catch { /* the agent is gone */ } } };
    try {
      disposers.push(registerHarnessCommands(agent, wanted));
      for (const definition of createMirrorTools({ bridge: wanted })) disposers.push(agent.ctx.tools.register(definition));
      mirrored.set(agent.id, { agent, route, bridge: wanted, dispose });
    } catch (error) {
      dispose();
      log.warn?.(`[dudu] Could not register the ${route} tools for a session: ${error.message}`);
      throw error;
    }
  }

  function unregister(provider) {
    const entry = registered.get(provider.route);
    if (!entry) return;
    registered.delete(provider.route);
    for (const [id, current] of mirrored) {
      if (current.bridge !== entry.bridge) continue;
      current.dispose();
      mirrored.delete(id);
    }
    entry.dispose();
    const stopped = entry.bridge.dispose().then(() => entry.teams?.close()).catch((error) => {
      log.warn?.(`[dudu] Could not release the ${provider.route} provider: ${error.message}`);
    }).finally(() => closing.delete(stopped));
    closing.add(stopped);
    return stopped;
  }

  function register(provider, detection) {
    const driver = provider.create({ installation: detection.installation });
    const bridge = new HarnessBridge({
      driver, agentOf: (id) => host.agents.get(id), permissionOf: (agent) => host.permissionOf?.(agent), onLink: host.onLink,
      eventsOf: host.eventsOf, flushSession: host.flushSession, inputJournal,
      onForeground: (id) => {
        foreground.changed(id);
        bridge.yieldForInput(id);
      },
      inputOf: createHarnessInput({ attachments: () => host.attachments?.(), folder: join(folder, 'input-images') }),
    });
    const teams = createHarnessTeams({ host, driver, log });
    bridge.teams = teams;
    // A goal of DSH (/goal) in a session of this harness: the end of a round says whether the goal is done (goal.mjs).
    bridge.onGoalReport = (sessionId, round, report) => reportGoal({ goals: host.goals?.(), agent: host.agents.get(sessionId), round, report, log });
    bridge.jobs = createHarnessJobs({ host, route: driver.route, log });
    // The tools the host serves to this harness's sessions (the cron tools that take the place of Claude's own).
    bridge.toolsOf = (sessionId) => host.sessionTools?.forSession(sessionId, driver.route);
    // AgentOptions keeps the host's default route after restore. Recheck the actual adapter before replaying tools.
    bridge.beforeStep = (sessionId) => {
      const agent = host.agents.get(sessionId);
      if (agent) syncMirrorTools(agent, driver.route);
    };
    // A tool the catalog does not list (an MCP tool, say) gets its mirror tool when the harness first calls it.
    bridge.onUnknownTool = (sessionId, name) => {
      const agent = host.agents.get(sessionId);
      const spec = driver.fallbackTool?.(name);
      if (!agent || !spec) return;
      try {
        const dispose = agent.ctx.tools.register(createMirrorTool({ bridge, spec }));
        const current = mirrored.get(agent.id);
        if (current) { const before = current.dispose; current.dispose = () => { before(); try { dispose(); } catch { /* the agent is gone */ } }; }
      } catch (error) {
        log.warn?.(`[dudu] Could not register the ${name} tool: ${error.message}`);
      }
    };
    const dispose = host.llm.registerAdapter([driver.route], createHarnessAdapter(bridge));
    registered.set(driver.route, { bridge, teams, driver, path: detection.path, version: detection.version, environment: provider.environment, dispose });
  }

  async function refreshNow() {
    if (closed) return;
    for (const provider of providers) {
      const detection = await provider.probe({ override: settings.paths[provider.id] });
      const enabled = !settings.disabled.includes(provider.id);
      status.set(provider.id, {
        id: provider.id, name: provider.name, route: provider.route, enabled, configuredPath: settings.paths[provider.id] ?? '',
        state: detection.state, version: detection.version, path: detection.path, reason: detection.reason,
      });
      if (closed) return;
      const entry = registered.get(provider.route);
      const wanted = enabled && detection.state === 'ready';
      if (entry && (!wanted || entry.path !== detection.path)) await unregister(provider);
      if (closed) return;
      if (wanted && !registered.has(provider.route)) register(provider, detection);
      // A refresh is how a new model or a changed login shows up.
      else if (wanted) registered.get(provider.route).driver.refreshModels?.();
    }
    for (const agent of host.agents.list?.() ?? []) syncMirrorTools(agent, routeOf(agent));
  }
  const refresh = () => {
    const next = refreshing.then(refreshNow);
    refreshing = next.catch(() => {});
    return next;
  };

  const disposers = [
    host.on('agent/created', ({ agent }) => syncMirrorTools(agent, routeOf(agent))),
    host.on('session/event', (session, event) => {
      if (event?.type === 'agent/inbox/spliced' && event.data?.target === 'next-step') {
        for (const { bridge } of registered.values()) bridge.yieldForInput(session.id);
      }
      if (event?.type !== 'model/selection') return;
      const agent = host.agents.get(session.id);
      if (agent) syncMirrorTools(agent, event.data?.provider);
    }),
    host.on('agent/disposed', ({ agent }) => {
      mirrored.get(agent.id)?.dispose();
      mirrored.delete(agent.id);
      for (const { bridge } of registered.values()) void bridge.close(agent.id).finally(() => bridge.jobs?.forget(agent.id));
      void host.sessionTools?.forget(agent.id);
    }),
  ];

  await refresh();

  const view = () => ({ providers: providers.map((provider) => status.get(provider.id)).filter(Boolean) });

  return {
    state: view,
    /** The harnesses that are found and enabled, with what reading their sessions needs. */
    sources: () => [...registered.values()].map(({ bridge, driver, path, version, environment }) => ({
      id: driver.id, name: driver.name, route: driver.route, command: path, version, environment, driver, activeRuns: () => bridge.activeRuns(),
    })),
    refresh: async () => { await refresh(); return view(); },
    hasActiveWork: (sessionId) => [...registered.values()].some(({ bridge }) => bridge.hasActiveWork(sessionId)),
    /** Lets go of what the harnesses hold for a DSH session whose turn has ended (deep sleep); -> whether any of them held a run. */
    async release(sessionId) {
      const results = await Promise.all([...registered.values()].map(({ bridge }) => bridge.release(sessionId).catch(() => false)));
      return results.some(Boolean);
    },
    async save({ id, enabled, path }) {
      const provider = providers.find((candidate) => candidate.id === id);
      if (!provider) throw new Error('Unknown provider.');
      const next = { disabled: [...settings.disabled], paths: { ...settings.paths } };
      if (typeof enabled === 'boolean') {
        next.disabled = next.disabled.filter((item) => item !== id);
        if (!enabled) next.disabled.push(id);
      }
      if (typeof path === 'string') {
        if (path.trim()) next.paths[id] = path.trim();
        else delete next.paths[id];
      }
      await writeSettings(settingsFile, next);
      settings = next;
      await refresh();
      return view();
    },
    async handle(action, request) {
      try {
        if (action === 'state') return Response.json(view(), { headers: { 'cache-control': 'no-store' } });
        if (action === 'refresh') return Response.json(await this.refresh(), { headers: { 'cache-control': 'no-store' } });
        if (action === 'save') return Response.json(await this.save(await request.json()), { headers: { 'cache-control': 'no-store' } });
        if (action === 'foreground') {
          const body = await request.json();
          if (typeof body?.sessionId !== 'string' || !body.sessionId || body.sessionId.length > 512
            || body.after !== undefined && typeof body.after !== 'boolean') return new Response('Invalid request', { status: 400 });
          return Response.json(await foreground.wait(body.sessionId, { after: body.after, signal: request.signal }),
            { headers: { 'cache-control': 'no-store' } });
        }
        return new Response('Not found', { status: 404 });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
    },
    close() {
      if (disposal) return disposal;
      closed = true;
      return disposal = (async () => {
        foreground.close();
        for (const dispose of disposers) dispose();
        for (const entry of mirrored.values()) entry.dispose();
        mirrored.clear();
        // A slow installation/model probe must not hold live native writers
        // past Desktop's shutdown deadline. refreshNow checks closed on return.
        for (const provider of providers) unregister(provider);
        await refreshing;
        await Promise.all(closing);
        await host.sessionTools?.close();
      })();
    },
  };
}
