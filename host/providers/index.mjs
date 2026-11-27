import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHarnessAdapter, HarnessBridge } from './harness-bridge.mjs';
import { createMirrorTool, createMirrorTools } from './mirror-tools.mjs';
import { createHarnessInput } from './input.mjs';
import { registerHarnessCommands } from './commands.mjs';
import { createHarnessTeams } from './teams.mjs';
import { createInputJournal } from './input-delivery.mjs';
import { createModelCache } from './model-cache.mjs';
import { createHarnessJobs } from './jobs.mjs';
import { createForegroundWatch } from './foreground.mjs';
import { reportGoal } from './goal.mjs';

// The providers of DSH: the harnesses installed on this computer. A harness that is found and enabled becomes a
// model route of its own (`claude`, `codex`); a session that selects the route is run by that harness, and the
// mirror tools that show the harness's tool calls live in that session's agent only, for as long as the
// session's selected route is that harness.

// `disabled` and `enabled` hold only a choice that differs from what a harness is by default. Every harness that is found is on until switched
// off (owner, 2026-11-24: 「安装嘟嘟插件启动后检测到的全都自动启用」; from 2026-11-19 those of drivers/universal.mjs were off until switched on). A provider may
// still say `defaultEnabled: false`; none does now.
// `env` holds each harness's own environment variables (owner, 2026-11-23: 「叫配置环境变量，每个 agent 可以配置自己的环境变量」, a proxy for one, say):
// given to its processes when they start, and so to the next process after a change (oar.mjs replaces an idle one). The file is the owner's only (0600).
const NO_SETTINGS = { disabled: [], enabled: [], paths: {}, env: {} };
export const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_MAX = 100;
const ENV_VALUE_MAX = 32 * 1024;

/**
 * The text box of Settings > Providers: one `NAME=value` a line, as a `.env` file or a shell has them. Blank lines and `#` lines are left out, a leading
 * `export ` and one pair of quotes round a value are taken off, and a name given twice keeps its last value. A line of anything else is refused.
 */
export function parseEnvText(text) {
  const env = {};
  String(text).split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) return;
    const at = line.indexOf('=');
    const name = at > 0 ? line.slice(0, at).trim() : '';
    if (!ENV_NAME.test(name)) throw new Error(`Line ${index + 1} is not NAME=value.`);
    const value = line.slice(at + 1).trim();
    env[name] = /^(["']).*\1$/s.test(value) && value.length >= 2 ? value.slice(1, -1) : value;
  });
  return env;
}

/** One harness's variables as saved: names that a shell would take, string values, in the order given. Anything else is refused (`strict`) or left out. */
export function cleanEnv(value, { strict = false } = {}) {
  const refuse = (message) => { if (strict) throw new Error(message); };
  if (!value || typeof value !== 'object' || Array.isArray(value)) { refuse('Environment variables must be an object of names and values.'); return {}; }
  const entries = Object.entries(value);
  if (entries.length > ENV_MAX) refuse(`At most ${ENV_MAX} environment variables.`);
  const clean = {};
  for (const [name, text] of entries.slice(0, ENV_MAX)) {
    if (!ENV_NAME.test(name)) { refuse(`${JSON.stringify(name.slice(0, 80))} is not an environment variable name.`); continue; }
    if (typeof text !== 'string' || text.length > ENV_VALUE_MAX || text.includes('\0')) { refuse(`The value of ${name} is not a text of at most ${ENV_VALUE_MAX} characters.`); continue; }
    clean[name] = text;
  }
  return clean;
}

async function readSettings(file) {
  let raw;
  try { raw = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { ...NO_SETTINGS }; throw error; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('The providers settings file is not an object.');
  return {
    disabled: Array.isArray(raw.disabled) ? raw.disabled.filter((id) => typeof id === 'string') : [],
    enabled: Array.isArray(raw.enabled) ? raw.enabled.filter((id) => typeof id === 'string') : [],
    paths: raw.paths && typeof raw.paths === 'object' ? Object.fromEntries(Object.entries(raw.paths).filter(([, value]) => typeof value === 'string' && value)) : {},
    env: raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
      ? Object.fromEntries(Object.entries(raw.env).map(([id, value]) => [id, cleanEnv(value)]).filter(([, value]) => Object.keys(value).length)) : {},
  };
}

async function writeSettings(file, settings) {
  const temporary = `${file}.${process.pid}.tmp`;
  const { enabled, env, ...rest } = settings;
  const written = { ...rest, ...(enabled?.length ? { enabled } : {}), ...(env && Object.keys(env).length ? { env } : {}) };
  await writeFile(temporary, JSON.stringify(written, null, 2) + '\n', { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, file);
}

export async function createProviders({ host, providers, folder, log = console }) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const settingsFile = join(folder, 'providers.json');
  const modelCache = createModelCache(join(folder, 'model-lists.json'));
  const inputJournal = createInputJournal(join(folder, 'input-delivery'));
  let settings = await readSettings(settingsFile);
  const status = new Map();         // provider id -> what the settings page shows
  const registered = new Map();     // route -> { bridge, driver, path, dispose }
  // A run whose model has answered while its native background work goes on: the desktop's composer and the phone draw it as idle.
  const backgroundOnly = (id) => [...registered.values()].some(({ bridge }) => {
    const run = bridge.runOf(id);
    return run && !run.finished && run.foregroundActive === false;
  });
  const foreground = createForegroundWatch(backgroundOnly);
  const foregroundListeners = new Set();
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
      const definitions = createMirrorTools({ bridge: wanted });
      const names = new Set(definitions.map((definition) => definition.name));
      for (const name of host.sessionTools?.names?.(route) ?? []) {
        const spec = wanted.driver.fallbackTool?.(name);
        if (names.has(name) || !spec) continue;
        definitions.push(createMirrorTool({ bridge: wanted, spec }));
        names.add(name);
      }
      for (const definition of definitions) disposers.push(agent.ctx.tools.register(definition));
      mirrored.set(agent.id, { agent, route, bridge: wanted, names, dispose });
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

  /** The variables the owner gave this harness (read when a process starts, so a change reaches the next one). */
  const envOf = (provider) => settings.env[provider.id] ?? {};

  function register(provider, detection) {
    // A list read after DSH was given the first one: DSH keeps what it got until it is told, as it is by its own DeepSeek listing.
    const driver = provider.create({ installation: detection.installation, env: () => envOf(provider), modelsChanged: () => host.emit?.('llm/models-updated', provider.route), listingFolder: join(folder, 'model-listing'), modelCache });
    const bridge = new HarnessBridge({
      driver, agentOf: (id) => host.agents.get(id), permissionOf: (agent) => host.permissionOf?.(agent), onLink: host.onLink,
      eventsOf: host.eventsOf, flushSession: host.flushSession, inputJournal,
      onForeground: (id) => {
        foreground.changed(id);
        for (const listener of [...foregroundListeners]) {
          try { listener(id); } catch { /* one watcher does not stop the others */ }
        }
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
    bridge.toolsOf = (sessionId, run) => host.sessionTools?.forSession(sessionId, driver.route, run);
    // AgentOptions keeps the host's default route after restore. Recheck the actual adapter before replaying tools.
    bridge.beforeStep = (sessionId) => {
      const agent = host.agents.get(sessionId);
      if (agent) syncMirrorTools(agent, driver.route);
    };
    // A tool the catalog does not list (an MCP tool, say) gets its mirror tool when the harness first calls it.
    bridge.onUnknownTool = (sessionId, name) => {
      const agent = host.agents.get(sessionId);
      const current = mirrored.get(agent?.id);
      if (current?.names.has(name)) return;
      const spec = driver.fallbackTool?.(name);
      if (!agent || !spec) return;
      try {
        const dispose = agent.ctx.tools.register(createMirrorTool({ bridge, spec }));
        if (current) {
          current.names.add(name);
          const before = current.dispose;
          current.dispose = () => { before(); try { dispose(); } catch { /* the agent is gone */ } };
        }
      } catch (error) {
        log.warn?.(`[dudu] Could not register the ${name} tool: ${error.message}`);
      }
    };
    const dispose = host.llm.registerAdapter([driver.route], createHarnessAdapter(bridge));
    // What reads the harness's own sessions and quota runs it with the same variables as its conversations.
    const environment = () => ({ ...provider.environment?.(), ...envOf(provider) });
    registered.set(driver.route, { bridge, teams, driver, path: detection.path, version: detection.version, environment, dispose });
  }

  /** Whether a harness is switched on: the person's choice either way, and without one what the harness is by default. */
  const enabledOf = (provider) => (settings.disabled.includes(provider.id) ? false : settings.enabled.includes(provider.id) ? true : provider.defaultEnabled !== false);

  /** Looks at the harnesses again: all of them, or (`only`, a provider id) the one whose settings were just changed, so that saving one does not wait for the other dozen. */
  async function refreshNow(only) {
    if (closed) return;
    for (const provider of providers) {
      if (only && provider.id !== only) continue;
      const detection = await provider.probe({ override: settings.paths[provider.id] });
      const enabled = enabledOf(provider);
      status.set(provider.id, {
        id: provider.id, name: provider.name, route: provider.route, enabled, configuredPath: settings.paths[provider.id] ?? '', env: envOf(provider),
        state: detection.state, version: detection.version, path: detection.path, reason: detection.reason,
        // Said only of a harness that is off until switched on: the settings page folds such a one away while it is not found.
        ...(provider.defaultEnabled === false ? { defaultEnabled: false } : {}),
        ...(provider.folds ? { folds: true } : {}),
      });
      if (closed) return;
      const entry = registered.get(provider.route);
      const wanted = enabled && detection.state === 'ready';
      if (entry && (!wanted || entry.path !== detection.path)) await unregister(provider);
      if (closed) return;
      if (wanted && !registered.has(provider.route)) {
        register(provider, detection);
        // Read what the harness offers now, in the background: the first menu that asks should not wait for it.
        registered.get(provider.route)?.driver.warmModels?.();
      } else if (wanted) {
        // A refresh is how a new model or a changed login shows up.
        const { driver } = registered.get(provider.route);
        driver.refreshModels?.();
        // Saved for this one just now (a proxy, a path): read what it offers at once, not on the next ask.
        if (only) driver.warmModels?.();
      }
    }
    for (const agent of host.agents.list?.() ?? []) syncMirrorTools(agent, routeOf(agent));
  }
  const refresh = (only) => {
    const next = refreshing.then(() => refreshNow(only));
    refreshing = next.catch(() => {});
    return next;
  };

  const disposers = [
    host.on('agent/created', ({ agent }) => syncMirrorTools(agent, routeOf(agent))),
    host.on('session/event', (session, event) => {
      if (event?.type === 'agent/inbox/spliced' && event.data?.target === 'next-step') {
        for (const { bridge } of registered.values()) bridge.yieldForInput(session.id);
      }
      // A new session can take its initial provider directly in AgentOptions,
      // after agent/created, without a model/selection event. Resolve that route
      // before DSH prepares and freezes the step's executable tool table.
      if (event?.type === 'turn/start' || event?.type === 'step/start') {
        const agent = host.agents.get(session.id);
        if (agent) syncMirrorTools(agent, routeOf(agent));
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
    /** Whether the session's turn is open only for native background work; `onForeground` is told the session's id whenever that may have changed. */
    backgroundOnly: (sessionId) => backgroundOnly(sessionId),
    onForeground(listener) {
      foregroundListeners.add(listener);
      return () => foregroundListeners.delete(listener);
    },
    /** Lets go of what the harnesses hold for a DSH session whose turn has ended (deep sleep); -> whether any of them held a run. */
    async release(sessionId) {
      const results = await Promise.all([...registered.values()].map(({ bridge }) => bridge.release(sessionId).catch(() => false)));
      return results.some(Boolean);
    },
    async save({ id, enabled, path, env }) {
      const provider = providers.find((candidate) => candidate.id === id);
      if (!provider) throw new Error('Unknown provider.');
      const next = { disabled: [...settings.disabled], enabled: [...settings.enabled], paths: { ...settings.paths }, env: { ...settings.env } };
      if (typeof enabled === 'boolean') {
        next.disabled = next.disabled.filter((item) => item !== id);
        next.enabled = next.enabled.filter((item) => item !== id);
        // Only a choice that differs from the harness's default is written down.
        if (enabled !== (provider.defaultEnabled !== false)) (enabled ? next.enabled : next.disabled).push(id);
      }
      if (typeof path === 'string') {
        if (path.trim()) next.paths[id] = path.trim();
        else delete next.paths[id];
      }
      // The whole set at once: what is not in it is gone. A process that is working keeps its variables until it is free (oar.mjs).
      if (env !== undefined) {
        const clean = cleanEnv(typeof env === 'string' ? parseEnvText(env) : env, { strict: true });
        if (Object.keys(clean).length) next.env[id] = clean;
        else delete next.env[id];
      }
      await writeSettings(settingsFile, next);
      settings = next;
      await refresh(id);
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
