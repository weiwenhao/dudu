import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDsbotControl } from './dist/dsbot-control.mjs';
import { createTypertRpcAdapter } from './dist/native-bridge.mjs';
import { createTypertPageRpc } from './dist/native-page-rpc.mjs';
import { createDshMobileFrontend } from './dist/dsh-mobile-frontend.mjs';
import { createNativePages } from './dist/native-pages.mjs';
import { createConversationReads } from './dist/native-conversation-reads.mjs';
import { createNativeQuestions } from './dist/native-questions.mjs';
import { desktopPackageIdentity, writeDesktopRuntime } from './dist/desktop-runtime.mjs';
import { createNativeDiagnostics } from './dist/native-diagnostics.mjs';
import { migrateLegacyState } from './dist/legacy-state.mjs';
import { createProviders } from './dist/providers/index.mjs';
import { createLinkStore, createNativeSessions } from './dist/providers/native/index.mjs';
import { createOverview } from './dist/providers/native/overview.mjs';
import { claudeProvider } from './dist/providers/drivers/claude.mjs';
import { codexProvider } from './dist/providers/drivers/codex.mjs';
import { permissionOf } from './dist/providers/permission.mjs';
import { createIssues } from './dist/assistant/issues/index.mjs';
import { createIssuesApi, ISSUE_ACTIONS } from './dist/assistant/issues/api.mjs';
import { AGENTS, createAgentSessions, modelFor } from './dist/assistant/home/agent-sessions.mjs';
import { createDshSessions } from './dist/assistant/home/dsh-sessions.mjs';
import { createAssignment } from './dist/assistant/home/assign.mjs';
import { firstMessage } from './dist/assistant/home/first-message.mjs';
import { createDispatch } from './dist/assistant/dispatch/index.mjs';
import { createDshLlm } from './dist/assistant/dispatch/dsh-llm.mjs';
import { createHandOut } from './dist/assistant/dispatch/hand-out.mjs';
import { allowedAccess } from './dist/assistant/dispatch/rules.mjs';
import { createDashboard } from './dist/assistant/dashboard/index.mjs';
import { createDashboardApi, DASHBOARD_ACTIONS } from './dist/assistant/dashboard/api.mjs';
import { GridStackEngine } from './dist/assistant/dashboard/engine.mjs';
import { openAssistant } from './dist/assistant/assistant.mjs';

// Capture the loaded package once, so an old runtime cannot report newly installed files as its own.
const runtimeIdentity = await desktopPackageIdentity(dirname(fileURLToPath(import.meta.url)));

export const name = 'dudu';
// Services every DSH has are required. The access mode a session is in is only read to scope what a harness may do,
// so a DSH without it still runs the plugin; so does one without what the sessions of issues use (docs/dsh-session-control.md).
export const inject = {
  connection: true, typertGateway: true, clientModules: true, webServer: true, llm: true, agents: true,
  sessionProjections: false, sessionPersistence: false, workspaceRegistry: false,
  sessionController: false, permissionPresets: false, userQuestions: false, agentDefaultModel: false,
};

// The two halves do not depend on each other. The phone control needs a DSH new enough to hand out peers (the
// Desktop's); the providers work wherever DSH can route models, such as `dsh web`.
async function startProviders(ctx, folder) {
  const links = await createLinkStore(folder);
  const providers = await createProviders({
    folder,
    providers: [claudeProvider, codexProvider],
    host: {
      llm: ctx.llm,
      agents: ctx.agents,
      on: (event, handler) => ctx.on(event, handler),
      permissionOf: (agent) => permissionOf(ctx.sessionProjections, agent),
      onLink: links.record,
    },
  });
  // The sessions the harnesses already have, to browse and load into DSH. DSH's own stores are looked up when used.
  const native = createNativeSessions({
    sources: providers.sources, links, persistence: () => ctx.sessionPersistence, workspaces: () => ctx.workspaceRegistry,
  });
  const overview = createOverview({ sources: providers.sources, links, titleOf: native.titleOf });
  const disposers = [
    ...['state', 'refresh', 'save'].map((action) => ctx.connection.fetch.register({
      path: `/api/dudu/providers/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => providers.handle(action, request),
    })),
    ...['list', 'load'].map((action) => ctx.connection.fetch.register({
      path: `/api/dudu/sessions/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => native.handle(action, request),
    })),
    ...['usage', 'running'].map((action) => ctx.connection.fetch.register({
      path: `/api/dudu/overview/${action}`, methods: ['POST'], requestBody: 'buffered',
      fetch: (request) => overview.handle(action, request),
    })),
  ];
  return async () => {
    for (const dispose of disposers) dispose();
    await providers.close();
    await links.flush();
  };
}

// The issues of 嘟嘟 (docs/assistant.md): one SQLite file in the plugin's state folder, served to the desktop interface.
// `assignment` is the issues' hooks into the sessions they are given to; startAssignment fills it in once the store is open.
async function startIssues(ctx, folder, assignment = {}) {
  const issues = createIssues({ file: join(folder, 'assistant', 'issues.db'), sessionState: (key) => assignment.sessionState?.(key) ?? null });
  const api = createIssuesApi({
    issues,
    onAssign: (issue) => assignment.onAssign?.(issue),
    onReply: (issue, text) => assignment.onReply?.(issue, text),
    onResume: (issue) => assignment.onResume?.(issue),
  });
  assignment.issues = issues;
  const disposers = ISSUE_ACTIONS.map((action) => ctx.connection.fetch.register({
    path: `/api/dudu/issues/${action}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => api.handle(action, request),
  }));
  return async () => {
    for (const dispose of disposers) dispose();
    issues.close();
  };
}

// --- startAssignment: the sessions the issues are given to (docs/assistant.md 3.3 and 3.4, docs/dsh-session-control.md) ---
// An issue that is given an agent gets a DSH session in its project folder, follows it, and hands what the owner answers to it. Both DSH
// runtimes serve it from the services every plugin can inject: no phone peer is needed.
async function startAssignment(ctx, folder, assignment) {
  if (!assignment.issues) throw new Error('there are no issues');
  const dsh = createDshSessions(ctx);
  // DSH lists the models of the harnesses the first time it is asked, which takes a moment; the first issue given to an agent need not wait.
  void dsh.models().catch(() => {});
  const agentSessions = createAgentSessions({ dsh });
  const hooks = createAssignment({
    issues: assignment.issues,
    agentSessions,
    // An issue that names no project is worked on in 嘟嘟's own folder (3.2): the project folder the settings name, once startAssistant has
    // opened it (`assignment.projectFolder`), else the standard one.
    defaultCwd: async () => { const home = assignment.projectFolder?.() ?? join(folder, 'home'); await mkdir(home, { recursive: true }); return home; },
    // What ASSIGN.md allows for this kind of issue; read-only when it says nothing (3.3).
    accessOf: (issue) => ({ access: allowedAccess(assignment.assistant?.memory?.rules?.()?.rules?.['ASSIGN.md'], issue) }),
  });
  Object.assign(assignment, { sessionState: hooks.sessionState, onAssign: hooks.onAssign, onReply: hooks.onReply, onResume: hooks.onResume, start: hooks.start, restore: hooks.restore });
  // The sessions of the issues that are open are followed again after a restart; reading their logs does not hold the plugin back.
  hooks.restore().catch((error) => console.warn(`[dudu] The sessions of the open issues could not be followed again: ${error.message}`));
  return async () => {
    for (const hook of ['sessionState', 'onAssign', 'onReply', 'onResume', 'start', 'restore']) delete assignment[hook];
    hooks.dispose();
    agentSessions.dispose();
  };
}

// 嘟嘟's own state (docs/assistant.md 2, 3.5, 3.6): the project folder with its Markdown files, the settings, the memory and the
// connectors, and the calls the settings page makes on them. A project folder that cannot be opened turns off the memory and the
// connectors only (the settings page says why); the rest of the plugin runs.
async function startAssistant(ctx, dshHome, folder, assignment = {}) {
  // The memory asks the model of startDispatch once it is there (the same one DSH has as its default).
  const llm = (messages, options) => (assignment.llm ? assignment.llm(messages, options) : Promise.reject(new Error('There is no model yet.')));
  const assistant = openAssistant({ dshHome, stateFolder: join(folder, 'assistant'), llm });
  assignment.assistant = assistant; // startAssignment and startDispatch read the rules and the connectors through it: the folder can move
  assignment.projectFolder = () => assistant.folder; // an issue without a project is worked on there (startAssignment)
  for (const problem of assistant.problems) console.warn(`[dudu] The project folder is not available: ${problem}`);
  const disposers = assistant.paths.map((path) => ctx.connection.fetch.register({
    path: `/api/dudu/${path}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => assistant.handle(path, request),
  }));
  return async () => { delete assignment.assistant; delete assignment.projectFolder; for (const dispose of disposers) dispose(); await assistant.close(); };
}

// --- startDispatch: from what comes in to who does it (docs/assistant.md 1.2, 3.1 "收进来", 3.3) ---
// Every half hour the enabled connectors are read (only read operations), what is new becomes issues, and each new issue is handed to an
// agent by ASSIGN.md, or left in Todo with the question "交给谁处理？". The first round is a minute after start. A round that has nothing
// to read costs no model call. The Inputs widget reads `dispatch/state`.
const INTAKE_FIRST_MS = 60_000;
const INTAKE_EVERY_MS = 30 * 60_000;

async function startDispatch(ctx, folder, assignment) {
  if (!assignment.issues) throw new Error('there are no issues');
  const dsh = createDshSessions(ctx);
  const llm = createDshLlm(ctx);
  assignment.llm = llm;
  const dispatch = createDispatch({
    issues: assignment.issues,
    connectors: () => assignment.assistant?.connectors ?? null,
    rules: () => assignment.assistant?.memory?.rules?.() ?? { rules: {} },
    llm,
    agents: async () => {
      let catalog = null;
      try { catalog = await dsh.models(); } catch { /* a DSH without the service has no agent to give an issue to */ }
      return Object.entries(AGENTS).map(([id, name]) => ({ id, name, enabled: Boolean(catalog && modelFor(id, catalog)) }));
    },
    file: join(folder, 'assistant', 'intake.json'),
  });

  const handOut = createHandOut({ dispatch, issues: assignment.issues, assignment, firstMessage });

  let round = null;
  const intake = () => {
    round ??= (async () => {
      const run = await dispatch.intake();
      for (const made of run.created ?? []) await handOut(made.id).catch((error) => console.warn(`[dudu] ${made.ref ?? made.id} could not be handed out: ${error.message}`));
    })().catch((error) => console.warn(`[dudu] Reading what came in failed: ${error.message}`)).finally(() => { round = null; });
    return round;
  };
  const first = setTimeout(() => { void intake(); }, INTAKE_FIRST_MS);
  const every = setInterval(() => { void intake(); }, INTAKE_EVERY_MS);
  first.unref?.();
  every.unref?.();

  const disposeRoute = ctx.connection.fetch.register({
    path: '/api/dudu/dispatch/state', methods: ['POST'], requestBody: 'buffered',
    fetch: async () => Response.json(await dispatch.state(), { headers: { 'cache-control': 'no-store' } }),
  });
  return async () => {
    clearTimeout(first);
    clearInterval(every);
    disposeRoute();
    delete assignment.llm;
    await dispatch.dispose();
    await round;
  };
}

// The dashboard layout (docs/assistant.md 4.1): one small JSON file next to the issues. The engine of the grid library is the one the
// page runs, so a layout the plugin changes is pushed around the same way.
async function startDashboard(ctx, folder) {
  const dashboard = createDashboard({ file: join(folder, 'assistant', 'dashboard.json'), engine: GridStackEngine });
  const api = createDashboardApi({ dashboard });
  const disposers = DASHBOARD_ACTIONS.map((action) => ctx.connection.fetch.register({
    path: `/api/dudu/dashboard/${action}`, methods: ['POST'], requestBody: 'buffered',
    fetch: (request) => api.handle(action, request),
  }));
  return async () => { for (const dispose of disposers) dispose(); };
}

async function startPhoneControl(ctx, config, dshHome, folder) {
  const diagnostics = createNativeDiagnostics(folder);
  const peer = ctx.connection.createPeer({ principal: { kind: 'owner' } });
  let control;
  let questionBridge;
  const disposers = [];
  try {
    const rpc = createTypertRpcAdapter({ gateway: ctx.typertGateway, peer, diagnostics });
    const frontend = createDshMobileFrontend({ clientModules: ctx.clientModules });
    const pageRpc = createTypertPageRpc({
      gateway: ctx.typertGateway,
      peer,
      events: ctx,
      connection: ctx.connection,
      webServer: ctx.webServer,
    });
    const pages = createNativePages({ frontend, pageRpc });
    questionBridge = createNativeQuestions({
      events: ctx,
      attachWait: (request, signal) => {
        const questions = ctx.get('userQuestions');
        if (typeof questions?.attachWait !== 'function') throw new Error('User question wait service is unavailable.');
        return questions.attachWait(request.agent, request.wait.callId, signal);
      },
    });
    control = await createDsbotControl({
      folder,
      rpc,
      pages,
      conversationReads: createConversationReads({ connection: ctx.connection, peer }),
      questionBridge,
      legacyKeyPath: join(dshHome, 'harness-mobile', 'pairing-key'),
      port: config.port ?? 3170,
      host: config.host ?? '0.0.0.0',
    });
    for (const action of ['state', 'save', 'generate', 'revoke', 'nav']) {
      disposers.push(ctx.connection.fetch.register({
        path: `/api/dudu/${action}`, methods: ['POST'], requestBody: 'buffered',
        fetch: (request) => control.handle(action, request),
      }));
    }
  } catch (error) {
    questionBridge?.close();
    for (const dispose of disposers) dispose();
    try { await control?.close(); }
    finally { await peer.dispose(); await diagnostics.flush(); }
    throw error;
  }
  try { await writeDesktopRuntime(folder, runtimeIdentity, control.state().port); }
  catch { console.warn('[dudu] Could not save the local runtime receipt.'); }
  console.info(`[dudu] Ready on port ${control.state().port}. Open Settings > 手机控制 to pair.`);
  return async () => {
    questionBridge.close();
    for (const dispose of disposers) dispose();
    try { await control.close(); }
    finally { await peer.dispose(); await diagnostics.flush(); }
  };
}

export async function apply(ctx, config = {}) {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const folder = join(dshHome, 'dudu');
  // Paired phones were stored by the plugin's former name; carry them over before anything reads the folder.
  await migrateLegacyState({ dshHome });

  const stops = [];
  try {
    stops.push(await startProviders(ctx, folder));
    console.info('[dudu] Providers are ready.');
  } catch (error) {
    console.warn(`[dudu] Providers are unavailable: ${error.message}`);
  }

  const assignment = {}; // startAssignment fills it in: what the issues do when one is given an agent, answered, or its session is opened
  try {
    stops.push(await startIssues(ctx, folder, assignment));
    console.info('[dudu] Issues are ready.');
  } catch (error) {
    // A database written by a newer version stays untouched (SCHEMA_TOO_NEW); the rest of the plugin keeps working.
    console.warn(`[dudu] Issues are unavailable: ${error.message}`);
  }

  try {
    stops.push(await startAssignment(ctx, folder, assignment));
    console.info('[dudu] Sessions for issues are ready.');
  } catch (error) {
    console.warn(`[dudu] Sessions for issues are unavailable: ${error.message}`);
  }

  try {
    stops.push(await startDashboard(ctx, folder));
    console.info('[dudu] The dashboard is ready.');
  } catch (error) {
    console.warn(`[dudu] The dashboard is unavailable: ${error.message}`);
  }

  try {
    stops.push(await startAssistant(ctx, dshHome, folder, assignment));
    console.info('[dudu] The project folder, memory and connectors are ready.');
  } catch (error) {
    console.warn(`[dudu] The project folder, memory and connectors are unavailable: ${error.message}`);
  }

  try {
    stops.push(await startDispatch(ctx, folder, assignment));
    console.info('[dudu] Reading what comes in is ready.');
  } catch (error) {
    console.warn(`[dudu] Reading what comes in is unavailable: ${error.message}`);
  }

  if (typeof ctx.connection.createPeer === 'function') {
    try { stops.push(await startPhoneControl(ctx, config, dshHome, folder)); }
    catch (error) {
      // The providers keep working; DSH shows why the phone control did not start.
      if (stops.length === 0) throw error;
      console.error(`[dudu] Phone control did not start: ${error.message}`);
    }
  } else {
    console.warn('[dudu] Phone control needs a newer DSH (this one has no connection.createPeer); providers still work.');
  }

  ctx.effect(() => async () => { for (const stop of stops.reverse()) await stop(); });
}
