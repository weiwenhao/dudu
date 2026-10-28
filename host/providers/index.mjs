import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHarnessAdapter, HarnessBridge } from './harness-bridge.mjs';
import { createInteractionHandler } from './interactions.mjs';
import { createMirrorTool, createMirrorTools } from './mirror-tools.mjs';
import { detectHarness } from './detect.mjs';

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

export async function createProviders({ host, drivers, folder, detect = detectHarness, log = console }) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const settingsFile = join(folder, 'providers.json');
  let settings = await readSettings(settingsFile);
  const status = new Map();         // driver id -> what the settings page shows
  const registered = new Map();     // route -> { bridge, path, dispose }
  const mirrored = new Map();       // agent id -> { route, dispose }
  const services = host.services ?? {};
  let closed = false;

  function syncMirrorTools(agent, route) {
    const wanted = registered.get(route)?.bridge;
    const current = mirrored.get(agent.id);
    if (current?.route === (wanted ? route : undefined)) return;
    current?.dispose();
    mirrored.delete(agent.id);
    if (!wanted) return;
    try {
      const disposers = createMirrorTools({ bridge: wanted }).map((definition) => agent.ctx.tools.register(definition));
      mirrored.set(agent.id, { route, dispose: () => { for (const dispose of disposers) { try { dispose(); } catch { /* the agent is gone */ } } } });
    } catch (error) {
      log.warn?.(`[dudu] Could not register the ${route} tools for a session: ${error.message}`);
    }
  }

  function unregister(driver) {
    const entry = registered.get(driver.route);
    if (!entry) return;
    registered.delete(driver.route);
    entry.dispose();
    void entry.bridge.dispose();
  }

  function register(driver, path) {
    const configured = driver.create({ path });
    const bridge = new HarnessBridge({
      driver: configured, agentOf: (id) => host.agents.get(id), permissionOf: (agent) => host.permissionOf?.(agent),
      interact: createInteractionHandler({ services, agentOf: (id) => host.agents.get(id) }),
    });
    // A tool the catalog does not list (an MCP tool, say) gets its mirror tool when the harness first calls it.
    bridge.onUnknownTool = (sessionId, name) => {
      const agent = host.agents.get(sessionId);
      const spec = configured.fallbackTool?.(name);
      if (!agent || !spec) return;
      try {
        const dispose = agent.ctx.tools.register(createMirrorTool({ bridge, spec }));
        const current = mirrored.get(agent.id);
        if (current) { const before = current.dispose; current.dispose = () => { before(); try { dispose(); } catch { /* the agent is gone */ } }; }
      } catch (error) {
        log.warn?.(`[dudu] Could not register the ${name} tool: ${error.message}`);
      }
    };
    const dispose = host.llm.registerAdapter([configured.route], createHarnessAdapter(bridge));
    registered.set(configured.route, { bridge, path, dispose });
  }

  async function refresh() {
    for (const driver of drivers) {
      const detection = await detect({ name: driver.binary, minVersion: driver.minVersion, override: settings.paths[driver.id] });
      const enabled = !settings.disabled.includes(driver.id);
      status.set(driver.id, {
        id: driver.id, name: driver.name, route: driver.route, enabled, configuredPath: settings.paths[driver.id] ?? '',
        state: detection.state, version: detection.version, path: detection.path, reason: detection.reason,
      });
      if (closed) return;
      const entry = registered.get(driver.route);
      const wanted = enabled && detection.state === 'ready';
      if (entry && (!wanted || entry.path !== detection.path)) unregister(driver);
      if (wanted && !registered.has(driver.route)) register(driver, detection.path);
    }
  }

  const disposers = [
    host.on('agent/created', ({ agent }) => syncMirrorTools(agent, agent.options?.provider)),
    host.on('session/event', (session, event) => {
      if (event?.type !== 'model/selection') return;
      const agent = host.agents.get(session.id);
      if (agent) syncMirrorTools(agent, event.data?.provider);
    }),
    host.on('agent/disposed', ({ agent }) => {
      mirrored.get(agent.id)?.dispose();
      mirrored.delete(agent.id);
      for (const { bridge } of registered.values()) void bridge.close(agent.id);
    }),
  ];

  await refresh();
  // Agents that already exist when the plugin loads (a hot reload) get their tools too.
  for (const agent of host.agents.list?.() ?? []) syncMirrorTools(agent, agent.options?.provider);

  const view = () => ({ providers: drivers.map((driver) => status.get(driver.id)).filter(Boolean) });

  return {
    state: view,
    refresh: async () => { await refresh(); return view(); },
    async save({ id, enabled, path }) {
      const driver = drivers.find((candidate) => candidate.id === id);
      if (!driver) throw new Error('Unknown provider.');
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
        return new Response('Not found', { status: 404 });
      } catch (error) {
        return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: { 'cache-control': 'no-store' } });
      }
    },
    async close() {
      closed = true;
      for (const dispose of disposers) dispose();
      for (const entry of mirrored.values()) entry.dispose();
      mirrored.clear();
      for (const driver of drivers) unregister(driver);
    },
  };
}
